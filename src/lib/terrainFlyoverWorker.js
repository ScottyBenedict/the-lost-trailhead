import Martini from '@mapbox/martini';

// NOTE: deliberately not importing rgbTerrainToGrid/createQuantizedMeshData from
// '@macrostrat/cesium-martini', even though that package re-exports both — doing
// so pulls in the entire 'cesium' library as a transitive dependency, and Cesium
// assumes a DOM (window/document) throughout, which crashes at module-eval time
// inside a Worker (confirmed in spikes/phase1c-cesium-terrain-spike.html, where
// this showed up as an opaque "worker error: undefined"). Both functions below
// are small and pure, so they're ported here instead — line-for-line from
// https://github.com/davenquinn/cesium-martini/blob/master/src/worker/worker-util.ts
// (as of v1.6.0), with only the pixel-accessor shape changed (ndarray's
// .get(x,y,c) -> a plain closure, to avoid an unnecessary extra dependency).

// Terrarium encoding: https://github.com/tilezen/joerd/blob/master/docs/formats.md
//
// Clamped to a generous real-world range (Dead Sea ~-430m to just above Everest)
// rather than trusting the raw decode. Two real sources of garbage single-pixel
// values showed up in testing: (1) SRTM (which Terrarium is built from) has known
// "no-data" void regions in steep/mountainous terrain, often encoded as sentinel-
// like values; (2) canvas 2D's drawImage+getImageData can distort RGB values via
// alpha premultiplication at partially-transparent/edge pixels, unlike a direct
// WebGL texture upload (unaffected — this is why the earlier MapLibre spike,
// which never round-trips through canvas 2D, never hit this).
// A single such outlier is disproportionately damaging here: it skews this
// tile's computed min/max, and everything else gets height-quantized relative to
// that range — one bad pixel can compress an entire tile's real relief into a
// sliver of the encoding range, which looks exactly like "terrain is flat" even
// though the underlying data and pipeline are otherwise working correctly.
const decodeTerrarium = (r, g, b) => Math.max(-500, Math.min(9000, r * 256 + g + b / 256 - 32768));

function rgbTerrainToGrid(getPixel, tileSize, decodeRgb) {
  const gridSize = tileSize + 1;
  const terrain = new Float32Array(gridSize * gridSize);
  for (let y = 0; y < tileSize; y++) {
    for (let x = 0; x < tileSize; x++) {
      const r = getPixel(x, y, 0), g = getPixel(x, y, 1), b = getPixel(x, y, 2), a = getPixel(x, y, 3);
      terrain[y * gridSize + x] = decodeRgb(r, g, b, a);
    }
  }
  // backfill right and bottom borders (ported as-is from worker-util.ts)
  for (let x = 0; x < gridSize - 1; x++) terrain[gridSize * (gridSize - 1) + x] = terrain[gridSize * (gridSize - 2) + x];
  for (let y = 0; y < gridSize; y++) terrain[gridSize * y + gridSize - 1] = terrain[gridSize * y + gridSize - 2];
  return terrain;
}

function createQuantizedMeshData(tile, mesh, tileSize, terrain) {
  const xvals = [], yvals = [], heightMeters = [];
  const northIndices = [], southIndices = [], eastIndices = [], westIndices = [];
  let minimumHeight = Infinity, maximumHeight = -Infinity;
  const scalar = 32768.0 / tileSize;
  for (let ix = 0; ix < mesh.vertices.length / 2; ix++) {
    const px = mesh.vertices[ix * 2], py = mesh.vertices[ix * 2 + 1];
    const height = tile.terrain[py * (tileSize + 1) + px];
    if (height > maximumHeight) maximumHeight = height;
    if (height < minimumHeight) minimumHeight = height;
    heightMeters.push(height);
    if (py === 0) northIndices.push(ix);
    if (py === tileSize) southIndices.push(ix);
    if (px === 0) westIndices.push(ix);
    if (px === tileSize) eastIndices.push(ix);
    xvals.push(px * scalar);
    yvals.push((tileSize - py) * scalar);
  }
  const heightRange = maximumHeight - minimumHeight;
  const heights = heightMeters.map((d) => (heightRange < 1 ? 0 : (d - minimumHeight) * (32768.0 / heightRange)));
  return {
    minimumHeight,
    maximumHeight,
    quantizedVertices: new Uint16Array([...xvals, ...yvals, ...heights]),
    indices: new Uint16Array(mesh.triangles),
    westIndices,
    southIndices,
    eastIndices,
    northIndices,
    quantizedHeights: terrain,
  };
}

const martiniCache = {};
let loggedCount = 0;

self.onmessage = function (msg) {
  const { id, payload } = msg.data;
  if (id == null) return;
  try {
    const { imageData, tileSize = 256, errorLevel = 10, maxVertexDistance = 200, x, y, z } = payload;
    const pixelBytes = new Uint8Array(imageData);
    const getPixel = (x, y, c) => pixelBytes[(y * tileSize + x) * 4 + c];
    const terrain = rgbTerrainToGrid(getPixel, tileSize, decodeTerrarium);
    martiniCache[tileSize] ??= new Martini(tileSize + 1);
    const tile = martiniCache[tileSize].createTile(terrain);
    const mesh = tile.getMesh(errorLevel, Math.min(maxVertexDistance, tileSize));
    const res = createQuantizedMeshData(tile, mesh, tileSize, terrain);
    // TEMPORARY diagnostic — remove once real elevation is confirmed rendering.
    // Uncapped for z>=12 specifically: the question right now is whether
    // refinement ever reaches high-detail tiles near the camera at all, or
    // gets stuck showing coarse regional tiles up close (which would look
    // exactly like "flat" even though the underlying data is fine).
    if (loggedCount < 15 || z >= 12) {
      loggedCount++;
      console.log(`[terrainFlyoverWorker] z${z}/${x}/${y} errorLevel=${errorLevel.toFixed(3)} maxVertexDistance=${maxVertexDistance} minH=${res.minimumHeight.toFixed(1)} maxH=${res.maximumHeight.toFixed(1)} vertices=${res.quantizedVertices.length / 3}`);
    }
    self.postMessage({ id, payload: res });
  } catch (err) {
    self.postMessage({ id, err: (err && err.message) || String(err) });
  }
};
