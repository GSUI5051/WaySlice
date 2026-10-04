/**
 * Natural landmarks — the satellite road overlay's natural=* point family.
 *
 * Seven OSM point features ride the road-network overlay as one GeoJSON
 * symbol layer: peak, saddle, volcano, cave_entrance, spring, rock, stone.
 * They share the overlay's whole lifecycle (satellite-only, the Roads
 * toggle, under the track vectors) — there is no separate POI system and no
 * new switch.
 *
 * Two data feeds, one display source:
 *  - peak / saddle / volcano already ride the OpenFreeMap planet tiles the
 *    overlay draws roads from (the `mountain_peak` source layer, rank-rated
 *    and carrying ele/ele_ft plus the full name:* set). They are lifted out
 *    of the already-loaded tiles — zero extra requests.
 *  - cave_entrance / spring / rock / stone are absent from the vector tiles
 *    (the tile `poi` layer carries no natural=* points at all), so they come
 *    from one debounced viewport query to the Overpass API, cached per
 *    expanded bounding box and refetched only when the camera leaves it.
 *
 * The OSM tag reality this module is written against (spec: names and
 * elevations are OPTIONAL and independent): every combination of name/ele
 * renders — icon + name + elevation, icon + name, icon + elevation
 * (formatted by the shared unit formatter, never the raw tag), or a bare
 * icon. A feature is never dropped for missing fields, and elevation
 * parsing accepts meters, feet and explicitly-unitied values without ever
 * feeding an unparseable string into math.
 */
import { METERS_PER_FOOT } from '../units/units.js';
import { formatElevation } from '../utils/format.js';
import { getCurrentLanguage } from '../language/language.js';
import {
  ROAD_OVERLAY_SOURCE_ID, classCurve, ROAD_OVERLAY_LABEL_FONT, ROAD_OVERLAY_LABEL_PAINT_PLACE,
  overlayNameKeys,
} from './roadOverlay.js';

export const NATURAL_SOURCE_ID = 'road-overlay-natural';

/** The seven supported natural=* values, in gate-table column order. */
export const NATURAL_TYPES = ['peak', 'saddle', 'volcano', 'cave_entrance', 'spring', 'rock', 'stone'];

/** The four types the planet tiles cannot provide (they ride Overpass). */
export const NATURAL_POI_TYPES = ['cave_entrance', 'spring', 'rock', 'stone'];

/** The three tile-carried classes the mountain_peak source layer may hold —
 * the layer ALSO carries cliff/ridge, which are line/area landforms and
 * must never reach these point layers. */
export const TILE_NATURAL_CLASSES = ['peak', 'saddle', 'volcano'];

/** Viewport Overpass queries start at this zoom — below it every natural
 * gate is still closed, so the request would buy nothing. */
export const NATURAL_FETCH_MIN_ZOOM = 12;

/** How far the fetched bounding box reaches past the viewport (fraction of
 * its size, per axis) — pans inside the padded box never refetch. */
const OVERPASS_PAD = 0.35;

/** Per-attempt ceiling: a hung or throttled endpoint hands off to the next
 * one instead of stalling the rebuild chain. */
const OVERPASS_TIMEOUT_MS = 15000;

/** Canonical endpoint first; kumi.systems is the classic worldwide mirror.
 * Overpass instances differ in reachability per network — every failure
 * (HTTP, timeout, CORS) just falls through to the next host. */
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/* ---- tags → model ------------------------------------------------------ */

const ELEVATION_TAG_RE = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*(m|meter|metre|meters|metres|ft|foot|feet|')?$/i;

/**
 * Parses a raw OSM `ele=*` value into meters. Unitless numbers are meters
 * (the OSM convention); explicit meters and feet units are honored — an
 * unparseable value (empty, non-numeric, unsupported unit) returns null
 * rather than ever reaching math half-parsed.
 * @param {string|number|null} raw
 * @returns {number|null} canonical meters
 */
export function parseElevationTag(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const m = ELEVATION_TAG_RE.exec(s);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  const unit = (m[2] || 'm').toLowerCase();
  if (unit === 'ft' || unit === 'foot' || unit === 'feet' || unit === "'") {
    return value * METERS_PER_FOOT;
  }
  return value;
}

/**
 * The feet-only aux sources (`ele:ft=*`, the tiles' numeric `ele_ft`) are
 * unitless numbers whose SEMANTICS are feet — a different parse from `ele`.
 * @param {string|number|null} raw
 * @returns {number|null} canonical meters
 */
export function parseFeetTag(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(s)) return null;
  const value = Number(s);
  return Number.isFinite(value) ? value * METERS_PER_FOOT : null;
}

/**
 * Canonical elevationMeters for a feature's tags. `ele` wins whenever it
 * parses; `ele:ft`/`ele_ft` is the aux source used only in its absence —
 * the two are never averaged and never both shown. Null = unavailable,
 * which only means the label loses its elevation line.
 * @param {Record<string, unknown>} tags
 */
export function canonicalElevationMeters(tags) {
  const primary = parseElevationTag(tags.ele);
  if (primary != null) return primary;
  return parseFeetTag(tags['ele:ft'] ?? tags.ele_ft);
}

/**
 * The localized display name, using the SAME fallback chain the road and
 * place labels build their expression from (name:<UI> → name:en →
 * name_int → name:latin → name). Overpass features simply lack the fields
 * the tiles synthesize (name_int), so the chain skips them naturally.
 * Returns '' for nameless features — the internal natural=* tag never
 * becomes a name.
 * @param {Record<string, unknown>} tags
 * @param {string} code  UI language code
 */
export function localizedName(tags, code) {
  for (const key of overlayNameKeys(code)) {
    const value = tags[key];
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

/**
 * Label text: name stacked over the elevation (the place-label two-line
 * convention); either alone when the other is missing; '' (icon only)
 * when both are. Elevation always renders through the shared unit
 * formatter — user unit setting, integer display — never the raw tag.
 * @param {string} name
 * @param {number|null} meters
 */
export function buildNaturalLabel(name, meters) {
  if (name && meters != null) return `${name}\n${formatElevation(meters)}`;
  if (name) return name;
  if (meters != null) return formatElevation(meters);
  return '';
}

/** The importance tier from the tiles' rank (1 notable … 5 minor): the
 * two terrain-landmark classes surface their top ranks earlier — a simple
 * two-tier split, deliberately not a ranking system. */
export function gateClassFor(type, rank = 5) {
  if ((type === 'peak' || type === 'volcano') && rank <= 2) return `${type}-major`;
  return type;
}

/* ---- zoom gates --------------------------------------------------------- */

/**
 * Per-gate-class entry zooms: the icon first, the label a notch later —
 * never all seven from the world view. stone/rock/spring enter late so the
 * low zooms stay quiet; peak/volcano majors lead from z8. An entry zoom is
 * the first stop where the column is fully open; each class fades in
 * across the preceding stop gap (the place-label curve convention).
 */
export const NATURAL_GATES = {
  'peak-major': { icon: 8, text: 10 },
  'peak': { icon: 11, text: 13 },
  'volcano-major': { icon: 8, text: 10 },
  'volcano': { icon: 10, text: 12.5 },
  'saddle': { icon: 12, text: 14 },
  'cave_entrance': { icon: 13.5, text: 14.5 },
  'spring': { icon: 13.5, text: 14.5 },
  'rock': { icon: 14.5, text: 15.5 },
  'stone': { icon: 15.5, text: 16.5 },
};

const GATE_CLASSES = Object.keys(NATURAL_GATES);

/** Icon sizes (fractions of the 24-unit sprite box → 12–17 px on screen).
 * A 0 output hides the class before its entry zoom. Gated on `gateClass`
 * — the derived rank-tier property the features carry. */
export const NATURAL_ICON_SIZES = classCurve(GATE_CLASSES, [
  // zoom, peak-major, peak, volcano-major, volcano, saddle, cave_entrance, spring, rock, stone
  [8, 0.5, 0, 0.5, 0, 0, 0, 0, 0, 0],
  [10, 0.55, 0, 0.55, 0.5, 0, 0, 0, 0, 0],
  [11, 0.55, 0.5, 0.55, 0.55, 0, 0, 0, 0, 0],
  [12, 0.6, 0.55, 0.6, 0.55, 0.5, 0, 0, 0, 0],
  [13, 0.6, 0.55, 0.6, 0.6, 0.55, 0, 0, 0, 0],
  [13.5, 0.6, 0.6, 0.6, 0.6, 0.55, 0.5, 0.5, 0, 0],
  [14.5, 0.65, 0.6, 0.65, 0.6, 0.6, 0.55, 0.55, 0.5, 0],
  [15.5, 0.65, 0.65, 0.65, 0.65, 0.6, 0.6, 0.6, 0.55, 0.5],
  [17, 0.7, 0.65, 0.7, 0.65, 0.65, 0.6, 0.6, 0.6, 0.55],
  [19, 0.7, 0.7, 0.7, 0.7, 0.7, 0.65, 0.65, 0.65, 0.6],
], 'gateClass');

/** Label sizes — landmarks read a step below settlement names. The first
 * stop sits at the layer minzoom with every column closed: MapLibre clamps
 * below the first stop, so an 11-zoom first row would silently open the
 * majors' labels at z8 — icons lead, labels join two zooms later. */
export const NATURAL_TEXT_SIZES = classCurve(GATE_CLASSES, [
  // zoom, peak-major, peak, volcano-major, volcano, saddle, cave_entrance, spring, rock, stone
  [8, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [10, 11.25, 0, 11.25, 0, 0, 0, 0, 0, 0],
  [11, 11.875, 0, 11.875, 0, 0, 0, 0, 0, 0],
  [12.5, 11.875, 0, 11.875, 11.25, 0, 0, 0, 0, 0],
  [13, 11.875, 11.25, 11.875, 11.25, 0, 0, 0, 0, 0],
  [14, 12.5, 11.875, 12.5, 11.875, 11.25, 0, 0, 0, 0],
  [14.5, 12.5, 11.875, 12.5, 12.5, 11.875, 11.25, 11.25, 0, 0],
  [15.5, 13.125, 12.5, 13.125, 12.5, 12.5, 11.875, 11.875, 11.25, 0],
  [16.5, 13.125, 13.125, 13.125, 13.125, 13.125, 12.5, 12.5, 12.5, 11.25],
  [19, 13.75, 13.75, 13.75, 13.75, 13.75, 13.125, 13.125, 13.125, 12.5],
], 'gateClass');

/** Collision priority: majors win, stones lose. */
const SORT_RANK = Object.fromEntries(GATE_CLASSES.map((cls, i) => [cls, i + 1]));

/* ---- layer defs ---------------------------------------------------------- */

/**
 * The one symbol layer the seven types render through (icon + label in a
 * single symbol: collision treats the pair as a unit, `text-optional`
 * lets the icon survive where the label loses). The label text lives in
 * the feature's `label` property — rebuilt by the shared unit formatter on
 * every language or unit change — so this def is language-independent and
 * mapView must NOT hand it the road/place bilingual text-field builder.
 */
export const NATURAL_LAYERS = [
  {
    id: 'road-overlay-symbol-natural',
    type: 'symbol',
    source: NATURAL_SOURCE_ID,
    minzoom: 8,
    layout: {
      'icon-image': ['concat', 'natural-', ['get', 'naturalClass']],
      'icon-size': NATURAL_ICON_SIZES,
      'icon-allow-overlap': false,
      'icon-padding': 2,
      'symbol-sort-key': ['get', 'sortRank'],
      'text-field': ['get', 'label'],
      'text-font': ROAD_OVERLAY_LABEL_FONT,
      'text-size': NATURAL_TEXT_SIZES,
      'text-anchor': 'top',
      'text-offset': [0, 0.6],
      'text-max-width': 9,
      'text-optional': true,
      'text-allow-overlap': false,
      'text-padding': 2,
      visibility: 'visible',
    },
    paint: {
      'icon-opacity': 0.95,
      ...ROAD_OVERLAY_LABEL_PAINT_PLACE,
    },
  },
];

/* ---- icons ---------------------------------------------------------------- */

/**
 * 24-unit Lucide-style stroke drawings, rasterized once per style into
 * `natural-<type>` images (pixelRatio 2). Real Lucide paths where Lucide
 * has the landform (peak = mountain, spring = droplet); the rest are drawn
 * in the same idiom — no second icon library. Each icon strokes twice: a
 * dark under-stroke reads as the halo the place labels get, so the white
 * drawing holds on any imagery.
 */
const ICON_PATHS = {
  // Lucide "mountain".
  peak: ['m8 3 4 8 5-5 5 15H2L8 3z'],
  // Two summits with the col between them.
  saddle: ['M4 18 9 9l3 4.5L15 9l5 9z'],
  // Flat-topped cone with the eruption above the crater.
  volcano: ['M8.5 5 3 20h18L15.5 5z', 'M8.5 5h7', 'M12 2.2v.01', 'M8.6 3.2l-1-1', 'M15.4 3.2l1-1'],
  // The arch of a cave mouth over the ground line.
  cave_entrance: ['M6 20a6 6 0 0 1 12 0', 'M2.5 20h19'],
  // Lucide "droplet", lifted, over a rising-water wave.
  spring: [
    'M12 13a4 4 0 0 0 4-4c0-1.13-.56-2.2-1.7-3.1-1.1-.92-2-2.3-2.3-3.9-.3 1.6-1.2 2.98-2.3 3.9-1.14.9-1.7 1.97-1.7 3.1a4 4 0 0 0 4 4z',
    'M2.5 20c1.6-1.4 3.2-1.4 4.75 0s3.15 1.4 4.75 0 3.15-1.4 4.75 0 3.15 1.4 4.75 0',
  ],
  // A faceted boulder with its facet line.
  rock: ['M7.5 4.5 15 3l5 7.5-2.5 9-9.5 1L3 12z', 'M7.5 4.5 10 12l7.5 7'],
  // A rounded pebble, visibly smaller and softer than the faceted rock.
  stone: ['M9 8a3.5 3.5 0 0 1 6 0l1.7 4.6A4.8 4.8 0 0 1 12 18a4.8 4.8 0 0 1-4.7-6.8z', 'M9.3 13.5a2.8 2.8 0 0 0 1.8 3.9'],
};

/** @private Rasterizes one icon drawing into ImageData at pixelRatio 2. */
function rasterizeIcon(paths, px = 48) {
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const shapes = paths.map((d) => new Path2D(d));
  // The drawings live in a 24-unit space; the canvas is px square.
  const scale = px / 24;
  ctx.scale(scale, scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Halo pass first (wide dark), then the white drawing — the label
  // paint's white-on-dark recipe, baked into the sprite.
  for (const [width, color] of [[2 * 1.45, 'rgba(40, 40, 40, 0.9)'], [2, '#ffffff']]) {
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    for (const shape of shapes) ctx.stroke(shape);
  }
  return ctx.getImageData(0, 0, px, px);
}

/**
 * Renders one type's sprite into an ImageData at an arbitrary pixel size —
 * the icon-verification tool draws these magnified for the shape review;
 * the live map only ever consumes ensureNaturalImages's pixelRatio-2 pass.
 * @param {string} type  one of NATURAL_TYPES
 * @param {number} [px]
 */
export function rasterizeNaturalIcon(type, px = 48) {
  const paths = ICON_PATHS[type];
  return paths ? rasterizeIcon(paths, px) : null;
}

/** @private Registers the seven sprite images (idempotent per style). */
function ensureNaturalImages(map) {
  for (const type of NATURAL_TYPES) {
    const imageId = `natural-${type}`;
    if (map.hasImage(imageId)) continue;
    const data = rasterizeIcon(ICON_PATHS[type]);
    if (data) map.addImage(imageId, data, { pixelRatio: 2 });
  }
}

/* ---- data feeds ------------------------------------------------------------ */

/**
 * The Overpass query for the four tile-absent types over a bounding box
 * (south, west, north, east). Nodes only — the spec's point landforms.
 * @param {{s: number, w: number, n: number, e: number}} bbox
 */
export function overpassQuery(bbox) {
  const box = `[bbox:${bbox.s},${bbox.w},${bbox.n},${bbox.e}]`;
  const body = NATURAL_POI_TYPES.map((t) => `node["natural"="${t}"];`).join('');
  return `[out:json][timeout:20]${box};(${body});out body qt;`;
}

/**
 * Pure Overpass response → feature models. Only nodes carrying one of the
 * four target natural values survive — every other tag value (and every
 * non-target natural=*) is dropped here, before anything reaches a layer.
 * @param {{ elements?: Array<{ type?: string, lat?: number, lon?: number, tags?: Record<string, string> }>} | null} json
 */
export function parseOverpassElements(json) {
  const elements = json && Array.isArray(json.elements) ? json.elements : [];
  const out = [];
  for (const el of elements) {
    if (el.type !== 'node' || !Number.isFinite(el.lat) || !Number.isFinite(el.lon)) continue;
    const natural = el.tags?.natural;
    if (!NATURAL_POI_TYPES.includes(natural)) continue;
    out.push({ type: natural, lon: el.lon, lat: el.lat, tags: { ...el.tags } });
  }
  return out;
}

/**
 * Lifts the peak family out of the ALREADY-LOADED planet tiles — the same
 * source the road lines draw from, so this costs no network at all.
 * cliff/ridge (line/area landforms the tile layer also carries) and every
 * non-point geometry are excluded; dedup keys on class + rounded
 * coordinates, since overlapping tiles surface the same summit twice.
 * @param {Array<ReturnType<import('maplibre-gl').Map['querySourceFeatures']>[number]>} features
 */
export function peaksFromTileFeatures(features) {
  const out = new Map();
  for (const f of features) {
    const cls = f.properties?.class;
    if (!TILE_NATURAL_CLASSES.includes(cls)) continue;
    if (!f.geometry || f.geometry.type !== 'Point') continue;
    const [lon, lat] = f.geometry.coordinates;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const key = `${cls}@${lon.toFixed(5)},${lat.toFixed(5)}`;
    if (out.has(key)) continue;
    out.set(key, { type: cls, lon, lat, tags: { ...f.properties }, rank: Number(f.properties.rank) || 5 });
  }
  return [...out.values()];
}

/** Model → render feature: the label is built HERE, with the current UI
 * language and unit system, so the style reads one plain property. */
function toFeature(model) {
  const gate = gateClassFor(model.type, model.rank);
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [model.lon, model.lat] },
    properties: {
      naturalClass: model.type,
      gateClass: gate,
      sortRank: SORT_RANK[gate],
      label: buildNaturalLabel(localizedName(model.tags, getCurrentLanguage()), canonicalElevationMeters(model.tags)),
    },
  };
}

/** All current models → the display FeatureCollection. Exported for the
 * model tests: the four name/ele combinations, the label composition and
 * the click-identification properties are pinned here. */
export function buildNaturalFeatureCollection(peaks, pois) {
  return { type: 'FeatureCollection', features: [...peaks, ...pois].map(toFeature) };
}

/* ---- lifecycle -------------------------------------------------------------- */

let enabled = false;
let layersVisible = false;
let wired = false;
let rebuildTimer = null;
let fetchController = null;
/** The Overpass cache: the padded bbox the current features cover. */
let overpassCache = null;

/** @private True while the toggle shows the natural layers on the map. */
function naturalMounted(map) {
  return !!map.getSource(NATURAL_SOURCE_ID) && layersVisible;
}

/** @private Debounced rebuild: tile peaks + cached Overpass features →
 * setData. Runs on moveend (camera settled) and idle (tiles finished
 * loading — the fresh tiles may carry summits the first pass missed). */
function scheduleRebuild(map) {
  if (rebuildTimer) return;
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    rebuild(map);
  }, 300);
}

/** @private */
function rebuild(map) {
  if (!enabled || !naturalMounted(map)) return;
  const source = map.getSource(NATURAL_SOURCE_ID);
  if (!source) return;
  const peaks = map.getSource(ROAD_OVERLAY_SOURCE_ID)
    ? peaksFromTileFeatures(map.querySourceFeatures(ROAD_OVERLAY_SOURCE_ID, { sourceLayer: 'mountain_peak' }))
    : [];
  const pois = overpassCache ? overpassCache.features : [];
  source.setData(buildNaturalFeatureCollection(peaks, pois));
  fetchOverpassViewport(map);
}

/** @private Refetches the padded viewport when the camera left the cached
 * box. One request, abortable, endpoint fallback with a per-attempt
 * timeout, never throwing — an Overpass failure only means the four small
 * types wait for a later pass (the peaks and the track are unaffected). */
async function fetchOverpassViewport(map) {
  if (map.getZoom() < NATURAL_FETCH_MIN_ZOOM) return;
  const b = map.getBounds();
  const padX = (b.getEast() - b.getWest()) * OVERPASS_PAD;
  const padY = (b.getNorth() - b.getSouth()) * OVERPASS_PAD;
  const bbox = {
    s: Math.max(-85.05113, b.getSouth() - padY),
    w: Math.max(-180, b.getWest() - padX),
    n: Math.min(85.05113, b.getNorth() + padY),
    e: Math.min(180, b.getEast() + padX),
  };
  const cached = overpassCache;
  if (cached && bbox.s >= cached.s && bbox.w >= cached.w && bbox.n <= cached.n && bbox.e <= cached.e) return;
  // A newer viewport supersedes any in-flight fetch for an older one.
  if (fetchController) fetchController.abort();
  const outer = new AbortController();
  fetchController = outer;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    if (outer.signal.aborted) return;
    // The per-attempt controller stops on the timeout OR the outer abort
    // (a newer viewport won / the overlay closed).
    const attempt = new AbortController();
    const onOuterAbort = () => attempt.abort();
    outer.signal.addEventListener('abort', onOuterAbort, { once: true });
    const timer = setTimeout(() => attempt.abort(), OVERPASS_TIMEOUT_MS);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(overpassQuery(bbox))}`,
        signal: attempt.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const features = parseOverpassElements(await res.json());
      if (outer.signal.aborted) return;
      overpassCache = { ...bbox, features };
      rebuild(map);
      return;
    } catch {
      if (outer.signal.aborted) return;
      // try the next endpoint; falling out of the loop keeps the old cache
    } finally {
      clearTimeout(timer);
      outer.signal.removeEventListener('abort', onOuterAbort);
    }
  }
}

/**
 * Mounts the natural source/layer stack and arms its data wiring — the
 * natural sibling of the road layers' idempotent mount. Images, source and
 * layer are per-style, so every satellite basemap (re)mount runs this.
 * @param {import('maplibre-gl').Map} map
 * @param {string|undefined} beforeId  the track-vector anchor the roads use
 */
export function ensureNaturalOverlay(map, beforeId) {
  enabled = true;
  layersVisible = true;
  ensureNaturalImages(map);
  if (!map.getSource(NATURAL_SOURCE_ID)) {
    map.addSource(NATURAL_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  }
  for (const layer of NATURAL_LAYERS) {
    if (!map.getLayer(layer.id)) map.addLayer(layer, beforeId);
  }
  if (!wired) {
    wired = true;
    const onCamera = () => {
      if (!enabled) return;
      scheduleRebuild(map);
    };
    map.on('moveend', onCamera);
    map.on('idle', onCamera);
  }
  scheduleRebuild(map);
}

/** Hides or shows the mounted natural layers (toggle flips this; a hidden
 * stack also pauses Overpass traffic). */
export function setNaturalVisibility(map, visible) {
  layersVisible = visible;
  for (const layer of NATURAL_LAYERS) {
    if (map.getLayer(layer.id)) {
      map.setLayoutProperty(layer.id, 'visibility', visible ? 'visible' : 'none');
    }
  }
}

/** Drops the natural stack entirely (satellite exit) — idempotent, and it
 * cancels any in-flight viewport fetch. */
export function removeNaturalOverlay(map) {
  enabled = false;
  if (rebuildTimer) { clearTimeout(rebuildTimer); rebuildTimer = null; }
  if (fetchController) { fetchController.abort(); fetchController = null; }
  for (const layer of NATURAL_LAYERS) {
    if (map.getLayer(layer.id)) map.removeLayer(layer.id);
  }
  if (map.getSource(NATURAL_SOURCE_ID)) map.removeSource(NATURAL_SOURCE_ID);
}

/**
 * Rebuilds labels from the cached models — the language and unit switches
 * funnel here, since name choice and elevation formatting both live in the
 * label strings.
 */
export function refreshNaturalOverlay(map) {
  if (!map || !enabled || !naturalMounted(map)) return;
  rebuild(map);
}
