export function parseGPX(text) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'application/xml');
  const trkpts = doc.querySelectorAll('trkpt');
  const points = [];
  trkpts.forEach(pt => {
    const lat = parseFloat(pt.getAttribute('lat'));
    const lon = parseFloat(pt.getAttribute('lon'));
    const eleEl = pt.querySelector('ele');
    const ele = eleEl ? parseFloat(eleEl.textContent) : null;
    // Timestamp and the watch's own (Doppler) speed, when recorded — used by
    // terrainFlyover.js to tell standing still apart from walking.
    const timeEl = pt.querySelector('time');
    const t = timeEl ? Date.parse(timeEl.textContent) : null;
    const speedEl = pt.querySelector('speed');
    const speed = speedEl ? parseFloat(speedEl.textContent) : null;
    if (!isNaN(lat) && !isNaN(lon)) points.push({ lat, lon, ele, t: Number.isNaN(t) ? null : t, speed: Number.isNaN(speed) ? null : speed });
  });
  return points;
}

export function haversineM(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

// Tracks that start somewhere other than the trailhead. Blanca Lake's
// access road was washed out 1.6 miles below the trail, so the recording
// opens with a flat road walk and closes with the same walk back — 3.2 of
// its 10.8 miles, and 30% of a flyover spent over a forest road before the
// hike begins. The GPX keeps the whole trip, because that is what was
// walked; the map and the flyover show the trail.
//
// Manastash's recording starts right at the trailhead, where the trail meets
// Cove Road, but ends 276m past it at the street parking; its descent passes
// within 1m of the start point, so it gets a 2m radiusM, cutting the walk to
// the car right at that pass; at 10m the cut landed 9m past the trailhead and
// the line overshot the start dot.
//
// Bandera's recording starts 0.7 mi and 620 ft below the Ira Spring
// trailhead, a walk up the road, and stops on the way down before getting
// back to it, so only the start is trimmed.
export const TRAIL_START = {
  'blanca-lake': { lat: 47.9157, lon: -121.3128 },
  'bandera-mountain': { lat: 47.4247, lon: -121.5836 },
  'manastash': { lat: 46.965507, lon: -120.645898, radiusM: 2 },
};

// Loops the out-and-back detector gets wrong. Manastash climbs a long,
// wandering way for 4.75 mi and comes straight down a different, steep 1.25
// mi, never far from the car; its "does the return retrace the outbound"
// score came in at 67m, just under the 70m cutoff (terrainFlyover.js), so it
// was flown as an out-and-back turning at 3.14 mi: the top 1.6 mi of the
// climb and the whole real descent were missing. Named per hike, not by
// moving the cutoff, since that would also reclassify Mailbox and Mt. Si
// Winter, whose descents differ but which are shown as out-and-backs on
// purpose.
export const FORCE_LOOP = new Set(['manastash']);

// The track between the first approach to the trailhead (in its first half)
// and the last (in its second half). On an out-and-back the same walk
// bookends the recording, so both ends go; an end that never reaches the
// trailhead (a recording started or stopped out on the trail) is kept as
// is, as is the whole track if a mistyped coordinate is never reached.
// Searching each half separately matters: Manastash's only pass by its
// trailhead is on the way out, and a whole-track search took that for the
// start too and kept almost nothing.
export function trimToTrailStart(points, hikeId, defaultRadiusM = 60) {
  const start = TRAIL_START[hikeId];
  if (!start || points.length === 0) return points;
  const radiusM = start.radiusM ?? defaultRadiusM;
  const half = Math.floor(points.length / 2);
  let first = 0;
  let last = points.length - 1;
  for (let i = 0; i < half; i++) {
    if (haversineM(points[i], start) <= radiusM) { first = i; break; }
  }
  for (let i = points.length - 1; i >= half; i--) {
    if (haversineM(points[i], start) <= radiusM) { last = i; break; }
  }
  return points.slice(first, last + 1);
}

export function buildCumulative(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + haversineM(points[i - 1], points[i]));
  return cum;
}

// Great-circle initial bearing from a to b, in degrees (0-360). Extracted here
// instead of left duplicated ad hoc in spikes/phase1b-flyover-test.html and
// phase1c-cesium-terrain-spike.html, both of which needed it for camera heading.
export function bearingBetween(a, b) {
  const bearing = Math.atan2(
    Math.sin((b.lon - a.lon) * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180),
    Math.cos(a.lat * Math.PI / 180) * Math.sin(b.lat * Math.PI / 180) -
      Math.sin(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.cos((b.lon - a.lon) * Math.PI / 180)
  ) * 180 / Math.PI;
  return (bearing + 360) % 360;
}

// Interpolates a lat/lon/ele position along the track at `frac` (0..1) of total distance.
// `hint` (optional, mutable {i}) lets repeated calls with a nearby frac skip the linear scan.
// `bearing` (direction of travel at this point, 0-360) is only used by the 3D terrain
// flyover's camera heading — the 2D Leaflet flyover ignores it.
export function positionAt(points, cum, total, frac, hint) {
  const targetDist = frac * total;
  let i = hint ? Math.min(Math.max(hint.i, 1), cum.length - 1) : 1;
  while (i < cum.length - 1 && cum[i] < targetDist) i++;
  while (i > 1 && cum[i - 1] > targetDist) i--;
  if (hint) hint.i = i;
  const d0 = cum[i - 1], d1 = cum[i];
  const segFrac = d1 > d0 ? (targetDist - d0) / (d1 - d0) : 0;
  const p0 = points[i - 1], p1 = points[i];
  const lat = p0.lat + (p1.lat - p0.lat) * segFrac;
  const lon = p0.lon + (p1.lon - p0.lon) * segFrac;
  const ele = (p0.ele != null && p1.ele != null)
    ? p0.ele + (p1.ele - p0.ele) * segFrac
    : (p0.ele ?? p1.ele ?? null);
  return { lat, lon, ele, idx: i, bearing: bearingBetween(p0, p1) };
}

// Raw GPS-logged tracks can carry many thousands of points (a multi-hour hike logged
// every second or two). Leaflet re-projects every point of every visible vector layer
// on each camera move — with a flyover panning 60x/sec, an unthinned track makes that
// the dominant cost by far, dwarfing anything else in the frame. Rendering/animation only
// needs enough points to look like the real trail, so we thin here; full-precision `points`
// is still used for stats (distance/elevation), which only run once, not per frame.
export function decimate(points, maxPoints = 500) {
  if (points.length <= maxPoints) return points;
  const step = (points.length - 1) / (maxPoints - 1);
  const out = [];
  for (let i = 0; i < maxPoints; i++) out.push(points[Math.round(i * step)]);
  return out;
}

// 2026-09-17: ×2.0 baked in here (was a one-off ×1.6, then ×2.0, applied only
// at the 3D terrain flyover's call site in HikeMap.jsx) — explicit direction
// that this slower pace is now the standard for every hike flyover, 2D
// included, not just the two 3D test hikes. Locked into the shared function
// itself rather than left as a multiplier at each call site.
export function flyoverDurationMs(totalMeters) {
  return 2.0 * Math.min(24000, Math.max(8000, 8000 + (totalMeters / 1000) * 1200));
}

// Grows `line` incrementally (Leaflet polyline) as `idx` advances past `state.committedIdx`,
// instead of rebuilding the whole path every frame — O(new points) instead of O(track length).
// On a rewind (scrub backward, or a restart after finishing) `idx` drops below the
// previously committed length; without resetting here, the line stays fully drawn from the
// prior run and the caller's "tip" segment ends up connecting the current position to a
// stale point near the end of the track — a bogus straight line cutting across the map.
export function growTravelLine(line, latlngs, idx, state) {
  if (idx > state.committedIdx) {
    for (let k = state.committedIdx; k < idx; k++) line.addLatLng(latlngs[k]);
    state.committedIdx = idx;
  } else if (idx < state.committedIdx) {
    line.setLatLngs(latlngs.slice(0, idx));
    state.committedIdx = idx;
  }
}
