# 3D Terrain Flyover — Roadmap

Replaces the current 2D `gpxFlyover.js` (flat Leaflet line-growth animation) with a
true 3D terrain flyover, in the spirit of Strava's route animations.

## ✅ STATUS (2026-09-13): Shipped, live in production — this doc is historical

The MapLibre blocking finding below turned out to be the right call to revisit
Cesium on (exactly as this doc predicted). **Cesium is what actually shipped.**
Self-hosted (no Cesium ion — Terrarium DEM via a custom Worker + `MartiniTerrainProvider`,
Esri World_Imagery satellite basemap), live behind `USE_TERRAIN_3D = true` (no
longer a dev-only toggle in practice — both `HikeMap.jsx` and `HikeMapCard.jsx`
run it) since commit `89aab98` (2026-09-12), with several follow-up commits since
(`e4b25a9`, `2606253`) fixing camera framing, marker occlusion, admin GPX upload
flow, and an invisible-button CSS bug. **The code is `src/lib/terrainFlyover.js`,
`terrainFlyoverProvider.js`, `terrainFlyoverWorker.js`, `terrainFlyoverOverrides.css`
— read that file's own inline comments for current camera/smoothing tuning
rationale, which is now the authoritative source, not this doc.** Everything below
this point (MapLibre findings, Phase 2+ planning against MapLibre, the deferred
Three.js spike) is kept as historical record of *why* Cesium was chosen, not a
live plan — none of it describes the shipped implementation.

Key differences from what this doc originally scoped:
- Out-and-back path collapsing shipped as **apex-based line/camera-path slicing**
  (`findApexIndex` — symmetry-matching between outbound/return legs, verified
  against real GPX data), not the "collapse per-segment" approach sketched below.
  Only the outbound leg is drawn; the descent literally retraces the same
  Catmull-Rom-smoothed array in reverse (not independently built from the
  return leg's own recording) — guarantees they can't visually diverge.
- Camera does **not** auto-tilt into turns or use a per-leg bearing — converged
  on a single fixed bearing for the entire flight after multiple rounds of "camera
  spins/pans too much" feedback. See `terrainFlyover.js`'s own comments for the
  full reasoning chain.
- No server-side precomputation / Edge Function — runs entirely client-side.

## ⚠️ Blocking finding (2026-09-11) — read before continuing this roadmap

**Animating anything against a MapLibre GL map with `terrain` enabled is not viable
at usable frame rates.** This was tested and isolated across six configurations on
`spikes/phase1b-flyover-test.html` and follow-up isolation files — moving the camera
(`jumpTo` every frame), updating a GeoJSON marker/line source every frame with a
*fixed* camera, one map instance vs. two, symbols present vs. fully stripped, tiles
cold vs. pre-warmed along the whole route. Every terrain-enabled configuration
produced 14–24 frames over 8 seconds (long tasks regularly 300–1300ms, one spike to
1.8s) — visually and measurably catastrophic, matching the user's report ("janky as
all get out... something wrong in how it's playing back"). The *identical* code with
`style.terrain` simply removed ran at a clean 476–482 frames over 8 seconds (a
perfect 60fps) every time. Terrain being enabled is the entire variable — not camera
movement, not symbol/label collision detection, not on-demand tile loading (ruled
out via pre-warming — barely moved the numbers), not running two map instances at
once. This is a property of MapLibre's terrain rendering pipeline itself: it's
built for human-paced pan/zoom/tilt interaction, not scripted 60fps updates.

**This changes the decision calculus, not just an implementation detail:**
- **Decision 2 (MapLibre GL, ruling out Cesium) needs to be revisited.** Cesium's
  entire architecture is purpose-built for continuous 3D camera flight over terrain
  — this class of problem is one of its flagship use cases. It has not been tested
  here, so it's not confirmed to be free of the same issue, but the licensing
  objection in decision 1 (Community tier is personal/non-commercial only) is a
  *future* concern for a *currently* non-commercial site — worth weighing against a
  hard, proven performance wall on the free alternative, rather than ruling Cesium
  out on cost alone before confirming MapLibre can actually deliver the feature.
- **Alternatives if staying on the free/MapLibre stack:** (a) keep terrain enabled
  only for a static establishing shot, animate marker/line with terrain *off*
  during actual flight (loses the 3D relief during motion, which may defeat the
  point); (b) pre-render the flyover as a baked video server-side per hike (sidesteps
  real-time rendering entirely, at the cost of losing any interactivity and adding a
  render pipeline); (c) deeper custom engineering against MapLibre's terrain
  internals (untested, unclear if possible without forking the library); (d) a
  pre-baked static Three.js mesh with only the camera animated against it — see
  "Scope: Three.js static-mesh spike" below, proposed but not yet built.
- **Context from researching how Strava actually does this (2026-09-11):** Strava's
  cinematic "Flyover" feature (the thing this roadmap is modeled on) is *not* built
  on a stock map library's terrain feature at all — it runs on tech from FATMAP, a
  3D-mapping company Strava acquired in 2022, on what Strava calls a "Proprietary
  Map Rendering Engine." That's a real signal that the scripted-flythrough problem
  is hard enough that a well-resourced team solved it by acquiring dedicated tech
  rather than building it on Mapbox GL JS/MapLibre's built-in terrain — consistent
  with the wall found here. Strava *does* also use plain Mapbox GL JS terrain for a
  separate, more modest feature ("3D Layer on Strava Maps") — but that one is
  user-driven tilt/pan, not an autoplaying camera, i.e. exactly the workload
  MapLibre's terrain handles fine (matches our working static Phase 1 spike).
  Worth deciding explicitly whether the real goal is that simpler interactive
  3D-tilt view (achievable now, on what's already built) vs. the full cinematic
  autoplay flythrough (the harder, still-unsolved problem this doc is chasing).
  Sources: [Strava Introduces Proprietary Map Rendering Engine](https://press.strava.com/articles/strava-introduces-proprietary-map-rendering-engine),
  [TechCrunch on Flyover](https://techcrunch.com/2023/11/15/strava-launches-flyover-an-aerial-3d-video-recap-of-every-outdoor-activity-you-do/),
  [3D Layer on Strava Maps](https://support.strava.com/hc/en-us/articles/4482870430605-3D-Layer-on-Strava-Maps).
- **Do not resume Phase 2+ below until this is resolved** — path collapsing, DEM
  snapping, and camera-path generation all assume smooth animated playback against
  a terrain-enabled map, which is currently not achievable.

## Decisions made

1. **Terrain/DEM source: AWS Terrarium tiles.** Free, static S3 bucket, no account
   or quota system, and — critically — no commercial/non-commercial license
   boundary. Covers all hikes since none are above 60°N (SRTM's coverage limit,
   which Terrarium is built on).
   - **Ruled out:** Cesium World Terrain / Cesium ion. Their free "Community" tier
     is explicitly licensed for personal/non-commercial use only (per Cesium's own
     pricing FAQ) — a real constraint given this site may become commercial later,
     not just a cost issue. Paid tiers start at $149/mo, which isn't proportionate
     to a personal hiking-log site.
   - **Confirmed limitation (2026-09-08):** Terrarium tiles cap at zoom 15
     everywhere (verified directly against the S3 bucket for the Rattlesnake
     Ledge area — z15 returns HTTP 200, z16/z17 return HTTP 404). Beyond that
     zoom, terrain will look soft/oversampled. See "MapTiler A/B test" and
     "USGS 3DEP" notes below.
2. **Rendering library: MapLibre GL JS**, paired with Terrarium's raster-DEM
   terrain format. Means more custom camera/flyover code than Cesium would have
   provided out of the box, but no vendor lock-in and no licensing cliff if the
   site's status changes.
3. **Processing location: Supabase Edge Function**, triggered by a Storage/DB
   webhook on `hike_gpx` insert/update. `MapsTab.jsx` stays unchanged; the admin
   upload flow is untouched.
4. **Out-and-back path collapsing.** When the return leg retraces the outbound
   leg, the map draws a single line rather than two slightly-offset overlapping
   GPX tracks (raw GPS drift makes the double-line look muddy). Detection and
   collapsing happens per-segment, not as a whole-hike flag, to correctly handle
   "lollipop" hikes (shared stem + loop + shared stem) — only the stem segments
   collapse, the loop portion doesn't.
   - Split the track at the point of max cumulative distance from the start
     (the apex/turnaround), not at the midpoint by point index — outbound and
     return legs are rarely paced evenly (breaks, photo stops, slower ascent).
   - Match outbound vs. reversed-return points with a distance tolerance
     (nearest-point average deviation, or Fréchet distance) to allow for normal
     GPS drift (10–30m) between the two passes.
   - This is a **display-only transform**. Distance/elevation-gain stats and any
     DB-stored figures must keep using the full round-trip GPX track, not the
     collapsed version.
5. **Animation covers the full hike, not just the outbound half.** The collapsed
   line is drawn once, but the camera/marker traverses it twice — forward on the
   way out, reversed on the way back — so total flyover duration reflects the
   real out-and-back hike, not a truncated one-way version. This means the
   camera-path state needs an explicit outbound/return phase flag rather than a
   single monotonic progress index (the current `growTravelLine` implementation
   only supports the latter). Loop hikes stay simplest: line drawn once, camera
   travels it once, no phase split needed.
6. **Basemap: vector tiles (OpenFreeMap), not raster.** A raster PNG basemap
   (tried OSM raster first) gets draped over the 3D terrain mesh as a single
   stretched texture, which warps and blurs baked-in labels. Vector tiles draw
   lines/labels fresh in map space every frame, staying crisp and upright at any
   tilt. OpenFreeMap: free, no key/account/usage cap — same no-license-boundary
   reasoning as the Terrarium pick.

## Proposed phases

**Phase 1 — Terrain rendering spike**
- Stand up a minimal MapLibre GL page pulling Terrarium tiles for one known
  hike, to confirm the raster-DEM terrain rendering works end to end before
  building anything else on top of it.
- Status (2026-09-08): terrain + vector basemap rendering correctly. Resolution
  ceiling confirmed at Terrarium's z15.
- **MapTiler A/B result (2026-09-11): not a meaningful improvement — as predicted.**
  MapTiler's `terrain-rgb-v2` tileset metadata (`.../terrain-rgb-v2/tiles.json`)
  confirms its real maxzoom is **14**, one level *lower* than Terrarium's
  confirmed 15 — it cannot provide more real elevation detail. A quick visual
  test at tight zoom initially looked smoother, but that held up unchanged even
  after correcting the source's `maxzoom` config from a wrong placeholder (12)
  to the real value (14) — the smoothness is an interpolation/shading artifact
  at extreme overzoom, not sharper ground truth. **USGS 3DEP is now the only
  remaining path to genuinely sharper terrain** (near-complete WA LiDAR
  coverage, often 1m+) — see decision 1 and the "Next steps" below. This means
  actually improving on Terrarium requires the ETL pipeline (3DEP DEM →
  terrain-RGB via `rio-rgbify` → host on S3/R2), not a drop-in tile-source swap.

**Phase 2 — Path collapsing + elevation correction**
- Path collapsing (decision 4): apex-split, tolerance-match, segment-level
  detection so lollipop hikes only collapse their shared stems.
- DEM-snapping step (wherever Phase-1/decision-3 puts it), run on the
  collapsed track.
- Interim: render the path with terrain-clamping (`clampToGround` or
  equivalent) so it doesn't float/sink, even before real snapping is built.
  Cosmetic fix, not accuracy — fine as a stopgap.

**Phase 3 — Camera path generation**
- Algorithmic, not manually authored per hike (required for "every uploaded
  hike," not just a showcase piece).
- Derive from the track itself: camera trails behind/above the current point,
  fixed pitch, auto-tilt into turns. Expose only a few global style knobs, not
  per-waypoint keyframes.
- Outbound/return phase flag (decision 5) drives whether the camera re-plays
  the same line in reverse or continues forward onto new line (loop case).

**Phase 4 — New/updated storage**
- New column or table for the generated camera-path JSON (and corrected
  elevation data, if precomputed) per hike.
- If using an Edge Function: trigger it on `hike_gpx` insert/update.

**Phase 5 — Playback component**
- New or extended display component (parallel to `HikeMap.jsx`) that renders
  the flyover: terrain + collapsed path + camera replay on demand.
- Admin panel itself likely needs no changes — the upload flow in
  `MapsTab.jsx` stays the same; processing happens downstream.

## Open questions to resolve before/during build

- Should staff be able to preview/adjust the generated flyover camera path
  before it goes live, or is fully automatic acceptable?

## Scope: Three.js static-mesh spike (proposed, not started — 2026-09-11)

Investigating whether the blocking finding above (MapLibre terrain choking on
scripted animation) can be sidestepped by not using MapLibre's dynamic terrain
system at all — instead pre-baking a static 3D mesh once and animating only the
camera/marker against it, which is the standard cheap pattern in games/Three.js
(moving a camera through fixed GPU geometry vs. MapLibre's per-frame tile
recompositing, which is what we now believe is the actual expensive part — see
"why" note below).

**Why this might work where MapLibre didn't:** the working theory (not yet proven)
is that MapLibre's cost isn't "3D terrain rendering" in the abstract — it's that
MapLibre re-renders each visible tile's flat vector content to an offscreen
texture and re-drapes it over the mesh whenever *anything* in that tile is dirty
(confirmed: even a frozen camera with only the marker's GeoJSON updating was just
as broken as camera movement). A static mesh built once, textured once, with only
camera-matrix + a small marker object updated per frame, never triggers that
recomposite step at all.

**Components to build:**
1. **DEM → heightmap.** Fetch Terrarium/MapTiler raster-DEM tiles covering the
   route bbox (known: lat 47.4329–47.4397, lon -121.7851–-121.7669 for
   Rattlesnake Ledge), decode the RGB-encoded elevation per pixel, stitch
   adjacent tiles into one elevation grid. Terrarium encoding:
   `elevation = (R*256 + G + B/256) - 32768`.
2. **Mesh construction.** A Three.js `BufferGeometry` grid (~200×200 vertices —
   not full pixel resolution, that's almost certainly overkill) with each
   vertex's height set from the decoded elevation grid, lat/lon projected to
   local flat meters (equirectangular approximation is fine at this scale).
   Same ~1.5x exaggeration as the MapLibre spikes for visual consistency.
3. **Texture.** Start with **no texture — procedural hillshade-style lighting
   only** (normal-based shading on the mesh) for the first pass, specifically to
   isolate the performance question without adding tile-fetching complexity.
   Satellite imagery or a baked basemap-image texture is a real follow-up once
   performance is confirmed, not a blocker for the initial spike.
4. **Route + marker in 3D.** Project the real GPX points into the same local XYZ
   space, draw as a static `THREE.Line` (built once, never touched per frame).
   Marker is a small sphere whose position is updated every frame using the
   *same* `positionAt`-style interpolation already in `gpxFlyover.js`, just
   outputting XYZ instead of lat/lon.
5. **Camera.** Reuse the existing frac-based interpolation for timing. Worth
   trying an actual chase/offset camera (behind-and-above the marker) instead of
   dead-center-lock this time — dead-center camera-lock has drawn "feels janky"
   feedback twice now on the 2D version, independent of the terrain question, so
   a fresh build is a natural place to avoid repeating that.
6. **Test harness.** Same pattern as the MapLibre spikes — standalone HTML, no
   build step, CDN-loaded Three.js, rendered at both card (413×310) and lightbox
   (760×500) sizes, instrumented with the same `PerformanceObserver` longtask
   capture already used, for a direct apples-to-apples comparison against the
   MapLibre numbers on record (14–24 frames/8s broken; 476–482 frames/8s clean).

**Real risks, not just unknowns:**
- Reading DEM tile pixel data via canvas `getImageData` can throw a
  `SecurityError` (tainted canvas) if the tile server doesn't send permissive
  CORS headers — needs verifying against Terrarium's S3 bucket / MapTiler's API
  before assuming this works; fetching as an ArrayBuffer and decoding the PNG
  directly (bypassing `<img>`+canvas) is the fallback if so.
- No library does "GPX + DEM tiles → 3D scene" out of the box the way MapLibre
  does "GPX + vector tiles → 2D scene" — this is meaningfully more custom code
  than any spike so far (tile-stitching, lat/lon→local-meters projection,
  heightmap decoding), with real bug surface beyond just the performance
  question this is meant to answer.
- Effort estimate: a half-day-to-day-scale spike, not a quick config change like
  the MapLibre A/B tests were.

**Deliverable:** `spikes/phase1c-threejs-terrain-spike.html`, same
open-directly-in-browser pattern as the existing spikes, measured with the same
methodology before any visual polish.

## Foundation revisited: Cesium, not Three.js (2026-09-11, later same day)

This project's scope grew from "a TLT feature" to "a potential commercial product"
(Strava/Relive-style 3D flyover). That reframing changed the technical-foundation
call above:

- **The "Cesium ruled out on licensing" reasoning (decision 1) conflated two
  different things.** **CesiumJS** (the rendering engine) is Apache 2.0 — free for
  any commercial use, no restriction. **Cesium ion** is Cesium's separate *hosted*
  terrain/imagery service, and only *that* has the personal/non-commercial free
  tier. Self-hosting terrain data with CesiumJS (same pattern as the Terrarium
  bucket already used here) avoids ion entirely and removes the objection.
- Cesium's camera-flight-over-terrain is close to its core designed use case
  (flight visualization, cinematic globe flythroughs) — a stronger prior against
  hitting the same wall than an unproven from-scratch Three.js mesh approach.
- Commercial defensibility doesn't depend on owning the rendering engine or the
  terrain data anyway — neither is proprietary (DEM data is public domain,
  CesiumJS is open source, same as every competitor's stack). It depends on
  product/camera-path logic, UX, and brand.

**Decision: pause the Three.js spike, build a Cesium spike instead** —
`spikes/phase1c-cesium-terrain-spike.html` (note: reuses the "phase1c" name the
Three.js spike was going to use; the Three.js file was never created, so no
conflict). Full plan and reasoning: `/Users/scottbenedict/.claude/plans/joyful-churning-pascal.md`.

**Self-hosted terrain path confirmed (research, not yet tested in-browser):**
`@macrostrat/cesium-martini` (actively maintained, v1.6.0 as of Jan 2026) converts
raster-DEM tiles (Terrain-RGB *and*, since v1.4.0, Terrarium encoding) into
quantized-mesh terrain on the fly, in-browser — no offline ETL/tile-conversion step
needed, unlike `cesium-terrain-builder`. It doesn't touch Cesium ion. Investigated
down to source level (`MartiniTerrainProvider`, `DefaultHeightmapResource`,
`WorkerFarmTerrainDecoder`, and the `rgbTerrainToGrid`/`createQuantizedMeshData`
helpers, all re-exported from the package root) to confirm this. One real gap: the
package's own Mapbox-encoding worker is bundled via a Vite-only `web-worker:`
import that doesn't work in a no-build-step file, so the spike ships a small
from-scratch Terrarium-decode worker (~30 lines) instead — reusing the package's
own mesh-building helpers and `@mapbox/martini`, so the only genuinely new code is
the one-line Terrarium RGB→elevation formula.

**RESULT (2026-09-11, tested in-browser): Cesium terrain handles animated flythrough
at a clean 60fps — the hypothesis is confirmed.** `480 frames / 8s, 0 longtasks
(worst 0ms)` on both the card (413×310) and lightbox (760×500) viewers, measured
*while* terrain tiles were actively, continuously streaming in the background —
essentially identical to MapLibre's own "terrain off" clean baseline (476–482
frames/8s) and nowhere near its "terrain on" collapse (14–24 frames/8s, 300ms–1.8s
long tasks). The reason it holds up: the expensive DEM-decode/RTIN-mesh-building
work happens inside a Web Worker, off the main thread — so no amount of tile
churn blocks rendering, unlike MapLibre's terrain pipeline, which does its costly
tile re-compositing on the main thread every dirty frame. This is the real,
load-bearing architectural difference the "Cesium's camera-flight-over-terrain is
closer to its core use case" reasoning above predicted.

**How this got tested — worth recording, since two real bugs had to be fixed first
and they're easy to hit again on a similar setup:**
1. `CESIUM_BASE_URL` (jsdelivr) and the esm.sh-served Cesium/cesium-martini modules
   worked fine, first try — not actually a problem in the end.
2. **The custom Terrarium-decode worker crashed on load with an opaque "worker
   error: undefined"** — root cause: it imported `rgbTerrainToGrid`/
   `createQuantizedMeshData` from the full `@macrostrat/cesium-martini` package,
   which transitively imports all of `cesium` — a browser 3D library that assumes
   `window`/`document` exist, which a Worker doesn't have. Fixed by inlining
   DOM-free ports of those two functions directly into the worker instead (both
   are pure math over typed arrays — no behavior change, just removed the
   unnecessary transitive Cesium import).
3. **The spike could not run at all when opened via `file://`** (double-clicking
   the file, same as every prior spike in this project) — Chrome refuses to
   instantiate a Blob-URL Worker when the parent page's origin is the unique,
   isolated `file://` origin. This is new: the MapLibre spikes never needed a
   custom Worker, so they never hit this. **This spike (and presumably any future
   one using a custom terrain-decode Worker) must be served over a real HTTP
   origin** — `python3 -m http.server` from `spikes/` and opening
   `http://localhost:<port>/phase1c-cesium-terrain-spike.html` worked. Once this
   was fixed, tiles started loading and decoding successfully immediately.

**Known loose end, not a blocker:** tile-fetch counts climbed very high and fast
during testing (~3000 successful tile fetches for one viewer within ~2 minutes of
a 14s looping animation, vastly more than the ~50–150 unique tiles Rattlesnake
Ledge's bbox should need across all zoom levels) — worth investigating whether
this is genuine cache churn (small default tile-cache size relative to how much
ground gets swept per loop, benign) or a real caching gap in how the hand-assembled
`MartiniTerrainProvider`/`DefaultHeightmapResource`/custom-decoder pieces report
tile availability back to Cesium's quadtree (wasteful, worth fixing). Explicitly
**not** blocking the go/no-go call above, since it demonstrably isn't costing
main-thread frame time either way — but worth fixing before this becomes the real
module, since redundant re-decoding is still real (background-thread) CPU/battery
cost even when invisible in the frame-rate numbers.

**Also not yet tuned:** the chase-camera (height/pitch/backward-offset) produces a
fairly flat, near-top-down look rather than a dramatic oblique terrain view —
cosmetic, expected ("camera is not final" per this doc's own convention), not
investigated further since it doesn't bear on the performance question.

**Next step per the plan:** design the standalone flyover module (generic inputs —
GPX track + bbox + target DOM element; no TLT/Supabase coupling) on top of Cesium,
with `HikeMap.jsx`/`HikeMapCard.jsx`'s existing UI shell (lightbox, gallery card,
`gpxUrl` fetch — all confirmed library-agnostic) as the first consumer. See
`/Users/scottbenedict/.claude/plans/joyful-churning-pascal.md`.

## Production module built — real bugs found integrating into the actual app (2026-09-11, later)

The module (`src/lib/terrainFlyover.js` + `terrainFlyoverProvider.js` +
`terrainFlyoverWorker.js`) got built per the plan, behind a `USE_TERRAIN_3D`
dev-only toggle in `HikeMap.jsx`/`HikeMapCard.jsx`. Getting it from "builds
cleanly" to "actually looks right in the real app" surfaced a chain of real,
independent bugs the standalone spike never exercised — worth recording in full
since several are easy to hit again on a similar setup:

1. **`vite-plugin-cesium` unconditionally injects a ~15MB `<script>` into every
   page's `<head>`**, regardless of the toggle — defeats the entire point of a
   toggle. Replaced with `vite-plugin-static-copy` (copies Cesium's static
   Workers/ThirdParty/Assets/Widgets only) + a real dynamic `import()` of
   `TerrainFlyover` at the call site, which lets Rollup fully eliminate the
   whole Cesium dependency from the bundle when the toggle is `false` (confirmed:
   main bundle is byte-identical to pre-3D-work size), and code-splits it into
   its own ~1.1MB chunk, fetched only when actually used, when `true`.
2. **`vite-plugin-static-copy` needs `rename: { stripBase: N }`** — its default
   behavior preserves the *entire* matched source path under `dest`, not just
   the part past the glob. Without it, static assets landed at paths like
   `cesium/Assets/node_modules/cesium/Build/Cesium/Assets/Images/ion-credit.png`
   instead of `cesium/Assets/Images/ion-credit.png` — silently 404ing (well,
   silently serving the SPA-fallback `index.html` instead, which is worse: a
   200 with the wrong content, which is what actually surfaced this).
3. **Chrome refuses a Blob-URL Worker when the page is `file://`** (already
   found in the spike phase) — resolved for the real app automatically, since
   `npm run dev`/production serve over real HTTP.
4. **The custom Terrarium-decode worker crashed** importing
   `rgbTerrainToGrid`/`createQuantizedMeshData` from `@macrostrat/cesium-martini`
   (drags in all of Cesium, which needs a DOM) — same fix as the spike, ported
   into the real `terrainFlyoverWorker.js`.
5. **Cesium's `widgets.css` was never loaded in the real app** (only in the
   spike, which sidestepped needing it by giving Cesium a container with its
   own explicit pixel dimensions). Without the rule `.cesium-widget canvas {
   width:100%; height:100% }`, Cesium's canvas silently falls back to the
   browser's default 300×150px size instead of filling its container —
   presented as "only fills part of the card/lightbox." Fixed with
   `import 'cesium/Build/Cesium/Widgets/widgets.css'` in `terrainFlyover.js`
   (dynamically loaded alongside the JS, same pattern as `leaflet/dist/leaflet.css`).
6. **Elevation-decode corruption**: some Terrarium tiles decode pixels to
   physically-impossible values (thousands of meters below sea level) — likely
   genuine SRTM no-data voids, possibly compounded by canvas 2D's
   `drawImage`+`getImageData` alpha-premultiplication distorting RGB at
   partially-transparent/edge pixels (a risk that direct WebGL texture upload,
   what MapLibre used, doesn't have). One such outlier skews that tile's
   computed min/max, which the rest of the tile's real elevation then gets
   height-quantized against — compressing real relief into a sliver of the
   encoding range, which looked exactly like "terrain is flat" even with the
   pipeline otherwise working. Fixed by clamping decoded values to a generous
   real-world range (-500m to 9000m) in `terrainFlyoverWorker.js`.
7. **The route line's "scribble" look**: it used the GPX file's own recorded
   elevation for 3D height. Consumer GPS elevation is much noisier than lat/lon
   — invisible in the 2D flyover (no vertical axis at all in a flat top-down
   view) but a direct visible zigzag once elevation becomes real 3D position.
   Fixed with `clampToGround: true` on the polyline (drapes onto the actual
   terrain surface instead).
8. **Camera jitter ("janky")**: the chase camera's heading came from
   `positionAt`'s per-segment bearing, which snaps abruptly at each of the
   ~400 decimated-track vertices — fine for the 2D flyover (never uses
   bearing), very visible here since heading directly drives camera position
   (via a fixed backward offset), and worse the farther back the camera sits
   (a heading snap sweeps proportionally more absolute distance at a larger
   radius — and the camera had just been pulled back from 110m to 300m to
   diagnose the flatness issue, compounding this). Fixed with a ~60m lookahead
   window for a smoothed bearing, computed in `terrainFlyover.js` only (2D
   flyover's `positionAt` usage untouched).
9. **No basemap/imagery at all, by design** (deliberate from the very first
   spike, to isolate the terrain-animation performance question) — but never
   clearly flagged as a known gap once this moved from "spike" to "does this
   look acceptable" territory, leading to justified "where's the detail/topo
   lines" feedback. Added the same OpenTopoMap raster tiles the 2D flyover
   already uses, draped on the 3D terrain via a real `Cesium.ImageryLayer`.
10. **LOD aggressiveness overcorrection**: partway through diagnosing the
    flatness (before the real cause — #6 — was found), `detailScalar` and
    `maximumScreenSpaceError` were both tuned more aggressive to force more
    geometry near the camera. That's the leading suspect for jank reported
    immediately after. Reverted both to library/Cesium defaults, trusting the
    #6 fix to carry the real "not flat" improvement — detail-vs-performance is
    still an open tuning question, not resolved by this revert, just no longer
    conflated with the flatness bug.

**Not yet re-verified with real numbers** (no browser access from this session
— every round so far has gone through the user manually reloading and
reporting back, which is slow and, understandably, wearing thin after this many
rounds): whether frame rate actually holds up with imagery + real terrain detail
+ smoothed camera all together. Added a temporary one-shot perf logger
(`TerrainFlyover._logPerfOnce`, same frames-per-8s/longtask methodology as the
spikes) that fires automatically on first `play()` — next test should surface a
real number in the console without needing separate instrumentation work.
