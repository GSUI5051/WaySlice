/**
 * Display unit preference, SI-to-display conversions, and unit DISPLAY labels.
 * Core track data and metrics always remain in SI units.
 */
import { emit } from '../core/events.js';
import { trackStore } from '../core/stores.js';
import { t } from '../language/language.js';

const UNIT_STORAGE_KEY = 'wayslice-units';
export const METERS_PER_MILE = 1609.344;
export const METERS_PER_FOOT = 0.3048;
export const MPH_PER_MPS = 2.2369362920544;

let current = 'metric';

export function getUnitSystem() {
  return current;
}

export function initUnits() {
  let saved = null;
  try { saved = localStorage.getItem(UNIT_STORAGE_KEY); } catch { /* private mode */ }
  current = saved === 'imperial' ? 'imperial' : 'metric';
  emit('units:changed', { units: current });
}

export function setUnitSystem(system) {
  if (system !== 'metric' && system !== 'imperial') return;
  if (current === system) {
    try { localStorage.setItem(UNIT_STORAGE_KEY, system); } catch { /* ignore */ }
    return;
  }
  current = system;
  try { localStorage.setItem(UNIT_STORAGE_KEY, system); } catch { /* ignore */ }
  emit('units:changed', { units: current });
}

export function metersToFeet(meters) { return meters / METERS_PER_FOOT; }
export function metersToMiles(meters) { return meters / METERS_PER_MILE; }
export function mpsToKmh(mps) { return mps * 3.6; }
export function mpsToMph(mps) { return mps * MPH_PER_MPS; }
export function secPerKmToSecPerMi(secPerKm) { return secPerKm * (METERS_PER_MILE / 1000); }

/**
 * Unit display labels come from the language packs (unitKm, unitMi, …) via
 * t() — the international sport-app abbreviations (km, bpm, W…), shared
 * by every language. % and °C/°F are never translated and stay symbolic
 * here, mirroring the packs' own convention.
 */
export function distanceUnit() { return t(current === 'imperial' ? 'unitMi' : 'unitKm'); }
export function shortDistanceUnit() { return t(current === 'imperial' ? 'unitFt' : 'unitM'); }
export function elevationUnit() { return t(current === 'imperial' ? 'unitFt' : 'unitM'); }
export function speedUnit() { return t(current === 'imperial' ? 'unitMph' : 'unitKmh'); }
export function paceUnit() { return t(current === 'imperial' ? 'unitPerMi' : 'unitPerKm'); }
export function vamUnit() { return t(current === 'imperial' ? 'unitFth' : 'unitMh'); }

/** Heart rate, cadence, power — the same key in both unit systems.
 *  Cadence additionally follows the track's detected convention: a file
 *  judged single-leg displays steps per minute (spm), everything else rpm. */
export function bpmUnit() { return t('unitBpm'); }
export function rpmUnit() { return t('unitRpm'); }
export function powerUnit() { return t('unitW'); }

/**
 * Cadence display helpers, keyed to the loaded track's cadenceFactor (2 =
 * single-leg, converted ×2 on read). `track` may be omitted — the current
 * trackStore track is the default, so registry-driven callers (the dual-
 * variable metric table, the profile overlay defs, formatters) stay
 * convention-aware without threading a track argument through every UI.
 * @param {import('../types.js').Track} [track]
 */
function isStepCadence(track) {
  const tr = track ?? trackStore.get();
  return (tr?.cadenceFactor ?? 1) === 2;
}
/** The legend label KEY (cadenceStep vs cadence) — for t(metric.labelKey) consumers. */
export function cadenceLabelKey(track) { return isStepCadence(track) ? 'cadenceStep' : 'cadence'; }
/** Translated labels for the panel's three cadence rows. */
export function cadenceLabel(track) { return t(cadenceLabelKey(track)); }
export function avgCadenceLabel(track) { return t(isStepCadence(track) ? 'avgCadenceStep' : 'avgCadence'); }
export function maxCadenceLabel(track) { return t(isStepCadence(track) ? 'maxCadenceStep' : 'maxCadence'); }
/** Unit label: 步/分 (spm) on converted tracks, otherwise the rpm wording. */
export function cadenceUnit(track) { return t(isStepCadence(track) ? 'unitSpm' : 'unitRpm'); }

/** Percent is symbolic in every language (no pack key). */
export function percentUnit() { return '%'; }

/** Ambient temperature: °C in Metric, °F in Imperial — mirrors formatTemp's conversion; never translated. */
export function tempUnit() { return current === 'imperial' ? '°F' : '°C'; }
