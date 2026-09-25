import { useEffect, useRef, useState, useCallback } from 'react';
import { parseGPX, haversineM, buildCumulative, positionAt, flyoverDurationMs, growTravelLine, decimate, trimToTrailStart } from '../lib/gpxFlyover';

// Trailing "drone following behind" camera (see terrainFlyover.js) — under
// test on one hike before any wider rollout. Placement from offline
// simulation against Cascade's real GPX and terrain:
//  - 50ft back / 100ft up (the original ask) lost the hiker from frame 61%
//    of the flight; 100m / 200m (same 63° angle) kept them but read as far
//    too fast and too top-down to show the surrounding terrain.
//  - Shallow ~30° trailing angles went into the mountain on the descent
//    (behind the hiker is uphill there) and lost the hiker behind ridges on
//    up to 38% of frames.
//  - 900m range at 38° down is the shallowest angle that clears Cascade's
//    slopes everywhere, never loses the hiker, and slides/jerks the image
//    less than the default side-on camera does.
//  - Descending, the camera looks down a slope falling away from it, and the
//    switchback stack's on-screen height dropped to less than half the
//    ascent's (0.06 vs 0.13 of the frame) — legs blurring together. Rising
//    to 60° during the summit orbit recovers most of it (0.11).
//  - closeRange: the opening shot (and, after the camera comes back around,
//    the closing one) — the flight pulls back from it to `range` as it starts.
const TRAILING_CAMERA_TEST = {
  'cascade-pass-sahale-arm': { range: 900, closeRange: 400, pitchDeg: -38, descentPitchDeg: -60 },
  // A loop: no turnaround, so no descent pitch — the camera trails the
  // direction of travel all the way round.
  'maple-pass-loop': { range: 900, closeRange: 400, pitchDeg: -38 },
  // Out-and-backs like Cascade, so the same shot, descent pitch included.
  'rattlesnake-ledge': { range: 900, closeRange: 400, pitchDeg: -38, descentPitchDeg: -60 },
  'rachel-rampart-lakes': { range: 900, closeRange: 400, pitchDeg: -38, descentPitchDeg: -60 },
  'lake-serene': { range: 900, closeRange: 400, pitchDeg: -38, descentPitchDeg: -60 },
  'hidden-lake': { range: 900, closeRange: 400, pitchDeg: -38, descentPitchDeg: -60 },
  'colchuck-lake': { range: 900, closeRange: 400, pitchDeg: -38, descentPitchDeg: -60 },
  'lake-ingalls': { range: 900, closeRange: 400, pitchDeg: -38, descentPitchDeg: -60 },
  // Kendall only: its long, fast flight briefly lost the hiker as the camera
  // came back in for the closing shot (see maxAimOffset in terrainFlyover.js).
  'kendall-katwalk': { range: 900, closeRange: 400, pitchDeg: -38, descentPitchDeg: -60, maxAimOffset: 0.3 },
  // The road to this one was washed out 1.6 mi below the trailhead; the
  // track is trimmed to the trail (see TRAIL_START in gpxFlyover.js), which
  // also brings the flight back under the speed where it starts to jitter.
  'blanca-lake': { range: 900, closeRange: 400, pitchDeg: -38, descentPitchDeg: -60 },
  'granite-mountain': { range: 900, closeRange: 400, pitchDeg: -38, descentPitchDeg: -60 },
  'melakwa-lake': { range: 900, closeRange: 400, pitchDeg: -38, descentPitchDeg: -60 },
  'dirty-harrys-balcony': { range: 900, closeRange: 400, pitchDeg: -38, descentPitchDeg: -60 },
  'garfield-ledges': { range: 900, closeRange: 400, pitchDeg: -38, descentPitchDeg: -60 },
  'garfield-ledges-winter': { range: 900, closeRange: 400, pitchDeg: -38, descentPitchDeg: -60 },
  'hex-mountain-winter': { range: 900, closeRange: 400, pitchDeg: -38, descentPitchDeg: -60 },
  'lake-valhalla': { range: 900, closeRange: 400, pitchDeg: -38, descentPitchDeg: -60 },
  'mt-baldy': { range: 900, closeRange: 400, pitchDeg: -38, descentPitchDeg: -60 },
  'annette-lake': { range: 900, closeRange: 400, pitchDeg: -38, descentPitchDeg: -60 },
};

// Per-hike flight length, in seconds, for a hike long enough that
// flyoverDurationMs's 48s cap would push its pace well past the others'
// (~300 m/s). Kendall's flight path is ~20km: at 48s it ran 418 m/s, and the
// trailing camera's aim (an average over a few seconds of the flight) swung
// far enough on bends to jitter and briefly lose the hiker. 64s is the pace
// the uncapped formula gives it. Rule going forward: a flight over 60s gets
// flagged to Scott before it ships, to decide between the longer flight
// and a faster one. Raised to 75 on 2026-09-25 (Scott's call): the eased
// playback's faster cruise and FLIGHT_SPEEDUP in terrainFlyover.js put it
// back at ~385 m/s, rushed next to the others; 75 plays in ~68s.
const FLIGHT_SECONDS = {
  'kendall-katwalk': 75,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function computeStats(points) {
  let dist = 0, gain = 0, loss = 0, maxEle = -Infinity, minEle = Infinity;
  for (let i = 1; i < points.length; i++) {
    dist += haversineM(points[i-1], points[i]);
    if (points[i].ele != null && points[i-1].ele != null) {
      const diff = points[i].ele - points[i-1].ele;
      if (diff > 0) gain += diff; else loss += Math.abs(diff);
    }
  }
  points.forEach(p => {
    if (p.ele != null) { if (p.ele > maxEle) maxEle = p.ele; if (p.ele < minEle) minEle = p.ele; }
  });
  const ft = m => Math.round(m * 3.28084);
  const mi = m => (m * 0.000621371).toFixed(1);
  return {
    distM: dist,
    distMi: mi(dist),
    gainFt: ft(gain),
    lossFt: ft(loss),
    maxFt: maxEle === -Infinity ? null : ft(maxEle),
    minFt: minEle === Infinity ? null : ft(minEle),
  };
}

function computeElevationScale(canvas, points) {
  const W = canvas.offsetWidth;
  const H = canvas.offsetHeight;
  const eles = points.map(p => p.ele != null ? p.ele * 3.28084 : null).filter(v => v != null);
  const minE = Math.min(...eles), maxE = Math.max(...eles);
  const range = maxE - minE || 1;
  const pad = { t: 6, b: 6 };
  const h = H - pad.t - pad.b;
  return {
    W, H,
    x: (frac) => frac * W,
    y: (eleM) => pad.t + (1 - ((eleM * 3.28084) - minE) / range) * h,
  };
}

function drawElevationCanvas(canvas, points, scale) {
  if (!canvas || points.length < 2) return;
  const dpr = window.devicePixelRatio || 1;
  const W = scale.W, H = scale.H;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const eles = points.map(p => p.ele);
  const pad = { l: 0, r: 0 };
  const w = W - pad.l - pad.r;
  // Distance-based, not index-based: this GPX logs at a roughly constant
  // *time* interval, not distance, so real hiking pace (slower on a climb,
  // near switchbacks, or pausing at an overlook) makes index-fraction and
  // real distance-fraction diverge — sometimes a lot. The live playback
  // indicator (drawIndicator, via scale.x) already positions itself by real
  // distance fraction, same as the camera/marker everywhere else in this
  // file; this curve needs the same basis or the two visibly disagree
  // wherever pace wasn't uniform, which is exactly what "doesn't track"
  // looked like.
  const cum = buildCumulative(points);
  const total = cum[cum.length - 1] || 1;
  const xAt = (i) => pad.l + (cum[i] / total) * w;

  const fill = new Path2D();
  eles.forEach((e, i) => i === 0 ? fill.moveTo(xAt(i), scale.y(e)) : fill.lineTo(xAt(i), scale.y(e)));
  fill.lineTo(xAt(eles.length - 1), H);
  fill.lineTo(pad.l, H);
  fill.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(255,255,255,0.25)');
  grad.addColorStop(1, 'rgba(255,255,255,0.03)');
  ctx.fillStyle = grad;
  ctx.fill(fill);

  ctx.beginPath();
  eles.forEach((e, i) => i === 0 ? ctx.moveTo(xAt(i), scale.y(e)) : ctx.lineTo(xAt(i), scale.y(e)));
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

// Sizes the overlay canvas once; per-frame draws only clear + redraw (no resize),
// since resizing a canvas forces a full reset and is expensive to do every animation frame.
function setupIndicatorCanvas(canvas, scale) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = scale.W * dpr;
  canvas.height = scale.H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return ctx;
}

function drawIndicator(ctx, scale, frac, eleM) {
  if (!ctx || !scale) return;
  ctx.clearRect(0, 0, scale.W, scale.H);
  const x = scale.x(frac);
  ctx.strokeStyle = 'rgba(255,209,102,0.85)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, scale.H);
  ctx.stroke();
  if (eleM != null) {
    const y = scale.y(eleM);
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd166';
    ctx.fill();
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function HikeMap({ gpxUrl, hikeName, hikeDistance, hikeGain, hikeId }) {
  // 2026-09-17: rolled out to every hike after camera behavior (including
  // loop-shaped routes like Maple Pass Loop) was confirmed working —
  // previously gated to a small allowlist (terrain3dTestHikes.js, now
  // removed) while that was still being tested.
  const USE_TERRAIN_3D = true;

  // Curated distance (e.g. "4.0 mi"), converted once to meters so the live
  // progress readout during playback can scale against it — see onProgress
  // below and the matching DISTANCE stat fix further down.
  const hikeDistanceMeters = hikeDistance ? parseFloat(hikeDistance) / 0.000621371 : null;

  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null); // Leaflet map instance — 2D path only
  const flyoverRef = useRef(null); // TerrainFlyover instance — 3D path only
  const canvasRef = useRef(null);
  const indicatorRef = useRef(null);
  const flyDataRef = useRef(null);
  const rafRef = useRef(null);
  const startTimeRef = useRef(null);
  const lastUiUpdateRef = useRef(0);
  const lastLineUpdateRef = useRef(0);

  const [stats, setStats] = useState(null);
  // The stats row is four columns of inline styles, so a media query cannot
  // reach it. On a phone those columns get about 47px of text each once the
  // padding is off, which wraps "ELEVATION GAIN" and pushes its value out of
  // the frame — the labels showed with no numbers under them.
  const [narrowStats, setNarrowStats] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 559px)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 559px)');
    const sync = () => setNarrowStats(mq.matches);
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [flying, setFlying] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [liveDist, setLiveDist] = useState(null);
  const [liveEle, setLiveEle] = useState(null);

  // Runs every rAF frame during playback. The marker is a cheap single-point update so it
  // runs every frame for smooth 60fps motion. The camera does NOT move — the map stays on
  // its initial fitBounds view for the whole flyover (matching the small preview card).
  // An earlier version panned/zoomed the camera to follow the marker, but that read as
  // "janky" regardless of how smoothly it was implemented — keeping the view fixed and
  // letting the marker travel across it is simpler and was the better call. The
  // traveled-line path is NOT cheap: Leaflet's SVG renderer re-projects and rebuilds the
  // entire path string on every mutation (addLatLng included — there's no true incremental
  // append), so its cost grows with how much trail is already drawn. Left unthrottled it
  // was a real source of stutter, worsening as playback progressed. Throttling it to
  // ~20/sec keeps that cost bounded while staying visually smooth (it's a trailing
  // highlight, not the focal motion). The React state driving the slider/readout text is
  // throttled separately since re-rendering on every frame is pure overhead with no
  // visible benefit.
  // Shared between both renderers — the throttle window matters for the
  // continuous 60fps animation loop and is harmless (imperceptible) for the
  // discrete restart/scrub calls that also go through it.
  const updateUiThrottled = useCallback((frac, ele, distM, { force = false } = {}) => {
    const now = performance.now();
    if (force || frac >= 1 || now - lastUiUpdateRef.current > 66) {
      lastUiUpdateRef.current = now;
      setProgressPct(Math.round(frac * 100));
      setLiveDist((distM * 0.000621371).toFixed(1));
      setLiveEle(ele != null ? Math.round(ele * 3.28084) : null);
    }
  }, []);

  // 2D (Leaflet) path only — the 3D path's per-frame work lives inside
  // TerrainFlyover itself; see its onProgress callback in init() below.
  const applyFrame = useCallback((frac, { force = false } = {}) => {
    const d = flyDataRef.current;
    if (!d) return;
    const { lat, lon, ele, idx } = positionAt(d.points, d.cum, d.total, frac, d.posHint);

    d.flyMarker.setLatLng([lat, lon]);
    drawIndicator(d.indicatorCtx, d.scale, frac, ele);

    const now = performance.now();
    if (force || frac >= 1 || now - lastLineUpdateRef.current > 50) {
      lastLineUpdateRef.current = now;
      growTravelLine(d.travelLine, d.latlngs, idx, d.committed);
      const tailFrom = d.latlngs[Math.max(d.committed.committedIdx - 1, 0)];
      d.travelTip.setLatLngs([tailFrom, [lat, lon]]);
    }

    updateUiThrottled(frac, ele, frac * d.total, { force });
  }, [updateUiThrottled]);

  const stopFlyover = useCallback(() => {
    if (USE_TERRAIN_3D) {
      flyoverRef.current?.pause();
    } else if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setFlying(false);
  }, [USE_TERRAIN_3D]);

  // stepRef holds the latest `step` so the rAF recursion below can call
  // forward to it without referencing `step` before its own declaration
  // finishes (which also means each render's recursion always resumes with
  // that render's applyFrame/stopFlyover, not a stale closure).
  const stepRef = useRef(null);
  const step = useCallback((ts) => {
    const d = flyDataRef.current;
    if (!d) return;
    if (startTimeRef.current == null) startTimeRef.current = ts;
    const elapsed = ts - startTimeRef.current;
    const frac = Math.min(1, elapsed / d.durationMs);
    applyFrame(frac);
    if (frac < 1) {
      rafRef.current = requestAnimationFrame(stepRef.current);
    } else {
      stopFlyover();
    }
  }, [applyFrame, stopFlyover]);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  const playFlyover = useCallback(() => {
    if (USE_TERRAIN_3D) {
      if (!flyoverRef.current) return;
      flyoverRef.current.play();
      setFlying(true);
      return;
    }
    const d = flyDataRef.current;
    if (!d) return;
    const startFrac = progressPct >= 100 ? 0 : progressPct / 100;
    startTimeRef.current = performance.now() - startFrac * d.durationMs;
    setFlying(true);
    rafRef.current = requestAnimationFrame(step);
  }, [progressPct, step, USE_TERRAIN_3D]);

  const restartFlyover = useCallback(() => {
    if (USE_TERRAIN_3D) {
      if (!flyoverRef.current) return;
      flyoverRef.current.restart();
      setProgressPct(0);
      setFlying(true);
      return;
    }
    setProgressPct(0);
    applyFrame(0, { force: true });
    playFlyover();
  }, [applyFrame, playFlyover, USE_TERRAIN_3D]);

  const scrub = useCallback((pct) => {
    if (USE_TERRAIN_3D) {
      flyoverRef.current?.scrubTo(pct / 100);
      setFlying(false);
      setProgressPct(pct);
      return;
    }
    if (flying) stopFlyover();
    setProgressPct(pct);
    applyFrame(pct / 100, { force: true });
  }, [flying, stopFlyover, applyFrame, USE_TERRAIN_3D]);

  useEffect(() => {
    if (!gpxUrl) return;

    let cancelled = false;

    async function init() {
      try {
        const res = await fetch(gpxUrl);
        if (!res.ok) throw new Error('Failed to fetch GPX');
        const text = await res.text();
        if (cancelled) return;

        // Trimmed where the recording starts below the trailhead (Blanca's
        // washed-out road) — the stats and the chart then describe the hike
        // the flyover is actually showing.
        const points = trimToTrailStart(parseGPX(text), hikeId);
        if (points.length === 0) throw new Error('No track points found');

        const computed = computeStats(points);
        setStats(computed);
        setLoading(false);

        // Full-precision `points` feeds the stats above and the elevation chart below
        // (both one-time computations). Rendering and the flyover animation run 60x/sec
        // and don't need thousands of raw GPS points to look right — see decimate().
        const renderPoints = decimate(points);

        if (USE_TERRAIN_3D) {
          if (flyoverRef.current) {
            flyoverRef.current.destroy();
            flyoverRef.current = null;
          }
          // Dynamic import (matching the existing Leaflet import below) keeps
          // Cesium's JS out of the main bundle entirely when this toggle is off —
          // not just unused, genuinely never fetched. CESIUM_BASE_URL must be set
          // before this import resolves (Cesium reads it at module-init time to
          // find its own Workers/Assets, copied by vite-plugin-static-copy — see
          // vite.config.js); setting it here, immediately before a real dynamic
          // import(), guarantees that ordering without needing a separate <script>
          // tag the way the no-build-step spike required.
          window.CESIUM_BASE_URL = '/cesium/';
          const { TerrainFlyover } = await import('../lib/terrainFlyover');
          // Previously ran ×1.6, then ×2.0, slower than the plain shared
          // formula here specifically — a close-in, ground-level camera
          // covering the same real-world distance read as faster motion than
          // the flat top-down 2D view at the same duration. That extra
          // slowdown is now baked into flyoverDurationMs itself (2026-09-17,
          // explicit direction that this pace is the standard for every
          // hike flyover, not a 3D-only special case) — no multiplier here.
          const total3d = buildCumulative(points).at(-1);
          flyoverRef.current = new TerrainFlyover(mapRef.current, {
            // Full-precision points, not the decimated renderPoints used below for
            // Leaflet — decimation exists only to bound Leaflet's per-frame SVG
            // re-projection cost (see gpxFlyover.js's decimate() comment) and
            // doesn't apply to Cesium's one-time static WebGL line; using it here
            // was throwing away real resolution the drawn track needs.
            points,
            durationMs: FLIGHT_SECONDS[hikeId] ? FLIGHT_SECONDS[hikeId] * 1000 : flyoverDurationMs(total3d),
            camera: TRAILING_CAMERA_TEST[hikeId] ? { trailing: TRAILING_CAMERA_TEST[hikeId] } : undefined,
            onProgress: ({ frac, ele, distM }) => {
              drawIndicator(flyDataRef.current?.indicatorCtx, flyDataRef.current?.scale, frac, ele);
              // Scaled against the same curated hike distance shown in the stats
              // footer/page header, not TerrainFlyover's own `distM` (real length
              // of the flowing/smoothed camera path) — otherwise the live readout
              // during playback and the final DISTANCE stat disagree, the same
              // mismatch already fixed for the stats footer itself (see the stats
              // array below).
              const scaledDistM = hikeDistanceMeters != null ? frac * hikeDistanceMeters : distM;
              // Forced at 0: the reset on finish (below) lands in the same
              // instant as the final frame's update and would be throttled,
              // leaving the readout stuck at the end.
              updateUiThrottled(frac, ele, scaledDistM, { force: frac === 0 });
            },
            // At the end, go back to the opening frame, ready to play again,
            // rather than holding on the last frame with a restart button.
            onFinish: () => {
              flyoverRef.current?.scrubTo(0);
              setFlying(false);
            },
          });
          // Only the elevation-chart fields are needed in the 3D path — the
          // setTimeout block below (shared with the 2D path) fills these in.
          flyDataRef.current = { scale: null, indicatorCtx: null };
        } else {
          const L = (await import('leaflet')).default;
          await import('leaflet/dist/leaflet.css');

          if (mapInstanceRef.current) {
            mapInstanceRef.current.remove();
            mapInstanceRef.current = null;
          }

          const map = L.map(mapRef.current, { zoomControl: true, attributionControl: true });
          mapInstanceRef.current = map;

          L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenTopoMap, © OpenStreetMap contributors',
            maxZoom: 17,
          }).addTo(map);

          const latlngs = renderPoints.map(p => [p.lat, p.lon]);

          const line = L.polyline(latlngs, {
            color: '#ffffff',
            weight: 2,
            opacity: 0.4,
          }).addTo(map);

          L.circleMarker(latlngs[0], {
            radius: 5, color: '#ffffff', fillColor: '#ffffff', fillOpacity: 1, weight: 2
          }).bindPopup('Start').addTo(map);

          L.circleMarker(latlngs[latlngs.length - 1], {
            radius: 5, color: '#ffffff', fillColor: 'transparent', fillOpacity: 0, weight: 2
          }).bindPopup('End').addTo(map);

          map.fitBounds(line.getBounds(), { padding: [24, 24] });

          // ── Flyover setup ──
          const cum = buildCumulative(renderPoints);
          const total = cum[cum.length - 1];
          const durationMs = flyoverDurationMs(total);

          const travelLine = L.polyline([], { color: '#ffffff', weight: 4, opacity: 0.95 }).addTo(map);
          const travelTip = L.polyline([], { color: '#ffffff', weight: 4, opacity: 0.95 }).addTo(map);
          const flyMarker = L.circleMarker(latlngs[0], {
            radius: 6, color: '#ffffff', fillColor: '#ffd166', fillOpacity: 1, weight: 2,
          }).addTo(map);

          flyDataRef.current = {
            L, map, points: renderPoints, latlngs, cum, total, durationMs,
            line, travelLine, travelTip, flyMarker,
            posHint: { i: 1 },
            committed: { committedIdx: 0 },
            scale: null,
            indicatorCtx: null,
          };
        }

        setTimeout(() => {
          if (!flyDataRef.current) return;
          const scale = computeElevationScale(canvasRef.current, points);
          flyDataRef.current.scale = scale;
          flyDataRef.current.indicatorCtx = setupIndicatorCanvas(indicatorRef.current, scale);
          drawElevationCanvas(canvasRef.current, points, scale);
        }, 100);

      } catch (err) {
        if (!cancelled) setError(err.message);
        setLoading(false);
      }
    }

    init();
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      startTimeRef.current = null;
      flyDataRef.current = null;
      if (flyoverRef.current) {
        flyoverRef.current.destroy();
        flyoverRef.current = null;
      }
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [gpxUrl, updateUiThrottled, USE_TERRAIN_3D, hikeDistanceMeters, hikeId]);

  return (
    <section style={styles.section}>
      <p style={styles.sectionLabel}>Trail Map &amp; Flyover</p>

      <div className="hike-map-viewport" style={styles.mapWrapper}>
        {loading && (
          <div style={styles.loading}>
            <span style={styles.loadingText}>Loading trail data…</span>
          </div>
        )}
        {error && (
          <div style={styles.loading}>
            <span style={styles.loadingText}>Unable to load map: {error}</span>
          </div>
        )}
        <div
          ref={mapRef}
          role="img"
          aria-label={hikeName ? `${hikeName} route map` : 'Route map'}
          style={{ ...styles.map, opacity: loading || error ? 0 : 1 }}
        />

        {stats && !loading && !error && (
          <div style={styles.flyBar}>
            <button
              style={styles.flyPlayBtn}
              onClick={flying ? stopFlyover : (progressPct >= 100 ? restartFlyover : playFlyover)}
              aria-label={flying ? 'Pause flyover' : (progressPct >= 100 ? 'Restart flyover' : 'Play flyover')}
            >
              {flying ? '❚❚' : (progressPct >= 100 ? '↺' : '▶')}
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={progressPct}
              onChange={(e) => scrub(Number(e.target.value))}
              style={styles.flySlider}
              aria-label="Flyover progress"
            />
            <span style={styles.flyReadout}>
              {liveDist != null ? `${liveDist} mi` : '0.0 mi'}
              {liveEle != null ? ` · ${liveEle.toLocaleString()} ft` : ''}
            </span>
          </div>
        )}
      </div>

      {stats && (
        <div style={styles.footer}>
          <div style={narrowStats ? { ...styles.statsRow, ...styles.statsRowNarrow } : styles.statsRow}>
            {[
              // Distance and gain come from the same curated hike record shown in the
              // page header (src/data/hikes.js) — not recomputed from the raw GPX, which
              // runs high on both (full round-trip track length, and elevation gain
              // inflated by consumer-GPS/barometric noise accumulated over thousands of
              // points). Loss mirrors gain rather than using the raw computed value: on an
              // out-and-back trail the elevation climbed and descended are the same trail,
              // so showing a different, GPX-noise-derived loss figure next to the curated
              // gain would read as internally inconsistent. High point has no equivalent
              // curated field and the raw-computed value already checks out against the
              // hike's known summit elevation, so it's left as-is.
              { label: 'DISTANCE', value: hikeDistance || `${stats.distMi} mi` },
              { label: 'ELEVATION GAIN', value: hikeGain ? `+${hikeGain}` : `+${stats.gainFt.toLocaleString()} ft` },
              { label: 'ELEVATION LOSS', value: hikeGain ? `-${hikeGain}` : `-${stats.lossFt.toLocaleString()} ft` },
              { label: 'HIGH POINT', value: stats.maxFt ? `${stats.maxFt.toLocaleString()} ft` : '—' },
            ].map(({ label, value }) => (
              <div key={label} style={narrowStats ? { ...styles.stat, ...styles.statNarrow } : styles.stat}>
                <span style={styles.statLabel}>{label}</span>
                <span style={styles.statValue}>{value}</span>
              </div>
            ))}
          </div>
          <div style={styles.elevationWrapper}>
            <span style={styles.elevationLabel}>ELEVATION PROFILE</span>
            <div style={styles.elevationCanvasStack}>
              <canvas ref={canvasRef} style={styles.canvas} />
              <canvas ref={indicatorRef} style={{ ...styles.canvas, ...styles.indicatorCanvas }} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const FOREST = '#2a3a2c';
const FOREST_DARK = '#1f2c21';
const FOREST_LIGHT = '#374d39';
const WHITE = '#ffffff';
const WHITE_DIM = 'rgba(255,255,255,0.55)';

const styles = {
  section: {
    width: '100%',
    backgroundColor: FOREST,
    fontFamily: 'inherit',
  },
  sectionLabel: {
    padding: '22px 60px 18px 28px',
    fontSize: '0.95rem',
    fontFamily: "'Cormorant Garamond', serif",
    letterSpacing: '0.06em',
    color: WHITE,
    margin: 0,
  },
  mapWrapper: {
    // Height lives in index.css (.hike-map-viewport): it's capped to the
    // screen with an svh/vh fallback pair, which an inline style can't hold.
    position: 'relative',
    width: '100%',
  },
  map: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    transition: 'opacity 0.4s ease',
  },
  loading: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FOREST_DARK,
    zIndex: 10,
  },
  loadingText: {
    fontSize: '0.7rem',
    letterSpacing: '0.1em',
    color: WHITE_DIM,
  },
  flyBar: {
    position: 'absolute',
    left: '12px',
    right: '12px',
    bottom: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 12px',
    borderRadius: '999px',
    backgroundColor: 'rgba(20,28,22,0.78)',
    backdropFilter: 'blur(4px)',
    zIndex: 500,
  },
  flyPlayBtn: {
    flex: '0 0 auto',
    width: '30px',
    height: '30px',
    borderRadius: '50%',
    border: 'none',
    backgroundColor: WHITE,
    color: FOREST_DARK,
    fontSize: '0.75rem',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flySlider: {
    flex: 1,
    accentColor: '#ffd166',
    cursor: 'pointer',
  },
  flyReadout: {
    flex: '0 0 auto',
    fontSize: '0.65rem',
    letterSpacing: '0.04em',
    color: WHITE,
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
  },
  footer: {
    backgroundColor: FOREST_DARK,
    borderTop: `1px solid ${FOREST_LIGHT}`,
  },
  statsRow: {
    display: 'flex',
    borderBottom: `1px solid ${FOREST_LIGHT}`,
  },
  // Two by two on a phone: four across cannot show a label and its number.
  statsRowNarrow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
  },
  stat: {
    flex: 1,
    padding: '14px 20px',
    borderRight: `1px solid ${FOREST_LIGHT}`,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  statNarrow: {
    padding: '10px 14px',
    borderRight: 'none',
    borderTop: `1px solid ${FOREST_LIGHT}`,
  },
  statLabel: {
    fontSize: '0.58rem',
    letterSpacing: '0.12em',
    color: WHITE_DIM,
  },
  statValue: {
    fontSize: '1rem',
    color: WHITE,
    fontFamily: "'Cormorant Garamond', serif",
    fontWeight: '400',
  },
  elevationWrapper: {
    padding: '14px 20px 16px',
  },
  elevationLabel: {
    display: 'block',
    fontSize: '0.58rem',
    letterSpacing: '0.12em',
    color: WHITE_DIM,
    marginBottom: '8px',
  },
  elevationCanvasStack: {
    position: 'relative',
    width: '100%',
    height: '72px',
  },
  canvas: {
    display: 'block',
    width: '100%',
    height: '72px',
  },
  indicatorCanvas: {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
  },
};
