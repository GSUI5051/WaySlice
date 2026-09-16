/**
 * Whole-track statistics — simply the sector metrics of the full range,
 * plus the sector store's default state helpers.
 */
import { computeSectorMetrics } from './sectorMetrics.js';

/**
 * Metrics for the entire track.
 *
 * @param {import('../types.js').Track} track
 * @returns {import('../types.js').SectorMetrics}
 */
export function computeTrackStats(track) {
  return computeSectorMetrics(track, 0, track.totalDistance);
}
