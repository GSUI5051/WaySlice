/** Elevation-profile data tests: speed-series smoothing + cache rules. */
import { suite, test, assert } from './runner.js';
import {
  buildCaches, sampleOverlay, seriesExtremes,
} from '../js/charts/elevation-profile/profile-data.js';
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
  test('a one-point peak dilutes in the column means but not in the extremes', () => {
    // The regression behind the speed-axis strip: sampleOverlay averages
    // each pixel column, so a lone spike read 15.545 km/h while the metrics
    // list reported the per-point 15.552 — the strip rounded a display step
    // below the list. seriesExtremes must return the full-resolution value.
    const n = 40;
    const xs = Float64Array.from({ length: n }, (_, i) => i * 10); // 10 m steps
    const speeds = new Float64Array(n).fill(3);
    speeds[20] = 15.552 / 3.6;
    const valueAt = (i) => speeds[i];
    const cols = 8; // wide columns → several points per column
    const vals = sampleOverlay(0, xs[n - 1], cols, valueAt, xs);
    let sampledMax = -Infinity;
    for (const v of vals) if (v != null && v > sampledMax) sampledMax = v;
    assert.truthy(sampledMax < speeds[20], 'column mean must dilute the lone peak');
    const ext = seriesExtremes(valueAt, n);
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
