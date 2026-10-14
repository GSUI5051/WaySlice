/**
 * DEM terrain tiles — coordinate math, Terrarium decoding and bilinear
 * sampling. Pure functions only: no DOM, no fetch, no shared state, so every
 * rule here is directly unit-testable with synthetic tiles.
 *
 * The data source is Mapterhorn (https://mapterhorn.com) — the same
 * open-data DEM mosaic gpx.studio serves its elevation lookups from. Its
 * public tile endpoint hands out Terrarium-encoded, lossless WebP tiles in
 * the standard XYZ scheme at 512 × 512 pixels, native zoom 12, with open
 * CORS; everything below is parameterized by the DEM_SOURCE config instead
 * of magic numbers, so swapping the source is a one-object change.
 *
 * Sampling follows the pixel-center convention gpx.studio uses: pixel k of a
 * tile sits at continuous tile coordinate k, so a point at pixel fraction
 * fx interpolates between floor(fx) and floor(fx)+1. Unlike that reference
 * implementation, windows that cross a tile's last column/row read the
 * adjacent tile's first column/row (they are part of the fetch set) instead
 * of wrapping around to the tile's own first pixels, keeping samples
 * continuous across tile seams. A missing adjacent tile (ocean 404, world
 * edge) degrades to an edge-clamped interpolation — never a wrap, never a
 * fabricated zero.
 */

/**
 * The DEM tile source every elevation-correction path shares.
 * URL/zoom/size/encoding verified against https://tiles.mapterhorn.com
 * (TileJSON: scheme xyz, encoding terrarium, tileSize 512).
 */
export const DEM_SOURCE = {
  id: 'mapterhorn',
  name: 'Mapterhorn',
  urlTemplate: 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp',
  zoom: 12,
  tileSize: 512,
  encoding: 'terrarium',
  /** Displayed attribution, required by the tile set's licenses. */
  attribution: '© Mapterhorn',
  attributionUrl: 'https://mapterhorn.com/attribution',
};

/** Web Mercator latitude limit — the tile grid's documented bound
 *  (TileJSON bounds ±85.0511287). Points beyond it have no tile. */
const MAX_ABS_LAT = 85.0511287;

/** Plausible-elevation window. Terrarium nodata decodes to −32768, far
 *  outside any real terrain; anything outside the window is treated as an
 *  invalid pixel (no sample), never as a value. */
export const ELEVATION_MIN_M = -12000;
export const ELEVATION_MAX_M = 9000;

/**
 * WGS84 lon/lat → continuous Web Mercator tile coordinates at `zoom`.
 * Longitude wraps around the antimeridian; latitude outside the Web
 * Mercator bound, or non-finite input, yields null (the caller reports the
 * point as unsampleable — it is never coerced to a valid coordinate).
 * @param {number} lon  degrees
 * @param {number} lat  degrees
 * @param {number} zoom
 * @returns {{x:number, y:number}|null}
 */
export function lonLatToTileFraction(lon, lat, zoom = DEM_SOURCE.zoom) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (Math.abs(lat) > MAX_ABS_LAT) return null;
  const wrapped = (((lon + 180) % 360) + 360) % 360 - 180;
  const n = 2 ** zoom;
  const x = (n * (wrapped + 180)) / 360;
  const latRad = (lat * Math.PI) / 180;
  const y = (n * (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI)) / 2;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/** Tile cache/storage key for the source's zoom. */
export function tileKey(x, y, zoom = DEM_SOURCE.zoom) {
  return `${zoom}/${x}/${y}`;
}

/** A tile URL from the source template (machine formatting, dot z/x/y). */
export function demTileUrl(x, y, source = DEM_SOURCE) {
  return source.urlTemplate
    .replaceAll('{z}', String(source.zoom))
    .replaceAll('{x}', String(x))
    .replaceAll('{y}', String(y));
}

/**
 * @typedef {Object} DemSample
 * @property {number} tx  Integer tile x at the source zoom.
 * @property {number} ty  Integer tile y.
 * @property {number} fx  Continuous pixel x within the tile, [0, tileSize).
 * @property {number} fy  Continuous pixel y within the tile.
 */

/**
 * Maps track points onto tiles: one DemSample per valid point plus the
 * de-duplicated tile list the batch must fetch. The list contains the tiles
 * the points fall on AND the eastern/southern/diagonal neighbours their
 * bilinear windows reach into (a point on the last pixel column also needs
 * column 0 of the tile to the east — that neighbour is exactly what makes
 * interpolation seamless across seams). No tile outside the point set's
 * footprint is ever requested.
 * @param {{lat:number, lon:number}[]} points
 * @param {object} [source]
 * @returns {{samples:(DemSample|null)[], tiles:{x:number,y:number}[]}}
 */
export function buildSamples(points, source = DEM_SOURCE) {
  const size = source.tileSize;
  const maxIndex = 2 ** source.zoom - 1;
  /** @type {Map<string, {x:number,y:number}>} */
  const tiles = new Map();
  const add = (x, y) => tiles.set(tileKey(x, y, source.zoom), { x, y });
  /** @type {(DemSample|null)[]} */
  const samples = new Array(points.length).fill(null);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const f = p && lonLatToTileFraction(p.lon, p.lat, source.zoom);
    if (!f) continue;
    const tx = Math.floor(f.x);
    const ty = Math.floor(f.y);
    if (tx < 0 || ty < 0 || tx > maxIndex || ty > maxIndex) continue;
    const fx = size * (f.x - tx);
    const fy = size * (f.y - ty);
    samples[i] = { tx, ty, fx, fy };
    add(tx, ty);
    const xOver = Math.floor(fx) + 1 >= size; // window reaches past the last column
    const yOver = Math.floor(fy) + 1 >= size;
    if (xOver && tx < maxIndex) add(tx + 1, ty);
    if (yOver && ty < maxIndex) add(tx, ty + 1);
    if (xOver && yOver && tx < maxIndex && ty < maxIndex) add(tx + 1, ty + 1);
  }
  return { samples, tiles: [...tiles.values()] };
}

/**
 * Terrarium decoding: `R * 256 + G + B / 256 - 32768` meters, with R, G, B
 * the raw 8-bit channels of the losslessly decoded pixel.
 * @returns {number}
 */
export function terrariumElevation(r, g, b) {
  return r * 256 + g + b / 256 - 32768;
}

/** True for a decoded elevation inside the plausible terrain window. */
export function isValidElevation(ele) {
  return Number.isFinite(ele) && ele >= ELEVATION_MIN_M && ele <= ELEVATION_MAX_M;
}

/**
 * One decoded tile: a tightly packed RGBA buffer plus its dimensions. The
 * production decoder produces it from a WebP blob; tests build synthetics.
 * @typedef {Object} DemTile
 * @property {Uint8ClampedArray} data
 * @property {number} width
 * @property {number} height
 */

/** @private Elevation of one pixel of one tile, or null when invalid. */
function pixelElevation(tile, ix, iy) {
  const i = (iy * tile.width + ix) * 4;
  const ele = terrariumElevation(tile.data[i], tile.data[i + 1], tile.data[i + 2]);
  return isValidElevation(ele) ? ele : null;
}

/**
 * Bilinear elevation for one sample from a fetched-tile store. The store
 * maps `tileKey(x, y)` → DemTile; absent entries are fetch failures.
 *
 * The four window pixels resolve independently, each falling back to the
 * adjacent tile when it lies past the tile's last column/row. Degradations,
 * in order: an invalid PRIMARY pixel (the tile is there but the pixel is
 * nodata) or a missing primary tile → null (honest failure — a missing
 * sample is never reported as 0); a missing neighbour tile/pixel → the
 * nearest available window pixel (edge clamp, no wrap-around).
 * @param {Map<string, DemTile|null>} tiles
 * @param {DemSample} sample
 * @param {object} [source]
 * @returns {number|null} meters
 */
export function sampleElevation(tiles, sample, source = DEM_SOURCE) {
  const size = source.tileSize;
  const primary = tiles.get(tileKey(sample.tx, sample.ty, source.zoom));
  if (!primary) return null;
  const x0 = Math.floor(sample.fx);
  const y0 = Math.floor(sample.fy);
  const dx = sample.fx - x0;
  const dy = sample.fy - y0;
  const xOver = x0 + 1 >= size;
  const yOver = y0 + 1 >= size;

  const at = (tile, ix, iy) => pixelElevation(tile, ix, iy);
  const neighbour = (ox, oy) =>
    tiles.get(tileKey(sample.tx + ox, sample.ty + oy, source.zoom)) ?? null;

  const p00 = at(primary, x0, y0);
  if (p00 == null) return null;
  const east = xOver ? neighbour(1, 0) : null;
  const south = yOver ? neighbour(0, 1) : null;
  const diag = xOver || yOver
    ? neighbour(xOver ? 1 : 0, yOver ? 1 : 0)
    : null;
  const p10 = xOver
    ? (east ? at(east, 0, y0) : null)
    : at(primary, x0 + 1, y0);
  const p01 = yOver
    ? (south ? at(south, x0, 0) : null)
    : at(primary, x0, y0 + 1);
  const p11 = !xOver && !yOver
    ? at(primary, x0 + 1, y0 + 1)
    : (diag ? at(diag, xOver ? 0 : x0 + 1, yOver ? 0 : y0 + 1) : null);

  // Edge clamp: a window pixel the data cannot provide collapses onto its
  // nearest available neighbour (p10/p01 onto p00, p11 onto the clamped
  // p10), so the bilinear weights always stay a partition of 1 and no
  // sample ever wraps around or invents a value.
  const c10 = p10 ?? p00;
  const c01 = p01 ?? p00;
  const c11 = p11 ?? c10;

  return (
    p00 * (1 - dx) * (1 - dy) +
    c10 * dx * (1 - dy) +
    c01 * (1 - dx) * dy +
    c11 * dx * dy
  );
}
