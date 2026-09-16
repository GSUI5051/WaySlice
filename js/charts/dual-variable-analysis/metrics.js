/**
 * Dual-variable analysis — the metric registry.
 *
 * Pure definitions, no DOM: every selectable physical quantity carries its
 * label key, its unit getter, its shared formatter (utils/format.js — never
 * a module-local number format) and the display-space conversion pair used
 * for axis ticks. Raw values are ALWAYS SI (m/s, °C, m, fraction); the
 * display space is what tick steps are "nice" numbers in (km/h, °F, %, ft…),
 * so ticks convert display → raw → shared formatter and the labels can never
 * drift from the rest of the UI.
 *
 * The pair-compatibility table is the spec's valid-combination list, shared
 * by both axis selectors (X first, Y filtered to X's partners). The speed
 * family is three independent metrics — speed, pace and GAP are views of one
 * series but selectable one by one; there is no "speed group" option.
 */
import {
  getUnitSystem,
  metersToFeet,
  mpsToKmh,
  mpsToMph,
  MPH_PER_MPS,
  secPerKmToSecPerMi,
  bpmUnit,
  rpmUnit,
  powerUnit,
  tempUnit,
  percentUnit,
  elevationUnit,
  speedUnit,
  paceUnit,
} from '../../units/units.js';
import {
  formatBpm, formatRpm, formatPower, formatTemp,
  formatGrade, formatElevation, formatSpeed, formatPace,
} from '../../utils/format.js';

/** Axis tick steps are nice numbers in DISPLAY space; these convert. */
const identity = (v) => v;

/**
 * The selectable physical quantities, in selector display order.
 * `toDisplay`/`fromDisplay` convert between the raw SI value and the unit
 * space ticks are computed in (identity for bpm/rpm/W, ×3.6 / ×2.237 for
 * speed, °C↔°F, m↔ft, fraction↔%, s/km↔s/mi).
 */
export const METRICS = [
  {
    id: 'hr', labelKey: 'legendHr',
    unit: bpmUnit, format: formatBpm, toDisplay: identity, fromDisplay: identity,
  },
  {
    id: 'speed', labelKey: 'legendSpeed',
    unit: speedUnit, format: formatSpeed,
    toDisplay: (mps) => (getUnitSystem() === 'imperial' ? mpsToMph(mps) : mpsToKmh(mps)),
    fromDisplay: (d) => (getUnitSystem() === 'imperial' ? d / MPH_PER_MPS : d / 3.6),
  },
  {
    // Pace-family axes read REVERSED on BOTH axes (reversed): a SMALLER
    // value is a FASTER effort, so the fast end belongs at the top of a
    // vertical axis (5:00 /km above 15:00 /km) and at the RIGHT of a
    // horizontal one — the sports-tool convention, and the same "faster is
    // higher/righter" reading the speed axis already has unflipped.
    id: 'pace', labelKey: 'legendPace', reversed: true,
    unit: paceUnit, format: formatPace,
    toDisplay: (secPerKm) => (getUnitSystem() === 'imperial' ? secPerKmToSecPerMi(secPerKm) : secPerKm),
    fromDisplay: (d) => (getUnitSystem() === 'imperial' ? d / (METERS_PER_MILE / 1000) : d),
  },
  {
    id: 'gap', labelKey: 'legendGap', reversed: true,
    unit: paceUnit, format: formatPace,
    toDisplay: (secPerKm) => (getUnitSystem() === 'imperial' ? secPerKmToSecPerMi(secPerKm) : secPerKm),
    fromDisplay: (d) => (getUnitSystem() === 'imperial' ? d / (METERS_PER_MILE / 1000) : d),
  },
  {
    id: 'power', labelKey: 'legendPower',
    unit: powerUnit, format: formatPower, toDisplay: identity, fromDisplay: identity,
  },
  {
    id: 'cad', labelKey: 'cadence',
    unit: rpmUnit, format: formatRpm, toDisplay: identity, fromDisplay: identity,
  },
  {
    id: 'temp', labelKey: 'legendTemp',
    unit: tempUnit, format: formatTemp,
    toDisplay: (c) => (getUnitSystem() === 'imperial' ? (c * 9) / 5 + 32 : c),
    fromDisplay: (d) => (getUnitSystem() === 'imperial' ? ((d - 32) * 5) / 9 : d),
  },
  {
    id: 'grade', labelKey: 'modeGrade',
    unit: percentUnit, format: formatGrade,
    toDisplay: (fraction) => fraction * 100,
    fromDisplay: (pct) => pct / 100,
  },
  {
    id: 'ele', labelKey: 'elevationGroup',
    unit: elevationUnit, format: formatElevation,
    toDisplay: (m) => (getUnitSystem() === 'imperial' ? metersToFeet(m) : m),
    fromDisplay: (d) => (getUnitSystem() === 'imperial' ? d / 0.3048 : d),
  },
];

const METRIC_BY_ID = new Map(METRICS.map((m) => [m.id, m]));

/** @returns {{id:string,labelKey:string,unit:Function,format:Function,toDisplay:Function,fromDisplay:Function}|undefined} */
export function getMetric(id) {
  return METRIC_BY_ID.get(id);
}

/**
 * The spec's valid X/Y combinations, as each metric's partner list. Written
 * out in full (not mirrored at runtime) so the table reads exactly like the
 * spec's per-metric sections.
 */
const PARTNERS = {
  hr: ['speed', 'pace', 'gap', 'power', 'cad', 'grade', 'ele'],
  power: ['speed', 'pace', 'gap', 'cad', 'hr', 'temp', 'grade', 'ele'],
  cad: ['speed', 'pace', 'gap', 'hr', 'power', 'temp', 'grade', 'ele'],
  temp: ['speed', 'pace', 'gap', 'power', 'cad', 'ele'],
  grade: ['power', 'hr', 'cad', 'speed', 'pace', 'gap'],
  ele: ['hr', 'temp', 'power', 'cad'],
  speed: ['hr', 'power', 'cad', 'temp', 'grade'],
  pace: ['hr', 'power', 'cad', 'temp', 'grade'],
  gap: ['hr', 'power', 'cad', 'temp', 'grade'],
};

/**
 * Whether the X/Y pair may be analyzed. X = Y is never allowed; every other
 * pair must appear in the table above.
 */
export function isPairAllowed(xId, yId) {
  if (!xId || !yId || xId === yId) return false;
  return (PARTNERS[xId] || []).includes(yId);
}

/**
 * The ids Y may take for a given X — the selector filter. An unknown X
 * (nothing chosen yet) leaves every metric selectable.
 */
export function partnersOf(xId) {
  return PARTNERS[xId] || null;
}
