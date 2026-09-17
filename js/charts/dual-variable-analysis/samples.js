/**
 * Dual-variable analysis — the data layer.
 *
 * Turns the SELECTED SECTOR of a track into the module's ONE sample table
 * (pure functions, no DOM): rows are the sector's track points, each a row
 * of aligned Float64Arrays, one per physical quantity, NaN where that
 * quantity has no value for that point (points outside the sector are NaN in
 * every quantity). Future statistics or exports can consume the same table.
 *
 * Every quantity's values are produced by the METRICS PANEL's mechanism for
 * that quantity (computeSectorMetrics over the same range), so the chart's
 * honesty contract holds point for point: its plotted values ARE the series
 * the panel's figures run over — no point can disagree with, or exceed, the
 * panel's statistics for the same quantity. The panel is the reference; this
 * module never re-derives a competing cleaned series.
 *
 *   hr / cad / power   the panel's fitness series: finite readings inside
 *                      the sector, stripped of confirmed-pause timestamps
 *                      (the sector walk's own pause spans — the same
 *                      predicate as pauseFreeSamples), then smoothed by the
 *                      shared 5-point sliding window over the compact
 *                      survivor list — the exact array behind
 *                      avgHr/maxHr, avgCad/maxCad, avgPower/maxPower
 *   temp               raw readings, unfiltered and pause-inclusive — like
 *                      the panel's rawStats (avgTemp/minTemp/maxTemp)
 *   speed / pace / gap the panel's Maximum Speed series for the sector:
 *                      recorded → dd/dt cross-check → 5-point window;
 *                      computed → 3σ (maxCleanedPointSpeed's exact
 *                      range-local construction — the same rule selection
 *                      as the profile's buildCaches, but built over the
 *                      sector's own points); pause points stay in, rest
 *                      zeros included. GAP is that speed divided by the
 *                      Minetti factor of its raw per-segment grade.
 *   grade              the panel's gradient windows over the sector
 *                      (interpolated boundaries included): one rise/run
 *                      value per closed 50 m window (plus the ≥ 20 m
 *                      trailing window) — the exact value set behind
 *                      maxGrade/minGrade
 *   ele                raw point elevations, like eleMin/eleMax
 *
 * There is NO row-level validity pipeline (the former whole-row pause drops
 * and invalid-power / invalid-cadence exclusions are gone): the panel applies
 * no such rules — a 0 W coasting reading counts in its averages, and
 * temperature keeps its paused readings — so the chart must not drop them
 * either. Exclusion happens per quantity exactly where the panel's mechanism
 * excludes; a point leaves an analysis only through the finite-pair rule
 * below.
 *
 * Pair extraction (extractPair) is where §11 applies: a row whose X or Y is
 * not finite can never enter the density computation — no zero-filling, no
 * forward-filling, no interpolation.
 */
import { speedToPace } from '../elevation-profile/profile-data.js';
import { pointAtDistance } from '../../geo/interpolate.js';
import {
  createPauseTracker, cleanSpeedSeries, cleanComputedSpeeds,
  recordedSpeedImplausible, trackHasRecordedSpeed, minettiFactor,
  GRADIENT_WINDOW_M, GRADIENT_MIN_WINDOW_M,
} from '../../metrics/sectorMetrics.js';

/**
 * Per-quantity readers over the sample table. Speed-family values (speed,
 * pace, GAP) live at the index of their segment's FIRST point — the same
 * convention buildCaches uses, so a reading at row i pairs with the effort of
 * the stretch leaving point i. Grade values live at their window's CLOSING
 * point (a 50 m window's grade describes the stretch that ends there). All
 * point-attached quantities (hr, power, cad, temp, ele) live at their own
 * point.
 */
const READERS = {
  hr: (s, i) => s.hr[i],
  power: (s, i) => s.power[i],
  cad: (s, i) => s.cad[i],
  temp: (s, i) => s.temp[i],
  grade: (s, i) => s.grade[i],
  ele: (s, i) => s.ele[i],
  speed: (s, i) => s.speed[i],
  pace: (s, i) => s.pace[i],
  gap: (s, i) => s.gap[i],
};

/**
 * Builds the sample table for the selected sector of a track. Boundaries may
 * sit between two track points; they are interpolated exactly like
 * computeSectorMetrics (pointAtDistance), and the rows are the sector's
 * integer points [start.i, end.i].
 * @param {import('../../types.js').Track} track
 * @param {number} startDist  meters (defaults to the whole track)
 * @param {number} endDist    meters (clamped after startDist)
 * @returns {{count: number, hr: Float64Array, power: Float64Array,
 *   cad: Float64Array, temp: Float64Array, grade: Float64Array,
 *   ele: Float64Array, speed: Float64Array, pace: Float64Array,
 *   gap: Float64Array, hasSpeed: boolean, hasGap: boolean}}
 */
export function buildAnalysisSamples(track, startDist = 0, endDist = track.totalDistance) {
  const n = track.pointCount;
  const total = track.totalDistance;
  const s = Math.min(Math.max(startDist, 0), total);
  const e = Math.min(Math.max(endDist, s), total);
  const start = pointAtDistance(track, s);
  const end = pointAtDistance(track, e);

  // The panel's Maximum Speed series, built RANGE-LOCALLY over the sector's
  // points — the exact construction maxCleanedPointSpeed runs for the
  // panel's figure (rule selection still GLOBAL: any recorded speed
  // anywhere → cross-check + 5-point window; none → dd/dt + 3σ). null when
  // the track has neither recorded speeds nor timestamps. Pause points are
  // NOT stripped — rest zeros included, like the panel's Maximum Speed.
  const hasRecorded = trackHasRecordedSpeed(track);
  const speedSeries = start && end
    ? sectorSpeedSeries(track, start, end, hasRecorded)
    : null;

  if (!start || !end) {
    return emptyTable(n, speedSeries);
  }

  // Pause spans over the sector walk — the same streaming state machine the
  // sector metrics run, fed the same interpolated-boundary steps
  // (mirroring computeSectorMetrics: untimed segments never reach it).
  const pauseSpans = sectorPauseSpans(track, start, end);

  const hr = panelFitnessSeries(track, 'hr', start, end, pauseSpans);
  const power = panelFitnessSeries(track, 'power', start, end, pauseSpans);
  const cad = panelFitnessSeries(track, 'cad', start, end, pauseSpans);

  // Temperature: raw readings exactly as the panel's rawStats sees them — no
  // pause strip, no smoothing, no outlier cut. An ambient reading is not an
  // effort signal and is shown as recorded.
  const temp = new Float64Array(n).fill(NaN);
  for (let i = start.i; i <= end.i; i++) temp[i] = finiteOrNaN(track.points[i].temp);

  const ele = new Float64Array(n).fill(NaN);
  if (track.hasElevation) {
    for (let i = start.i; i <= end.i; i++) ele[i] = finiteOrNaN(track.points[i].ele);
  }

  const grade = sectorGradeWindows(track, start, end);

  const speed = new Float64Array(n).fill(NaN);
  const pace = new Float64Array(n).fill(NaN);
  const gap = new Float64Array(n).fill(NaN);
  for (let i = start.i; i <= end.i; i++) {
    speed[i] = speedSeries ? speedSeries[i - start.i] : NaN;
    pace[i] = speedToPace(speed[i]);
    // GAP: the speed divided by the Minetti factor of the raw per-segment
    // grade leaving point i (the profile's GAP overlay convention).
    const dd = i + 1 < n ? track.cumDist[i + 1] - track.cumDist[i] : 0;
    const dz = i + 1 < n ? track.points[i + 1].ele - track.points[i].ele : NaN;
    gap[i] = track.hasElevation && dd > 0 && isFiniteNum(dz) && Number.isFinite(speed[i])
      ? speedToPace(speed[i] / minettiFactor(dz / dd))
      : NaN;
  }

  return {
    count: n,
    hr, power, cad, temp, grade, ele, speed, pace, gap,
    hasSpeed: speedSeries != null,
    hasGap: speedSeries != null && track.hasElevation,
  };
}

/**
 * Availability of each physical quantity on the sample table — a series
 * that lost every reading to the panel's cleaning is as unusable as one the
 * file never carried. `reasonKey` names the language key explaining the miss.
 * @returns {Record<string, {available: boolean, reasonKey: string}>}
 */
export function metricAvailability(samples, track) {
  const anyHr = hasFinite(samples.hr);
  const anyPower = hasFinite(samples.power);
  const anyCad = hasFinite(samples.cad);
  const anyTemp = hasFinite(samples.temp);
  const anyEle = hasFinite(samples.ele);
  const anyGrade = hasFinite(samples.grade);
  const anySpeed = hasFinite(samples.speed);
  const anyGap = hasFinite(samples.gap);
  return {
    hr: { available: anyHr, reasonKey: 'noHeartRateData' },
    power: { available: anyPower, reasonKey: 'noPowerData' },
    cad: { available: anyCad, reasonKey: 'noCadenceData' },
    temp: { available: anyTemp, reasonKey: 'noTempData' },
    grade: { available: anyGrade, reasonKey: 'noElevationData' },
    ele: { available: anyEle, reasonKey: 'noElevationData' },
    speed: { available: samples.hasSpeed && anySpeed, reasonKey: 'noTimestampData' },
    pace: { available: samples.hasSpeed && anySpeed, reasonKey: 'noTimestampData' },
    gap: {
      available: samples.hasGap && anyGap,
      reasonKey: track.hasElevation ? 'noTimestampData' : 'noElevationData',
    },
  };
}

/**
 * The finite, aligned X/Y pair for one analysis — §11 lives here: rows where
 * either side is null/undefined/NaN drop out. Values are never coerced,
 * filled or interpolated.
 * @returns {{xs: Float64Array, ys: Float64Array}}
 */
export function extractPair(samples, xId, yId) {
  const rx = READERS[xId];
  const ry = READERS[yId];
  const xs = new Float64Array(samples.count);
  const ys = new Float64Array(samples.count);
  let count = 0;
  for (let i = 0; i < samples.count; i++) {
    const x = rx(samples, i);
    const y = ry(samples, i);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    xs[count] = x;
    ys[count] = y;
    count++;
  }
  return { xs: xs.subarray(0, count), ys: ys.subarray(0, count) };
}

/** @private NaN for every non-finite reading — missing never becomes 0. */
function finiteOrNaN(v) {
  return v != null && Number.isFinite(v) ? v : NaN;
}

/** @private */
function hasFinite(arr) {
  for (let i = 0; i < arr.length; i++) {
    if (Number.isFinite(arr[i])) return true;
  }
  return false;
}

/** @private An all-NaN table for degenerate boundaries (empty tracks). */
function emptyTable(n, speedSeries) {
  return {
    count: n,
    hr: new Float64Array(n).fill(NaN),
    power: new Float64Array(n).fill(NaN),
    cad: new Float64Array(n).fill(NaN),
    temp: new Float64Array(n).fill(NaN),
    grade: new Float64Array(n).fill(NaN),
    ele: new Float64Array(n).fill(NaN),
    speed: new Float64Array(n).fill(NaN),
    pace: new Float64Array(n).fill(NaN),
    gap: new Float64Array(n).fill(NaN),
    hasSpeed: speedSeries != null,
    hasGap: speedSeries != null,
  };
}

/**
 * @private The panel's Maximum Speed series for the sector — a line-for-line
 * mirror of maxCleanedPointSpeed's construction over [start.i, end.i]:
 * collect recorded speeds, fill the gaps from the leaving segment's dd/dt
 * (never the track's last point), cross-check device readings against the
 * concurrent segment movement (drift readings drop to NaN), then clean by
 * the GLOBAL source rule (any recorded speed → 5-point sliding window; none
 * → 3σ with interpolation). The smoothing window is RANGE-LOCAL, exactly
 * like the panel's figure — so the chart's fastest plotted speed IS the
 * panel's Maximum Speed for the same range. Returns null when the track has
 * neither recorded speeds nor timestamps.
 */
function sectorSpeedSeries(track, start, end, hasRecorded) {
  if (!hasRecorded && !track.hasTime) return null;
  const { points, cumDist } = track;
  const from = start.i;
  const n = end.i - from + 1;
  const speeds = new Float64Array(n).fill(NaN);
  const fromDevice = new Uint8Array(n); // 1 = the value came from the device
  let recorded = 0;
  for (let k = 0; k < n; k++) {
    const s = points[from + k].speed;
    if (s != null && Number.isFinite(s) && s >= 0) { speeds[k] = s; fromDevice[k] = 1; recorded++; }
  }
  if (recorded < n && track.hasTime) {
    for (let k = 0; k < n; k++) {
      const i = from + k;
      if (Number.isFinite(speeds[k]) || i >= track.pointCount - 1) continue;
      const dt = (points[i + 1].time - points[i].time) / 1000;
      const dd = cumDist[i + 1] - cumDist[i];
      if (dt > 0 && dd >= 0) speeds[k] = dd / dt;
    }
  }
  if (hasRecorded && track.hasTime) {
    for (let k = 0; k < n - 1; k++) {
      if (!fromDevice[k]) continue;
      const dt = (points[from + k + 1].time - points[from + k].time) / 1000;
      const dd = cumDist[from + k + 1] - cumDist[from + k];
      if (recordedSpeedImplausible(speeds[k], dd, dt)) speeds[k] = NaN;
    }
  }
  const cleaned = hasRecorded
    ? cleanSpeedSeries(speeds)
    : cleanComputedSpeeds(speeds);
  return cleaned;
}

/**
 * @private The metrics' pause walk over the sector, replicated step for
 * step (computeSectorMetrics): interpolated start/end boundaries, points
 * start.i+1..end.i, then the final step to the end boundary. Only timed
 * segments (dt > 0) reach the tracker, whose confirmed spans land in
 * `spans` — the exact spans pauseFreeSamples strips the panel's fitness
 * statistics with.
 */
function sectorPauseSpans(track, start, end) {
  if (!track.hasTime) return null;
  const pause = createPauseTracker();
  const { points, cumDist } = track;
  let prevDist = start.dist;
  let prevTime = start.time;
  const stepTime = (toDist, toTime) => {
    if (prevTime != null && toTime != null) {
      const dt = (toTime - prevTime) / 1000;
      const segH = Math.max(0, toDist - prevDist);
      if (dt > 0) pause.step(segH, dt, prevTime, toTime, 0);
    }
    prevDist = toDist;
    prevTime = toTime;
  };
  for (let k = start.i + 1; k <= end.i; k++) stepTime(cumDist[k], points[k].time);
  stepTime(end.dist, end.time);
  return pause.spans;
}

/**
 * @private The panel's fitness-series mechanism (sectorMetrics) for one
 * sensor: collect the sector's finite readings (k = start.i..end.i, the
 * same collection loop as computeSectorMetrics), strip the ones whose
 * timestamp sits inside a confirmed pause (the same predicate as
 * pauseFreeSamples — timestamp-less readings pass), then smooth the
 * survivors with the shared 5-point sliding window over the compact
 * survivor list — exactly the array windowedStats' avg/max run over.
 * Cleaned values scatter back onto point indices; stripped or missing
 * readings stay NaN.
 */
function panelFitnessSeries(track, key, start, end, pauseSpans) {
  const out = new Float64Array(track.pointCount).fill(NaN);
  const idx = [];
  const vals = [];
  for (let k = start.i; k <= end.i; k++) {
    const v = track.points[k][key];
    if (v == null || !Number.isFinite(v)) continue;
    const t = track.points[k].time;
    if (pauseSpans && t != null && isInsidePause(pauseSpans, t)) continue;
    idx.push(k);
    vals.push(v);
  }
  const cleaned = cleanSpeedSeries(vals);
  for (let m = 0; m < idx.length; m++) out[idx[m]] = cleaned[m];
  return out;
}

/**
 * @private The panel's gradient-window mechanism (computeSectorMetrics):
 * horizontal meters pile up until GRADIENT_WINDOW_M (50 m), then the
 * window's rise/run grade lands on its closing point and the next window
 * starts there; a trailing partial window counts once it reaches
 * GRADIENT_MIN_WINDOW_M (20 m) and lands on the sector's last point. The
 * walk covers the same interpolated-boundary steps as the metrics, so the
 * finite values are exactly the set the panel's maxGrade/minGrade run over
 * — the chart's steepest plotted grade is the panel's Maximum Grade.
 * Segments with a missing endpoint elevation never advance a window (the
 * metrics' dEle gate).
 */
function sectorGradeWindows(track, start, end) {
  const n = track.pointCount;
  const out = new Float64Array(n).fill(NaN);
  if (!track.hasElevation) return out;
  const { points, cumDist } = track;
  let winAcc = 0;
  let winEle = Number.isFinite(start.ele) ? start.ele : null;
  let prevDist = start.dist;
  let prevEle = start.ele;
  const stepEle = (closeIdx, toDist, toEle) => {
    if (isFiniteNum(prevEle) && isFiniteNum(toEle)) {
      if (winEle == null) winEle = prevEle; // leading elevation gap: windows open late
      const segH = Math.max(0, toDist - prevDist);
      winAcc += segH;
      if (winAcc >= GRADIENT_WINDOW_M) {
        out[closeIdx] = (toEle - winEle) / winAcc;
        winAcc = 0;
        winEle = toEle;
      }
    }
    prevDist = toDist;
    prevEle = toEle;
  };
  for (let k = start.i + 1; k <= end.i; k++) stepEle(k, cumDist[k], points[k].ele);
  stepEle(end.i, end.dist, end.ele);
  if (winAcc >= GRADIENT_MIN_WINDOW_M && winEle != null && isFiniteNum(end.ele)) {
    out[end.i] = (end.ele - winEle) / winAcc;
  }
  return out;
}

/** @private */
function isFiniteNum(v) {
  return v != null && Number.isFinite(v);
}

/**
 * @private Whether a timestamp falls inside a confirmed pause — the SAME
 * predicate as the metrics' pauseFreeSamples: exclusive of the last moving
 * instant (t0), inclusive of the pause end (t1). Binary search over the
 * span starts keeps 100k-point tracks at O(n log m).
 */
function isInsidePause(spans, t) {
  let lo = 0;
  let hi = spans.length - 1;
  let hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid][0] <= t) { hit = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return hit >= 0 && t > spans[hit][0] && t <= spans[hit][1];
}
