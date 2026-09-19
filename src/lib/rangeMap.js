import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './terrainFlyoverOverrides.css';
import { createTerrariumTerrainProvider } from './terrainFlyoverProvider';
import { createReliefLayer, RELIEF_LUT } from './terrainFlyover';
import { CASING as TRAIL_CASING } from './trailPolyline';

// The About page's range map: the hike cards' 2D trail map (TerrainFlyover with
// topDownPreview: true) at state scale, with a pin for each hike instead of a
// route. Same viewer setup, same recolored relief, same white dots outlined in
// the trail line's casing. Static (requestRenderMode), no pan or zoom.
//
// `pins` are { lat, lon, ... } (anything else on them is handed back untouched
// to onHover / onPinClick). `bottomInset` returns the pixel height of the
// frosted caption band along the bottom, so the pins are fit above it.
export class RangeMap {
  constructor(containerEl, { pins, bounds, borders, waterRgb, bottomInset, onHover, onPinClick }) {
    this.destroyed = false;
    this.viewer = new Cesium.Viewer(containerEl, {
      terrainProvider: createTerrariumTerrainProvider(),
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
    scene.globe.enableLighting = true;
    this.viewer.resolutionScale = Math.min(1, 2 / window.devicePixelRatio);
    scene.postProcessStages.fxaa.enabled = true;
    scene.globe.baseColor = Cesium.Color.fromBytes(...RELIEF_LUT[205]);
    scene.globe.depthTestAgainstTerrain = true;
    scene.skyAtmosphere.show = false;
    scene.fog.enabled = false;
    scene.skyBox.show = false;
    scene.backgroundColor = Cesium.Color.fromCssColorString('#cfe0e8');
    scene.screenSpaceCameraController.enableCollisionDetection = false;
    scene.screenSpaceCameraController.enableInputs = false;
    camera.frustum.fov = Cesium.Math.toRadians(84);

    // The frame: the whole area in `bounds` (the state), plus any pin outside it.
    const lons = [bounds.west, bounds.east, ...pins.map((p) => p.lon)];
    const lats = [bounds.south, bounds.north, ...pins.map((p) => p.lat)];
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const centerLon = (minLon + maxLon) / 2;
    const centerLat = (minLat + maxLat) / 2;
    const metersPerDegLat = 111320;
    const metersPerDegLon = metersPerDegLat * Math.cos((centerLat * Math.PI) / 180);
    // A little air around the state.
    const halfWidthM = ((maxLon - minLon) / 2 + (maxLon - minLon) * 0.02) * metersPerDegLon;
    const halfHeightM = ((maxLat - minLat) / 2 + (maxLat - minLat) * 0.03) * metersPerDegLat;
    // The Cascades' ground sits ~1 km up; at this altitude that is under 1%.
    const GROUND_M = 1000;

    // Straight down, north up: the card's camera, fit by hand (see
    // TerrainFlyover's applyTopDownView) to the pins above the caption band.
    const fit = () => {
      if (this.destroyed || this.viewer.isDestroyed()) return null;
      this.viewer.resize();
      camera.frustum.aspectRatio = containerEl.clientWidth / containerEl.clientHeight;
      const fovX = camera.frustum.fov;
      const fovY = camera.frustum.fovy;
      const heightPx = containerEl.clientHeight;
      const insetPx = Math.min(bottomInset?.() ?? 0, heightPx * 0.5);
      const uncovered = (heightPx - insetPx) / heightPx;
      const distForHeight = halfHeightM / (Math.tan(fovY / 2) * uncovered);
      const distForWidth = halfWidthM / Math.tan(fovX / 2);
      const clearance = Math.max(distForHeight, distForWidth);
      const metersPerPx = (2 * clearance * Math.tan(fovY / 2)) / heightPx;
      camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(centerLon, centerLat - ((insetPx / 2) * metersPerPx) / metersPerDegLat, GROUND_M + clearance),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
      });
      return metersPerPx;
    };

    // One dot per pin: white, outlined in the line's dark casing, 11px, on top.
    this.entities = new Map();
    pins.forEach((pin, i) => {
      const entity = this.viewer.entities.add({
        id: `pin-${i}`,
        position: Cesium.Cartesian3.fromDegrees(pin.lon, pin.lat),
        point: {
          pixelSize: 11,
          color: Cesium.Color.WHITE,
          outlineColor: TRAIL_CASING,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      this.entities.set(entity.id, pin);
    });

    const pinAt = (position) => {
      const picked = this.viewer.scene.pick(position);
      return (picked && this.entities.get(picked.id?.id)) || null;
    };
    // Cesium swallows every wheel event over its canvas (its camera controller
    // handles them even with inputs off), so the page wouldn't scroll while the
    // pointer was on the map. Stopped in the capture phase, on the way down,
    // before they reach the canvas; scrolling itself is left alone.
    this.stopWheel = (e) => e.stopPropagation();
    containerEl.addEventListener('wheel', this.stopWheel, { capture: true, passive: true });
    this.container = containerEl;
    this.handler = new Cesium.ScreenSpaceEventHandler(this.viewer.canvas);
    this.handler.setInputAction((move) => {
      const pin = pinAt(move.endPosition);
      containerEl.style.cursor = pin ? 'pointer' : '';
      onHover?.(pin, pin ? { x: move.endPosition.x, y: move.endPosition.y } : null);
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    this.handler.setInputAction((click) => {
      const pin = pinAt(click.position);
      if (pin) onPinClick?.(pin);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

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
      const view = camera.computeViewRectangle();
      if (!view) return;
      const padLon = (view.east - view.west) * 0.15;
      const padLat = (view.north - view.south) * 0.15;
      const deg = Cesium.Math.toDegrees;
      createReliefLayer({
        west: deg(view.west - padLon),
        south: deg(view.south - padLat),
        east: deg(view.east + padLon),
        north: deg(view.north + padLat),
      }, reliefLevel, {
        reproject: true,
        water: { rgb: waterRgb },
        // ~1.5 css px wide at the frame's own scale.
        outline: { rings: borders, widthM: 1.5 * metersPerPx },
        maxTiles: 220,
      })
        .then((layer) => {
          if (this.destroyed || this.viewer.isDestroyed()) return;
          this.viewer.imageryLayers.add(layer);
          this.viewer.scene.requestRender();
        })
        .catch((e) => console.error('[rangeMap] relief failed:', e));
    }, 100);

    this.resizeObserver = new ResizeObserver(() => {
      fit();
      this.viewer.scene.requestRender();
    });
    this.resizeObserver.observe(containerEl);
    fit();
  }

  destroy() {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.container?.removeEventListener('wheel', this.stopWheel, { capture: true });
    this.handler?.destroy();
    if (!this.viewer.isDestroyed()) this.viewer.destroy();
  }
}
