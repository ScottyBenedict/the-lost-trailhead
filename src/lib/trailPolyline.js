import * as Cesium from 'cesium';
import { TERRARIUM_MAX_ZOOM } from './terrainFlyoverProvider';

// Draws the trail as an ordinary 3D polyline lying on the rendered terrain.
// Replaces two earlier attempts:
//  - A ground-clamped polyline (clampToGround): drawn by classifying terrain
//    pixels, which antialiasing doesn't reach, so its edges stair-stepped —
//    and one fixed screen width for the whole line made distant switchbacks
//    swell into blobs.
//  - Painting the line into imagery tiles: clean and ground-scaled, but only
//    as sharp as whichever tile level happened to be loaded under it.
// Heights come from the same Terrarium tiles the terrain mesh is built from,
// sampled once at their most detailed level, so the line sits on the surface
// with no per-frame clamping. Being real 3D geometry, it gets the scene's
// antialiasing. And each short chunk's width is reset every frame from its
// distance to the camera — a width on the ground (fuller up close, finer far
// away) rather than one screen width for the whole line.
//
// Only lon/lat come from the track — a GPS elevation stream is much noisier
// than its lat/lon and routinely disagrees with the DEM, so a line placed by
// GPS height would float and sink against the rendered terrain. GPS height is
// only the fallback for a point whose terrain tile failed to load.
//
// The dark casing and the white fill are two separate lines, and every
// casing is drawn before any fill without writing depth — so wherever the
// trail meets or passes in front of itself on screen (hairpin tips,
// switchback legs stacked by perspective), the fills merge into one white
// shape inside one outline. Drawn as a single outlined line, each leg's
// casing cut a dark stripe through whatever leg was behind it.

// Short enough that the width steps between neighboring chunks aren't
// visible. Chunks sharing a color batch into one draw call, so this costs
// nothing per chunk beyond a width update.
const CHUNK_M = 40;
const FILL = Cesium.Color.WHITE;
export const CASING = Cesium.Color.fromCssColorString('#1a1d1a');
// How far the line floats above the sampled terrain. Exported so the moving
// marker can use the same lift and sit on the line rather than beside it.
export const LIFT_M = 4;

// Wraps a PolylineCollection so its draw commands still depth-test against
// the terrain but don't write depth, letting the fill (drawn after it, same
// opaque pass — Cesium runs opaque commands in the order they're added)
// cover it everywhere. PolylineCollection has no render-state option, so
// this swaps the state on the commands it pushes each frame.
// With depthTest false (the top-down card, see onTop below) it also skips the
// depth test, so the terrain can't hide any of it.
export function withoutDepthWrite(collection, depthTest = true) {
  const renderState = Cesium.RenderState.fromCache({ depthMask: false, depthTest: { enabled: depthTest } });
  return {
    show: true,
    update(frameState) {
      const list = frameState.commandList;
      const first = list.length;
      collection.update(frameState);
      for (let i = first; i < list.length; i++) list[i].renderState = renderState;
    },
    isDestroyed: () => collection.isDestroyed(),
    destroy: () => collection.destroy(),
  };
}

// onTop: draw the whole line over the terrain instead of depth-testing it.
// For the top-down card, where nothing should ever be in front of the trail:
// depth-tested, the card's coarser terrain detail poked up through the line
// in steep spots and cut it into pieces. The flyover keeps the depth test (a
// ridge in front of the line should hide it there).
export function createTerrainTrail(viewer, points, { widthM = 5, minWidthPx = 1.2, maxWidthPx = 8, liftM = LIFT_M, onTop = false } = {}) {
  const scene = viewer.scene;
  const chunks = [];
  const primitives = [];
  let removePreRender = null;
  let destroyed = false;

  const updateWidths = () => {
    const camPos = scene.camera.positionWC;
    // Screen pixels covered by one meter, one meter from the camera.
    const pxPerM = scene.canvas.clientHeight / (2 * Math.tan(scene.camera.frustum.fovy / 2));
    for (const c of chunks) {
      const fill = Cesium.Math.clamp((widthM * pxPerM) / Cesium.Cartesian3.distance(camPos, c.center), minWidthPx, maxWidthPx);
      // The dark edge scales with the line: at a fixed width, distant stretches
      // came out wider than the gap between switchback legs, smearing them —
      // but it can't get too thin, or the white line vanishes against snow.
      const casing = Cesium.Math.clamp(fill * 0.3, 0.8, 1.5);
      // Quarter-pixel steps, so small camera moves don't rewrite every
      // chunk every frame.
      const fillW = Math.round(fill * 4) / 4;
      const casingW = Math.round((fill + 2 * casing) * 4) / 4;
      if (fillW !== c.fill.width) c.fill.width = fillW;
      if (casingW !== c.casing.width) c.casing.width = casingW;
    }
  };

  let resolveEnds;
  const ends = new Promise((resolve) => { resolveEnds = resolve; });
  let resolveGround;
  const ground = new Promise((resolve) => { resolveGround = resolve; });

  const cartos = points.map((p) => Cesium.Cartographic.fromDegrees(p.lon, p.lat));
  Cesium.sampleTerrain(viewer.terrainProvider, TERRARIUM_MAX_ZOOM, cartos)
    .then(() => {
      if (destroyed || viewer.isDestroyed()) return;
      const heights = cartos.map((c, i) => c.height ?? points[i].ele ?? 0);
      const positions = cartos.map((c, i) =>
        Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, heights[i] + liftM)
      );
      const casings = new Cesium.PolylineCollection();
      const fills = new Cesium.PolylineCollection();
      // One Material per polyline, never shared: a polyline destroys its
      // material along with itself, so a shared one throws on the second
      // polyline's destroy — which blanked the whole page on closing the
      // flyover. Same type and color still batch into one draw call.
      const color = (c) => Cesium.Material.fromType('Color', { color: c });
      let start = 0;
      let run = 0;
      for (let i = 1; i < positions.length; i++) {
        run += Cesium.Cartesian3.distance(positions[i - 1], positions[i]);
        if (run < CHUNK_M && i < positions.length - 1) continue;
        // Neighboring chunks share their end vertex, so there's no gap.
        const slice = positions.slice(start, i + 1);
        chunks.push({
          casing: casings.add({ positions: slice, width: 1, material: color(CASING) }),
          fill: fills.add({ positions: slice, width: 1, material: color(FILL) }),
          center: Cesium.BoundingSphere.fromPoints(slice).center,
        });
        start = i;
        run = 0;
      }
      primitives.push(
        scene.primitives.add(withoutDepthWrite(casings, !onTop)),
        scene.primitives.add(onTop ? withoutDepthWrite(fills, false) : fills)
      );
      updateWidths();
      removePreRender = scene.preRender.addEventListener(updateWidths);
      resolveEnds([positions[0], positions[positions.length - 1]]);
      resolveGround(heights);
    })
    .catch((e) => console.error('[terrainFlyover] trail terrain sampling failed:', e));

  return {
    // [first, last] position of the drawn line, terrain-sampled and lifted
    // exactly as the line is, once it's on screen — for marking its ends.
    // Never resolves if the trail is torn down (or sampling fails) first.
    ends,
    // The ground height (m, no lift) under each of `points`, from the same
    // sampling the line is drawn on — so anything placed with it sits on the
    // line, not on Cesium's coarser idea of the ground. Same resolve rules.
    ground,
    destroy() {
      destroyed = true;
      removePreRender?.();
      if (!viewer.isDestroyed()) primitives.forEach((p) => scene.primitives.remove(p));
    },
  };
}
