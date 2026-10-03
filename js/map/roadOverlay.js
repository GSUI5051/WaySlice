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
 * OpenMapTiles schema, attribution via the TileJSON). Labels render Latin
 * names (`name:latin` → `name_en` → `name`) so the single Noto Sans Regular
 * glyph set covers every string; GLYPHS below is the matching style-level
 * font endpoint, which the raster basemaps' minimal style carries.
 */

/** Style-level glyphs endpoint for the overlay's text layers. Only fetched
 * while overlay text layers actually render — carrying it in the minimal
 * style is free for the non-satellite raster basemaps. */
export const ROAD_OVERLAY_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

export const ROAD_OVERLAY_SOURCE_ID = 'road-overlay';

/** OpenMapTiles schema via OpenFreeMap's planet TileJSON (native z14, with
 * MapLibre overzoom past it — same as the OFM basemap styles). */
export const ROAD_OVERLAY_SOURCE = {
  type: 'vector',
  url: 'https://tiles.openfreemap.org/planet',
};

const TEXT_FIELD = ['coalesce', ['get', 'name:latin'], ['get', 'name_en'], ['get', 'name']];
const LABEL_FONT = ['Noto Sans Regular'];
const LABEL_PAINT = {
  'text-color': '#ffffff',
  'text-halo-color': 'rgba(25, 25, 25, 0.8)',
  'text-halo-width': 1.2,
  'text-halo-blur': 0.3,
};

/** Road layers draw white lines (the classic hybrid look over imagery);
 * tunnels are skipped — buried roads are invisible in reality. */
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
    // Main road classes, from the first zooms where the planet tiles carry
    // them (z7).
    id: 'road-overlay-line-major',
    type: 'line',
    source: ROAD_OVERLAY_SOURCE_ID,
    'source-layer': 'transportation',
    minzoom: 7,
    filter: [
      'all',
      ['!=', ['get', 'brunnel'], 'tunnel'],
      ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'], true, false],
    ],
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'visible' },
    paint: {
      ...ROAD_PAINT_BASE,
      'line-opacity': ['match', ['get', 'class'], ['motorway', 'trunk'], 0.9, 0.8],
      'line-width': ['interpolate', ['exponential', 1.2], ['zoom'], 5, 0.5, 8, 1, 11, 1.8, 14, 3, 17, 5, 19, 6],
    },
  },
  {
    // Minor roads, service roads and tracks — only at the zooms where they
    // stop being noise.
    id: 'road-overlay-line-minor',
    type: 'line',
    source: ROAD_OVERLAY_SOURCE_ID,
    'source-layer': 'transportation',
    minzoom: 11,
    filter: [
      'all',
      ['!=', ['get', 'brunnel'], 'tunnel'],
      ['match', ['get', 'class'], ['minor', 'service', 'track'], true, false],
    ],
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'visible' },
    paint: {
      ...ROAD_PAINT_BASE,
      'line-opacity': 0.75,
      'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.8, 15, 1.5, 17, 3, 19, 4.5],
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
    // Road names along the lines (majors + minor streets; service-road and
    // path names stay unlabeled to keep the imagery readable).
    id: 'road-overlay-label-road',
    type: 'symbol',
    source: ROAD_OVERLAY_SOURCE_ID,
    'source-layer': 'transportation_name',
    minzoom: 11,
    filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'], true, false],
    layout: {
      'symbol-placement': 'line',
      'text-field': TEXT_FIELD,
      'text-font': LABEL_FONT,
      'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10.5, 17, 13],
      visibility: 'visible',
    },
    paint: LABEL_PAINT,
  },
  {
    // City / town / village names — the "necessary geographic labels". The
    // planet tiles rank-limit which places each zoom carries, and MapLibre's
    // collision detection declutters the rest.
    id: 'road-overlay-label-place',
    type: 'symbol',
    source: ROAD_OVERLAY_SOURCE_ID,
    'source-layer': 'place',
    minzoom: 2,
    filter: ['match', ['get', 'class'], ['city', 'town', 'village'], true, false],
    layout: {
      'text-field': TEXT_FIELD,
      'text-font': LABEL_FONT,
      'text-max-width': 8,
      'text-size': [
        'interpolate', ['linear'], ['zoom'],
        5, ['match', ['get', 'class'], 'city', 11, 'town', 10, 9],
        14, ['match', ['get', 'class'], 'city', 15, 'town', 13, 11],
      ],
      visibility: 'visible',
    },
    paint: LABEL_PAINT,
  },
];
