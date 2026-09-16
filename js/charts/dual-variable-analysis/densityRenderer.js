/**
 * Dual-variable analysis — the canvas renderer.
 *
 * One full-redraw pass (render) paints: plot background → tick grid → the
 * density bitmap → plot border → hover highlight → axis tick labels → axis
 * titles. The density grid itself lives on a tiny offscreen bitmap (one
 * pixel per bin, nx × ny) stretched to the plot with image smoothing on —
 * the binning does the aggregation, the GPU interpolates the soft gradient
 * between cell centers, and even 100k-point tracks render in one drawImage.
 * Bin colors come from a 256-entry LUT built off a two-stop gradient of the
 * theme's --density-zero / --density-max tokens, so light and dark themes
 * each get their own ramp and a theme switch is just rebuild + redraw (no
 * re-analysis).
 *
 * Ticks are nice numbers in the metric's DISPLAY space (km/h, °F, %, ft —
 * metrics.js owns the conversion), labeled with the shared formatters, so
 * the axes can never disagree with the rest of the UI. Axis titles carry
 * name + unit ("Heart rate (bpm)") — the unit is never tooltip-only knowledge.
 *
 * The plot can be zoomed and panned (the shared viewport gestures drive the
 * axes below). A viewport is a window per axis in RAW data units — `null`
 * means "fitted", the full drawn domain, never a hard-coded coordinate. The
 * density bitmap always covers the whole domain, so zooming is a source
 * sub-rect of the same bitmap and panning a different one: no re-binning, and
 * every mapping (grid, labels, bitmap, hover outline, hit-test) reads the
 * window through the same two helpers.
 *
 * The renderer owns no business state beyond its DOM assets, the current
 * density result, the viewport window and the hover highlight; the
 * interaction layer never draws.
 */
import { t } from '../../language/language.js';

// Margins around the plot (CSS px). The left margin grows to fit the y tick
// labels (a pace axis reads "12:34"); everything else is fixed.
const MARGIN = { right: 14, top: 30, bottom: 50 };
const Y_LABEL_PAD = 8;

/** Zoom floor, as a fraction of an axis' own domain: the deepest zoom shows
 *  5 % of the drawn range (about five of the 96 x bins). Data-driven — the
 *  gesture layer never sees a hard-coded coordinate. */
const MIN_ZOOM_FRACTION = 0.05;

// Module-private state — this module is the one renderer of one dialog.
let canvas = null;
let ctx = null;
let wrapper = null;
/** The current analysis result + metrics, set by setData(). */
let data = null; // { x0,x1,y0,y1,nx,ny,counts,maxCount,sampleCount,binnedCount }
let xMetric = null;
let yMetric = null;
/** 256×1 RGBA ramp; [0] forced fully transparent (empty bins render empty). */
const lut = new Uint8ClampedArray(256 * 4);
/** The density grid as a tiny bitmap, stretched over the plot each render. */
const bitmap = document.createElement('canvas');
const bitmapCtx = bitmap.getContext('2d');
/** The gradient strip the LUT is sampled from. */
const lutStrip = document.createElement('canvas');
lutStrip.width = 256;
lutStrip.height = 1;
const lutCtx = lutStrip.getContext('2d', { willReadFrequently: true });
/** The hovered bin (indices) or null; set via setHover, drawn by render. */
let hover = null;
/** Plot geometry in CSS px + data domain — the hit-test source of truth. */
let geom = null;
/** The visible window per axis, in RAW data units — `null` per axis while it
 *  shows its full domain. Written only through viewportAxes() (the gesture
 *  layer) and reset whenever a new analysis loads. */
let viewport = { x: null, y: null };

/** Binds the chart DOM. Call once from the orchestrator. */
export function initRenderer(canvasEl, wrapperEl) {
  canvas = canvasEl;
  ctx = canvas.getContext('2d');
  wrapper = wrapperEl;
  rebuildLut();
}

/** Loads an analysis result (computeDensity output) + its axis metrics. */
export function setData(density, xDef, yDef) {
  data = density;
  xMetric = xDef;
  yMetric = yDef;
  hover = null;
  viewport = { x: null, y: null }; // a new analysis always starts fitted
  rebuildBitmap();
}

/** Drops the current result (nothing to draw). */
export function clearData() {
  data = null;
  hover = null;
  viewport = { x: null, y: null };
}

/** True while either axis is zoomed in (the double-tap reset's gate). */
export function isViewportZoomed() {
  return !!(viewport.x || viewport.y);
}

/** The visible window per axis — `[lo, hi]` in raw data units, `null` while
 *  that axis shows its full domain (read-only copy). */
export function getViewport() {
  return {
    x: viewport.x ? [viewport.x[0], viewport.x[1]] : null,
    y: viewport.y ? [viewport.y[0], viewport.y[1]] : null,
  };
}

/** Restores the full data range on both axes and redraws. */
export function resetViewport() {
  if (!isViewportZoomed()) return false;
  viewport = { x: null, y: null };
  hover = null;
  render();
  return true;
}

/**
 * The two axes as the shared viewport-gesture machine sees them
 * (js/charts/viewport-gestures.js): the same plot geometry render() draws
 * with, so a gesture can never resolve to a window the bitmap won't show.
 * Returns null while there is nothing to drive.
 */
export function viewportAxes() {
  if (!data || !geom) return null;
  const xw = data.x1 - data.x0;
  const yw = data.y1 - data.y0;
  return [
    {
      axis: 'x',
      domain: [data.x0, data.x1],
      minSpan: xw * MIN_ZOOM_FRACTION,
      px0: geom.x,
      pxw: geom.w,
      reversed: xMetric != null && xMetric.reversed === true,
      get: () => viewport.x,
      set: (win) => { viewport.x = win; },
    },
    {
      axis: 'y',
      domain: [data.y0, data.y1],
      minSpan: yw * MIN_ZOOM_FRACTION,
      px0: geom.y,
      pxw: geom.h,
      reversed: yMetric != null && yMetric.reversed === true,
      get: () => viewport.y,
      set: (win) => { viewport.y = win; },
    },
  ];
}

/** Theme / unit / language switch: rebuild the themed ramp + labels. */
export function refresh() {
  rebuildLut();
  if (data) rebuildBitmap(); // same counts, re-colored through the new LUT
  render();
}

/** Resizes the backing store to the wrapper's CSS size × dpr (capped 2). */
export function resize() {
  if (!canvas) return;
  const rect = wrapper.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** Full redraw. Safe to call any time; no-ops without data or size. */
export function render() {
  if (!canvas || !ctx || !data) return;
  const rect = wrapper.getBoundingClientRect();
  if (rect.width < 40 || rect.height < 40) return;

  const css = getComputedStyle(document.documentElement);
  const mono = css.getPropertyValue('--font-mono') || 'monospace';
  const ui = css.getPropertyValue('--font-ui') || 'sans-serif';
  const color = (name) => css.getPropertyValue(name).trim();
  const cText = color('--foreground-muted');
  const cGrid = color('--border');
  const cPlotBg = color('--surface-muted');
  const cPlotBorder = color('--border-strong');
  const cAccent = color('--accent-strong');

  // The visible window per axis: the gesture layer's zoom/pan output, or the
  // full domain while that axis is fitted. Every mapping below reads it.
  const vx = viewport.x ?? [data.x0, data.x1];
  const vy = viewport.y ?? [data.y0, data.y1];
  const xTicks = buildTicks(
    xMetric.toDisplay(vx[0]), xMetric.toDisplay(vx[1]),
    Math.max(3, Math.min(9, Math.floor(rect.width / 70))),
  );
  const yTicks = buildTicks(
    yMetric.toDisplay(vy[0]), yMetric.toDisplay(vy[1]),
    Math.max(3, Math.min(7, Math.floor(rect.height / 55))),
  );

  ctx.font = `10px ${mono}`;
  // Left margin follows the widest y tick label so a pace axis never clips.
  let yLabelW = 0;
  for (const tv of yTicks) {
    yLabelW = Math.max(yLabelW, ctx.measureText(formatTick(yMetric, tv)).width);
  }
  const x0px = Math.max(yLabelW + Y_LABEL_PAD, 40);
  const y0px = MARGIN.top;
  const w = Math.max(10, rect.width - x0px - MARGIN.right);
  const h = Math.max(10, rect.height - y0px - MARGIN.bottom);

  // The geometry every hover path must agree with (CSS px + raw domain).
  geom = { x: x0px, y: y0px, w, h, nx: data.nx, ny: data.ny };

  // Pace-family axes read REVERSED on BOTH axes (reversed in metrics.js):
  // a SMALLER pace is a FASTER effort, so the fast end belongs at the TOP
  // of a vertical axis (5:00 /km above 15:00 /km) and at the RIGHT of a
  // horizontal one — the sports-tool convention, and the same "faster is
  // higher/righter" reading the speed axis already has unflipped. Every
  // mapping — grid, labels, bitmap rows/columns, hover outline, hitTest —
  // goes through xOfDisplay()/yOfDisplay()/the flip-aware hitTest, so they
  // can never disagree about the direction.
  const flipY = yMetric.reversed === true;
  const reverseX = xMetric.reversed === true;
  // Raw value → screen fraction from the plot's left / top (0..1 inside the
  // VISIBLE window), then px. A tick lands on the gridline its own value maps
  // to, because the tick's display value converts back to the same raw space
  // the viewport is expressed in — never on a fraction of the tick range,
  // which would drift as soon as the window is zoomed.
  const fracX = (v) => (reverseX ? vx[1] - v : v - vx[0]) / (vx[1] - vx[0] || 1);
  const fracY = (v) => (flipY ? v - vy[0] : vy[1] - v) / (vy[1] - vy[0] || 1);
  const xOfDisplay = (tv) => x0px + fracX(xMetric.fromDisplay(tv)) * w;
  const yOfDisplay = (tv) => y0px + fracY(yMetric.fromDisplay(tv)) * h;
  // The same fractions over the WHOLE DOMAIN: the bitmap's own row/column
  // space, of which the visible window is a sub-rect.
  const bitmapFracX = (v) => (reverseX ? data.x1 - v : v - data.x0) / (data.x1 - data.x0 || 1);
  const bitmapFracY = (v) => (flipY ? v - data.y0 : data.y1 - v) / (data.y1 - data.y0 || 1);

  ctx.clearRect(0, 0, rect.width, rect.height);

  // Plot background + the density bitmap (smoothly stretched cell centers).
  ctx.fillStyle = cPlotBg;
  ctx.fillRect(x0px, y0px, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // Zoomed / panned: stretch the window's slice of the grid over the plot —
  // the bins are uniform over the domain, so this is exact and needs no
  // re-binning (the grid keeps its 96 × 64 resolution at any zoom).
  const sy0 = Math.min(bitmapFracY(vy[0]), bitmapFracY(vy[1])) * data.ny;
  const sy1 = Math.max(bitmapFracY(vy[0]), bitmapFracY(vy[1])) * data.ny;
  const sx0 = Math.min(bitmapFracX(vx[0]), bitmapFracX(vx[1])) * data.nx;
  const sx1 = Math.max(bitmapFracX(vx[0]), bitmapFracX(vx[1])) * data.nx;
  ctx.drawImage(bitmap, sx0, sy0, sx1 - sx0, sy1 - sy0, x0px, y0px, w, h);

  // Tick grid — under nothing now (the bitmap is opaque where bins exist),
  // so gridlines are drawn OVER the heatmap at low alpha, the way profile
  // gridlines sit over the elevation band.
  ctx.strokeStyle = cGrid;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const tv of xTicks) {
    const px = xOfDisplay(tv);
    ctx.moveTo(px, y0px);
    ctx.lineTo(px, y0px + h);
  }
  for (const tv of yTicks) {
    const py = yOfDisplay(tv);
    ctx.moveTo(x0px, py);
    ctx.lineTo(x0px + w, py);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Plot border.
  ctx.strokeStyle = cPlotBorder;
  ctx.lineWidth = 1;
  ctx.strokeRect(x0px + 0.5, y0px + 0.5, w - 1, h - 1);

  // Hover highlight: an accent outline around the pointer's cell — position
  // feedback that never relies on color alone (an outline reads in both
  // themes, on any density).
  if (hover) {
    // The cell's own data span mapped through the window — so the outline
    // follows its bin at any zoom level, and a bin scrolled out of the window
    // is clipped into the plot instead of dragging the outline off the chart.
    const xLo = data.x0 + (hover.ix / data.nx) * (data.x1 - data.x0);
    const xHi = data.x0 + ((hover.ix + 1) / data.nx) * (data.x1 - data.x0);
    const yLo = data.y0 + (hover.iy / data.ny) * (data.y1 - data.y0);
    const yHi = data.y0 + ((hover.iy + 1) / data.ny) * (data.y1 - data.y0);
    const a = x0px + fracX(xLo) * w;
    const b = x0px + fracX(xHi) * w;
    const c = y0px + fracY(yLo) * h;
    const d = y0px + fracY(yHi) * h;
    const l = Math.max(Math.min(a, b), x0px);
    const r = Math.min(Math.max(a, b), x0px + w);
    const t = Math.max(Math.min(c, d), y0px);
    const bottom = Math.min(Math.max(c, d), y0px + h);
    if (r - l > 1 && bottom - t > 1) {
      ctx.strokeStyle = cAccent;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(l + 0.75, t + 0.75, r - l - 1.5, bottom - t - 1.5);
    }
  }

  // Tick labels. X labels near the canvas edge would clip half-written —
  // those ticks are dropped rather than nudged off their gridline.
  ctx.fillStyle = cText;
  ctx.font = `10px ${mono}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const tv of yTicks) {
    ctx.fillText(formatTick(yMetric, tv), x0px - Y_LABEL_PAD, yOfDisplay(tv));
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const tv of xTicks) {
    const px = xOfDisplay(tv);
    const label = formatTick(xMetric, tv);
    if (px - ctx.measureText(label).width / 2 < 2) continue;
    if (px + ctx.measureText(label).width / 2 > rect.width - 2) continue;
    ctx.fillText(label, px, y0px + h + 6);
  }

  // Axis titles: name + unit, so the axes read without touching anything.
  ctx.font = `600 11px ${ui}`;
  ctx.fillStyle = color('--foreground');
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(axisTitle(yMetric), x0px, y0px - 10);
  ctx.textAlign = 'center';
  ctx.fillText(axisTitle(xMetric), x0px + w / 2, y0px + h + 32);
}

/**
 * Maps a pointer position (client coordinates) onto the plot: returns the
 * hovered bin indices, the cursor's RAW x/y values and the bin's density —
 * or null outside the plot. The single client→data conversion, so the
 * highlight and the tooltip can never disagree.
 */
export function hitTest(clientX, clientY) {
  if (!data || !geom) return null;
  const rect = canvas.getBoundingClientRect();
  const px = clientX - rect.left;
  const py = clientY - rect.top;
  const { x, y, w, h, nx, ny } = geom;
  if (px < x || px > x + w || py < y || py > y + h) return null;
  // Pace-family axes are REVERSED on screen (fast = small = top / right): the
  // screen fraction counts down the data on such an axis, and both the raw
  // values and the bin indices below follow from that one pair of flags.
  const flipY = yMetric != null && yMetric.reversed === true;
  const reverseX = xMetric != null && xMetric.reversed === true;
  // The pointer's screen fraction inside the VISIBLE window, then that
  // window's own raw values — the same conversion the bitmap was drawn with.
  const vx = viewport.x ?? [data.x0, data.x1];
  const vy = viewport.y ?? [data.y0, data.y1];
  const fx = (px - x) / w;
  const fy = (py - y) / h;
  const xRaw = reverseX
    ? vx[1] - fx * (vx[1] - vx[0])
    : vx[0] + fx * (vx[1] - vx[0]);
  const yRaw = flipY
    ? vy[0] + fy * (vy[1] - vy[0])
    : vy[0] + (1 - fy) * (vy[1] - vy[0]);
  // The bin indices are derived from those RAW values over the whole domain:
  // `counts` is always in DATA order (the bitmap applies the flip when it
  // rasterizes, the counts never do), and a zoomed window must resolve the bin
  // the cursor is actually over — counting screen columns instead would read
  // the density of a bin from the far end of the domain.
  const ix = Math.min(nx - 1, Math.max(0, Math.floor(((xRaw - data.x0) / (data.x1 - data.x0)) * nx)));
  const iy = Math.min(ny - 1, Math.max(0, Math.floor(((yRaw - data.y0) / (data.y1 - data.y0)) * ny)));
  const count = data.counts[iy * nx + ix];
  return {
    ix, iy, xRaw, yRaw,
    density: count > 0 ? count / data.maxCount : 0,
    hasPoints: count > 0,
  };
}

/** Sets the hovered bin (hitTest result) and redraws; null clears. */
export function setHover(h) {
  const next = h ? { ix: h.ix, iy: h.iy } : null;
  const same = (next === null && hover === null)
    || (next && hover && next.ix === hover.ix && next.iy === hover.iy);
  if (same) return;
  hover = next;
  render();
}

/** @private Colors the offscreen bitmap from counts × LUT. */
function rebuildBitmap() {
  if (!data) return;
  const { counts, maxCount, nx, ny } = data;
  // Pace-family axes are drawn REVERSED (fast = small = top / right):
  // bitmap row 0 / col 0 is the TOP / LEFT of the plot, which is the y-max /
  // x-min on a normal axis and the y-min / x-max on a flipped one.
  const flipY = yMetric != null && yMetric.reversed === true;
  const reverseX = xMetric != null && xMetric.reversed === true;
  if (bitmap.width !== nx || bitmap.height !== ny) {
    bitmap.width = nx;
    bitmap.height = ny;
  }
  const img = bitmapCtx.createImageData(nx, ny);
  const px = img.data;
  for (let row = 0; row < ny; row++) {
    const srcRow = flipY ? row : ny - 1 - row;
    for (let col = 0; col < nx; col++) {
      const srcCol = reverseX ? nx - 1 - col : col;
      const count = counts[srcRow * nx + srcCol];
      const o = (row * nx + col) * 4;
      if (count === 0) continue; // rgba stays 0,0,0,0 — an empty bin is empty
      // Perceptual gamma on the VISUAL only: most bins sit far below the
      // busiest one, and a linear alpha ramp turns them invisible. The
      // tooltip keeps reporting the linear relativeDensity of spec §14.
      const d = Math.sqrt(count / maxCount);
      const li = Math.round(d * 255) * 4;
      px[o] = lut[li];
      px[o + 1] = lut[li + 1];
      px[o + 2] = lut[li + 2];
      px[o + 3] = lut[li + 3];
    }
  }
  bitmapCtx.putImageData(img, 0, 0);
}

/** @private Samples the theme's two ramp tokens into the 256-entry LUT. */
function rebuildLut() {
  const css = getComputedStyle(document.documentElement);
  const c0 = css.getPropertyValue('--density-zero').trim() || 'rgba(136, 136, 136, 0.05)';
  const c1 = css.getPropertyValue('--density-max').trim() || '#888888';
  lutCtx.clearRect(0, 0, 256, 1);
  const grad = lutCtx.createLinearGradient(0, 0, 255, 0);
  grad.addColorStop(0, c0);
  grad.addColorStop(1, c1);
  lutCtx.fillStyle = grad;
  lutCtx.fillRect(0, 0, 256, 1);
  lut.set(lutCtx.getImageData(0, 0, 256, 1).data);
  // Zero density is fully transparent: bins with no points show the plot
  // background, not a faint tint of the ramp's low end.
  lut[3] = 0;
}

/** @private Nice tick steps (1/2/5 × 10^k) in display space. */
function buildTicks(dLo, dHi, targetCount) {
  const span = dHi - dLo;
  if (!(span > 0)) return [dLo];
  const step = niceStep(span / Math.max(2, targetCount));
  const first = Math.ceil(dLo / step) * step;
  const ticks = [];
  for (let k = 0; ; k++) {
    const v = first + k * step;
    if (v > dHi + step * 1e-6) break;
    ticks.push(v);
  }
  return ticks;
}

/** @private */
function niceStep(raw) {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-12))));
  for (const m of [1, 2, 5, 10]) {
    if (raw <= m * pow) return m * pow;
  }
  return 10 * pow;
}

/** @private Display tick → label through the shared formatter. */
function formatTick(metric, displayValue) {
  return metric.format(metric.fromDisplay(displayValue));
}

/** @private "Heart rate (bpm)" — name + unit on the axis. */
function axisTitle(metric) {
  return `${t(metric.labelKey)} (${metric.unit()})`;
}
