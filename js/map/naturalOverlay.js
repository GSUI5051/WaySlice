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
 *
 * Display-state memory, per mount: past the tile source's maxzoom the
 * overzoomed tile query can come back empty or partial, so the lifted peak
 * set only ever GROWS there (deep-zoom hold); and summits already drawn on
 * screen are latched into a collision-priority boost, so zooming in never
 * squeezes a seen landmark out (see-become-latched). Both clear on
 * teardown; the Overpass cache deliberately survives it.
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

/** The road tile source's TileJSON maxzoom: past it the map overzooms the
 * z14 tiles and `querySourceFeatures` can return an empty or partial set
 * (steady state, or only some ancestor tiles during a transition), so
 * rebuilds above this zoom must never shrink the lifted peak set. */
export const NATURAL_TILE_MAX_ZOOM = 14;

/** Viewport Overpass queries start at this zoom — below it every natural
 * gate is still closed, so the request would buy nothing. */
export const NATURAL_FETCH_MIN_ZOOM = 12;

/** How far the fetched bounding box reaches past the viewport (fraction of
 * its size, per axis) — pans inside the padded box never refetch. */
const OVERPASS_PAD = 0.35;

/** Per-attempt ceiling: a hung or throttled endpoint hands off to the next
 * one instead of stalling the rebuild chain. */
const OVERPASS_TIMEOUT_MS = 15000;

/** Hard ceiling on one viewport response, enforced on BOTH ends of the
 * pipe: the query asks the server to truncate, and the parser clamps the
 * element list again before anything reaches a layer. rock/stone cluster
 * in real OSM — a busy viewport can return tens of thousands of nodes —
 * and truncating beats letting them all into the render. */
export const OVERPASS_ELEMENT_CAP = 4000;

/** Endpoint chain in fallback order: private.coffee and the VK mail.ru
 * mirror are the CDN-friendly entry points, z/lz4 are the Overpass
 * project's own named instances, rambler is the classic worldwide mirror.
 * The canonical overpass-api.de interpreter is deliberately absent — its
 * per-client rate limits (429) make it the worst first hop. Overpass
 * instances differ in reachability per network — every failure (HTTP,
 * timeout, CORS) just falls through to the next host. */
const OVERPASS_ENDPOINTS = [
  'https://z.overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.osm.rambler.ru/cgi/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
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
 * Label text: main name over the local name over the elevation — the
 * overlay's bilingual convention (main name in the UI language, the raw
 * local `name` tag as the second line, then the height), synthesized HERE
 * so the style keeps reading one plain property. The local-name line only
 * appears when it exists and says something the main name doesn't (the
 * case-insensitive compare mirrors the road/place text-field rule); any
 * missing line drops — elevation only, name only, or '' (bare icon; the
 * internal natural=* tag never renders as a name). Elevation always goes
 * through the shared unit formatter — user unit setting, integer display.
 * @param {string} mainName
 * @param {string} localName  the raw OSM `name` tag
 * @param {number|null} meters
 */
export function buildNaturalLabel(mainName, localName, meters) {
  const lines = [];
  if (mainName) lines.push(mainName);
  if (localName && localName.toLowerCase() !== (mainName || '').toLowerCase()) lines.push(localName);
  if (meters != null) lines.push(formatElevation(meters));
  return lines.join('\n');
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
 * — the derived rank-tier property the features carry. The four small
 * Overpass classes share one growth model — hold the 0.5 entry size, then
 * climb linearly to the z19 terminal — with cave/spring on the same ramp
 * (0.5 → 0.6@15.5 → 0.65@19), rock rising later (0.65@19) and stone the
 * shallowest (0.6@19); the z17 row carries the linear in-between values. */
export const NATURAL_ICON_SIZES = classCurve(GATE_CLASSES, [
  // zoom, peak-major, peak, volcano-major, volcano, saddle, cave_entrance, spring, rock, stone
  [8, 0.5, 0, 0.5, 0, 0, 0, 0, 0, 0],
  [10, 0.55, 0, 0.55, 0.5, 0, 0, 0, 0, 0],
  [11, 0.55, 0.5, 0.55, 0.55, 0, 0, 0, 0, 0],
  [12, 0.6, 0.55, 0.6, 0.55, 0.5, 0, 0, 0, 0],
  [13, 0.6, 0.55, 0.6, 0.6, 0.55, 0, 0, 0, 0],
  [13.5, 0.6, 0.6, 0.6, 0.6, 0.55, 0.5, 0.5, 0, 0],
  [14.5, 0.65, 0.6, 0.65, 0.6, 0.6, 0.55, 0.55, 0.5, 0],
  [15.5, 0.65, 0.65, 0.65, 0.65, 0.6, 0.6, 0.6, 0.5, 0.5],
  [17, 0.7, 0.65, 0.7, 0.65, 0.65, 0.62, 0.62, 0.56, 0.54],
  [19, 0.7, 0.7, 0.7, 0.7, 0.7, 0.65, 0.65, 0.65, 0.6],
], 'gateClass');

/** Label sizes — landmarks read a step below settlement names. The first
 * stop sits at the layer minzoom with every column closed: MapLibre clamps
 * below the first stop, so an 11-zoom first row would silently open the
 * majors' labels at z8 — icons lead, labels join two zooms later. The four
 * small classes share the trio's terminal size: each enters at 11.5 and
 * climbs to 13.75@z19 (cave from 14.5, spring holding 11.5 to 15.5, rock
 * from 15.5, stone from 16.5), so every natural label reads the same size
 * once the camera is deep. The z15/z16 rows are collinear trio stops that
 * carry the small classes' linear in-between values — inserting a
 * collinear stop changes nothing for the trio columns. */
export const NATURAL_TEXT_SIZES = classCurve(GATE_CLASSES, [
  // zoom, peak-major, peak, volcano-major, volcano, saddle, cave_entrance, spring, rock, stone
  [8, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [10, 11.25, 0, 11.25, 0, 0, 0, 0, 0, 0],
  [11, 11.875, 0, 11.875, 0, 0, 0, 0, 0, 0],
  [12.5, 11.875, 0, 11.875, 11.25, 0, 0, 0, 0, 0],
  [13, 11.875, 11.25, 11.875, 11.25, 0, 0, 0, 0, 0],
  [14, 12.5, 11.875, 12.5, 11.875, 11.25, 0, 0, 0, 0],
  [14.5, 12.5, 11.875, 12.5, 12.5, 11.875, 11.5, 11.5, 0, 0],
  [15, 12.813, 12.188, 12.813, 12.5, 12.188, 11.833, 11.5, 0, 0],
  [15.5, 13.125, 12.5, 13.125, 12.5, 12.5, 12.167, 11.5, 11.5, 0],
  [16, 13.125, 12.813, 13.125, 12.813, 12.813, 12.5, 12.5, 12.5, 0],
  [16.5, 13.125, 13.125, 13.125, 13.125, 13.125, 12.708, 12.708, 12.708, 11.5],
  [19, 13.75, 13.75, 13.75, 13.75, 13.75, 13.75, 13.75, 13.75, 13.75],
], 'gateClass');

/** Collision priority: majors win, stones lose. */
const SORT_RANK = Object.fromEntries(GATE_CLASSES.map((cls, i) => [cls, i + 1]));

/** How far a latched (already-seen) landmark drops its collision priority:
 * enough to outrank every base rank while staying one plain number. */
export const LATCH_BOOST = 20;

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
      // 小类标签用对方的 1.05em 远距（2026-10-05 裁决），trio 保持 0.6 ——
      // 单层载七类，按 naturalClass 分支；两个输出都必须 literal 包裹，
      // 裸数组会被当成表达式、addLayer 静默拒绝。
      'text-offset': ['match', ['get', 'naturalClass'],
        ['cave_entrance', 'spring', 'rock', 'stone'], ['literal', [0, 1.05]],
        ['literal', [0, 0.6]]],
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
 * 24-unit Lucide-style drawings, rasterized once per style into
 * `natural-<type>` images (pixelRatio 2). Real Lucide paths where Lucide
 * has the landform (peak = triangle, spring = droplet); the rest are drawn
 * in the same idiom — no second icon library. Each drawing splits into
 * `solid` outlines (filled, white unless the entry carries a `fill`) and
 * `line` details (2-unit white strokes). peak and volcano are one FILLED
 * triangle family told apart by shape — plain summit vs flat-topped crater
 * with eruption scratches — a distinction that must survive desaturated
 * viewing on its own; the volcano's red (`--series-hr`, fixed and
 * theme-independent) is only a secondary cue. rock's facets vs stone's
 * roundness is a deliberate contrast the drawings keep. Every path first
 * strokes in a wide dark under-stroke — the halo the place labels get —
 * so the drawing holds on any imagery.
 */
const ICON_PATHS = {
  // Lucide "triangle", filled — the plain solid summit marker.
  peak: {
    solid: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 20h16a2 2 0 0 0 1.73-2Z'],
    lines: [],
  },
  // Two summits with the col between them.
  saddle: { solid: [], lines: ['M4 18 9 9l3 4.5L15 9l5 9z'] },
  // The triangle family's truncated variant: a solid flat-topped cone
  // whose flat top IS the crater, three eruption scratches above it. The
  // red fill is the fixed chart heart-rate token — identical in both
  // themes, so the once-per-style raster bake never re-runs.
  volcano: {
    solid: ['M8.5 5 3 20h18L15.5 5z'],
    lines: ['M12 2.2v2', 'M8.3 3.2l-1.4-1.4', 'M15.7 3.2l1.4-1.4'],
    fill: 'var(--series-hr)',
  },
  // A ground-hugging low half-arch cave mouth + ground line (radius 7.5:
  // the arch stays legible at the smallest size).
  cave_entrance: {
    solid: [],
    lines: ['M4.5 20a7.5 7.5 0 0 1 15 0', 'M2.5 20h19'],
  },
  // A box-filling single water droplet — the one water-source metaphor,
  // unblurred even at the smallest size.
  spring: { solid: [], lines: ['M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z'] },
  // A faceted boulder with its facet line.
  rock: { solid: [], lines: ['M7.5 4.5 15 3l5 7.5-2.5 9-9.5 1L3 12z', 'M7.5 4.5 10 12l7.5 7'] },
  // A rounded pebble, visibly smaller and softer than the faceted rock.
  stone: {
    solid: [],
    lines: ['M9 8a3.5 3.5 0 0 1 6 0l1.7 4.6A4.8 4.8 0 0 1 12 18a4.8 4.8 0 0 1-4.7-6.8z', 'M9.3 13.5a2.8 2.8 0 0 0 1.8 3.9'],
  },
};

/** @private Resolves a drawing's fill to a paintable color: a `var(--token)`
 * is read off the document element at raster time (the sprite is baked
 * pixels), with the token's own literal as the empty-value fallback;
 * anything else paints as-is; no fill means white. Only theme-independent
 * tokens are used here, so the once-per-style bake needs no theme
 * re-rasterization path. */
function resolveFill(fill) {
  if (!fill) return '#ffffff';
  const token = /^var\((--[\w-]+)\)$/.exec(fill);
  if (!token) return fill;
  return getComputedStyle(document.documentElement).getPropertyValue(token[1]).trim() || '#ef4444';
}

/** @private Rasterizes one icon drawing into ImageData at pixelRatio 2.
 * Pass order: every path under-stroked wide in dark (the halo), then the
 * white drawing — fill for the solid body, 2-unit strokes for the line
 * details. The fill covers the inner half of the body's halo, leaving the
 * same outward dark rim the line drawings keep. */
function rasterizeIcon({ solid = [], lines = [], fill }, px = 48) {
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const solidShapes = solid.map((d) => new Path2D(d));
  const lineShapes = lines.map((d) => new Path2D(d));
  // The drawings live in a 24-unit space; the canvas is px square.
  const scale = px / 24;
  ctx.scale(scale, scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2 * 1.45;
  ctx.strokeStyle = 'rgba(24, 26, 28, 0.9)';
  for (const shape of [...solidShapes, ...lineShapes]) ctx.stroke(shape);
  ctx.fillStyle = resolveFill(fill);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  for (const shape of solidShapes) ctx.fill(shape);
  ctx.lineWidth = 2;
  for (const shape of lineShapes) ctx.stroke(shape);
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
 * (south, west, north, east). Nodes only — the spec's point landforms. The
 * `out` clause carries the element cap so a busy viewport is truncated
 * server-side, before it ever crosses the network.
 * @param {{s: number, w: number, n: number, e: number}} bbox
 */
export function overpassQuery(bbox) {
  const box = `[bbox:${bbox.s},${bbox.w},${bbox.n},${bbox.e}]`;
  const body = NATURAL_POI_TYPES.map((t) => `node["natural"="${t}"];`).join('');
  return `[out:json][timeout:20]${box};(${body});out body ${OVERPASS_ELEMENT_CAP} qt;`;
}

/**
 * Pure Overpass response → feature models. Only nodes carrying one of the
 * four target natural values survive — every other tag value (and every
 * non-target natural=*) is dropped here, before anything reaches a layer.
 * The element list is clamped to the cap before filtering (bounding the
 * parse of one response) and the result is clamped again after — the cap
 * is a hard bound on the model set either way.
 * @param {{ elements?: Array<{ type?: string, lat?: number, lon?: number, tags?: Record<string, string> }>} | null} json
 */
export function parseOverpassElements(json) {
  const elements = json && Array.isArray(json.elements) ? json.elements.slice(0, OVERPASS_ELEMENT_CAP) : [];
  const out = [];
  for (const el of elements) {
    if (el.type !== 'node' || !Number.isFinite(el.lat) || !Number.isFinite(el.lon)) continue;
    const natural = el.tags?.natural;
    if (!NATURAL_POI_TYPES.includes(natural)) continue;
    out.push({ type: natural, lon: el.lon, lat: el.lat, tags: { ...el.tags } });
  }
  return out.length > OVERPASS_ELEMENT_CAP ? out.slice(0, OVERPASS_ELEMENT_CAP) : out;
}

/**
 * The shared identity key — class plus coordinates rounded to 5 decimals —
 * used by the tile dedup, the deep-zoom merge and the latch alike, so a
 * summit can never be confused with a same-class neighbor somewhere else.
 * @param {string} type
 * @param {number} lon
 * @param {number} lat
 */
function naturalKey(type, lon, lat) {
  return `${type}@${lon.toFixed(5)},${lat.toFixed(5)}`;
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
    const key = naturalKey(cls, lon, lat);
    if (out.has(key)) continue;
    out.set(key, { type: cls, lon, lat, tags: { ...f.properties }, rank: Number(f.properties.rank) || 5 });
  }
  return [...out.values()];
}

/**
 * Deep-zoom hold: merges freshly lifted tile models into the held set. An
 * empty lift returns `kept` untouched; otherwise existing keys win (their
 * rank/name/ele state survives) and only NEW keys are appended. Above the
 * tile maxzoom the display set therefore only grows — and at or below it
 * the tiles replace authoritatively, which also bounds any accumulation
 * to one deep-zoom round trip.
 * @param {Array} kept  the previous lift's models
 * @param {Array} lifted  the current querySourceFeatures lift
 */
export function mergeModels(kept, lifted) {
  if (!lifted.length) return kept;
  const out = kept.slice();
  const seen = new Set(out.map((m) => naturalKey(m.type, m.lon, m.lat)));
  for (const model of lifted) {
    const key = naturalKey(model.type, model.lon, model.lat);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(model);
  }
  return out;
}

/** Model → render feature: the label is built HERE, with the current UI
 * language and unit system, so the style reads one plain property. A
 * latched terrain landmark (see `latchedKeys`) drops its collision
 * priority by LATCH_BOOST — the latch only reorders collisions, it never
 * touches the visibility gates. */
function toFeature(model, latchedKeys) {
  const gate = gateClassFor(model.type, model.rank);
  const base = SORT_RANK[gate];
  const latched = TILE_NATURAL_CLASSES.includes(model.type)
    && latchedKeys.has(naturalKey(model.type, model.lon, model.lat));
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [model.lon, model.lat] },
    properties: {
      naturalClass: model.type,
      gateClass: gate,
      sortRank: latched ? base - LATCH_BOOST : base,
      label: buildNaturalLabel(
        localizedName(model.tags, getCurrentLanguage()),
        typeof model.tags.name === 'string' ? model.tags.name : '',
        canonicalElevationMeters(model.tags),
      ),
    },
  };
}

/** All current models → the display FeatureCollection. The third parameter
 * is the latch set (keyed like the tile dedup); omitting it renders every
 * feature unlatched. Exported for the model tests: the four name/ele
 * combinations, the label composition and the click-identification
 * properties are pinned here. */
export function buildNaturalFeatureCollection(peaks, pois, latchedKeys = new Set()) {
  return { type: 'FeatureCollection', features: [...peaks, ...pois].map((m) => toFeature(m, latchedKeys)) };
}

/* ---- lifecycle -------------------------------------------------------------- */

let enabled = false;
let layersVisible = false;
let wired = false;
let rebuildTimer = null;
let fetchController = null;
/** The Overpass cache: the padded bbox the current features cover. */
let overpassCache = null;
/** Deep-zoom hold: the last lift's trio models, merged back in above the
 * tile maxzoom (where the overzoomed query can no longer be trusted to
 * return the full set). Fresh `[]` on every mount. */
let liftedModels = [];
/** See-become-latched: the summits already drawn on screen, keyed like the
 * tile dedup. Boosted collision priority keeps them placed while the user
 * zooms deeper; cleared on teardown so a remount starts unbiased. */
const latchedKeys = new Set();
/** Signature of the FeatureCollection currently in the display source.
 * Rebuild skips setData when nothing changed: an identical re-set still
 * re-tiles the source and re-renders the map, whose idle then schedules
 * another rebuild — a self-sustaining ~300 ms loop that also aborted (and
 * so starved) any in-flight Overpass fetch. */
let lastSetSignature = null;
/** The padded bbox of the viewport fetch currently in flight, if any. */
let inFlightBbox = null;

/** @private True while the toggle shows the natural layers on the map. */
function naturalMounted(map) {
  return !!map.getSource(NATURAL_SOURCE_ID) && layersVisible;
}
/** @private Debounced rebuild: latch what's on screen, tile peaks (merged
 * above the tile maxzoom) + cached Overpass features → setData. Runs on
 * moveend (camera settled) and idle (tiles finished loading — the fresh
 * tiles may carry summits the first pass missed). */
function scheduleRebuild(map) {
  if (rebuildTimer) return;
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    rebuild(map);
  }, 300);
}

/** @private Latches the terrain landmarks currently on screen, ahead of a
 * rebuild's setData: a summit the user has SEEN keeps its collision slot
 * through the zoom-ins that follow instead of being squeezed out by
 * better-ranked neighbors. Only the tile trio latches — a boosted stone
 * would out-rank peaks, the exact burying this prevents — and only once
 * its icon gate is fully open at the current zoom: MapLibre keeps
 * zero-size symbols queryable, so the gate is what separates "seen" from
 * "merely loaded". Latching never touches visibility — zooming back out
 * hides by the size curves as always. */
function collectLatched(map) {
  if (!map.getLayer('road-overlay-symbol-natural')) return;
  const zoom = map.getZoom();
  for (const f of map.queryRenderedFeatures({ layers: ['road-overlay-symbol-natural'] })) {
    const cls = f.properties?.naturalClass;
    if (!TILE_NATURAL_CLASSES.includes(cls)) continue;
    const gate = NATURAL_GATES[f.properties?.gateClass];
    if (!gate || zoom < gate.icon) continue;
    const [lon, lat] = f.geometry.coordinates;
    latchedKeys.add(naturalKey(cls, lon, lat));
  }
}

/** @private */
function rebuild(map) {
  if (!enabled || !naturalMounted(map)) return;
  const source = map.getSource(NATURAL_SOURCE_ID);
  if (!source) return;
  collectLatched(map);
  const lifted = map.getSource(ROAD_OVERLAY_SOURCE_ID)
    ? peaksFromTileFeatures(map.querySourceFeatures(ROAD_OVERLAY_SOURCE_ID, { sourceLayer: 'mountain_peak' }))
    : [];
  // Past the tile maxzoom the overzoomed query may return nothing (or only
  // part of the ancestor tiles) — merge into the held set so the summit
  // the user zoomed into survives. At or below it the tiles are
  // authoritative: replace outright.
  const peaks = map.getZoom() > NATURAL_TILE_MAX_ZOOM ? mergeModels(liftedModels, lifted) : lifted;
  liftedModels = peaks;
  const pois = overpassCache ? overpassCache.features : [];
  const collection = buildNaturalFeatureCollection(peaks, pois, latchedKeys);
  const signature = JSON.stringify(collection);
  if (signature !== lastSetSignature) {
    lastSetSignature = signature;
    source.setData(collection);
  }
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
  // A viewport fetch already running for THIS box just needs to finish —
  // restarting it on every rebuild would abort the in-flight attempt a
  // few hundred ms in, long before even a fast endpoint answers, and the
  // chain would never reach its later mirrors.
  if (fetchController && inFlightBbox && inFlightBbox.s === bbox.s && inFlightBbox.w === bbox.w
    && inFlightBbox.n === bbox.n && inFlightBbox.e === bbox.e) return;
  // A newer viewport supersedes any in-flight fetch for an older one.
  if (fetchController) fetchController.abort();
  const outer = new AbortController();
  fetchController = outer;
  inFlightBbox = bbox;
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
      if (fetchController === outer) { fetchController = null; inFlightBbox = null; }
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
  // The whole chain failed (or the overlay closed) — hand the state back
  // so a later camera pass can try again; leave the old cache alone.
  if (fetchController === outer) { fetchController = null; inFlightBbox = null; }
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
    if (!map.getLayer(layer.id)) {
      map.addLayer(layer, beforeId);
    } else {
      // The road layers' ensure pass restacks each of them to the track
      // anchor, which leaves the whole road block between this layer and
      // the anchor — and the imagery move then buries the natural layer
      // under the opaque raster. Ride the same restack back to the anchor,
      // and bring back a layer hidden by a previous toggle-off (the same
      // visibility flip the road layers get).
      map.moveLayer(layer.id, beforeId);
      map.setLayoutProperty(layer.id, 'visibility', 'visible');
    }
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
 * cancels any in-flight viewport fetch. The display-state memory (lift
 * models, latch) clears with it — a fresh mount starts fresh; the
 * Overpass cache deliberately survives. */
export function removeNaturalOverlay(map) {
  enabled = false;
  if (rebuildTimer) { clearTimeout(rebuildTimer); rebuildTimer = null; }
  if (fetchController) { fetchController.abort(); fetchController = null; }
  liftedModels = [];
  latchedKeys.clear();
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
