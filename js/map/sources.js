/**
 * Basemap catalog. Sources are grouped for the selector and carry their own
 * attribution strings (required by the providers). Tile availability is a
 * provider concern — the app never auto-switches sources to match the theme.
 */
/**
 * @typedef {Object} MapSource
 * @property {string} id
 * @property {string} labelKey      i18n key for the display name
 * @property {'street'|'outdoor'|'satellite'|'minimal'} group
 * @property {string} url           Leaflet tile URL template
 * @property {string} [overlayUrl]  transparent label overlay stacked on the base
 * @property {number} maxZoom
 * @property {string} attribution
 * @property {string[]} [subdomains]
 * @property {boolean} [crossOrigin] opt out (false) for providers without CORS headers
 * @property {string} [hintKey]     optional i18n key for a hint line
 */

/** @type {MapSource[]} */
export const MAP_SOURCES = [
  {
    id: 'osm',
    labelKey: 'srcOsm',
    group: 'street',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
  },
  {
    id: 'TFAtlas',
    labelKey: 'srcTFAtlas',
    group: 'street',
    url: 'https://api.thunderforest.com/atlas/{z}/{x}/{y}{r}.png?apikey=8008601e01cf4f2aaf9a8ad4a3867e4a',
    maxZoom: 19,
    attribution: '© Thunderforest',
  },
  {
    id: 'opentopomap',
    labelKey: 'srcOpenTopoMap',
    group: 'outdoor',
    url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
    maxZoom: 17,
    attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors, SRTM | style: &copy; <a href="https://opentopomap.org" target="_blank" rel="noreferrer">OpenTopoMap</a> (CC-BY-SA)',
  },
  {
    id: 'cyclosm',
    labelKey: 'srcCyclosm',
    group: 'outdoor',
    url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
	subdomains:['a', 'b', 'c'],
    maxZoom: 19,
    attribution: '© CyclOSM',
  },
  {
    id: 'TFOutdoor',
    labelKey: 'srcTFOutdoor',
    group: 'outdoor',
    url: 'https://api.thunderforest.com/outdoors/{z}/{x}/{y}{r}.png?apikey=8008601e01cf4f2aaf9a8ad4a3867e4a',
    maxZoom: 19,
    attribution: '© Thunderforest',
  },
  {
    id: 'MapyOutdoor',
    labelKey: 'srcMapyOutdoor',
    group: 'outdoor',
    url: 'https://api.mapy.com/v1/maptiles/outdoor/256/{z}/{x}/{y}?apikey=ZmLnzZY7g5dYIIPshyx5-anT4M2WPQYWKQd_Cmy8icE',
    maxZoom: 19,
    attribution: '<a href="https://api.mapy.com/copyright" target="_blank">&copy; Seznam.cz a.s. a další</a>',
  },
  {
    id: 'esri-imagery',
    labelKey: 'srcEsriImagery',
    group: 'satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics',
  },
  {
    id: 'StadiaSmooth',
    labelKey: 'srcStadiaSmooth',
    group: 'minimal',
    url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png',
    maxZoom: 20,
    attribution: '&copy; <a href="https://stadiamaps.com/" target="_blank">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
  },
  {
    id: 'StadiaSmoothDark',
    labelKey: 'srcStadiaSmoothDark',
    group: 'minimal',
    url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png',
    maxZoom: 20,
    attribution: '&copy; <a href="https://stadiamaps.com/" target="_blank">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
	hintKey: 'srcStadiaSmoothDarkHint',
  },
];

/**
 * The basemap used while the user has not chosen one: OpenStreetMap.
 * An explicit choice always beats this default.
 */
export const DEFAULT_SOURCE_ID = 'osm';
const STORAGE_KEY = 'wayslice-basemap';

const GROUP_ORDER = ['street', 'outdoor', 'satellite', 'minimal'];

/** The active source id: the saved choice, else the default. */
export function getSavedSourceId() {
  try {
    const id = localStorage.getItem(STORAGE_KEY);
    if (id && MAP_SOURCES.some((s) => s.id === id)) return id;
  } catch { /* ignore */ }
  return DEFAULT_SOURCE_ID;
}

/**
 * @returns {MapSource} the saved source, or the default
 */
export function getSavedSource() {
  return MAP_SOURCES.find((s) => s.id === getSavedSourceId())
    ?? MAP_SOURCES.find((s) => s.id === DEFAULT_SOURCE_ID);
}

/** Persists the user's explicit source choice. @param {string} id */
export function saveSource(id) {
  try { localStorage.setItem(STORAGE_KEY, id); } catch { /* ignore */ }
}

/**
 * Sources grouped in selector display order.
 * @returns {{groupKey:string, sources:MapSource[]}[]}
 */
export function groupedSources() {
  return GROUP_ORDER
    .map((group) => ({ group, groupKey: `group${group[0].toUpperCase()}${group.slice(1)}`, sources: MAP_SOURCES.filter((s) => s.group === group) }))
    .filter((g) => g.sources.length > 0);
}

/**
 * Creates a Leaflet tile layer for a source. Sources with a label overlay
 * get a second call with `source.overlayUrl` — same options, stacked above
 * the base inside the tile pane.
 * @param {MapSource} source
 * @param {string} [url]  defaults to the base `source.url`
 */
export function createTileLayer(source, url = source.url) {
  return L.tileLayer(url, {
    maxZoom: source.maxZoom,
    attribution: source.attribution,
    subdomains: source.subdomains || 'abc',
    crossOrigin: source.crossOrigin !== false,
  });
}
