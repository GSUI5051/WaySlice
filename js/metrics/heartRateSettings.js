/**
 * Heart-rate zone settings — defaults, validation and persistence.
 *
 * One JSON blob in localStorage ('wayslice-hr-zones') holds the mode, the
 * three base heart rates and, per mode, the zones' bpm LOWER bounds — the
 * user-configured truth. Everything the UI additionally shows (each zone's
 * upper bound, the boundary percentages) is DERIVED from those bounds and
 * the active mode's base heart rate (see heartRateZones.js) and is never
 * persisted, so a mode or parameter switch can never desynchronise it.
 *
 * Per mode: FIVE bpm lower bounds B1..B5 — zone N spans [B_N, B_N+1) and
 * zone 5 is open above B5 — except LTHR mode, whose zone 5 opens at the
 * lactate threshold itself (its 100 %): only B1..B4 are stored there, and
 * B5 = lthr follows the threshold automatically.
 *
 *   MAX  [95, 114, 133, 152, 171]   bpm, 50–90 % of the default 190
 *   HRR  [125, 138, 151, 164, 177]  bpm, 50–90 % of the default reserve
 *   LTHR [102, 119, 136, 153]       bpm, 60–90 % of the default 170
 *
 * Everything user-editable passes through validateSettings(): stored data
 * that fails the check (corrupt JSON, missing fields, non-increasing
 * bounds…) falls back to the defaults as a whole, and callers must never
 * persist a candidate that fails it — the same gate guards both loads and
 * saves. version 1 blobs (per-mode boundary PERCENTAGES) are migrated once
 * on load: percentage → bpm with the stored base heart rates, then the
 * result is re-validated.
 *
 * Pure data + validation only; the bpm/percentage math lives in
 * heartRateZones.js and the time-in-zone statistics in heartRateStats.js.
 */
import { emit } from '../core/events.js';

const STORAGE_KEY = 'wayslice-hr-zones';

/** Zone bpm lower bounds per mode — the primary, persisted zone config.
 *
 * @type {HeartRateSettings}
 */
export const DEFAULT_HEART_RATE_SETTINGS = Object.freeze({
  version: 2,
  mode: 'max',
  maxHR: 190,
  restingHR: 60,
  lthr: 170,
  zones: Object.freeze({
    // bpm lower bounds B1..B5; LTHR stores B1..B4 — B5 is the LTHR itself.
    max: Object.freeze([95, 114, 133, 152, 171]),
    hrr: Object.freeze([125, 138, 151, 164, 177]),
    lthr: Object.freeze([102, 119, 136, 153]),
  }),
});

export const HR_MODES = ['max', 'hrr', 'lthr'];

/** Sanity bounds for the base heart rates, bpm. */
export const HR_LIMITS = Object.freeze({
  maxResting: 150,
  minMax: 100,
  absoluteMax: 260,
});

/** Deep copy of a settings object (defaults or stored). @private */
function cloneSettings(s) {
  return {
    version: 2,
    mode: s.mode,
    maxHR: s.maxHR,
    restingHR: s.restingHR,
    lthr: s.lthr,
    zones: { max: [...s.zones.max], hrr: [...s.zones.hrr], lthr: [...s.zones.lthr] },
  };
}

/**
 * Validates a candidate settings object. Returns an error key string
 * ('hrZoneError…') on the first violation, or null when the candidate is
 * sound. The same gate guards user input and localStorage loads.
 *
 * The base heart rates are checked relationally as before; the zone bounds
 * are checked purely as an ordering (the user's bpm truth — they are NOT
 * coupled to the base heart rates, so editing one never invalidates the
 * other). The one mode-defined fixed boundary the inputs cannot break is
 * LTHR zone 5: it opens at the threshold, so B4 must stay below it.
 *
 * @param {*} candidate
 * @returns {string|null} i18n error key, or null when valid
 */
export function validateSettings(candidate) {
  if (!candidate || typeof candidate !== 'object') return 'hrZoneErrorInvalid';
  if (!HR_MODES.includes(candidate.mode)) return 'hrZoneErrorInvalid';
  const { maxHR, restingHR, lthr, zones } = candidate;
  if (!isPositiveInt(maxHR) || maxHR < HR_LIMITS.minMax || maxHR > HR_LIMITS.absoluteMax) {
    return 'hrZoneErrorMaxHr';
  }
  if (!isPositiveInt(restingHR) || restingHR < 20 || restingHR > HR_LIMITS.maxResting) {
    return 'hrZoneErrorRestingHr';
  }
  if (maxHR <= restingHR) return 'hrZoneErrorMaxRest';
  if (!isPositiveInt(lthr) || lthr <= restingHR || lthr >= maxHR) {
    return 'hrZoneErrorLthr';
  }
  if (!zones || typeof zones !== 'object') return 'hrZoneErrorInvalid';
  if (!validBpmEdges(zones.max, 5)) return 'hrZoneErrorOrder';
  if (!validBpmEdges(zones.hrr, 5)) return 'hrZoneErrorOrder';
  // LTHR stores B1..B4; the implicit B5 = lthr keeps the strict ordering.
  if (!validBpmEdges(zones.lthr, 4) || zones.lthr[3] >= lthr) return 'hrZoneErrorOrder';
  return null;

  /** @private Whole bpm values, 0 < e1 < … < en ≤ absoluteMax. */
  function validBpmEdges(arr, len) {
    if (!Array.isArray(arr) || arr.length !== len) return false;
    let prev = 0;
    for (const e of arr) {
      if (!Number.isInteger(e) || e <= prev || e > HR_LIMITS.absoluteMax) return false;
      prev = e;
    }
    return true;
  }

  /** @private */
  function isPositiveInt(v) {
    return Number.isInteger(v) && v > 0;
  }
}

/**
 * @private Migrates a version 1 blob (per-mode boundary PERCENTAGES of the
 * base heart rates) to the version 2 shape: percentage → bpm with the
 * STORED base heart rates, rounded to whole bpm. Returns null when the blob
 * is not recognisably v1 or the conversion fails the v2 validation gate
 * (degenerate base heart rates can collapse the rounding) — the caller then
 * falls back to the defaults.
 */
function migrateV1(v1) {
  if (!v1 || typeof v1 !== 'object' || !v1.zones) return null;
  const { mode, maxHR, restingHR, lthr, zones } = v1;
  const bpmOf = (m, pct) => {
    if (m === 'hrr') return restingHR + (maxHR - restingHR) * pct / 100;
    return (m === 'lthr' ? lthr : maxHR) * pct / 100;
  };
  const toBpm = (m, pcts) => (Array.isArray(pcts) ? pcts : []).map((p) => Math.round(bpmOf(m, p)));
  const candidate = {
    version: 2,
    mode,
    maxHR,
    restingHR,
    lthr,
    zones: {
      max: toBpm('max', zones.max),
      hrr: toBpm('hrr', zones.hrr),
      lthr: toBpm('lthr', zones.lthr),
    },
  };
  return validateSettings(candidate) ? null : candidate;
}

/** @returns {HeartRateSettings} the persisted settings, or the defaults when
 *  nothing (or something invalid) is stored — a broken blob never throws and
 *  is replaced by the defaults so the storage heals. v1 blobs are migrated. */
export function loadHeartRateSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneSettings(DEFAULT_HEART_RATE_SETTINGS);
    const parsed = JSON.parse(raw);
    const candidate = parsed && parsed.version === 2
      ? parsed
      : parsed && parsed.version === 1 ? migrateV1(parsed) : null;
    if (!candidate || validateSettings(candidate)) {
      localStorage.removeItem(STORAGE_KEY);
      return cloneSettings(DEFAULT_HEART_RATE_SETTINGS);
    }
    return cloneSettings(candidate);
  } catch {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    return cloneSettings(DEFAULT_HEART_RATE_SETTINGS);
  }
}

/**
 * Validates and persists a candidate. Invalid candidates are refused (the
 * caller shows the error); a successful save emits 'hrzones:changed' so the
 * open UI re-renders.
 *
 * @param {HeartRateSettings} candidate
 * @returns {string|null} the validation error key, or null when saved
 */
export function saveHeartRateSettings(candidate) {
  const error = validateSettings(candidate);
  if (error) return error;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(candidate));
  } catch { /* private mode — settings just won't persist */ }
  emit('hrzones:changed', {});
  return null;
}

/** Restores the defaults (also used by tests to simulate corrupt storage). */
export function resetHeartRateSettings() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
  emit('hrzones:changed', {});
}

/**
 * @typedef {Object} HeartRateSettings
 * @property {number} version
 * @property {'max'|'hrr'|'lthr'} mode
 * @property {number} maxHR
 * @property {number} restingHR
 * @property {number} lthr
 * @property {{max:number[], hrr:number[], lthr:number[]}} zones
 *   per-mode zone bpm LOWER bounds B1..B5 (LTHR: B1..B4; B5 = lthr — see
 *   DEFAULT_HEART_RATE_SETTINGS). Upper bounds and percentages are derived
 *   data and never persisted.
 */
export {};
