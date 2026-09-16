/**
 * Map view — Leaflet integration.
 *
 * Shows the whole track, the highlighted sector, two draggable boundary
 * handles and the file's waypoints. Everything is drawn from the ORIGINAL
 * track points (display-only simplification), and every user interaction
 * funnels into `sectorStore`, which the profile and metrics panels also
 * subscribe to.
 */
/* global L */
import { sectorStore, moveBoundary, getTrackTotal, isEntireTrack } from '../sector/sectorStore.js';
import { nearestOnTrack } from '../geo/interpolate.js';
import { pointAtDistance } from '../geo/interpolate.js';
import { simplifyForDisplay, thinStride } from '../geo/simplify.js';
import { getSavedSource, createTileLayer, saveSource, MAP_SOURCES } from './sources.js';
import { wantsCooperativeGestures, addGestureHint } from './gestures.js';
import { formatDistanceShort } from '../utils/format.js';
import { getUnitSystem } from '../units/units.js';
import { t } from '../language/language.js';
import { emit, on } from '../core/events.js';

let map = null;
let track = null;
let rafPending = false;
let waypointsVisible = true;

const layers = {
  trackCasing: null,
  trackLine: null,
  sectorLine: null,
  startHandle: null,
  endHandle: null,
  hoverDot: null,
  waypoints: null,
};

const dragHints = { start: null, end: null };
const dragging = { start: false, end: false };
let hoverHint = null;
let scaleControl = null;

/** Reads a themed design token (map layer colors live in css/tokens.css). */
function themeColor(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Re-styles track, sector, handle and waypoint colors after a theme flip. */
function applyMapTheme() {
  if (!layers.trackLine) return;
  layers.trackCasing.setStyle({ color: themeColor('--map-track-casing') });
  layers.trackLine.setStyle({ color: themeColor('--map-track') });
  layers.sectorLine.setStyle({ color: themeColor('--map-sector') });
  for (const which of ['start', 'end']) {
    const el = layers[`${which}Handle`]?.getElement()?.querySelector('.map-handle');
    if (el) {
      el.style.setProperty('--handle-color', themeColor(which === 'start' ? '--map-handle-start' : '--map-handle-end'));
    }
  }
  if (layers.waypoints) {
    for (const marker of layers.waypoints.getLayers()) {
      const el = marker.getElement()?.querySelector('.map-waypoint');
      if (el) el.style.setProperty('--waypoint-color', themeColor('--map-waypoint'));
    }
  }
}

/**
 * Creates the map, restores the saved basemap and wires sector syncing.
 * @param {HTMLElement} container
 */
export function initMap(container) {
  // Cooperative mode on touch devices: one finger scrolls the page, two
  // fingers pan/zoom the map. Disabling `dragging` (but keeping `touchZoom`)
  // leaves the container with Leaflet's `leaflet-touch-zoom` class, whose
  // `touch-action: pan-x pan-y` gives the page the single-finger swipe.
  const cooperative = wantsCooperativeGestures();
  map = L.map(container, {
    zoomControl: true,
    worldCopyJump: true,
    attributionControl: true,
    dragging: !cooperative,
  });
  // Zoom lives in the bottom-right corner: Leaflet inserts bottom-corner
  // controls above the attribution (never over it), and map.css lines the
  // bar's right edge up with the #map-fit button column.
  map.zoomControl.setPosition('bottomright');
  // Leaflet 1.9.4's default prefix ships an inline Ukrainian-flag SVG; keep
  // just the text link to the library.
  map.attributionControl.setPrefix('Leaflet');
  refreshScaleControl();
  setSource(getSavedSource());

  sectorStore.subscribe(scheduleSectorSync);
  on('units:changed', refreshScaleControl);
  on('theme:changed', applyMapTheme);
  // A click anywhere on the map unpins the profile's waypoint line (a
  // waypoint marker click selects instead; Leaflet marker clicks do not
  // bubble to the map).
  map.on('click', () => emit('waypoint:deselect'));
  if (cooperative) addGestureHint(container);

  // Keep Leaflet in sync with responsive layout changes.
  if ('ResizeObserver' in window) {
    let first = true;
    new ResizeObserver(() => {
      if (first) { first = false; return; }
      map.invalidateSize({ animate: false });
    }).observe(container);
  }
  return map;
}

function refreshScaleControl() {
  if (!map) return;
  if (scaleControl) map.removeControl(scaleControl);
  scaleControl = L.control.scale({ imperial: getUnitSystem() === 'imperial', metric: getUnitSystem() === 'metric', position: 'bottomleft' });
  scaleControl.addTo(map);
}

/** Switches the tile layer to the given source id and persists the choice. */
export function setSourceById(id) {
  const source = MAP_SOURCES.find((s) => s.id === id);
  if (!source) return;
  setSource(source);
  saveSource(id);
}

/** @private */
let currentTileLayer = null;
let currentOverlayLayer = null;
let currentSourceId = null;
function setSource(source) {
  if (currentTileLayer) map.removeLayer(currentTileLayer);
  if (currentOverlayLayer) map.removeLayer(currentOverlayLayer);
  currentSourceId = source.id;
  currentTileLayer = createTileLayer(source);
  currentTileLayer.addTo(map);
  // Sources may pair their base tiles with a transparent label overlay;
  // DOM order keeps it above the base and below the track's vector pane.
  currentOverlayLayer = source.overlayUrl ? createTileLayer(source, source.overlayUrl) : null;
  if (currentOverlayLayer) currentOverlayLayer.addTo(map);
}

/**
 * Loads a track onto the map: simplified display polyline + handles + fit.
 * @param {import('../types.js').Track} newTrack
 */
export function setTrack(newTrack) {
  track = newTrack;

  const display = simplifyForDisplay(track.points);
  const latlngs = display.map((p) => [p.lat, p.lon]);

  if (!layers.trackLine) {
    layers.trackCasing = L.polyline(latlngs, {
      color: themeColor('--map-track-casing'), weight: 8, opacity: 0.9,
      lineCap: 'round', lineJoin: 'round', interactive: false,
    }).addTo(map);
    layers.trackLine = L.polyline(latlngs, {
      color: themeColor('--map-track'), weight: 4, opacity: 0.95,
      lineCap: 'round', lineJoin: 'round',
    }).addTo(map);
    layers.sectorLine = L.polyline([], {
      color: themeColor('--map-sector'), weight: 6, opacity: 1,
      lineCap: 'round', lineJoin: 'round', interactive: false,
    }).addTo(map);
    layers.hoverDot = L.marker([0, 0], {
      icon: L.divIcon({ className: 'hover-dot-icon', html: '<div class="hover-dot"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }),
      interactive: false, zIndexOffset: 500,
    }).addTo(map);
    layers.hoverDot.setOpacity(0);

    createHandle('start');
    createHandle('end');

    layers.trackLine.on('click', onTrackClick);
    layers.trackLine.on('mousemove', onTrackHover);
    layers.trackLine.on('mouseout', () => showHover(null));
  } else {
    layers.trackCasing.setLatLngs(latlngs);
    layers.trackLine.setLatLngs(latlngs);
  }

  // File-picker focus changes can briefly leave the map container without a
  // measurable size. Defer fitting until the next frame, after Leaflet can
  // recalculate its viewport.
  rebuildWaypoints();
  requestAnimationFrame(() => fitTrack());
}

/** @private Rebuilds the waypoint marker group from `track.waypoints`. */
function rebuildWaypoints() {
  if (layers.waypoints) {
    layers.waypoints.remove();
    layers.waypoints = null;
  }
  const wpts = track?.waypoints || [];
  if (!wpts.length || !waypointsVisible) return;
  let hint = 0;
  layers.waypoints = L.layerGroup(
    wpts.map((w) => {
      // Resolve the waypoint onto the track once, so pin hovers can point the
      // elevation profile at the exact x position.
      const near = nearestOnTrack(track, w.lat, w.lon, hint);
      hint = near.i;
      const marker = L.marker([w.lat, w.lon], {
        icon: L.divIcon({
          className: 'map-waypoint-icon',
          html: `<div class="map-waypoint" style="--waypoint-color:${themeColor('--map-waypoint')}"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        }),
        keyboard: false,
        zIndexOffset: 300,
        alt: w.name || '',
      });
      if (w.name) marker.bindTooltip(w.name, { direction: 'top', offset: [0, -8] });
      marker.on('mouseover', () => emit('waypoint:hover', { dist: near.dist, name: w.name || null }));
      marker.on('mouseout', () => emit('waypoint:hover', { dist: null }));
      // Clicking a waypoint centers the viewport on it; panTo keeps the
      // current zoom level untouched. The profile (wide screens only) pans
      // its zoom window to the same waypoint and pins its line/readout
      // until the next click anywhere.
      marker.on('click', () => {
        map.panTo([w.lat, w.lon]);
        emit('waypoint:select', { dist: near.dist, name: w.name || null });
      });
      return marker;
    }),
  ).addTo(map);
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
  if (visible) layers.waypoints.addTo(map);
  else layers.waypoints.remove();
}

/** Fits the viewport to the whole track. */
export function fitTrack() {
  if (!track || !map || !map._container || !map._container.isConnected) return;
  try {
    map.invalidateSize({ animate: false });
    const b = track.bounds;
    map.fitBounds([[b.minLat, b.minLon], [b.maxLat, b.maxLon]], { padding: [28, 28] });
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
  if (!track || !map || !map._container || !map._container.isConnected) return;
  try {
    map.invalidateSize({ animate: false });
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
    map.fitBounds([[minLat, minLon], [maxLat, maxLon]], { padding: [28, 28] });
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
  layers.hoverDot.setLatLng([pt.lat, pt.lon]).setOpacity(1);
  if (origin !== 'map') return;
  emit('hover:dist', { dist, origin });
}

/** @private Creates one draggable sector boundary handle. */
function createHandle(which) {
  const isStart = which === 'start';
  const color = themeColor(isStart ? '--map-handle-start' : '--map-handle-end');
  const marker = L.marker([0, 0], {
    draggable: true,
    autoPan: true,
    autoPanPadding: [40, 40],
    zIndexOffset: 1000,
    icon: L.divIcon({
      className: `map-handle-icon map-handle-${which}`,
      html: `<div class="map-handle" style="--handle-color:${color}"><span class="map-handle-grip"></span></div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    }),
    keyboard: false,
  }).addTo(map);

  marker.on('dragstart', () => {
    dragging[which] = true;
    dragHints[which] = sectorPoint(which)?.i ?? null;
  });
  marker.on('drag', () => {
    const { lat, lng } = marker.getLatLng();
    const near = nearestOnTrack(track, lat, lng, dragHints[which]);
    dragHints[which] = near.i;
    moveBoundary(which, near.dist);
  });
  marker.on('dragend', () => {
    dragging[which] = false;
    const pt = sectorPoint(which);
    if (pt) marker.setLatLng([pt.lat, pt.lon]);
  });
  marker.on('add', () => {
    const el = marker.getElement();
    if (!el) return;
    el.tabIndex = 0;
    el.setAttribute('role', 'slider');
    el.addEventListener('keydown', (e) => onHandleKey(which, e));
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
  else if (e.key === 'Home') { moveBoundary(which, which === 'start' ? 0 : sectorStore.get().start); e.preventDefault(); return; }
  else if (e.key === 'End') { moveBoundary(which, which === 'end' ? getTrackTotal() : sectorStore.get().end); e.preventDefault(); return; }
  else return;
  e.preventDefault();
  const { start, end } = sectorStore.get();
  moveBoundary(which, (which === 'start' ? start : end) + delta);
}

/** @private Clicking the track moves the nearest boundary to the click. */
function onTrackClick(e) {
  if (!track) return;
  const near = nearestOnTrack(track, e.latlng.lat, e.latlng.lng, null);
  const { start, end } = sectorStore.get();
  const which = Math.abs(near.dist - start) <= Math.abs(end - near.dist) ? 'start' : 'end';
  moveBoundary(which, near.dist);
}

/** @private Track hover → hover dot + profile crosshair. */
function onTrackHover(e) {
  if (!track) return;
  const near = nearestOnTrack(track, e.latlng.lat, e.latlng.lng, hoverHint);
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
  if (!track || !layers.sectorLine) return;
  const { start, end } = sectorStore.get();

  // Sector highlight: original points inside the range, stride-thinned for
  // display; interpolated boundary points replace the first/last entries.
  const pts = track.points;
  const slice = [];
  const s = pointAtDistance(track, start);
  const e = pointAtDistance(track, end);
  if (s && e) {
    slice.push(s);
    for (let k = s.i + 1; k <= e.i; k++) slice.push(pts[k]);
    if (e.i > s.i || e.dist > s.dist) slice.push(e);
    const latlngs = thinStride(slice).map((p) => [p.lat, p.lon]);
    layers.sectorLine.setLatLngs(latlngs);
  }

  for (const which of ['start', 'end']) {
    const marker = layers[`${which}Handle`];
    if (!marker) continue;
    const pt = which === 'start' ? s : e;
    if (!pt) continue;
    if (!dragging[which]) marker.setLatLng([pt.lat, pt.lon]);
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
