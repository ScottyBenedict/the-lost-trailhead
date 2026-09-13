import { MartiniTerrainProvider, DefaultHeightmapResource, WorkerFarmTerrainDecoder } from '@macrostrat/cesium-martini';

// AWS Terrarium tiles: free, static S3 bucket, no account/quota system, no
// commercial/non-commercial license boundary (see docs/roadmap-3d-flyover.md,
// decision 1). Confirmed capped at zoom 15 — z16/z17 404 directly against the
// bucket.
const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const TERRARIUM_MAX_ZOOM = 15;

// Creates a self-hosted (no Cesium ion) terrain provider that decodes Terrarium
// raster-DEM tiles into quantized-mesh terrain on the fly, off the main thread.
// Validated in spikes/phase1c-cesium-terrain-spike.html: 480 frames/8s, 0
// longtasks during an animated camera flythrough — the expensive decode work
// happens entirely in the Worker, so it doesn't block rendering no matter how
// much tile traffic is happening.
export function createTerrariumTerrainProvider() {
  const worker = new Worker(new URL('./terrainFlyoverWorker.js', import.meta.url), { type: 'module' });
  // A silent Worker failure here means terrain never renders with no visible
  // error anywhere else in the pipeline — worth always logging, not just during
  // development.
  worker.onerror = (e) => console.error('[terrainFlyover] terrain worker error:', e.message || e, e);
  worker.onmessageerror = (e) => console.error('[terrainFlyover] terrain worker messageerror (structured-clone failure):', e);

  const decoder = new WorkerFarmTerrainDecoder({ worker, maxWorkers: 3 });
  const resource = new DefaultHeightmapResource({
    url: TERRARIUM_URL,
    maxZoom: TERRARIUM_MAX_ZOOM,
    tileSize: 256,
  });
  // detailScalar left at the library default (2.0) — an earlier, more
  // aggressive override (1.0, forcing more geometry/detail per frame) is the
  // leading suspect for reported jank, and the "flat"-looking terrain that
  // prompted it is more likely explained by the elevation-decode clamping fix
  // in terrainFlyoverWorker.js. Revisit with real frame-rate numbers once this
  // baseline is confirmed working.
  const provider = new MartiniTerrainProvider({ resource, decoder });
  provider.errorEvent?.addEventListener((e) => console.error('[terrainFlyover] terrain provider error:', e?.message || e));
  return provider;
}
