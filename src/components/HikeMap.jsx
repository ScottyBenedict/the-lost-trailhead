import { useEffect, useRef, useState, useCallback } from 'react';
import { parseGPX, haversineM, buildCumulative, positionAt, flyoverDurationMs, growTravelLine, decimate } from '../lib/gpxFlyover';

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
  const xAt = (i) => pad.l + (i / (eles.length - 1)) * w;

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

export default function HikeMap({ gpxUrl, hikeName }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const canvasRef = useRef(null);
  const indicatorRef = useRef(null);
  const flyDataRef = useRef(null);
  const rafRef = useRef(null);
  const startTimeRef = useRef(null);
  const lastUiUpdateRef = useRef(0);
  const lastLineUpdateRef = useRef(0);

  const [stats, setStats] = useState(null);
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

    if (force || frac >= 1 || now - lastUiUpdateRef.current > 66) {
      lastUiUpdateRef.current = now;
      setProgressPct(Math.round(frac * 100));
      setLiveDist((frac * d.total * 0.000621371).toFixed(1));
      setLiveEle(ele != null ? Math.round(ele * 3.28084) : null);
    }
  }, []);

  const stopFlyover = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setFlying(false);
  }, []);

  const step = useCallback((ts) => {
    const d = flyDataRef.current;
    if (!d) return;
    if (startTimeRef.current == null) startTimeRef.current = ts;
    const elapsed = ts - startTimeRef.current;
    const frac = Math.min(1, elapsed / d.durationMs);
    applyFrame(frac);
    if (frac < 1) {
      rafRef.current = requestAnimationFrame(step);
    } else {
      stopFlyover();
    }
  }, [applyFrame, stopFlyover]);

  const playFlyover = useCallback(() => {
    const d = flyDataRef.current;
    if (!d) return;
    const startFrac = progressPct >= 100 ? 0 : progressPct / 100;
    startTimeRef.current = performance.now() - startFrac * d.durationMs;
    setFlying(true);
    rafRef.current = requestAnimationFrame(step);
  }, [progressPct, step]);

  const restartFlyover = useCallback(() => {
    setProgressPct(0);
    applyFrame(0, { force: true });
    playFlyover();
  }, [applyFrame, playFlyover]);

  const scrub = useCallback((pct) => {
    if (flying) stopFlyover();
    setProgressPct(pct);
    applyFrame(pct / 100, { force: true });
  }, [flying, stopFlyover, applyFrame]);

  useEffect(() => {
    if (!gpxUrl) return;

    let cancelled = false;

    async function init() {
      try {
        const L = (await import('leaflet')).default;
        await import('leaflet/dist/leaflet.css');

        const res = await fetch(gpxUrl);
        if (!res.ok) throw new Error('Failed to fetch GPX');
        const text = await res.text();
        if (cancelled) return;

        const points = parseGPX(text);
        if (points.length === 0) throw new Error('No track points found');

        const computed = computeStats(points);
        setStats(computed);
        setLoading(false);

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

        // Full-precision `points` feeds the stats above and the elevation chart below
        // (both one-time computations). Rendering and the flyover animation run 60x/sec
        // and don't need thousands of raw GPS points to look right — see decimate().
        const renderPoints = decimate(points);
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
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [gpxUrl]);

  return (
    <section style={styles.section}>
      <p style={styles.sectionLabel}>Trail Map &amp; Flyover</p>

      <div style={styles.mapWrapper}>
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
        <div ref={mapRef} style={{ ...styles.map, opacity: loading || error ? 0 : 1 }} />

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
          <div style={styles.statsRow}>
            {[
              { label: 'DISTANCE', value: `${stats.distMi} mi` },
              { label: 'ELEVATION GAIN', value: `+${stats.gainFt.toLocaleString()} ft` },
              { label: 'ELEVATION LOSS', value: `-${stats.lossFt.toLocaleString()} ft` },
              { label: 'HIGH POINT', value: stats.maxFt ? `${stats.maxFt.toLocaleString()} ft` : '—' },
            ].map(({ label, value }) => (
              <div key={label} style={styles.stat}>
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
    position: 'relative',
    width: '100%',
    height: '420px',
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
  stat: {
    flex: 1,
    padding: '14px 20px',
    borderRight: `1px solid ${FOREST_LIGHT}`,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
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
