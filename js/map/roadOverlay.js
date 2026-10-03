/**
 * Satellite road-network overlay — the "hybrid map" layer stack.
 *
 * On a satellite basemap the optional road overlay draws vector roads and the
 * necessary geographic labels OVER the satellite imagery (under the track),
 * after the MapLibre hybrid-satellite example — without importing a full
 * vector map style: no 3D buildings, no POI system, no landuse polygons.
 *
 * The tiles come from OpenFreeMap's planet endpoint, the same provider and
 * host the OpenFreeMap basemap styles already use (keyless, CORS-enabled,
 * OpenMapTiles schema, attribution via the TileJSON). Labels are bilingual:
 * primary name follows the UI language (roadOverlayTextField: name:xx →
 * name:en → name_int → name:latin → name → ref) and the local name joins
 * at exactly the primary's size when it differs (the bilingual-map
 * convention — two scripts equally readable; two lines for place names,
 * one line for road names) — all in the single Noto Sans Regular glyph
 * set. GLYPHS below is the matching style-level font endpoint, which
 * the raster basemaps' minimal style carries.
 */

/** Style-level glyphs endpoint for the overlay's text layers. Only fetched
 * while overlay text layers actually render — carrying it in the minimal
 * style is free for the non-satellite raster basemaps. */
export const ROAD_OVERLAY_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

export const ROAD_OVERLAY_SOURCE_ID = 'road-overlay';

/**
 * Persisted toggle preference. Like the basemap/theme keys, the value lives
 * in localStorage under a `wayslice-` key and every access is guarded. It is
 * the source of truth on satellite basemaps: every sync re-reads it, so the
 * overlay state is stable across basemap switches and across sessions — a
 * non-satellite basemap only suspends it (live layers drop, button disables)
 * without erasing the choice.
 */
export const ROAD_OVERLAY_STORAGE_KEY = 'wayslice-road-overlay';

/** True when the stored preference says the overlay was last toggled on. */
export function savedRoadOverlayOn() {
  try {
    return localStorage.getItem(ROAD_OVERLAY_STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

/** Persists the user's toggle choice. @param {boolean} on */
export function saveRoadOverlayOn(on) {
  try {
    localStorage.setItem(ROAD_OVERLAY_STORAGE_KEY, on ? 'on' : 'off');
  } catch { /* ignore */ }
}

/** OpenMapTiles schema via OpenFreeMap's planet TileJSON (native z14, with
 * MapLibre overzoom past it — same as the OFM basemap styles). */
export const ROAD_OVERLAY_SOURCE = {
  type: 'vector',
  url: 'https://tiles.openfreemap.org/planet',
};

const LABEL_FONT = ['Noto Sans Regular'];

/** Road names ride ON the white road lines, so they invert: dark text in a
 * white halo keeps them legible over the casing/core and the imagery
 * showing through the gaps. */
const LABEL_PAINT_ROAD = {
  'text-color': 'rgba(45, 45, 45, 0.95)',
  'text-halo-color': 'rgba(255, 255, 255, 0.9)',
  'text-halo-width': 1.1,
  'text-halo-blur': 0.3,
};

/** Place names sit straight on the imagery: white text in a dark halo. */
const LABEL_PAINT_PLACE = {
  'text-color': '#ffffff',
  'text-halo-color': 'rgba(40, 40, 40, 0.9)',
  'text-halo-width': 1.2,
  'text-halo-blur': 0.3,
};

/**
 * Bilingual label text, as a `format` expression.
 *
 * Primary name — first non-empty of the UI language's localized name
 * (`name:xx`, xx = the code), English, international, Latin transliteration,
 * raw local name, then the route number (`ref` — motorway stubs often only
 * carry a number). Colon-form `name:xx` keys only — the old localized `name_`
 * underscore keys (name_en and siblings) are deprecated in the tile schema
 * and must not be used; `name_int` is the one current-schema underscore
 * field and stays.
 *
 * Secondary name — the raw local `name` field, rendered ONLY when it exists
 * and is not the primary again, so a localized name that already IS the
 * local name never repeats. The dedup comparison is case-insensitive;
 * MapLibre expressions have no whitespace-stripping, so space-only
 * differences still show (vanishingly rare in practice). `name_int`/
 * `name:latin` feed the primary fallback exclusively — the secondary is
 * always the local name itself. Both sections carry identical styling —
 * the secondary renders at exactly the primary's zoom-adaptive size: the
 * deliberate bilingual-map convention (two scripts equally readable, as
 * on bilingual street plates), never a size hierarchy.
 *
 * Layout variant by layer: place names stack on two lines (`\n`), road
 * names share one line (space separator).
 *
 * The static layer defs ship the English default; mapView re-writes the
 * mounted text layers' `text-field` with the live UI language at mount
 * time and on every language switch.
 *
 * @param {string} layerId  the overlay label layer the field is built for
 * @param {string} code  UI language code (en/de/es/fr/it/ja/ko)
 */
export function roadOverlayTextField(layerId, code) {
  // The trailing '' keeps every branch a string even for nameless features
  // (an empty label renders nothing, like the old null did).
  const primary = [
    'coalesce',
    ['get', `name:${code}`],
    ['get', 'name:en'],
    ['get', 'name_int'],
    ['get', 'name:latin'],
    ['get', 'name'],
    ['get', 'ref'],
    '',
  ];
  const secondary = ['coalesce', ['get', 'name'], ''];
  const isDifferentName = [
    'all',
    ['!=', secondary, ''],
    ['!=', ['downcase', secondary], ['downcase', primary]],
  ];
  const section = { 'text-font': ['literal', LABEL_FONT] };
  return [
    'case',
    isDifferentName,
    [
      'format',
      primary, section,
      layerId === 'road-overlay-label-place' ? '\n' : ' ', {},
      secondary, section,
    ],
    ['format', primary, section],
  ];
}

/** English defaults for the exported layer definitions. */
const TEXT_FIELD_ROAD = roadOverlayTextField('road-overlay-label-road', 'en');
const TEXT_FIELD_PLACE = roadOverlayTextField('road-overlay-label-place', 'en');

/**
 * One linear zoom curve whose every stop hands off to a per-class `match`.
 * MapLibre allows a single zoom-driven curve per expression — a case nested
 * around several per-class zoom curves is silently rejected at addLayer
 * (a map error event, no throw) — so every per-class gate in this file is
 * written in exactly this shape: values are looked up by class INSIDE each
 * stop, and zoom interpolates the matched numbers between stops.
 *
 * @param {Array<string | string[]>} classes  match keys, in column order —
 *   an entry may be an array to share one value across a class family
 * @param {Array<number[]>} stops  rows of [zoom, ...valuePerClass]
 */
function classCurve(classes, stops) {
  return [
    'interpolate', ['linear'], ['zoom'],
    ...stops.flatMap(([zoom, ...values]) => [
      zoom,
      ['match', ['get', 'class'],
        ...classes.flatMap((cls, i) => [cls, values[i]]),
        0],
    ]),
  ];
}

/** The six road classes the casing and core layers draw. */
const MAJOR_CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'];

/** Graduated widths (px) per class at each zoom stop — the dark casing
 * first table, the white core second (the core sits inside the casing, so
 * it is always the thinner of the pair). Secondary and tertiary stay 0
 * until z9 and minor rides a z9 hairline: the planet tiles carry their
 * geometry only well past the trunk-road zooms, and a 0 stop draws
 * nothing before then. */
const CASING_WIDTHS = [
  // zoom, motorway, trunk, primary, secondary, tertiary, minor
  [5, 2.2, 2.0, 1.8, 0, 0, 0],
  [9, 3.4, 3.2, 2.8, 2.4, 2.2, 1.4],
  [13, 5.0, 4.6, 4.0, 3.6, 3.4, 2.6],
  [16, 9.0, 8.5, 8.0, 7.0, 6.5, 5.0],
  [19, 10.5, 10.0, 9.5, 8.5, 8.0, 6.0],
];
const CORE_WIDTHS = [
  [5, 1.1, 1.0, 0.9, 0, 0, 0],
  [9, 1.9, 1.7, 1.5, 1.3, 1.2, 0.5],
  [13, 3.0, 2.8, 2.4, 2.2, 2.0, 1.4],
  [16, 6.0, 5.5, 5.0, 4.4, 4.0, 2.8],
  [19, 7.0, 6.5, 6.0, 5.2, 4.6, 3.2],
];

/** Settlement classes the place labels draw, and their gated text sizes:
 * a class enters where its column first leaves 0 (city from z3, town from
 * z5, village from z9, the city-fragment family from z10, hamlet from
 * z13) and grows to the z19 anchor. A 0 output hides the class — labels
 * with a zero size render nothing. */
const PLACE_SIZE_CLASSES = ['city', 'town', 'village', ['suburb', 'quarter', 'neighbourhood'], 'hamlet'];
const PLACE_SIZES = [
  // zoom, city, town, village, suburb/quarter/neighbourhood, hamlet
  [3, 13.75, 0, 0, 0, 0],
  [5, 15, 11.875, 0, 0, 0],
  [8, 16.25, 13.75, 0, 0, 0],
  [9, 16.25, 13.75, 11.25, 0, 0],
  [10, 16.875, 14.375, 11.875, 10.625, 0],
  [11, 17.5, 15, 12.5, 10.625, 0],
  [12, 18.75, 15.625, 12.5, 11.25, 0],
  [13, 19.375, 16.25, 13.125, 11.875, 10.625],
  [16, 20, 17.5, 15, 13.75, 12.5],
  [19, 21.25, 18.75, 16.25, 15, 13.75],
];

/** Road layers draw white lines (the classic hybrid look over imagery) —
 * the path and tunnel layers use the plain base; the casing, core,
 * service and track layers carry their own paints. Surface layers skip
 * tunnels — those get the dedicated dimmed dashed tunnel layer at the
 * bottom of the stack, so no road ever draws twice. */
const ROAD_PAINT_BASE = { 'line-color': '#ffffff' };

/**
 * The overlay layers, bottom to top. Order matters: mapView mounts them all
 * before `track-casing`, so they stack above the satellite raster and below
 * every WaySlice track vector. Mounting is idempotent (layers already on the
 * style are flipped back to visible instead of re-added), so these objects
 * must stay constant.
 */
export const ROAD_OVERLAY_LAYERS = [
  {
    // Tunnels: buried roads read as a ghost of the route, not a road —
    // dimmed, dashed, under every surface layer, from the street-detail
    // zooms. The surface layers exclude brunnel=tunnel, so the two never
    // double-draw the same geometry.
    id: 'road-overlay-line-tunnel',
    type: 'line',
    source: ROAD_OVERLAY_SOURCE_ID,
    'source-layer': 'transportation',
    minzoom: 8,
    filter: [
      'all',
      ['==', ['get', 'brunnel'], 'tunnel'],
      ['match', ['get', 'class'],
        ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'track', 'path'], true, false],
    ],
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'visible' },
    paint: {
      ...ROAD_PAINT_BASE,
      'line-opacity': 0.6,
      'line-dasharray': [1.5, 1.5],
      'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1, 15, 1.5, 19, 3],
    },
  },
  {
    // Dark casing under every major road line: a half-transparent dark
    // stroke wider than the white core, so the white roads keep an edge on
    // bright imagery (sand, concrete, glare) instead of dissolving into
    // it. Same six classes, same width table and same z5 start as the
    // core above it.
    id: 'road-overlay-line-casing',
    type: 'line',
    source: ROAD_OVERLAY_SOURCE_ID,
    'source-layer': 'transportation',
    minzoom: 5,
    filter: [
      'all',
      ['!=', ['get', 'brunnel'], 'tunnel'],
      ['match', ['get', 'class'], MAJOR_CLASSES, true, false],
    ],
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'visible' },
    paint: {
      'line-color': 'rgba(30, 30, 30, 0.6)',
      'line-width': classCurve(MAJOR_CLASSES, CASING_WIDTHS),
    },
  },
  {
    // The six major road classes as one white core, from the first zooms
    // where the planet tiles carry them (z5 for the trunk family; the
    // lesser classes ride 0-width stops until z9). The old per-class
    // opacity split is folded into the color's alpha.
    id: 'road-overlay-line-major',
    type: 'line',
    source: ROAD_OVERLAY_SOURCE_ID,
    'source-layer': 'transportation',
    minzoom: 5,
    filter: [
      'all',
      ['!=', ['get', 'brunnel'], 'tunnel'],
      ['match', ['get', 'class'], MAJOR_CLASSES, true, false],
    ],
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'visible' },
    paint: {
      'line-color': 'rgba(255, 255, 255, 0.92)',
      'line-width': classCurve(MAJOR_CLASSES, CORE_WIDTHS),
    },
  },
  {
    // Service roads — scenic-area loops, parking aisles — as a thin faint
    // solid line, only from z13 where they stop being noise over the
    // imagery.
    id: 'road-overlay-line-service',
    type: 'line',
    source: ROAD_OVERLAY_SOURCE_ID,
    'source-layer': 'transportation',
    minzoom: 13,
    filter: ['all', ['!=', ['get', 'brunnel'], 'tunnel'], ['==', ['get', 'class'], 'service']],
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'visible' },
    paint: {
      ...ROAD_PAINT_BASE,
      'line-opacity': 0.6,
      'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.7, 16, 1.1, 19, 1.6],
    },
  },
  {
    // Tracks — forest and farm roads with an actual bed — as the LONG
    // dash, visibly coarser than the path dashes below: reads as "a track
    // you could drive", not a footpath.
    id: 'road-overlay-line-track',
    type: 'line',
    source: ROAD_OVERLAY_SOURCE_ID,
    'source-layer': 'transportation',
    minzoom: 12,
    filter: ['all', ['!=', ['get', 'brunnel'], 'tunnel'], ['==', ['get', 'class'], 'track']],
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'visible' },
    paint: {
      ...ROAD_PAINT_BASE,
      'line-opacity': 0.85,
      'line-dasharray': [3, 1.5],
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 14, 1.4, 16, 2.0, 19, 2.8],
    },
  },
  {
    // Walking paths: thin dashes, so a trail reads differently from a road.
    id: 'road-overlay-line-path',
    type: 'line',
    source: ROAD_OVERLAY_SOURCE_ID,
    'source-layer': 'transportation',
    minzoom: 13,
    filter: ['all', ['!=', ['get', 'brunnel'], 'tunnel'], ['==', ['get', 'class'], 'path']],
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'visible' },
    paint: {
      ...ROAD_PAINT_BASE,
      'line-opacity': 0.8,
      'line-dasharray': [1.5, 1],
      'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1, 17, 2, 19, 3],
    },
  },
  {
    // Road names along every named line feature — no class filter: a
    // trail's name (the MacLehose Trail) is worth more outdoors than the
    // density it costs, so named paths, tracks and service loops label
    // alongside the roads. The minzoom stays a notch above the lines so
    // the looser filter doesn't flood the mid zooms.
    id: 'road-overlay-label-road',
    type: 'symbol',
    source: ROAD_OVERLAY_SOURCE_ID,
    'source-layer': 'transportation_name',
    minzoom: 12,
    layout: {
      'symbol-placement': 'line',
      'text-field': TEXT_FIELD_ROAD,
      'text-font': LABEL_FONT,
      'text-size': ['interpolate', ['linear'], ['zoom'], 12, 12.5, 16, 15.625, 19, 17.5],
      visibility: 'visible',
    },
    paint: LABEL_PAINT_ROAD,
  },
  {
    // Settlement names across the full seven-place hierarchy — the
    // "necessary geographic labels". The single per-class zoom curve gates
    // each class in (a 0 output hides it: city from z3, town from z5,
    // village from z9, the city-fragment family from z10, hamlet from
    // z13) and grows it to the z19 anchor. The planet tiles rank-limit
    // which places each zoom carries, and MapLibre's collision detection
    // declutters the rest.
    id: 'road-overlay-label-place',
    type: 'symbol',
    source: ROAD_OVERLAY_SOURCE_ID,
    'source-layer': 'place',
    minzoom: 3,
    filter: ['match', ['get', 'class'],
      ['city', 'town', 'village', 'hamlet', 'suburb', 'quarter', 'neighbourhood'], true, false],
    layout: {
      'text-field': TEXT_FIELD_PLACE,
      'text-font': LABEL_FONT,
      'text-max-width': 8,
      'text-size': classCurve(PLACE_SIZE_CLASSES, PLACE_SIZES),
      visibility: 'visible',
    },
    paint: LABEL_PAINT_PLACE,
  },
];
