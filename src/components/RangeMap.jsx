import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

// Washington's bounding box: anything outside it (the two Arizona hikes) is
// counted in a note instead of pinned.
const WASHINGTON = { south: 45.5, north: 49.05, west: -124.85, east: -116.9 };
// The water is the About page header's own color (--dark, #1a2a1c).
const WATER_RGB = [26, 42, 28];

const inWashington = ([lat, lon]) =>
  lat > WASHINGTON.south && lat < WASHINGTON.north && lon > WASHINGTON.west && lon < WASHINGTON.east;

// The About page's range map — the hike cards' 2D trail map at state scale,
// with a pin per hike (see src/lib/rangeMap.js).
// Cesium is not loaded at all below this width. The map is a fixed,
// north-up, non-interactive picture, but drawing it still costs a WebGL
// context and a large texture on top of the 663 kB engine — enough that
// iOS Safari kills the tab when you scroll. Until it is rebuilt as a plain
// image with HTML pins (which is all it ever needed to be), phones get the
// region lists below instead of a page that reloads itself.
const MIN_MAP_WIDTH = 700;

export default function RangeMap({ hikes }) {
  const navigate = useNavigate();
  const rootRef = useRef(null);
  const mapDivRef = useRef(null);
  const bodyRef = useRef(null); // the frosted caption band — pins are fit above it
  const [tip, setTip] = useState(null);
  const [enabled] = useState(() => typeof window === 'undefined' || window.innerWidth >= MIN_MAP_WIDTH);

  // Hikes that share a trailhead (a winter page and its summer twin) share one
  // pin: they'd be stacked exactly on top of each other otherwise.
  const { pins, elsewhere } = useMemo(() => {
    const byPlace = new Map();
    let elsewhere = 0;
    for (const hike of hikes) {
      if (!hike.trailhead) continue;
      if (!inWashington(hike.trailhead)) { elsewhere++; continue; }
      const key = hike.trailhead.join(',');
      if (!byPlace.has(key)) byPlace.set(key, { lat: hike.trailhead[0], lon: hike.trailhead[1], hikes: [] });
      byPlace.get(key).hikes.push(hike);
    }
    return { pins: [...byPlace.values()], elsewhere };
  }, [hikes]);

  useEffect(() => {
    if (!enabled || !pins.length) return;
    let map;
    let cancelled = false;
    (async () => {
      window.CESIUM_BASE_URL = '/cesium/';
      const { RangeMap: RangeMapView } = await import('../lib/rangeMap');
      if (cancelled) return;
      map = new RangeMapView(mapDivRef.current, {
        pins,
        bounds: WASHINGTON,
        waterRgb: WATER_RGB,
        bottomInset: () => bodyRef.current?.offsetHeight ?? 0,
        onHover: (pin, at) => setTip(pin ? { names: pin.hikes.map((h) => h.name).join(' · '), ...at } : null),
        onPinClick: (pin) => navigate(`/hikes/${pin.hikes[0].id}`),
      });
    })();
    return () => {
      cancelled = true;
      map?.destroy();
    };
  }, [enabled, pins, navigate]);

  if (!enabled) return null;

  return (
    <>
      <div ref={rootRef} className="range-map map-card" onMouseLeave={() => setTip(null)}>
        <div ref={mapDivRef} className="map-card-canvas" />
        {tip && (
          <div className="range-map-tip" style={{ left: tip.x, top: tip.y }}>{tip.names}</div>
        )}
        <div ref={bodyRef} className="map-card-body">
          <h3 className="map-card-title">Every Trail, So Far</h3>
        </div>
      </div>
      {elsewhere > 0 && <p className="range-map-note">+ {elsewhere} in Arizona</p>}
    </>
  );
}
