/**
 * Display-only geometry simplification (Douglas–Peucker).
 *
 * Used exclusively for rendering large tracks on the map and in the profile;
 * never for metrics, which always read the original `track.points`.
 */

const RAD = Math.PI / 180;

/** Perpendicular distance from point p to segment [a, b] in approximate meters. */
function perpendicularDistance(p, a, b, scaleLat, scaleLon) {
  const ax = a.lon * scaleLon, ay = a.lat * scaleLat;
  const bx = b.lon * scaleLon, by = b.lat * scaleLat;
  const px = p.lon * scaleLon, py = p.lat * scaleLat;
  const vx = bx - ax, vy = by - ay;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) {
    const dx = px - ax, dy = py - ay;
    return Math.sqrt(dx * dx + dy * dy);
  }
  let t = ((px - ax) * vx + (py - ay) * vy) / len2;
  t = Math.min(1, Math.max(0, t));
  const dx = px - (ax + t * vx), dy = py - (ay + t * vy);
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Douglas–Peucker simplification keeping endpoints.
 *
 * @param {import('../types.js').TrackPoint[]} points
 * @param {number} toleranceMeters
 * @returns {import('../types.js').TrackPoint[]}
 */
export function simplify(points, toleranceMeters) {
  const n = points.length;
  if (n <= 2) return points.slice();
  const midLat = points.reduce((s, p) => s + p.lat, 0) / n;
  const scaleLat = 6371008.8 * RAD;
  const scaleLon = 6371008.8 * RAD * Math.cos(midLat * RAD);

  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxD = -1, idx = -1;
    for (let i = first + 1; i < last; i++) {
      const d = perpendicularDistance(points[i], points[first], points[last], scaleLat, scaleLon);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx !== -1 && maxD > toleranceMeters) {
      keep[idx] = 1;
      stack.push([first, idx], [idx, last]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/**
 * Simplifies a track for display, adapting the tolerance until the result
 * fits within `maxPoints` (progressive doubling keeps this fast even for
 * 100k+ point inputs).
 *
 * @param {import('../types.js').TrackPoint[]} points
 * @param {number} [maxPoints]
 * @returns {import('../types.js').TrackPoint[]}
 */
export function simplifyForDisplay(points, maxPoints = 12000) {
  if (points.length <= maxPoints) return points;
  let tolerance = 1.5;
  let out = points;
  for (let iter = 0; iter < 8 && out.length > maxPoints; iter++) {
    out = simplify(points, tolerance);
    tolerance *= 2;
  }
  return out;
}

/**
 * Even stride thinning (much cheaper than DP; used for the live sector
 * highlight while a handle is being dragged).
 *
 * @param {import('../types.js').TrackPoint[]} points
 * @param {number} [maxPoints]
 * @returns {import('../types.js').TrackPoint[]}
 */
export function thinStride(points, maxPoints = 12000) {
  if (points.length <= maxPoints) return points;
  const stride = Math.ceil(points.length / maxPoints);
  const out = [];
  for (let i = 0; i < points.length; i += stride) out.push(points[i]);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}
