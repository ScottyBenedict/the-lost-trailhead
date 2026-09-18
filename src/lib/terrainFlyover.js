import * as Cesium from 'cesium';
// Never loaded in the app before now — only in the throwaway spike, which
// (unlike this component) passed Cesium a container with its own explicit
// pixel width/height rather than a CSS-positioned `inset:0` div. Without this,
// the specific rule `.cesium-widget canvas { width:100%; height:100% }` never
// applies, and Cesium's canvas silently falls back to the browser's default
// canvas size (300×150px) instead of filling its container — exactly the
// "only fills part of the frame" symptom. Same dynamic-import pattern already
// used for leaflet/dist/leaflet.css in HikeMap.jsx.
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './terrainFlyoverOverrides.css';
import { buildCumulative, flyoverDurationMs, positionAt, bearingBetween, haversineM } from './gpxFlyover';
import { createTerrariumTerrainProvider } from './terrainFlyoverProvider';

// findApexIndex's bestScore (below) doubles as out-and-back detection: it's
// the average GPS deviation between the outbound and return legs at the
// best-matching split point, so a real retrace scores low and a route that
// never truly retraces (a loop) scores high no matter which split point it
// picks. Verified against two real recordings before choosing this number:
// Rattlesnake Ledge (a genuine out-and-back) scores 12.2m; Maple Pass Loop
// (a genuine loop) scores 116.0m at its best candidate — nearly 10x worse,
// because there's nothing to actually match there. 40m sits with real
// margin on both sides of that gap.
const OUT_AND_BACK_MATCH_THRESHOLD_M = 40;

// How much each frame's camera aim target moves toward the hiker's real
// position — see applyFrame's comment. Lower = smoother/more lag, higher =
// snappier. Feedback on 0.05: "close, maybe needs a touch more smoothing."
// A separate, more heavily simplified camera track (decoupled entirely from
// the marker's exact path) was also tried — reverted: it could let the
// marker leave the visible frame entirely on steep terrain, since a modest
// lateral divergence there translates into a much larger effective
// vertical/depth displacement than flat ground, and a straightforward
// distance clamp on the divergence didn't fully close that out either.
// Simple time-based lag on the exact real position doesn't have that
// failure mode — this just leans further into it.
const TARGET_SMOOTHING = 0.03;

// For a simple out-and-back hike, the return leg retraces the outbound leg —
// drawing both draws two overlapping lines that look muddy, worst exactly
// where the up and down overlap. Explicit, repeated product direction: only
// the outbound leg gets drawn — an earlier attempt to draw both (to give the
// descent a visible line too) was explicitly rejected, so that tradeoff is
// not being revisited here. Split at the apex — the point *farthest from the
// start*, i.e. the real turnaround.
//
// Two earlier approaches — global "farthest point from start," and that same
// search narrowed to a window around the cumulative-distance midpoint — were
// both tested directly against this site's real Rattlesnake Ledge GPX
// (12,279 points) before writing this comment, and both land at the same
// wrong spot: 31% up the trail (elevation 489m), while the real high point
// (matching this hike's own displayed stats — 2,076 ft) is at 53% through
// (633m). "Farthest straight-line distance from the trailhead" is the wrong
// metric for a trail like this one: the route curves such that it's about as
// far from the trailhead at 31% through as it ever gets, then switchbacks
// carry it higher while looping back closer to the trailhead's coordinates.
//
// This instead finds where the outbound and return legs actually retrace each
// other: for a candidate split point, checking whether the point ~50-400m
// *before* it (still outbound) and ~50-400m *after* it (now on the return
// leg) land at nearly the same real-world spot — true only right at the real
// turnaround. Verified directly against the same real GPX before shipping:
// converges to within 12m of alignment at 52.4% through the track.
function findApexIndex(points, cum) {
  const n = points.length;
  const total = cum[n - 1];

  function idxAtDist(target) {
    let lo = 0, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < target) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  const offsetsM = [50, 100, 200, 400];
  const loSearch = Math.floor(n * 0.15);
  const hiSearch = Math.floor(n * 0.85);
  let bestScore = Infinity;
  let bestIdx = Math.floor(n / 2);

  for (let i = loSearch; i < hiSearch; i += 3) {
    let score = 0;
    let count = 0;
    for (const k of offsetsM) {
      const tb = cum[i] - k, ta = cum[i] + k;
      if (tb < 0 || ta > total) continue;
      const jb = idxAtDist(tb), ja = idxAtDist(ta);
      score += haversineM(points[jb], points[ja]);
      count++;
    }
    if (count === offsetsM.length) {
      score /= count;
      if (score < bestScore) { bestScore = score; bestIdx = i; }
    }
  }
  return { bestIdx, bestScore };
}

// Chase-cam distance/angle from the marker. Replaces an earlier hand-rolled
// implementation (a custom spherical-trig "compute a point behind, then set
// camera position+orientation to look toward it" — two independent
// computations that had to agree with each other) with Cesium's own
// camera.lookAt(target, HeadingPitchRange) in applyFrame below — the standard,
// tested Cesium primitive for exactly this "camera locked on a moving target"
// pattern, used instead of trusting a second custom implementation to be
// correct. `range` is straight-line distance from camera to target (replaces
// the old separate camBackM/camHeightM decomposition — lookAt only needs one).
//
// A 13m/-70° attempt at "close, low, over the hiker's head" broke on two
// real technical limits, not just a bad number: (1) the terrain/imagery data
// here is built from tiles capped at roughly 3-5m/pixel resolution (confirmed
// earlier in this project — Terrarium DEM caps at zoom 15) — perfectly sharp
// from hundreds of meters out, visibly blurry once magnified by viewing from
// only 13m away, a data ceiling no camera setting can fix; (2) the same
// real-world hiking pace reads as dramatically faster the closer the camera
// sits, since nearby terrain sweeps through frame much faster than distant
// terrain does at identical real speed — hence "everything is blurry" and
// "super fast" together. Neither extreme (900m distant-aerial, 13m
// close-and-broken) is the actual target: a wide cinematic tracking shot —
// elevated and offset to the side rather than overhead, showing the hiker,
// the drawn GPX line, and real surrounding terrain together, comfortably
// inside the resolution/speed limits above. 220m, then 340m, at a shallow
// -22° pitch still didn't read as "surrounding terrain as a whole" — a
// shallow pitch looks nearly sideways across the terrain, so the frame is
// mostly filled by whatever slope is directly ahead rather than the valley
// and ridgelines around it. -34° looks down over more of the landscape
// (paired with the wider FOV set on the camera below) while staying short
// of a top-down aerial that would lose the "ride-along with the hiker" feel.
const DEFAULT_CAMERA = { range: 750, pitchDeg: -34, sideOffsetDeg: 75 };

// Fits a Catmull-Rom spline through `t` (0..1) between p1 and p2, using p0/p3
// as the neighboring control points that shape the curve's tangents there.
function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (
    2 * p1 +
    (p2 - p0) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (3 * p1 - p0 - 3 * p2 + p3) * t3
  );
}

// gpxFlyover.js's decimate() picks waypoints evenly by *array index* — fine
// when recording density is roughly constant, but real hiking pace varies a
// lot (faster on flat/easy stretches, slower climbing or picking through a
// technical section), and this GPX logs at a roughly constant *time*
// interval, not distance. So index-based decimation gives noticeably uneven
// real-world spacing: verified directly against this site's real Rattlesnake
// Ledge GPX, several waypoint gaps clustered right near the end of the
// descent were 90-108m apart (vs. a ~43m average elsewhere) — plenty of room
// for a spline to visibly cut across real terrain instead of following the
// trail through that stretch, which is exactly what "jumps off the path"
// looks like. Decimating by real distance instead keeps spacing uniform
// (same real data: worst case drops to ~54m, and every gap lands within a
// couple meters of the target) regardless of how fast the recording moved
// through any given stretch.
function decimateByDistance(points, targetSpacingM) {
  const out = [points[0]];
  let lastEmitted = points[0];
  for (let i = 1; i < points.length; i++) {
    if (haversineM(lastEmitted, points[i]) >= targetSpacingM) {
      out.push(points[i]);
      lastEmitted = points[i];
    }
  }
  if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
  return out;
}

// Turns a raw, jittery GPS recording into a deliberately flowing curve: the
// point of this feature is a visual recreation of the hike, not a pixel-exact
// GPS trace (explicit product direction, following several rounds of trying
// to reactively filter noise out of the raw track instead of just replacing
// it with a real curve). Reduces to a small number of evenly-spaced-by-
// distance key waypoints first, then fits a Catmull-Rom spline through them
// and densely re-samples it — used for both the drawn line and the camera/
// marker path (a prior version used different point sets for each, which is
// exactly how "the camera isn't following the same route as the line"
// happens; building both from the same spline makes that impossible by
// construction).
function buildFlowingPath(points, { waypointCount = 80, samplesPerSegment = 12 } = {}) {
  const cum = buildCumulative(points);
  const targetSpacingM = cum[cum.length - 1] / Math.max(1, Math.min(waypointCount, points.length) - 1);
  const waypoints = decimateByDistance(points, targetSpacingM);
  const n = waypoints.length;
  if (n < 4) return waypoints;

  const out = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = waypoints[Math.max(0, i - 1)];
    const p1 = waypoints[i];
    const p2 = waypoints[i + 1];
    const p3 = waypoints[Math.min(n - 1, i + 2)];
    const steps = i === n - 2 ? samplesPerSegment + 1 : samplesPerSegment; // include the final point exactly once
    for (let s = 0; s < steps; s++) {
      const t = s / samplesPerSegment;
      out.push({
        lat: catmullRom(p0.lat, p1.lat, p2.lat, p3.lat, t),
        lon: catmullRom(p0.lon, p1.lon, p2.lon, p3.lon, t),
        ele: catmullRom(p0.ele ?? 0, p1.ele ?? 0, p2.ele ?? 0, p3.ele ?? 0, t),
      });
    }
  }
  return deloop(out);
}

// Catmull-Rom can overshoot into a small self-crossing loop where the real
// trail turns sharply relative to how far apart its anchors landed (verified
// directly against Rattlesnake Ledge's real GPX — confirmed present even
// fit in a single pass straight off raw points, and confirmed absent from
// the raw recording itself, so this is the curve fit's own artifact, not
// real trail shape or GPS noise). Neither reparameterizing the spline
// (tried: centripetal Catmull-Rom) nor limiting tangent magnitude at sharp
// turns meaningfully reduced it — whatever specific 3-4 real anchors cause
// this, a smooth curve through them loops regardless of those adjustments.
// This instead finds any place the finished curve crosses back near itself
// and replaces just that stretch with a straight line between its two
// endpoints — a straight segment between two points can't loop by
// construction, so this guarantees the result regardless of why the spline
// misbehaved at that specific spot, on this hike or any other.
function deloop(curve, { minGapM = 20, maxGapM = 200, closeM = 8 } = {}) {
  const cum = buildCumulative(curve);
  const crossings = [];
  for (let i = 0; i < curve.length; i++) {
    for (let j = i + 1; j < curve.length; j++) {
      const gap = cum[j] - cum[i];
      if (gap < minGapM) continue;
      if (gap > maxGapM) break;
      if (haversineM(curve[i], curve[j]) < closeM) crossings.push([i, j]);
    }
  }
  if (!crossings.length) return curve;

  // Adjacent/overlapping crossing pairs describe the same loop — merge them
  // into one repair span per real loop rather than patching piecemeal.
  crossings.sort((a, b) => a[0] - b[0]);
  const spans = [];
  let [spanStart, spanEnd] = crossings[0];
  for (const [i, j] of crossings.slice(1)) {
    if (i <= spanEnd) spanEnd = Math.max(spanEnd, j);
    else { spans.push([spanStart, spanEnd]); [spanStart, spanEnd] = [i, j]; }
  }
  spans.push([spanStart, spanEnd]);

  const out = curve.slice();
  for (const [i, j] of spans) {
    const a = curve[i], b = curve[j];
    for (let k = i; k <= j; k++) {
      const t = (k - i) / (j - i);
      out[k] = {
        lat: a.lat + (b.lat - a.lat) * t,
        lon: a.lon + (b.lon - a.lon) * t,
        ele: (a.ele ?? 0) + ((b.ele ?? 0) - (a.ele ?? 0)) * t,
      };
    }
  }
  return out;
}

// Renders a 3D terrain flyover into `containerEl` for the given already-parsed
// (and ideally already-decimated) GPX `points`. Deliberately takes points, not a
// GPX URL — stays agnostic of Supabase/fetching, which the caller (HikeMap.jsx /
// HikeMapCard.jsx) already owns.
export class TerrainFlyover {
  constructor(containerEl, { points, onProgress, onFinish, camera, durationMs, topDownPreview } = {}) {
    if (!points || points.length < 2) throw new Error('TerrainFlyover requires at least 2 points');

    // Apex-finding needs the real, unsmoothed recording (findApexIndex's own
    // comment covers why) — done on full-resolution `points`, the real
    // recording. bestScore also decides whether this hike is an out-and-back
    // at all — see OUT_AND_BACK_MATCH_THRESHOLD_M above.
    const fullCum = buildCumulative(points);
    const { bestIdx: rawApexIdx, bestScore: apexScore } = findApexIndex(points, fullCum);
    this.isOutAndBack = apexScore <= OUT_AND_BACK_MATCH_THRESHOLD_M;

    if (this.isOutAndBack) {
      // The descent retraces the exact same physical trail as the ascent — so
      // rather than build the flowing path from the return leg's own separately
      // recorded GPS (which can drift for reasons that have nothing to do with
      // processing quality: tree cover, canyon walls, cliff faces near a
      // "ledge" summit all degrade GPS accuracy in their own ways, and the
      // return recording is a completely independent set of samples from the
      // outbound one), the outbound leg's already-verified flowing path is
      // simply walked forward then backward. This doesn't approximate "the
      // descent follows the same trail as the ascent" — it makes that
      // guaranteed and exact, the same way slicing the line from this same
      // array (below) guarantees the line and the marker agree.
      const outboundRawPoints = points.slice(0, rawApexIdx + 1);
      // waypointCount is the actual smoothing knob here, not samplesPerSegment
      // (which only controls how densely an already-fit curve is resampled for
      // animation, not how tightly that curve follows the real GPS points).
      // More waypoints means the Catmull-Rom spline is anchored to more of the
      // real recording, so it rounds off less of the actual trail shape —
      // bumped from 160 to 240, to 320, then to 368 (2026-09-17, +15% per
      // direct feedback), across three rounds of feedback that the flowing
      // path still felt a touch too smooth relative to the real route.
      const outboundFlowing = buildFlowingPath(outboundRawPoints, { waypointCount: 368, samplesPerSegment: 12 });
      this.cameraPoints = [...outboundFlowing, ...outboundFlowing.slice(0, -1).reverse()];
      this.apexIdx = outboundFlowing.length - 1;
    } else {
      // A loop never truly retraces itself, so there's nothing to collapse
      // or mirror — per docs/roadmap-3d-flyover.md Decision 5, the full
      // recorded route is drawn once and flown once, start to end. The line-
      // draw and marker-placement code below both key off `apexIdx` as "the
      // last index of what gets drawn/flown," which for a loop is simply the
      // whole array — no separate branch needed past this point.
      this.cameraPoints = buildFlowingPath(points, { waypointCount: 368, samplesPerSegment: 12 });
      this.apexIdx = this.cameraPoints.length - 1;
    }
    this.cum = buildCumulative(this.cameraPoints);
    this.total = this.cum[this.cum.length - 1];

    // ONE fixed camera bearing for the entire flight, computed once, here —
    // not per-leg, and not recomputed from wherever the hiker currently is.
    // An earlier version used two fixed bearings (one per leg, flipping at
    // the turnaround) on the reasoning that the camera should stay "9
    // o'clock relative to the direction of travel" — but the direction of
    // travel is exactly the thing that reverses at the turnaround, by
    // definition, so tying the camera to it at all guarantees a rotation
    // there regardless of how that reference is computed. The camera doesn't
    // need to care which way the hiker is currently walking — it just needs
    // to sit on one consistent side of the route. The hiker simply reverses
    // direction across the frame during the descent instead (the same way a
    // camera filming a car driving out and back on the same road wouldn't
    // flip sides when the car turns around). Zero rotation anywhere, not
    // just a smaller one at the summit.
    //
    // For an out-and-back this points at the real turnaround (apexIdx). A
    // loop has no turnaround — this instead points at the "far side" of the
    // loop (the point half the total distance in), a first attempt at the
    // same "camera sits on one consistent side" idea, not yet visually
    // confirmed against real playback the way the out-and-back bearing was.
    // Maple Pass Loop is the actual test of whether this reads correctly —
    // treat this as a starting point, not a tuned final value.
    const bearingTargetIdx = this.isOutAndBack
      ? this.apexIdx
      : this.cum.findIndex((d) => d >= this.total / 2);
    this.fixedBearing = bearingBetween(this.cameraPoints[0], this.cameraPoints[bearingTargetIdx]);
    // Explicit `durationMs` overrides the length-derived default — HikeMapCard.jsx's
    // ambient preview intentionally uses a fixed duration regardless of hike length.
    this.durationMs = durationMs ?? flyoverDurationMs(this.total);
    this.onProgress = onProgress;
    this.onFinish = onFinish;
    this.camera = { ...DEFAULT_CAMERA, ...camera };

    this.flying = false;
    this.frac = 0;
    this.rafId = null;
    this.sessionStart = null;
    this.destroyed = false;
    this.posHint = { i: 1 };
    this.smoothedTarget = null; // camera aim target — see applyFrame

    // Switched from OpenTopoMap (still used by the 2D flyover) to satellite
    // imagery — OpenTopoMap draws its own cartographic hiking-trail line
    // baked directly into the raster tile pixels (sourced from OSM, not from
    // any specific recorded hike), which routinely doesn't line up with where
    // a real GPS recording actually went. That's not fixable by hiding a
    // layer — it's a raster image, not a vector style; there's no separate
    // "trail line" layer to toggle off. Satellite imagery is real ground
    // photography with no drawn trail overlay of any kind, so there's nothing
    // for our own route to visually conflict with.
    const baseImagery = new Cesium.ImageryLayer(
      new Cesium.UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        credit: 'Esri, Maxar, Earthstar Geographics',
        maximumLevel: 19,
      })
    );

    this.viewer = new Cesium.Viewer(containerEl, {
      terrainProvider: createTerrariumTerrainProvider(),
      baseLayer: baseImagery,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      shouldAnimate: false,
    });
    this.viewer.scene.globe.enableLighting = true;
    this.viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#8a9a78');
    // Left at Cesium's own default (2) rather than the more aggressive 1 tried
    // earlier — that was forcing noticeably more detail/geometry per frame,
    // which is real suspect #1 for the jank reported once it was in place. The
    // earlier "flat"-looking terrain is more likely explained by the elevation-
    // decode clamping fix (terrainFlyoverWorker.js) than by needing forced
    // extra LOD refinement — revisit detail-vs-performance balance with real
    // frame-rate numbers once this baseline is confirmed working.
    this.viewer.scene.skyAtmosphere.show = false;
    this.viewer.scene.fog.enabled = false;
    // Without this, Cesium's default starfield skybox shows above the horizon
    // as a black band whenever the camera pitch is shallow enough to see sky —
    // only noticeable once the pitch stopped being steep/top-down enough to hide
    // it. backgroundColor stands in for it instead.
    this.viewer.scene.skyBox.show = false;
    this.viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#cfe0e8');
    // Cesium's built-in camera controller actively prevents the camera from
    // going below/through the terrain surface, correcting it back up when it
    // thinks that's happening — meant for mouse/touch navigation, but it fights
    // a fully scripted camera exactly like this one, since every applyFrame()
    // call is an external "move" it may react to. Only became visible as
    // "shaking" once real terrain relief started rendering (previously-flat
    // terrain never triggered it). Not needed here — nothing uses mouse/touch
    // camera controls at all — so disabled outright rather than tuned around.
    this.viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;
    // The camera is fully scripted (every frame sets an explicit position) —
    // unlike the 2D Leaflet flyover, where the camera never moves at all so
    // user pan/zoom never conflicts with anything, a *moving* scripted camera
    // and live mouse/touch input can't coexist without fighting each other.
    // Also fixes a real bug on its own: without this, the small ambient card
    // was fully mouse-draggable (unlike its Leaflet equivalent, which disables
    // dragging/zoom/etc. entirely), silently reorienting the camera away from
    // the intended chase view before the card's onClick even opens the lightbox.
    this.viewer.scene.screenSpaceCameraController.enableInputs = false;
    // Cesium's default lens (~60deg vertical FOV) is too narrow to read as
    // "surrounding terrain as a whole" no matter how far back `range` pulls —
    // at a fixed narrow FOV, more distance just shrinks the hiker without
    // meaningfully widening what's actually visible around them. A wider lens
    // (closer to what aerial/drone tracking cinematography actually uses) is
    // the real way to fit a nearby subject and a broad landscape in the same
    // frame, so this is set once here rather than solved via `range` alone.
    this.viewer.camera.frustum.fov = Cesium.Math.toRadians(84);

    // The top-down preview's fit is computed by hand rather than handed to
    // Cesium's own `camera.setView({ destination: Rectangle })` — that helper
    // computes its fit distance against the flat WGS84 ellipsoid, with no
    // awareness of actual terrain height. Verified directly against this
    // site's real Rattlesnake Ledge GPX: the route's real bounding box (not a
    // bug — the dangling segment on the left really is part of the outbound
    // leg, confirmed by comparing it to the raw track's own full extent)
    // combined with a summit around 630m above sea level meant the real
    // ground was consistently hundreds of meters closer to the camera than
    // the ellipsoid-based fit assumed, so less of the intended area than
    // expected was actually visible at the true (elevated) surface — the
    // repeated clipping, even after two rounds of chasing an aspect-ratio
    // timing bug that turned out to be a real but secondary issue.
    const topDownExtent = topDownPreview
      ? (() => {
          const lons = this.cameraPoints.map((p) => p.lon);
          const lats = this.cameraPoints.map((p) => p.lat);
          const minLon = Math.min(...lons), maxLon = Math.max(...lons);
          const minLat = Math.min(...lats), maxLat = Math.max(...lats);
          const centerLon = (minLon + maxLon) / 2;
          const centerLat = (minLat + maxLat) / 2;
          // Padding so the route doesn't touch the frame edges — proportional
          // to the route's own extent, with a small absolute floor for a very
          // short or narrow track. Brought down twice now (0.2, then 0.1) per
          // feedback that the route still read as small/lost in the frame.
          const lonPad = Math.max((maxLon - minLon) * 0.04, 0.002);
          const latPad = Math.max((maxLat - minLat) * 0.04, 0.002);
          const metersPerDegLat = 111320;
          const metersPerDegLon = metersPerDegLat * Math.cos((centerLat * Math.PI) / 180);
          const halfWidthM = ((maxLon - minLon) / 2 + lonPad) * metersPerDegLon;
          const halfHeightM = ((maxLat - minLat) / 2 + latPad) * metersPerDegLat;
          // The highest point actually needs to clear the camera by the full
          // computed distance for the fit to hold — using the route's own max
          // recorded elevation as the ground reference (rather than sea level,
          // or a live terrain-height lookup that isn't available pre-load)
          // means every lower point on the route ends up with *more* real
          // clearance than that, never less.
          const maxEle = Math.max(0, ...points.map((p) => p.ele ?? 0));
          return { centerLon, centerLat, halfWidthM, halfHeightM, maxEle };
        })()
      : null;
    const applyTopDownView = () => {
      if (this.destroyed || !topDownExtent) return;
      this.viewer.camera.frustum.aspectRatio = containerEl.clientWidth / containerEl.clientHeight;
      // `.fov` is Cesium's horizontal angle whenever aspectRatio > 1
      // (landscape — true for both this card and the lightbox), with `.fovy`
      // the derived vertical angle; using both (rather than assuming a square
      // frustum) is what makes this correct for any container shape.
      const fovX = this.viewer.camera.frustum.fov;
      const fovY = this.viewer.camera.frustum.fovy;
      const { centerLon, centerLat, halfWidthM, halfHeightM, maxEle } = topDownExtent;
      const distForHeight = halfHeightM / Math.tan(fovY / 2);
      const distForWidth = halfWidthM / Math.tan(fovX / 2);
      const clearance = Math.max(distForHeight, distForWidth);
      this.viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(centerLon, centerLat, maxEle + clearance),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
      });
    };

    // Cesium sizes its canvas from the container's dimensions at construction
    // time and only re-checks on a window resize event — if containerEl's own
    // size isn't final yet (e.g. a lightbox modal still animating open), the
    // canvas ends up wrong-sized with no window resize ever firing to correct
    // it, rendering into only part of the visible frame. Same underlying issue
    // HikeMapCard.jsx already works around for Leaflet with a delayed
    // map.invalidateSize() — this is Cesium's equivalent.
    setTimeout(() => {
      if (this.destroyed) return;
      this.viewer.resize();
      applyTopDownView();
    }, 100);

    // The card this preview lives in sits in a masonry/grid gallery that can
    // keep reflowing after that single delayed resize — sibling photos or
    // cards loading, fonts swapping in, etc. — so a one-shot timeout isn't
    // reliable for a tight top-down fit the way it is for the oblique
    // chase-cam view (a stale aspect ratio there just shifts the framing
    // slightly; here it directly clips part of the route out of frame).
    // Re-fitting on every real size change, for as long as this instance is
    // alive, is what actually guarantees the whole route stays in view.
    if (topDownExtent) {
      this.topDownResizeObserver = new ResizeObserver(() => {
        this.viewer.resize();
        applyTopDownView();
      });
      this.topDownResizeObserver.observe(containerEl);
    }

    // Static route line — built once, never touched per frame (same "draw once"
    // pattern as the base line in the 2D flyover / HikeMap.jsx).
    //
    // Out-and-back: only the outbound leg (start → apex) is drawn, per
    // explicit, repeated product direction. Loop: apexIdx is the whole
    // array, so this slice is the entire route. Either way it's a literal
    // slice of this.cameraPoints, the exact same array the marker/camera
    // animate along for the entire flight (for an out-and-back, including
    // the return leg, which continues along past this slice). This is what
    // actually guarantees the line and the marker agree over the portion
    // covered: not two curves independently built to look similar, one
    // array sliced in place.
    //
    // clampToGround: true, using only lon/lat (no GPX `ele`) — a raw GPS
    // elevation stream is much noisier than its lat/lon, which is invisible in
    // the 2D flyover's flat top-down view (no Z-axis at all) but shows up as a
    // visible zigzag/"scribble" along the line once elevation becomes actual
    // vertical position in 3D. Draping onto the real terrain surface instead
    // fixes that and also avoids the line floating above/sinking below the
    // rendered terrain wherever GPS elevation and DEM elevation disagree (a
    // known, common mismatch between the two).
    const linePositions = this.cameraPoints.slice(0, this.apexIdx + 1).map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat));
    this.viewer.entities.add({
      polyline: {
        positions: linePositions,
        width: 4,
        // A plain white line loses contrast — and reads as visually thinner
        // or broken — over whatever happens to be underneath it: dark forest
        // shadow, a lake, a lighter dirt patch. PolylineOutlineMaterialProperty
        // adds a dark outline around the white fill so the line stays legible
        // against any terrain/imagery color, not just the ones it happened to
        // look fine against before.
        material: new Cesium.PolylineOutlineMaterialProperty({
          color: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
          outlineWidth: 2,
        }),
        clampToGround: true,
      },
    });

    // heightReference: RELATIVE_TO_GROUND makes Cesium clamp this point to the
    // terrain itself (offsetting the position's height above that clamp) —
    // the same underlying ground-clamping mechanism the line's own
    // clampToGround uses. Previously the marker's height came from this
    // file's own scene.globe.getHeight() sampling (with its own EMA
    // smoothing) while the line's came from Cesium's separate internal
    // ground-clamp — two different "ground" values for the same real spot,
    // which is a small vertical gap in 3D, but a real, visible on-screen
    // offset once projected through a steep, oblique camera angle. Sharing
    // the one mechanism both use removes the possibility of them disagreeing.
    //
    // The top-down static preview shows no animation, so a single "hiker"
    // dot (always sitting at the trailhead, since it's never advanced by
    // applyFrame) reads as an unexplained dot rather than a route map's usual
    // start/end markers. That case gets its own pair of static entities
    // instead — the animated lightbox flyover keeps just the one traveling
    // marker, since it's the hiker there, not a map legend.
    // disableDepthTestDistance: a point clamped via RELATIVE_TO_GROUND gets
    // its height from whatever terrain LOD happens to be loaded at the
    // moment Cesium computes it — at a sharp peak, a finer-detail tile
    // streaming in shortly after can resolve to genuinely taller terrain
    // right at that spot than the point was clamped against, leaving the
    // marker sitting just inside the mountain and hidden behind it (seen on
    // the end/apex marker specifically, since summits are exactly where this
    // LOD mismatch is largest — flatter ground barely moves between LODs).
    // These are informational map pins, not physical objects, so always
    // rendering on top regardless of depth is the correct fix, not just a
    // workaround: Infinity here means "never depth-test against the scene."
    const GREEN = Cesium.Color.fromCssColorString('#4CAF50');
    const RED = Cesium.Color.fromCssColorString('#C0392B');
    const pinPoint = (color, outlineColor = Cesium.Color.WHITE) => ({
      pixelSize: 11,
      color,
      outlineColor,
      outlineWidth: 2,
      heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
    if (topDownPreview) {
      if (this.isOutAndBack) {
        // Start and the real turnaround/summit are genuinely different
        // places — two full pins, one at each.
        const endPoint = this.cameraPoints[this.apexIdx];
        this.viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(points[0].lon, points[0].lat, 3),
          point: pinPoint(GREEN),
        });
        this.viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(endPoint.lon, endPoint.lat, 3),
          point: pinPoint(RED),
        });
      } else {
        // A loop starts and finishes at the same physical spot (measured on
        // Maple Pass Loop's real GPX: ~1m apart) — two full pins there just
        // render on top of each other, which read as "the other one is
        // missing," not as "this is a loop." One pin instead, green fill
        // (start) with a red outline (also the finish) — delineates both
        // without implying two different locations that don't exist.
        this.viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(points[0].lon, points[0].lat, 3),
          point: pinPoint(GREEN, RED),
        });
      }
    } else {
      this.marker = this.viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(points[0].lon, points[0].lat, 3),
        point: { ...pinPoint(Cesium.Color.ORANGE), pixelSize: 10 },
      });
    }

    // The ambient card preview (HikeMapCard.jsx) wants a true top-down "plan"
    // view of the whole route, not a still of the cinematic chase-cam's first
    // frame — a different job from the lightbox's animated flyover, which
    // still opens on that oblique frame via applyFrame(0) below. This first
    // pass uses whatever canvas size exists right now (may not be final yet —
    // see the resize timeout above, which re-fits this same extent once it
    // is), so the card doesn't sit on a default/blank globe view for the 100ms
    // until that correction lands.
    if (topDownExtent) {
      applyTopDownView();
    } else {
      this.applyFrame(0);
    }
  }

  // Real rendered terrain height at (lat,lon) from whatever's currently loaded
  // (scene.globe.getHeight is a synchronous lookup against in-memory tile
  // data already on screen — no network request, safe to call every frame),
  // falling back to the GPX's own recorded elevation only if that spot's
  // terrain hasn't loaded yet. GPS elevation and DEM elevation routinely
  // disagree (a known mismatch, noted elsewhere in this file/roadmap) — using
  // the real rendered height keeps the marker sitting on the visible ground
  // and keeps the chase camera's distance meaningful relative to what's
  // actually on screen, instead of an independent, possibly-off number.
  //
  // Exponentially smoothed rather than used raw: a higher-detail terrain tile
  // routinely replaces a coarser one mid-flight (this hike's terrain streams
  // continuously — see the tile-fetch counts in docs/roadmap-3d-flyover.md),
  // and each replacement can report a measurably different height at the same
  // lat/lon. Fed straight into the camera/marker position, every such swap
  // visibly popped — smoothing damps that out while still tracking the real
  // elevation trend as the camera actually moves along the trail.
  groundHeightAt(lat, lon, fallbackEle) {
    const raw = this.viewer.scene.globe.getHeight(Cesium.Cartographic.fromDegrees(lon, lat)) ?? fallbackEle ?? 0;
    if (this.smoothedGroundHeight == null) this.smoothedGroundHeight = raw;
    // Damped more heavily than the original pass at this (was 0.15) — pulling
    // the camera in much closer (DEFAULT_CAMERA above) makes the same absolute
    // amount of height popping proportionally far more visible, so this needs
    // to track the real elevation trend more slowly / lag a bit more in
    // exchange for actually looking smooth.
    else this.smoothedGroundHeight += (raw - this.smoothedGroundHeight) * 0.06;
    return this.smoothedGroundHeight;
  }

  applyFrame(frac) {
    this.frac = frac;
    const pos = positionAt(this.cameraPoints, this.cum, this.total, frac, this.posHint);

    // Camera heading = this.fixedBearing (see the constructor) rotated by
    // sideOffsetDeg — constant for the entire flight, both legs. No per-frame
    // computation, no smoothing state, nothing to reset on restart/scrub:
    // there's nothing left to smooth once the value it would be smoothing
    // toward never changes in the first place.
    const bearing = (this.fixedBearing + this.camera.sideOffsetDeg + 360) % 360;

    // Marker sits at the hiker's real, current position — always.
    this.marker.position = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, 3);

    // Tried aiming a fixed real distance ahead on the path instead of at the
    // exact current position (a "look through the curve" attempt at fixing
    // dead-center-lock jank) — made it worse: a raw, still-unsmoothed point
    // further down the path swings through switchbacks just as hard as the
    // current position does, sometimes harder, so nothing was actually
    // smoothed, only relocated. Reverted.
    //
    // The real problem: camera.lookAt recomputes the camera's entire
    // position from scratch every frame from wherever the target currently
    // is — with zero memory of previous frames, so the camera reproduces the
    // trail's own curvature exactly, switchbacks included, however sharp
    // they are. Feedback ("skippy on direction/elevation changes") confirms
    // this reads as skippy even though each individual frame is technically
    // correct.
    //
    // Fix: exponentially smooth the *aim target* toward the hiker's real
    // position over time, instead of snapping to it — same technique
    // groundHeightAt below already uses for height, now applied to lat/lon
    // too. The marker itself is unaffected (still pinned to the real
    // position above); only what the camera chases gets damped, so sharp
    // path curvature arrives at the camera as a smooth glide instead of an
    // instant re-aim. TARGET_SMOOTHING is a first cut — lower = smoother/
    // more lag behind the marker, higher = snappier/closer to the raw path.
    if (this.smoothedTarget == null) {
      this.smoothedTarget = { lat: pos.lat, lon: pos.lon };
    } else {
      this.smoothedTarget.lat += (pos.lat - this.smoothedTarget.lat) * TARGET_SMOOTHING;
      this.smoothedTarget.lon += (pos.lon - this.smoothedTarget.lon) * TARGET_SMOOTHING;
    }

    // Camera target height: this file's own smoothed groundHeightAt (needs a
    // concrete absolute height — lookAt isn't an Entity, it has no
    // heightReference to lean on), sampled at the already-smoothed lat/lon.
    const groundHeight = this.groundHeightAt(this.smoothedTarget.lat, this.smoothedTarget.lon, pos.ele);
    const targetPos = Cesium.Cartesian3.fromDegrees(this.smoothedTarget.lon, this.smoothedTarget.lat, groundHeight + 3);

    // camera.lookAt(target, HeadingPitchRange) positions the camera at the
    // given heading/pitch/range *from* target and points it at target — the
    // camera's actual world position is computed entirely by Cesium, not by
    // this code, which is the point (see DEFAULT_CAMERA's comment).
    this.viewer.camera.lookAt(
      targetPos,
      new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(bearing),
        Cesium.Math.toRadians(this.camera.pitchDeg),
        this.camera.range
      )
    );

    this.onProgress?.({ frac, lat: pos.lat, lon: pos.lon, ele: pos.ele, distM: frac * this.total });
  }

  _loop = () => {
    if (!this.flying) return;
    const elapsed = performance.now() - this.sessionStart;
    if (elapsed >= this.durationMs) {
      this.flying = false;
      this.applyFrame(1);
      this.onFinish?.();
      return;
    }
    this.applyFrame(elapsed / this.durationMs);
    this.rafId = requestAnimationFrame(this._loop);
  };

  play() {
    if (this.destroyed || this.flying) return;
    if (this.frac >= 1) this.frac = 0;
    this.flying = true;
    this.sessionStart = performance.now() - this.frac * this.durationMs;
    this.rafId = requestAnimationFrame(this._loop);
    this._logPerfOnce();
  }

  // TEMPORARY — same frames-per-8s/longtask methodology used throughout this
  // project's spikes, so numbers compare directly. Logs once per play() call,
  // not continuously; remove once detail-vs-performance is settled for real.
  _logPerfOnce() {
    if (this._perfLogged) return;
    this._perfLogged = true;
    let frames = 0;
    const longtasks = [];
    let obs;
    try {
      obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) longtasks.push(Math.round(e.duration));
      });
      obs.observe({ entryTypes: ['longtask'] });
    } catch { /* unsupported — frame count alone still logs below */ }
    const start = performance.now();
    const durationMs = 8000;
    const count = () => {
      if (this.destroyed) { obs?.disconnect(); return; }
      frames++;
      if (performance.now() - start < durationMs) {
        requestAnimationFrame(count);
      } else {
        obs?.disconnect();
        const worst = longtasks.length ? Math.max(...longtasks) : 0;
        console.log(`[terrainFlyover] perf: ${frames} frames / 8s — ${longtasks.length} longtasks (worst ${worst}ms)`);
      }
    };
    requestAnimationFrame(count);
  }

  pause() {
    this.flying = false;
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  restart() {
    this.pause();
    this.posHint.i = 1;
    this.smoothedGroundHeight = null; // jumping to a new track position shouldn't glide from the old one's height
    this.smoothedTarget = null; // same reasoning — snap the camera aim, don't glide it in from the previous run's end point
    this.applyFrame(0);
    this.play();
  }

  scrubTo(frac) {
    this.pause();
    this.posHint.i = 1; // scrubbing can jump backward; reset rather than risk a stale search start
    this.smoothedGroundHeight = null;
    this.smoothedTarget = null;
    this.applyFrame(Math.min(1, Math.max(0, frac)));
  }

  destroy() {
    this.destroyed = true;
    this.pause();
    this.topDownResizeObserver?.disconnect();
    if (!this.viewer.isDestroyed()) this.viewer.destroy();
  }
}
