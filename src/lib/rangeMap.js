import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './terrainFlyoverOverrides.css';
import { createReliefLayer, RELIEF_LUT } from './terrainFlyover';
import { CASING as TRAIL_CASING, withoutDepthWrite } from './trailPolyline';
// Imported here, not in the component: this module is the one that gets
// pulled in on demand, so the borders and the water (a few hundred KB of
// rings) stay out of the main bundle and load with the map itself.
import stateBorders from '../data/stateBorders.json';
import water from '../data/water.json';

// The state lines: solid white and thin, per Scott — discrete enough to read
// as a boundary without competing with the terrain.
const BORDER_COLOR = Cesium.Color.fromCssColorString('rgba(255, 255, 255, 0.92)');
const BORDER_WIDTH_PX = 1.5;
// The pins keep their size in screen pixels, so on a phone — a third of the
// desktop width for the same 1,400 km of ground — an 11px dot covers about
// three times as much map. The dozen hikes around Snoqualmie Pass merged
// into one blob. Scaled to the card instead.
const PIN_PX = { wide: 11, narrow: 7 };
const PIN_OUTLINE_PX = { wide: 2, narrow: 1.5 };
const NARROW_CARD_PX = 700;
// The stitched relief is built on a canvas, then `reproject` builds a second
// one the same size, then it is uploaded as a texture. On a desktop that is
// fine; on a phone it is the largest thing on the page and iOS discards the
// WebGL context under memory pressure, which leaves the card blank. A phone
// is also showing it at 350px, where the extra tiles buy nothing.
const RELIEF_MAX_TILES = { wide: 220, narrow: 80 };

// The About page's range map: the hike cards' 2D trail map (TerrainFlyover with
// topDownPreview: true) at state scale, with a pin for each hike instead of a
// route. Same viewer setup, same recolored relief, same white dots outlined in
// the trail line's casing. Static (requestRenderMode), no pan or zoom.
//
// `pins` are { lat, lon, ... } (anything else on them is handed back untouched
// to onHover / onPinClick). `bottomInset` returns the pixel height of the
// frosted caption band along the bottom, so the pins are fit above it.
export class RangeMap {
  constructor(containerEl, { pins, bounds, waterRgb, bottomInset, onHover, onPinClick }) {
    this.destroyed = false;
    this.viewer = new Cesium.Viewer(containerEl, {
      // A flat map, not a globe seen from above. On a globe the 49th
      // parallel bows and the meridians lean, and no camera setting fixes
      // that — it is what a sphere looks like in perspective. In 2D with a
      // Web Mercator projection a parallel is a horizontal line and a
      // meridian is a vertical one, so the Canadian border runs parallel to
      // the top edge and eastern Washington to the right edge. Mercator
      // rather than the default equirectangular: the latter stretches
      // longitude by 1/cos(47 deg) up here, about 1.5x too wide.
      sceneMode: Cesium.SceneMode.SCENE2D,
      mapProjection: new Cesium.WebMercatorProjection(),
      baseLayer: false,
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
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
      useBrowserRecommendedResolution: false,
    });
    const { scene, camera } = this.viewer;
    // Same settings as the card's viewer, so the relief reads identically.
    this.viewer.resolutionScale = Math.min(1, 2 / window.devicePixelRatio);
    scene.postProcessStages.fxaa.enabled = true;
    scene.globe.baseColor = Cesium.Color.fromBytes(...RELIEF_LUT[205]);
    scene.skyAtmosphere.show = false;
    scene.fog.enabled = false;
    scene.skyBox.show = false;
    scene.backgroundColor = Cesium.Color.fromCssColorString('#cfe0e8');
    scene.screenSpaceCameraController.enableInputs = false;
    // The frame: the whole area in `bounds` (the state), plus any pin
    // outside it, with a little air around it.
    const lons = [bounds.west, bounds.east, ...pins.map((p) => p.lon)];
    const lats = [bounds.south, bounds.north, ...pins.map((p) => p.lat)];
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const padLon = (maxLon - minLon) * 0.02;
    const padLat = (maxLat - minLat) * 0.03;
    const centerLat = (minLat + maxLat) / 2;
    const metersPerDegLon = 111320 * Math.cos(centerLat * (Math.PI / 180));

    // North up, fitted to that rectangle. Cesium shows the whole rectangle
    // and lets the long axis overshoot, so the visible area is worked out
    // here rather than asked for: camera.computeViewRectangle() returns
    // nothing in 2D, and taking its word for that quietly left the map with
    // no relief on it at all.
    const MERC_Y = (deg) => Math.log(Math.tan(Math.PI / 4 + (deg * Math.PI / 180) / 2));
    const MERC_LAT = (y) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;

    const framed = () => {
      const heightPx = containerEl.clientHeight;
      const insetPx = Math.min(bottomInset?.() ?? 0, heightPx * 0.5);
      // Grow the rectangle downwards by the caption band's share of the
      // card, so the state ends up centred in the part still showing.
      const grow = (maxLat - minLat + 2 * padLat) * (insetPx / Math.max(1, heightPx - insetPx));
      return {
        west: minLon - padLon,
        east: maxLon + padLon,
        south: minLat - padLat - grow,
        north: maxLat + padLat,
      };
    };

    // What is actually on screen once that rectangle is fitted: the same
    // box, with whichever axis is too short opened up to the card's shape.
    // Both axes in Mercator radians — mixing degrees of longitude with a
    // Mercator y (which is not degrees) makes the aspect comparison
    // meaningless and stretches the frame to the poles.
    const RAD = Math.PI / 180;
    const visible = () => {
      const want = framed();
      const aspect = containerEl.clientWidth / Math.max(1, containerEl.clientHeight);
      const [x0, x1] = [want.west * RAD, want.east * RAD];
      const [y0, y1] = [MERC_Y(want.south), MERC_Y(want.north)];
      const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
      let dx = x1 - x0;
      let dy = y1 - y0;
      if (dx / dy < aspect) dx = dy * aspect;
      else dy = dx / aspect;
      return {
        west: (cx - dx / 2) / RAD,
        east: (cx + dx / 2) / RAD,
        south: MERC_LAT(cy - dy / 2),
        north: MERC_LAT(cy + dy / 2),
      };
    };

    const fit = () => {
      if (this.destroyed || this.viewer.isDestroyed()) return null;
      this.viewer.resize();
      const want = framed();
      camera.setView({
        destination: Cesium.Rectangle.fromDegrees(want.west, want.south, want.east, want.north),
      });
      const view = visible();
      return ((view.east - view.west) * metersPerDegLon) / containerEl.clientWidth;
    };

    // One dot per pin: white, outlined in the line's dark casing, on top.
    const pinScale = () => (containerEl.clientWidth < NARROW_CARD_PX ? 'narrow' : 'wide');
    this.entities = new Map();
    this.points = [];
    pins.forEach((pin, i) => {
      const entity = this.viewer.entities.add({
        id: `pin-${i}`,
        position: Cesium.Cartesian3.fromDegrees(pin.lon, pin.lat),
        point: {
          pixelSize: PIN_PX[pinScale()],
          color: Cesium.Color.WHITE,
          outlineColor: TRAIL_CASING,
          outlineWidth: PIN_OUTLINE_PX[pinScale()],
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      this.entities.set(entity.id, pin);
      this.points.push(entity.point);
    });

    // Rotating a phone crosses the threshold, so the dots resize with it.
    this.sizePins = () => {
      const which = pinScale();
      for (const point of this.points) {
        point.pixelSize = PIN_PX[which];
        point.outlineWidth = PIN_OUTLINE_PX[which];
      }
    };

    const pinAt = (clientX, clientY) => {
      const box = this.viewer.canvas.getBoundingClientRect();
      const picked = this.viewer.scene.pick(new Cesium.Cartesian2(clientX - box.left, clientY - box.top));
      return (picked && this.entities.get(picked.id?.id)) || null;
    };

    // Plain DOM listeners, not Cesium's ScreenSpaceEventHandler. That handler
    // registers its own touch listeners and cancels the gesture, so on a
    // phone a swipe over the map moved nothing and the page stuck — the map
    // does not pan or zoom, so there is nothing for it to be doing with a
    // drag. A native click is a tap on touch and costs the page nothing.
    this.onMove = (e) => {
      const pin = pinAt(e.clientX, e.clientY);
      containerEl.style.cursor = pin ? 'pointer' : '';
      const box = containerEl.getBoundingClientRect();
      onHover?.(pin, pin ? { x: e.clientX - box.left, y: e.clientY - box.top } : null);
    };
    this.onLeave = () => onHover?.(null, null);
    this.onClick = (e) => {
      const pin = pinAt(e.clientX, e.clientY);
      if (pin) onPinClick?.(pin);
    };
    containerEl.addEventListener('mousemove', this.onMove);
    containerEl.addEventListener('mouseleave', this.onLeave);
    containerEl.addEventListener('click', this.onClick);
    this.container = containerEl;

    // Cesium sizes its canvas at construction; the container may not be final.
    let reliefLevel;
    setTimeout(() => {
      const metersPerPx = fit();
      if (metersPerPx == null) return;
      // The card picks the relief zoom whose pixels best match its own; a
      // whole-state image is finer than that (a level, two on a dense screen),
      // and createReliefLayer steps down on its own if that is too many tiles.
      const atZ0 = 156543.03 * Math.cos(Cesium.Math.toRadians(centerLat));
      reliefLevel = Cesium.Math.clamp(Math.round(Math.log2(atZ0 / metersPerPx)) + (window.devicePixelRatio >= 1.5 ? 2 : 1), 8, 11);
      const view = visible();
      const padX = (view.east - view.west) * 0.04;
      const padY = (view.north - view.south) * 0.04;
      createReliefLayer({
        west: view.west - padX,
        south: view.south - padY,
        east: view.east + padX,
        north: view.north + padY,
      }, reliefLevel, {
        reproject: true,
        water: { rings: water, rgb: waterRgb },
        maxTiles: RELIEF_MAX_TILES[containerEl.clientWidth < NARROW_CARD_PX ? 'narrow' : 'wide'],
      })
        .then((layer) => {
          if (this.destroyed || this.viewer.isDestroyed()) return;
          this.viewer.imageryLayers.add(layer);
          this.viewer.scene.requestRender();
        })
        .then(() => this.addBorders())
        .catch((e) => console.error('[rangeMap] relief failed:', e));
    }, 100);

    // iOS drops the WebGL context when it needs the memory back, and Cesium
    // does not come back on its own. Rather than leave a blank green box on
    // the page, take the card out and leave the lists that follow it.
    this.onContextLost = (e) => {
      e.preventDefault();
      console.warn('[rangeMap] WebGL context lost — hiding the map');
      containerEl.classList.add('range-map-lost');
    };
    this.viewer.canvas.addEventListener('webglcontextlost', this.onContextLost);

    this.resizeObserver = new ResizeObserver(() => {
      fit();
      this.sizePins();
      this.viewer.scene.requestRender();
    });
    this.resizeObserver.observe(containerEl);
    fit();
  }

  // The state lines, drawn over the map rather than painted into it — the
  // same way a hike card draws its route (trailPolyline.js, onTop). Baked
  // into the relief image they went through the Mercator-to-latitude
  // resample with it, and that copies one source row per output row: a line
  // running east-west along the 49th parallel lost whichever rows the
  // resample skipped and doubled the ones it repeated, so it came out
  // dashed and a pixel off. As real geometry it is placed by coordinate and
  // gets the scene's antialiasing. In 2D there is no terrain to sit on and
  // no parallax, so the line lands exactly on its own coordinates.
  addBorders() {
    if (this.destroyed || this.viewer.isDestroyed()) return;
    const collection = new Cesium.PolylineCollection();
    for (const line of stateBorders.lines) {
      collection.add({
        positions: line.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)),
        width: BORDER_WIDTH_PX,
        // One material per line, never shared — a polyline destroys its
        // material with itself (see trailPolyline.js).
        material: Cesium.Material.fromType('Color', { color: BORDER_COLOR }),
      });
    }
    this.borders = this.viewer.scene.primitives.add(withoutDepthWrite(collection, false));
    this.viewer.scene.requestRender();
  }

  destroy() {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    for (const type of ['wheel', 'touchmove']) {
      this.container?.removeEventListener(type, this.swallow, { capture: true });
    }
    this.container?.removeEventListener('mousemove', this.onMove);
    this.container?.removeEventListener('mouseleave', this.onLeave);
    this.container?.removeEventListener('click', this.onClick);
    if (!this.viewer.isDestroyed()) this.viewer.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    if (!this.viewer.isDestroyed()) this.viewer.destroy();
  }
}
