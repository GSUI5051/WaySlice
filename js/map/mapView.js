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
import { sectorStore, moveBoundary, getTrackTotal, boundaryKeyAction, isEntireTrack } from '../sector/sectorStore.js';
import { nearestOnTrack } from '../geo/interpolate.js';
import { pointAtDistance } from '../geo/interpolate.js';
import { thinStride } from '../geo/simplify.js';

/** Point cap for the sector highlight while a handle drags: one lighter
 *  upload per frame beats exactness mid-drag, and the store change after
 *  pointerup re-renders the exact slice. */
const DRAG_SECTOR_CAP = 3000;
import { getSavedSource, createRasterSource, saveSource, MAP_SOURCES } from './sources.js';
import {
  ROAD_OVERLAY_SOURCE_ID, ROAD_OVERLAY_SOURCE, ROAD_OVERLAY_LAYERS, ROAD_OVERLAY_GLYPHS,
  roadOverlayTextField, savedRoadOverlayOn, saveRoadOverlayOn,
} from './roadOverlay.js';
import {
  ensureNaturalOverlay, removeNaturalOverlay, setNaturalVisibility, refreshNaturalOverlay,
} from './naturalOverlay.js';
import { cssToken } from '../utils/cssToken.js';
import { wantsCooperativeGestures, addGestureHint } from './gestures.js';
import { formatDistanceShort } from '../utils/format.js';
import { t, getCurrentLanguage } from '../language/language.js';
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
/** Waypoint markers flattened to what the handle bridge needs: the element,
 *  its resolved track distance, name and position. Rebuilt with the layer. */
let waypointPlates = [];
/** The plate a sector handle is currently surfacing, if any. */
let bridgedPlate = null;
/** The bridge radius mirrors .map-handle::after's hit reach (22px icon +
 *  14px outward inset = 25px): inside it a pin's own hover is impossible
 *  because the handle's hit area shadows the pin entirely. */
const WAYPOINT_BRIDGE_PX = 25;
/** True once the markers and the delegated hit-layer events exist. */
let trackWired = false;
/** True while the basemap is a provider style (vector) rather than our
 * minimal style with a raster layer hung off it. */
let styleIsProvider = false;
/** Satellite road-network overlay: the LIVE flag — true while the vector
 * road/label layers ride above the satellite raster. On a satellite basemap
 * it mirrors the persisted preference (re-read on every sync); any
 * non-satellite basemap resets it to false while the preference survives
 * (see syncRoadOverlay). */
let roadOverlayOn = false;

const layers = {
  startHandle: null,
  endHandle: null,
  hoverDot: null,
  waypoints: null,
};

let dragHints = { start: null, end: null };
const dragging = { start: false, end: false };
let hoverHint = null;

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
 * 'style.load' fires after every setStyle with a contentful style — but NOT
 * for an empty one (raster basemaps hang off a bare {version, sources,
 * layers} style), so for those 'idle' races it as a fallback. The race is
 * kept strictly for the empty styles: 'idle' can fire while a contentful
 * style is still loading (the outgoing style renders meanwhile), and a gate
 * resolved that early lets the re-hang land on the dying style — where the
 * arriving provider style wipes it. A synchronous isStyleLoaded() check
 * cannot be trusted here either: right after setStyle it still reports the
 * outgoing style as loaded. */
function armStyleGate(contentful) {
  styleGeneration++;
  styleReady = new Promise((resolve) => {
    map.once('style.load', resolve);
    if (!contentful) map.once('idle', resolve);
  });
}

/** Applies a new style and runs `fn` once it is fully loaded. setStyle wipes
 * every custom source/layer, so style changes and track-vector re-hangs always
 * travel together. The gate is armed AFTER setStyle so it observes the new
 * style's loading state, not the previous one. */
function switchStyle(style, fn, contentful = true) {
  map.setStyle(style);
  armStyleGate(contentful);
  onStyleReady(fn);
}

/** The bare style the raster basemaps hang off. Fresh object per use —
 * MapLibre takes ownership of what it is handed. The glyphs endpoint exists
 * for the satellite road overlay's text layers and stays unfetched until
 * such a layer actually renders. */
const minimalStyle = () => ({
  version: 8,
  glyphs: ROAD_OVERLAY_GLYPHS,
  sources: {},
  layers: [],
});

/** Re-styles track, sector, handle and waypoint colors after a theme flip. */
function applyMapTheme() {
  if (!map || !map.getLayer('track-line')) return;
  map.setPaintProperty('track-casing', 'line-color', cssToken('--map-track-casing'));
  map.setPaintProperty('track-line', 'line-color', cssToken('--map-track'));
  map.setPaintProperty('sector-line', 'line-color', cssToken('--map-sector'));
  for (const which of ['start', 'end']) {
    const el = layers[`${which}Handle`]?.getElement()?.querySelector('.map-handle');
    if (el) {
      el.style.setProperty('--handle-color', cssToken(which === 'start' ? '--map-handle-start' : '--map-handle-end'));
    }
  }
  if (layers.waypoints) {
    for (const marker of layers.waypoints) {
      const el = marker.getElement()?.querySelector('.map-waypoint');
      if (el) el.style.setProperty('--waypoint-color', cssToken('--map-waypoint'));
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
  on('theme:changed', applyMapTheme);
  on('language:changed', refreshRoadOverlayLanguage);
  on('units:changed', refreshRoadOverlayUnits);
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
  // The zoom buttons join the .btn/.btn-elevated family, so their colors are
  // decided by the same component classes as the #map-fit column — light and
  // dark alike. css/map.css owns only this group's geometry and frame.
  for (const b of map.getContainer().querySelectorAll('.maplibregl-ctrl-group button')) {
    b.classList.add('btn', 'btn-elevated');
  }
  armStyleGate(false);

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
    if (fromMarker(e)) return;
    if (track && map.getLayer('track-hit')
        && map.queryRenderedFeatures(e.point, { layers: ['track-hit'] }).length) {
      onTrackClick(e);
      return;
    }
    emit('waypoint:deselect');
  });
  map.on('mousemove', (e) => {
    if (fromMarker(e)) return;
    if (!track || !map.getLayer('track-hit')) return;
    if (map.queryRenderedFeatures(e.point, { layers: ['track-hit'] }).length) onTrackHover(e);
    else showHover(null);
  });
  if (cooperative) addGestureHint(container);

  // Keep MapLibre in sync with responsive layout changes. (MapLibre also
  // tracks the container itself, but the explicit resize keeps the
  // zero-size-layout deferral in fitTrack/fitSector honest.)
  let first = true;
  new ResizeObserver(() => {
    if (first) { first = false; return; }
    map.resize();
  }).observe(container);
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
    // on readiness; markers are DOM and survive on their own. Leaving the
    // satellite group retires the road overlay (and its button) up front.
    styleIsProvider = true;
    syncRoadOverlay();
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
      syncRoadOverlay();
    }, false);
    return;
  }
  addRasterLayers(source);
  map.setMaxZoom(source.maxZoom);
  syncRoadOverlay();
}

/** @private Adds the raster basemap layer(s) at the bottom of the style stack,
 * under the track vectors. */
function addRasterLayers(source) {
  const beforeId = map.getLayer('track-casing') ? 'track-casing' : undefined;
  if (map.getLayer('basemap-layer')) map.removeLayer('basemap-layer');
  if (map.getSource('basemap')) map.removeSource('basemap');
  map.addSource('basemap', createRasterSource(source));
  map.addLayer({ id: 'basemap-layer', type: 'raster', source: 'basemap' }, beforeId);
}

/* Satellite road-network overlay ------------------------------------------------
 *
 * Strictly a satellite-basemap feature: every catalog source in the
 * `satellite` group is a raster basemap on the minimal style, so the overlay
 * source/layers can never collide with a provider style — switching to any
 * vector provider basemap suspends the overlay (layers dropped, button
 * disabled) without erasing the choice, and the next satellite basemap
 * restores it from localStorage. Toggle OFF hides the mounted layers through
 * MapLibre's native visibility. The stored preference is the truth: every
 * sync re-reads it, so the overlay state is stable across basemap switches
 * and page reloads alike. */

/** @private True while the active basemap belongs to the satellite group. */
function satelliteBasemapActive() {
  const source = MAP_SOURCES.find((s) => s.id === currentSourceId);
  return !!source && source.group === 'satellite';
}

/** @private Broadcasts the button state (disabled + pressed) to the UI. */
function emitRoadOverlayState() {
  emit('roadOverlay:changed', { available: satelliteBasemapActive(), enabled: roadOverlayOn });
}

/** @private Shows or hides the mounted overlay layers (no-op before a mount).
 * The natural landmarks ride the same toggle, so they flip here too. */
function setRoadOverlayVisibility(visible) {
  for (const layer of ROAD_OVERLAY_LAYERS) {
    if (map.getLayer(layer.id)) {
      map.setLayoutProperty(layer.id, 'visibility', visible ? 'visible' : 'none');
    }
  }
  setNaturalVisibility(map, visible);
}

/** @private Idempotently mounts the overlay on the ACTIVE style and shows it —
 * after the first enable or any setStyle wipe. Each layer goes before the
 * track vectors (above the satellite raster), and a layer that already exists
 * is restacked to the same anchor instead of re-added, so reloads never
 * duplicate source/layers. Label layers get their text-field built for the
 * CURRENT UI language (the static defs carry the English default). */
function ensureRoadOverlayLayers() {
  if (!map.getSource(ROAD_OVERLAY_SOURCE_ID)) map.addSource(ROAD_OVERLAY_SOURCE_ID, ROAD_OVERLAY_SOURCE);
  const beforeId = map.getLayer('track-casing') ? 'track-casing' : undefined;
  for (const layer of ROAD_OVERLAY_LAYERS) {
    if (map.getLayer(layer.id)) {
      // A raster→raster basemap switch re-inserted the opaque imagery above
      // the hung overlay — restack each layer back under the track vectors.
      // Every move targets the same anchor, preserving paint order. The
      // visibility flip still applies: this path also runs for layers hidden
      // by a previous toggle-off.
      map.moveLayer(layer.id, beforeId);
      map.setLayoutProperty(layer.id, 'visibility', 'visible');
      continue;
    }
    if (layer.type === 'symbol') {
      map.addLayer({
        ...layer,
        layout: { ...layer.layout, 'text-field': roadOverlayTextField(layer.id, getCurrentLanguage()) },
      }, beforeId);
      continue;
    }
    map.addLayer(layer, beforeId);
  }
  // The same raster→raster switch buries the whole custom stack under the
  // fresh imagery (the re-inserted basemap layer lands just under the track
  // vectors). Walk the imagery back down — directly under the first overlay
  // layer. Idempotent when it never moved.
  const firstOverlay = ROAD_OVERLAY_LAYERS.find((l) => map.getLayer(l.id));
  if (map.getLayer('basemap-layer') && firstOverlay) {
    map.moveLayer('basemap-layer', firstOverlay.id);
  }
  // The natural landmarks mount last with the same anchor — topmost inside
  // the overlay block, still beneath the track vectors.
  ensureNaturalOverlay(map, beforeId);
}

/** @private Re-labels the mounted overlay text layers after a language
 * switch — the label fallback leads with `name:<UI language>`. The natural
 * landmarks' labels are plain strings built with the same fallback chain,
 * so their rebuild rides the same event. */
function refreshRoadOverlayLanguage() {
  if (!map) return;
  for (const layer of ROAD_OVERLAY_LAYERS) {
    if (layer.type === 'symbol' && map.getLayer(layer.id)) {
      map.setLayoutProperty(layer.id, 'text-field', roadOverlayTextField(layer.id, getCurrentLanguage()));
    }
  }
  refreshNaturalOverlay(map);
}

/** @private Elevation in the natural landmarks' labels follows the unit
 * system — rebuild the label strings when it flips. */
function refreshRoadOverlayUnits() {
  if (!map) return;
  refreshNaturalOverlay(map);
}

/** @private Drops the overlay source and layers entirely (idempotent). */
function removeRoadOverlay() {
  for (const layer of ROAD_OVERLAY_LAYERS) {
    if (map.getLayer(layer.id)) map.removeLayer(layer.id);
  }
  if (map.getSource(ROAD_OVERLAY_SOURCE_ID)) map.removeSource(ROAD_OVERLAY_SOURCE_ID);
  removeNaturalOverlay(map);
}

/** @private Aligns the overlay with the current basemap. Every setSource
 * funnels through here (inline for raster→raster swaps, in the style-ready
 * callback after a provider-style round trip), so the mounted layers, the
 * toggle state and the button can never drift apart — including across style
 * reloads, which wipe the layers and are re-mounted by the ensure step. On a
 * satellite basemap the stored preference is the truth and is re-read on
 * every pass, so the overlay state survives basemap switches and page
 * reloads alike; a non-satellite basemap suspends it without erasing. */
function syncRoadOverlay() {
  if (!map) return;
  if (!satelliteBasemapActive()) {
    roadOverlayOn = false;
    removeRoadOverlay();
  } else {
    roadOverlayOn = savedRoadOverlayOn();
    if (roadOverlayOn) ensureRoadOverlayLayers();
    else setRoadOverlayVisibility(false);
  }
  emitRoadOverlayState();
}

/** Toggles the satellite road-network overlay and persists the choice — the
 * stored preference is what every later sync restores, so the state holds
 * across basemap switches and sessions. A no-op while a non-satellite
 * basemap is active — the button is disabled there. */
export function toggleRoadOverlay() {
  if (!map || !satelliteBasemapActive()) return;
  saveRoadOverlayOn(!savedRoadOverlayOn());
  syncRoadOverlay();
}

/** Scenario-tool hook: the live MapLibre instance, or null before the first
 * track creates it. Read-only — tools assert style state (overlay layers,
 * duplicates, stacking order) against the real map. */
export function getMapInstance() {
  return map;
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
    // The fresh source starts empty; syncSector keeps it that way while the
    // default full-range selection skips the highlight.
    sectorCleared = true;
    // Casing under line under sector, matching the Leaflet pane order. The 4px
    // track line is far below MapLibre's touch tolerance, so an invisible
    // widened twin carries the pointer events (Leaflet's path hit tolerance).
    map.addLayer({
      id: 'track-casing', type: 'line', source: 'track', layout: lineLayout,
      paint: { 'line-color': cssToken('--map-track-casing'), 'line-width': 8, 'line-opacity': 0.9 },
    });
    map.addLayer({
      id: 'track-line', type: 'line', source: 'track', layout: lineLayout,
      paint: { 'line-color': cssToken('--map-track'), 'line-width': 4, 'line-opacity': 0.95 },
    });
    map.addLayer({
      id: 'sector-line', type: 'line', source: 'sector', layout: lineLayout,
      paint: { 'line-color': cssToken('--map-sector'), 'line-width': 6, 'line-opacity': 1 },
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
  const display = thinStride(track.points);
  displayPoints = display;
  displayIndexOf = buildDisplayIndexOf(track.points, display);
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
  clearWaypointBridge();
  waypointPlates = [];
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
    el.innerHTML = `<div class="map-waypoint" style="--waypoint-color:${cssToken('--map-waypoint')}"></div>`;
    // Name plate in place of Leaflet's bindTooltip(direction: 'top'): a
    // self-drawn div above the pin, shown on hover via css/map.css.
    if (w.name) {
      const label = document.createElement('div');
      label.className = 'map-waypoint-label';
      label.textContent = w.name;
      el.appendChild(label);
    }
    // Waypoints are interactive — clicking one pans the map and pins the
    // profile line — so the marker is a keyboard-reachable button: Tab
    // reaches it, Enter/Space pans, focus mirrors hover (nameplate + the
    // profile's waypoint line) via the focus/blur listeners below.
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.setAttribute('aria-label', w.name || t('waypoint'));
    el.style.zIndex = '300';
    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([w.lon, w.lat])
      .addTo(map);
    el.addEventListener('mouseover', () => emit('waypoint:hover', { dist: near.dist, name: w.name || null }));
    el.addEventListener('mouseout', () => emit('waypoint:hover', { dist: null }));
    el.addEventListener('focus', () => emit('waypoint:hover', { dist: near.dist, name: w.name || null }));
    el.addEventListener('blur', () => emit('waypoint:hover', { dist: null }));
    // Clicking a waypoint centers the viewport on it; panTo keeps the
    // current zoom level untouched. The profile (wide screens only) pans
    // its zoom window to the same waypoint and pins its line/readout
    // until the next click anywhere.
    el.addEventListener('click', () => {
      map.panTo([w.lon, w.lat]);
      emit('waypoint:select', { dist: near.dist, name: w.name || null });
    });
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      el.click();
    });
    waypointPlates.push({ el, dist: near.dist, name: w.name || null, lat: w.lat, lon: w.lon });
    return marker;
  });
}

/** @private Ends the handle bridge: unraises the pin and ends its hover. */
function clearWaypointBridge() {
  if (!bridgedPlate) return;
  bridgedPlate.el.classList.remove('is-bridged');
  bridgedPlate = null;
  emit('waypoint:hover', { dist: null });
}

/** @private Hover bridge for the sector handles. A boundary parked on a
 *  waypoint shadows the pin with its 50px hit area (css .map-handle::after),
 *  so the pin's own hover — name plate and profile line — is unreachable
 *  exactly where the handle sits. The handle must keep the pointer (it is
 *  the drag affordance at that spot), so while the pointer is on a handle it
 *  surfaces the nearest pin within the handle's hit reach instead: the pin
 *  shows its plate pointer-transparent (.is-bridged) and drives the same
 *  waypoint:hover channel a pin hover does. Skipped while that handle
 *  drags — the boundary is moving and a chasing plate is noise. */
function bridgeWaypoint(marker) {
  if (dragging.start || dragging.end || !track || !waypointsVisible ||
      !waypointPlates.length) {
    clearWaypointBridge();
    return;
  }
  const c = marker.getLngLat();
  const o = map.project([c.lng, c.lat]);
  let best = null;
  let bestD = WAYPOINT_BRIDGE_PX;
  for (const w of waypointPlates) {
    const q = map.project([w.lon, w.lat]);
    const d = Math.hypot(q.x - o.x, q.y - o.y);
    if (d < bestD) { best = w; bestD = d; }
  }
  if (best === bridgedPlate) return;
  clearWaypointBridge();
  if (!best) return;
  bridgedPlate = best;
  best.el.classList.add('is-bridged');
  emit('waypoint:hover', { dist: best.dist, name: best.name });
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
  else { clearWaypointBridge(); for (const marker of layers.waypoints) marker.remove(); }
}

/** True when the OS asked for reduced motion: camera flights become the
 *  one-step jump (CSS already freezes its own transitions in base.css, but
 *  MapLibre's camera easing runs in JS and needs this explicit gate). */
function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** fitBounds that honors prefers-reduced-motion: under the preference the
 *  camera jumps straight to the fitted view (same cameraForBounds + jumpTo
 *  path as the de-animated initial fit) instead of flying there. */
function fitBoundsRespectingMotion(bounds) {
  if (prefersReducedMotion()) {
    // cameraForBounds is the exact camera fitBounds would animate to.
    const cam = map.cameraForBounds(bounds, { padding: 28 });
    if (cam) {
      map.jumpTo(cam);
      return;
    }
  }
  map.fitBounds(bounds, { padding: 28 });
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
    fitBoundsRespectingMotion(bounds);
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
    fitBoundsRespectingMotion([[minLon, minLat], [maxLon, maxLat]]);
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
  const color = cssToken(isStart ? '--map-handle-start' : '--map-handle-end');
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
  // Marker stacking order on the map, lowest first: waypoint pins 300,
  // hover dot 500, these handles 700, then the button columns at
  // --z-map-controls (800). A handle must stay grabbable above the track
  // (the whole canvas, and every marker with it, paints under the DOM) and
  // above the smaller markers, but must slide UNDER the buttons where they
  // overlap — 1000 covered the zoom and fit buttons. Marker z-index applies
  // because MapLibre positions markers with a transform (transformed
  // elements honor z-index like positioned ones).
  el.style.zIndex = '700';

  // The hover bridge: while the pointer is on a handle, a waypoint pinned
  // under its hit area shows its name plate and drives the profile line
  // (see bridgeWaypoint). Suppressed while a press is down: a drag (and the
  // auto-pan it can trigger) slides the markers around, and the synthetic
  // mouse events that movement fires carry unreliable button state — a
  // self-tracked press is the only clean signal. dragstart still drops a
  // pre-drag plate, and dragend re-evaluates at the resting position.
  let handlePressed = false;
  const endHandlePress = () => { handlePressed = false; };
  el.addEventListener('pointerdown', () => { handlePressed = true; clearWaypointBridge(); });
  // Non-mouse pointers end their hover at pointerup (the virtual mouse never
  // moves off after a tap, which would strand the plate).
  el.addEventListener('pointerup', (e) => {
    endHandlePress();
    if (e.pointerType !== 'mouse') clearWaypointBridge();
  });
  el.addEventListener('pointercancel', endHandlePress);
  window.addEventListener('pointerup', endHandlePress);
  window.addEventListener('pointercancel', endHandlePress);
  el.addEventListener('mouseenter', () => { if (!handlePressed) bridgeWaypoint(marker); });
  el.addEventListener('mousemove', () => { if (!handlePressed) bridgeWaypoint(marker); });
  el.addEventListener('mouseleave', clearWaypointBridge);

  marker.on('dragstart', () => {
    dragging[which] = true;
    clearWaypointBridge();
    dragHints[which] = sectorPoint(which)?.i ?? null;
  });
  marker.on('drag', (e) => {
    const { lat, lng } = marker.getLngLat();
    const near = nearestOnTrack(track, lat, lng, dragHints[which]);
    dragHints[which] = near.i;
    moveBoundary(which, near.dist);
    // The handle stays glued to the track for the whole drag: MapLibre parks
    // the marker at the cursor before firing 'drag', so re-pinning it to the
    // boundary's on-track point here wins the paint — the cursor may wander
    // off the line, the handle may not. dragend's snap becomes a no-op.
    const pt = pointAtDistance(track, near.dist);
    if (pt) marker.setLngLat([pt.lon, pt.lat]);
    autoPanToward(e.originalEvent, el);
  });
  marker.on('dragend', () => {
    dragging[which] = false;
    const pt = sectorPoint(which);
    if (pt) marker.setLngLat([pt.lon, pt.lat]);
    bridgeWaypoint(marker);
    // The last store change of the drag may have rendered the capped
    // mid-drag highlight — redraw once with dragging off so the resting
    // selection is the exact slice.
    scheduleSectorSync();
  });

  layers[`${which}Handle`] = marker;
}

/** @private Keyboard nudging of a boundary (focusable via the icon element). */
function onHandleKey(which, e) {
  const action = boundaryKeyAction(which, e, getTrackTotal());
  if (!action) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (action.to !== undefined) {
    moveBoundary(which, action.to);
    return;
  }
  const { start, end } = sectorStore.get();
  moveBoundary(which, (which === 'start' ? start : end) + action.delta);
}

/** @private Clicking the track moves the nearest boundary to the click. */
function onTrackClick(e) {
  if (!track) return;
  const near = nearestOnTrack(track, e.lngLat.lat, e.lngLat.lng, null);
  const { start, end } = sectorStore.get();
  const which = Math.abs(near.dist - start) <= Math.abs(end - near.dist) ? 'start' : 'end';
  moveBoundary(which, near.dist);
}

/** @private True when a map event's DOM target lives inside a MapLibre
 *  marker (waypoint pin, sector handle). Markers own their interactions —
 *  pins emit waypoint:hover and select, handles drag — and their mouse
 *  events must not also run the map's track hover/click pipeline, or a
 *  hover:dist with origin 'map' overwrites the pin's waypoint hover and the
 *  profile loses its violet waypoint line. Leaflet's interactive layers had
 *  this isolation built in; delegated MapLibre events bubble instead, so
 *  the guard is explicit. */
function fromMarker(e) {
  const target = e.originalEvent && e.originalEvent.target;
  return target instanceof Element && !!target.closest('.maplibregl-marker');
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

/** True while the sector source intentionally holds no line: the full-range
 *  selection skips the highlight (it would exactly cover the track line),
 *  and the flag keeps that skip from re-uploading an empty set on every
 *  store change. */
let sectorCleared = false;

/** The display-thinned polyline updateTrackGeometry feeds the map, cached
 *  so the sector highlight slices the SAME vertices the track line draws:
 *  the highlight then overlays the track exactly at every zoom, where two
 *  different thinnings of the raw points (a stride against the old
 *  Douglas-Peucker line) visibly diverged from each other at high zoom.
 *  The shared thinning is the even stride — one linear pass, no shape
 *  fitting, and a uniform sample of the raw recording — which keeps real
 *  trail-run tracks closest to what was actually recorded. displayIndexOf
 *  maps original point index → cached polyline index (-1 where the stride
 *  dropped the point). Both reset on every track load / style re-hang. */
let displayPoints = null;
let displayIndexOf = null;

/** @private Sector highlight geometry from the cached display polyline:
 *  every kept point between the boundaries (the nearest kept neighbor
 *  stands in where a boundary lands on a dropped point), with the
 *  interpolated boundary points as first/last entries so the highlight
 *  always reaches the handles. Null before the first track geometry hangs —
 *  unreachable through the store subscription, which only fires after
 *  hangTrackGeometry. */
function displaySlice(s, e) {
  if (!displayPoints || !displayIndexOf) return null;
  const pts = track.points;
  let di0 = -1;
  for (let i = s.i; i < pts.length; i++) {
    if (displayIndexOf[i] >= 0) { di0 = displayIndexOf[i]; break; }
  }
  let di1 = -1;
  for (let i = e.i; i >= 0; i--) {
    if (displayIndexOf[i] >= 0) { di1 = displayIndexOf[i]; break; }
  }
  const slice = di0 >= 0 ? displayPoints.slice(di0, di1 + 1) : [];
  if (slice.length) slice[0] = s;
  else slice.push(s);
  if (e.i > s.i || e.dist > s.dist) slice.push(e);
  return slice;
}

/** Original-index → display-index lookup for the cached display polyline.
 *  The thinning returns an ordered subset of the same point objects, so one
 *  identity merge pins every kept original point to its display slot. */
function buildDisplayIndexOf(points, display) {
  const idx = new Int32Array(points.length).fill(-1);
  let di = 0;
  for (let i = 0; i < points.length && di < display.length; i++) {
    if (display[di] === points[i]) idx[i] = di++;
  }
  return idx;
}

/** @private Redraws the sector highlight + handle positions + ARIA state. */
function syncSector() {
  const sectorSource = track && map ? map.getSource('sector') : null;
  if (!sectorSource) return;
  const { start, end } = sectorStore.get();

  // Sector highlight: the display-thinned polyline sliced between the
  // boundaries — the same vertices the track line draws — with the
  // interpolated boundary points replacing the first/last entries. The
  // full-range default skips the highlight entirely: with the boundaries at
  // the track ends the highlight would sit exactly on the track line, so
  // the source is emptied once instead of uploading a redundant duplicate
  // of the whole track on every load.
  const s = pointAtDistance(track, start);
  const e = pointAtDistance(track, end);
  if (s && e) {
    if (isEntireTrack()) {
      if (!sectorCleared) {
        sectorSource.setData({ type: 'FeatureCollection', features: [] });
        sectorCleared = true;
      }
    } else {
      sectorCleared = false;
      const slice = displaySlice(s, e);
      if (slice) {
        // Mid-drag the highlight thins harder (DRAG_SECTOR_CAP); dragend
        // schedules one exact re-render over the resting selection.
        const drawn = dragging.start || dragging.end ? thinStride(slice, DRAG_SECTOR_CAP) : slice;
        const coordinates = drawn.map((p) => [p.lon, p.lat]);
        sectorSource.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates } });
      }
    }
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
}
