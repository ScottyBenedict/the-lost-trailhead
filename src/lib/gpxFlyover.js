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
    if (!isNaN(lat) && !isNaN(lon)) points.push({ lat, lon, ele });
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

export function flyoverDurationMs(totalMeters) {
  return Math.min(24000, Math.max(8000, 8000 + (totalMeters / 1000) * 1200));
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
