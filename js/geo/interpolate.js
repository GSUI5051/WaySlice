/**
 * Distance-based interpolation and nearest-point lookup.
 *
 * A sector boundary may fall anywhere *between* two track points. Rather than
 * snapping the user's choice to the nearest sample, boundaries are stored as a
 * distance along the track and boundary points are linearly interpolated
 * (position, elevation and time) inside the containing segment.
 */

const RAD = Math.PI / 180;
const EARTH_RADIUS = 6371008.8;

/**
 * Point exactly at `dist` meters along the track, interpolated inside its segment.
 *
 * @param {import('../types.js').Track} track
 * @param {number} dist  meters, will be clamped to [0, totalDistance]
 * @returns {{i:number, t:number, lat:number, lon:number, ele:number|null, time:number|null, dist:number}|null}
 */
export function pointAtDistance(track, dist) {
  const { points, cumDist } = track;
  const n = points.length;
  if (n === 0) return null;
  const d = Math.min(Math.max(dist, 0), track.totalDistance);

  if (d <= 0) return boundaryPoint(points[0], 0, 0, d);
  if (d >= track.totalDistance) {
    return boundaryPoint(points[n - 1], n - 1, 0, d);
  }

  // Binary search: largest i with cumDist[i] <= d.
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumDist[mid] <= d) lo = mid; else hi = mid;
  }
  const segLen = cumDist[hi] - cumDist[lo];
  const t = segLen > 0 ? (d - cumDist[lo]) / segLen : 0;
  return interpolateBetween(points[lo], points[hi], t, lo, t, d);
}

/**
 * Nearest position on the track for a free map coordinate. Uses an
 * expanding-window vertex search around `hintIdx` (from the previous drag
 * position) so repeated lookups during a handle drag are O(window), with a
 * full scan only as fallback. The winning segment is refined with an exact
 * projection, so the returned boundary sits *on* the polyline.
 *
 * @param {import('../types.js').Track} track
 * @param {number} lat @param {number} lon
 * @param {number|null} [hintIdx]  Previously matched point index, if any.
 * @returns {{i:number, t:number, dist:number, lat:number, lon:number, ele:number|null, time:number|null}}
 */
export function nearestOnTrack(track, lat, lon, hintIdx = null) {
  const { points } = track;
  const n = points.length;
  if (n === 0) throw new Error('empty track');
  if (n === 1) return { i: 0, t: 0, dist: 0, ...points[0] };

  const cosLat = Math.cos((((track.bounds.minLat + track.bounds.maxLat) / 2)) * RAD);
  const scaleLat = EARTH_RADIUS * RAD;
  const scaleLon = EARTH_RADIUS * RAD * cosLat;

  const approxDist2 = (a, b) => {
    const dx = (a.lon - b.lon) * scaleLon;
    const dy = (a.lat - b.lat) * scaleLat;
    return dx * dx + dy * dy;
  };

  // 1) Find the nearest vertex.
  let best = 0, bestD2 = Infinity;
  let lo = 0, hi = n - 1;
  const probe = { lat, lon };
  if (hintIdx != null && hintIdx >= 0 && hintIdx < n) {
    // Expanding window around the hint; falls back to a full scan.
    let w = 64;
    for (;;) {
      lo = Math.max(0, hintIdx - w);
      hi = Math.min(n - 1, hintIdx + w);
      bestD2 = Infinity;
      for (let i = lo; i <= hi; i++) {
        const d2 = approxDist2(points[i], probe);
        if (d2 < bestD2) { bestD2 = d2; best = i; }
      }
      const halfSpan = Math.max(
        Math.abs(hintIdx - lo) ? approxDist2(points[lo], points[hintIdx]) : 0,
        hi < n - 1 ? approxDist2(points[hi], points[hintIdx]) : 0,
      );
      if (bestD2 <= halfSpan || (lo === 0 && hi === n - 1)) break;
      w *= 4;
    }
  } else {
    for (let i = 0; i < n; i++) {
      const d2 = approxDist2(points[i], probe);
      if (d2 < bestD2) { bestD2 = d2; best = i; }
    }
  }

  // 2) Refine against the two segments adjacent to the best vertex.
  let result = null;
  for (const [a, b] of [[best - 1, best], [best, best + 1]]) {
    if (a < 0 || b >= n) continue;
    const ax = points[a].lon * scaleLon, ay = points[a].lat * scaleLat;
    const bx = points[b].lon * scaleLon, by = points[b].lat * scaleLat;
    const px = lon * scaleLon, py = lat * scaleLat;
    const vx = bx - ax, vy = by - ay;
    const len2 = vx * vx + vy * vy;
    let t = len2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / len2 : 0;
    t = Math.min(1, Math.max(0, t));
    const qx = ax + t * vx, qy = ay + t * vy;
    const d2 = (px - qx) * (px - qx) + (py - qy) * (py - qy);
    if (!result || d2 < result.d2) {
      const segH = track.cumDist[b] - track.cumDist[a];
      const dist = track.cumDist[a] + t * segH;
      const pt = interpolateBetween(points[a], points[b], t, a, t, dist);
      result = { i: a, t, dist, d2, lat: pt.lat, lon: pt.lon, ele: pt.ele, time: pt.time };
    }
  }
  if (!result) {
    const pt = points[best];
    return { i: best, t: 0, dist: track.cumDist[best], ...pt };
  }
  const { d2, ...rest } = result;
  return rest;
}

/** @private Builds a boundary from a single track point (no interpolation). */
function boundaryPoint(p, i, t, dist) {
  return {
    i, t, dist,
    lat: p.lat, lon: p.lon,
    ele: p.ele ?? null,
    time: p.time ?? null,
  };
}

/** @private Linear interpolation between two track points. */
function interpolateBetween(a, b, t, i, frac, dist) {
  const lerp = (x, y) => x + (y - x) * frac;
  const ele =
    a.ele != null && b.ele != null ? lerp(a.ele, b.ele) : (a.ele ?? b.ele ?? null);
  const time =
    a.time != null && b.time != null ? lerp(a.time, b.time) : (a.time ?? b.time ?? null);
  return { i, t, dist, lat: lerp(a.lat, b.lat), lon: lerp(a.lon, b.lon), ele, time };
}
