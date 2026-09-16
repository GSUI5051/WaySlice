/**
 * Elevation profile — data definitions and PURE computation.
 *
 * Everything here takes its inputs as parameters and returns new values; no
 * DOM, no canvas, no shared chart state (profile-state.js is not imported).
 * That makes the whole module unit-testable and keeps the sampling math the
 * renderer and the interaction layer both rely on in exactly one place.
 *
 * Contents:
 *   OVERLAY_METRICS / SPEED_FAMILY — the overlay definitions and the
 *     speed/pace/GAP family rule (one series, three views, one slot)
 *   buildCaches       — per-point x + speed caches for a track + axis mode
 *     (the speed series passes the shared cleanRecordedSpeeds from sectorMetrics)
 *   overlayAvailability / overlayValueAt — what can be drawn and how to read it
 *   sampleOverlay / sampleElevation — per-column downsampling for the canvas
 *   seriesExtremes    — full-resolution min/max of a series (no averaging)
 *   distToX / xToDist / clientXtoX — the coordinate conversions every cursor
 *     path and every drawn element must agree on
 *   speedToPace / niceStep / formatOverlayValue — small formatters
 *   applyOverlayToggle — the overlay-slot toggle as a pure transition
 */
import { pointAtDistance } from '../../geo/interpolate.js';
import {
  minettiFactor, cleanSpeedSeries, cleanComputedSpeeds, recordedSpeedImplausible,
} from '../../metrics/sectorMetrics.js';
import {
  formatPace, formatSpeed, formatBpm, formatRpm, formatTemp, formatPower,
} from '../../utils/format.js';

export const OVERLAY_METRICS = [
  { id: 'hr', colorToken: '--series-hr', labelKey: 'legendHr', axis: 'bpm' },
  { id: 'speed', colorToken: '--series-speed', labelKey: 'legendSpeed', axis: 'speed' },
  { id: 'pace', colorToken: '--series-speed', labelKey: 'legendPace', axis: 'pace' },
  { id: 'gap', colorToken: '--series-speed', labelKey: 'legendGap', axis: 'gap' },
  { id: 'cad', colorToken: '--series-cadence', labelKey: 'cadence', axis: 'rpm' },
  { id: 'temp', colorToken: '--series-temp', labelKey: 'legendTemp', axis: 'tempC' },
  { id: 'power', colorToken: '--series-power', labelKey: 'legendPower', axis: 'power' },
];

/** Speed and pace (and their grade-adjusted view) share one series; the
 *  family owns a single overlay slot. */
export const SPEED_FAMILY = ['speed', 'pace', 'gap'];

/** Speed (m/s) → pace (s per km). Infinite/NaN at a standstill — the
 *  formatters render that as an em dash. */
export function speedToPace(mps) {
  return mps > 0 ? 1000 / mps : NaN;
}

/**
 * Per-point x for the current mode + per-point speed (m/s) when usable.
 * @returns {{xs: Float64Array, speeds: Float64Array|null, gapSpeeds: Float64Array|null}}
 */
export function buildCaches(track, xMode) {
  const n = track.pointCount;
  let xs;
  if (xMode === 'time' && track.hasTime) {
    const t0 = track.points[0].time;
    xs = new Float64Array(n);
    for (let i = 0; i < n; i++) xs[i] = Math.max(0, track.points[i].time - t0);
  } else {
    xs = Float64Array.from(track.cumDist);
  }

  // Speed: recorded values win; gaps are derived from adjacent segments when
  // the track has timestamps. Without either, the speed overlay is unusable.
  const speeds = new Float64Array(n).fill(NaN);
  const fromDevice = new Uint8Array(n); // 1 = the value came from the device
  let recorded = 0;
  for (let i = 0; i < n; i++) {
    const s = track.points[i].speed;
    if (s != null && Number.isFinite(s) && s >= 0) { speeds[i] = s; fromDevice[i] = 1; recorded++; }
  }
  if (recorded < n && track.hasTime) {
    for (let i = 0; i < n - 1; i++) {
      if (Number.isFinite(speeds[i])) continue;
      const dt = (track.points[i + 1].time - track.points[i].time) / 1000;
      const dd = track.cumDist[i + 1] - track.cumDist[i];
      if (dt > 0 && dd >= 0) speeds[i] = dd / dt;
    }
  }
  // Cross-check device readings against what the concurrent segment
  // movement supports — GPS drift during pauses reads as absurd speed
  // spikes. Distrusted readings are dropped (NaN); the window then fills
  // the hole from the trusted neighbors.
  if (recorded > 0 && track.hasTime) {
    for (let i = 0; i < n - 1; i++) {
      if (!fromDevice[i]) continue;
      const dt = (track.points[i + 1].time - track.points[i].time) / 1000;
      const dd = track.cumDist[i + 1] - track.cumDist[i];
      if (recordedSpeedImplausible(speeds[i], dd, dt)) speeds[i] = NaN;
    }
  }
  // Rule selection by SOURCE (whole track): a track with NO recorded speed
  // derives every value from dd/dt and gets the 3σ spike clean
  // (cleanComputedSpeeds); a track with recorded speeds is diluted by the
  // 5-point sliding window after the cross-check. Either way the family
  // never draws an absurd raw spike.
  const speedsOut = recorded > 0
    ? cleanSpeedSeries(speeds)
    : track.hasTime ? cleanComputedSpeeds(speeds) : null;

  // Grade-adjusted (effort) speed: each point's speed divided by the Minetti
  // factor of its segment's gradient — the flat-ground speed at that effort.
  // speedsOut is per forward segment (i → i+1), so the gradient uses the same
  // segment. Needs elevation; otherwise the GAP overlay is unavailable.
  let gapSpeeds = null;
  if (speedsOut != null && track.hasElevation) {
    gapSpeeds = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n - 1; i++) {
      const dd = track.cumDist[i + 1] - track.cumDist[i];
      const dz = track.points[i + 1].ele - track.points[i].ele;
      if (dd > 0 && Number.isFinite(dz) && Number.isFinite(speedsOut[i])) {
        gapSpeeds[i] = speedsOut[i] / minettiFactor(dz / dd);
      }
    }
  }
  return { xs, speeds: speedsOut, gapSpeeds };
}

/** @param {object} track  @param {object} caches  {speeds, gapSpeeds} */
export function overlayAvailability(track, caches) {
  return {
    hr: !!track && track.hasHr,
    cad: !!track && track.hasCad,
    speed: !!track && caches.speeds != null,
    pace: !!track && caches.speeds != null,
    gap: !!track && caches.speeds != null && track.hasElevation,
    temp: !!track && track.hasTemp,
    power: !!track && track.hasPower,
  };
}

/**
 * The per-point reader for one overlay id, or null when the series has no
 * usable cache. @param {object} caches {speeds, gapSpeeds}
 */
export function overlayValueAt(id, track, caches) {
  if (id === 'hr') return (i) => track.points[i].hr;
  if (id === 'cad') return (i) => track.points[i].cad;
  if (id === 'temp') return (i) => track.points[i].temp;
  if (id === 'power') return (i) => track.points[i].power;
  if (id === 'speed' || id === 'pace') return caches.speeds ? (i) => caches.speeds[i] : null;
  if (id === 'gap') return caches.gapSpeeds ? (i) => caches.gapSpeeds[i] : null;
  return null;
}

/**
 * Per-column average of an overlay metric over [xStart, xEnd]. Points are
 * bucketed by their own x, so overlays stay pinned to track points in both
 * axis modes. @param {Float64Array} xs  per-point x coordinates
 */
export function sampleOverlay(xStart, xEnd, cols, valueAt, xs) {
  const colsSafe = Math.max(1, cols);
  const colW = (xEnd - xStart) / colsSafe;
  const sums = new Float64Array(colsSafe);
  const counts = new Uint32Array(colsSafe);
  for (let i = 0; i < xs.length; i++) {
    const xv = xs[i];
    if (xv < xStart || xv > xEnd) continue;
    const v = valueAt(i);
    if (v == null || !Number.isFinite(v)) continue;
    let c = Math.floor((xv - xStart) / colW);
    if (c >= colsSafe) c = colsSafe - 1;
    sums[c] += v;
    counts[c]++;
  }
  const vals = new Array(colsSafe).fill(null);
  for (let c = 0; c < colsSafe; c++) {
    if (counts[c]) vals[c] = sums[c] / counts[c];
  }
  return vals;
}

/**
 * Full-resolution min and max of an overlay series: every track point read
 * through `valueAt`, with no column averaging. `sampleOverlay` means each
 * pixel column, so a narrow peak is diluted by its column neighbors — good
 * enough for drawing the curve, but the speed family's axis top must read
 * the same per-point maximum the metrics list's Maximum Speed reports, or
 * the strip can round a display step below the list (width-dependently).
 * @param {Function} valueAt  per-point reader (point index → value)
 * @param {number} n  track point count
 * @returns {{lo: number, hi: number}|null} null when no point carries a
 *   finite value
 */
export function seriesExtremes(valueAt, n) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = valueAt(i);
    if (v == null || !Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return Number.isFinite(lo) && Number.isFinite(hi) ? { lo, hi } : null;
}

/** @private x coordinate of a sector boundary in the current mode. */
export function distToX(dist, track, xMode) {
  if (xMode !== 'time') return dist;
  const pt = pointAtDistance(track, dist);
  const time = pt && pt.time != null ? pt.time : track.points[0].time;
  return Math.max(0, time - track.points[0].time);
}

/** @private Inverse of distToX: x coordinate back to distance along the track. */
export function xToDist(v, track, xs) {
  const last = xs.length - 1;
  if (v <= xs[0]) return 0;
  if (v >= xs[last]) return track.totalDistance;
  let lo = 0, hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < v) lo = mid; else hi = mid;
  }
  const span = xs[hi] - xs[lo];
  const frac = span > 0 ? (v - xs[lo]) / span : 0;
  return track.cumDist[lo] + frac * (track.cumDist[hi] - track.cumDist[lo]);
}

/**
 * Canvas-space clientX → raw x in the CURRENT axis domain (distance or
 * elapsed time), mapped through the visible zoom window. Single source of
 * truth for every cursor→x conversion — chart hover, rubber-band drag and
 * sector-handle dragging must all agree with the rendered positions, or
 * handles stop following the cursor when zoomed.
 */
export function clientXtoX(clientX, rect, plot, view, xs) {
  const frac = Math.min(Math.max((clientX - rect.left - plot.x0) / plot.w, 0), 1);
  const v0 = view ? view.start : 0;
  const v1 = view ? view.end : (xs ? xs[xs.length - 1] : 0);
  return v0 + frac * (v1 - v0);
}

/**
 * Min–max downsampling of the elevation band over [xStart, xEnd]. Points are
 * bucketed by their own x (distance or time), so a mode switch can never
 * shift data between columns. Empty columns fall back to interpolation.
 */
export function sampleElevation(track, xs, xStart, xEnd, cols) {
  const colsSafe = Math.max(1, cols);
  const colW = (xEnd - xStart) / colsSafe;
  const mins = new Float64Array(colsSafe).fill(Infinity);
  const maxs = new Float64Array(colsSafe).fill(-Infinity);
  const filled = new Uint8Array(colsSafe);

  if (track.hasElevation) {
    for (let i = 0; i < xs.length; i++) {
      const xv = xs[i];
      if (xv < xStart || xv > xEnd) continue;
      const ele = track.points[i].ele;
      if (ele == null) continue;
      let c = Math.floor((xv - xStart) / colW);
      if (c >= colsSafe) c = colsSafe - 1;
      if (ele < mins[c]) mins[c] = ele;
      if (ele > maxs[c]) maxs[c] = ele;
      filled[c] = 1;
    }
    for (let c = 0; c < colsSafe; c++) {
      if (filled[c]) continue;
      const pt = pointAtDistance(track, xToDist(xStart + (c + 0.5) * colW, track, xs));
      const ele = pt && pt.ele != null ? pt.ele : 0;
      mins[c] = ele;
      maxs[c] = ele;
    }
  } else {
    mins.fill(0);
    maxs.fill(0);
  }
  return { mins, maxs, count: colsSafe, colW };
}

/** Overlay readout formatting, shared by the axis labels and the hover
 *  tooltip so a series never renders two different unit styles. */
export function formatOverlayValue(def, v) {
  if (def.axis === 'speed') return formatSpeed(v);
  if (def.axis === 'pace') return formatPace(speedToPace(v));
  if (def.axis === 'gap') return formatPace(speedToPace(v));
  if (def.axis === 'bpm') return formatBpm(v);
  if (def.axis === 'tempC') return formatTemp(v);
  if (def.axis === 'power') return formatPower(v);
  return formatRpm(v);
}

/**
 * The overlay-slot toggle as a pure transition — speed/pace/GAP are
 * mutually exclusive views of one series: picking one replaces the others in
 * place (keeping the draw order), so the family always occupies a single
 * slot. 'speed-family' toggles the whole family, keeping `speedVariant`
 * (whichever variant the user last picked).
 *
 * @param {string[]} selected  current selection (not mutated)
 * @param {string} id  toggled overlay id or 'speed-family'
 * @param {number} maxN  overlay slot cap
 * @param {string} speedVariant  the family variant to (re)select
 * @returns {{selected: string[], unhide: string[]}|null}
 *   the new selection plus ids to drop from the hidden set, or null when the
 *   toggle is a no-op (every slot already taken and the id not selected)
 */
export function applyOverlayToggle(selected, id, maxN, speedVariant) {
  if (id === 'speed-family') {
    if (selected.some((v) => SPEED_FAMILY.includes(v))) {
      return { selected: selected.filter((v) => !SPEED_FAMILY.includes(v)), unhide: [...SPEED_FAMILY] };
    }
    if (selected.length < maxN) {
      return { selected: [...selected, speedVariant], unhide: [speedVariant] };
    }
    return null;
  }
  if (selected.includes(id)) {
    return { selected: selected.filter((v) => v !== id), unhide: [id] };
  }
  // A sibling variant replacing the selected one (pace over speed, GAP over
  // pace…) never needs a free slot — the family keeps its single slot.
  const sibling = SPEED_FAMILY.includes(id)
    ? selected.find((v) => SPEED_FAMILY.includes(v) && v !== id) ?? null
    : null;
  if (selected.length >= maxN && !sibling) return null;
  const out = [...selected];
  if (sibling) out.splice(out.indexOf(sibling), 1, id);
  else out.push(id);
  return { selected: out, unhide: [id] };
}
