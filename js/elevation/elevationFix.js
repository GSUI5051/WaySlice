/**
 * Elevation correction — the strategies that turn sampled DEM elevations
 * into (or back from) a Track's elevation data, plus the async controller
 * that runs a correction against the loaded track.
 *
 * State design: the ORIGINAL elevations live once in `track.eleOriginal`
 * (a plain number|null array captured before the first correction); the
 * effective elevations always live in `track.points[i].ele`, which every
 * existing consumer — profile charts, sector metrics, GAP/VAM, exports —
 * already reads. A correction therefore mutates the point elevations in
 * place and re-publishes the track as a new object (same `points` array,
 * same geometry), which is exactly what the identity-keyed chart caches
 * need to rebuild, while lat/lon, timestamps and every sensor field stay
 * untouched. `track.eleSource` records what is currently applied
 * ('fill' | 'replace' | null = original).
 *
 * Async rules: every run carries a token; a cancel or a superseding
 * run/track invalidates late results, and a run only applies when the track
 * in the store is still the one it sampled. Total sampling failure applies
 * nothing. Nothing here touches the DOM.
 */
import { trackStore } from '../core/stores.js';
import { sampleElevations, CancelledError } from './demSampler.js';

/** True when a point's elevation is absent (missing ≠ 0). */
export function isEleMissing(ele) {
  return ele == null || !Number.isFinite(ele);
}

/**
 * Fill strategy — DEM values land only on points whose ORIGINAL elevation
 * is missing; every recorded value (0 included) is preserved exactly.
 * @param {import('../types.js').TrackPoint[]} points
 * @param {(number|null)[]} samples  per-point DEM samples (null = no sample)
 * @returns {{values:(number|null)[], applied:number, failed:number,
 *            candidates:number}} values: the next effective elevation per point.
 */
export function buildFillValues(points, samples) {
  const values = new Array(points.length);
  let applied = 0;
  let failed = 0;
  let candidates = 0;
  for (let i = 0; i < points.length; i++) {
    const original = points[i].ele;
    if (!isEleMissing(original)) {
      values[i] = original;
      continue;
    }
    candidates++;
    const sample = samples[i];
    if (sample == null) {
      values[i] = null; // both sources missing stays missing — never 0
      failed++;
    } else {
      values[i] = sample;
      applied++;
    }
  }
  return { values, applied, failed, candidates };
}

/**
 * Replace strategy — every point with a DEM sample takes it; points without
 * one keep their original value (missing stays missing).
 * @param {import('../types.js').TrackPoint[]} points
 * @param {(number|null)[]} samples
 * @returns {{values:(number|null)[], applied:number, failed:number,
 *            candidates:number}} candidates: points the run tried to sample.
 */
export function buildReplaceValues(points, samples) {
  const values = new Array(points.length);
  let applied = 0;
  let failed = 0;
  let candidates = 0;
  for (let i = 0; i < points.length; i++) {
    const sample = samples[i];
    if (sample == null) {
      values[i] = isEleMissing(points[i].ele) ? null : points[i].ele;
      candidates++;
      failed++;
    } else {
      values[i] = sample;
      applied++;
      candidates++;
    }
  }
  return { values, applied, failed, candidates };
}

/**
 * Publishes corrected elevations onto the track: writes `values` into the
 * points (in place — the array is shared, never copied), captures the
 * originals on the FIRST correction only (repeat corrections always
 * overwrite DEM values, never stack on them), and returns the re-published
 * track object. The caller owns `trackStore.set(nextTrack)`.
 * @param {import('../types.js').Track} track
 * @param {(number|null)[]} values
 * @param {'fill'|'replace'} mode
 * @returns {import('../types.js').Track}
 */
export function applyElevations(track, values, mode) {
  const points = track.points;
  if (!track.eleOriginal) {
    track.eleOriginal = points.map((p) => (isEleMissing(p.ele) ? null : p.ele));
  }
  for (let i = 0; i < points.length; i++) points[i].ele = values[i] ?? null;
  const next = { ...track, eleSource: mode };
  recomputeEleFlags(next);
  return next;
}

/**
 * Reverts to the captured originals: elevations return exactly, geometry
 * and sensors are untouched, the correction state clears. Returns null when
 * nothing is corrected.
 * @param {import('../types.js').Track} track
 * @returns {import('../types.js').Track|null}
 */
export function restoreElevations(track) {
  if (!track || !track.eleOriginal) return null;
  const points = track.points;
  for (let i = 0; i < points.length; i++) {
    points[i].ele = track.eleOriginal[i] ?? null;
  }
  const next = { ...track, eleOriginal: null, eleSource: null };
  recomputeEleFlags(next);
  return next;
}

/** @private Recomputes the elevation-derived Track flags with prepareTrack's
 *  exact semantics: hasElevation only when EVERY point carries a finite
 *  elevation, and eleMin/eleMax only in that case (a partially filled
 *  series keeps null extremes, like a freshly parsed one). */
function recomputeEleFlags(track) {
  const n = track.pointCount;
  let all = n > 0;
  let min = Infinity;
  let max = -Infinity;
  for (const p of track.points) {
    if (isEleMissing(p.ele)) {
      all = false;
      continue;
    }
    if (p.ele < min) min = p.ele;
    if (p.ele > max) max = p.ele;
  }
  track.hasElevation = all;
  track.eleMin = all ? min : null;
  track.eleMax = all ? max : null;
}

/* Run controller ---------------------------------------------------------------- */

/** @type {{token:number, controller:AbortController}|null} */
let activeRun = null;
/** Bumped by every cancel/new run; runs whose token is stale stay silent. */
let runToken = 0;

/**
 * Cancels the active run: bumps the token (late results become no-ops) and
 * aborts the in-flight tile requests.
 */
export function cancelElevationFix() {
  runToken++;
  const run = activeRun;
  activeRun = null;
  run?.controller.abort();
}

/** @private A genuinely different track (different points) loaded: forget
 *  the old track's correction state and stop its runaway requests. */
let wiredPoints = null;
trackStore.subscribe((track) => {
  const points = track?.points ?? null;
  if (points !== wiredPoints) {
    wiredPoints = points;
    if (activeRun) cancelElevationFix();
  }
});

/**
 * Runs one correction end to end against the loaded track: samples DEM
 * elevations for every point, builds the mode's values and, when anything
 * was actually applied, publishes the corrected track. All failure paths
 * leave the store untouched.
 * @param {'fill'|'replace'} mode
 * @param {{sampler?:typeof sampleElevations,
 *          onProgress?:(p:{done:number,total:number})=>void,
 *          concurrency?:number}} [opts]
 * @returns {Promise<{status:'applied'|'nothing-to-fill'|'failed-all'|'cancelled'|'superseded'|'no-track',
 *                    mode?:'fill'|'replace', applied?:number, failed?:number}>}
 */
export async function runElevationFix(mode, opts = {}) {
  const { sampler = sampleElevations, onProgress, concurrency } = opts;
  const track = trackStore.get();
  if (!track) return { status: 'no-track' };
  const token = ++runToken;
  const controller = new AbortController();
  activeRun = { token, controller };
  const live = () => token === runToken && activeRun?.token === token;
  try {
    const result = await sampler(track.points, {
      signal: controller.signal,
      concurrency,
      onProgress: (p) => {
        if (live() && onProgress) onProgress(p);
      },
    });
    if (!live()) return { status: 'superseded' };
    // The store must still hold the track this run sampled — a file loaded
    // mid-run must never receive the old track's elevations.
    if (trackStore.get() !== track) return { status: 'superseded' };
    const built = mode === 'fill'
      ? buildFillValues(track.points, result.elevations)
      : buildReplaceValues(track.points, result.elevations);
    if (built.applied === 0) {
      return {
        status: built.candidates === 0 ? 'nothing-to-fill' : 'failed-all',
        mode,
      };
    }
    trackStore.set(applyElevations(track, built.values, mode));
    return { status: 'applied', mode, applied: built.applied, failed: built.failed };
  } catch (err) {
    if (err instanceof CancelledError || !live()) {
      return { status: 'cancelled' };
    }
    // Unexpected sampler errors are reported, never applied.
    console.warn('[WaySlice] elevation correction failed:', err);
    return { status: 'failed-all', mode };
  } finally {
    if (activeRun?.token === token) activeRun = null;
  }
}

/**
 * Restores the loaded track's original elevations (synchronous — the
 * originals are held in memory, no re-download). Returns the run-result
 * shape for UI symmetry; null-track / nothing-corrected → 'no-track'.
 * @returns {{status:'restored'|'no-track'}}
 */
export function restoreOriginalElevations() {
  const track = trackStore.get();
  const next = restoreElevations(track);
  if (!next) return { status: 'no-track' };
  trackStore.set(next);
  return { status: 'restored' };
}
