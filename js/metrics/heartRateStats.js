/**
 * Heart-rate zone statistics — pause-aware time-in-zone over a sector.
 *
 * Walks the sector's segments with the SAME pause state machine as
 * computeSectorMetrics (createPauseTracker, so the zone denominator is by
 * construction the moving time the Time group reports), then attributes each
 * moving segment's seconds to the zone of its heart rate reading.
 *
 * Exclusions follow the spec exactly:
 *  - pause seconds (speed < 0.5 km/h sustained ≥ 10 s) enter no zone and are
 *    not part of the percentage denominator;
 *  - seconds without a heart-rate reading ("No Heart Rate Data") enter no
 *    zone either;
 *  - readings below the Zone 1 lower bound B1 belong to no zone either —
 *    reported as `below` — so the five zone percentages need not sum to
 *    100 %.
 */
import { pointAtDistance } from '../geo/interpolate.js';
import { createPauseTracker, PAUSE_MOVING } from './sectorMetrics.js';
import { loadHeartRateSettings } from './heartRateSettings.js';
import { computeZoneBounds, classifyHr } from './heartRateZones.js';

/**
 * Computes the time-in-zone distribution for [startDist, endDist].
 *
 * @param {import('../types.js').Track} track
 * @param {number} startDist  meters along the track
 * @param {number} endDist    meters along the track
 * @param {import('./heartRateSettings.js').HeartRateSettings} [settings]
 *   defaults to the persisted settings
 * @returns {{moving: number, paused: number, noHr: number, below: number,
 *             zones: {lo: number, hi: number|null, seconds: number}[]}|null}
 *   `moving` is the effective moving time in seconds (the denominator of the
 *   zone percentages), `paused` the excluded pause seconds, `noHr` the
 *   excluded seconds without a heart-rate reading and `below` the seconds
 *   whose reading sits below the Zone 1 lower bound. Null when the sector
 *   has no timestamps, no heart-rate data at all, or the settings are
 *   invalid.
 */
export function computeHeartRateZoneStats(track, startDist, endDist, settings = loadHeartRateSettings()) {
  if (!track || !track.hasTime || track.pointCount < 2) return null;
  const bounds = computeZoneBounds(settings);
  if (!bounds) return null;

  const total = track.totalDistance;
  const s = Math.min(Math.max(startDist, 0), total);
  const e = Math.min(Math.max(endDist, s), total);
  const start = pointAtDistance(track, s);
  const end = pointAtDistance(track, e);
  if (!start || !end || start.time == null || end.time == null) return null;

  // Pass 1 — the metrics walk: pause spans, moving total, and one bucket per
  // timed segment (t0 → t1 with the reading of the segment's end point).
  const pause = createPauseTracker();
  const segT0 = [];
  const segT1 = [];
  const segHr = [];
  let moving = 0;
  let prevTime = start.time;
  let prevDist = start.dist;
  let hasHr = false;
  const hrAt = (i) => {
    const hr = track.points[i]?.hr;
    return hr != null && Number.isFinite(hr) ? hr : null;
  };
  const record = (t0, t1, hr) => {
    segT0.push(t0);
    segT1.push(t1);
    segHr.push(hr);
    if (hr != null) hasHr = true;
  };
  for (let k = start.i + 1; k <= end.i; k++) {
    const p = track.points[k];
    const dt = p.time != null && prevTime != null ? (p.time - prevTime) / 1000 : null;
    if (dt != null && dt > 0) {
      const status = pause.step(track.cumDist[k] - prevDist, dt, prevTime, p.time, 0);
      if (status === PAUSE_MOVING) moving += pause.credit;
      record(prevTime, p.time, hrAt(k));
      prevTime = p.time;
    }
    prevDist = track.cumDist[k];
  }
  // Trailing interpolated sliver up to the sector boundary; its reading comes
  // from whichever end point is nearer (same rule as the profile tooltip).
  if (end.time != null && prevTime != null && end.time > prevTime) {
    const dt = (end.time - prevTime) / 1000;
    const status = pause.step(end.dist - prevDist, dt, prevTime, end.time, 0);
    if (status === PAUSE_MOVING) moving += pause.credit;
    const nearest = end.t < 0.5 ? end.i : Math.min(end.i + 1, track.pointCount - 1);
    record(prevTime, end.time, hrAt(nearest));
  }
  moving += pause.finish();
  if (!hasHr || moving <= 0) return null;

  // Pass 2 — attribute each segment: pause spans were built from whole
  // segments, so a segment is either fully inside a span or fully outside.
  const spans = pause.spans;
  const insidePause = (t0, t1) =>
    spans.some(([a, b]) => t0 >= a && t1 <= b);
  const seconds = [0, 0, 0, 0, 0];
  let noHr = 0;
  let below = 0;
  for (let i = 0; i < segT0.length; i++) {
    if (insidePause(segT0[i], segT1[i])) continue;
    const hr = segHr[i];
    if (hr == null) {
      noHr += (segT1[i] - segT0[i]) / 1000;
      continue;
    }
    const zone = classifyHr(hr, bounds);
    if (zone === 0) {
      below += (segT1[i] - segT0[i]) / 1000;
      continue;
    }
    seconds[zone - 1] += (segT1[i] - segT0[i]) / 1000;
  }
  let paused = 0;
  for (const [a, b] of spans) paused += (b - a) / 1000;

  return {
    moving,
    paused,
    noHr,
    below,
    zones: bounds.zones.map((z, i) => ({ lo: z.lo, hi: z.hi, seconds: seconds[i] })),
  };
}
