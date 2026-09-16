/** Heart-rate zones tests — settings validation, zone math, classification, pause-aware time-in-zone. */
import { suite, test, assert } from './runner.js';
import {
  DEFAULT_HEART_RATE_SETTINGS, validateSettings,
  loadHeartRateSettings, saveHeartRateSettings, resetHeartRateSettings,
} from '../js/metrics/heartRateSettings.js';
import {
  getHeartRateDisplay, setHeartRateDisplay, resetHeartRateDisplay,
} from '../js/metrics/heartRateDisplay.js';
import { on } from '../js/core/events.js';
import {
  computeZoneBounds, computeBoundaryPcts, classifyHr, zoneDisplayRange,
} from '../js/metrics/heartRateZones.js';
import { computeHeartRateZoneStats } from '../js/metrics/heartRateStats.js';
import { computeSectorMetrics } from '../js/metrics/sectorMetrics.js';
import { prepareTrack } from '../js/geo/track.js';
import { eastTrack } from './helpers.js';

/** Settings builder: cloned defaults with shallow overrides. */
function hrSettings(overrides = {}, zones = {}) {
  const d = DEFAULT_HEART_RATE_SETTINGS;
  return {
    ...d, ...overrides,
    zones: {
      max: [...(zones.max ?? d.zones.max)],
      hrr: [...(zones.hrr ?? d.zones.hrr)],
      lthr: [...(zones.lthr ?? d.zones.lthr)],
    },
  };
}

function prepared(points) {
  return prepareTrack(points, 'test');
}

suite('heart rate / settings validation & persistence', () => {
  test('defaults pass the shared validation gate', () => {
    assert.equal(validateSettings(DEFAULT_HEART_RATE_SETTINGS), null);
    assert.equal(validateSettings(hrSettings()), null);
  });

  test('empty storage loads the defaults', () => {
    resetHeartRateSettings();
    const loaded = loadHeartRateSettings();
    assert.equal(loaded.mode, 'max');
    assert.equal(loaded.maxHR, 190);
    assert.deepEqual(loaded.zones.hrr, [125, 138, 151, 164, 177]);
  });

  test('corrupt JSON falls back to defaults instead of throwing', () => {
    localStorage.setItem('wayslice-hr-zones', '{"mode": "max", oops');
    const loaded = loadHeartRateSettings();
    assert.equal(loaded.maxHR, DEFAULT_HEART_RATE_SETTINGS.maxHR);
    assert.equal(validateSettings(loaded), null);
  });

  test('missing fields / wrong types fall back to defaults', () => {
    localStorage.setItem('wayslice-hr-zones', JSON.stringify({ mode: 'max' }));
    assert.equal(loadHeartRateSettings().restingHR, 60);
    localStorage.setItem('wayslice-hr-zones', JSON.stringify(hrSettings({ maxHR: '190' })));
    assert.equal(loadHeartRateSettings().maxHR, 190);
    localStorage.setItem('wayslice-hr-zones', JSON.stringify(hrSettings({ mode: 'ftp' })));
    assert.equal(loadHeartRateSettings().mode, 'max');
  });

  test('illegal zone bpm bounds fall back to defaults', () => {
    // inverted
    localStorage.setItem('wayslice-hr-zones',
      JSON.stringify(hrSettings({}, { hrr: [177, 138, 151, 164, 171] })));
    assert.equal(loadHeartRateSettings().mode, 'max');
    // duplicated bound
    localStorage.setItem('wayslice-hr-zones',
      JSON.stringify(hrSettings({}, { max: [95, 114, 114, 152, 171] })));
    assert.equal(loadHeartRateSettings().maxHR, 190);
    // non-integer bound
    assert.equal(validateSettings(hrSettings({}, { max: [95, 114.5, 133, 152, 171] })), 'hrZoneErrorOrder');
    // out of range
    assert.equal(validateSettings(hrSettings({}, { hrr: [40, 50, 60, 70, 300] })), 'hrZoneErrorOrder');
    // LTHR B4 at/above the implicit B5 = the threshold
    assert.equal(validateSettings(hrSettings({ lthr: 170 }, { lthr: [102, 119, 170, 171] })), 'hrZoneErrorOrder');
    // LTHR needs FOUR bounds (B1..B4; B5 is the threshold itself)
    assert.equal(validateSettings(hrSettings({}, { lthr: [102, 119, 136] })), 'hrZoneErrorOrder');
  });

  test('relational checks: max > resting, resting < lthr < max', () => {
    assert.equal(validateSettings(hrSettings({ restingHR: 150, maxHR: 150 })), 'hrZoneErrorMaxRest');
    assert.equal(validateSettings(hrSettings({ lthr: 60 })), 'hrZoneErrorLthr');
    assert.equal(validateSettings(hrSettings({ lthr: 195 })), 'hrZoneErrorLthr');
    assert.equal(validateSettings(hrSettings({ maxHR: 120.5 })), 'hrZoneErrorMaxHr');
  });

  test('invalid candidates are never persisted', () => {
    resetHeartRateSettings();
    saveHeartRateSettings(hrSettings({ maxHR: 200 }));
    const error = saveHeartRateSettings(hrSettings({ maxHR: 50 }));
    assert.truthy(error);
    assert.equal(loadHeartRateSettings().maxHR, 200);
  });

  test('valid saves persist and round-trip', () => {
    const candidate = hrSettings({ mode: 'lthr', lthr: 165 }, { lthr: [99, 116, 132, 148] });
    assert.equal(saveHeartRateSettings(candidate), null);
    const loaded = loadHeartRateSettings();
    assert.equal(loaded.mode, 'lthr');
    assert.equal(loaded.lthr, 165);
    assert.deepEqual(loaded.zones.lthr, [99, 116, 132, 148]);
    resetHeartRateSettings();
  });

  test('per-mode zone arrays are independent — switching modes keeps config', () => {
    const a = hrSettings({ mode: 'hrr' }, { hrr: [120, 135, 148, 160, 172] });
    assert.equal(validateSettings(a), null);
    assert.deepEqual(a.zones.max, DEFAULT_HEART_RATE_SETTINGS.zones.max);
    assert.deepEqual(a.zones.lthr, DEFAULT_HEART_RATE_SETTINGS.zones.lthr);
  });

  test('v1 percentage blobs migrate to bpm bounds with the stored base rates', () => {
    const v1 = {
      version: 1, mode: 'max', maxHR: 190, restingHR: 60, lthr: 170,
      zones: { max: [50, 60, 70, 80, 90], hrr: [50, 60, 70, 80, 90], lthr: [60, 70, 80, 90] },
    };
    localStorage.setItem('wayslice-hr-zones', JSON.stringify(v1));
    const loaded = loadHeartRateSettings();
    assert.equal(loaded.version, 2);
    // 50–90 % of 190 / of reserve 130 + 60 / of 170.
    assert.deepEqual(loaded.zones.max, [95, 114, 133, 152, 171]);
    assert.deepEqual(loaded.zones.hrr, [125, 138, 151, 164, 177]);
    assert.deepEqual(loaded.zones.lthr, [102, 119, 136, 153]);
  });

  test('a v1 blob whose rounding collapses falls back to the defaults', () => {
    // Reserve of 2 bpm: every 10 % step rounds onto the same bpm.
    const v1 = {
      version: 1, mode: 'hrr', maxHR: 152, restingHR: 150, lthr: 151,
      zones: { max: [50, 60, 70, 80, 90], hrr: [50, 60, 70, 80, 90], lthr: [60, 70, 80, 90] },
    };
    localStorage.setItem('wayslice-hr-zones', JSON.stringify(v1));
    const loaded = loadHeartRateSettings();
    assert.equal(loaded.maxHR, DEFAULT_HEART_RATE_SETTINGS.maxHR);
    assert.deepEqual(loaded.zones.hrr, DEFAULT_HEART_RATE_SETTINGS.zones.hrr);
  });

  test('unknown storage versions fall back to the defaults', () => {
    localStorage.setItem('wayslice-hr-zones',
      JSON.stringify({ ...hrSettings(), version: 99 }));
    assert.equal(loadHeartRateSettings().version, 2);
    assert.equal(loadHeartRateSettings().maxHR, DEFAULT_HEART_RATE_SETTINGS.maxHR);
  });
});

suite('heart rate / zone math & classification', () => {
  test('zone bounds ARE the stored bpm lower bounds — upper bounds derived', () => {
    const b = computeZoneBounds(hrSettings({ mode: 'max' }));
    assert.deepEqual(b.zones.map((z) => z.lo), [95, 114, 133, 152, 171]);
    // zone N ends where zone N+1 begins; zone 5 is open above B5.
    assert.deepEqual(b.zones.map((z) => z.hi), [114, 133, 152, 171, null]);
    assert.equal(b.zones[4].hi, null);
  });

  test('integer display: [B_n, B_n+1) → [B_n, B_n+1 − 1], no overlap, no gap', () => {
    const b = computeZoneBounds(hrSettings({ mode: 'max' }));
    const shown = b.zones.map(zoneDisplayRange);
    assert.deepEqual(shown.map((z) => z.lo), [95, 114, 133, 152, 171]);
    assert.deepEqual(shown.map((z) => z.hi), [113, 132, 151, 170, null]);
  });

  test('zoneDisplayRange stays correct for fractional bounds', () => {
    const shown = zoneDisplayRange({ lo: 102.5, hi: 123 });
    assert.deepEqual(shown, { lo: 103, hi: 122 });
  });

  test('HRR linkage: moving zone 2\'s bound moves zone 1\'s top with it', () => {
    const b = computeZoneBounds(
      hrSettings({ mode: 'hrr', restingHR: 60, maxHR: 190 }, { hrr: [125, 140, 151, 164, 177] }));
    assert.deepEqual(b.zones[0], { lo: 125, hi: 140 });
    assert.deepEqual(b.zones[1], { lo: 140, hi: 151 });
  });

  test('LTHR: zone 4 closes at the threshold (implicit B5 = lthr)', () => {
    const b = computeZoneBounds(hrSettings({ mode: 'lthr', lthr: 170 }, { lthr: [102, 119, 136, 153] }));
    assert.deepEqual(b.zones.map((z) => z.hi), [119, 136, 153, 170, null]);
    assert.equal(b.zones[3].hi, 170);
    assert.equal(b.zones[4].lo, 170);
  });

  test('boundary percentages: MAX derives bpm / maxHR', () => {
    const p = computeBoundaryPcts(hrSettings({ mode: 'max' }));
    assert.deepEqual(p.map((x) => Math.round(x)), [50, 60, 70, 80, 90]);
  });

  test('boundary percentages: HRR derives Karvonen (bpm − rest) / reserve', () => {
    const p = computeBoundaryPcts(hrSettings({ mode: 'hrr', restingHR: 60, maxHR: 190 }));
    assert.deepEqual(p.map((x) => Math.round(x)), [50, 60, 70, 80, 90]);
  });

  test('boundary percentages: LTHR zone 5 is exactly 100', () => {
    const p = computeBoundaryPcts(hrSettings({ mode: 'lthr', lthr: 170 }, { lthr: [102, 119, 136, 153] }));
    assert.deepEqual(p.map((x) => Math.round(x)), [60, 70, 80, 90, 100]);
    assert.equal(p[4], 100);
  });

  test('spec example: max HR 190, zone 2 lower 119 bpm → ≈ 62.6 %', () => {
    const p = computeBoundaryPcts(
      hrSettings({ mode: 'max', maxHR: 190 }, { max: [102, 119, 136, 153, 170] }));
    assert.closeTo(p[1], 62.6, 0.1);
  });

  test('spec example: rest 60, max 190, zone 1 lower 125 bpm → 50 %', () => {
    const p = computeBoundaryPcts(
      hrSettings({ mode: 'hrr', restingHR: 60, maxHR: 190 }, { hrr: [125, 138, 151, 164, 177] }));
    assert.closeTo(p[0], 50, 0.001);
  });

  test('classification: half-open; below B1 → no zone', () => {
    const b = computeZoneBounds(hrSettings({ mode: 'max', maxHR: 200 }, { max: [100, 120, 140, 160, 180] }));
    assert.equal(classifyHr(99, b), 0);   // below B1 — no zone at all
    assert.equal(classifyHr(100, b), 1);  // boundary opens its own zone
    assert.equal(classifyHr(119, b), 1);
    assert.equal(classifyHr(120, b), 2);
    assert.equal(classifyHr(139, b), 2);
    assert.equal(classifyHr(140, b), 3);
    assert.equal(classifyHr(159, b), 3);
    assert.equal(classifyHr(160, b), 4);
    assert.equal(classifyHr(179, b), 4);
    assert.equal(classifyHr(180, b), 5);
    assert.equal(classifyHr(250, b), 5);
  });

  test('invalid settings yield no bounds and no percentages', () => {
    assert.equal(computeZoneBounds(hrSettings({ maxHR: 10 })), null);
    assert.equal(computeBoundaryPcts(hrSettings({ maxHR: 10 })), null);
  });
});

/**
 * 5 m/s (~18 km/h) track with 2 s sampling; optional stationary stretch.
 * 10 m per point: lonStep 0.00009 ≈ 10.008 m. The synthetic "pause" is a
 * teleport: the segment INTO the first stationary point still covers 10 m
 * in 2 s (genuinely moving), so its reading is the moving HR — pause
 * readings begin with the second stationary point.
 * @private
 */
function movingTrack({ before = 20, pauseSteps = 0, after = 20, hr = () => 150, pauseHr = (n) => (n >= before + 1 ? 60 : 150) }) {
  const pts = [];
  const step = 0.00009;
  let t = 0;
  let lon = 0;
  const push = (moving) => {
    pts.push({ lat: 0, lon, ele: null, time: t * 1000, hr: moving ? hr(pts.length) : pauseHr(pts.length), cad: null, power: null, temp: null, speed: null, distance: null, lap: null });
    t += 2;
    if (moving) lon += step;
  };
  for (let i = 0; i < before; i++) push(true);
  for (let i = 0; i < pauseSteps; i++) push(false); // 2 s steps below 0.5 km/h
  for (let i = 0; i < after; i++) push(true);
  return prepared(pts);
}

suite('heart rate / pause-aware time-in-zone', () => {
  test('zone seconds match the readings; denominator is the moving time', () => {
    // 40 moving points = 39 moving segments × 2 s + trailing sliver.
    const track = movingTrack({ pauseSteps: 0 });
    const stats = computeHeartRateZoneStats(track, 0, track.totalDistance);
    assert.truthy(stats);
    assert.equal(stats.paused, 0);
    assert.equal(stats.noHr, 0);
    assert.equal(stats.below, 0);
    const total = stats.zones.reduce((sum, z) => sum + z.seconds, 0);
    // 39 segments at 2 s = 78 s, all at 150 bpm.
    assert.closeTo(total, 78, 0.01);
    assert.closeTo(stats.zones[2].seconds, 78, 0.01); // 150 bpm → zone 3 (133–151)
    assert.closeTo(stats.moving, 78, 0.01);
    // denominators agree with the metrics panel's moving time
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    assert.closeTo(stats.moving, m.moving, 0.01);
  });

  test('pause seconds (≥ 10 s below 0.5 km/h) enter no zone and no denominator', () => {
    // 7 stationary pushes → 8 co-located points → 7 stationary segments = 14 s.
    const track = movingTrack({ pauseSteps: 7 });
    const stats = computeHeartRateZoneStats(track, 0, track.totalDistance);
    assert.closeTo(stats.paused, 14, 0.01);
    assert.closeTo(stats.moving, 78, 0.01); // 92 s elapsed − 14 s pause
    // pause readings (60 bpm → below Zone 1) must not leak into any zone
    assert.equal(stats.zones[0].seconds, 0);
    assert.closeTo(stats.zones[2].seconds, 78, 0.01);
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    assert.closeTo(stats.moving, m.moving, 0.01);
  });

  test('a stop shorter than 10 s stays movement — its readings count (below B1 here)', () => {
    const track = movingTrack({ pauseSteps: 4 }); // 3 stationary segments = 6 s < 10 s
    const stats = computeHeartRateZoneStats(track, 0, track.totalDistance);
    assert.equal(stats.paused, 0);
    // The stationary stretch is movement, and its 60 bpm readings sit BELOW
    // the Zone 1 lower bound (95 bpm): 3 stationary segments × 2 s.
    assert.closeTo(stats.below, 6, 0.01);
  });

  test('missing heart-rate data enters no zone; percentages need not sum to 100', () => {
    let i = 0;
    const track = movingTrack({ before: 10, after: 10, hr: () => (++i % 2 ? 150 : null) });
    const stats = computeHeartRateZoneStats(track, 0, track.totalDistance);
    assert.truthy(stats.noHr > 0);
    const sum = stats.zones.reduce((acc, z) => acc + z.seconds, 0);
    assert.truthy(sum < stats.moving);
    assert.truthy(stats.zones[2].seconds > 0);
  });

  test('a sector without any heart rate yields null', () => {
    const track = prepared(eastTrack({
      count: 20,
      time: (i) => i * 2000,
    }));
    assert.equal(computeHeartRateZoneStats(track, 0, track.totalDistance), null);
  });

  test('zone seconds follow the selected sub-sector', () => {
    // First half at 150 bpm (zone 3), second half at 180 bpm (zone 5 > 171).
    const track = movingTrack({
      before: 20, after: 20,
      hr: (i) => (i < 20 ? 150 : 180),
      pauseHr: () => null,
    });
    // Split exactly at point 20: 20 segments (the last one ends ON point 20,
    // reading 180 bpm), then 19 segments at 180 bpm.
    const split = track.cumDist[20];
    const first = computeHeartRateZoneStats(track, 0, split);
    const second = computeHeartRateZoneStats(track, split, track.totalDistance);
    assert.closeTo(first.zones[2].seconds, 38, 0.01);
    assert.closeTo(first.zones[4].seconds, 2, 0.01);
    assert.closeTo(second.zones[4].seconds, 38, 0.01);
    assert.equal(second.zones[2].seconds, 0);
  });
});

suite('heart rate / profile display settings', () => {
  test('defaults: bands shown and hover highlight on (the pre-toggle behavior)', () => {
    resetHeartRateDisplay();
    assert.deepEqual(getHeartRateDisplay(), { showZones: true, highlight: true });
  });

  test('set persists, round-trips and emits hrzones:display with the new pair', () => {
    resetHeartRateDisplay();
    const seen = [];
    const off = on('hrzones:display', (d) => seen.push(d));
    setHeartRateDisplay({ showZones: false });
    off();
    assert.deepEqual(seen, [{ showZones: false, highlight: true }]);
    assert.deepEqual(getHeartRateDisplay(), { showZones: false, highlight: true });
    setHeartRateDisplay({ highlight: false });
    assert.deepEqual(getHeartRateDisplay(), { showZones: false, highlight: false });
    resetHeartRateDisplay();
  });

  test('highlight keeps its stored choice while showZones is off', () => {
    resetHeartRateDisplay();
    setHeartRateDisplay({ highlight: false });
    setHeartRateDisplay({ showZones: false });
    assert.deepEqual(getHeartRateDisplay(), { showZones: false, highlight: false });
    setHeartRateDisplay({ highlight: true });
    assert.deepEqual(getHeartRateDisplay(), { showZones: false, highlight: true });
    resetHeartRateDisplay();
  });

  test('corrupt JSON falls back to the defaults instead of throwing', () => {
    localStorage.setItem('wayslice-hr-display', '{"showZones": false, oops');
    assert.deepEqual(getHeartRateDisplay(), { showZones: true, highlight: true });
  });

  test('non-boolean fields fall back to the defaults as a whole', () => {
    localStorage.setItem('wayslice-hr-display', JSON.stringify({ showZones: false }));
    assert.deepEqual(getHeartRateDisplay(), { showZones: true, highlight: true });
    localStorage.setItem('wayslice-hr-display', JSON.stringify({ showZones: 'no', highlight: true }));
    assert.deepEqual(getHeartRateDisplay(), { showZones: true, highlight: true });
    localStorage.setItem('wayslice-hr-display', JSON.stringify([true, false]));
    assert.deepEqual(getHeartRateDisplay(), { showZones: true, highlight: true });
  });
});
