/**
 * DEM sampling orchestration — turns a point array into per-point elevations
 * through "points → unique tiles → bounded-concurrency fetch → decode →
 * local bilinear sampling" (the terrain.js half). All effects are injectable:
 * `fetchTile` stands in for the network in tests, so no case below ever
 * touches the real tile service.
 *
 * Failure discipline: a tile that cannot be fetched, decoded or validated is
 * simply absent from the tile store; the points that needed it come back as
 * null (no sample). Nothing is ever reported as elevation 0 because of a
 * failure. Cancellation is cooperative through an AbortSignal: the pool stops
 * scheduling, in-flight requests abort, and the promise rejects with
 * CancelledError so a caller can never mistake a partial run for a result.
 */
import {
  DEM_SOURCE, buildSamples, sampleElevation, tileKey, demTileUrl,
} from './terrain.js';

/** Rejection sentinel for aborted runs. */
export class CancelledError extends Error {
  constructor() {
    super('DEM sampling cancelled');
    this.name = 'CancelledError';
  }
}

/** Simultaneous tile requests. Tiles are ~300 KB; a long trail at zoom 12
 *  crosses a few dozen of them, so a small pool keeps the browser queue —
 *  and the server — fed without a request storm. */
export const DEM_CONCURRENCY = 6;

/** Decoded tiles kept across operations, so fill → restore → replace (and
 *  repeated fixes) do not re-download. FIFO eviction caps memory; tiles are
 *  also served from the browser HTTP cache (max-age 7 days) after eviction. */
export const DEM_TILE_CACHE_LIMIT = 48;
const tileCache = new Map();

/**
 * Fetches one tile over the network: browser HTTP cache first (tiles are
 * immutable), HTTP errors and network/CORS failures yield null, the blob is
 * decoded with the browser's own WebP decoder (no third-party library).
 * @param {number} x
 * @param {number} y
 * @param {AbortSignal} [signal]
 * @returns {Promise<import('./terrain.js').DemTile|null>}
 */
export async function defaultFetchTile(x, y, signal) {
  const url = demTileUrl(x, y);
  const response = await fetch(url, { signal, cache: 'force-cache' });
  if (!response.ok) return null;
  const blob = await response.blob();
  return decodeImageBlob(blob);
}

/**
 * Decodes an image blob to an RGBA tile using native browser tooling:
 * createImageBitmap + OffscreenCanvas when available (no DOM churn), the
 * classic Image + canvas path otherwise. A result whose size does not match
 * the configured tile grid is a decode failure, not a resample.
 * @param {Blob} blob
 * @returns {Promise<import('./terrain.js').DemTile|null>}
 */
export async function decodeImageBlob(blob) {
  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(blob);
      try {
        return readPixelsViaCanvas(bitmap, bitmap.width, bitmap.height);
      } finally {
        bitmap.close();
      }
    }
    const bitmap = await decodeViaImageElement(blob);
    try {
      return readPixelsViaCanvas(bitmap, bitmap.width, bitmap.height);
    } finally {
      URL.revokeObjectURL(bitmap.src);
    }
  } catch {
    return null;
  }
}

/** @private Draws a bitmap-decodable source and reads its RGBA pixels. */
function readPixelsViaCanvas(source, width, height) {
  if (width !== DEM_SOURCE.tileSize || height !== DEM_SOURCE.tileSize) return null;
  const canvas = typeof OffscreenCanvas === 'function'
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0);
  const { data } = ctx.getImageData(0, 0, width, height);
  return { data, width, height };
}

/** @private Browsers without createImageBitmap: decode via an <img>. */
function decodeViaImageElement(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = URL.createObjectURL(blob);
  });
}

/** @private Memory-cached tile fetch wrapper. */
async function cachedFetchTile(x, y, signal) {
  const key = tileKey(x, y);
  if (tileCache.has(key)) return tileCache.get(key);
  const tile = await defaultFetchTile(x, y, signal);
  if (tile) {
    tileCache.set(key, tile);
    while (tileCache.size > DEM_TILE_CACHE_LIMIT) {
      tileCache.delete(tileCache.keys().next().value);
    }
  }
  return tile;
}

/**
 * Samples a DEM elevation for every point of a track.
 * @param {{lat:number, lon:number}[]} points
 * @param {{fetchTile?:(x:number,y:number,signal:AbortSignal)=>Promise<import('./terrain.js').DemTile|null>,
 *          concurrency?:number, signal?:AbortSignal,
 *          onProgress?:(p:{done:number,total:number})=>void}} [opts]
 * @returns {Promise<{elevations:(number|null)[], sampled:number, failed:number,
 *                     tilesTotal:number, tilesFailed:number}>}
 *   `elevations` aligns with `points`; null marks a point with no sample.
 * @throws {CancelledError} when `signal` aborts (also mid-fetch).
 */
export async function sampleElevations(points, opts = {}) {
  const {
    fetchTile = cachedFetchTile,
    concurrency = DEM_CONCURRENCY,
    signal,
    onProgress,
  } = opts;
  const { samples, tiles } = buildSamples(points);
  const total = tiles.length;
  const store = new Map();
  let done = 0;
  let tilesFailed = 0;
  onProgress?.({ done, total });

  const aborted = () => signal?.aborted === true;
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      if (aborted()) throw new CancelledError();
      const index = cursor++;
      if (index >= total) return;
      const { x, y } = tiles[index];
      let tile = null;
      try {
        tile = await fetchTile(x, y, signal);
      } catch (err) {
        // A single tile's network failure must not sink the batch — but an
        // abort must, even when it surfaces as a fetch rejection.
        if (aborted()) throw new CancelledError();
        tile = null;
      }
      if (aborted()) throw new CancelledError();
      if (tile) store.set(tileKey(x, y), tile);
      else tilesFailed++;
      done++;
      onProgress?.({ done, total });
    }
  };
  const lanes = Math.max(1, Math.min(concurrency, total));
  await Promise.all(Array.from({ length: lanes }, worker));

  const elevations = samples.map((s) => (s ? sampleElevation(store, s) : null));
  let sampled = 0;
  for (const ele of elevations) if (ele != null) sampled++;
  return {
    elevations,
    sampled,
    failed: points.length - sampled,
    tilesTotal: total,
    tilesFailed,
  };
}
