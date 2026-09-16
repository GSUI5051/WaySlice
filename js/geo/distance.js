/**
 * Geodesic distance helpers.
 *
 * All functions take WGS84 degrees. The mean Earth radius is used; for the
 * short segments between adjacent track points (typically 1–100 m) the
 * haversine formula is more than accurate enough for distance statistics.
 */

/** Mean Earth radius in meters (IUGG). */
export const EARTH_RADIUS = 6371008.8;

const RAD = Math.PI / 180;

/**
 * Great-circle surface distance between two points, in meters.
 *
 * @param {number} lat1 @param {number} lon1 @param {number} lat2 @param {number} lon2
 * @returns {number} meters
 */
export function haversine(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const a =
    sinLat * sinLat +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * sinLon * sinLon;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * 3D segment length from a horizontal distance and an elevation difference.
 * This is the core WaySlice rule: sqrt(horizontal² + vertical²).
 *
 * @param {number} horizontal  meters
 * @param {number} dEle        meters (signed; squared so sign is irrelevant)
 * @returns {number} meters
 */
export function segment3D(horizontal, dEle) {
  return Math.sqrt(horizontal * horizontal + dEle * dEle);
}
