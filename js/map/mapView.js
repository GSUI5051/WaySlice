/**
 * Map view — MapLibre GL JS integration.
 *
 * Shows the whole track, the highlighted sector, two draggable boundary
 * handles and the file's waypoints. Everything is drawn from the ORIGINAL
 * track points (display-only simplification), and every user interaction
 * funnels into `sectorStore`, which the profile and metrics panels also
 * subscribe to.
 *
 * The map is created LAZILY: until a track is parsed the pane shows only the
 * empty-state card over the plain surface — no MapLibre instance, no tiles,
 * no WebGL context. The LIBRARY is lazy too (lfmaps.fr's Core Web Vitals
 * tip): its ~1.1MB of vendor JS and CSS download only once a track file
 * starts loading, via preloadMapLibre's dynamic import. The first track
 * creates the map, and the initial fit is a JUMP, not a flight (both on the
 * first track and on every re-import), so the basemap loads immediately
 * after the camera lands on the fitted view. Explicit fit commands
 * (zoom-to-track / zoom-to-sector buttons) still fly.
 */
/* global maplibregl */
import { sectorStore, moveBoundary, getTrackTotal, isEntireTrack } from '../sector/sectorStore.js';
import { nearestOnTrack } from '../geo/interpolate.js';
import { pointAtDistance } from '../geo/interpolate.js';
import { simplifyForDisplay, thinStride } from '../geo/simplify.js';
import { getSavedSource, createRasterSource, saveSource, MAP_SOURCES } from './sources.js';
import { wantsCooperativeGestures, addGestureHint } from './gestures.js';
import { formatDistanceShort } from '../utils/format.js';
import { getUnitSystem } from '../units/units.js';
import { t } from '../language/language.js';
import { emit, on } from '../core/events.js';

let map = null;
/** The #map container — the MapLibre instance is created on first use. */
let container = null;
/** True once the initial basemap has been loaded (post-first-flight). */
let basemapLoaded = false;
/** Shared library download + in-flight map creation (see preloadMapLibre /
 * ensureMap). */
let maplibrePromise = null;
let mapCreating = null;
let track = null;
let rafPending = false;
let waypointsVisible = true;
/** True once the markers and the delegated hit-layer events exist. */
let trackWired = false;
/** True while the basemap is a provider style (vector) rather than our
 * minimal style with a raster layer hung off it. */
let styleIsProvider = false;

const layers = {
  startHandle: null,
  endHandle: null,
  hoverDot: null,
  waypoints: null,
};

let dragHints = { start: null, end: null };
const dragging = { start: false, end: false };
let hoverHint = null;
let scaleControl = null;

/** Resolves once the active style is loaded — addSource/addLayer/setMaxZoom
 * require it even for a literal style object, and every setStyle (vector
 * basemaps) invalidates it again. */
let styleReady = null;
let styleGeneration = 0;
function onStyleReady(fn) {
  if (!styleReady) return fn();
  // Work scheduled for one style must not land inside a newer one when the
  // user swaps basemaps faster than styles load.
  const gen = styleGeneration;
  styleReady.then(() => { if (styleGeneration === gen) fn(); });
}

/** Re-arms the readiness gate for the style the map is currently loading.
 * 'style.load' fires for the constructor style and after every setStyle with
 * a contentful style — but NOT for an empty one (raster basemaps hang off a
 * bare {version, sources, layers} style), so 'idle' races it as a fallback.
 * A synchronous isStyleLoaded() check cannot be trusted here: right after
 * setStyle it still reports the outgoing style as loaded. */
function armStyleGate() {
  styleGeneration++;
  styleReady = new Promise((resolve) => {
    map.once('style.load', resolve);
    map.once('idle', resolve);
  });
}

/** Applies a new style and runs `fn` once it is fully loaded. setStyle wipes
 * every custom source/layer, so style changes and track-vector re-hangs always
 * travel together. The gate is armed AFTER setStyle so it observes the new
 * style's loading state, not the previous one. */
function switchStyle(style, fn) {
  map.setStyle(style);
  armStyleGate();
  onStyleReady(fn);
}

/** The bare style the raster basemaps hang off. Fresh object per use —
 * MapLibre takes ownership of what it is handed. */
const minimalStyle = () => ({ version: 8, sources: {}, layers: [] });

/** Reads a themed design token (map layer colors live in css/tokens.css). */
function themeColor(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Re-styles track, sector, handle and waypoint colors after a theme flip. */
function applyMapTheme() {
  if (!map || !map.getLayer('track-line')) return;
  map.setPaintProperty('track-casing', 'line-color', themeColor('--map-track-casing'));
  map.setPaintProperty('track-line', 'line-color', themeColor('--map-track'));
  map.setPaintProperty('sector-line', 'line-color', themeColor('--map-sector'));
  for (const which of ['start', 'end']) {
    const el = layers[`${which}Handle`]?.getElement()?.querySelector('.map-handle');
    if (el) {
      el.style.setProperty('--handle-color', themeColor(which === 'start' ? '--map-handle-start' : '--map-handle-end'));
    }
  }
  if (layers.waypoints) {
    for (const marker of layers.waypoints) {
      const el = marker.getElement()?.querySelector('.map-waypoint');
      if (el) el.style.setProperty('--waypoint-color', themeColor('--map-waypoint'));
    }
  }
}

/**
 * Wires the map's store/event couplings. The MapLibre instance itself is
 * NOT created here — `ensureMap` builds it when the first track arrives, so
 * an untouched visit never requests a basemap.
 * @param {HTMLElement} node  the #map container
 */
export function initMap(node) {
  container = node;
  sectorStore.subscribe(scheduleSectorSync);
  on('units:changed', refreshScaleControl);
  on('theme:changed', applyMapTheme);
}

/** Starts the MapLibre library download at most once and returns its
 * readiness promise — lfmaps.fr's lazy-load tip for Core Web Vitals: the
 * ~1.1MB of vendor JS plus its CSS only hit the network once a track file
 * starts loading, never during the initial page paint. The vendored
 * maplibre-global.mjs shim mounts the namespace as window.maplibregl, so
 * the rest of the module keeps using the global. The promise resets on
 * failure so a later attempt can retry. */
export function preloadMapLibre() {
  if (!maplibrePromise) {
    maplibrePromise = Promise.all([
      import('../../vendor/maplibre/maplibre-global.mjs'),
      loadMapLibreCss(),
    ]).catch((error) => {
      maplibrePromise = null;
      emit('maplibre:error', { error });
      throw error;
    });
  }
  return maplibrePromise;
}

/** @private Injects the vendor MapLibre stylesheet on first use — controls,
 * attribution and markers are unstyled without it. The link goes BEFORE the
 * app's own stylesheets, mirroring the static <link> order this replaced:
 * css/map.css overrides several same-specificity vendor rules (the marker
 * fade, the map font, the cooperative-gesture banner) and only wins while
 * it comes later in the cascade. Resolves on load; a load ERROR still
 * resolves (default control styling is survivable) because the JS import
 * failure is the one worth reporting. */
function loadMapLibreCss() {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../../vendor/maplibre/maplibre-gl.css', import.meta.url).href;
  const firstCss = document.head.querySelector('link[rel="stylesheet"]');
  if (firstCss) document.head.insertBefore(link, firstCss);
  else document.head.appendChild(link);
  return new Promise((resolve) => {
    link.onload = resolve;
    link.onerror = resolve;
  });
}

/** @private Creates the MapLibre instance and everything bound to it once
 * the lazily loaded library is ready (see ensureMap). Cooperative mode on
 * touch devices: one finger scrolls the page, two fingers pan/zoom the map.
 * MapLibre's cooperativeGestures puts the canvas container on `touch-action:
 * pan-x pan-y` — the same mechanism Leaflet reached through its
 * leaflet-touch-zoom class — and shows its own banner, which css/map.css
 * hides in favor of our .map-gesture-hint overlay. dragRotate/touchPitch
 * stay off to keep the map flat and north-up. */
function ensureMap() {
  if (map || mapCreating) return mapCreating;
  mapCreating = preloadMapLibre().then(createMapInstance);
  return mapCreating;
}

/** @private The library-dependent half of ensureMap — everything that needs
 * window.maplibregl to exist. */
function createMapInstance() {
  const cooperative = wantsCooperativeGestures();
  map = new maplibregl.Map({
    container,
    // Minimal runtime style; the basemap raster and the track GeoJSON
    // sources hang off it below (official raster-source pattern). The
    // basemap itself joins only after the first flight — see setTrack.
    style: { version: 8, sources: {}, layers: [] },
    cooperativeGestures: cooperative,
    dragRotate: false,
    touchPitch: false,
    attributionControl: false,
  });
  // Corner stacking: attribution ends up at the very bottom edge with the
  // zoom bar above it, mirroring the Leaflet layout.
  map.addControl(new maplibregl.AttributionControl({ compact: false }), 'bottom-right');
  map.addControl(new maplibregl.NavigationControl({ showCompass: false, showZoom: true }), 'bottom-right');
  refreshScaleControl();
  armStyleGate();

  // A click anywhere on the map unpins the profile's waypoint line (a
  // waypoint marker click selects instead; marker clicks are plain DOM above
  // the canvas and never reach the map). MapLibre — unlike Leaflet — fires
  // the map click even when a layer was hit, so clicks that land on the
  // track's hit line are excluded here and handled by onTrackClick.
  // Track interactions ride the generic canvas events with a point query:
  // MapLibre's delegated map.on(type, layerId) dispatch proved unreliable for
  // layers re-added across setStyle, while the generic events always fire. A
  // click on the track moves the nearest boundary; anywhere else unpins the
  // profile's waypoint line (marker clicks are plain DOM above the canvas and
  // never reach the map).
  map.on('click', (e) => {
    if (track && map.getLayer('track-hit')
        && map.queryRenderedFeatures(e.point, { layers: ['track-hit'] }).length) {
      onTrackClick(e);
      return;
    }
    emit('waypoint:deselect');
  });
  map.on('mousemove', (e) => {
    if (!track || !map.getLayer('track-hit')) return;
    if (map.queryRenderedFeatures(e.point, { layers: ['track-hit'] }).length) onTrackHover(e);
    else showHover(null);
  });
  if (cooperative) addGestureHint(container);

  // Keep MapLibre in sync with responsive layout changes. (MapLibre also
  // tracks the container itself, but the explicit resize keeps the
  // zero-size-layout deferral in fitTrack/fitSector honest.)
  if ('ResizeObserver' in window) {
    let first = true;
    new ResizeObserver(() => {
      if (first) { first = false; return; }
      map.resize();
    }).observe(container);
  }
}

/** @private Loads the saved basemap after the initial fit has landed. The
 * normal initial fit is an unanimated jump, so this runs the moment the
 * camera is in place. The flight-wait machinery below only kicks in for the
 * animated fallback (cameraForBounds returning null) or a basemap picked
 * mid-fit. Idempotent: several paths can land here, and so can a basemap
 * whose own setSource already set the flag. */
function loadInitialBasemap() {
  if (basemapLoaded || !map) return;
  setSource(getSavedSource());
}

/** @private Waits for an animated initial fit to end. moveend is the precise
 * signal, but it never fires when the ease is cut short — a basemap picked
 * mid-flight stops the camera with setStyle — so a bounded poll watching
 * isMoving() stands in as the fallback. */
function armBasemapAfterFlight() {
  if (basemapLoaded || !map) return;
  map.once('moveend', loadInitialBasemap);
  const startedAt = performance.now();
  const poll = setInterval(() => {
    if (basemapLoaded) { clearInterval(poll); return; }
    // A still-moving camera after 10 s means the flight is wedged; load
    // anyway rather than leave the pane blank forever.
    if (!map || !map.isMoving() || performance.now() - startedAt > 10000) {
      clearInterval(poll);
      loadInitialBasemap();
    }
  }, 250);
}

function refreshScaleControl() {
  if (!map) return;
  if (!scaleControl) {
    scaleControl = new maplibregl.ScaleControl({ unit: getUnitSystem() });
    map.addControl(scaleControl, 'bottom-left');
    return;
  }
  scaleControl.setUnit(getUnitSystem());
}

/** Switches the tile layer to the given source id and persists the choice. */
export function setSourceById(id) {
  const source = MAP_SOURCES.find((s) => s.id === id);
  if (!source) return;
  saveSource(id);
  onStyleReady(() => setSource(source));
}

/** @private */
let currentSourceId = null;
function setSource(source) {
  if (!map) return;
  // Any source load — the post-flight initial one or an explicit user pick —
  // retires the first-flight hold.
  basemapLoaded = true;
  currentSourceId = source.id;
  if (source.styleUrl) {
    // Vector basemap (Stadia Direct Access): the provider style replaces the
    // whole style and carries its own attribution via the TileJSON. setStyle
    // wipes the track vectors along with the old basemap, so they are re-hung
    // on readiness; markers are DOM and survive on their own.
    styleIsProvider = true;
    switchStyle(source.styleUrl, () => {
      map.setMaxZoom(source.maxZoom);
      hangTrackGeometry();
    });
    return;
  }
  if (styleIsProvider) {
    // Back to a raster source from a provider style: restore the minimal
    // style so the style's sources/layers (and their tile traffic) go away.
    styleIsProvider = false;
    switchStyle(minimalStyle(), () => {
      hangTrackGeometry();
      addRasterLayers(source);
      map.setMaxZoom(source.maxZoom);
    });
    return;
  }
  addRasterLayers(source);
  map.setMaxZoom(source.maxZoom);
}

/** @private Adds the raster basemap layer(s) at the bottom of the style stack,
 * under the track vectors. */
function addRasterLayers(source) {
  const beforeId = map.getLayer('track-casing') ? 'track-casing' : undefined;
  if (map.getLayer('basemap-layer')) map.removeLayer('basemap-layer');
  if (map.getLayer('basemap-overlay-layer')) map.removeLayer('basemap-overlay-layer');
  if (map.getSource('basemap')) map.removeSource('basemap');
  if (map.getSource('basemap-overlay')) map.removeSource('basemap-overlay');
  map.addSource('basemap', createRasterSource(source));
  map.addLayer({ id: 'basemap-layer', type: 'raster', source: 'basemap' }, beforeId);
  // Sources may pair their base tiles with a transparent label overlay;
  // insertion order keeps it above the base and below the track's layers.
  if (source.overlayUrl) {
    map.addSource('basemap-overlay', createRasterSource(source, source.overlayUrl));
    map.addLayer({ id: 'basemap-overlay-layer', type: 'raster', source: 'basemap-overlay' }, beforeId);
  }
}

/**
 * Loads a track onto the map: creates the map if this is the first one
 * (awaiting the lazily loaded library), hangs the simplified display
 * polyline + handles and jumps to fit (the initial fit is NOT animated, on
 * the first track and on every re-import alike); the basemap then loads
 * immediately — there is no flight left to wait for.
 * @param {import('../types.js').Track} newTrack
 */
export function setTrack(newTrack) {
  track = newTrack;
  // The library import usually started when the file began loading, so the
  // download has been racing the parser; on the happy path this then() is
  // already resolved. Every later import finds map set and resolves at once.
  ensureMap().then(() => {
    // File-picker focus changes can briefly leave the map container without
    // a measurable size. Defer fitting until the next frame, after MapLibre
    // can recalculate its viewport.
    onStyleReady(() => {
      hangTrackGeometry();
      rebuildWaypoints();
      // sectorStore may have broadcast while the style was still loading;
      // sync once now so handles and the highlight reflect the selection.
      syncSector();
      requestAnimationFrame(() => {
        fitTrack({ animate: false });
        // The jump lands synchronously, so this loads the basemap right
        // away; armBasemapAfterFlight only matters for the animated
        // fallback fit (cameraForBounds returning null) or a mid-flight
        // user pick.
        if (!map.isMoving()) loadInitialBasemap();
        else armBasemapAfterFlight();
      });
    });
  }).catch(() => { /* surfaced via the maplibre:error listener in main.js */ });
}

/** @private (Re)hangs the track/sector sources and line layers on the ACTIVE
 * style and refills their geometry. Every setStyle wipes them, so style
 * changes route through here; markers are DOM and survive on their own. */
function hangTrackGeometry() {
  if (!track || !map) return;
  if (!map.getSource('track')) {
    const lineLayout = { 'line-cap': 'round', 'line-join': 'round' };
    map.addSource('track', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addSource('sector', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    // Casing under line under sector, matching the Leaflet pane order. The 4px
    // track line is far below MapLibre's touch tolerance, so an invisible
    // widened twin carries the pointer events (Leaflet's path hit tolerance).
    map.addLayer({
      id: 'track-casing', type: 'line', source: 'track', layout: lineLayout,
      paint: { 'line-color': themeColor('--map-track-casing'), 'line-width': 8, 'line-opacity': 0.9 },
    });
    map.addLayer({
      id: 'track-line', type: 'line', source: 'track', layout: lineLayout,
      paint: { 'line-color': themeColor('--map-track'), 'line-width': 4, 'line-opacity': 0.95 },
    });
    map.addLayer({
      id: 'sector-line', type: 'line', source: 'sector', layout: lineLayout,
      paint: { 'line-color': themeColor('--map-sector'), 'line-width': 6, 'line-opacity': 1 },
    });
    map.addLayer({
      id: 'track-hit', type: 'line', source: 'track', layout: lineLayout,
      paint: { 'line-color': '#000', 'line-width': 16, 'line-opacity': 0 },
    });
    if (!trackWired) {
      createHoverDot();
      createHandle('start');
      createHandle('end');
      trackWired = true;
    }
  }
  updateTrackGeometry();
  syncSector();
}

/** @private Pushes the simplified display polyline into the track source. */
function updateTrackGeometry() {
  const trackSource = map.getSource('track');
  if (!trackSource) return;
  const display = simplifyForDisplay(track.points);
  const coordinates = display.map((p) => [p.lon, p.lat]);
  trackSource.setData(
    coordinates.length
      ? { type: 'Feature', geometry: { type: 'LineString', coordinates } }
      : { type: 'FeatureCollection', features: [] },
  );
}

/** @private The profile-synced hover dot (hidden until a hover arrives). */
function createHoverDot() {
  const el = document.createElement('div');
  el.className = 'hover-dot-icon';
  el.innerHTML = '<div class="hover-dot"></div>';
  el.style.zIndex = '500';
  layers.hoverDot = new maplibregl.Marker({ element: el, anchor: 'center' })
    .setLngLat([0, 0])
    .addTo(map);
  layers.hoverDot.setOpacity(0);
}

/** @private Rebuilds the waypoint markers from `track.waypoints`. */
function rebuildWaypoints() {
  if (layers.waypoints) {
    for (const marker of layers.waypoints) marker.remove();
    layers.waypoints = null;
  }
  const wpts = track?.waypoints || [];
  if (!wpts.length || !waypointsVisible) return;
  let hint = 0;
  layers.waypoints = wpts.map((w) => {
    // Resolve the waypoint onto the track once, so pin hovers can point the
    // elevation profile at the exact x position.
    const near = nearestOnTrack(track, w.lat, w.lon, hint);
    hint = near.i;
    const el = document.createElement('div');
    el.className = 'map-waypoint-icon';
    el.innerHTML = `<div class="map-waypoint" style="--waypoint-color:${themeColor('--map-waypoint')}"></div>`;
    // Name plate in place of Leaflet's bindTooltip(direction: 'top'): a
    // self-drawn div above the pin, shown on hover via css/map.css.
    if (w.name) {
      const label = document.createElement('div');
      label.className = 'map-waypoint-label';
      label.textContent = w.name;
      el.appendChild(label);
    }
    el.style.zIndex = '300';
    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([w.lon, w.lat])
      .addTo(map);
    el.addEventListener('mouseover', () => emit('waypoint:hover', { dist: near.dist, name: w.name || null }));
    el.addEventListener('mouseout', () => emit('waypoint:hover', { dist: null }));
    // Clicking a waypoint centers the viewport on it; panTo keeps the
    // current zoom level untouched. The profile (wide screens only) pans
    // its zoom window to the same waypoint and pins its line/readout
    // until the next click anywhere.
    el.addEventListener('click', () => {
      map.panTo([w.lon, w.lat]);
      emit('waypoint:select', { dist: near.dist, name: w.name || null });
    });
    return marker;
  });
}

/** Shows or hides the waypoint layer (no-op before a track is loaded). */
export function setWaypointsVisible(visible) {
  waypointsVisible = visible;
  // The profile mirrors the map's waypoint visibility.
  emit('waypoints:visible', { visible });
  if (!map || !track) return;
  // The group is only built when it would be visible; a toggle back to
  // "shown" after a hidden rebuild therefore constructs it on demand.
  if (visible && !layers.waypoints && (track.waypoints || []).length) {
    rebuildWaypoints();
    return;
  }
  if (!layers.waypoints) return;
  if (visible) for (const marker of layers.waypoints) marker.addTo(map);
  else for (const marker of layers.waypoints) marker.remove();
}

/** Fits the viewport to the whole track. Pass `{ animate: false }` for the
 * initial fit after a track parse — the camera jumps to the fitted view in
 * one step instead of flying there. */
export function fitTrack(opts) {
  if (!track || !map || !map.getContainer().isConnected) return;
  try {
    map.resize();
    const b = track.bounds;
    const bounds = [[b.minLon, b.minLat], [b.maxLon, b.maxLat]];
    if (opts?.animate === false) {
      // cameraForBounds is the exact camera fitBounds would animate to —
      // applying it with jumpTo skips the flyTo easing entirely.
      const cam = map.cameraForBounds(bounds, { padding: 28 });
      if (cam) {
        map.jumpTo(cam);
        return;
      }
    }
    map.fitBounds(bounds, { padding: 28 });
  } catch (error) {
    // A transient zero-size layout should not invalidate an already parsed
    // track; a later resize or explicit fit will retry.
    console.warn('[WaySlice] map fit deferred:', error);
  }
}

/**
 * Fits the viewport to the selected sector: the real track points between
 * the two handles, plus the track points bracketing each handle, so a
 * selection narrower than the point spacing still yields a usable box.
 * Same behavior as fitTrack, scoped to the sector.
 */
export function fitSector() {
  if (!track || !map || !map.getContainer().isConnected) return;
  try {
    map.resize();
    const { start, end } = sectorStore.get();
    let minLat = Infinity;
    let minLon = Infinity;
    let maxLat = -Infinity;
    let maxLon = -Infinity;
    let idxStart = -1;
    let idxEnd = -1;
    for (let i = 0; i < track.pointCount; i++) {
      const d = track.cumDist[i];
      if (idxStart < 0 && d >= start - 1e-6) idxStart = i;
      if (idxEnd < 0 && d >= end - 1e-6) idxEnd = i;
      if (d >= start - 1e-6 && d <= end + 1e-6) {
        const p = track.points[i];
        if (p.lat < minLat) minLat = p.lat;
        if (p.lon < minLon) minLon = p.lon;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lon > maxLon) maxLon = p.lon;
      }
    }
    if (!Number.isFinite(minLat)) return;
    // The bracketing points extend the box across the handle gaps.
    for (const i of [idxStart, idxEnd]) {
      if (i >= 0 && i < track.pointCount) {
        const p = track.points[i];
        if (p.lat < minLat) minLat = p.lat;
        if (p.lon < minLon) minLon = p.lon;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lon > maxLon) maxLon = p.lon;
      }
    }
    map.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: 28 });
  } catch (error) {
    console.warn('[WaySlice] map fit deferred:', error);
  }
}

/** Shows/hides the hover dot at a distance along the track (null hides). */
export function showHover(dist, origin = 'map') {
  if (!track || !layers.hoverDot) return;
  if (dist == null) {
    layers.hoverDot.setOpacity(0);
    if (origin !== 'map') return;
    emit('hover:dist', { dist: null, origin });
    return;
  }
  const pt = pointAtDistance(track, dist);
  if (!pt) return;
  layers.hoverDot.setLngLat([pt.lon, pt.lat]).setOpacity(1);
  if (origin !== 'map') return;
  emit('hover:dist', { dist, origin });
}

/**
 * Leaflet's autoPanPadding [40, 40]: while a handle is being dragged, nudge
 * the viewport back whenever the pointer closes on a container edge.
 * @param {PointerEvent|MouseEvent} [originalEvent]
 * @param {HTMLElement} el  the dragged marker's element (fallback anchor)
 * @private
 */
const AUTOPAN_PADDING = 40;
function autoPanToward(originalEvent, el) {
  let px;
  let py;
  if (originalEvent && Number.isFinite(originalEvent.clientX)) {
    px = originalEvent.clientX;
    py = originalEvent.clientY;
  } else {
    const r = el.getBoundingClientRect();
    px = r.left + r.width / 2;
    py = r.top + r.height / 2;
  }
  const box = map.getContainer().getBoundingClientRect();
  const dx = px < box.left + AUTOPAN_PADDING
    ? px - (box.left + AUTOPAN_PADDING)
    : px > box.right - AUTOPAN_PADDING ? px - (box.right - AUTOPAN_PADDING) : 0;
  const dy = py < box.top + AUTOPAN_PADDING
    ? py - (box.top + AUTOPAN_PADDING)
    : py > box.bottom - AUTOPAN_PADDING ? py - (box.bottom - AUTOPAN_PADDING) : 0;
  if (dx || dy) map.panBy([dx, dy], { animate: false });
}

/** @private Creates one draggable sector boundary handle. */
function createHandle(which) {
  const isStart = which === 'start';
  const color = themeColor(isStart ? '--map-handle-start' : '--map-handle-end');
  const el = document.createElement('div');
  el.className = `map-handle-icon map-handle-${which}`;
  el.innerHTML = `<div class="map-handle" style="--handle-color:${color}"><span class="map-handle-grip"></span></div>`;
  el.tabIndex = 0;
  el.setAttribute('role', 'slider');
  // The ARIA slider keyboard below is the ONLY keyboard behavior: binding
  // first and stopping the event in capture phase keeps MapLibre's built-in
  // draggable-marker arrows (1px/10px screen steps) out of the way.
  el.addEventListener('keydown', (e) => onHandleKey(which, e), true);
  const marker = new maplibregl.Marker({
    element: el,
    anchor: 'center',
    draggable: true,
  }).setLngLat([0, 0]).addTo(map);
  el.style.zIndex = '1000';

  marker.on('dragstart', () => {
    dragging[which] = true;
    dragHints[which] = sectorPoint(which)?.i ?? null;
  });
  marker.on('drag', (e) => {
    const { lat, lng } = marker.getLngLat();
    const near = nearestOnTrack(track, lat, lng, dragHints[which]);
    dragHints[which] = near.i;
    moveBoundary(which, near.dist);
    autoPanToward(e.originalEvent, el);
  });
  marker.on('dragend', () => {
    dragging[which] = false;
    const pt = sectorPoint(which);
    if (pt) marker.setLngLat([pt.lon, pt.lat]);
  });

  layers[`${which}Handle`] = marker;
}

/** @private Keyboard nudging of a boundary (focusable via the icon element). */
function onHandleKey(which, e) {
  const stepBase = Math.max(getTrackTotal() / 400, 10);
  const step = (e.shiftKey ? 10 : 1) * stepBase;
  let delta = 0;
  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') delta = step;
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') delta = -step;
  else if (e.key === 'Home') { moveBoundary(which, which === 'start' ? 0 : sectorStore.get().start); e.preventDefault(); e.stopImmediatePropagation(); return; }
  else if (e.key === 'End') { moveBoundary(which, which === 'end' ? getTrackTotal() : sectorStore.get().end); e.preventDefault(); e.stopImmediatePropagation(); return; }
  else return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const { start, end } = sectorStore.get();
  moveBoundary(which, (which === 'start' ? start : end) + delta);
}

/** @private Clicking the track moves the nearest boundary to the click. */
function onTrackClick(e) {
  if (!track) return;
  const near = nearestOnTrack(track, e.lngLat.lat, e.lngLat.lng, null);
  const { start, end } = sectorStore.get();
  const which = Math.abs(near.dist - start) <= Math.abs(end - near.dist) ? 'start' : 'end';
  moveBoundary(which, near.dist);
}

/** @private Track hover → hover dot + profile crosshair. */
function onTrackHover(e) {
  if (!track) return;
  const near = nearestOnTrack(track, e.lngLat.lat, e.lngLat.lng, hoverHint);
  hoverHint = near.i;
  showHover(near.dist, 'map');
}

/** @private Boundary position (interpolated) for one side. */
function sectorPoint(which) {
  if (!track) return null;
  const { start, end } = sectorStore.get();
  return pointAtDistance(track, which === 'start' ? start : end);
}

/** @private rAF-batched sector redraw. */
function scheduleSectorSync() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    syncSector();
  });
}

/** @private Redraws the sector highlight + handle positions + ARIA state. */
function syncSector() {
  const sectorSource = track && map ? map.getSource('sector') : null;
  if (!sectorSource) return;
  const { start, end } = sectorStore.get();

  // Sector highlight: original points inside the range, stride-thinned for
  // display; interpolated boundary points replace the first/last entries.
  const pts = track.points;
  const slice = [];
  const s = pointAtDistance(track, start);
  const e = pointAtDistance(track, end);
  if (s && e) {
    const slice = [s];
    for (let k = s.i + 1; k <= e.i; k++) slice.push(pts[k]);
    if (e.i > s.i || e.dist > s.dist) slice.push(e);
    const coordinates = thinStride(slice).map((p) => [p.lon, p.lat]);
    sectorSource.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates } });
  }

  for (const which of ['start', 'end']) {
    const marker = layers[`${which}Handle`];
    if (!marker) continue;
    const pt = which === 'start' ? s : e;
    if (!pt) continue;
    if (!dragging[which]) marker.setLngLat([pt.lon, pt.lat]);
    const el = marker.getElement();
    if (el) {
      const dist = which === 'start' ? start : end;
      el.setAttribute('aria-valuemin', '0');
      el.setAttribute('aria-valuemax', Math.round(getTrackTotal()));
      el.setAttribute('aria-valuenow', String(Math.round(dist)));
      el.setAttribute('aria-valuetext', formatDistanceShort(dist));
      el.setAttribute('aria-label', t(which === 'start' ? 'sectorStart' : 'sectorEnd'));
    }
  }

  emit('sector:visuals', { entire: isEntireTrack() });
}
