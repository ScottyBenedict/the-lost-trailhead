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
import { createTerrainTrail, CASING as TRAIL_CASING } from './trailPolyline';

// findApexIndex's bestScore (below) doubles as out-and-back detection: it's
// the average GPS deviation between the outbound and return legs at the
// best-matching split point, so a real retrace scores low and a route that
// never truly retraces (a loop) scores high no matter which split point it
// picks. Originally set at 40 from two data points (Rattlesnake Ledge 12.2m,
// Maple Pass Loop 116.0m) — raised to 70 (2026-09-17) once the site-wide
// rollout turned up a third: Colchuck Lake, a real out-and-back (start/end
// GPS points only 2.5m apart) scoring 62.3m, past the old threshold —
// misclassified as a loop, which drew its full round trip as one line
// instead of just the outbound leg, muddying the overlap exactly the way
// out-and-back handling exists to avoid. 70 still leaves real margin below
// Maple's 116.0.
const OUT_AND_BACK_MATCH_THRESHOLD_M = 70;

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

// Trailing ("drone following behind") camera — opt-in per hike via
// `camera: { trailing: { range, pitchDeg, descentPitchDeg } }`, under test on Cascade Pass
// only (see HikeMap.jsx). Deliberately re-ties the camera to direction of
// travel, which the fixed bearing above exists to avoid.
//
// Unlike the default camera, nothing here chases the hiker frame by frame.
// Playback is fully deterministic (known path, known duration), so the whole
// camera track — aim point and heading — is computed once up front with
// *centered* smoothing, which looks as far ahead as behind: no lag behind the
// hiker, and no lurch at switchback corners. (A per-frame exponential chase
// like TARGET_SMOOTHING both lags and changes its acceleration abruptly
// wherever the hiker turns a corner, which reads as a small hitch at each
// switchback.) Values tuned offline against Cascade Pass's real GPX and the
// real Terrarium DEM, measuring on-screen motion rather than judging by eye:
//
// targetSigmaS — seconds of flight the aim point is averaged over.
// headingSigmaM — meters of trail the direction of travel is averaged over.
//   Averaging *positions* (not a chord between two points) is what survives
//   switchback stacks: kilometers of zigzag cover only a few hundred meters
//   of real progress, so a chord's endpoints land at arbitrary points in the
//   zigzag (up to 146°/s of turning on Cascade even with a 3km window).
// headingSigmaS — seconds the resulting heading is then eased over.
// orbitS — an out-and-back reverses at the turnaround, so a trailing camera
//   has to come around to the other side; this is how long that orbit takes.
// introS — the flight opens in close on the hiker (closeRange) and pulls back
//   to the tracking range over this long.
// outroS — over the flight's last seconds the camera comes back around and in
//   to exactly the opening shot, so it ends where it began.
const TRAILING_RIG = { targetSigmaS: 2.5, headingSigmaM: 1500, headingSigmaS: 2, orbitS: 14, introS: 5, outroS: 9 };

// Gaussian smoothing with odd-reflection padding (v[-k] = 2v[0] - v[k]), so
// the ends keep their real position and slope instead of being pulled inward.
function gaussianSmooth(values, sigmaSamples) {
  const n = values.length;
  if (sigmaSamples < 0.5 || n < 3) return values.slice();
  const half = Math.ceil(3 * sigmaSamples);
  const weights = [];
  for (let k = -half; k <= half; k++) weights.push(Math.exp(-(k * k) / (2 * sigmaSamples * sigmaSamples)));
  const at = (i) => {
    if (i < 0) return 2 * values[0] - values[Math.min(n - 1, -i)];
    if (i >= n) return 2 * values[n - 1] - values[Math.max(0, 2 * (n - 1) - i)];
    return values[i];
  };
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0, wsum = 0;
    for (let k = -half; k <= half; k++) { const w = weights[k + half]; sum += w * at(i + k); wsum += w; }
    out[i] = sum / wsum;
  }
  return out;
}

// Precomputes the trailing camera's aim point, heading, pitch, and range as
// functions of s = distance flown along `pathPoints` (the same array the
// marker follows). Headings are unwrapped (never jump between 359° and 0°),
// so they can be interpolated directly.
//
// shot: { range, closeRange, pitchDeg, descentPitchDeg } (see HikeMap.jsx).
// descentPitchDeg: on an out-and-back's return leg, "behind the hiker" is
// uphill, so the camera looks *down* a slope that falls away from it and sees
// the switchbacks at a grazing angle, where they flatten into each other. The
// camera rises to this steeper angle during the summit orbit and holds it for
// the descent.
function buildTrailingRig(pathPoints, pathCum, apexIdx, isOutAndBack, speedMps, shot, rig = TRAILING_RIG) {
  const { range, closeRange, pitchDeg, descentPitchDeg } = shot;
  const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  const step = 5;
  const total = pathCum[pathCum.length - 1];
  const lat0 = pathPoints[0].lat, lon0 = pathPoints[0].lon;
  const mPerDegLat = 111320, mPerDegLon = mPerDegLat * Math.cos((lat0 * Math.PI) / 180);
  const sample = (pts, cum, len) => {
    const hint = { i: 1 }, xs = [], ys = [];
    for (let d = 0; d <= len; d += step) {
      const p = positionAt(pts, cum, len, d / len, hint);
      xs.push((p.lon - lon0) * mPerDegLon); ys.push((p.lat - lat0) * mPerDegLat);
    }
    return { xs, ys };
  };
  const lerp = (arr, f) => {
    const x = Math.min(arr.length - 1, Math.max(0, f)), i = Math.floor(x);
    return i >= arr.length - 1 ? arr[i] : arr[i] + (arr[i + 1] - arr[i]) * (x - i);
  };
  const tangentDeg = (xs, ys) => {
    const h = xs.map((_, i) => {
      const a = Math.max(0, i - 1), b = Math.min(xs.length - 1, i + 1);
      return (Math.atan2(xs[b] - xs[a], ys[b] - ys[a]) * 180) / Math.PI;
    });
    for (let i = 1; i < h.length; i++) h[i] = h[i - 1] + ((((h[i] - h[i - 1]) % 360) + 540) % 360) - 180;
    return h;
  };

  // Aim point: the hiker's own path, centered-smoothed over time.
  const flight = sample(pathPoints, pathCum, total);
  const aimSigma = (rig.targetSigmaS * speedMps) / step;
  const aimX = gaussianSmooth(flight.xs, aimSigma), aimY = gaussianSmooth(flight.ys, aimSigma);

  // Heading: direction of travel along the (outbound) leg, from positions
  // smoothed over headingSigmaM of trail.
  const legLen = pathCum[apexIdx];
  const leg = isOutAndBack ? sample(pathPoints.slice(0, apexIdx + 1), pathCum.slice(0, apexIdx + 1), legLen) : flight;
  const legSigma = rig.headingSigmaM / step;
  const legHeading = tangentDeg(gaussianSmooth(leg.xs, legSigma), gaussianSmooth(leg.ys, legSigma));
  let heading, pitch;
  if (isOutAndBack) {
    // Past the turnaround the hiker walks the outbound trail backwards, so the
    // camera wants the outbound heading +180°, eased in as one orbit — and
    // rises to descentPitchDeg over the same orbit.
    const orbitHalf = Math.min((rig.orbitS / 2) * speedMps, legLen / 3);
    const orbit = (s) => ease((s - (legLen - orbitHalf)) / (2 * orbitHalf));
    heading = flight.xs.map((_, j) => {
      const s = j * step;
      return lerp(legHeading, Math.min(s, 2 * legLen - s) / step) + 180 * orbit(s);
    });
    pitch = flight.xs.map((_, j) => pitchDeg + (descentPitchDeg - pitchDeg) * orbit(j * step));
  } else {
    heading = legHeading;
    pitch = flight.xs.map(() => pitchDeg);
  }
  const easeSigma = (rig.headingSigmaS * speedMps) / step;
  heading = gaussianSmooth(heading, easeSigma);
  pitch = gaussianSmooth(pitch, easeSigma);

  // Bookends (introS/outroS), applied after the smoothing above so both ends
  // land exactly. The aim point needs nothing extra: an out-and-back ends at
  // its first point, so matching heading, pitch, and range to the opening
  // frame's is what makes the last frame the same shot.
  const outroM = Math.min(rig.outroS * speedMps, total / 3);
  const outro = flight.xs.map((_, j) => ease((j * step - (total - outroM)) / outroM));
  const h0 = heading[0], p0 = pitch[0], hEnd = heading[heading.length - 1];
  // An out-and-back keeps turning the way the summit orbit did, so the camera
  // circles once over the whole flight instead of swinging back; a loop just
  // takes the shorter way around.
  const turns = isOutAndBack ? Math.ceil((hEnd - h0) / 360) : Math.round((hEnd - h0) / 360);
  heading = heading.map((h, j) => h + (h0 + 360 * turns - h) * outro[j]);
  pitch = pitch.map((p, j) => p + (p0 - p) * outro[j]);
  const introM = Math.min(rig.introS * speedMps, total / 3);
  const rangeM = flight.xs.map((_, j) => closeRange + (range - closeRange) * ease((j * step) / introM) * (1 - outro[j]));

  return {
    aimAt: (s) => ({ lat: lat0 + lerp(aimY, s / step) / mPerDegLat, lon: lon0 + lerp(aimX, s / step) / mPerDegLon }),
    headingAt: (s) => lerp(heading, s / step),
    pitchAt: (s) => lerp(pitch, s / step),
    rangeAt: (s) => lerp(rangeM, s / step),
  };
}

// Trail line / marker path, built from the raw GPS in three steps — each
// verified by plotting against the raw tracks of five real hikes on this site
// (Cascade Pass, Rattlesnake Ledge, Colchuck Lake, Snow Lake, Maple Pass Loop):
//
// 1. Stops collapse to one point. Standing at a viewpoint, GPS wanders into a
//    scribble of tangled loops. Stops come from the watch's own recorded
//    (Doppler) speed, not from net movement — a hairpin shows little net
//    movement at full walking speed, and a net-movement test chopped hairpin
//    tips off. Stop fragments split by a few seconds of shuffling close by
//    (stop / few steps / stop, typical at a viewpoint) count as one stop.
// 2. Detours are cut. Where the path comes back to where it already was, still
//    heading the same way at the same elevation, the stretch in between was a
//    step off the trail. Switchback legs head the opposite way and climb, so
//    they never match.
// 3. Light smoothing *along* the trail removes GPS jitter and rounds hairpins,
//    but is too narrow to pull neighboring switchback legs together.
// 4. Crossed hairpins are untangled. With a hairpin's legs only a few meters
//    apart, GPS noise often swaps them just below the tip, so the line crosses
//    itself (16 times on Cascade's way up). See untangleHairpins.
//
// Replaced a Catmull-Rom spline through anchors thinned to ~21m apart —
// coarser than Cascade's switchback legs (5-10m apart), so it skipped whole
// legs and cut straight chords across them — plus a loop "repair" that
// straightened any stretch returning within 8m of itself, which also matched
// every tight hairpin tip.
const TRAIL = {
  stopSpeedMps: 0.3, minStopS: 10, stopMergeGapS: 20, stopMergeRadiusM: 20,
  detourRejoinM: 6, detourMinM: 12, detourMaxM: 250, detourHeadingTolDeg: 50, detourEleTolM: 6,
  smoothSigmaM: 5, spacingM: 2,
  // Longest crossed loop measured on Cascade was 74m of trail; much longer
  // would mean two different switchback legs crossing, where reversing the
  // stretch between them would send the hiker up a leg backwards.
  untangleMaxM: 120,
};

function collapseStops(points) {
  if (points.some((p) => p.t == null)) return points;
  const speed = points.map((p, i) => {
    if (p.speed != null && p.speed >= 0) return p.speed;
    const a = points[Math.max(0, i - 2)], b = points[Math.min(points.length - 1, i + 2)];
    const dt = (b.t - a.t) / 1000;
    return dt > 0 ? haversineM(a, b) / dt : Infinity;
  });
  const centroid = (run) => ({
    lat: run.reduce((s, p) => s + p.lat, 0) / run.length,
    lon: run.reduce((s, p) => s + p.lon, 0) / run.length,
    ele: run.reduce((s, p) => s + (p.ele ?? 0), 0) / run.length,
  });
  const runs = [];
  for (let i = 0; i < points.length; ) {
    if (speed[i] < TRAIL.stopSpeedMps) {
      let j = i;
      while (j + 1 < points.length && speed[j + 1] < TRAIL.stopSpeedMps) j++;
      runs.push([i, j]);
      i = j + 1;
    } else i++;
  }
  const merged = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && (points[run[0]].t - points[last[1]].t) / 1000 <= TRAIL.stopMergeGapS) {
      const span = points.slice(last[0], run[1] + 1), c = centroid(span);
      if (span.every((p) => haversineM(p, c) <= TRAIL.stopMergeRadiusM)) { last[1] = run[1]; continue; }
    }
    merged.push([...run]);
  }
  const out = [];
  let k = 0;
  for (const [a, b] of merged) {
    if ((points[b].t - points[a].t) / 1000 < TRAIL.minStopS) continue;
    while (k < a) out.push(points[k++]);
    out.push(centroid(points.slice(a, b + 1)));
    k = b + 1;
  }
  while (k < points.length) out.push(points[k++]);
  return out;
}

function resampleByArc(xs, ys, es, step) {
  const n = xs.length, cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
  const X = [], Y = [], E = [];
  let k = 1;
  for (let d = 0; d <= cum[n - 1]; d += step) {
    while (k < n - 1 && cum[k] < d) k++;
    const f = cum[k] > cum[k - 1] ? (d - cum[k - 1]) / (cum[k] - cum[k - 1]) : 0;
    X.push(xs[k - 1] + (xs[k] - xs[k - 1]) * f);
    Y.push(ys[k - 1] + (ys[k] - ys[k - 1]) * f);
    E.push(es[k - 1] + (es[k] - es[k - 1]) * f);
  }
  X.push(xs[n - 1]); Y.push(ys[n - 1]); E.push(es[n - 1]);
  return { X, Y, E };
}

// Keep-mask over 1m samples with each detour's interior cleared (see step 2).
function findDetours(X, Y, E) {
  const keep = new Array(X.length).fill(true);
  const heading = (a, b) => Math.atan2(X[b] - X[a], Y[b] - Y[a]);
  const angleDeg = (a, b) => { const d = Math.abs(a - b) % (2 * Math.PI); return ((d > Math.PI ? 2 * Math.PI - d : d) * 180) / Math.PI; };
  for (let i = 0; i < X.length; ) {
    let rejoin = -1;
    for (let j = Math.min(X.length - 1, i + TRAIL.detourMaxM); j >= i + TRAIL.detourMinM; j--) {
      if (Math.hypot(X[j] - X[i], Y[j] - Y[i]) > TRAIL.detourRejoinM) continue;
      if (Math.abs(E[j] - E[i]) > TRAIL.detourEleTolM) continue;
      const arriving = heading(Math.max(0, i - 6), i), leaving = heading(j, Math.min(X.length - 1, j + 6));
      if (angleDeg(arriving, leaving) > TRAIL.detourHeadingTolDeg) continue;
      rejoin = j;
      break;
    }
    if (rejoin > 0) { for (let k = i + 1; k < rejoin; k++) keep[k] = false; i = rejoin; } else i++;
  }
  return keep;
}

// A recording gap on the way in (the watch paused or lost signal, so two
// consecutive points sit far apart) would draw as one straight chord across
// whatever the trail actually did. On an out-and-back the way back usually
// walks the same stretch, so the gap is filled with that stretch of the
// return leg, reversed. Lake Ingalls: 64 unrecorded minutes between Ingalls
// Pass and Headlight Basin left an 887m straight jump across the basin,
// where the trail (and the way back) walks a 1.5km crescent. The filled
// points keep their own recorded speed, so they don't read as a stop, and
// get times spread evenly across the gap, so time still runs forward.
const GAP_FILL = { minGapM: 150, maxMatchM: 40 };
function fillOutboundGaps(outbound, returnLeg) {
  const nearestOnReturn = (p) => {
    let best = -1, bestD = Infinity;
    for (let k = 0; k < returnLeg.length; k++) {
      const d = haversineM(p, returnLeg[k]);
      if (d < bestD) { bestD = d; best = k; }
    }
    return bestD <= GAP_FILL.maxMatchM ? best : -1;
  };
  const out = [outbound[0]];
  for (let i = 1; i < outbound.length; i++) {
    const a = outbound[i - 1], b = outbound[i];
    if (haversineM(a, b) >= GAP_FILL.minGapM) {
      // The way back passes b's end of the gap first, then a's.
      const ib = nearestOnReturn(b), ia = nearestOnReturn(a);
      if (ib >= 0 && ia > ib + 1) {
        const fill = returnLeg.slice(ib + 1, ia).reverse();
        fill.forEach((p, k) => out.push({
          ...p,
          t: a.t != null && b.t != null ? a.t + ((b.t - a.t) * (k + 1)) / (fill.length + 1) : null,
        }));
      }
    }
    out.push(b);
  }
  return out;
}

function buildSmoothTrail(points) {
  const base = collapseStops(points);
  const lat0 = base[0].lat, lon0 = base[0].lon;
  const mPerDegLat = 111320, mPerDegLon = mPerDegLat * Math.cos((lat0 * Math.PI) / 180);
  let { X, Y, E } = resampleByArc(
    base.map((p) => (p.lon - lon0) * mPerDegLon),
    base.map((p) => (p.lat - lat0) * mPerDegLat),
    base.map((p) => p.ele ?? 0),
    1
  );
  // light pre-smooth so detour headings reflect the trail, not GPS jitter
  X = gaussianSmooth(X, 2); Y = gaussianSmooth(Y, 2); E = gaussianSmooth(E, 8);
  const keep = findDetours(X, Y, E);
  ({ X, Y, E } = resampleByArc(X.filter((_, i) => keep[i]), Y.filter((_, i) => keep[i]), E.filter((_, i) => keep[i]), 1));
  const remainingSigma = Math.sqrt(Math.max(0, TRAIL.smoothSigmaM ** 2 - 4)); // 2m already applied
  X = gaussianSmooth(X, remainingSigma); Y = gaussianSmooth(Y, remainingSigma);
  const idx = [];
  for (let i = 0; i < X.length; i += TRAIL.spacingM) idx.push(i);
  if ((X.length - 1) % TRAIL.spacingM !== 0) idx.push(X.length - 1);
  const pts = idx.map((i) => ({ x: X[i], y: Y[i], ele: E[i] }));
  untangleHairpins(pts);
  return pts.map((p) => ({ lat: lat0 + p.y / mPerDegLat, lon: lon0 + p.x / mPerDegLon, ele: p.ele }));
}

// Step 4 (see above): wherever the path crosses itself within
// TRAIL.untangleMaxM of trail, reverses the stretch between the two crossing
// segments. At a hairpin whose legs GPS has swapped just below the tip, that
// turns the α back into a U without removing any of it. Each reversal
// shortens the path, so repeating until nothing crosses always ends. In place.
function untangleHairpins(pts) {
  const cross = (o, p, q) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const intersects = (a, b, c, d) => {
    const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
    return d1 * d2 < 0 && d3 * d4 < 0;
  };
  const maxSpan = Math.round(TRAIL.untangleMaxM / TRAIL.spacingM);
  for (let pass = 0, changed = true; changed && pass < 20; pass++) {
    changed = false;
    for (let i = 0; i < pts.length - 1; i++) {
      for (let j = i + 2; j < Math.min(pts.length - 1, i + maxSpan); j++) {
        if (!intersects(pts[i], pts[i + 1], pts[j], pts[j + 1])) continue;
        for (let a = i + 1, b = j; a < b; a++, b--) [pts[a], pts[b]] = [pts[b], pts[a]];
        changed = true;
      }
    }
  }
}

// The card's basemap: Esri's shaded relief (World_Hillshade), recolored from
// gray into the site's forest greens, instead of satellite. At card size
// satellite read as busy — snowfields, shadow and forest all competing with
// the thin route line — where plain relief reads like a printed trail map.
// Satellite stays in the lightbox flyover. Recolored through a lookup table:
// hillshade is grayscale, and on the North Cascades mostly 0.5-0.96 gray, so
// the ramp spends its range there, keeping the lightest slopes well short of
// the white route line.
const RELIEF_STOPS = [
  [0.45, [15, 23, 17]],
  [0.6, [29, 42, 32]],
  [0.8, [58, 80, 64]],
  [0.96, [111, 143, 120]],
  [1, [126, 158, 136]], // --stone
];
const RELIEF_LUT = Array.from({ length: 256 }, (_, v) => {
  const t = v / 255;
  if (t <= RELIEF_STOPS[0][0]) return RELIEF_STOPS[0][1];
  for (let i = 1; i < RELIEF_STOPS.length; i++) {
    const [t1, c1] = RELIEF_STOPS[i];
    if (t <= t1) {
      const [t0, c0] = RELIEF_STOPS[i - 1];
      const f = (t - t0) / (t1 - t0);
      return c0.map((c, k) => Math.round(c + (c1[k] - c) * f));
    }
  }
  return RELIEF_STOPS[RELIEF_STOPS.length - 1][1];
});

const RELIEF_TILE_URL = (z, y, x) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/${z}/${y}/${x}`;
// The service's own copyrightText — Esri's terms require it on screen, same
// as the satellite credit.
const RELIEF_CREDIT = 'Sources: Esri, Vantor, Airbus DS, USGS, NGA, NASA, CGIAR, N Robinson, NCEAS, NLS, OS, NMA, Geodatastyrelsen, Rijkswaterstaat, GSA, Geoland, FEMA, Intermap, and the GIS user community';
// Bounds the one image's size (64 tiles = 2048px square at most).
const RELIEF_MAX_TILES = 64;

function recolorRelief(ctx, width, height) {
  const pixels = ctx.getImageData(0, 0, width, height);
  const d = pixels.data;
  for (let i = 0; i < d.length; i += 4) {
    const [r, g, b] = RELIEF_LUT[d[i]];
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
  }
  ctx.putImageData(pixels, 0, 0);
}

// The card's relief as ONE image: every Esri tile at one zoom level over the
// given area, stitched onto a canvas, recolored in one pass, and handed to
// Cesium as a single image. Left to Cesium's normal tile-by-tile loading, the
// card mixed levels (Esri shades each level differently, so it came out as a
// patchwork of darker and lighter squares) and, even with the level pinned,
// could leave a coarse stand-in tile showing next to full detail, as if two
// different maps had been stitched together. A single image can't mix
// anything. Esri's Web Mercator tiles are placed on Cesium's lat/lon grid as
// one rectangle; over a card-sized area the two projections differ by a few
// centimeters.
async function createReliefLayer({ west, south, east, north }, level) {
  let n, x0, x1, y0, y1;
  const tileX = (lon) => Math.floor(((lon + 180) / 360) * n);
  const tileY = (lat) => {
    const r = Cesium.Math.toRadians(lat);
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  };
  // A level coarser whenever the area would take too many tiles.
  for (;; level--) {
    n = 2 ** level;
    [x0, x1, y0, y1] = [tileX(west), tileX(east), tileY(north), tileY(south)];
    if ((x1 - x0 + 1) * (y1 - y0 + 1) <= RELIEF_MAX_TILES || level <= 8) break;
  }
  const lonOf = (x) => (x / n) * 360 - 180;
  const latOf = (y) => Cesium.Math.toDegrees(Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))));

  const canvas = document.createElement('canvas');
  canvas.width = (x1 - x0 + 1) * 256;
  canvas.height = (y1 - y0 + 1) * 256;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const draws = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      draws.push(
        fetch(RELIEF_TILE_URL(level, y, x))
          .then((res) => res.blob())
          .then((blob) => createImageBitmap(blob))
          .then((img) => ctx.drawImage(img, (x - x0) * 256, (y - y0) * 256))
          // A tile that fails just leaves its square transparent, showing
          // the globe's base color.
          .catch(() => {})
      );
    }
  }
  await Promise.all(draws);
  recolorRelief(ctx, canvas.width, canvas.height);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve));
  const url = URL.createObjectURL(blob);
  try {
    const provider = await Cesium.SingleTileImageryProvider.fromUrl(url, {
      rectangle: Cesium.Rectangle.fromDegrees(lonOf(x0), latOf(y1 + 1), lonOf(x1 + 1), latOf(y0)),
      credit: RELIEF_CREDIT,
    });
    return new Cesium.ImageryLayer(provider);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Renders a 3D terrain flyover into `containerEl` for the given already-parsed
// (and ideally already-decimated) GPX `points`. Deliberately takes points, not a
// GPX URL — stays agnostic of Supabase/fetching, which the caller (HikeMap.jsx /
// HikeMapCard.jsx) already owns.
export class TerrainFlyover {
  // topDownBottomInset (top-down card only): a function returning how many
  // pixels along the bottom of the card are covered (by its caption band), so
  // the route is fit into the area above it rather than tucked underneath.
  constructor(containerEl, { points, onProgress, onFinish, camera, durationMs, topDownPreview, topDownBottomInset } = {}) {
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
      const outboundRawPoints = fillOutboundGaps(points.slice(0, rawApexIdx + 1), points.slice(rawApexIdx));
      const outboundFlowing = buildSmoothTrail(outboundRawPoints);
      this.cameraPoints = [...outboundFlowing, ...outboundFlowing.slice(0, -1).reverse()];
      this.apexIdx = outboundFlowing.length - 1;
    } else {
      // A loop never truly retraces itself, so there's nothing to collapse
      // or mirror — per docs/roadmap-3d-flyover.md Decision 5, the full
      // recorded route is drawn once and flown once, start to end. The line-
      // draw and marker-placement code below both key off `apexIdx` as "the
      // last index of what gets drawn/flown," which for a loop is simply the
      // whole array — no separate branch needed past this point.
      this.cameraPoints = buildSmoothTrail(points);
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
    if (camera?.trailing) {
      const { range, closeRange = range, pitchDeg, descentPitchDeg = pitchDeg } = camera.trailing;
      const speedMps = this.total / (this.durationMs / 1000);
      this.trailingRig = buildTrailingRig(this.cameraPoints, this.cum, this.apexIdx, this.isOutAndBack, speedMps, { range, closeRange, pitchDeg, descentPitchDeg });
    }

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
    // for our own route to visually conflict with. The top-down card uses
    // recolored shaded relief instead, added once its fit is known (below).
    const baseImagery = topDownPreview
      ? false
      : new Cesium.ImageryLayer(
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
      // The card never moves, so it only redraws when something changes
      // (tiles arriving, a resize) rather than 60 times a second — which is
      // what makes the full-density rendering below affordable for it.
      requestRenderMode: !!topDownPreview,
      maximumRenderTimeChange: Infinity,
      useBrowserRecommendedResolution: !topDownPreview,
    });
    this.viewer.scene.globe.enableLighting = true;
    // FXAA smooths edge stair-stepping (the trail line's edges especially).
    // Rendering at the display's full pixel density
    // (useBrowserRecommendedResolution = false) was tried alongside it for
    // sharper terrain on Retina screens — up to 4x the pixels, plus finer
    // tiles streaming in — and made playback visibly jittery, so the flyover
    // stays at Cesium's default resolution. The card has no playback, so it
    // gets full density (capped at 2x, so a 3x phone doesn't draw 9x the
    // pixels) — at 1x it was visibly soft on Retina screens.
    if (topDownPreview) this.viewer.resolutionScale = Math.min(1, 2 / window.devicePixelRatio);
    this.viewer.scene.postProcessStages.fxaa.enabled = true;
    this.viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#8a9a78');
    // Off by default in Cesium, which draws lines and points over the terrain
    // no matter what's in front of them — the trail line showed through
    // ridges between it and the camera.
    this.viewer.scene.globe.depthTestAgainstTerrain = true;
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
    // The card's relief (createReliefLayer), from the zoom level whose pixels
    // best match the card's own over the route's extent (on Cascade, 13).
    // Built once the view is fit (end of this constructor), over the ground
    // area the camera actually shows. Until it arrives, the globe shows the
    // relief's midtone.
    let reliefLevel;
    if (topDownExtent) {
      const { halfWidthM, halfHeightM, centerLat } = topDownExtent;
      const widthPx = containerEl.clientWidth || 400;
      const heightPx = Math.max((containerEl.clientHeight || 300) - (topDownBottomInset?.() ?? 0), 1);
      const metersPerPx = Math.max((2 * halfWidthM) / widthPx, (2 * halfHeightM) / heightPx);
      const webMercatorMetersPerPxAtZ0 = 156543.03 * Math.cos(Cesium.Math.toRadians(centerLat));
      reliefLevel = Cesium.Math.clamp(Math.round(Math.log2(webMercatorMetersPerPxAtZ0 / metersPerPx)), 8, 16);
      this.viewer.scene.globe.baseColor = Cesium.Color.fromBytes(...RELIEF_LUT[205]);
    }
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
      // The caption band covers the bottom of the card: fit the route's height
      // into the uncovered part, then shift the view south (screen-down, with
      // north up) by half the band so the route centers in that part.
      const heightPx = containerEl.clientHeight;
      const insetPx = Math.min(topDownBottomInset?.() ?? 0, heightPx * 0.5);
      const uncovered = (heightPx - insetPx) / heightPx;
      const distForHeight = halfHeightM / (Math.tan(fovY / 2) * uncovered);
      const distForWidth = halfWidthM / Math.tan(fovX / 2);
      const clearance = Math.max(distForHeight, distForWidth);
      const metersPerPx = (2 * clearance * Math.tan(fovY / 2)) / heightPx;
      const shiftedLat = centerLat - ((insetPx / 2) * metersPerPx) / 111320;
      this.viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(centerLon, shiftedLat, maxEle + clearance),
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
    // See trailPolyline.js for how it's drawn (terrain-sampled 3D polyline,
    // width set from distance to the camera). The top-down card sits far
    // enough up that the whole line hits the minimum width — thin enough to
    // wash out over snow at card size — so it gets a heavier floor.
    this.trail = createTerrainTrail(
      this.viewer,
      this.cameraPoints.slice(0, this.apexIdx + 1),
      topDownPreview ? { minWidthPx: 2 } : undefined
    );

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
      // White dots outlined in the line's own dark casing, so on the card they
      // read as the line's two ends rather than as extra map colors (the
      // lightbox flyover keeps its green start and red end). An out-and-back's
      // start and real turnaround are different places, so each gets a dot. A
      // loop starts and finishes at the same spot (measured on Maple Pass
      // Loop's real GPX: ~1m apart), so it gets one; two stacked there read as
      // "the other one is missing," not as "this is a loop."
      const ends = this.isOutAndBack ? [points[0], this.cameraPoints[this.apexIdx]] : [points[0]];
      for (const p of ends) {
        this.viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 3),
          point: pinPoint(Cesium.Color.WHITE, TRAIL_CASING),
        });
      }
    } else {
      this.marker = this.viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(points[0].lon, points[0].lat, 3),
        point: { ...pinPoint(Cesium.Color.ORANGE), pixelSize: 10 },
      });

      // A dot at each end of the line, so the line starts and ends at
      // something instead of just stopping: green start, red end, white
      // outline, same as the card's pins (a loop's one dot, at its shared
      // start/finish, is green with a red outline, also as on the card). A
      // little wider than the line up close, so it reads as the line's end
      // cap. (Map-marker and pushpin versions were tried first; the plain
      // dot was preferred.)
      //
      // Only shown while the camera can actually see that end of the line, so
      // the far end doesn't show through the mountains in between: every few
      // frames, a ray from the camera to each dot is picked against the
      // rendered terrain, and the dot hides if the ray hits ground well short
      // of it. The slack keeps the ground right at the dot (the line floats
      // 4m above it) from counting. Cesium's own terrain test for clamped
      // billboards was tried first and showed the far dot over the ridge too
      // early: it counts a billboard as visible if any of three points on it
      // is, and a few km out the dot's top edge is ~40m above its real spot.
      //
      // When shown, drawn with no depth test, so terrain right in front of it
      // can't slice it. Their own collection, added after the entities'
      // (among the viewer's first primitives), so they draw after the hiker:
      // every depth-test-disabled billboard sits on the near plane, where
      // Cesium's LESS depth test keeps whichever drew first, so the hiker
      // stays on top while it's standing on an end.
      const DOT_OCCLUSION_SLACK_M = 25;
      const endDotImage = (fill, outline) => `data:image/svg+xml,${encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 14 14">'
        + `<circle cx="7" cy="7" r="5.75" fill="${fill.toCssHexString()}" stroke="${outline.toCssHexString()}" stroke-width="1.5"/>`
        + '</svg>'
      )}`;
      this.trail.ends.then(([start, end]) => {
        if (this.destroyed || this.viewer.isDestroyed()) return;
        const scene = this.viewer.scene;
        const collection = scene.primitives.add(new Cesium.BillboardCollection());
        const addDot = (position, fill, outline = Cesium.Color.WHITE) => collection.add({
          position,
          image: endDotImage(fill, outline),
          width: 14,
          height: 14,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
        const dots = this.isOutAndBack
          ? [addDot(start, GREEN), addDot(end, RED)]
          : [addDot(start, GREEN, RED)];
        const ray = new Cesium.Ray();
        const hit = new Cesium.Cartesian3();
        let frame = 0;
        this.removeDotOcclusion = scene.preRender.addEventListener(() => {
          if (frame++ % 4) return;
          const cam = scene.camera.positionWC;
          for (const dot of dots) {
            Cesium.Cartesian3.clone(cam, ray.origin);
            Cesium.Cartesian3.normalize(Cesium.Cartesian3.subtract(dot.position, cam, ray.direction), ray.direction);
            const picked = scene.globe.pick(ray, scene, hit);
            dot.show = !picked
              || Cesium.Cartesian3.distance(cam, picked) > Cesium.Cartesian3.distance(cam, dot.position) - DOT_OCCLUSION_SLACK_M;
          }
        });
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
      // The ground the card shows, measured on the ellipsoid, which sits
      // below all this terrain and so overshoots it slightly: a safe cover.
      // Plus a margin for later small resizes. An estimate from the route's
      // own box came up short at the card's west edge on Cascade, where
      // Cesium smeared the image's edge pixels across the gap.
      const view = this.viewer.camera.computeViewRectangle();
      if (view) {
        const padLon = (view.east - view.west) * 0.15;
        const padLat = (view.north - view.south) * 0.15;
        const deg = Cesium.Math.toDegrees;
        createReliefLayer({
          west: deg(view.west - padLon),
          south: deg(view.south - padLat),
          east: deg(view.east + padLon),
          north: deg(view.north + padLat),
        }, reliefLevel)
          .then((layer) => {
            if (this.destroyed || this.viewer.isDestroyed()) return;
            this.viewer.imageryLayers.add(layer);
            this.viewer.scene.requestRender();
          })
          .catch((e) => console.error('[terrainFlyover] card relief failed:', e));
      }
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

    // Default: heading = this.fixedBearing (see the constructor) rotated by
    // sideOffsetDeg — constant for the entire flight, both legs, nothing to
    // smooth. Trailing mode reads its precomputed heading (buildTrailingRig).
    const bearing = this.trailingRig
      ? this.trailingRig.headingAt(frac * this.total)
      : (this.fixedBearing + this.camera.sideOffsetDeg + 360) % 360;

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
    //
    // Trailing mode skips this chase entirely and reads its precomputed,
    // centered-smoothed aim point instead (see buildTrailingRig).
    let aim;
    if (this.trailingRig) {
      aim = this.trailingRig.aimAt(frac * this.total);
    } else {
      if (this.smoothedTarget == null) {
        this.smoothedTarget = { lat: pos.lat, lon: pos.lon };
      } else {
        this.smoothedTarget.lat += (pos.lat - this.smoothedTarget.lat) * TARGET_SMOOTHING;
        this.smoothedTarget.lon += (pos.lon - this.smoothedTarget.lon) * TARGET_SMOOTHING;
      }
      aim = this.smoothedTarget;
    }

    // Camera target height: this file's own smoothed groundHeightAt (needs a
    // concrete absolute height — lookAt isn't an Entity, it has no
    // heightReference to lean on), sampled at the already-smoothed lat/lon.
    const groundHeight = this.groundHeightAt(aim.lat, aim.lon, pos.ele);
    const targetPos = Cesium.Cartesian3.fromDegrees(aim.lon, aim.lat, groundHeight + 3);

    // camera.lookAt(target, HeadingPitchRange) positions the camera at the
    // given heading/pitch/range *from* target and points it at target — the
    // camera's actual world position is computed entirely by Cesium, not by
    // this code, which is the point (see DEFAULT_CAMERA's comment).
    this.viewer.camera.lookAt(
      targetPos,
      new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(bearing),
        Cesium.Math.toRadians(this.trailingRig ? this.trailingRig.pitchAt(frac * this.total) : this.camera.pitchDeg),
        this.trailingRig ? this.trailingRig.rangeAt(frac * this.total) : this.camera.range
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
    this.removeDotOcclusion?.();
    this.trail?.destroy();
    if (!this.viewer.isDestroyed()) this.viewer.destroy();
  }
}
