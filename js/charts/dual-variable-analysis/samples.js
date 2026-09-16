/**
 * Dual-variable analysis — the data layer.
 *
 * Turns a track into the module's ONE filtered sample table (pure functions,
 * no DOM): every surviving track point becomes a row of aligned Float64Arrays,
 * one per physical quantity, NaN where that quantity is missing. Future
 * statistics or exports can consume the same table.
 *
 * Pipeline (the spec's data-layer order, run over the WHOLE track — the
 * analysis reads the track, not the current sector):
 *
 *   track points
 *     → pause filtering        (the shared createPauseTracker state machine,
 *                               same 10 s / 0.5 km/h rule as the metrics —
 *                               never a module-local pause detection)
 *     → invalid power filter   (speed > 0 with no positive power reading,
 *                               only when the track carries a power meter)
 *     → invalid cadence filter (speed > 0 with no positive cadence reading,
 *                               only when the track carries a cadence sensor)
 *     → valid analysis samples
 *
 * Speed / pace / GAP values come from the elevation profile's buildCaches —
 * THE shared speed pipeline (recorded speeds cross-checked against dd/dt then
 * smoothed, fully computed series 3σ-cleaned). This module never re-derives
 * a competing speed. Grade is the raw per-segment vertical/horizontal ratio:
 * the spec's first version adds no cleaning beyond the explicit rules above.
 *
 * Pair extraction (extractPair) is where §11 applies: a row whose X or Y is
 * not finite can never enter the density computation — no zero-filling, no
 * forward-filling, no interpolation.
 */
import { buildCaches, speedToPace } from '../elevation-profile/profile-data.js';
import { createPauseTracker } from '../../metrics/sectorMetrics.js';

/**
 * Per-quantity readers over the sample table. Segment-attached series
 * (speed, pace, GAP, grade) live at the index of their segment's FIRST
 * point — the same convention buildCaches uses, so a reading at row i pairs
 * with the effort of the stretch leaving point i.
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
 * Builds the filtered sample table for a track.
 * @param {import('../../types.js').Track} track
 * @returns {{count: number, hr: Float64Array, power: Float64Array,
 *   cad: Float64Array, temp: Float64Array, grade: Float64Array,
 *   ele: Float64Array, speed: Float64Array, pace: Float64Array,
 *   gap: Float64Array, hasSpeed: boolean, hasGap: boolean}}
 */
export function buildAnalysisSamples(track) {
  const n = track.pointCount;
  const { points, cumDist } = track;

  // The shared speed caches (m/s): recorded → dd/dt cross-check + 5-point
  // window; none → derived + 3σ clean. null when the track has neither
  // recorded speeds nor timestamps.
  const caches = buildCaches(track, 'distance');
  const speeds = caches.speeds;
  const gapSpeeds = caches.gapSpeeds;

  // Raw per-segment grade (fraction): rise over run of segment i → i+1.
  const grades = new Float64Array(n).fill(NaN);
  if (track.hasElevation) {
    for (let i = 0; i < n - 1; i++) {
      const dd = cumDist[i + 1] - cumDist[i];
      const dz = points[i + 1].ele - points[i].ele;
      if (dd > 0 && Number.isFinite(dz)) grades[i] = dz / dd;
    }
  }

  // Pause spans over the whole track — the same streaming state machine the
  // sector metrics run, fed one timed segment at a time. Untimed segments
  // never reach it (dt <= 0, mirroring computeSectorMetrics).
  const pauseSpans = collectPauseSpans(track);

  // The three exclusion rules, in the pipeline order. Survival is decided
  // per point index; the survivors form the table rows.
  const keep = new Uint32Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) {
    const t = points[i].time;
    if (pauseSpans && t != null && isInsidePause(pauseSpans, t)) continue;
    const spd = speeds ? speeds[i] : NaN;
    const moving = Number.isFinite(spd) && spd > 0;
    if (moving && track.hasPower) {
      const p = points[i].power;
      // Coasting or sensor dropout: forward motion with no positive power
      // reading says the reading is unusable for effort analysis.
      if (!(p != null && Number.isFinite(p) && p > 0)) continue;
    }
    if (moving && track.hasCad) {
      const c = points[i].cad;
      if (!(c != null && Number.isFinite(c) && c > 0)) continue;
    }
    keep[count++] = i;
  }

  const hr = new Float64Array(count);
  const power = new Float64Array(count);
  const cad = new Float64Array(count);
  const temp = new Float64Array(count);
  const grade = new Float64Array(count);
  const ele = new Float64Array(count);
  const speed = new Float64Array(count);
  const pace = new Float64Array(count);
  const gap = new Float64Array(count);
  for (let r = 0; r < count; r++) {
    const p = points[keep[r]];
    const i = keep[r];
    hr[r] = finiteOrNaN(p.hr);
    power[r] = finiteOrNaN(p.power);
    cad[r] = finiteOrNaN(p.cad);
    temp[r] = finiteOrNaN(p.temp);
    ele[r] = track.hasElevation ? p.ele : NaN;
    grade[r] = grades[i];
    speed[r] = speeds ? speeds[i] : NaN;
    pace[r] = speedToPace(speed[r]);
    gap[r] = speedToPace(gapSpeeds ? gapSpeeds[i] : NaN);
  }

  return {
    count,
    hr, power, cad, temp, grade, ele, speed, pace, gap,
    hasSpeed: speeds != null,
    hasGap: gapSpeeds != null,
  };
}

/**
 * Availability of each physical quantity on the FILTERED table — a series
 * that lost every reading to the filters is as unusable as one the file
 * never carried. `reasonKey` names the language key explaining the miss.
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

/** @private Runs the shared pause tracker over the whole track. */
function collectPauseSpans(track) {
  if (!track.hasTime || track.pointCount < 2) return null;
  const pause = createPauseTracker();
  const { points, cumDist } = track;
  for (let i = 1; i < track.pointCount; i++) {
    const dt = (points[i].time - points[i - 1].time) / 1000;
    if (!(dt > 0)) continue;
    pause.step(cumDist[i] - cumDist[i - 1], dt, points[i - 1].time, points[i].time, i);
  }
  return pause.spans;
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
