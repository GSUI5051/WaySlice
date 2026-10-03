/**
 * Elevation profile — data definitions and PURE computation.
 *
 * Everything here takes its inputs as parameters and returns new values; no
 * DOM, no canvas, no shared chart state (profile-state.js is not imported).
 * That makes the whole module unit-testable and keeps the scale math the
 * renderer and the interaction layer both rely on in exactly one place.
 *
 * The chart renderer (uPlot) receives the FULL-RESOLUTION series — there is
 * no per-pixel-column downsampling anywhere in the draw path. Zooming and
 * the sector view change the chart's x scale range, never the data.
 *
 * Contents:
 *   OVERLAY_METRICS / SPEED_FAMILY — the overlay definitions and the
 *     speed/pace/GAP family rule (one series, three views, one slot)
 *   buildCaches       — per-point x + speed caches for a track + axis mode
 *     (the speed series passes the shared cleanRecordedSpeeds from sectorMetrics)
 *   overlayAvailability / overlayValueAt — what can be drawn and how to read it
 *   seriesExtremes    — full-resolution min/max of a series (no averaging)
 *   overlayExtremes / overlayYRange / eleYRange — the chart y scales, derived
 *     from full-resolution data (never from sampled or pixel-width values)
 *   distToX / xToDist / clientXtoX — the coordinate conversions every cursor
 *     path and every drawn element must agree on
 *   sectorFitWindow   — the x window the fit-to-sector command shows
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

/* colorToken drives graphics (curves, menu dots, zone bands); textToken is
   its per-theme small-text sibling (readings in the tooltip, the mobile
   readout band, the canvas legend strip, segment stats) — see tokens.css. */
export const OVERLAY_METRICS = [
  { id: 'hr', colorToken: '--series-hr', textToken: '--series-hr-text', labelKey: 'legendHr', axis: 'bpm' },
  { id: 'speed', colorToken: '--series-speed', textToken: '--series-speed-text', labelKey: 'legendSpeed', axis: 'speed' },
  { id: 'pace', colorToken: '--series-speed', textToken: '--series-speed-text', labelKey: 'legendPace', axis: 'pace' },
  { id: 'gap', colorToken: '--series-speed', textToken: '--series-speed-text', labelKey: 'legendGap', axis: 'gap' },
  { id: 'cad', colorToken: '--series-cadence', textToken: '--series-cadence-text', labelKey: 'cadence', axis: 'rpm' },
  { id: 'temp', colorToken: '--series-temp', textToken: '--series-temp-text', labelKey: 'legendTemp', axis: 'tempC' },
  { id: 'power', colorToken: '--series-power', textToken: '--series-power-text', labelKey: 'legendPower', axis: 'power' },
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
 * Full-resolution min and max of a series: every point read through
 * `valueAt`, no averaging and no windowing — the single definition of a
 * series' true extremes that the chart scales and the metrics list share.
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

/**
 * Full-resolution extremes of one overlay series: every track point read
 * through `valueAt`, with no column averaging. These are the numbers the
 * chart y scale is built from AND the same per-point maximum the metrics
 * list's Maximum Speed reports — the two can never disagree, because both
 * read the same raw series.
 * @param {string} id  overlay id ('hr' | 'speed' | … | 'power')
 * @param {object} track  the loaded track
 * @param {object} caches  {speeds, gapSpeeds} from buildCaches
 * @returns {{lo: number, hi: number}|null} null when no point carries a
 *   finite value
 */
export function overlayExtremes(id, track, caches) {
  const valueAt = overlayValueAt(id, track, caches);
  return valueAt ? seriesExtremes(valueAt, track.pointCount) : null;
}

/**
 * Chart y range for one overlay, derived from its FULL-RESOLUTION extremes.
 * The rules (inherited unchanged from the canvas renderer's scale pass):
 * a near-constant series (fresh legs on a flat loop!) has a range of ~0 —
 * padding on the range alone would stretch GPS rounding noise into a
 * full-height zigzag, so pad at least 4% of the series mean; bpm/rpm/speed
 * are physically non-negative — keep the scale above zero. The speed
 * family's axis strip is read as "this curve tops out at X" — and after the
 * spike clean that top IS a real value worth comparing against the metrics
 * list — so its top stays at the series maximum. Every other overlay keeps
 * the padded top: bpm/watt spikes are dropped, not interpolated, and their
 * scales have never promised to end at the data maximum.
 * @param {string} id  overlay id
 * @param {{lo: number, hi: number}} ext  full-resolution extremes
 * @returns {[number, number]}
 */
export function overlayYRange(id, ext) {
  const pad = Math.max((ext.hi - ext.lo) * 0.08, Math.abs((ext.lo + ext.hi) / 2) * 0.04) || 1;
  return [Math.max(0, ext.lo - pad), SPEED_FAMILY.includes(id) ? ext.hi : ext.hi + pad];
}

/**
 * The uPlot scale range that lands an overlay's DISPLAYED extremes on the
 * band rows the axis strip labels sit on. uPlot maps a scale's min/max onto
 * the FULL plot rect, but the strip rows sit inside it: the elevation grid
 * rows (data extremes), with headroom above and below. Extending the scale
 * by the same headroom fractions puts the displayed lo/hi exactly on those
 * rows — the drawn curve tops out on the row its label is printed on, the
 * contract the canvas renderer's overlayYTop/overlayYBottom mapping kept.
 * @param {number} lo  displayed minimum (the strip's bottom label value)
 * @param {number} hi  displayed maximum (the strip's top label value)
 * @param {number} topFrac  plot-height fraction ABOVE the top band row
 * @param {number} bottomFrac  plot-height fraction BELOW the bottom band row
 * @returns {[number, number]} the scale range to hand to setScale
 */
export function bandScaleRange(lo, hi, topFrac, bottomFrac) {
  const band = 1 - topFrac - bottomFrac;
  if (!(hi > lo) || !(band > 0)) return [lo, hi];
  const scaleSpan = (hi - lo) / band;
  return [lo - bottomFrac * scaleSpan, hi + topFrac * scaleSpan];
}

/**
 * Elevation y range: ~8% headroom above and below the data (at least 4 m,
 * so a dead-flat track still gets a usable band). The chart's grid rows
 * anchor to the DATA extremes and the midpoint — the top row IS the track's
 * highest point — so the curve can never rise past its axis label.
 * @returns {[number, number]|null} null when the track has no elevation
 */
export function eleYRange(track) {
  if (!track.hasElevation || track.eleMin == null || track.eleMax == null) return null;
  const pad = Math.max((track.eleMax - track.eleMin) * 0.08, 4);
  return [track.eleMin - pad, track.eleMax + pad];
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
 * The draw-side inverse of `clientXtoX`: raw x in the CURRENT axis domain →
 * canvas-space pixel, mapped through the visible zoom window. Single source
 * of truth for every x→pixel conversion — series drawing, hover crosshair,
 * sector masks and handles, waypoint lines and the probe's cursor line must
 * all agree with the rendered positions.
 * @param {number} xv  raw x value
 * @param {{start:number, end:number}|null} view  visible window, null = full track
 * @param {Float64Array|null} xs  per-point x cache (window bound when fitted)
 * @param {{x0:number, w:number}} plot  plot rect inside the canvas
 * @returns {number} unclamped pixels
 */
export function xvToPx(xv, view, xs, plot) {
  const v0 = view ? view.start : 0;
  const v1 = view ? view.end : (xs && xs.length ? xs[xs.length - 1] : 0);
  return plot.x0 + ((xv - v0) / Math.max(v1 - v0, 1e-9)) * plot.w;
}

/** Sector share of the fit-to-sector window width — the handles land at
 *  ≈9% / ≈91% of the viewport (the spec's 8–10% / 90–92% band). */
export const FIT_SECTOR_FRACTION = 0.82;

/**
 * The x window the "fit to sector" command shows: the sector centered at
 * FIT_SECTOR_FRACTION of the window width (≈9% of context beyond each
 * handle, never glued to the chart edges). Three clamps keep the fit
 * honest: the window is never NARROWER than the chart's zoom floor (a tiny
 * sector may not reach a deeper zoom than the wheel/pinch max — the fit
 * then simply shows the floor window), never WIDER than the track (a
 * sector near the full track returns null = the fitted full view instead
 * of an out-of-domain window), and always inside [0, total] (a sector at
 * either track end loses the context on that side rather than revealing
 * blank space beyond the data). All arguments in one unit — the caller's
 * raw x domain (track meters or elapsed ms), so Distance and Time share
 * this unchanged.
 * @param {number} sectorStart  sector boundary in raw x units
 * @param {number} sectorEnd
 * @param {number} total  full domain span in raw x units
 * @param {number} minSpan  zoom floor in raw x units (MIN_VIEW_M / MIN_VIEW_MS)
 * @returns {{start: number, end: number}|null} null = the full domain (fitted)
 */
export function sectorFitWindow(sectorStart, sectorEnd, total, minSpan) {
  const lo = Math.min(sectorStart, sectorEnd);
  const hi = Math.max(sectorStart, sectorEnd);
  const width = Math.min(Math.max((hi - lo) / FIT_SECTOR_FRACTION, minSpan), total);
  if (!(width < total)) return null;
  const start = Math.min(Math.max((lo + hi) / 2 - width / 2, 0), total - width);
  return { start, end: start + width };
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
 * @returns {{selected: string[]}|null}
 *   the new selection, or null when the toggle is a no-op (every slot
 *   already taken and the id not selected)
 */
export function applyOverlayToggle(selected, id, maxN, speedVariant) {
  if (id === 'speed-family') {
    if (selected.some((v) => SPEED_FAMILY.includes(v))) {
      return { selected: selected.filter((v) => !SPEED_FAMILY.includes(v)) };
    }
    if (selected.length < maxN) {
      return { selected: [...selected, speedVariant] };
    }
    return null;
  }
  if (selected.includes(id)) {
    return { selected: selected.filter((v) => v !== id) };
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
  return { selected: out };
}
