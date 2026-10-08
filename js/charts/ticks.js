/**
 * Axis math shared by the two charts' tick loops (elevation profile and
 * dual-variable density map).
 */
import { METERS_PER_FOOT, METERS_PER_MILE } from '../units/units.js';

/**
 * Rounds a raw tick step up to the nearest 1/2/5×10^k "nice" value.
 * The floor keeps Math.log10 of an (absurdly) tiny range finite.
 * @param {number} raw  desired step in axis units, > 0
 * @returns {number}
 */
export function niceStep(raw) {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-12))));
  for (const m of [1, 2, 5, 10]) {
    if (raw <= m * pow) return m * pow;
  }
  return 10 * pow;
}

/**
 * Re-rounds a raw METERS tick step into the display unit's own 1/2/5
 * ladder, so every grid label reads as an integer in its own unit — a
 * meters ladder converted for display reads as an ugly 1.24-mile grid.
 * Metric returns the meters step unchanged: 1/2/5×10^k meters already
 * label as whole meters below 1 km and whole kilometers above. Imperial
 * rounds whole miles at a mile and up, whole hundreds of feet below the
 * mile line (the feet ladder is clamped back to 1 mile where the two
 * ladders cross, so a step never lands between them and formats as
 * fractional miles).
 * @param {number} rawStep  desired step in METERS, > 0
 * @param {'metric'|'imperial'} unitSystem
 * @returns {number} grid step in METERS
 */
export function niceStepForUnit(rawStep, unitSystem) {
  if (unitSystem !== 'imperial') return rawStep;
  if (rawStep >= METERS_PER_MILE) return niceStep(rawStep / METERS_PER_MILE) * METERS_PER_MILE;
  const feetStep = niceStep(rawStep / METERS_PER_FOOT) * METERS_PER_FOOT;
  return feetStep < METERS_PER_MILE ? feetStep : METERS_PER_MILE;
}

/** Nice duration steps in ascending SECONDS — whole seconds / minutes /
 *  hours, the values a duration axis may label. */
const TIME_LADDER = [
  1, 5, 15, 30, // seconds
  60, 120, 300, 600, 900, 1800, // minutes
  3600, 7200, 10800, 21600, 43200, 86400, // hours, then a day
];

/**
 * Re-rounds a raw tick step from SECONDS onto the duration ladder, so a
 * time-mode axis grids in whole seconds / minutes / hours. The decimal
 * 1/2/5 ladder in milliseconds grids at 5000 s — formatted "1:23:20"; the
 * duration ladder gives 1 h. Steps past a day fall back to the 1/2/5
 * ladder over days.
 * @param {number} rawStep  desired step in SECONDS, > 0
 * @returns {number} grid step in SECONDS
 */
export function niceTimeStep(rawStep) {
  for (const s of TIME_LADDER) {
    if (rawStep <= s) return s;
  }
  return niceStep(rawStep / 86400) * 86400;
}
