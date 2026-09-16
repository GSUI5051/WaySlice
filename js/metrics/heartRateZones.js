/**
 * Heart-rate zone math — zone bounds and derived percentage readouts.
 *
 * Pure functions over the settings from heartRateSettings.js. The zones'
 * bpm LOWER bounds are the user-configured truth (B1..B5 per mode; in LTHR
 * mode B5 is the implicit lactate threshold, its 100 %); everything else is
 * derived here, so a mode or parameter switch recomputes every readout
 * without touching the configuration:
 *
 *   computeZoneBounds   — the half-open bpm intervals used for
 *                         classification and the display ranges
 *   computeBoundaryPcts — each B_N as a percentage of the mode's base HR
 *
 * The bounds stay CONTINUOUS values through the whole computation — they
 * are never rounded per zone (independent rounding of adjacent bounds
 * would overlap or gap the display). They are whole bpm by construction
 * (the user enters them), but the display derivation below keeps working
 * for fractional bounds too:
 *
 *   classification (half-open, on the raw bounds)
 *     zone 1   B1 ≤ hr < B2
 *     zone n   B_n ≤ hr < B_n+1        (n = 2..4)
 *     zone 5   hr ≥ B5                 (open top)
 *
 *   integer display (zoneDisplayRange)
 *     zone n   [ceil(B_n), ceil(B_n+1) - 1]
 *     zone 5   [ceil(B5), +∞)
 *
 * so adjacent zones read as strictly consecutive whole bpm values with
 * neither overlap nor gap, and zone N's bpm range ends exactly where zone
 * N+1 begins.
 *
 * Percentage readouts are continuous floats — round ONLY at display:
 *
 *   MAX   pct = B / maxHR × 100
 *   HRR   pct = (B − restingHR) / (maxHR − restingHR) × 100   (Karvonen)
 *   LTHR  pct = B / lthr × 100
 *
 * A zone's percentage RANGE runs from its own lower-bound percentage to
 * the NEXT zone's lower-bound percentage (both rows share the boundary
 * value); zone 5 reads "pct(B5)%+".
 *
 * A heart rate below B1 belongs to NO zone (classifyHr → 0); the statistics
 * report those seconds separately.
 */
import { validateSettings, HR_MODES } from './heartRateSettings.js';

/** @private The five continuous bpm boundaries B1..B5 of a settings object.
 *  Callers gate on validateSettings first. */
function zoneEdges(settings) {
  const { mode, lthr, zones } = settings;
  return mode === 'lthr' ? [...zones.lthr, lthr] : [...zones[mode]];
}

/**
 * Computes the zone table for a settings object.
 *
 * @param {import('./heartRateSettings.js').HeartRateSettings} settings
 * @returns {{zones: {lo: number, hi: number|null}[]}|null}
 *   Five zones with continuous bpm bounds; `hi` is null for the open-topped
 *   zone 5. Null when the settings fail validation.
 */
export function computeZoneBounds(settings) {
  if (validateSettings(settings)) return null;
  const edges = zoneEdges(settings);
  /** @type {{lo: number, hi: number|null}[]} */
  const zonesOut = [];
  for (let i = 0; i < 5; i++) {
    zonesOut.push({ lo: edges[i], hi: i < 4 ? edges[i + 1] : null });
  }
  return { zones: zonesOut };
}

/**
 * The zone lower bounds B1..B5 as percentages of the active mode's base
 * heart rate — the read-only counterpart of the bpm bounds. Continuous
 * floats; the UI rounds per row. In LTHR mode B5 is the threshold itself,
 * so its percentage is exactly 100.
 *
 * @param {import('./heartRateSettings.js').HeartRateSettings} settings
 * @returns {number[]|null} five percentages, or null when the settings
 *   fail validation
 */
export function computeBoundaryPcts(settings) {
  if (validateSettings(settings)) return null;
  const { mode, maxHR, restingHR, lthr } = settings;
  const pctOf = mode === 'hrr'
    ? (bpm) => (bpm - restingHR) / (maxHR - restingHR) * 100
    : (bpm) => bpm / (mode === 'lthr' ? lthr : maxHR) * 100;
  return zoneEdges(settings).map(pctOf);
}

/**
 * Classifies one heart-rate reading against the continuous bounds.
 * Left-closed, right-open — a bpm value can never belong to two zones, and
 * the boundary value B_n belongs to zone n (the zone it opens).
 *
 * @param {number} bpm
 * @param {{zones: {lo: number, hi: number|null}[]}} bounds
 *   from computeZoneBounds
 * @returns {number} zone index 1..5, or 0 when the reading is below B1
 *   (it belongs to no zone)
 */
export function classifyHr(bpm, bounds) {
  const { zones } = bounds;
  if (bpm < zones[0].lo) return 0;
  for (let i = 0; i < 4; i++) {
    if (bpm < zones[i].hi) return i + 1;
  }
  return 5;
}

/**
 * Integer display bounds of one zone — the smallest and largest WHOLE bpm
 * that can fall into the continuous interval. The upper bound is
 * ceil(hi) - 1, never an independent rounding of hi: adjacent zones then
 * read as strictly consecutive integers (…143 | 144…) with neither overlap
 * nor gap.
 *
 * @param {{lo: number, hi: number|null}} zone  from computeZoneBounds
 * @returns {{lo: number, hi: number|null}}
 */
export function zoneDisplayRange(zone) {
  return {
    lo: Math.ceil(zone.lo),
    hi: zone.hi == null ? null : Math.ceil(zone.hi) - 1,
  };
}

/** Mode key guard shared by the UI. @param {string} mode @returns {boolean} */
export function isHrMode(mode) {
  return HR_MODES.includes(mode);
}
