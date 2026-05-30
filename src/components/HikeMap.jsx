import { useEffect, useRef, useState } from 'react';

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseGPX(text) {
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

function haversineM(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const s = Math.sin(dLat/2)**2 + Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1-s));
}

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
    distMi: mi(dist),
    gainFt: ft(gain),
    lossFt: ft(loss),
    maxFt: maxEle === -Infinity ? null : ft(maxEle),
    minFt: minEle === Infinity ? null : ft(minEle),
  };
}

function drawElevationCanvas(canvas, points) {
  if (!canvas || points.length < 2) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth;
  const H = canvas.offsetHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const eles = points.map(p => p.ele != null ? p.ele * 3.28084 : null).filter(Boolean);
  const minE = Math.min(...eles), maxE = Math.max(...eles);
  const range = maxE - minE || 1;
  const pad = { t: 6, b: 6, l: 0, r: 0 };
  const w = W - pad.l - pad.r, h = H - pad.t - pad.b;

  const x = (i) => pad.l + (i / (eles.length - 1)) * w;
  const y = (e) => pad.t + (1 - (e - minE) / range) * h;

  const fill = new Path2D();
  eles.forEach((e, i) => i === 0 ? fill.moveTo(x(i), y(e)) : fill.lineTo(x(i), y(e)));
  fill.lineTo(x(eles.length - 1), pad.t + h);
  fill.lineTo(pad.l, pad.t + h);
  fill.closePath();
  const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + h);
  grad.addColorStop(0, 'rgba(255,255,255,0.25)');
  grad.addColorStop(1, 'rgba(255,255,255,0.03)');
  ctx.fillStyle = grad;
  ctx.fill(fill);

  ctx.beginPath();
  eles.forEach((e, i) => i === 0 ? ctx.moveTo(x(i), y(e)) : ctx.lineTo(x(i), y(e)));
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function HikeMap({ gpxUrl, hikeName }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const canvasRef = useRef(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!gpxUrl) return;

    let L;
    let cancelled = false;

    async function init() {
      try {
        L = (await import('leaflet')).default;
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

        const latlngs = points.map(p => [p.lat, p.lon]);

        const line = L.polyline(latlngs, {
          color: '#ffffff',
          weight: 2.5,
          opacity: 0.9,
        }).addTo(map);

        L.circleMarker(latlngs[0], {
          radius: 5, color: '#ffffff', fillColor: '#ffffff', fillOpacity: 1, weight: 2
        }).bindPopup('Start').addTo(map);

        L.circleMarker(latlngs[latlngs.length - 1], {
          radius: 5, color: '#ffffff', fillColor: 'transparent', fillOpacity: 0, weight: 2
        }).bindPopup('End').addTo(map);

        map.fitBounds(line.getBounds(), { padding: [24, 24] });

        setTimeout(() => drawElevationCanvas(canvasRef.current, points), 100);

      } catch (err) {
        if (!cancelled) setError(err.message);
        setLoading(false);
      }
    }

    init();
    return () => {
      cancelled = true;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [gpxUrl]);

  return (
    <section style={styles.section}>
      <p style={styles.sectionLabel}>TRAIL MAP</p>

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
            <canvas ref={canvasRef} style={styles.canvas} />
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
    padding: '20px 28px 0',
    fontSize: '0.65rem',
    letterSpacing: '0.14em',
    color: WHITE_DIM,
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
  canvas: {
    display: 'block',
    width: '100%',
    height: '72px',
  },
};
