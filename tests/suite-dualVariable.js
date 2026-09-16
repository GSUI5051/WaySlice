/** Dual-variable analysis tests: pair rules, sample filtering, density grid. */
import { suite, test, assert } from './runner.js';
import { isPairAllowed, partnersOf, getMetric, METRICS } from '../js/charts/dual-variable-analysis/metrics.js';
import {
  buildAnalysisSamples, metricAvailability, extractPair,
} from '../js/charts/dual-variable-analysis/samples.js';
import {
  computeDensity, relativeDensity, MIN_PAIR_SAMPLES, X_BINS, Y_BINS,
} from '../js/charts/dual-variable-analysis/densityCalculator.js';
import { computeTooltipPlacement } from '../js/charts/dual-variable-analysis/tooltip.js';

/**
 * Synthetic track: `segments[i]` = {ds, dt} for the gap point i → i+1.
 * Sensor callbacks fill point values; flags follow which callbacks exist
 * (override with hasPower / hasCad to simulate a flag without readings).
 * Shape mirrors suite-profileData's makeTrack, plus sensors.
 */
function makeTrack(segments, {
  recorded = null, hr = null, cad = null, power = null, temp = null,
  ele = 100, hasElevation = true, hasTime = true, hasPower, hasCad,
} = {}) {
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
      lat: 0,
      lon: i * 0.001,
      ele: hasElevation ? (typeof ele === 'function' ? ele(i) : ele) : null,
      time: hasTime ? time * 1000 : null,
      hr: hr ? hr(i) : null,
      cad: cad ? cad(i) : null,
      power: power ? power(i) : null,
      temp: temp ? temp(i) : null,
      speed: recorded ? recorded[i] : null,
      distance: null, lap: null,
    });
  }
  return {
    name: 'test',
    points,
    cumDist,
    totalDistance: dist,
    bounds: { minLat: 0, minLon: 0, maxLat: 0, maxLon: n * 0.001 },
    hasElevation,
    hasTime,
    hasHr: !!hr,
    hasCad: hasCad !== undefined ? hasCad : !!cad,
    hasTemp: !!temp,
    hasPower: hasPower !== undefined ? hasPower : !!power,
    eleMin: 0,
    eleMax: 0,
    pointCount: n,
    waypoints: [],
  };
}

const MOVE = (n) => Array.from({ length: n }, () => ({ ds: 8, dt: 1 })); // 8 m/s
const STANDSTILL = (n) => Array.from({ length: n }, () => ({ ds: 0.05, dt: 1 }));

suite('dual-variable / valid pair table', () => {
  test('every spec combination is allowed in both directions', () => {
    const allowed = [
      ['hr', 'speed'], ['hr', 'pace'], ['hr', 'gap'], ['hr', 'power'], ['hr', 'cad'],
      ['hr', 'grade'], ['hr', 'ele'],
      ['power', 'speed'], ['power', 'pace'], ['power', 'gap'], ['power', 'cad'],
      ['cad', 'speed'], ['cad', 'pace'], ['cad', 'gap'],
      ['temp', 'speed'], ['temp', 'pace'], ['temp', 'gap'], ['temp', 'power'], ['temp', 'cad'],
      ['grade', 'power'], ['grade', 'hr'], ['grade', 'cad'],
      ['grade', 'speed'], ['grade', 'pace'], ['grade', 'gap'],
      ['ele', 'hr'], ['ele', 'temp'], ['ele', 'power'], ['ele', 'cad'],
    ];
    for (const [a, b] of allowed) {
      assert.truthy(isPairAllowed(a, b), `${a} × ${b} must be allowed`);
      assert.truthy(isPairAllowed(b, a), `${b} × ${a} must be allowed`);
    }
  });

  test('same-metric and unlisted pairs are rejected', () => {
    for (const m of METRICS) assert.equal(isPairAllowed(m.id, m.id), false);
    const forbidden = [
      ['hr', 'temp'],
      ['temp', 'grade'], ['grade', 'ele'], ['ele', 'speed'], ['ele', 'pace'], ['ele', 'gap'],
      ['speed', 'pace'], ['speed', 'gap'], ['pace', 'gap'],
    ];
    for (const [a, b] of forbidden) {
      assert.equal(isPairAllowed(a, b), false, `${a} × ${b} must be rejected`);
      assert.equal(isPairAllowed(b, a), false, `${b} × ${a} must be rejected`);
    }
    assert.equal(isPairAllowed('', 'hr'), false);
    assert.equal(isPairAllowed('hr', ''), false);
  });

  test('Y partners of every X stay inside the pair table', () => {
    for (const m of METRICS) {
      for (const p of partnersOf(m.id)) {
        assert.truthy(isPairAllowed(m.id, p), `${m.id} lists non-pair partner ${p}`);
      }
    }
  });

  test('every metric exposes label, unit and formatter', () => {
    for (const m of METRICS) {
      assert.truthy(m.labelKey);
      assert.truthy(m.unit());
      assert.equal(typeof m.format, 'function');
      assert.equal(typeof m.toDisplay, 'function');
      assert.equal(typeof m.fromDisplay, 'function');
      // display → raw → display round-trips
      assert.closeTo(m.fromDisplay(m.toDisplay(3.3)), 3.3, 1e-9);
    }
  });

  test('metric lookup falls back cleanly', () => {
    assert.truthy(getMetric('hr'));
    assert.equal(getMetric('nope'), undefined);
  });

  test('pace-family metrics reverse their axis on BOTH axes (fast on top / right)', () => {
    // A SMALLER pace is a FASTER effort — a pace axis must run DESCENDING in
    // screen space: fast end at the top when vertical (5:00 above 15:00) and
    // at the right when horizontal (5:00 right of 15:00). GAP is a pace too;
    // every other metric keeps the normal orientation on both axes.
    assert.equal(getMetric('pace').reversed, true);
    assert.equal(getMetric('gap').reversed, true);
    for (const m of METRICS) {
      if (m.id === 'pace' || m.id === 'gap') continue;
      assert.equal(!!m.reversed, false, `${m.id} must not reverse its axis`);
    }
  });
});

suite('dual-variable / sample filtering', () => {
  test('a clean track keeps every point as a sample row', () => {
    // MOVE(30) is 30 segments → 31 points.
    const samples = buildAnalysisSamples(makeTrack(MOVE(30), { hr: () => 140 }));
    assert.equal(samples.count, 31);
  });

  test('confirmed-pause points are excluded (data-layer rule)', () => {
    // 20 s moving, 15 × 1 s standstill (confirmed at 10 s), 10 s moving again:
    // 46 points, of which points 21..35 (times 21 s..35 s) sit inside the
    // pause span (20 s, 35 s] — the same predicate as pauseFreeSamples.
    const segments = [...MOVE(20), ...STANDSTILL(15), ...MOVE(10)];
    const samples = buildAnalysisSamples(makeTrack(segments, { hr: () => 140 }));
    assert.equal(samples.count, 46 - 15);
  });

  test('speed > 0 with power <= 0 drops the point — only on power-bearing tracks', () => {
    const power = (i) => (i % 3 === 0 ? 0 : 150);
    const track = makeTrack(MOVE(30), { power });
    // 31 points; i = 0, 3, …, 27 read zero (the untimed last point is never
    // "moving", so its zero cannot trip the rule) → 10 drops.
    assert.equal(buildAnalysisSamples(track).count, 21, 'coasting / zero-power points dropped');
    const noMeter = makeTrack(MOVE(30), { power, hasPower: false });
    assert.equal(buildAnalysisSamples(noMeter).count, 31, 'a track without a power meter is not filtered');
  });

  test('speed > 0 with cadence <= 0 drops the point — only on cadence tracks', () => {
    const cad = (i) => (i % 4 === 0 ? 0 : 80);
    const track = makeTrack(MOVE(24), { cad });
    // 25 points; i = 0, 4, …, 20 read zero → 6 drops.
    assert.equal(buildAnalysisSamples(track).count, 19, 'zero-cadence moving points dropped');
    const noSensor = makeTrack(MOVE(24), { cad, hasCad: false });
    assert.equal(buildAnalysisSamples(noSensor).count, 25);
  });

  test('missing sensor readings stay NaN — never zero-filled', () => {
    const hr = (i) => (i % 5 === 0 ? null : 140);
    const samples = buildAnalysisSamples(makeTrack(MOVE(20), { hr }));
    let missing = 0;
    for (let i = 0; i < samples.count; i++) {
      if (!Number.isFinite(samples.hr[i])) missing++;
    }
    assert.equal(missing, 5, 'null readings stay NaN inside the table');
  });

  test('speed derives from dd/dt when the file has no recorded speeds', () => {
    const samples = buildAnalysisSamples(makeTrack(MOVE(10)));
    assert.truthy(samples.hasSpeed);
    assert.closeTo(samples.speed[0], 8, 1e-9);
    assert.closeTo(samples.pace[0], 125, 1e-9, 'pace is 1000 / speed');
  });

  test('the last point carries no segment values (speed/pace NaN there)', () => {
    const samples = buildAnalysisSamples(makeTrack(MOVE(10)));
    assert.truthy(Number.isFinite(samples.speed[samples.count - 2]));
    assert.truthy(!Number.isFinite(samples.speed[samples.count - 1]));
    assert.truthy(!Number.isFinite(samples.pace[samples.count - 1]));
  });

  test('untimed tracks without recorded speeds have no speed family', () => {
    const track = makeTrack(MOVE(10), { hasTime: false });
    const samples = buildAnalysisSamples(track);
    assert.equal(samples.hasSpeed, false);
    const avail = metricAvailability(samples, track);
    assert.equal(avail.speed.available, false);
    assert.equal(avail.pace.available, false);
  });

  test('availability follows the FILTERED table', () => {
    // The only hr readings sit inside the pause — the filter removes them all.
    const segments = [...MOVE(20), ...STANDSTILL(15), ...MOVE(10)];
    const hr = (i) => (i >= 21 && i <= 35 ? 140 : null);
    const track = makeTrack(segments, { hr });
    const avail = metricAvailability(buildAnalysisSamples(track), track);
    assert.equal(avail.hr.available, false, 'every hr reading sat inside a pause');
    assert.equal(avail.speed.available, true);
  });
});

suite('dual-variable / pair extraction', () => {
  test('rows missing X or Y never enter the pair (spec §11)', () => {
    const hr = (i) => (i % 5 === 0 ? null : 140);
    const track = makeTrack(MOVE(20), { hr });
    const samples = buildAnalysisSamples(track);
    const { xs, ys } = extractPair(samples, 'hr', 'speed');
    // 21 rows; 5 carry no hr (i = 0, 5, 10, 15, 20 — the last of those is
    // also the segmentless point) → the pair keeps 16.
    assert.equal(xs.length, 16);
    assert.equal(ys.length, xs.length);
    for (let i = 0; i < xs.length; i++) {
      assert.truthy(Number.isFinite(xs[i]) && Number.isFinite(ys[i]));
    }
  });

  test('values are raw SI: speed in m/s, hr in bpm', () => {
    const track = makeTrack(MOVE(10), { hr: () => 150 });
    const { xs, ys } = extractPair(buildAnalysisSamples(track), 'speed', 'hr');
    assert.closeTo(xs[0], 8, 1e-9);
    assert.closeTo(ys[0], 150, 1e-9);
  });
});

suite('dual-variable / density grid', () => {
  test('needs at least MIN_PAIR_SAMPLES valid pairs', () => {
    const n = MIN_PAIR_SAMPLES - 1;
    assert.equal(computeDensity(new Float64Array(n).fill(1), new Float64Array(n).fill(1)), null);
    assert.truthy(computeDensity(
      new Float64Array(MIN_PAIR_SAMPLES).fill(1),
      new Float64Array(MIN_PAIR_SAMPLES).fill(1),
    ));
  });

  test('bin counts stay consistent and inside the grid', () => {
    const n = 500;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = (i / n) * 10;
      ys[i] = (i * 7) % 23;
    }
    const d = computeDensity(xs, ys);
    assert.equal(d.nx, X_BINS);
    assert.equal(d.ny, Y_BINS);
    assert.equal(d.sampleCount, n);
    let sum = 0;
    let max = 0;
    for (const c of d.counts) { sum += c; if (c > max) max = c; }
    assert.equal(sum, d.binnedCount);
    assert.equal(max, d.maxCount);
    assert.truthy(d.binnedCount <= n);
  });

  test('rare extreme values cannot compress the data body (robust domain)', () => {
    // 2000 points in 0..9 plus 3 absurd spikes (0.15 %): the drawn domain
    // must stay on the data body, the spikes just fall outside the grid.
    const n = 2000;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = i < n - 3 ? (i % 10) : 10_000;
      ys[i] = (i * 13) % 31;
    }
    const d = computeDensity(xs, ys);
    assert.truthy(d.x1 - d.x0 < 100, `domain must ignore the spikes, got ${d.x1 - d.x0}`);
    assert.truthy(d.binnedCount >= n * 0.9, 'the data body still bins');
  });

  test('the exact domain edges land inside bins, not out of range', () => {
    const n = 50;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = i / (n - 1);       // 0..1 inclusive
      ys[i] = (i / (n - 1)) * 100; // 0..100 inclusive
    }
    const d = computeDensity(xs, ys);
    assert.equal(d.binnedCount, n, 'quantile domain + padding keeps the full range');
  });

  test('a constant series still produces a usable grid', () => {
    const n = 100;
    const xs = new Float64Array(n).fill(42);
    const ys = new Float64Array(n);
    for (let i = 0; i < n; i++) ys[i] = i / n;
    const d = computeDensity(xs, ys);
    assert.truthy(d.x1 > d.x0, 'degenerate x range expanded');
    assert.truthy(d.maxCount > 0);
  });

  test('relative density normalizes to 0..1 by the busiest bin', () => {
    assert.equal(relativeDensity(0, 10), 0);
    assert.closeTo(relativeDensity(7, 10), 0.7, 1e-9);
    assert.closeTo(relativeDensity(10, 10), 1, 1e-9);
  });

  test('bins without points stay at zero count', () => {
    const n = 100;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = i < n / 2 ? 0 : 10;
      ys[i] = 5;
    }
    const d = computeDensity(xs, ys);
    let empty = 0;
    let filled = 0;
    for (const c of d.counts) {
      if (c === 0) empty++;
      else filled++;
    }
    assert.truthy(empty > 0);
    assert.truthy(filled > 0);
  });
});

suite('dual-variable / tooltip placement (whole-dialog safe area)', () => {
  // The safe area is the dialog body's rect; the plot bounds play no part.
  const SAFE = { left: 0, top: 100, right: 390, bottom: 700 };
  const W = 130;
  const H = 64;

  test('mouse: prefers above the anchor with the requested gap', () => {
    const p = computeTooltipPlacement(200, 400, W, H, SAFE, 14, false);
    assert.equal(p.top, 400 - 14 - H);
    assert.equal(p.left, 200 - W / 2, 'centered on the anchor');
  });

  test('mouse: falls back to below when above cannot fit', () => {
    // above would poke out of the safe top (150 - 14 - 64 = 72 < 108)
    const p = computeTooltipPlacement(200, 150, W, H, SAFE, 14, false);
    assert.equal(p.top, 150 + 14);
  });

  test('mouse: goes beside the anchor (roomier side) when neither above nor below fits', () => {
    const tiny = { left: 0, top: 100, right: 390, bottom: 180 };
    const p = computeTooltipPlacement(200, 140, W, H, tiny, 14, false);
    assert.equal(p.left, 56, 'left side: anchor - gap - box width');
    assert.equal(p.top, 108, 'vertically clamped to the safe top + margin');
  });

  test('mouse: stays inside the safe area horizontally at both edges', () => {
    const p = computeTooltipPlacement(20, 400, W, H, SAFE, 14, false);
    assert.equal(p.left, 8, 'clamps to the safe left + margin');
    const p2 = computeTooltipPlacement(380, 400, W, H, SAFE, 14, false);
    assert.equal(p2.left, 390 - 8 - W, 'clamps to the safe right - margin - box');
  });

  test('touch: DIRECTLY above the touch point with the 8–12 px gap', () => {
    const p = computeTooltipPlacement(200, 400, W, H, SAFE, 10, true);
    assert.equal(p.top, 400 - 10 - H);
    assert.equal(p.left, 200 - W / 2, 'horizontally aligned with the touch point');
  });

  test('touch: above fits whenever the DIALOG top has room, never a plot flip', () => {
    // A tap high up still reads above — the box just leaves the chart card;
    // only the DIALOG top (safe top + margin) can stop it.
    const p = computeTooltipPlacement(200, 190, W, H, SAFE, 10, true);
    assert.equal(p.top, 190 - 10 - H);
  });

  test('touch: the box stays ABOVE-positioned even when the dialog top is too close', () => {
    // The unclamped top (150 - 10 - 64 = 76) pokes above the safe area —
    // the box clamps to the safe top (fully visible, as high as possible)
    // instead of ever flipping below the touch point.
    const p = computeTooltipPlacement(200, 150, W, H, SAFE, 10, true);
    assert.equal(p.top, 108, 'clamped to the safe top + margin');
    assert.equal(p.left, 200 - W / 2, 'horizontally aligned');
  });

  test('touch: never falls to a side placement', () => {
    // The same geometry the mouse ladder resolves as "beside on the left" —
    // touch keeps the above placement, clamped into the tiny safe area.
    const tiny = { left: 0, top: 100, right: 390, bottom: 180 };
    const p = computeTooltipPlacement(200, 140, W, H, tiny, 10, true);
    assert.equal(p.left, 200 - W / 2, 'horizontally aligned, no side search');
    assert.equal(p.top, 108, 'clamped fully visible inside the safe area');
  });
});
