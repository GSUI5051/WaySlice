/**
 * Shared post-parse repair: devices drop single altitude readings now and
 * then; a few gaps would disable every elevation feature (prepareTrack
 * requires all points to carry elevation), so bridge short gaps by linear
 * interpolation between the neighbouring points and edge gaps by extension
 * of the nearest value. Time is never invented.
 */

/**
 * Fills null-elevation holes in the point array in place.
 * @param {Array<import('../types.js').TrackPoint>} points
 */
export function fillElevationGaps(points) {
  let i = 0;
  while (i < points.length) {
    if (points[i].ele != null) { i++; continue; }
    let j = i;
    while (j < points.length && points[j].ele == null) j++;
    const prev = i > 0 ? points[i - 1].ele : null;
    const next = j < points.length ? points[j].ele : null;
    for (let k = i; k < j; k++) {
      if (prev != null && next != null) {
        const f = (k - i + 1) / (j - i + 1);
        points[k].ele = prev + (next - prev) * f;
      } else {
        points[k].ele = prev ?? next;
      }
    }
    i = j;
  }
}

/**
 * Parses one element's text as a finite number, null for missing/blank/
 * non-numeric content (Number('') is 0 — the empty guard is load-bearing).
 * @param {Element|null} el  element whose textContent is the number
 * @returns {number|null}
 */
export function numberFromText(el) {
  const text = (el?.textContent ?? '').trim();
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}
