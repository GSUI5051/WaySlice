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
 * @property {string} [url]         tile URL template ({z}/{x}/{y}, plus the
 *                                  Leaflet-era {s}/{r} markers where a provider
 *                                  offers them); omitted by vector-only
 *                                  providers that serve no raster tiles
 * @property {string} [overlayUrl]  transparent label overlay stacked on the base
 * @property {number} maxZoom
 * @property {string} attribution
 * @property {string[]} [subdomains]
 * @property {string} [styleUrl]  provider MapLibre style JSON (vector basemap):
 *                                rendered via map.setStyle instead of a raster
 *                                source; attribution then comes from the
 *                                style's TileJSON and needs no raster `url`
 * @property {boolean} [crossOrigin] not supported by MapLibre: raster tiles are
 *                                   uploaded as WebGL textures, which the browser
 *                                   security model restricts to CORS-enabled
 *                                   providers, and there is no opt-out
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
    id: 'OpenFreeMapBright',
    labelKey: 'srcOpenFreeMapBright',
    group: 'street',
    // OpenFreeMap (per openfreemap.org's quick start): free vector styles, no
    // API key. Same shape as TFAtlas — the style JSON is self-contained and
    // its TileJSON attribution (OpenFreeMap, © OpenMapTiles, data ©
    // OpenStreetMap contributors) reaches the attribution control on its own.
    // Planet tiles are native z14 with overzoom up to maxZoom.
    styleUrl: 'https://tiles.openfreemap.org/styles/bright',
    maxZoom: 19,
    attribution: '&copy; <a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
  },
  {
    id: 'TFAtlas',
    labelKey: 'srcTFAtlas',
    group: 'street',
    url: 'https://api.thunderforest.com/atlas/{z}/{x}/{y}{r}.png?apikey=8008601e01cf4f2aaf9a8ad4a3867e4a',
    // Vector Styles API (per thunderforest.com's MapLibre tutorial): the
    // style JSON is self-contained — its glyphs, sprite and TileJSON all
    // carry the apikey, and its source attribution (© Thunderforest ©
    // OpenStreetMap contributors) reaches the attribution control on its
    // own. Native z14 tiles with overzoom up to maxZoom.
    styleUrl: 'https://api.thunderforest.com/styles/atlas/style.json?apikey=8008601e01cf4f2aaf9a8ad4a3867e4a',
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
    id: 'EOXSentinel2',
    labelKey: 'srcEOXSentinel2',
    group: 'satellite',
    // Sentinel-2 cloudless 2025 by EOX (tiles.maps.eox.at WMTS). The layer
    // comes in two TileMatrixSets — WGS84 (EPSG:4326) and g/GoogleMapsCompatible
    // (EPSG:3857) — and MapLibre renders in Web Mercator (its coordinate-system
    // doc: EPSG:3857 is the display projection), so the _3857 layer variant is
    // the only one that aligns. WMTS REST axis order {TileMatrix}/{TileRow}/
    // {TileCol} = {z}/{y}/{x}, kept as with Esri. The server upsamples past
    // the native z14 imagery and serves CORS `*`.
    url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg',
    maxZoom: 19,
    attribution: '<a href="https://s2maps.eu" target="_blank">Sentinel-2 cloudless</a> by EOX IT Services (Contains modified Copernicus Sentinel data 2025)',
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
    id: 'MapyAerial',
    labelKey: 'srcMapyAerial',
    group: 'satellite',
    url: 'https://api.mapy.com/v1/maptiles/aerial/256/{z}/{x}/{y}?apikey=ZmLnzZY7g5dYIIPshyx5-anT4M2WPQYWKQd_Cmy8icE',
    maxZoom: 19,
    attribution: '<a href="https://api.mapy.com/copyright" target="_blank">&copy; Seznam.cz a.s. a další</a>',
  },
  {
    id: 'OpenFreeMapPositron',
    labelKey: 'srcOpenFreeMapPositron',
    group: 'minimal',
    styleUrl: 'https://tiles.openfreemap.org/styles/positron',
    maxZoom: 19,
    attribution: '&copy; <a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
  },
  {
    id: 'OpenFreeMapDark',
    labelKey: 'srcOpenFreeMapDark',
    group: 'minimal',
    styleUrl: 'https://tiles.openfreemap.org/styles/dark',
    maxZoom: 19,
    attribution: '&copy; <a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
    hintKey: 'srcOpenFreeMapDarkHint',
  },
  {
    id: 'StadiaSmooth',
    labelKey: 'srcStadiaSmooth',
    group: 'minimal',
    url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png',
    styleUrl: 'https://tiles-eu.stadiamaps.com/styles/alidade_smooth.json',
    maxZoom: 20,
    attribution: '&copy; <a href="https://stadiamaps.com/" target="_blank">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
  },
  {
    id: 'StadiaSmoothDark',
    labelKey: 'srcStadiaSmoothDark',
    group: 'minimal',
    url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png',
    styleUrl: 'https://tiles-eu.stadiamaps.com/styles/alidade_smooth_dark.json',
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
 * Converts a catalog template into a MapLibre raster source definition.
 * Sources with a label overlay get a second call with `source.overlayUrl`.
 *
 * MapLibre expands neither {s} nor {r}: subdomains become parallel complete
 * URLs in the `tiles` array, and {r} becomes '@2x' on high-DPI screens
 * (devicePixelRatio ≥ 2 — the same condition under which Leaflet substituted
 * it) or an empty string elsewhere. Both variants are 256 logical px per
 * tile; the @2x files simply carry double density, which keeps the Thunderforest
 * basemaps crisp on retina screens exactly like before.
 *
 * Esri's {z}/{y}/{x} axis order is provider-defined and kept as-is; MapLibre
 * substitutes by name.
 *
 * @param {MapSource} source
 * @param {string} [url]  defaults to the base `source.url`
 * @param {boolean} [retina]  defaults to the live devicePixelRatio
 * @returns {{type:'raster', tiles:string[], tileSize:number, maxzoom:number, attribution:string}}
 */
export function createRasterSource(source, url = source.url, retina = (window.devicePixelRatio || 1) >= 2) {
  const template = url.replace('{r}', retina ? '@2x' : '');
  const subdomains = Array.isArray(source.subdomains)
    ? source.subdomains
    : String(source.subdomains || 'abc').split('');
  const tiles = template.includes('{s}')
    ? subdomains.map((s) => template.replace('{s}', s))
    : [template];
  return {
    type: 'raster',
    tiles,
    tileSize: 256,
    maxzoom: source.maxZoom,
    attribution: source.attribution,
  };
}
