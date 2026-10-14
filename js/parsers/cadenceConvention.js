/**
 * Cadence convention detection for FIT records.
 *
 * FIT's record.cadence carries one of two conventions in running/hiking
 * files: the value IS the step rate per minute (double), or it is the
 * single-leg cycle rate and the real step rate is twice the value (single).
 * The convention is decided PER FILE from the file's own data — never from
 * a vendor/model table: the same device writes different fields per sport,
 * and every running/hiking file measured so far (Garmin, Suunto, COROS,
 * Amazfit alike) turned out to be single-leg.
 *
 * The criterion is the file's self-consistency: with speed v (m/s) and step
 * length s (meters) on the same records,
 *
 *   k = (v × 60) / s / cadence
 *
 * reads as steps per minute over the reported cadence — k ≈ 1 means the
 * value is already steps (double), k ≈ 2 means it is half of it (single).
 * The verdict uses the SHARE of k values landing inside each convention's
 * band (not quartiles — real files scatter too wide for an IQR gate), and
 * anything with too few samples or too little agreement stays `unknown`:
 * an undetermined file displays the raw values rather than multiplying on
 * a guess. Rides never trip the single verdict in practice (they carry no
 * step_length, so they fall through to `unknown` → factor 1); a ×2 on a
 * crank rpm would be a catastrophe, which is exactly why the fallback is
 * the raw value.
 */

/** Minimum valid samples before a file may be classified at all. */
export const CADENCE_MIN_SAMPLES = 30;
/** k band counts as single-leg (×2); anything between the bands agrees with nothing. */
export const CADENCE_SINGLE_BAND = [1.6, 2.4];
/** k band counts as double-step (×1). */
export const CADENCE_DOUBLE_BAND = [0.7, 1.4];
/** Minimum share of k values inside one band to trust that band. */
export const CADENCE_AGREE_MIN = 0.55;
/** Speeds at or below this (m/s) are standing still / GPS noise, not strides. */
export const CADENCE_MIN_SPEED_MPS = 0.5;

/**
 * @param {Array<Object>} records  fit-parser record messages (raw, unmapped —
 *   step_length is gone by the time records become TrackPoints)
 * @returns {{convention: 'single'|'double'|'unknown', factor: number}}
 *   factor multiplies every cadence reading on read side
 */
export function detectCadenceConvention(records) {
  const ks = [];
  for (const r of records ?? []) {
    // Garmin writes only enhanced_speed; Suunto/COROS/Amazfit only speed —
    // same preference the TrackPoint mapping itself uses.
    const v = r.speed ?? r.enhanced_speed;
    if (!Number.isFinite(v) || !Number.isFinite(r.cadence) || !Number.isFinite(r.step_length)) continue;
    if (v <= CADENCE_MIN_SPEED_MPS || r.cadence <= 0 || r.step_length <= 0) continue;
    ks.push((v * 60) / (r.step_length / 1000) / r.cadence);
  }
  if (ks.length < CADENCE_MIN_SAMPLES) return { convention: 'unknown', factor: 1 };
  const inBand = ([lo, hi]) => ks.filter((k) => k >= lo && k <= hi).length / ks.length;
  const inSingle = inBand(CADENCE_SINGLE_BAND);
  const inDouble = inBand(CADENCE_DOUBLE_BAND);
  if (Math.max(inSingle, inDouble) < CADENCE_AGREE_MIN) return { convention: 'unknown', factor: 1 };
  return inSingle >= inDouble
    ? { convention: 'single', factor: 2 }
    : { convention: 'double', factor: 1 };
}
