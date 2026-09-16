/**
 * Heart-rate zone DISPLAY settings for the elevation profile — the two
 * toggles in the settings drawer's heart-rate section, persisted as one
 * JSON blob in localStorage ('wayslice-hr-display'):
 *
 *   showZones — draw the five faint zone bands behind the HR curve
 *   highlight — while hovering, deepen the band under the cursor
 *
 * Both default to true, i.e. the behavior before the toggles existed (bands
 * always drawn, hover highlight always active). The highlight is only
 * effective together with showZones — the drawer disables its toggle while
 * the bands are hidden — but its stored choice is kept as-is, so turning
 * the bands back on restores it; the gate itself lives in the renderer.
 * Neither toggle turns the HR overlay on: with the HR curve hidden there
 * is no scale to map the bands through, and nothing is drawn regardless.
 *
 * Storage follows the same rules as heartRateSettings.js: a blob that is
 * missing, corrupt or not exactly two booleans falls back to the defaults
 * and the broken key is removed so the storage heals. A successful
 * setHeartRateDisplay() persists the merged pair and emits 'hrzones:display'
 * — the elevation profile listens for it and redraws; the drawer re-renders
 * its own rows directly after toggling.
 */
import { emit } from '../core/events.js';

const STORAGE_KEY = 'wayslice-hr-display';

/** @type {{showZones: boolean, highlight: boolean}} */
export const DEFAULT_HEART_RATE_DISPLAY = Object.freeze({
  showZones: true,
  highlight: true,
});

/**
 * @returns {{showZones: boolean, highlight: boolean}} the persisted
 *  display settings, or the defaults when nothing (or something invalid)
 *  is stored — a broken blob never throws and the storage heals.
 */
export function getHeartRateDisplay() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_HEART_RATE_DISPLAY };
    const parsed = JSON.parse(raw);
    if (
      !parsed || typeof parsed !== 'object' ||
      typeof parsed.showZones !== 'boolean' ||
      typeof parsed.highlight !== 'boolean'
    ) {
      localStorage.removeItem(STORAGE_KEY);
      return { ...DEFAULT_HEART_RATE_DISPLAY };
    }
    return { showZones: parsed.showZones, highlight: parsed.highlight };
  } catch {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    return { ...DEFAULT_HEART_RATE_DISPLAY };
  }
}

/**
 * Merges a partial patch onto the current settings, persists the result and
 * emits 'hrzones:display' with the new pair.
 * @param {{showZones?: boolean, highlight?: boolean}} patch
 * @returns {{showZones: boolean, highlight: boolean}} the saved settings
 */
export function setHeartRateDisplay(patch) {
  const next = { ...getHeartRateDisplay(), ...patch };
  next.showZones = next.showZones === true;
  next.highlight = next.highlight === true;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch { /* private mode — settings just won't persist */ }
  emit('hrzones:display', { ...next });
  return next;
}

/** Restores the defaults (also used by tests to reset storage). */
export function resetHeartRateDisplay() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
  emit('hrzones:display', { ...DEFAULT_HEART_RATE_DISPLAY });
}
