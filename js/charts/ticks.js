/**
 * Axis math shared by the two charts' tick loops (elevation profile and
 * dual-variable density map).
 */

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
