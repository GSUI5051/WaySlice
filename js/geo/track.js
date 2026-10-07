/**
 * Turns a raw point array into a `Track` with derived geometry
 * (cumulative horizontal distance, bounds, data availability flags).
 *
 * Metrics are later computed from `points` + `cumDist` only, so display
 * simplification can never corrupt calculations: the original data stays here.
 */
import { haversine } from './distance.js';
import { nearestOnTrack } from './interpolate.js';

/**
 * A waypoint farther than this from the track never reaches the UI: markers,
 * profile pins and the CP-to-CP table all read `track.waypoints`, so one
 * cutoff keeps every consumer honest about what is on the route.
 */
export const WAYPOINT_MAX_OFF_TRACK_M = 50;

/**
 * @param {import('../types.js').TrackPoint[]} points  Valid points (lat/lon finite), file order.
 * @param {string} name  Display name.
 * @param {import('../types.js').Waypoint[]} [waypoints]  Waypoints from the same file.
 * @returns {import('../types.js').Track}
 */
export function prepareTrack(points, name, waypoints = []) {
  const n = points.length;
  /** @type {Float64Array} */
  const cumDist = new Float64Array(n);
  let total = 0;
  for (let i = 1; i < n; i++) {
    total += haversine(
      points[i - 1].lat, points[i - 1].lon,
      points[i].lat, points[i].lon,
    );
    cumDist[i] = total;
  }

  let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }

  const hasElevation = n > 0 && points.every((p) => p.ele != null && Number.isFinite(p.ele));
  const hasTime = n > 0 && points.every((p) => p.time != null && Number.isFinite(p.time));
  // Sensors drop out occasionally, so hr/cadence use "any point" semantics:
  // a single recorded value makes the series computable for a sector.
  const hasHr = n > 0 && points.some((p) => p.hr != null && Number.isFinite(p.hr));
  const hasCad = n > 0 && points.some((p) => p.cad != null && Number.isFinite(p.cad));
  const hasTemp = n > 0 && points.some((p) => p.temp != null && Number.isFinite(p.temp));
  const hasPower = n > 0 && points.some((p) => p.power != null && Number.isFinite(p.power));

  let eleMin = null, eleMax = null;
  if (hasElevation) {
    for (const p of points) {
      if (eleMin === null || p.ele < eleMin) eleMin = p.ele;
      if (eleMax === null || p.ele > eleMax) eleMax = p.ele;
    }
  }

  const track = {
    name,
    points,
    cumDist,
    totalDistance: total,
    bounds: { minLat, minLon, maxLat, maxLon },
    hasElevation,
    hasTime,
    hasHr,
    hasCad,
    hasTemp,
    hasPower,
    eleMin,
    eleMax,
    pointCount: n,
    waypoints,
  };
  track.waypoints = resolveWaypoints(track, waypoints);
  return track;
}

/**
 * Resolves the file's waypoints onto the track, TrailScope-style: each
 * waypoint is matched to its globally nearest on-track position (full-scan
 * nearest-point search refined onto the polyline — no reliance on file
 * order), tagged with the distance along the track to that position, and
 * the list is then ordered by that distance. Waypoints farther than
 * `WAYPOINT_MAX_OFF_TRACK_M` from the track are dropped, so consumers can
 * treat `track.waypoints` as "the pins the user will actually see".
 *
 * @param {import('../types.js').Track} track  The track just built by prepareTrack.
 * @param {import('../types.js').Waypoint[]} waypoints  Raw waypoints, file order.
 * @returns {import('../types.js').Waypoint[]}  Resolved waypoints ({dist, offTrack} added).
 */
function resolveWaypoints(track, waypoints) {
  if (!track.pointCount || !waypoints.length) return waypoints;
  const resolved = [];
  for (const w of waypoints) {
    const near = nearestOnTrack(track, w.lat, w.lon);
    const offTrack = haversine(w.lat, w.lon, near.lat, near.lon);
    if (offTrack > WAYPOINT_MAX_OFF_TRACK_M) continue;
    resolved.push({ ...w, dist: near.dist, offTrack });
  }
  resolved.sort((a, b) => a.dist - b.dist);
  return resolved;
}
