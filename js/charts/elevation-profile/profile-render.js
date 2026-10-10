/**
 * Elevation profile — the uPlot renderer.
 *
 * uPlot owns the chart: the plot coordinate system, the elevation series,
 * the overlay series (HR, speed/pace/GAP, cadence, temperature, power),
 * the x/y scales, grid and axes, and the drawing of every series from its
 * COMPLETE raw data. The renderer receives the full-resolution series —
 * zooming, the sector view and the x-axis mode act on the chart's scale
 * range (or swap cached arrays), never on the data. The elevation series
 * renders in the accent color at its own constant stroke width. The sector
 * selection is expressed in the curves THEMSELVES: every telemetry series
 * strokes at full opacity inside the sector span and steps to
 * --profile-series-dim outside it, and the grid lines share the same
 * gradient (one gradient stroke of one path each — no second pass, no
 * overlay mask), while the axes, ticks, labels, zone bands and labels keep
 * their strength everywhere.
 *
 * WaySlice keeps the business layers it always owned, drawn on its own
 * annotation canvas (#profile-canvas — the same element the pointer
 * handlers listen on, layered above uPlot): the per-overlay axis strip,
 * waypoint pins, and the hover/probe crosshair. The DOM overlays (sector
 * handles, tooltip) keep their existing architecture untouched.
 *
 * Chart lifecycle:
 *   No track         → no chart; uPlot is not even loaded (uplot-loader)
 *   First render     → loadUPlot() exactly once → chart created from the
 *                      raw series (Promise cached, concurrent renders share it)
 *   View change      → setScale('x', …) — data untouched
 *   Overlay toggle   → series.show flags — chart instance untouched
 *   Track / x mode   → setData(swap the cached arrays) — chart instance kept
 *   Theme / units    → colors and labels are per-draw functions → redraw
 *   Resize           → setSize — no destroy/recreate
 *
 * uPlot config notes: cursor and legend are disabled entirely (the profile
 * hover is WaySlice's crosshair + DOM tooltip; uPlot must bind no pointer
 * listeners — the annotation canvas above it is the interaction surface).
 * The y scales are explicit: WaySlice computes every range from the
 * full-resolution data (profile-data.js) and sets it with setScale, which
 * uPlot never re-ranges — so chart scales and the metrics list always read
 * the same raw numbers.
 */
import { sectorStore, isEntireTrack } from '../../sector/sectorStore.js';
import { pointAtDistance } from '../../geo/interpolate.js';
import { loadHeartRateSettings } from '../../metrics/heartRateSettings.js';
import { getHeartRateDisplay } from '../../metrics/heartRateDisplay.js';
import { computeZoneBounds, classifyHr } from '../../metrics/heartRateZones.js';
import { t } from '../../language/language.js';
import {
  formatDistanceShort, formatElevation, formatDuration,
} from '../../utils/format.js';
import { state } from './profile-state.js';
import {
  OVERLAY_METRICS, SPEED_FAMILY, overlayExtremes, overlayYRange, eleYRange,
  bandScaleRange, distToX, xToDist, xvToPx, formatOverlayValue, sectorDimSteps,
} from './profile-data.js';
import { showTooltipAt, hideTooltip, resetProbeReadout } from './profile-tooltip.js';
import { niceStep, niceStepForUnit, niceTimeStep } from '../ticks.js';
import { getUnitSystem } from '../../units/units.js';
import { loadUPlot } from './uplot-loader.js';

// Zone band tint. The band under the hover dot is drawn about twice as deep
// so the eye reads the active zone — still faint, still background.
// Values are hand-picked by creator.
const BAND_ALPHA = 0.22;
const ACTIVE_BAND_ALPHA = 0.54;

// Pre-chart fallback plot geometry (the chart's own bbox takes over once a
// chart exists; nothing draws before a track anyway).
const MARGIN = { left: 58, right: 14, top: 4, bottom: 22 };

// Draw order inside uPlot: the overlay curves draw BENEATH the elevation
// line (the old canvas renderer's fixed layer order). series[0] is uPlot's
// x placeholder.
const SERIES_ORDER = ['hr', 'speed', 'cad', 'temp', 'power', 'ele'];

// One uPlot scale per series; the speed family shares the m/s 'speed' scale
// (pace and GAP are views of the same speed data, formatted differently).
const SCALE_KEY = {
  hr: 'hr', speed: 'speed', pace: 'speed', gap: 'speed',
  cad: 'cad', temp: 'temp', power: 'power',
};

// uPlot series index per scale key (series[0] is uPlot's x placeholder).
const SERIES_INDEX = Object.fromEntries(SERIES_ORDER.map((id, i) => [id, i + 1]));

// The series-text token per overlay (strip labels) — the graphics tokens
// live in the same map under their own names.
const TEXT_TOKEN = {
  '--series-hr-text': 'hrText',
  '--series-speed-text': 'speedText',
  '--series-cadence-text': 'cadenceText',
  '--series-temp-text': 'tempText',
  '--series-power-text': 'powerText',
};

let ctx = null;
let canvas = null;
let handles = null;
let chartHost = null;

/** The uPlot instance once the first track render created it. */
let chart = null;
// Style tokens snapshotted once per render pass — the series stroke/fill
// functions and the annotation canvas read these (theme changes re-run the
// pass, so the functions never hold a stale theme).
let tokens = {};
// uPlot's canvas backing ratio (its bbox is in device pixels).
let pxRatio = 1;
// Per-track plain arrays for the series uPlot reads directly (nulls mark
// missing readings). The speed family feeds uPlot the cached Float64Arrays.
let seriesCache = null;      // { track, ele, hr, cad, temp, power }
// What the chart was last given — compared by REFERENCE (every state change
// that swaps series arrays builds new ones).
let appliedData = null;      // { xs, family, ele, hr, cad, temp, power }
let appliedShows = '';       // visibility flags currently on the chart
let appliedX = null;         // x window currently set on the chart scale
let appliedKey = null;       // the last chartKey() handed to syncChart
// Restrained failure state for the lazy uPlot load (uplot-loader).
let errorEl = null;

/** Binds the canvas-side DOM assets. */
export function initRender() {
  ({ canvas, ctx } = state.dom);
  chartHost = state.dom.chart;
  handles = state.dom.handles;
}

/** Style stamp — bumped on theme/units/language changes so the next render
 *  re-applies chart style. Colors are per-draw functions, but the axis tick
 *  STRINGS are cached by uPlot between size convergences (axis._values is
 *  only re-derived inside convergeSize, gated by redraw's recalcAxes flag),
 *  so an invalidation must also demand an axis recalc — otherwise the
 *  redraw repaints the cached strings and a unit/language flip leaves the
 *  previous system's ticks on the canvas. */
let styleStamp = 0;
let axesRecalcPending = false;
export function invalidateChartStyle() {
  styleStamp++;
  axesRecalcPending = true;
}

/** Zone-band redraw stamp — bumped when the DEEPENED (hovered) band changes
 *  or the zone display toggles/edits. The bands draw inside uPlot's draw
 *  cycle, and a hover move alone only repaints the annotation canvas, so
 *  without this the active band would never re-render (the highlight died
 *  in the uPlot refactor, where the bands left the per-frame pass). */
let zoneStamp = 0;
let activeZone = null;
export function invalidateZoneBands() {
  zoneStamp++;
}

/** @private Recomputes the currently highlighted zone (the same reading path
 *  and gates drawZoneBands uses) and bumps the stamp when it changed — so a
 *  hover crossing a zone boundary costs exactly one chart redraw, not one
 *  per pointer move. */
function refreshZoneHighlight() {
  let zone = null;
  const display = getHeartRateDisplay();
  if (display.showZones && display.highlight && state.track) {
    const bounds = computeZoneBounds(loadHeartRateSettings());
    if (bounds) zone = hrHoverZone(bounds, state.probe ? state.probe.dist : state.hoverDist);
  }
  if (zone !== activeZone) {
    activeZone = zone;
    zoneStamp++;
  }
}

/** rAF-batched redraw. */
let syncPending = false;
export function scheduleSync() {
  if (syncPending) return;
  syncPending = true;
  requestAnimationFrame(() => {
    syncPending = false;
    render();
  });
}

/** Immediate redraw (resize path). */
export function sync() {
  return render();
}

// Single-flight async render: while the first render awaits the uPlot
// download, later scheduleSync() calls land in `rerender` and run once the
// in-flight pass finishes — no dropped frames, no concurrent chart builds,
// and a failed load is only retried by the NEXT explicit render trigger.
let rendering = false;
let rerender = false;
async function render() {
  if (rendering) {
    rerender = true;
    return;
  }
  rendering = true;
  try {
    await renderNow();
  } finally {
    rendering = false;
  }
  if (rerender) {
    rerender = false;
    render();
  }
}

async function renderNow() {
  if (!state.track) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  let uPlot;
  try {
    uPlot = await loadUPlot();
  } catch (error) {
    showChartError(error);
    return;
  }
  hideChartError();
  if (!chart) {
    // The chart config reads the scale cache at construction time (axis
    // sizes, range fallbacks) — compute it BEFORE the instance exists.
    ensureScales();
    try {
      createChart(uPlot);
    } catch (error) {
      showChartError(error);
      return;
    }
  }
  // The deepened hovered band lives in uPlot's draw cycle — detect a zone
  // change here so crossing a band boundary costs one chart redraw.
  refreshZoneHighlight();
  const key = chartKey();
  if (key !== appliedKey) {
    try {
      syncChart();
    } catch (error) {
      showChartError(error);
      return;
    }
    appliedKey = key;
  }
  drawAnnotation();
}

/** @private Everything that decides whether the chart (not the annotation
 *  canvas) needs re-syncing: scales (track/mode/family), series visibility,
 *  view window, style, the sector span (the curves dim outside it), and the
 *  zone-band highlight stamp. The raw data arrays are re-checked by
 *  reference inside syncChart itself. */
function chartKey() {
  const sc = ensureScales();
  const sector = sectorStore.get();
  return [
    sc.stamp,
    computeShows(sc).key,
    state.view ? `${state.view.start}|${state.view.end}` : 'full',
    styleStamp,
    isEntireTrack(sector) ? 'full' : `${sector.start}|${sector.end}`,
    zoneStamp,
  ].join('|');
}

// ---------------------------------------------------------------------------
// Data assembly — the chart reads cached arrays; nothing here samples.
// ---------------------------------------------------------------------------

/** @private The speed-family series currently drawn: GAP has its own
 *  grade-adjusted cache; speed and pace share the plain speed series. */
function familyDataId() {
  return state.selectedOverlays.find((id) => SPEED_FAMILY.includes(id)) ?? 'speed';
}

/** @private Plain (null-able) arrays for the series read off track points —
 *  built once per track, reused by every redraw. */
function trackSeries(track) {
  if (seriesCache?.track === track) return seriesCache;
  const n = track.pointCount;
  const pick = (read) => {
    const a = new Array(n);
    for (let i = 0; i < n; i++) a[i] = read(i) ?? null;
    return a;
  };
  seriesCache = {
    track,
    ele: pick((i) => track.points[i].ele),
    hr: pick((i) => track.points[i].hr),
    cad: pick((i) => track.points[i].cad),
    temp: pick((i) => track.points[i].temp),
    power: pick((i) => track.points[i].power),
  };
  return seriesCache;
}

/** @private The exact array references the chart currently holds. */
function currentRefs() {
  const s = trackSeries(state.track);
  return {
    xs: state.xs,
    family: familyDataId() === 'gap' ? state.gapSpeeds : state.speeds,
    ele: s.ele, hr: s.hr, cad: s.cad, temp: s.temp, power: s.power,
  };
}

/** @private Builds the uPlot data tuple for the current state (references
 *  only — uPlot never gets a copy of anything). */
function buildData(refs) {
  const nulls = new Array(refs.xs.length).fill(null);
  return [
    refs.xs,
    refs.hr,
    refs.family ?? nulls,
    refs.cad,
    refs.temp,
    refs.power,
    refs.ele,
  ];
}

// ---------------------------------------------------------------------------
// Scales — WaySlice computes every y range from FULL-RESOLUTION data
// (profile-data.js); uPlot only maps values through the ranges it is given.
// ---------------------------------------------------------------------------

/** @private Per-track identity for cache keys — String(track) is identical
 *  for every track ("[object Object]"), which would make a swapped track
 *  look like no change at all. */
const trackIds = new WeakMap();
let nextTrackId = 1;
function trackId(track) {
  if (!trackIds.has(track)) trackIds.set(track, nextTrackId++);
  return trackIds.get(track);
}

/** @private The plot-height fractions ABOVE and BELOW the band rows the
 *  overlay curves and their strip labels share: the elevation grid rows
 *  (data extremes, inside the padded elevation scale), or the old 8px
 *  insets when there is no elevation. The elevation case is pixel-free
 *  (fractions of the elevation scale); the no-elevation case depends on
 *  the current plot height, which the scale-cache stamp carries. */
function bandFractions(track, eleRange) {
  if (eleRange && track.hasElevation && track.eleMax != null && track.eleMin != null) {
    const [eLo, eHi] = eleRange;
    const span = eHi - eLo;
    if (span > 0) {
      return { top: (eHi - track.eleMax) / span, bottom: (track.eleMin - eLo) / span };
    }
  }
  const h = state.plot.h || 1;
  const f = Math.min(8 / h, 0.45);
  return { top: f, bottom: f };
}

/** @private Scale cache — recomputed only when the track, axis mode or the
 *  drawn speed-family variant changes (never per frame). Each overlay
 *  carries its DISPLAYED extremes (lo/hi — what the axis strip prints) and
 *  the extended scale range that lands them on the strip's band rows. */
let scalesCache = null;
function ensureScales() {
  const family = familyDataId();
  const stampTail = state.track?.hasElevation ? 'ele' : String(Math.round(state.plot.h));
  if (scalesCache &&
      scalesCache.track === state.track &&
      scalesCache.xMode === state.xMode &&
      scalesCache.family === family &&
      scalesCache.stampTail === stampTail) {
    return scalesCache;
  }
  const track = state.track;
  const ele = eleYRange(track);
  const frac = track ? bandFractions(track, ele) : { top: 0, bottom: 0 };
  const overlays = new Map();
  for (const def of OVERLAY_METRICS) {
    const ext = overlayExtremes(def.id, track, state);
    if (!ext) {
      overlays.set(def.id, null);
      continue;
    }
    const [lo, hi] = overlayYRange(def.id, ext);
    overlays.set(def.id, { lo, hi, scale: bandScaleRange(lo, hi, frac.top, frac.bottom) });
  }
  scalesCache = {
    track,
    xMode: state.xMode,
    family,
    ele,
    overlays,
    stampTail,
    stamp: `${trackId(track)}|${state.xMode}|${family}|${stampTail}`,
  };
  return scalesCache;
}

/** @private Which series are drawn: the elevation series only for tracks
 *  with elevation, an overlay series only while selected AND carrying at
 *  least one finite reading (a series with no data — or a degenerate
 *  all-zero range, which cannot form a scale — draws nothing, exactly like
 *  the previous renderer's scale pass). */
function computeShows(sc) {
  const shows = {
    hr: false, speed: false, cad: false, temp: false, power: false,
    ele: !!sc.ele && state.track.hasElevation,
  };
  for (const id of state.selectedOverlays) {
    const entry = sc.overlays.get(id);
    if (entry && entry.hi > entry.lo) shows[SCALE_KEY[id]] = true;
  }
  return {
    map: shows,
    key: SERIES_ORDER.map((id) => (shows[id] ? id : '-')).join(''),
  };
}

// ---------------------------------------------------------------------------
// Chart lifecycle
// ---------------------------------------------------------------------------

/** @private Creates the uPlot instance once — lazily, on the first render
 *  that actually has a track. No track ever touches this path. */
function createChart(uPlot) {
  const rect = chartHost.getBoundingClientRect();
  const width = Math.max(10, Math.round(rect.width));
  const height = Math.max(10, Math.round(rect.height));
  // The constructor's own first draw sees no data (built with none); the
  // following syncChart supplies the arrays and the real scales.
  chart = new uPlot({
    width,
    height,
    legend: { show: false },
    cursor: { show: false },
    scales: {
      x: { time: false, auto: true },
      ele: { auto: false, range: () => scalesCache?.ele ?? [0, 1] },
      hr: { auto: false, range: () => scalesCache?.overlays.get('hr')?.scale ?? [0, 1] },
      speed: { auto: false, range: () => scalesCache?.overlays.get(familyDataId())?.scale ?? [0, 1] },
      cad: { auto: false, range: () => scalesCache?.overlays.get('cad')?.scale ?? [0, 1] },
      temp: { auto: false, range: () => scalesCache?.overlays.get('temp')?.scale ?? [0, 1] },
      power: { auto: false, range: () => scalesCache?.overlays.get('power')?.scale ?? [0, 1] },
    },
    axes: [
      {
        side: 2, // bottom — distance or elapsed time per current mode
        stroke: () => tokens.text,
        // uPlot's native x grid spans the full plot height, crossing the
        // headroom above the top elevation row (the rows anchor to the DATA
        // extremes while the scale pads ~8%); drawXGrid takes over and
        // starts the lines on the top row instead.
        grid: { show: false },
        ticks: { show: false },
        font: monoFont(),
        gap: 5,
        size: 22,
        splits: (u, i, min, max) => xTickValues(min, max),
        values: (u, splits) => splits.map(formatXTick),
      },
      {
        scale: 'ele',
        side: 3, // left — the three data-anchored elevation rows
        stroke: () => tokens.text,
        // The elevation grid rows dim outside the sector with the curves —
        // one horizontal gradient stroke over the whole row set (uPlot draws
        // an axis's grid as a single path), so each row fades exactly where
        // the curves do and steps at the same handle positions.
        grid: { stroke: (u) => selectionStroke(u, tokens.grid) },
        ticks: { show: false },
        font: monoFont(),
        gap: 8,
        // No elevation → no y axis at all (the size fn re-converges on the
        // forced redraw every track/x-mode syncChart pass issues).
        size: (self, values) => (scalesCache?.ele ? yAxisGutter(values) : 0),
        splits: (u, i, min, max) => eleTickValues(),
        values: (u, splits) => splits.map((v) => formatElevation(Math.round(v))),
      },
    ],
    series: [
      {},
      ...buildSeriesConfigs(),
    ],
    hooks: {
      // Zone bands go through uPlot's own draw cycle so they sit beneath
      // every series, over the grid — exactly where the old renderer put
      // them. Hooks draw in uPlot's device-pixel canvas space. drawXGrid
      // replaces the native x grid (disabled above) at the same cycle
      // stage, so the lines stay beneath every series too.
      drawAxes: [drawZoneBands, drawXGrid],
      draw: [drawFlatReference],
      setSize: [() => updateStatePlot()],
    },
  }, null, chartHost);
  updateStatePlot();
  appliedData = null;
  appliedShows = '';
  appliedX = null;
}

/** @private Series configs in draw order (overlays beneath elevation).
 *  Stroke/fill are FUNCTIONS re-evaluated on every draw, so a theme change
 *  is just a redraw with the existing geometry — and every series flows
 *  through the same selectionStroke rule, so any series added here dims
 *  outside the sector automatically. */
function buildSeriesConfigs() {
  const overlaySeries = (id, scaleKey, token) => ({
    label: id,
    scale: scaleKey,
    show: false,
    width: 1.5,
    spanGaps: true,
    stroke: (u) => selectionStroke(u, tokens[token]),
    points: { show: () => false },
  });
  return [
    overlaySeries('hr', 'hr', 'hr'),
    overlaySeries('speed', 'speed', 'speed'),
    overlaySeries('cad', 'cad', 'cadence'),
    overlaySeries('temp', 'temp', 'temp'),
    overlaySeries('power', 'power', 'power'),
    {
      label: 'ele',
      scale: 'ele',
      show: false,
      width: 1.5,
      spanGaps: true,
      // The elevation curve renders in the accent color at this constant
      // stroke width in every state; the selection dims it like every other
      // series (outside the sector only — never re-colored or re-weighted).
      stroke: (u) => selectionStroke(u, tokens.accent),
      // Line only — the area fill below the curve was dropped by design
      // (user decision, 2026-10-03): the profile reads as a clean line.
      fill: null,
      points: { show: () => false },
    },
  ];
}

/** @private Hex/rgb token color → the same color at `alpha`. Unknown formats
 *  pass through unchanged (the curve then simply keeps full strength) — the
 *  theme tokens are plain hex in both themes, so this is a safety net. */
function withAlpha(color, alpha) {
  let m = /^#([0-9a-f]{6})$/i.exec(color);
  if (m) {
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(color);
  if (m) {
    const parts = m[1].split(/[,\s/]+/).filter(Boolean);
    return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
  }
  return color;
}

/** @private Sector boundary distance → stroke-space (device) px, through the
 *  same distance→x→pixel conversion as the handles and the crosshair. */
function sectorEdgePx(dist) {
  return xvToPx(distToX(dist, state.track, state.xMode), state.view, state.xs, state.plot) * pxRatio;
}

/**
 * Stroke style for one telemetry series (and the grid lines) under the
 * current selection: the plain color while the sector covers the whole
 * track (or nothing is loaded), the dimmed color when the sector misses the
 * visible window, else a horizontal gradient holding the color inside the
 * sector span and stepping to --profile-series-dim on either side of it.
 * ONE stroke of the ONE path uPlot already builds — a curve stays
 * continuous through the boundaries (a hard color step under the handle
 * bar; no gap, seam, second pass or double-draw), the steps land between
 * samples exactly where the handles stand, and a grid line takes the
 * gradient's color at its own x so it dims only outside the sector. The
 * axes, ticks, tick labels, zone bands and hover/legend layers never pass
 * through here and keep their strength everywhere.
 *
 * uPlot re-evaluates every stroke on each draw, so selection moves, zoom,
 * resize and theme flips re-derive the style from live state for free — no
 * extra redraw plumbing beyond chartKey carrying the sector span.
 */
function selectionStroke(u, color) {
  if (!state.track || isEntireTrack()) return color;
  const { start, end } = sectorStore.get();
  const plan = sectorDimSteps(sectorEdgePx(start), sectorEdgePx(end), u.ctx.canvas.width);
  if (plan.mode === 'inside') return color;
  const dimColor = withAlpha(color, tokens.dimAlpha);
  if (plan.mode === 'outside') return dimColor;
  const g = u.ctx.createLinearGradient(0, 0, u.ctx.canvas.width, 0);
  for (const step of plan.steps) {
    // Same-offset stop pairs make a hard step; insertion order picks which
    // color the gradient pads OUTSIDE the pair with (dim on the left of a
    // full step, full on the left of a dim step).
    g.addColorStop(step.at, step.to === 'full' ? dimColor : color);
    g.addColorStop(step.at, step.to === 'full' ? color : dimColor);
  }
  return g;
}

/** @private Re-applies data / visibility / scales / view to the chart. Runs
 *  inside one batch so every change lands in a single synchronous draw and
 *  the scales are current for the annotation pass that follows. */
function syncChart() {
  refreshTokens();
  const sc = ensureScales();
  const refs = currentRefs();
  const shows = computeShows(sc);
  chart.batch(() => {
    if (appliedData === null ||
        appliedData.xs !== refs.xs || appliedData.family !== refs.family ||
        appliedData.ele !== refs.ele || appliedData.hr !== refs.hr ||
        appliedData.cad !== refs.cad || appliedData.temp !== refs.temp ||
        appliedData.power !== refs.power) {
      chart.setData(buildData(refs));
      appliedData = refs;
    }
    if (shows.key !== appliedShows) {
      SERIES_ORDER.forEach((id, i) => {
        chart.series[i + 1].show = shows.map[id];
      });
      appliedShows = shows.key;
    }
    // Explicit scales — uPlot never re-ranges an explicit setScale, so the
    // chart's y mapping IS the full-resolution range profile-data computed,
    // extended so the displayed extremes land on the strip's band rows.
    // Degenerate entries (hi == lo, e.g. a fully paused speed series) never
    // reach the chart: uPlot would skip them and the scale would go stale.
    // Without elevation the ele scale gets an inert [0,1] instead of the
    // previous track's range — the axis size fn collapses it to zero width,
    // and a stale range would keep the axis slot alive after a track swap.
    if (sc.ele) chart.setScale('ele', { min: sc.ele[0], max: sc.ele[1] });
    else chart.setScale('ele', { min: 0, max: 1 });
    for (const def of OVERLAY_METRICS) {
      const entry = sc.overlays.get(def.id);
      if (!entry || !(entry.hi > entry.lo)) continue;
      const key = SCALE_KEY[def.id];
      // The speed family's three views share ONE scale — only the DRAWN
      // variant may define it. GAP's descents amplify speed by 1/minetti,
      // so letting the gap entry write last would widen the speed axis and
      // print GAP's maximum on the speed strip.
      if (key === 'speed' && def.id !== sc.family) continue;
      chart.setScale(key, { min: entry.scale[0], max: entry.scale[1] });
    }
    applyX();
    // Show-flag flips are not auto-committed by uPlot. The second argument
    // re-derives the cached axis tick strings after a style/units/language
    // invalidation (see invalidateChartStyle).
    chart.redraw(false, axesRecalcPending);
    axesRecalcPending = false;
  });
  updateStatePlot();
}

/** @private The x scale IS the visible window (null = the full domain) —
 *  zoom/pan/fit/mode act here, never on the data arrays. */
function applyX() {
  const xs = state.xs;
  const xEnd = xs[xs.length - 1];
  const v0 = state.view ? state.view.start : 0;
  const v1 = state.view ? state.view.end : xEnd;
  if (!appliedX || appliedX[0] !== v0 || appliedX[1] !== v1) {
    chart.setScale('x', { min: v0, max: v1 });
    appliedX = [v0, v1];
  }
}

/** @private Copies uPlot's plot rect (CSS px within #profile-body) into the
 *  shared chart state — every interaction conversion (clientXtoX, xvToPx)
 *  and every DOM overlay position keeps working unchanged. */
function updateStatePlot() {
  if (!chart) return;
  pxRatio = chartPxRatio();
  const bb = chart.bbox;
  state.plot = {
    x0: bb.left / pxRatio,
    y0: bb.top / pxRatio,
    w: bb.width / pxRatio,
    h: bb.height / pxRatio,
  };
}

/** @private uPlot's bbox is in device pixels — derive the ratio from its
 *  canvas rather than trusting devicePixelRatio to have stood still. */
function chartPxRatio() {
  const can = chart.ctx.canvas;
  return can.clientWidth > 0 ? can.width / can.clientWidth : 1;
}

/** @private Theme snapshot for the per-draw color functions. */
function refreshTokens() {
  const css = getComputedStyle(document.documentElement);
  const token = (name) => css.getPropertyValue(name).trim();
  const dim = Number.parseFloat(token('--profile-series-dim'));
  tokens = {
    line: token('--profile-line'),
    accent: token('--accent'),
    accentStrong: token('--accent-strong'),
    text: token('--foreground-muted'),
    grid: token('--border'),
    surface: token('--surface-elevated'),
    hr: token('--series-hr'),
    speed: token('--series-speed'),
    cadence: token('--series-cadence'),
    temp: token('--series-temp'),
    power: token('--series-power'),
    waypoint: token('--map-waypoint'),
    handleBorder: token('--map-handle-border'),
    // The curves' and grid lines' opacity OUTSIDE the selected sector
    // (clamped; a missing or malformed token falls back to the light value —
    // the token itself carries the per-theme tuning).
    dimAlpha: Number.isFinite(dim) ? Math.min(Math.max(dim, 0), 1) : 0.25,
    zone: [1, 2, 3, 4, 5].map((i) => token(`--hr-zone-${i}`)),
  };
  for (const [prop, key] of Object.entries(TEXT_TOKEN)) {
    tokens[key] = token(prop);
  }
}

function monoFont() {
  const css = getComputedStyle(document.documentElement);
  return `10px ${css.getPropertyValue('--font-mono') || 'monospace'}`;
}

// ---------------------------------------------------------------------------
// Annotation canvas — WaySlice's business layers over the uPlot chart.
// ---------------------------------------------------------------------------

/** @private One annotation pass: axis strip → waypoint pins → hover/probe
 *  crosshair → DOM sector handles (the old sync()'s draw order above the
 *  chart layers). All positions derive from the same state.plot/xvToPx
 *  mapping the interaction layer uses, or from uPlot's y scales. */
function drawAnnotation() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!state.track || !chart) return;
  drawOverlayStrip();
  drawWaypointPins();
  drawHoverCrosshair();
  positionHandles();
}

/** @private y pixel (CSS px, annotation-canvas space) of a value on one of
 *  the chart's scales — the same mapping the drawn series use. */
function pyOf(val, scaleKey) {
  return chart.bbox.top / pxRatio + chart.valToPos(val, scaleKey, false);
}

/** @private Horizontal right-hand axis strip for the visible overlays. Every
 *  series contributes one column — its max reading on the top row, its min
 *  on the bottom row — laid out left→right in the same order as the selected
 *  overlays, right-aligned to the plot edge. Labels render in the series
 *  TEXT tokens and are haloed with the surface color; the strip stays pinned
 *  to the plot edge and deliberately does NOT dodge the sector handles
 *  (overlap accepted by design, user decision 2026-09-27). Readings come
 *  from the chart's own scales — the exact full-resolution ranges. */
function drawOverlayStrip() {
  const entries = [];
  for (const id of state.selectedOverlays) {
    // Same gate as the drawn curve: the series show flag, so a series with
    // no usable scale (no readings) contributes no strip column either.
    if (!chart.series[SERIES_INDEX[SCALE_KEY[id]]].show) continue;
    const entry = scalesCache?.overlays.get(id);
    if (!entry) continue;
    const def = OVERLAY_METRICS.find((d) => d.id === id);
    // The DISPLAYED extremes — the values the curve tops out / bottoms out
    // at on the band rows (the scale range itself carries extra headroom).
    entries.push({ def, lo: entry.lo, hi: entry.hi });
  }
  if (!entries.length) return;

  const { track } = state;
  let yTop;
  let yBottom;
  if (track.hasElevation && scalesCache?.ele) {
    // The rows sit on the DATA extremes (the grid rows uPlot drew).
    yTop = pyOf(track.eleMax, 'ele');
    yBottom = pyOf(track.eleMin, 'ele');
  } else {
    yTop = state.plot.y0 + 8;
    yBottom = state.plot.y0 + state.plot.h - 8;
  }

  ctx.font = monoFont();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const GAP = 14;
  const PAD = 4;
  const columns = entries.map(({ def, lo, hi }) => {
    const hiText = formatOverlayValue(def, hi);
    const loText = formatOverlayValue(def, lo);
    return {
      color: tokens[TEXT_TOKEN[def.textToken]],
      hiText, loText,
      w: Math.max(ctx.measureText(hiText).width, ctx.measureText(loText).width),
    };
  });
  const totalW = columns.reduce((sum, c) => sum + c.w, 0) + GAP * (columns.length - 1);
  let x = Math.max(state.plot.x0 + PAD, state.plot.x0 + state.plot.w - PAD - totalW);
  for (const col of columns) {
    const label = (text, ty) => {
      ctx.lineWidth = 3;
      ctx.strokeStyle = tokens.surface;
      ctx.strokeText(text, x, ty);
      ctx.fillStyle = col.color;
      ctx.fillText(text, x, ty);
    };
    label(col.hiText, yTop);
    label(col.loText, yBottom);
    x += col.w + GAP;
  }
}

/** @private Waypoint annotations on the profile — the map's pins in profile
 *  form: a violet dot riding the elevation curve (mid-height when the track
 *  has no elevation). No standing vertical line: the only violet line is the
 *  thick one drawn while a map pin is hovered. Follows the map's waypoint
 *  toggle and the visible x window. */
function drawWaypointPins() {
  if (!state.waypointsShown || !state.profileWaypoints.length) return;
  const { track, view, xs, plot } = state;
  const xEnd = xs[xs.length - 1];
  const v0 = view ? view.start : 0;
  const v1 = view ? view.end : xEnd;
  const px = (v) => xvToPx(v, view, xs, plot);
  const yMid = plot.y0 + plot.h / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.x0, plot.y0, plot.w, plot.h);
  ctx.clip();
  for (const wp of state.profileWaypoints) {
    const xv = distToX(wp.dist, track, state.xMode);
    if (xv < v0 || xv > v1) continue;
    const pt = pointAtDistance(track, wp.dist);
    const py = pt && pt.ele != null ? pyOf(pt.ele, 'ele') : yMid;
    ctx.beginPath();
    ctx.arc(px(xv), py, 4, 0, Math.PI * 2);
    ctx.fillStyle = tokens.waypoint;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = tokens.handleBorder;
    ctx.stroke();
  }
  ctx.restore();
}

/** @private True while a clicked waypoint's pinned line owns the chart. The
 *  pin stands down while the chart's own mouse hover is live — the hover
 *  crosshair + readout take over and the violet line returns when the
 *  pointer leaves the chart — and while a waypoint pin is hovered on the
 *  MAP, whose own violet line takes its place. The pin itself only ever
 *  changes on a waypoint click (it switches) or a click anywhere else
 *  (it clears); at most one waypoint is pinned at a time. */
function pinOwnsChart() {
  if (!state.pinnedWaypoint) return false;
  if (state.hoverOrigin === 'profile' && state.hoverX != null) return false;
  if (state.hoverOrigin === 'waypoint' && state.waypointHover) {
    // Yield only while the hovered waypoint can actually be drawn — a hover
    // outside the zoomed window keeps the pin on the chart (its line and
    // readout would otherwise vanish with nothing in their place).
    const xv = distToX(state.waypointHover.dist, state.track, state.xMode);
    const v0 = state.view ? state.view.start : 0;
    const v1 = state.view ? state.view.end : state.xs[state.xs.length - 1];
    if (xv >= v0 && xv <= v1) return false;
  }
  return true;
}

/** @private Hover crosshair drawn on the annotation canvas: hairline + white
 *  dot with an orange ring on the profile line (kept visible over the orange
 *  stroke), and a smaller solid series-colored dot where the hairline crosses
 *  the drawn heart-rate curve — interpolated on the SAME full-resolution
 *  series uPlot strokes, so the dot sits exactly on the visible line. A
 *  waypoint pin hover on the MAP draws a thicker violet line instead. */
function drawHoverCrosshair() {
  const { track, plot, view, xs, hoverDist, hoverX, hoverOrigin } = state;
  if (!track) return;
  const { y0, h } = plot;
  const xEnd = xs[xs.length - 1] || 1;
  const v0 = view ? view.start : 0;
  const v1 = view ? view.end : xEnd;

  // Pinned waypoint (clicked): its violet line + readout stay on the chart
  // until the next click anywhere — except while the pointer hovers the chart
  // itself (the hover crosshair + cursor readout take over) or while another
  // waypoint pin is hovered on the map (that waypoint's violet line takes
  // over); the pin yields either way and comes back when the pointer moves
  // off (see pinOwnsChart).
  if (pinOwnsChart()) {
    const xv = distToX(state.pinnedWaypoint.dist, track, state.xMode);
    if (xv >= v0 && xv <= v1) {
      const px = xvToPx(xv, view, xs, plot);
      ctx.strokeStyle = tokens.waypoint;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(px, y0);
      ctx.lineTo(px, y0 + h);
      ctx.stroke();
    }
    showTooltipAt(state.pinnedWaypoint.dist, null, state.pinnedWaypoint.name);
    return;
  }

  // Profile hover: pin the crosshair to the mouse (raw x). Map hover: pin it
  // to the hovered track point (distance → x); outside the zoomed window
  // there is nothing to pin on. Same derivation the active-band highlight
  // uses, so crosshair, dot and highlight always agree on the position.
  // A touch probe takes the crosshair's place while active (it is created by
  // touch only, so the two cursors never fight over a mouse): same hairline +
  // elevation dot + HR intersection dot, anchored to the probe's DATA
  // position (survives pan/zoom/mode switches); its readings render into the
  // fixed telemetry band between the profile header and the chart
  // (coarse-pointer devices) or the floating fallback box (see showTooltipAt
  // / CSS).
  const probe = state.probe;
  const xv = probe ? distToX(probe.dist, track, state.xMode) : currentHoverXv();
  if (xv == null) return;
  if (xv < v0 || xv > v1) {
    // Out of the zoomed window there is nothing to pin on; the readouts must
    // not linger from the last in-view frame — the band falls back to its
    // idle hint until the probe is visible again.
    if (probe) {
      hideTooltip(true);
      resetProbeReadout();
    }
    return;
  }
  const px = xvToPx(xv, view, xs, plot);
  const isWaypoint = !probe && hoverOrigin === 'waypoint';
  const hoverLineColor = isWaypoint ? tokens.waypoint : tokens.accentStrong;
  ctx.strokeStyle = hoverLineColor;
  ctx.lineWidth = isWaypoint ? 3 : 1;
  ctx.beginPath();
  ctx.moveTo(px, y0);
  ctx.lineTo(px, y0 + h);
  ctx.stroke();
  const d = probe ? probe.dist : (hoverDist != null ? hoverDist : xToDist(hoverX, track, xs));
  if (track.hasElevation) {
    const pt = pointAtDistance(track, d);
    if (pt && pt.ele != null) {
      const py = pyOf(pt.ele, 'ele');
      ctx.fillStyle = tokens.surface;
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = hoverLineColor;
      ctx.stroke();
    }
  }
  // Intersection dot on the heart-rate curve — a solid series-colored point
  // where the crosshair crosses the polyline: a touch wider than the 1.5 px
  // curve, clearly smaller than the elevation hover dot above. Interpolated
  // across the same span the drawn line bridges, so it sits on the line the
  // eye sees; over a leading/trailing run of missing readings there is no
  // line and no dot. None when the hr curve is hidden.
  const hrReading = hrAtXv(xv);
  if (hrReading != null) {
    const py = pyOf(hrReading, 'hr');
    ctx.fillStyle = tokens.hr;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  if (probe) {
    // The probe readout: same tooltip pipeline (data, formatters, locale) as
    // the desktop hover; `{ probe: true }` routes it into the fixed band
    // between the profile header and the chart (or the floating fallback
    // where the band does not exist — see showTooltipAt / profile.css).
    showTooltipAt(probe.dist, xv, null, { probe: true });
    return;
  }
  if (hoverOrigin !== 'profile') {
    // Crosshair drawn from a map hover; tooltip follows the same position.
    showTooltipAt(hoverDist, null, state.waypointHover && state.waypointHover.dist === hoverDist ? state.waypointHover.name : null);
  }
}

/** @private The hr series value under raw x, interpolated along the exact
 *  segment the drawn hr polyline covers there (null readings are bridged by
 *  spanGaps — the dot follows the bridge). None when the hr curve is hidden. */
function hrAtXv(xv) {
  if (!chart || !chart.series[SERIES_INDEX.hr].show || chart.scales.hr?.min == null) return null;
  const hr = trackSeries(state.track).hr;
  const xs = state.xs;
  let [i0, i1] = bracketX(xv, xs);
  while (i0 > 0 && !finiteAt(hr, i0)) i0--;
  while (i1 < xs.length - 1 && !finiteAt(hr, i1)) i1++;
  const a = hr[i0];
  const b = hr[i1];
  if (!finiteAt(hr, i0) || !finiteAt(hr, i1)) return null;
  if (xs[i1] <= xs[i0]) return a;
  const frac = Math.min(Math.max((xv - xs[i0]) / (xs[i1] - xs[i0]), 0), 1);
  return a + (b - a) * frac;
}

/** @private */
function finiteAt(arr, i) {
  return arr[i] != null && Number.isFinite(arr[i]);
}

/** @private Binary search: the two x-cache entries bracketing raw x. */
function bracketX(xv, xs) {
  const last = xs.length - 1;
  if (xv <= xs[0]) return [0, 0];
  if (xv >= xs[last]) return [last, last];
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < xv) lo = mid; else hi = mid;
  }
  return [lo, hi];
}

/** @private Raw x under the current hover — the cursor's raw x for profile
 *  hovers, the hovered position's x for map/waypoint hovers; null when
 *  nothing is hovered. Shared by the crosshair (drawHoverCrosshair) and the
 *  active zone-band highlight so both always agree on the position. */
function currentHoverXv() {
  if (state.hoverDist == null) return null;
  if (state.hoverOrigin === 'profile' && state.hoverX != null) return state.hoverX;
  return distToX(state.hoverDist, state.track, state.xMode);
}

// ---------------------------------------------------------------------------
// uPlot hooks — drawn inside uPlot's device-pixel canvas space, so they
// layer exactly with the series (bands beneath, reference line above).
// ---------------------------------------------------------------------------

/**
 * Heart-rate zone bands — five VERY faint horizontal strips behind the HR
 * curve, one per zone of the user's configured ranges (read only — never
 * recomputed here). Each strip spans exactly its bpm range mapped through
 * the HR overlay's own y scale (the same mapping uPlot strokes the curve
 * with), so it sits precisely where its bpm values plot; zones outside the
 * visible scale contribute nothing and the open-topped zone 5 is clipped at
 * the scale's high end — the axis itself is never widened.
 *
 * While hovering, the band containing the hover dot's bpm reading is tinted
 * about twice as deep (ACTIVE_BAND_ALPHA) — still background, but the eye
 * can read the active zone; without a hover every band keeps BAND_ALPHA.
 * Both features are gated by the settings drawer's display toggles
 * (js/metrics/heartRateDisplay.js): showZones hides the bands entirely, and
 * the hover highlight additionally requires the highlight toggle — neither
 * toggle widens the hr scale or turns the HR overlay on by itself.
 */
function drawZoneBands(u) {
  if (!state.track) return;
  const sc = u.scales.hr;
  if (!sc || sc.min == null || !u.series[SERIES_INDEX.hr].show) return;
  const display = getHeartRateDisplay();
  if (!display.showZones) return;
  const bounds = computeZoneBounds(loadHeartRateSettings());
  if (!bounds) return;
  const hrEntry = scalesCache?.overlays.get('hr');
  if (!hrEntry) return;
  const active = display.highlight
    ? hrHoverZone(bounds, state.probe ? state.probe.dist : state.hoverDist)
    : null;
  const c = u.ctx;
  const { left, width } = u.bbox; // device px
  const yOf = (bpm) => u.valToPos(bpm, 'hr', true); // device px, absolute
  for (let i = 0; i < 5; i++) {
    // Clamp to the DISPLAYED hr extremes (the curve's own band rows), not
    // the extended scale bounds — zone 5's open top ends on the top row,
    // exactly where the old renderer clipped it.
    const zLo = Math.max(bounds.zones[i].lo, hrEntry.lo);
    const zHi = Math.min(bounds.zones[i].hi ?? hrEntry.hi, hrEntry.hi);
    if (zHi - zLo < 1e-9) continue;
    c.globalAlpha = i === active ? ACTIVE_BAND_ALPHA : BAND_ALPHA;
    c.fillStyle = tokens.zone[i];
    c.fillRect(left, yOf(zHi), width, yOf(zLo) - yOf(zHi));
  }
  c.globalAlpha = 1;
}

/**
 * @private The 0-based band index containing the inspected HR reading, or
 * null — derived through the SAME reading path as the tooltip's zone label
 * (nearest track point's heart rate, classified against the configured
 * zones), so the deepened band always matches the label the tooltip shows.
 * Follows the touch probe's position while one is active, else the hover.
 * No highlight while a pinned waypoint owns the chart (hover stands down
 * then) or over points without a reading.
 * @param {{zones: {lo: number, hi: number|null}[]}} bounds
 * @param {number|null} dist  inspected track distance (probe or hover)
 */
function hrHoverZone(bounds, dist) {
  const { track } = state;
  if (pinOwnsChart() || dist == null || !track) return null;
  const pt = pointAtDistance(track, dist);
  if (!pt) return null;
  const idx = pt.t < 0.5 ? pt.i : Math.min(pt.i + 1, track.pointCount - 1);
  const v = track.points[idx].hr;
  if (v == null || !Number.isFinite(v)) return null;
  const zone = classifyHr(v, bounds);
  return zone > 0 ? zone - 1 : null;
}

/**
 * No-elevation reference — the flat dashed line that keeps the axis usable
 * when the track carries no elevation data (the elevation series is hidden;
 * overlays still draw). Drawn in uPlot's `draw` hook so it sits ABOVE the
 * series, where the old renderer painted it.
 */
function drawFlatReference(u) {
  if (!state.track || state.track.hasElevation) return;
  const c = u.ctx;
  const { left, top, width, height } = u.bbox;
  c.strokeStyle = tokens.line;
  c.setLineDash([4, 4]);
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(left, top + height / 2);
  c.lineTo(left + width, top + height / 2);
  c.stroke();
  c.setLineDash([]);
}

/**
 * The x grid lines, drawn by hand instead of uPlot's native full-height
 * grid (disabled in the axis config): with elevation the lines start on the
 * TOP elevation row — the scale pads ~8% above it, and a gridline crossing
 * that headless stretch reads as a stray segment sticking out of the grid —
 * and run down to the plot bottom as before. Without elevation there are no
 * rows to anchor to, so the lines keep spanning the full plot height.
 * Same cycle stage as the zone bands (device-pixel canvas space, beneath
 * every series).
 */
function drawXGrid(u) {
  const c = u.ctx;
  const { left, top, width, height } = u.bbox; // device px
  const hasRows = state.track?.hasElevation && !!scalesCache?.ele;
  const y0 = hasRows ? u.valToPos(state.track.eleMax, 'ele', true) : top; // device px, absolute
  // The same selection gradient the series and the elevation rows stroke
  // with: a vertical line takes the gradient's color at its own x, so a
  // tick outside the sector dims with everything else under it.
  c.strokeStyle = selectionStroke(u, tokens.grid);
  // Same width the native grid draws (uPlot's default 2, scaled the same
  // way) — the hand-drawn verticals must be indistinguishable from the
  // horizontal rows uPlot still draws itself.
  c.lineWidth = u.axes[0].grid.width * u.pxRatio;
  c.beginPath();
  for (const v of xTickValues(u.scales.x.min, u.scales.x.max)) {
    const x = u.valToPos(v, 'x', true); // device px, absolute
    if (x < left || x > left + width) continue;
    c.moveTo(x, y0);
    c.lineTo(x, top + height);
  }
  c.stroke();
}

// ---------------------------------------------------------------------------
// Axis ticks — the same 1/2/5×10^k rule and formatters the canvas renderer
// used, fed to uPlot as split/value functions.
// ---------------------------------------------------------------------------

/** @private X ticks over the visible window, strictly inside it (a tick at
 *  the exact window start is not drawn — the old loop's rule). The grid
 *  step re-rounds into the display unit's own ladder: distance grids in
 *  whole km / miles / feet, time grids on the duration ladder (whole
 *  minutes / hours — a milliseconds 1/2/5 ladder formats as 1:23:20). */
function xTickValues(min, max) {
  const vw = max - min;
  if (!(vw > 1e-9)) return [];
  const step = state.xMode === 'time'
    ? niceTimeStep(vw / 5000) * 1000 // ladder returns seconds; the loop is ms
    : niceStepForUnit(niceStep(vw / 5), getUnitSystem());
  const out = [];
  for (let v = (Math.floor(min / step) + 1) * step; v <= max; v += step) out.push(v);
  return out;
}

/** @private Offscreen 2d context for text measurement (never painted). */
let measureCtx = null;

/** @private The y-axis gutter: the widest CURRENT tick label + the label
 *  gap + a small pad, floored at 58 (the old fixed width, kept for short
 *  labels so the common layout doesn't breathe). uPlot clips axis text at
 *  the canvas edge, so a fixed 58 cut leading digits off labels that grew
 *  past it — extreme-altitude imperial elevations, five grouped digits
 *  wide. uPlot hands the size fn the axis's own tick strings; a
 *  language/unit flip re-converges through the recalcAxes flag
 *  (invalidateChartStyle), so the gutter always fits the live labels. */
function yAxisGutter(labels) {
  let w = 58;
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = monoFont();
  for (const label of labels ?? []) {
    w = Math.max(w, Math.ceil(measureCtx.measureText(label).width) + 12);
  }
  return w;
}

/** @private X tick labels — distance or elapsed time, per current mode. */
function formatXTick(v) {
  return state.xMode === 'time' ? formatDuration(v / 1000) : formatDistanceShort(v);
}

/** @private Elevation rows anchored to the DATA extremes and the midpoint —
 *  the top row IS the track's highest point, so no label claims an
 *  elevation the curve doesn't reach. Empty when there is no elevation. */
function eleTickValues() {
  const track = state.track;
  if (!track || !track.hasElevation || !scalesCache?.ele) return [];
  return [track.eleMax, (track.eleMin + track.eleMax) / 2, track.eleMin];
}

// ---------------------------------------------------------------------------
// Sizing, DOM overlays, error state
// ---------------------------------------------------------------------------

/** Sizes the annotation canvas backing store for devicePixelRatio and keeps
 *  the uPlot chart at the same CSS size (setSize never destroys it). */
export function resizeCanvas() {
  const { root, canvas: cv } = state.dom;
  const rect = root.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.max(1, Math.round(rect.width * dpr));
  cv.height = Math.max(1, Math.round(rect.height * dpr));
  cv.style.width = `${rect.width}px`;
  cv.style.height = `${rect.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (chart) {
    chart.setSize({ width: Math.max(10, Math.round(rect.width)), height: Math.max(10, Math.round(rect.height)) });
    updateStatePlot();
  } else {
    state.plot = {
      x0: MARGIN.left,
      y0: MARGIN.top,
      w: Math.max(10, rect.width - MARGIN.left - MARGIN.right),
      h: Math.max(10, rect.height - MARGIN.top - MARGIN.bottom),
    };
  }
}

/** @private Positions the DOM handles + their ARIA values. */
function positionHandles() {
  if (!state.track) return;
  const xEnd = state.xs[state.xs.length - 1];
  const v0 = state.view ? state.view.start : 0;
  const v1 = state.view ? state.view.end : xEnd;
  const { start, end } = sectorStore.get();
  const place = (el, dist, key) => {
    const xv = distToX(dist, state.track, state.xMode);
    const px = xvToPx(xv, state.view, state.xs, state.plot);
    // A boundary outside the zoom window would sit at a misleading screen
    // spot (its target is not visible); hide until the window includes it.
    el.style.visibility = xv < v0 || xv > v1 ? 'hidden' : 'visible';
    el.style.transform = `translateX(${px}px)`;
    el.setAttribute('aria-valuemin', '0');
    el.setAttribute('aria-valuemax', String(Math.round(state.track.totalDistance)));
    el.setAttribute('aria-valuenow', String(Math.round(dist)));
    el.setAttribute('aria-valuetext', formatDistanceShort(dist));
    el.setAttribute('aria-label', t(key));
  };
  if (handles.start) place(handles.start, start, 'sectorStart');
  if (handles.end) place(handles.end, end, 'sectorEnd');
}

/** Handle accessible names (re-applied on language change). */
export function refreshHandleLabels() {
  if (handles.start) handles.start.setAttribute('aria-label', t('sectorStart'));
  if (handles.end) handles.end.setAttribute('aria-label', t('sectorEnd'));
}

// ---------------------------------------------------------------------------
// Lazy-load failure state — restrained: a muted note inside the profile
// module, the error itself in the console, the rest of WaySlice unaffected.
// The next explicit render trigger retries (the loader resets its cache).
// ---------------------------------------------------------------------------

/** @private */
function showChartError(error) {
  console.error('[profile] uPlot failed to load:', error);
  if (!errorEl) {
    errorEl = document.createElement('div');
    errorEl.className = 'profile-chart-error';
    state.dom.root.appendChild(errorEl);
  }
  errorEl.textContent = t('profileChartError');
  errorEl.hidden = false;
}

/** @private */
function hideChartError() {
  if (errorEl && !errorEl.hidden) errorEl.hidden = true;
}
