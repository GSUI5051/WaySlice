/**
 * Dual-variable analysis — the density calculation (pure).
 *
 * 2D binning of valid X/Y samples into a fixed grid, exactly the spec's
 * density definition: a bin's density is its LOCAL point count, normalized
 * by the busiest bin (relativeDensity = binCount / maxBinCount, 0..1) —
 * never a raw count dressed up as a percentage, which no two tracks could
 * compare.
 *
 * The grid is fixed-size (no per-point bins, no unbounded growth): X_BINS ×
 * Y_BINS cells over a robust data domain. The domain is the 0.2–99.8 %
 * quantile range of each axis, padded ~4 % — a handful of sensor outliers
 * (a wild grade from GPS jitter, one absurd temperature) must not compress
 * the body of the data into a sliver of cells. Points outside the domain
 * stay in the sample table; they only fall outside the DRAWN grid, the same
 * way a chart axis can clip. Degenerate ranges (a constant series) expand
 * around the value so the plot never divides by zero.
 */

/** Grid resolution — inside the spec's 60–120 × 40–100 window. */
export const X_BINS = 96;
export const Y_BINS = 64;
/** Fewer valid pairs than this: not enough for a distribution (empty state). */
export const MIN_PAIR_SAMPLES = 10;
/** Quantile bounds of the drawn domain — the robust-outlier guard. */
export const DOMAIN_QUANTILE = 0.002;
/** Relative padding added around the quantile range. */
export const DOMAIN_PAD = 0.04;

/**
 * Bins valid samples into the density grid.
 *
 * @param {Float64Array} xs  raw X values (already finite — extractPair)
 * @param {Float64Array} ys  raw Y values, aligned with xs
 * @returns {{
 *   x0: number, x1: number, y0: number, y1: number,
 *   nx: number, ny: number,
 *   counts: Uint32Array,   // nx × ny, row-major from the y-max corner down
 *   maxCount: number,
 *   sampleCount: number,   // finite pairs handed in
 *   binnedCount: number,   // pairs inside the drawn domain
 * }|null} null when there are fewer than MIN_PAIR_SAMPLES valid pairs
 */
export function computeDensity(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < MIN_PAIR_SAMPLES) return null;

  const [x0, x1] = domain(xs, n);
  const [y0, y1] = domain(ys, n);

  const counts = new Uint32Array(X_BINS * Y_BINS);
  let maxCount = 0;
  let binned = 0;
  const xw = x1 - x0;
  const yw = y1 - y0;
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    let cx = Math.floor(((x - x0) / xw) * X_BINS);
    let cy = Math.floor(((y - y0) / yw) * Y_BINS);
    if (cx >= X_BINS) cx = X_BINS - 1; // the exact top edge lands in the last bin
    if (cy >= Y_BINS) cy = Y_BINS - 1;
    const idx = cy * X_BINS + cx;
    const c = ++counts[idx];
    if (c > maxCount) maxCount = c;
    binned++;
  }

  return {
    x0, x1, y0, y1,
    nx: X_BINS, ny: Y_BINS,
    counts,
    maxCount,
    sampleCount: n,
    binnedCount: binned,
  };
}

/**
 * Relative density of one bin: binCount / maxBinCount in 0..1. Bins with no
 * points have no density — they render as empty, not as 0 %.
 */
export function relativeDensity(count, maxCount) {
  if (maxCount <= 0) return 0;
  return count / maxCount;
}

/**
 * @private Robust domain: the DOMAIN_QUANTILE / 1 − DOMAIN_QUANTILE
 * quantiles of the values, padded — both ends read from the SAME sorted
 * copy, so a lone outlier stretches neither bound. Degenerate ranges (a
 * constant series) expand around the value so the plot never divides by
 * zero. Returns [lo, hi].
 */
function domain(values, n) {
  const sorted = Float64Array.from(values.subarray(0, n)).sort();
  const loIdx = Math.min(n - 1, Math.max(0, Math.floor(DOMAIN_QUANTILE * (n - 1))));
  const hiIdx = Math.min(n - 1, Math.max(0, Math.ceil((1 - DOMAIN_QUANTILE) * (n - 1))));
  const lo = sorted[loIdx];
  const hi = sorted[hiIdx];
  if (hi - lo > 0) {
    const pad = (hi - lo) * DOMAIN_PAD;
    return [lo - pad, hi + pad];
  }
  const half = Math.max(Math.abs(lo) * 0.05, 0.5);
  return [lo - half, hi + half];
}
