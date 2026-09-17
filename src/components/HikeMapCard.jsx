import { useEffect, useRef, useState } from 'react';
import { parseGPX, buildCumulative, positionAt, growTravelLine, decimate } from '../lib/gpxFlyover';
import { TERRAIN_3D_TEST_HIKE_IDS } from '../lib/terrain3dTestHikes';

const PLAY_MS = 15210; // 9s base, slowed 30% then another 30% per feedback

export default function HikeMapCard({ gpxUrl, onOpen, hikeId }) {
  // Only hikes explicitly under test get the 3D Cesium flyover (see
  // terrain3dTestHikes.js) — everything else uses the shipped 2D flyover.
  const USE_TERRAIN_3D = TERRAIN_3D_TEST_HIKE_IDS.has(hikeId);

  const rootRef = useRef(null);
  const mapDivRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const flyoverRef = useRef(null); // TerrainFlyover instance — 3D path only
  const rafRef = useRef(null);
  const visibleRef = useRef(true);
  const playRef = useRef(null);
  const [finished, setFinished] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!gpxUrl) return;
    let cancelled = false;
    setFinished(false);

    async function init() {
      try {
        const res = await fetch(gpxUrl);
        if (!res.ok) return;
        const text = await res.text();
        if (cancelled) return;

        const fullPoints = parseGPX(text);
        if (fullPoints.length === 0) return;

        if (USE_TERRAIN_3D) {
          // Static preview only — per explicit product direction, the 3D card
          // should never animate on its own, only on click (which opens the
          // lightbox / HikeMap.jsx, a separate TerrainFlyover instance that
          // does play). `topDownPreview` gives this instance a straight-down
          // plan view fit to the whole route instead of the lightbox's
          // cinematic chase-cam frame — a different job (map, not flyover) for
          // a card that never actually flies over anything itself. Deliberately
          // never call .play() here, and the IntersectionObserver below no
          // longer does either (it used to resume playback on scroll-into-view,
          // which would have silently violated "never unless clicked").
          window.CESIUM_BASE_URL = '/cesium/';
          const { TerrainFlyover } = await import('../lib/terrainFlyover');
          flyoverRef.current = new TerrainFlyover(mapDivRef.current, {
            // Full precision, not decimated (see the 2D `points` below) —
            // decimation exists only to bound Leaflet's per-frame SVG
            // re-projection cost and doesn't apply to Cesium's one-time static
            // WebGL line.
            points: fullPoints,
            durationMs: PLAY_MS,
            onProgress: () => {},
            topDownPreview: true,
          });
          return; // skip the Leaflet setup below entirely
        }

        const L = (await import('leaflet')).default;
        await import('leaflet/dist/leaflet.css');

        const points = decimate(fullPoints);
        const latlngs = points.map(p => [p.lat, p.lon]);
        const cum = buildCumulative(points);
        const total = cum[cum.length - 1];

        const map = L.map(mapDivRef.current, {
          zoomControl: false,
          attributionControl: false,
          dragging: false,
          scrollWheelZoom: false,
          doubleClickZoom: false,
          keyboard: false,
          touchZoom: false,
          tap: false,
          boxZoom: false,
        });
        mapInstanceRef.current = map;

        L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17 }).addTo(map);

        L.polyline(latlngs, { color: '#ffffff', weight: 2, opacity: 0.35 }).addTo(map);
        const travelLine = L.polyline([], { color: '#ffffff', weight: 3, opacity: 0.95 }).addTo(map);
        const travelTip = L.polyline([], { color: '#ffffff', weight: 3, opacity: 0.95 }).addTo(map);
        const marker = L.circleMarker(latlngs[0], {
          radius: 4, color: '#ffffff', fillColor: '#ffd166', fillOpacity: 1, weight: 2,
        }).addTo(map);

        const bounds = L.latLngBounds(latlngs);
        map.fitBounds(bounds, { padding: [16, 16] });
        setTimeout(() => {
          if (cancelled || !mapInstanceRef.current) return;
          map.invalidateSize();
          map.fitBounds(bounds, { padding: [16, 16] });
        }, 50);

        // Ambient preview — same interpolation approach as the full flyover, just
        // chrome-free. Plays once on load (or on replay), not on a loop. Pauses while
        // scrolled off-screen.
        const posHint = { i: 1 };
        const committed = { committedIdx: 0 };
        let startTime = null;
        let lastLineUpdate = 0;

        function frame(ts) {
          if (!mapInstanceRef.current) return;
          if (!visibleRef.current) { startTime = null; rafRef.current = requestAnimationFrame(frame); return; }
          if (startTime == null) startTime = ts;
          const frac = Math.min(1, (ts - startTime) / PLAY_MS);
          const { lat, lon, idx } = positionAt(points, cum, total, frac, posHint);
          marker.setLatLng([lat, lon]);
          // Throttled: Leaflet's SVG path rebuild cost grows with the drawn line, so
          // updating it at ~20/sec (vs. every frame) keeps this cheap — see HikeMap.jsx.
          if (frac >= 1 || ts - lastLineUpdate > 50) {
            lastLineUpdate = ts;
            growTravelLine(travelLine, latlngs, idx, committed);
            const tailFrom = latlngs[Math.max(committed.committedIdx - 1, 0)];
            travelTip.setLatLngs([tailFrom, [lat, lon]]);
          }
          if (frac < 1) {
            rafRef.current = requestAnimationFrame(frame);
          } else {
            setPlaying(false);
            setFinished(true);
          }
        }

        function play() {
          if (cancelled) return;
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          startTime = null;
          posHint.i = 1;
          committed.committedIdx = 0;
          travelLine.setLatLngs([]);
          travelTip.setLatLngs([]);
          setFinished(false);
          setPlaying(true);
          rafRef.current = requestAnimationFrame(frame);
        }

        playRef.current = play;
        play();

      } catch (_) { /* silent */ }
    }

    init();

    let observer;
    if (rootRef.current && 'IntersectionObserver' in window) {
      observer = new IntersectionObserver(([entry]) => {
        visibleRef.current = entry.isIntersecting; // read by the 2D path's own frame() loop; irrelevant to the static 3D card
      }, { threshold: 0.1 });
      observer.observe(rootRef.current);
    }

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (observer) observer.disconnect();
      if (flyoverRef.current) {
        flyoverRef.current.destroy();
        flyoverRef.current = null;
      }
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [gpxUrl, USE_TERRAIN_3D]);

  return (
    <div ref={rootRef} className="gallery-item map-card" onClick={onOpen}>
      <div ref={mapDivRef} className="map-card-canvas" />
      {!playing && !finished && (
        <div className="map-card-overlay">
          {/* No play affordance on the 3D card — it's a static top-down map, not
              an inline player; clicking opens the animated flyover in the
              lightbox instead. The 2D fallback path still auto-plays in place,
              where a play/pause-style badge actually reflects what happens. */}
          {!USE_TERRAIN_3D && (
            <div className="map-card-play" aria-hidden="true">▶</div>
          )}
        </div>
      )}
      {finished && (
        <button
          className="map-card-replay"
          onClick={e => { e.stopPropagation(); playRef.current?.(); }}
          aria-label="Replay flyover preview"
        >
          ↺
        </button>
      )}
      <span className="map-card-caption">TRAIL MAP &amp; FLYOVER</span>
    </div>
  );
}
