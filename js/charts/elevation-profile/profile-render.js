/**
 * Elevation profile — the canvas renderer.
 *
 * One full-redraw pass (`sync`) paints every layer in a fixed order:
 * x ticks → very faint HR zone bands → overlay curves (HR, speed/pace/GAP,
 * cadence, temperature, power) → elevation band + sector highlight →
 * waypoint pins → hover crosshair. Min–max
 * downsampling per pixel column keeps 100k-point tracks fast and faithful.
 *
 * Every drawn element is positioned from a per-point x array (`xs`), so the
 * two x-axis modes are aligned by TRACK POINT, never by screen position:
 *
 *   distance mode → x = cumulative distance (m)
 *   time mode     → x = elapsed time since the first point (ms)
 *
 * Each visible overlay is auto-scaled over the FULL track (global y scale —
 * zooming only stretches the x axis) and keeps its own right-hand scale
 * labels. While the heart-rate curve is shown, the five configured zones
 * shade the plot as very faint horizontal bands, mapped through the hr
 * scale exactly like the curve's y values; the hover crosshair gains a
 * small solid dot where it crosses the drawn hr polyline.
 *
 * Rendering is stateless over the shared chart state (profile-state.js) +
 * the pure sampling math (profile-data.js); the interaction layer triggers
 * redraws exclusively through scheduleSync().
 */
import { sectorStore } from '../../sector/sectorStore.js';
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
  OVERLAY_METRICS, SPEED_FAMILY, sampleOverlay, sampleElevation, overlayValueAt,
  seriesExtremes, distToX, xToDist, formatOverlayValue,
} from './profile-data.js';
import { showTooltipAt, hideTooltip, resetProbeReadout } from './profile-tooltip.js';

const MARGIN = { left: 58, right: 14, top: 4, bottom: 22 };

// Zone band tint. The band under the hover dot is drawn about twice as deep
// so the eye reads the active zone — still faint, still background.
// Values are hand-picked by creator.
const BAND_ALPHA = 0.22;
const ACTIVE_BAND_ALPHA = 0.54;

// Bound once by initRender — the DOM assets never change afterwards.
let ctx = null;
let canvas = null;
let handles = null;
let masks = null;

/** rAF-batched redraw flag. @private */
let syncPending = false;
// Sampled heart-rate curve + scale for the hover intersection dot; null
// whenever the hr curve is not currently drawn. @private
let hrHoverCurve = null;
// Cached Pass-1 overlay sampling, keyed by (track, x-mode, plot width,
// overlay selection). Hover, probe and handle frames redraw from it without
// re-reading any track point. @private
let overlaySamples = null;
// Overlay curves map their values between these two y rows — the same rows
// the axis strip labels sit on — so a curve can never paint past its axis
// label. sync() sets them before pass 2: from the elevation grid rows (top
// row = the track's highest point) or the fixed 8 px inset without one.
let overlayYTop = 0;
let overlayYBottom = 0;
/** @private y position for an overlay value between the axis strip rows. */
function overlayYOf(v, lo, hi) {
  return overlayYBottom - ((v - lo) / (hi - lo)) * (overlayYBottom - overlayYTop);
}

/** Binds the canvas-side DOM assets and creates the sector veils. */
export function initRender() {
  ({ canvas, ctx } = state.dom);
  handles = state.dom.handles;
  masks = state.dom.masks;
  masks.left = createMask();
  masks.right = createMask();
}

/** @private One transparent veil over the area outside the sector handles
 *  (see .profile-mask in profile.css). */
function createMask() {
  const m = document.createElement('div');
  m.className = 'profile-mask';
  m.hidden = true;
  state.dom.root.appendChild(m);
  return m;
}

/** rAF-batched redraw. */
export function scheduleSync() {
  if (syncPending) return;
  syncPending = true;
  requestAnimationFrame(() => {
    syncPending = false;
    sync();
  });
}

/** @private Full redraw: axes, elevation bands, overlays, handles, hover. */
export function sync() {
  if (!state.track) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    positionHandles();
    return;
  }
  const { track, xs, view, plot } = state;
  const css = getComputedStyle(document.documentElement);
  const color = (name) => css.getPropertyValue(name).trim();
  const cMuted = color('--profile-line');
  const cAccent = color('--accent');
  const cAccentStrong = color('--accent-strong');
  const cText = color('--foreground-muted');
  const cGrid = color('--border');
  const cSurface = color('--surface-elevated');

  const { x0, y0, w, h } = plot;
  const xEnd = xs[xs.length - 1];
  // Every x position maps through the visible window (`view`, null = full
  // track). Zooming stretches the horizontal axis only.
  const v0 = view ? view.start : 0;
  const v1 = view ? view.end : xEnd;
  const vw = Math.max(v1 - v0, 1e-9);
  const x = (v) => x0 + ((v - v0) / vw) * w;

  // Elevation y domain: ~8% headroom above and below the data. The three
  // grid rows anchor to the DATA extremes and the midpoint — the top row IS
  // the track's highest point — so a curve can never rise past its axis
  // label. The rows double as the overlay axis strip baselines and the
  // overlay curves' y range (overlayYTop/overlayYBottom below).
  let yGridTop = y0 + 8;
  let yGridBottom = y0 + h - 8;
  let gridRows = null;
  let y = null;
  if (track.hasElevation) {
    const elePad = Math.max((track.eleMax - track.eleMin) * 0.08, 4);
    const eleMin = track.eleMin - elePad;
    const eleMax = track.eleMax + elePad;
    y = (ele) => y0 + (1 - (ele - eleMin) / (eleMax - eleMin)) * h;
    gridRows = [
      { ele: track.eleMax, py: y(track.eleMax) },
      { ele: (track.eleMin + track.eleMax) / 2, py: y((track.eleMin + track.eleMax) / 2) },
      { ele: track.eleMin, py: y(track.eleMin) },
    ];
    yGridTop = gridRows[0].py;
    yGridBottom = gridRows[gridRows.length - 1].py;
  }
  overlayYTop = yGridTop;
  overlayYBottom = yGridBottom;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = '10px ' + (css.getPropertyValue('--font-mono') || 'monospace');

  // X ticks — distance or elapsed time, per current mode, over the window.
  if (vw > 1e-9) {
    const step = niceStep(vw / 5);
    // Vertical rules start at the top y grid line (the data-maximum row when
    // elevation exists) so no stub pokes into the headroom above it; without
    // elevation there is no y grid, keep the full height.
    const tickTop = track.hasElevation ? yGridTop : y0;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let v = (Math.floor(v0 / step) + 1) * step; v <= v1; v += step) {
      ctx.strokeStyle = cGrid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x(v), tickTop);
      ctx.lineTo(x(v), y0 + h);
      ctx.stroke();
      ctx.fillStyle = cText;
      const label = state.xMode === 'time' ? formatDuration(v / 1000) : formatDistanceShort(v);
      ctx.fillText(label, x(v), y0 + h + 5);
    }
  }

  const { start, end } = sectorStore.get();
  const xsStart = distToX(start, track, state.xMode);
  const xsEnd = distToX(end, track, state.xMode);

  // Overlays (drawn for both elevation and no-elevation tracks). Sampled
  // over the full track — the global scale promised in the header — but
  // clipped to the plot so a zoomed window never paints into the margins.
  const visible = state.selectedOverlays.filter((id) => !state.hiddenOverlays.has(id));
  // Pass 1 reads EVERY track point per overlay (plus one full per-point scan
  // per speed-family overlay for the axis strip top) and depends only on
  // (track, x-mode, plot width, overlay selection) — none of which a hover,
  // probe or handle move changes. So it is cached: hover/probe/handle frames
  // redraw from the stored samples instead of re-reading the track.
  const cols = Math.max(2, Math.round(w));
  const visibleKey = visible.join('|');
  if (!overlaySamples ||
      overlaySamples.track !== track ||
      overlaySamples.xMode !== state.xMode ||
      overlaySamples.cols !== cols ||
      overlaySamples.visibleKey !== visibleKey) {
    overlaySamples = sampleVisibleOverlays(visible, cols, xEnd);
  }
  const { overlayScale, axisEntries, hrEntry } = overlaySamples;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, w, h);
  ctx.clip();
  // Pass 2 — the zone bands sit beneath every curve (drawn first), mapped
  // through the heart-rate scale exactly like drawOverlayLine's y values.
  // The sampled hr curve doubles as the hover-dot source, so the crosshair's
  // intersection marker — and the highlighted band under it — land on the
  // very polyline the eye sees.
  hrHoverCurve = hrEntry
    ? { vals: hrEntry.vals, colW: xEnd / hrEntry.vals.length, lo: hrEntry.lo, hi: hrEntry.hi }
    : null;
  drawHrZoneBands(overlayScale.get('hr'), zoneBandColors(css));
  for (const { def, lo, hi, vals } of axisEntries) {
    drawOverlayLine(vals, 0, xEnd, x, lo, hi, color(def.colorToken));
  }
  ctx.restore();

  // The area outside the sector handles is dimmed by two transparent DOM
  // veils (see .profile-mask) — kept in sync with the sector boundaries.
  placeMasks();

  if (!track.hasElevation) {
    // No elevation data: a flat dashed reference line keeps the axis usable.
    ctx.strokeStyle = cMuted;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + h / 2);
    ctx.lineTo(x0 + w, y0 + h / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    drawWaypointPins(v0, v1, x, null);
    positionHandles();
    drawHover(cAccentStrong, cSurface);
    drawOverlayAxes(axisEntries, cSurface, yGridTop, yGridBottom);
    return;
  }

  // Horizontal grid + y labels. The top/bottom rows sit at the DATA
  // extremes (the padded domain above/below them is pure headroom), so the
  // labels never claim an elevation the curve doesn't reach. The rows double
  // as the baseline rows for the horizontal overlay axis strip, so both
  // sides read on the same lines.
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const { ele, py } of gridRows) {
    ctx.strokeStyle = cGrid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, py);
    ctx.lineTo(x0 + w, py);
    ctx.stroke();
    ctx.fillStyle = cText;
    ctx.fillText(formatElevation(Math.round(ele)), x0 - 8, py);
  }
  if (axisEntries.length) {
    drawOverlayAxes(axisEntries, cSurface, yGridTop, yGridBottom);
  }

  // Full profile band over the visible window, then the sector highlight —
  // clipped to the window intersection so an out-of-view sector boundary
  // never drags the highlight off-plot.
  const full = sampleElevation(track, xs, v0, v1, Math.max(2, Math.round(w)));
  drawBand(full, v0, x, y, cMuted, 0.14, cMuted, 1.5);
  const sA = Math.max(xsStart, v0);
  const sB = Math.min(xsEnd, v1);
  if (sB > sA) {
    const secCols = Math.max(2, Math.round(x(sB) - x(sA)));
    const sec = sampleElevation(track, xs, sA, sB, secCols);
    drawBand(sec, sA, x, y, cAccent, 0.22, cAccent, 2);
  }

  drawWaypointPins(v0, v1, x, y);
  positionHandles();
  drawHover(cAccentStrong, cSurface);
}

/**
 * Pass 1 — sample and scale every visible overlay. Deterministic per
 * (track, x-mode, plot width, overlay selection): sampling always spans the
 * FULL track (the global y scale promised in the header — zooming stretches
 * the x axis only, at draw time), so the zoom window and the hover/probe
 * position are deliberately not inputs. sync() caches this — hover frames
 * reuse the result; a new track, axis mode, resize or overlay toggle
 * recomputes it once.
 * @param {string[]} visible  overlay ids, in selection order
 * @param {number} cols  plot width in pixel columns
 * @param {number} xEnd  track-final x value in the current mode
 * @returns {{overlayScale: Map<string, {lo: number, hi: number, idx: number, def: object}>,
 *            axisEntries: object[], hrEntry: object|null}}
 * @private
 */
function sampleVisibleOverlays(visible, cols, xEnd) {
  const overlayScale = new Map();
  const axisEntries = [];
  const { track, xs } = state;
  for (let idx = 0; idx < visible.length; idx++) {
    const def = OVERLAY_METRICS.find((d) => d.id === visible[idx]);
    const valueAt = overlayValueAt(def.id, track, state);
    if (!valueAt) continue;
    const vals = sampleOverlay(0, xEnd, cols, valueAt, xs);
    let lo = Infinity, hi = -Infinity;
    for (const v of vals) {
      if (v == null) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
    // A near-constant series (fresh legs on a flat loop!) has a range of
    // ~0 — padding on the range alone would stretch GPS rounding noise into
    // a full-height zigzag, so pad at least 4% of the series mean.
    // bpm/rpm/speed are physically non-negative — keep the scale above zero.
    // The speed family's axis strip is read as "this curve tops out at X" —
    // and after the spike clean that top IS a real value worth comparing
    // against the metrics list — so its top stays at the series maximum,
    // read PER POINT: the column means above dilute a narrow peak with its
    // neighbors, which could round the strip below the Maximum Speed the
    // list reports (width-dependently, up to a whole display step). Every
    // other overlay keeps the padded top: bpm/watt spikes are dropped, not
    // interpolated, and their scales have never promised to end at the data
    // maximum.
    if (SPEED_FAMILY.includes(def.id)) {
      const pt = seriesExtremes(valueAt, track.pointCount);
      if (pt) hi = pt.hi;
    }
    const pad = Math.max((hi - lo) * 0.08, Math.abs((lo + hi) / 2) * 0.04) || 1;
    lo = Math.max(0, lo - pad);
    if (!SPEED_FAMILY.includes(def.id)) hi += pad;
    overlayScale.set(def.id, { lo, hi, idx, def });
    axisEntries.push({ def, lo, hi, vals });
  }
  const hrEntry = axisEntries.find((e) => e.def.id === 'hr') ?? null;
  return {
    // Key components — compared by sync() before every reuse.
    track: state.track,
    xMode: state.xMode,
    cols,
    visibleKey: visible.join('|'),
    // Samples.
    overlayScale, axisEntries, hrEntry,
  };
}

/** Reads a themed design token from outside sync() (which caches its own
 *  colors per frame). Waypoint layers share the map's tokens. */
function tokenColor(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Waypoint annotations on the profile — the map's pins in profile form: a
 * violet dot riding the elevation curve (mid-height when the track has no
 * elevation). No standing vertical line: the only violet line is the thick
 * one drawn while a map pin is hovered. Follows the map's waypoint toggle
 * and the visible x window.
 * @private
 */
function drawWaypointPins(v0, v1, x, y) {
  if (!state.waypointsShown || !state.profileWaypoints.length) return;
  const cWaypoint = tokenColor('--map-waypoint');
  const ring = tokenColor('--map-handle-border');
  ctx.save();
  ctx.beginPath();
  ctx.rect(state.plot.x0, state.plot.y0, state.plot.w, state.plot.h);
  ctx.clip();
  for (const wp of state.profileWaypoints) {
    const xv = distToX(wp.dist, state.track, state.xMode);
    if (xv < v0 || xv > v1) continue;
    const pt = pointAtDistance(state.track, wp.dist);
    const py = y && pt && pt.ele != null ? y(pt.ele) : state.plot.y0 + state.plot.h / 2;
    ctx.beginPath();
    ctx.arc(x(xv), py, 4, 0, Math.PI * 2);
    ctx.fillStyle = cWaypoint;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = ring;
    ctx.stroke();
  }
  ctx.restore();
}

/** @private Polyline for an overlay; empty columns are bridged so the
 *  curve stays continuous (gaps only when a series has no data at all). */
function drawOverlayLine(vals, xStart, xEnd, x, lo, hi, lineColor) {
  const colW = (xEnd - xStart) / Math.max(1, vals.length);
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  let pen = false;
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    if (v == null) continue;
    const px = x(xStart + (i + 0.5) * colW);
    const py = overlayYOf(v, lo, hi);
    if (pen) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
    pen = true;
  }
  ctx.stroke();
}

/** @private The five HR-zone token colors, shared with the metrics panel's
 *  zone bars (light/dark themes carry their own pairs). */
function zoneBandColors(css) {
  return [1, 2, 3, 4, 5].map((i) => css.getPropertyValue(`--hr-zone-${i}`).trim());
}

/**
 * Heart-rate zone bands — five VERY faint horizontal strips behind the HR
 * curve, one per zone of the user's configured ranges (read only — never
 * recomputed here). Each strip spans exactly its bpm range mapped through
 * the HR overlay's own y scale (the same lo/hi mapping drawOverlayLine
 * uses), so it sits precisely where its bpm values plot; zones outside the
 * visible scale contribute nothing and the open-topped zone 5 is clipped at
 * the scale's high end — the axis itself is never widened. Drawn beneath
 * every curve with no borders: auxiliary context that must never compete
 * with the elevation or heart-rate lines.
 *
 * While hovering, the band containing the hover dot's bpm reading is tinted
 * about twice as deep (ACTIVE_BAND_ALPHA) — still background, but the eye
 * can read the active zone; without a hover every band keeps BAND_ALPHA.
 * Both features are gated by the settings drawer's display toggles
 * (js/metrics/heartRateDisplay.js): showZones hides the bands entirely, and
 * the hover highlight additionally requires the highlight toggle — neither
 * toggle widens the hr scale or turns the HR overlay on by itself.
 * @param {{lo: number, hi: number}|undefined} hrScale  the hr overlay's
 *   scale from sync(); undefined whenever the hr curve is hidden or has no
 *   data — and then no bands are drawn either
 * @param {string[]} colors  the --hr-zone-1..5 token colors
 */
function drawHrZoneBands(hrScale, colors) {
  const display = getHeartRateDisplay();
  if (!hrScale || !display.showZones) return;
  const bounds = computeZoneBounds(loadHeartRateSettings());
  if (!bounds) return;
  const active = display.highlight
    ? hrHoverZone(bounds, state.probe ? state.probe.dist : state.hoverDist)
    : null;
  const { x0, w } = state.plot;
  const { lo, hi } = hrScale;
  const yOf = (bpm) => overlayYOf(bpm, lo, hi);
  for (let i = 0; i < 5; i++) {
    const zLo = Math.max(bounds.zones[i].lo, lo);
    const zHi = Math.min(bounds.zones[i].hi ?? hi, hi);
    if (zHi - zLo < 1e-9) continue;
    ctx.globalAlpha = i === active ? ACTIVE_BAND_ALPHA : BAND_ALPHA;
    ctx.fillStyle = colors[i];
    ctx.fillRect(x0, yOf(zHi), w, yOf(zLo) - yOf(zHi));
  }
  ctx.globalAlpha = 1;
}

/**
 * @private The 0-based band index containing the inspected HR reading, or
 * null — derived through the SAME reading path as the tooltip's zone label
 * (nearest track point's heart rate, classified against the configured
 * zones), so the deepened band always matches the label the tooltip shows.
 * Follows the touch probe's position while one is active, else the hover.
 * No highlight while a waypoint is pinned (the chart hover is inert then)
 * or over columns without a reading.
 * @param {{zones: {lo: number, hi: number|null}[]}} bounds
 * @param {number|null} dist  inspected track distance (probe or hover)
 */
function hrHoverZone(bounds, dist) {
  const { track } = state;
  if (state.pinnedWaypoint || !hrHoverCurve || dist == null || !track) return null;
  const pt = pointAtDistance(track, dist);
  if (!pt) return null;
  const idx = pt.t < 0.5 ? pt.i : Math.min(pt.i + 1, track.pointCount - 1);
  const v = track.points[idx].hr;
  if (v == null || !Number.isFinite(v)) return null;
  const zone = classifyHr(v, bounds);
  return zone > 0 ? zone - 1 : null;
}

/**
 * @private Raw x under the current hover — the cursor's raw x for profile
 * hovers, the hovered position's x for map/waypoint hovers; null when
 * nothing is hovered. Shared by the crosshair (drawHover) and the active
 * zone-band highlight so both always agree on the position.
 */
function currentHoverXv() {
  if (state.hoverDist == null) return null;
  if (state.hoverOrigin === 'profile' && state.hoverX != null) return state.hoverX;
  return distToX(state.hoverDist, state.track, state.xMode);
}

/**
 * Horizontal right-hand axis strip for the visible overlays. Every series
 * contributes one column — its max reading on the top row, its min on the
 * bottom row — laid out left→right in the same order as the selected
 * overlays, right-aligned to the plot edge. Font and baseline match
 * the left-hand elevation labels (10px mono, middle), with the rows sitting
 * exactly on the top/bottom grid lines so both axes read level. Labels are
 * haloed with the surface color so they stay legible over the curves.
 * @private
 */
function drawOverlayAxes(entries, haloColor, yTop, yBottom) {
  if (!entries.length) return;
  const css = getComputedStyle(document.documentElement);
  ctx.font = '10px ' + (css.getPropertyValue('--font-mono') || 'monospace');
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const seriesColor = (token) => css.getPropertyValue(token).trim();
  const GAP = 14;
  const PAD = 4;
  const columns = entries.map(({ def, lo, hi }) => {
    const hiText = formatOverlayValue(def, hi);
    const loText = formatOverlayValue(def, lo);
    return {
      color: seriesColor(def.colorToken),
      hiText, loText,
      w: Math.max(ctx.measureText(hiText).width, ctx.measureText(loText).width),
    };
  });
  const totalW = columns.reduce((sum, c) => sum + c.w, 0) + GAP * (columns.length - 1);
  let x = Math.max(state.plot.x0 + PAD, state.plot.x0 + state.plot.w - PAD - totalW);
  for (const col of columns) {
    const label = (text, ty) => {
      ctx.lineWidth = 3;
      ctx.strokeStyle = haloColor;
      ctx.strokeText(text, x, ty);
      ctx.fillStyle = col.color;
      ctx.fillText(text, x, ty);
    };
    label(col.hiText, yTop);
    label(col.loText, yBottom);
    x += col.w + GAP;
  }
}

/** @private Min–max band (area + max line) for the elevation curve. */
function drawBand(sample, d0, x, y, fillColor, fillAlpha, strokeColor, strokeW) {
  const { mins, maxs, count, colW } = sample;
  if (count < 2) return;
  const { y0 } = state.plot;
  const colX = (i) => x(d0 + (i + 0.5) * colW);

  ctx.globalAlpha = fillAlpha;
  ctx.fillStyle = fillColor;
  ctx.beginPath();
  for (let i = 0; i < count; i++) ctx.lineTo(colX(i), y(maxs[i]));
  for (let i = count - 1; i >= 0; i--) ctx.lineTo(colX(i), y(mins[i]));
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeW;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < count; i++) ctx.lineTo(colX(i), y(maxs[i]));
  ctx.stroke();
}

/** @private Positions the DOM masks around the sector x span (plot-clipped). */
function placeMasks() {
  if (!state.track) return;
  const { x0, w } = state.plot;
  const v0 = state.view ? state.view.start : 0;
  const v1 = state.view ? state.view.end : (state.xs ? state.xs[state.xs.length - 1] : 0);
  const vw = Math.max(v1 - v0, 1e-9);
  const xOf = (v) => x0 + ((v - v0) / vw) * w;
  const { start, end } = sectorStore.get();
  const sPx = Math.min(Math.max(xOf(distToX(start, state.track, state.xMode)), x0), x0 + w);
  const ePx = Math.min(Math.max(xOf(distToX(end, state.track, state.xMode)), x0), x0 + w);
  const place = (mask, left, right) => {
    const width = right - left;
    if (width <= 1) {
      mask.hidden = true;
      return;
    }
    mask.hidden = false;
    mask.style.left = `${left}px`;
    mask.style.width = `${width}px`;
  };
  place(masks.left, x0, sPx);
  place(masks.right, ePx, x0 + w);
}

/** @private Positions the DOM handles + their ARIA values. */
export function positionHandles() {
  if (!state.track) return;
  const xEnd = state.xs[state.xs.length - 1];
  const v0 = state.view ? state.view.start : 0;
  const v1 = state.view ? state.view.end : xEnd;
  const vw = Math.max(v1 - v0, 1e-9);
  const { start, end } = sectorStore.get();
  const { x0, w } = state.plot;
  const place = (el, dist, key) => {
    const xv = distToX(dist, state.track, state.xMode);
    const px = x0 + ((xv - v0) / vw) * w;
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

/** @private Hover crosshair drawn on the canvas: hairline + white dot with an
 *  orange ring on the profile line (kept visible over the orange stroke), and
 *  a smaller solid series-colored dot where the hairline crosses the drawn
 *  heart-rate curve. A waypoint pin hover on the MAP draws a thicker violet
 *  line instead. */
function drawHover(lineColor, dotColor) {
  const { track, plot, view, xs, hoverDist, hoverX, hoverOrigin } = state;
  if (!track) return;
  const { x0, y0, w, h } = plot;
  const xEnd = xs[xs.length - 1] || 1;
  const v0 = view ? view.start : 0;
  const v1 = view ? view.end : xEnd;
  const vw = Math.max(v1 - v0, 1e-9);

  // Pinned waypoint (clicked): its violet line + readout stay on the chart
  // until the next click anywhere — chart hover is inert while pinned.
  if (state.pinnedWaypoint) {
    const xv = distToX(state.pinnedWaypoint.dist, track, state.xMode);
    if (xv >= v0 && xv <= v1) {
      const px = x0 + ((xv - v0) / vw) * w;
      ctx.strokeStyle = tokenColor('--map-waypoint');
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
  // fixed telemetry band between the profile header and the chart (coarse-pointer devices) or the
  // floating fallback box (see showTooltipAt / CSS).
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
  const px = x0 + ((xv - v0) / vw) * w;
  const isWaypoint = !probe && hoverOrigin === 'waypoint';
  const hoverLineColor = isWaypoint ? tokenColor('--map-waypoint') : lineColor;
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
      const pad = Math.max((track.eleMax - track.eleMin) * 0.08, 4);
      const eleMin = track.eleMin - pad;
      const eleMax = track.eleMax + pad;
      const py = y0 + (1 - (pt.ele - eleMin) / (eleMax - eleMin)) * h;
      ctx.fillStyle = dotColor;
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
  // curve, clearly smaller than the elevation hover dot above. Computed on
  // the SAME column averages the curve is drawn from (linear between the two
  // bracketing columns), so the dot sits exactly on the line the eye sees;
  // columns without a reading get no dot. None when the hr curve is hidden.
  if (hrHoverCurve) {
    const { vals, colW, lo, hi } = hrHoverCurve;
    const u = xv / colW - 0.5;
    const i0 = Math.min(Math.max(Math.floor(u), 0), vals.length - 2);
    const t = Math.min(Math.max(u - i0, 0), 1);
    const a = vals[i0];
    const b = vals[i0 + 1];
    if (a != null && b != null) {
      const bpm = a + (b - a) * t;
      const py = overlayYOf(bpm, lo, hi);
      ctx.fillStyle = tokenColor('--series-hr');
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (probe) {
    // The probe readout: same tooltip pipeline (data, formatters, locale) as
    // the desktop hover; `{ probe: true }` routes it into the fixed band
    // between the profile header and the chart (or the floating fallback where the band does not
    // exist — see showTooltipAt / profile.css).
    showTooltipAt(probe.dist, xv, null, { probe: true });
    return;
  }
  if (hoverOrigin !== 'profile') {
    // Crosshair drawn from a map hover; tooltip follows the same position.
    showTooltipAt(hoverDist, null, state.waypointHover && state.waypointHover.dist === hoverDist ? state.waypointHover.name : null);
  }
}

/** Size the backing store for devicePixelRatio. */
export function resizeCanvas() {
  const { root, canvas: cv } = state.dom;
  const rect = root.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.max(1, Math.round(rect.width * dpr));
  cv.height = Math.max(1, Math.round(rect.height * dpr));
  cv.style.width = `${rect.width}px`;
  cv.style.height = `${rect.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  state.plot = {
    x0: MARGIN.left,
    y0: MARGIN.top,
    w: Math.max(10, rect.width - MARGIN.left - MARGIN.right),
    h: Math.max(10, rect.height - MARGIN.top - MARGIN.bottom),
  };
}

// niceStep stays local: only the x-tick loop consumes it.
function niceStep(raw) {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-6))));
  for (const m of [1, 2, 5, 10]) {
    if (raw <= m * pow) return m * pow;
  }
  return 10 * pow;
}
