/** Elevation-profile data tests: speed-series smoothing + cache rules +
 *  the fit-to-sector window math + the full-resolution chart scale ranges
 *  (the uPlot renderer's inputs) + the lazy uPlot loader's caching rule. */
import { suite, test, assert } from './runner.js';
import * as profileData from '../js/charts/elevation-profile/profile-data.js';
import {
  buildCaches, seriesExtremes, overlayExtremes, overlayYRange, eleYRange,
  sectorFitWindow, FIT_SECTOR_FRACTION,
} from '../js/charts/elevation-profile/profile-data.js';
import { loadUPlot } from '../js/charts/elevation-profile/uplot-loader.js';
import {
  cleanSpeedSeries, cleanComputedSpeeds, minettiFactor,
} from '../js/metrics/sectorMetrics.js';

/**
 * Synthetic track: `segments[i]` = {ds, dt} for the gap point i → i+1.
 * `recorded` (length n, null = no recorded speed) fills point.speed.
 */
function makeTrack(segments, { recorded = null, ele = 100 } = {}) {
  const n = segments.length + 1;
  const points = [];
  const cumDist = [0];
  let dist = 0;
  let time = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      dist += segments[i - 1].ds;
      time += segments[i - 1].dt;
      cumDist.push(dist);
    }
    points.push({
      speed: recorded ? recorded[i] : null,
      time: time * 1000,
      ele: typeof ele === 'function' ? ele(i) : ele,
    });
  }
  return {
    pointCount: n,
    points,
    cumDist,
    totalDistance: dist,
    hasTime: true,
    hasElevation: true,
    hasHr: false,
    hasCad: false,
    hasTemp: false,
    hasPower: false,
  };
}

suite('profile / speed series smoothing (cleanSpeedSeries)', () => {
  test('each point becomes the mean of the 5-point window around it', () => {
    const speeds = new Float64Array(40).fill(3);
    speeds[10] = 100;
    const out = cleanSpeedSeries(speeds);
    assert.closeTo(out[10], (3 + 3 + 100 + 3 + 3) / 5, 1e-9);
    assert.closeTo(out[8], (3 + 3 + 3 + 3 + 100) / 5, 1e-9);
    assert.equal(out[7], 3);  // the window no longer reaches the spike
    assert.equal(out[13], 3);
  });

  test('the window is point-based: the reach is the same at any sampling density', () => {
    // The point is the unit of the window, not the second — a sparse track
    // dilutes its glitches exactly like a dense one.
    const sparse = new Float64Array(40).fill(3);
    sparse[10] = 100;
    const out = cleanSpeedSeries(sparse);
    assert.closeTo(out[10], (3 + 3 + 100 + 3 + 3) / 5, 1e-9);
    assert.equal(out[6], 3);
  });

  test('near the edges the window shrinks to the available points', () => {
    const out = cleanSpeedSeries(Float64Array.from([3, 3, 3]));
    assert.equal(out[0], 3); // mean of the 3 available points, not a padded 5
    assert.equal(out[2], 3);
  });

  test('rest-stop zeros are data and take part in the window mean', () => {
    const out = cleanSpeedSeries(Float64Array.from([3, 3, 0, 3, 3]));
    assert.closeTo(out[2], (3 + 3 + 0 + 3 + 3) / 5, 1e-9);
  });

  test('NaN points are filled from the finite neighbors inside the window', () => {
    const out = cleanSpeedSeries(Float64Array.from([3, 3, NaN, 100, 3]));
    assert.closeTo(out[2], (3 + 3 + 100 + 3) / 4, 1e-9);
    assert.closeTo(out[3], (3 + 100 + 3) / 3, 1e-9);
  });

  test('the input arrays are not mutated', () => {
    const speeds = new Float64Array(40).fill(3);
    speeds[10] = 100;
    cleanSpeedSeries(speeds);
    assert.equal(speeds[10], 100);
  });
});

suite('profile / computed speed cleaning (cleanComputedSpeeds)', () => {
  test('spikes beyond 3σ are replaced by interpolation from kept neighbors', () => {
    const speeds = new Float64Array(40).fill(3);
    speeds[10] = 600;
    speeds[11] = 600;
    const out = cleanComputedSpeeds(speeds);
    assert.closeTo(out[10], 3, 1e-9);
    assert.closeTo(out[11], 3, 1e-9);
    assert.equal(out[9], 3);
    assert.equal(out[13], 3);
  });

  test('NaN gaps pass through and are never counted as outliers', () => {
    const speeds = new Float64Array(40).fill(3);
    speeds[5] = NaN;
    speeds[20] = 600;
    const out = cleanComputedSpeeds(speeds);
    assert.truthy(Number.isNaN(out[5]));
    assert.closeTo(out[20], 3, 1e-9);
  });

  test('the input array is not mutated', () => {
    const speeds = new Float64Array(40).fill(3);
    speeds[20] = 600;
    cleanComputedSpeeds(speeds);
    assert.equal(speeds[20], 600);
  });
});

suite('profile / buildCaches speed source rules', () => {
  const flatRun = Array.from({ length: 30 }, () => ({ ds: 3, dt: 1 }));

  test('a track without recorded speeds gets the 3σ clean', () => {
    const segments = [...flatRun];
    segments[10] = { ds: 200, dt: 1 }; // GPS position jump → absurd dd/dt
    const caches = buildCaches(makeTrack(segments), 'distance');
    assert.truthy(caches.speeds != null);
    // Computed series → 3σ rule: the spike is interpolated away entirely.
    assert.closeTo(caches.speeds[10], 3, 1e-9);
    let max = -Infinity;
    for (const v of caches.speeds) if (Number.isFinite(v)) max = Math.max(max, v);
    assert.closeTo(max, 3, 1e-9);
  });

  test('a track with recorded speeds: the cross-check drops the spike before the window', () => {
    // One absurd recorded spike (500 m/s where the positions moved 3 m/s):
    // the dd/dt cross-check distrusts it and drops it to NaN, so the point
    // window fills the hole from the trusted neighbors — flat series.
    const segments = Array.from({ length: 120 }, () => ({ ds: 3, dt: 1 }));
    segments[10] = { ds: 200, dt: 1 };
    const recorded = Array.from({ length: 121 }, () => 3);
    recorded[10] = 500;
    const caches = buildCaches(makeTrack(segments, { recorded }), 'distance');
    assert.truthy(caches.speeds != null);
    let max = -Infinity;
    for (const v of caches.speeds) if (Number.isFinite(v)) max = Math.max(max, v);
    assert.closeTo(max, 3, 1e-9);
    assert.closeTo(caches.speeds[10], 3, 1e-9);
  });

  test('recorded zeros (rest stops) are data and take part in the window mean', () => {
    const segments = Array.from({ length: 120 }, () => ({ ds: 3, dt: 1 }));
    segments[10] = { ds: 200, dt: 1 };
    const recorded = Array.from({ length: 121 }, (_, i) => (i % 7 === 0 ? 0 : 2));
    recorded[10] = 500; // sensor glitch — dropped by the dd/dt cross-check
    const caches = buildCaches(makeTrack(segments, { recorded }), 'distance');
    // The isolated zero joins its window mean (data, not a gap); the glitch
    // is dropped by the cross-check, and the window sees only trusted values.
    assert.closeTo(caches.speeds[7], (2 + 2 + 0 + 2 + 2) / 5, 1e-9);
    let max = -Infinity;
    for (const v of caches.speeds) if (Number.isFinite(v)) max = Math.max(max, v);
    assert.closeTo(max, 2, 1e-9);
  });

  test('a partially recorded series is smoothed the same way', () => {
    const segments = Array.from({ length: 120 }, () => ({ ds: 3, dt: 1 }));
    segments[10] = { ds: 200, dt: 1 };
    const recorded = Array.from({ length: 121 }, () => null);
    recorded[0] = 3;
    recorded[1] = 3;
    const caches = buildCaches(makeTrack(segments, { recorded }), 'distance');
    assert.truthy(caches.speeds != null);
    let max = -Infinity;
    for (const v of caches.speeds) if (Number.isFinite(v)) max = Math.max(max, v);
    assert.closeTo(max, (3 + 3 + 200 + 3 + 3) / 5, 1e-9, 'the derived jump survives, diluted');
  });

  test('sparse recorded sampling: the cross-check drops the drift spikes', () => {
    // The yangtaishan shape: ~4 s between fixes, a pause with zeros, then
    // two drift samples — the device records 11/7 m/s while the positions
    // barely moved. The dd/dt cross-check distrusts both readings and the
    // window fills the hole from the trusted base-speed neighbors.
    const segments = [];
    for (let i = 0; i < 100; i++) segments.push({ ds: i % 25 === 0 ? 0.5 : 6, dt: 4 });
    segments[50] = { ds: 0.5, dt: 4 };
    segments[51] = { ds: 2, dt: 4 };  // positions moved 0.5 m — drift
    segments[52] = { ds: 1.5, dt: 4 }; // positions moved 0.375 m — drift
    const recorded = Array.from({ length: 101 }, (_, i) => (i % 25 === 0 ? 0 : 1.6667));
    recorded[51] = 11.1111;
    recorded[52] = 6.9444;
    const caches = buildCaches(makeTrack(segments, { recorded }), 'distance');
    let max = -Infinity;
    for (const v of caches.speeds) if (Number.isFinite(v)) max = Math.max(max, v);
    assert.closeTo(max, 1.6667, 0.01, 'both drift readings are gone; only base speed remains');
  });

  test('the GAP series inherits the cleaned speeds', () => {
    const segments = [...flatRun];
    segments[10] = { ds: 200, dt: 1 };
    const caches = buildCaches(makeTrack(segments), 'distance');
    assert.truthy(caches.gapSpeeds != null);
    // Computed series → 3σ clean → the spike never reaches GAP either.
    assert.closeTo(caches.gapSpeeds[10], 3 / minettiFactor(0), 1e-9);
  });
});

suite('profile / seriesExtremes (full-resolution overlay extremes)', () => {
  test('a one-point peak survives at full resolution', () => {
    // The regression behind the speed-axis strip: the retired per-pixel
    // column averaging diluted a lone peak (it read 15.545 km/h where the
    // metrics list reported the per-point 15.552, width-dependently). The
    // chart now draws and scales from the raw series, so its extremes are
    // the same per-point values the list reports.
    const n = 40;
    const speeds = new Float64Array(n).fill(3);
    speeds[20] = 15.552 / 3.6;
    const ext = seriesExtremes((i) => speeds[i], n);
    assert.closeTo(ext.hi, speeds[20], 1e-9);
    assert.closeTo(ext.lo, 3, 1e-9);
  });

  test('reads every point and skips null / NaN readings', () => {
    const values = [2, null, NaN, 6, Infinity, 1];
    const ext = seriesExtremes((i) => values[i], values.length);
    assert.closeTo(ext.lo, 1, 1e-9);
    assert.closeTo(ext.hi, 6, 1e-9);
  });

  test('returns null when no point carries a finite value', () => {
    assert.equal(seriesExtremes(() => null, 5), null);
    assert.equal(seriesExtremes(() => NaN, 5), null);
    assert.equal(seriesExtremes(() => 3, 0), null);
  });
});

suite('profile / the sampling draw path is gone', () => {
  test('sampleElevation / sampleOverlay are no longer module exports', () => {
    // The renderer receives the full-resolution series; a reintroduced
    // per-pixel-column sampler would be a spec regression, not a refactor.
    assert.equal(profileData.sampleElevation, undefined);
    assert.equal(profileData.sampleOverlay, undefined);
  });
});

suite('profile / chart scale ranges (full-resolution, uPlot inputs)', () => {
  const hrTrack = {
    pointCount: 3,
    points: [{ hr: 120 }, { hr: 150 }, { hr: 180 }],
    hasElevation: true,
    eleMin: 200,
    eleMax: 1000,
  };

  test('overlayExtremes reads the raw series through the overlay reader', () => {
    const ext = overlayExtremes('hr', hrTrack, {});
    assert.closeTo(ext.lo, 120, 1e-9);
    assert.closeTo(ext.hi, 180, 1e-9);
  });

  test('overlayExtremes returns null when the series has no readings', () => {
    const none = { pointCount: 2, points: [{ hr: null }, { hr: NaN }] };
    assert.equal(overlayExtremes('hr', none, {}), null);
  });

  test('overlayYRange pads non-speed overlays on both ends', () => {
    // pad = max(range·8%, mean·4%) — here max(60·0.08, 150·0.04) = 6.0.
    const [lo, hi] = overlayYRange('hr', { lo: 120, hi: 180 });
    assert.closeTo(lo, 114, 1e-9);
    assert.closeTo(hi, 186, 1e-9);
  });

  test('the speed family keeps its top at the raw series maximum', () => {
    // The axis strip reads "this curve tops out at X" — the same per-point
    // maximum the metrics list reports, never a padded step above it.
    const [lo, hi] = overlayYRange('speed', { lo: 2, hi: 5 });
    assert.closeTo(lo, 2 - 0.24, 1e-9); // pad = max(3·8%, 3.5·4%) = 0.24
    assert.closeTo(hi, 5, 1e-9);
    // pace and gap are views of the same series — same scale rule.
    const pace = overlayYRange('pace', { lo: 2, hi: 5 });
    assert.closeTo(pace[1], 5, 1e-9);
  });

  test('physically non-negative series never scale below zero', () => {
    const [lo] = overlayYRange('hr', { lo: 1, hi: 3 });
    assert.truthy(lo >= 0);
  });

  test('a near-constant series pads by at least 4% of the series mean', () => {
    // Fresh legs on a flat loop: range ~0 would stretch GPS rounding noise
    // into a full-height zigzag without the mean-relative floor.
    const [lo, hi] = overlayYRange('hr', { lo: 100, hi: 100 });
    assert.closeTo(hi - lo, 8, 1e-9); // 100 · 4% = 4 on each side
  });

  test('eleYRange pads the data extremes by 8% (at least 4 m)', () => {
    const [lo, hi] = eleYRange(hrTrack);
    assert.closeTo(lo, 200 - 64, 1e-9);
    assert.closeTo(hi, 1000 + 64, 1e-9);
    const flat = { pointCount: 1, points: [{}], hasElevation: true, eleMin: 300, eleMax: 300 };
    const [fLo, fHi] = eleYRange(flat);
    assert.closeTo(fLo, 296, 1e-9);
    assert.closeTo(fHi, 304, 1e-9);
  });

  test('eleYRange returns null without elevation data', () => {
    assert.equal(eleYRange({ hasElevation: false, eleMin: 0, eleMax: 1 }), null);
  });
});

suite('profile / uPlot lazy loader', () => {
  test('concurrent calls share one load promise (no double import)', () => {
    const p1 = loadUPlot();
    const p2 = loadUPlot();
    assert.equal(p1, p2, 'the cached promise, not a fresh import, must be returned');
  });

  test('the promise resolves to the uPlot constructor', async () => {
    const uPlot = await loadUPlot();
    assert.truthy(typeof uPlot === 'function');
  });
});

suite('profileData / fit-to-sector window', () => {
  // Unit-agnostic: the same math serves Distance (m) and Time (ms) — these
  // cases use meters; the last case proves the ms shape.
  const TOTAL = 10_000;
  const FLOOR = 1_000;
  const widthOf = (w) => w.end - w.start;
  /** Handle position as a viewport fraction, the spec's acceptance band. */
  const fracOf = (w, v) => (v - w.start) / widthOf(w);

  test('a mid-track sector sits centered at the fit fraction (handles ≈9% / ≈91%)', () => {
    const w = sectorFitWindow(4_000, 5_000, TOTAL, FLOOR);
    const width = widthOf(w);
    assert.closeTo(width, 1_000 / FIT_SECTOR_FRACTION, 1e-9);
    assert.truthy(w.start <= 4_000 && w.end >= 5_000, 'sector fully visible');
    assert.truthy(w.start >= 0 && w.end <= TOTAL, 'window inside the domain');
    assert.closeTo(fracOf(w, 4_000), 0.09, 1e-9);
    assert.closeTo(fracOf(w, 5_000), 0.91, 1e-9);
  });

  test('a sector at the track start clamps to the domain, not to negative x', () => {
    const w = sectorFitWindow(0, 1_000, TOTAL, FLOOR);
    assert.equal(w.start, 0);
    assert.truthy(w.end >= 1_000, 'sector fully visible');
    assert.truthy(w.end < TOTAL, 'no blank space past the data');
  });

  test('a sector at the track end clamps to the domain, not past it', () => {
    const w = sectorFitWindow(9_000, 10_000, TOTAL, FLOOR);
    assert.equal(w.end, TOTAL);
    assert.truthy(w.start <= 9_000, 'sector fully visible');
    assert.truthy(w.start >= 0, 'no blank space before the data');
  });

  test('a tiny sector floors at the zoom floor instead of out-zooming the wheel', () => {
    const w = sectorFitWindow(5_000, 5_005, TOTAL, FLOOR);
    assert.equal(widthOf(w), FLOOR);
    assert.truthy(w.start <= 5_000 && w.end >= 5_005, 'sector fully visible');
  });

  test('the floor wins at a track edge too', () => {
    const w = sectorFitWindow(0, 100, TOTAL, FLOOR);
    assert.equal(w.start, 0);
    assert.equal(widthOf(w), FLOOR);
  });

  test('a sector near the full track fits the whole view (null, not an overscan)', () => {
    assert.equal(sectorFitWindow(0, 9_000, TOTAL, FLOOR), null);
    assert.equal(sectorFitWindow(0, TOTAL, TOTAL, FLOOR), null);
    // Exactly FIT_SECTOR_FRACTION of the track: the window would be the
    // domain itself, which IS the fitted state.
    assert.equal(sectorFitWindow(900, 9_100, TOTAL, FLOOR), null);
  });

  test('reversed sector ends fit the same window', () => {
    const ordered = sectorFitWindow(4_000, 5_000, TOTAL, FLOOR);
    const reversed = sectorFitWindow(5_000, 4_000, TOTAL, FLOOR);
    assert.closeTo(reversed.start, ordered.start, 1e-9);
    assert.closeTo(reversed.end, ordered.end, 1e-9);
  });

  test('the same math in time units (ms); a long sector clears the 20-minute floor', () => {
    const w = sectorFitWindow(2_000_000, 3_600_000, 7_200_000, 1_200_000);
    assert.closeTo(w.end - w.start, 1_600_000 / FIT_SECTOR_FRACTION, 1e-6);
    assert.truthy(w.start <= 2_000_000 && w.end >= 3_600_000, 'sector fully visible');
  });
});
