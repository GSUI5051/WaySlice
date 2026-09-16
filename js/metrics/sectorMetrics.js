/**
 * Sector metrics — the mathematical core of WaySlice.
 *
 * Pure functions, no DOM access, so every result is independently testable.
 * Given a distance range along the track (boundaries may sit between two
 * track points), this computes distance, elevation, gradient and time
 * statistics. Missing input data yields `null` metrics — never 0 and never a
 * fabricated value.
 */
import { pointAtDistance } from '../geo/interpolate.js';
import { segment3D } from '../geo/distance.js';

/** Window length for max/min gradient, meters. */
export const GRADIENT_WINDOW_M = 50;
/** Minimum length of a trailing (partial) gradient window, meters. */
const GRADIENT_MIN_WINDOW_M = 20;
/**
 * Elevation hysteresis threshold, meters. Elevation change accumulates in a
 * residual until it passes ±3 m; only then is it credited to gain/loss.
 * Sub-threshold wiggle (GPS/barometric noise, switchback drift) is treated
 * as noise and never inflates the totals.
 */
export const ELEVATION_THRESHOLD_M = 3;
/** Speed below which a segment counts as "stopped", km/h. */
export const MOVING_SPEED_KMH = 0.5;
/** Same threshold converted to m/s, the unit of the per-segment comparison. */
const MOVING_SPEED_MPS = MOVING_SPEED_KMH / 3.6;
/** A stop shorter than this is movement, not a pause, seconds. */
export const PAUSE_MIN_S = 10;

/** Pause-tracker step outcomes (see createPauseTracker). */
export const PAUSE_MOVING = 0;    // segment is movement; paused seconds may ride in pause.credit
export const PAUSE_TENTATIVE = 1; // sub-threshold stop, not yet confirmed as a pause
export const PAUSE_CONFIRMED = 2; // the tentative stop just grew into a confirmed pause
export const PAUSE_PAUSED = 3;    // inside a confirmed pause

/**
 * Streaming pause detector — the single source of the 10 s state machine
 * (speed < 0.5 km/h sustained ≥ 10 s) shared by the sector metrics and the
 * heart-rate zone statistics. Confirmed pauses are accumulated in `spans`
 * as [tStartMs, tEndMs]; a stop that never reaches the threshold stays
 * movement and its seconds are reported through step()'s credit or finish().
 *
 * `mark` bookkeeping is the caller's rollback index (the metrics' speeds[]
 * length at the moment the tentative stop began): pass the current mark on
 * every step and read it back on PAUSE_CONFIRMED.
 *
 * @returns {{spans: [number, number][], credit: number, mark: number,
 *   inPause: boolean, stopped: number, step: Function, finish: Function}}
 */
export function createPauseTracker() {
  let stopped = 0;      // seconds below the speed threshold in the current stretch
  let inPause = false;  // the stretch has lasted long enough to count as a pause
  let pendingT0 = 0;    // time the current tentative stop began, ms
  let mark = -1;        // caller mark captured when the tentative stop began
  let credit = 0;       // moving seconds to log for the last step()
  let confirmMark = -1; // mark to roll back to, valid on the PAUSE_CONFIRMED step
  const spans = [];
  return {
    spans,
    get credit() { return credit; },
    get mark() { return confirmMark; },
    get inPause() { return inPause; },
    get stopped() { return stopped; },
    /**
     * Feeds one timed segment. Returns a PAUSE_* status; when it is
     * PAUSE_MOVING, `credit` holds the moving seconds (the segment's own dt
     * plus any tentative-stop seconds rolled back now that movement resumed).
     */
    step(segH, dt, prevTime, toTime, markNow) {
      credit = 0;
      confirmMark = -1;
      const speed = segH / dt;
      if (speed >= MOVING_SPEED_MPS) {
        credit = inPause ? dt : dt + stopped;
        stopped = 0;
        inPause = false;
        mark = -1;
        return PAUSE_MOVING;
      }
      if (!inPause) {
        if (mark < 0) {
          mark = markNow;
          pendingT0 = prevTime;
        }
        stopped += dt;
        if (stopped >= PAUSE_MIN_S) {
          inPause = true;
          spans.push([pendingT0, toTime]);
          confirmMark = mark;
          mark = -1;
          return PAUSE_CONFIRMED;
        }
        return PAUSE_TENTATIVE;
      }
      spans[spans.length - 1][1] = toTime;
      return PAUSE_PAUSED;
    },
    /** Seconds of a trailing stop that never reached the pause threshold. */
    finish() {
      return inPause ? 0 : stopped;
    },
  };
}
/**
 * Speed outlier cutoff in standard deviations — the cleaning rule for the
 * speed/pace/GAP statistics when a track has no recorded speeds at all (a
 * fully computed series treats segments beyond μ ± 3σ as GPS spikes and
 * excludes them). A track with recorded speeds cleans the same statistics
 * with the 5-point sliding-window smooth instead (cleanSpeedSeries), like
 * the profile curve and the maximum speed.
 */
export const SPEED_OUTLIER_SIGMAS = 3;
/** Width of the speed smoothing window (cleanSpeedSeries), in points. */
export const SPEED_WINDOW_POINTS = 5;
/**
 * Recorded speeds are cross-checked against the concurrent dd/dt (the same
 * segment's movement): a reading exceeding dd/dt by more than this factor
 * disagrees with the positions and is treated as GPS drift — dropped, and
 * the 5-point window then fills the hole from the trusted neighbors.
 */
export const SPEED_CROSSCHECK_RATIO = 1.5;
/** Length of the fastest/slowest sliding pace window, meters. */
export const PACE_WINDOW_M = 1000;

/**
 * Minetti et al. (2002) energy-cost polynomial for running, normalized so
 * flat ground costs 1: C(g) = C(g)/3.6 with g the slope as a fraction.
 * Multiply a slope's pace by 1/C (or divide its speed by C) to get the
 * flat-ground-equivalent pace. The polynomial is only meaningful on
 * moderate grades — clamped to ±45%, past which it diverges.
 * @param {number} grade  slope as a fraction (0.06 = 6 %)
 * @returns {number} correction factor, 1 on flat ground
 */
export function minettiFactor(grade) {
  const g = Math.min(0.45, Math.max(-0.45, grade));
  const cost =
    155.4 * g ** 5 - 30.4 * g ** 4 - 43.3 * g ** 3 +
    46.3 * g ** 2 + 19.5 * g + 3.6;
  return cost / 3.6;
}

/**
 * Computes all metrics for [startDist, endDist] along the track.
 *
 * @param {import('../types.js').Track} track
 * @param {number} startDist  meters
 * @param {number} endDist    meters (>= startDist after clamping)
 * @returns {import('../types.js').SectorMetrics}
 */
export function computeSectorMetrics(track, startDist, endDist) {
  const total = track.totalDistance;
  const s = Math.min(Math.max(startDist, 0), total);
  const e = Math.min(Math.max(endDist, s), total);

  const start = pointAtDistance(track, s);
  const end = pointAtDistance(track, e);
  const horizontalDistance = e - s;

  /** @type {import('../types.js').SectorMetrics} */
  const m = {
    horizontalDistance,
    distance3D: null,
    effortDistance: null,
    gain: null,
    loss: null,
    eleStart: null,
    eleEnd: null,
    eleMin: null,
    eleMax: null,
    netElevation: null,
    avgGrade: null,
    maxGrade: null,
    minGrade: null,
    elapsed: null,
    moving: null,
    avgSpeed: null,
    avgPace: null,
    avgGap: null,
    maxSpeed: null,
    vam: null,
    vdm: null,
    avgHr: null,
    maxHr: null,
    avgCad: null,
    maxCad: null,
    avgPower: null,
    maxPower: null,
    avgTemp: null,
    minTemp: null,
    maxTemp: null,
    fastestKm: null,
    slowestKm: null,
    timeStart: null,
    timeEnd: null,
  };
  if (!start || !end) return m;

  const { points } = track;
  const hasEle = track.hasElevation;
  const hasTime = track.hasTime;

  m.eleStart = hasEle ? start.ele : null;
  m.eleEnd = hasEle ? end.ele : null;

  // Fitness series: heart rate, cadence, power and temperature are collected
  // over the sector points that carry them (sensor dropouts must not void
  // the series). Readings carry their timestamp so hr/cad/power can later be
  // stripped of pause seconds — a resting value says nothing about the
  // effort — before the shared 5 s sliding-window smooth. Temperature skips
  // the pause strip and every filter: an ambient reading is not an effort
  // signal and is shown as recorded.
  const hrSamples = [], cadSamples = [], powerSamples = [], tempSamples = [];
  for (let k = start.i; k <= end.i; k++) {
    const p = points[k];
    if (p.hr != null && Number.isFinite(p.hr)) hrSamples.push({ v: p.hr, t: p.time });
    if (p.cad != null && Number.isFinite(p.cad)) cadSamples.push({ v: p.cad, t: p.time });
    if (p.power != null && Number.isFinite(p.power)) powerSamples.push({ v: p.power, t: p.time });
    if (p.temp != null && Number.isFinite(p.temp)) tempSamples.push({ v: p.temp, t: p.time });
  }

  // Walk the points covered by the sector once, accumulating everything that
  // depends on consecutive segments: 3D distance, gain/loss, gradients and
  // moving time / max speed. Partial first/last segments use the interpolated
  // boundary values. Positions are tracked as explicit distance scalars so
  // interpolated boundaries and raw points need no special casing.
  let dist3D = 0;
  let gain = 0, loss = 0;
  let residual = 0;        // elevation change accumulated toward the ±3 m threshold
  let trend = 0;           // sign of the filtered elevation trend over the segment just stepped
  let climbTime = 0;       // seconds spent with a rising filtered elevation trend
  let descendTime = 0;     // seconds spent with a falling filtered elevation trend
  let winAcc = 0;          // horizontal meters accumulated in current gradient window
  let winEle = hasEle ? start.ele : 0;
  let maxGrade = -Infinity, minGrade = Infinity;
  let moving = 0;
  const pause = createPauseTracker(); // shared 10 s pause state machine
  const pauseSpans = pause.spans;
  const speeds = [];    // per-segment moving speeds (confirmed-pause seconds removed)
  const effortPaces = []; // per-segment GAP pace (s/km), same segments as speeds[]
  let pendingClimb = 0;   // trend-rising seconds in the current tentative stop
  let pendingDescend = 0; // trend-falling seconds in the current tentative stop

  let prevDist = start.dist;
  let prevEle = start.ele;
  let prevTime = start.time;
  for (let k = start.i + 1; k <= end.i; k++) {
    const p = points[k];
    step(track.cumDist[k], p.ele, p.time);
  }
  step(end.dist, end.ele, end.time);
  // Trailing stop: only a stop that reaches PAUSE_MIN_S stays excluded.
  if (!pause.inPause) {
    moving += pause.stopped;
    climbTime += pendingClimb;
    descendTime += pendingDescend;
  }

  // Pause-aware fitness statistics: hr/cad/power readings taken during a
  // confirmed pause are dropped, then the survivors are smoothed by the
  // shared 5 s sliding window before the statistics run. Temperature gets
  // no pause strip and no filter at all.
  const hr = windowedStats(pauseFreeSamples(hrSamples, pauseSpans));
  const cad = windowedStats(pauseFreeSamples(cadSamples, pauseSpans));
  const power = windowedStats(pauseFreeSamples(powerSamples, pauseSpans));
  const temp = rawStats(tempSamples.map((s) => s.v));
  if (hr) { m.avgHr = hr.avg; m.maxHr = hr.max; }
  if (cad) { m.avgCad = cad.avg; m.maxCad = cad.max; }
  if (power) { m.avgPower = power.avg; m.maxPower = power.max; }
  if (temp) { m.avgTemp = temp.avg; m.minTemp = temp.min; m.maxTemp = temp.max; }

  if (hasEle) {
    // Trailing partial window, if it is long enough to be meaningful.
    if (winAcc >= GRADIENT_MIN_WINDOW_M) {
      const grade = (end.ele - winEle) / winAcc;
      if (grade > maxGrade) maxGrade = grade;
      if (grade < minGrade) minGrade = grade;
    }
    m.distance3D = dist3D;
    m.gain = gain;
    m.loss = loss;
    m.eleMin = Math.min(start.ele, end.ele);
    m.eleMax = Math.max(start.ele, end.ele);
    for (let k = start.i; k <= end.i; k++) {
      const ele = points[k].ele;
      if (ele < m.eleMin) m.eleMin = ele;
      if (ele > m.eleMax) m.eleMax = ele;
    }
    m.netElevation = m.eleEnd - m.eleStart;
    // Average grade = accumulated ascent over horizontal distance. A sector
    // that only descends has no ascent to average and reports null (the
    // unavailable marker) rather than a negative net figure; a flat sector
    // averages 0.
    m.avgGrade = horizontalDistance > 0 && !(m.gain === 0 && m.loss > 0)
      ? m.gain / horizontalDistance
      : null;
    // Effort distance: ascent is credited at 100 m per km of distance
    // (effort km = distance km + gain m ÷ 100; gain × 10 converts to meters).
    m.effortDistance = horizontalDistance + m.gain * 10;
    if (Number.isFinite(maxGrade)) m.maxGrade = maxGrade;
    if (Number.isFinite(minGrade)) m.minGrade = minGrade;
  }

  // The speed-family cleaning rule is decided by the track's SOURCE — the
  // same global predicate the profile caches use: any recorded speed
  // anywhere → the 5 s sliding-window smooth; none → the ±3σ exclusion.
  const hasRecordedSpeed = trackHasRecordedSpeed(track);
  // Maximum speed reads the same cleaned per-point series the elevation
  // profile's speed curve draws (recorded or derived), so the list can never
  // disagree with the chart. Independent of hasTime: recorded speeds alone
  // are enough.
  const maxSpd = maxCleanedPointSpeed(track, start.i, end.i, hasRecordedSpeed);
  if (maxSpd != null && maxSpd > 0) m.maxSpeed = maxSpd;

  if (hasTime) {
    m.timeStart = start.time;
    m.timeEnd = end.time;
    m.moving = moving > 0 ? moving : null;
    const elapsed = (end.time - start.time) / 1000;
    if (elapsed > 0) m.elapsed = elapsed;
    applySpeedStats(m, speeds, hasRecordedSpeed);
    applyGAPStats(m, effortPaces, hasRecordedSpeed);    // VAM: gain per hour of time actually spent climbing; VDM mirrors it for
    // the descent. Flat, counter-slope and paused seconds are excluded, so a
    // long flat stretch or a rest stop no longer dilutes the vertical rate.
    if (climbTime > 0 && m.gain != null && m.gain > 0) {
      m.vam = m.gain / (climbTime / 3600);
    }
    if (descendTime > 0 && m.loss != null && m.loss > 0) {
      m.vdm = m.loss / (descendTime / 3600);
    }
    if (horizontalDistance >= PACE_WINDOW_M && elapsed > 0) {
      const { fastest, slowest } = paceWindows(track, start, end, pauseSpans);
      m.fastestKm = fastest;
      m.slowestKm = slowest;
    }
  }

  return m;

  /**
   * @private Accumulates one segment, from the previous position to the
   * position at `toDist` (meters along the track).
   */
  function step(toDist, toEle, toTime) {
    const segH = Math.max(0, toDist - prevDist);
    const dEle = hasEle && prevEle != null && toEle != null ? toEle - prevEle : null;
    const dt = hasTime && prevTime != null && toTime != null
      ? (toTime - prevTime) / 1000
      : null;
    if (dEle != null) {
      dist3D += segment3D(segH, dEle);
      // Hysteresis filter: elevation change piles up in the residual and is
      // only credited once it passes ±3 m, so small-scale noise cancels out.
      residual += dEle;
      if (residual > ELEVATION_THRESHOLD_M) {
        gain += residual;
        residual = 0;
        trend = 1;
      } else if (residual < -ELEVATION_THRESHOLD_M) {
        loss -= residual;
        residual = 0;
        trend = -1;
      } else {
        trend = Math.sign(residual);
      }
      winAcc += segH;
      if (winAcc >= GRADIENT_WINDOW_M) {
        const grade = (toEle - winEle) / winAcc;
        if (grade > maxGrade) maxGrade = grade;
        if (grade < minGrade) minGrade = grade;
        winAcc = 0;
        winEle = toEle;
      }
    }
    if (dt != null && dt > 0) {
      // Time spent actually climbing/descending follows the filtered
      // elevation trend, so flat and counter-slope seconds do not dilute
      // VAM/VDM. Pause seconds are excluded too: trend time inside a
      // tentative stop accumulates in the pending buckets and is only
      // credited if the stop turns out to be movement.
      const climbDt = trend > 0 ? dt : 0;
      const descendDt = trend < 0 ? dt : 0;
      const speed = segH / dt;
      // GAP pace for the segment: its pace divided by the Minetti slope
      // factor — the flat-ground pace at the same effort.
      const gapPace = hasEle && dEle != null && segH > 0
        ? (dt / segH) * 1000 / minettiFactor(dEle / segH)
        : null;
      const status = pause.step(segH, dt, prevTime, toTime, speeds.length);
      if (status === PAUSE_MOVING) {
        // Sub-threshold dips are absorbed into the movement; a confirmed
        // pause keeps its own seconds excluded, then movement resumes.
        moving += pause.credit;
        climbTime += climbDt + pendingClimb;
        descendTime += descendDt + pendingDescend;
        pendingClimb = 0;
        pendingDescend = 0;
        speeds.push(speed);
        if (gapPace != null) {
          effortPaces.push(gapPace);
        }
      } else if (status === PAUSE_TENTATIVE) {
        // Sub-threshold stretch: tentatively keep it (a brief crawl is
        // movement); if it grows into a confirmed pause, roll it back out.
        pendingClimb += climbDt;
        pendingDescend += descendDt;
      } else if (status === PAUSE_CONFIRMED) {
        speeds.length = pause.mark;
        effortPaces.length = pause.mark;
        pendingClimb = 0;
        pendingDescend = 0;
      } else {
        // Still inside the confirmed pause: extend its time span.
      }
    }
    prevDist = toDist;
    prevEle = toEle;
    prevTime = toTime;
  }
}

/**
 * @private The subset of `values` within μ ± SPEED_OUTLIER_SIGMAS·σ of the
 * set — GPS spikes and sensor glitches never survive. A constant set (σ = 0)
 * is returned unchanged. Now the fallback cleaner only: the speed/GAP
 * statistics when the track has no recorded speeds.
 */
function withinThreeSigmas(values) {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / values.length;
  const sigma = Math.sqrt(variance);
  if (sigma === 0) return values.slice();
  return values.filter((v) => Math.abs(v - mean) <= SPEED_OUTLIER_SIGMAS * sigma);
}

/**
 * 3σ spike cleaning for a fully COMPUTED speed series (a track without
 * recorded speeds derives every value from position deltas, so a single GPS
 * position jump plots as an absurd speed spike). Values beyond
 * μ ± SPEED_OUTLIER_SIGMAS·σ are replaced by the value linearly interpolated
 * from the nearest kept neighbors — a leading/trailing outlier takes the
 * inner neighbor's value. NaN gaps and kept values pass through untouched;
 * the input is not mutated.
 * @param {Float64Array} speeds  per-point speed (m/s), NaN where unavailable
 * @returns {Float64Array} cleaned copy
 */
export function cleanComputedSpeeds(speeds) {
  const out = Float64Array.from(speeds);
  const idx = [];
  const vals = [];
  for (let i = 0; i < speeds.length; i++) {
    if (Number.isFinite(speeds[i])) { idx.push(i); vals.push(speeds[i]); }
  }
  if (vals.length < 3) return out;
  const mean = vals.reduce((sum, v) => sum + v, 0) / vals.length;
  const variance =
    vals.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / vals.length;
  const sigma = Math.sqrt(variance);
  if (sigma === 0) return out;
  const limit = SPEED_OUTLIER_SIGMAS * sigma;

  // μ and σ come from the raw set (filter semantics identical to
  // withinThreeSigmas above). At least one point always survives — μ lies
  // inside the value set, so not every point can sit beyond 3σ.
  let lastKept = -1;
  for (let k = 0; k < idx.length; k++) {
    if (Math.abs(vals[k] - mean) <= limit) { lastKept = k; continue; }
    let nextKept = -1;
    for (let j = k + 1; j < idx.length; j++) {
      if (Math.abs(vals[j] - mean) <= limit) { nextKept = j; break; }
    }
    const vL = lastKept >= 0 ? vals[lastKept] : null;
    const vR = nextKept >= 0 ? vals[nextKept] : null;
    if (vL == null) out[idx[k]] = vR;
    else if (vR == null) out[idx[k]] = vL;
    else {
      const t = (idx[k] - idx[lastKept]) / (idx[nextKept] - idx[lastKept]);
      out[idx[k]] = vL + (vR - vL) * t;
    }
  }
  return out;
}

/**
 * 5-point sliding-window smoothing for a RECORDED speed series — and the
 * shared cleaner for every per-point/per-segment series that follows the
 * same rule (the panel's speed/GAP segments and the hr/cad/power readings).
 * Device-recorded values carry glitches (sensor dropouts, GPS position
 * jumps), so every cleaned series draws from a smoothed one: each point
 * becomes the mean of the finite values among itself and its two nearest
 * neighbors on each side — a centered 5-point window. The window is counted
 * in POINTS, not seconds, so low-frequency tracks dilute their glitches
 * exactly like dense ones. Rest-stop zeros are data like any other value
 * and take part in the mean. NaN points are FILLED from the finite values
 * inside their window (that is how dropped glitch readings re-enter the
 * series); a window with no finite value at all stays NaN. The input is
 * not mutated.
 * @param {Float64Array|number[]} speeds  per-point values (m/s for the speed
 *   family; any consistent unit elsewhere), NaN where unavailable
 * @returns {Float64Array} smoothed copy
 */
export function cleanSpeedSeries(speeds) {
  const out = new Float64Array(speeds.length).fill(NaN);
  const reach = Math.floor(SPEED_WINDOW_POINTS / 2);
  for (let i = 0; i < speeds.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - reach); j <= Math.min(speeds.length - 1, i + reach); j++) {
      if (Number.isFinite(speeds[j])) { sum += speeds[j]; count++; }
    }
    out[i] = count > 0 ? sum / count : speeds[i];
  }
  return out;
}

/**
 * @private Plain mean / min / max of the temperature readings — no pause
 * strip, no outlier filter of any kind: an ambient reading is not an
 * effort signal and has no spikes worth cutting. Returns null for an
 * empty set.
 */
function rawStats(values) {
  if (!values.length) return null;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { avg: sum / values.length, min, max };
}

/**
 * @private Speed statistics from the sector's per-segment moving speeds.
 * The cleaning rule follows the track's SOURCE (the same global predicate
 * the profile caches and maxCleanedPointSpeed use). With recorded speeds
 * the set is diluted by the 5-point sliding window; a fully computed series
 * (no recorded speeds anywhere) instead gets the ±3σ exclusion. Average
 * speed is the mean of the cleaned set, average pace its per-km inverse.
 * @param {number[]} speeds  per-segment moving speed (m/s)
 * @param {boolean} hasRecorded  whether the track has any recorded speed
 */
function applySpeedStats(m, speeds, hasRecorded) {
  if (!speeds.length) return;
  const cleaned = hasRecorded ? cleanSpeedSeries(speeds) : withinThreeSigmas(speeds);
  let sum = 0;
  let count = 0;
  for (const v of cleaned) {
    if (Number.isFinite(v)) { sum += v; count++; }
  }
  if (!count) return;
  const avg = sum / count;
  if (avg > 0) {
    m.avgSpeed = avg;
    m.avgPace = 1000 / avg; // seconds per km, same cleaned set as avgSpeed
  }
}

/**
 * @private Cross-checks one device-recorded speed against what the
 * concurrent segment movement supports: a reading more than
 * SPEED_CROSSCHECK_RATIO × dd/dt disagrees with the positions and is
 * treated as GPS drift.
 * @param {number} speed  recorded speed (m/s)
 * @param {number} dd  segment distance (m)
 * @param {number} dt  segment duration (s)
 * @returns {boolean} true when the reading must be dropped
 */
export function recordedSpeedImplausible(speed, dd, dt) {
  return dt > 0 && dd >= 0 && speed > SPEED_CROSSCHECK_RATIO * (dd / dt);
}

/**
 * @private True when ANY point of the track carries a recorded speed — the
 * global source predicate behind the speed-family cleaning rule (recorded
 * → cross-check against dd/dt, then the 5-point sliding-window smooth;
 * none → the ±3σ exclusion), shared by the profile caches (buildCaches),
 * the maximum speed and the panel's speed/GAP statistics.
 */
function trackHasRecordedSpeed(track) {
  for (let i = 0; i < track.pointCount; i++) {
    const s = track.points[i].speed;
    if (s != null && Number.isFinite(s) && s >= 0) return true;
  }
  return false;
}

/**
 * @private Highest per-point speed over [from, to] after the source-based
 * clean — the exact series the elevation profile's speed curve draws, so
 * the metrics list's Maximum Speed always matches the chart. The rule
 * selection is GLOBAL (whole track, mirroring buildCaches): any recorded
 * speed anywhere → recorded readings are cross-checked against the
 * concurrent dd/dt (drift readings dropped) and then smoothed by the
 * 5-point sliding window; none → the series is fully computed and gets
 * the 3σ clean. Returns null when the track has neither recorded speeds
 * nor timestamps.
 * @param {boolean} hasRecorded  the shared trackHasRecordedSpeed result
 */
function maxCleanedPointSpeed(track, from, to, hasRecorded) {
  if (!hasRecorded && !track.hasTime) return null;
  const n = to - from + 1;
  const speeds = new Float64Array(n).fill(NaN);
  const fromDevice = new Uint8Array(n); // 1 = the value came from the device
  let recorded = 0;
  for (let k = 0; k < n; k++) {
    const p = track.points[from + k];
    const s = p.speed;
    if (s != null && Number.isFinite(s) && s >= 0) { speeds[k] = s; fromDevice[k] = 1; recorded++; }
  }
  if (recorded < n && track.hasTime) {
    for (let k = 0; k < n; k++) {
      const i = from + k;
      if (Number.isFinite(speeds[k]) || i >= track.pointCount - 1) continue;
      const dt = (track.points[i + 1].time - track.points[i].time) / 1000;
      const dd = track.cumDist[i + 1] - track.cumDist[i];
      if (dt > 0 && dd >= 0) speeds[k] = dd / dt;
    }
  }
  if (hasRecorded && track.hasTime) {
    // Cross-check the device readings against what the concurrent segment
    // movement supports — GPS drift during pauses reads as absurd speed
    // spikes. Distrusted readings are dropped (NaN); the window then
    // fills the hole from the trusted neighbors.
    for (let k = 0; k < n - 1; k++) {
      if (!fromDevice[k]) continue;
      const dt = (track.points[from + k + 1].time - track.points[from + k].time) / 1000;
      const dd = track.cumDist[from + k + 1] - track.cumDist[from + k];
      if (recordedSpeedImplausible(speeds[k], dd, dt)) speeds[k] = NaN;
    }
  }
  const cleaned = hasRecorded
    ? cleanSpeedSeries(speeds)
    : cleanComputedSpeeds(speeds);
  let max = -Infinity;
  for (let k = 0; k < n; k++) {
    if (Number.isFinite(cleaned[k]) && cleaned[k] > max) max = cleaned[k];
  }
  return Number.isFinite(max) ? max : null;
}

/**
 * @private Average GAP (grade-adjusted) pace: the per-segment effort paces
 * (segment pace ÷ Minetti slope factor) cleaned exactly like the speed
 * statistics — with recorded speeds, the 5-point sliding window; without,
 * only the ±3σ exclusion — then averaged. Needs elevation + timestamps; a
 * sector without either leaves m.avgGap null.
 * @param {number[]} effortPaces  s/km per moving segment
 * @param {boolean} hasRecorded  whether the track has any recorded speed
 */
function applyGAPStats(m, effortPaces, hasRecorded) {
  if (!effortPaces.length) return;
  const cleaned = hasRecorded ? cleanSpeedSeries(effortPaces) : withinThreeSigmas(effortPaces);
  let sum = 0;
  let count = 0;
  for (const v of cleaned) {
    if (Number.isFinite(v)) { sum += v; count++; }
  }
  if (!count) return;
  const avg = sum / count;
  if (avg > 0 && Number.isFinite(avg)) m.avgGap = avg;
}

/**
 * Fastest / slowest sliding `PACE_WINDOW_M` window inside the sector.
 * Windows are ranked by pause-free seconds: confirmed-pause time inside a
 * window is subtracted, so a rest stop can neither win nor lose a window.
 * @private
 */
function paceWindows(track, start, end, pauseSpans) {
  // Build distance/time arrays including the interpolated boundaries.
  const ds = [start.dist];
  const ts = [start.time];
  for (let k = start.i + 1; k <= end.i; k++) {
    ds.push(track.cumDist[k]);
    ts.push(track.points[k].time);
  }
  ds.push(end.dist);
  ts.push(end.time);

  let fastest = null, slowest = null;
  let j = 0;
  for (let i = 0; i < ds.length - 1; i++) {
    if (j < i + 1) j = i + 1;
    const target = ds[i] + PACE_WINDOW_M;
    while (j < ds.length - 1 && ds[j] < target) j++;
    if (j >= ds.length || ds[j] < target) break;
    const span = ds[j] - ds[j - 1];
    const tAtTarget = span > 0
      ? ts[j - 1] + (ts[j] - ts[j - 1]) * ((target - ds[j - 1]) / span)
      : ts[j - 1];
    let windowMs = tAtTarget - ts[i];
    for (const [t0, t1] of pauseSpans) {
      const overlap = Math.min(t1, tAtTarget) - Math.max(t0, ts[i]);
      if (overlap > 0) windowMs -= overlap;
    }
    const windowSec = windowMs / 1000;
    if (!(windowSec > 0)) continue; // clock anomaly — skip
    const pace = windowSec; // pause-free seconds per exactly 1 km
    if (!fastest || pace < fastest.pace) fastest = { pace, dist: target };
    if (!slowest || pace > slowest.pace) slowest = { pace, dist: target };
  }
  return { fastest, slowest };
}

/**
 * @private Strips fitness samples whose timestamp falls inside a confirmed
 * pause — exclusive of the last moving instant (t0), inclusive of the pause
 * end (t1), matching the seconds `moving` excludes. Without pauses, or for
 * points without a timestamp, samples pass through untouched. Returns the
 * surviving {v, t} pairs.
 */
function pauseFreeSamples(samples, pauseSpans) {
  if (!pauseSpans.length) return samples;
  return samples.filter(({ t }) => t == null || !pauseSpans.some(([t0, t1]) => t > t0 && t <= t1));
}

/**
 * @private Mean / max of a fitness sample set after the shared 5-point
 * sliding-window smooth: each pause-free reading becomes the mean of the
 * finite readings among itself and its two nearest neighbors on each side
 * (cleanSpeedSeries — a sensor glitch is diluted into its neighborhood, not
 * cut), then the statistics run over the smoothed set. Returns null for an
 * empty set.
 * @param {{v: number}[]} samples  pause-free readings
 */
function windowedStats(samples) {
  if (!samples.length) return null;
  const cleaned = cleanSpeedSeries(samples.map((s) => s.v));
  let sum = 0;
  let count = 0;
  let max = -Infinity;
  for (const v of cleaned) {
    if (!Number.isFinite(v)) continue;
    sum += v;
    count++;
    if (v > max) max = v;
  }
  return count ? { avg: sum / count, max } : null;
}
