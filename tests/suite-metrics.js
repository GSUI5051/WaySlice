/** Sector metrics tests — the accuracy-critical core. */
import { suite, test, assert } from './runner.js';
import { computeSectorMetrics, minettiFactor } from '../js/metrics/sectorMetrics.js';
import { segmentType } from '../js/metrics/autoSegments.js';
import { computeTrackStats } from '../js/metrics/trackStats.js';
import { prepareTrack } from '../js/geo/track.js';
import { eastTrack } from './helpers.js';
import { buildCaches } from '../js/charts/elevation-profile/profile-data.js';

function prepared(points) {
  return prepareTrack(points, 'test');
}

/**
 * 2000 m: first half at 5 m/s, second half at 10 m/s, points every ~10 m.
 * Shared by the time (speed statistics) and pace-window suites.
 */
function twoSpeedTrack() {
  const pts = [];
  const step = 0.00009; // ≈ 10.008 m
  let t = 0;
  for (let i = 0; i < 200; i++) {
    pts.push({ lat: 0, lon: i * step, ele: null, time: t * 1000 });
    t += i < 100 ? 2 : 1; // ~5 m/s then ~10 m/s
  }
  return prepared(pts);
}

suite('metrics / elevation & 3D distance', () => {
  // 100 segments of ~111.195 m; rise 2 m/segment to point 50, then fall.
  const track = prepared(eastTrack({
    count: 101,
    ele: (i) => (i <= 50 ? i * 2 : 200 - i * 2),
  }));

  test('horizontal distance matches the sum of segments', () => {
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    assert.closeTo(m.horizontalDistance, 100 * 111.1949, 1);
  });

  test('gain/loss: +100 m / −100 m on the full track', () => {
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    assert.closeTo(m.gain, 100, 1e-6);
    assert.closeTo(m.loss, 100, 1e-6);
    assert.closeTo(m.netElevation, 0, 1e-6);
  });

  test('3 m hysteresis filter: noise sawtooth never counts, real climb does', () => {
    // 20 segments of ±2 m noise sawtooth (residual oscillates 2→0, never
    // passes 3), then a genuine 9-segment climb at +2 m/segment: only the
    // 4 confirmed +4 m residuals count, the trailing 2 m stays uncredited.
    const track = prepared(eastTrack({
      count: 30,
      ele: (i) => (i <= 20 ? (i % 2 === 1 ? 2 : 0) : (i - 20) * 2),
    }));
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    assert.equal(m.gain, 16);
    assert.equal(m.loss, 0);
    assert.closeTo(m.netElevation, 18, 1e-6); // honest net change, unfiltered
  });

  test('3D distance > horizontal and bounded (verticality is added, not multiplied)', () => {
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    assert.truthy(m.distance3D > m.horizontalDistance);
    assert.truthy(m.distance3D < m.horizontalDistance + 10,
      `3D too far from horizontal: ${m.distance3D - m.horizontalDistance}`);
  });

  test('flat track: 3D distance equals horizontal distance', () => {
    const flat = prepared(eastTrack({ count: 51, ele: () => 500 }));
    const m = computeSectorMetrics(flat, 0, flat.totalDistance);
    assert.closeTo(m.distance3D, m.horizontalDistance, 1e-6);
    assert.equal(m.gain, 0);
    assert.equal(m.loss, 0);
    // Flat is not descent-only: the formula reads 0 %, not the marker.
    assert.equal(m.avgGrade, 0);
  });

  test('effort distance = horizontal distance + gain ÷ 100', () => {
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    assert.closeTo(m.effortDistance, m.horizontalDistance + m.gain * 10, 1e-6);
    // 11119.5 m of distance + 100 m of gain credited as 1000 m.
    assert.closeTo(m.effortDistance, 100 * 111.1949 + 100 * 10, 1);
  });

  test('sector between two points: interpolated boundaries are exact', () => {
    // Start at 500 m, end at 1000 m (both mid-segment).
    const m = computeSectorMetrics(track, 500, 1000);
    assert.closeTo(m.horizontalDistance, 500, 1e-6);
    const slope = 2 / 111.1949; // rise per meter
    // The raw climb is 500 × slope ≈ 8.99 m, but the hysteresis filter only
    // credits residuals past 3 m: +3.007 (crossing) + 4 (second pair), and
    // the trailing 1.99 m residual stays below the threshold and is dropped.
    assert.closeTo(m.gain, 7.007, 0.01);
    assert.closeTo(m.eleStart, 500 * slope, 0.01);
    // Average grade = credited gain over horizontal distance.
    assert.closeTo(m.avgGrade, 7.007 / 500, 1e-4);
  });

  test('min/max elevation include interpolated boundaries', () => {
    const m = computeSectorMetrics(track, 500, track.totalDistance);
    assert.closeTo(m.eleMax, 100, 0.01);  // the summit at point 50
    assert.closeTo(m.eleMin, 0, 0.01);
  });

  test('sector = entire track equals track stats', () => {
    const sector = computeSectorMetrics(track, 0, track.totalDistance);
    const stats = computeTrackStats(track);
    assert.equal(sector.horizontalDistance, stats.horizontalDistance);
    assert.equal(sector.gain, stats.gain);
    assert.equal(sector.distance3D, stats.distance3D);
  });

  test('very short sector inside one segment', () => {
    const m = computeSectorMetrics(track, 50, 70);
    assert.closeTo(m.horizontalDistance, 20, 1e-6);
    assert.truthy(m.distance3D >= m.horizontalDistance);
    // A trailing window of >= 20 m still yields a grade (~1.8 % here).
    assert.closeTo(m.maxGrade, 2 / 111.1949, 1e-3);
  });

  test('sector shorter than the 20 m gradient window has no windowed grades', () => {
    const m = computeSectorMetrics(track, 50, 65);
    assert.closeTo(m.horizontalDistance, 15, 1e-6);
    assert.isNull(m.maxGrade);
    assert.isNull(m.minGrade);
  });

  test('degenerate (zero-length) sector does not crash', () => {
    const m = computeSectorMetrics(track, 500, 500);
    assert.equal(m.horizontalDistance, 0);
  });
});

suite('metrics / gradient', () => {
  test('constant slope: avg grade is the credited gain over distance', () => {
    // ~10 % slope: 1.112 m rise per ~111.195 m segment → 1 %.
    const track = prepared(eastTrack({ count: 101, ele: (i) => i * 0.1112 }));
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    // The hysteresis filter drops the trailing sub-threshold residual, so
    // the average grade reads just under the true 0.1 %.
    assert.closeTo(m.avgGrade, m.gain / m.horizontalDistance, 1e-9);
    assert.truthy(m.avgGrade > 0 && m.avgGrade < 0.001,
      `avgGrade should sit just under 0.1 %, got ${m.avgGrade}`);
    assert.closeTo(m.maxGrade, 0.001, 3e-4);
    assert.closeTo(m.minGrade, 0.001, 3e-4);
  });

  test('steep section dominates max grade, flat section sets the floor', () => {
    // Flat-ish 2 %, then ~18 %, then flat again.
    const ele = (i) => {
      if (i <= 30) return i * 0.2224;                      // 2 %
      if (i <= 50) return 30 * 0.2224 + (i - 30) * 2.0027; // ~18 %
      return 30 * 0.2224 + 20 * 2.0027;                    // flat
    };
    const track = prepared(eastTrack({ count: 81, ele }));
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    assert.closeTo(m.maxGrade, 0.018, 0.002);
    assert.truthy(m.minGrade < 0.003, `minGrade should be ~0, got ${m.minGrade}`);
  });

  test('descent-only sector has no average grade (—)', () => {
    const track = prepared(eastTrack({ count: 51, ele: (i) => 100 - i * 2 }));
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    assert.truthy(m.minGrade < -0.01);
    assert.truthy(m.maxGrade <= 0.001);
    assert.equal(m.gain, 0);
    assert.truthy(m.loss > 0);
    assert.isNull(m.avgGrade);
  });

  test('mixed sector with net descent still averages its ascent', () => {
    // Up 30 m over 40 segments, then down 50 m over 40: net −20 m, but the
    // climb is real, so the average grade stays positive and gain-based.
    const ele = (i) => (i <= 40 ? i * 0.75 : 30 - (i - 40) * 1.25);
    const track = prepared(eastTrack({ count: 81, ele }));
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    assert.truthy(m.gain > 0);
    assert.truthy(m.loss > m.gain);
    assert.truthy(m.netElevation < 0);
    assert.closeTo(m.avgGrade, m.gain / m.horizontalDistance, 1e-9);
    assert.truthy(m.avgGrade > 0);
  });
});

suite('metrics / fitness (heart rate, cadence)', () => {
  test('average and maximum heart rate plus average cadence', () => {
    // The 5-point window smooths even this short monotonic ramp: the edge
    // points average fewer neighbors, so the maximum lands one step down.
    const track = prepared(eastTrack({
      count: 5,
      hr: (i) => 100 + i,   // 100..104
      cad: (i) => 80 + i,   // 80..84
    }));
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    assert.equal(m.avgHr, 102);
    assert.equal(m.maxHr, 103);
    assert.equal(m.avgCad, 82);
    assert.equal(m.maxCad, 83);
  });

  test('sensor dropouts: averages skip points without values', () => {
    const track = prepared(eastTrack({
      count: 4,
      hr: (i) => (i === 1 ? null : 150),
      cad: (i) => (i % 2 === 0 ? 90 : null),
    }));
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    assert.equal(m.avgHr, 150);
    assert.equal(m.maxHr, 150);
    assert.equal(m.avgCad, 90);
  });

  test('no hr/cad data in the track → null, not zero', () => {
    const track = prepared(eastTrack({ count: 10 }));
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    assert.isNull(m.avgHr);
    assert.isNull(m.maxHr);
    assert.isNull(m.avgCad);
  });

  test('a sub-sector without hr points → null even when the track has hr', () => {
    // hr only on points 0-1; sector covers points 2-3.
    const pts = eastTrack({ count: 4, hr: (i) => (i <= 1 ? 120 : null) });
    const track = prepared(pts);
    const m = computeSectorMetrics(track, track.cumDist[2], track.cumDist[3]);
    assert.isNull(m.avgHr);
    assert.isNull(m.maxHr);
  });

  test('power: the point window smooths without timestamps; temperature is never filtered', () => {
    const track = prepared(eastTrack({
      count: 6,
      power: (i) => (i === 5 ? 400 : 200),   // one spike-ish tail value
      temp: (i) => [25, 27, 26, 28, 25, 24][i],
    }));
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    // The point window needs no clock: power is smoothed even though the
    // track has no timestamps (edge points average fewer neighbors).
    // Smoothed values: 200×3, 240, 250, 266.67. Temperature stays raw.
    assert.closeTo(m.avgPower, (200 * 3 + 240 + 250 + 800 / 3) / 6, 0.01);
    assert.closeTo(m.maxPower, 800 / 3, 0.01);
    assert.closeTo(m.avgTemp, 25.83, 0.01);
    assert.equal(m.minTemp, 24);
    assert.equal(m.maxTemp, 28);
  });

  test('temperature has no outlier filter: extremes stay in the statistics', () => {
    // 10 readings of 25 °C plus one 80 °C reading: the former 3σ filter
    // would have cut the 80 (its deviation 50 exceeds 3σ ≈ 47.4); the raw
    // statistics must keep it — ambient readings are never filtered.
    const track = prepared(eastTrack({
      count: 11,
      temp: (i) => (i === 10 ? 80 : 25),
    }));
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    assert.closeTo(m.avgTemp, 330 / 11, 1e-9);
    assert.equal(m.minTemp, 25);
    assert.equal(m.maxTemp, 80);
  });

  test('fitness spikes are diluted by the 5-point window, not removed', () => {
    // 21 readings of 150 bpm plus one 300 bpm glitch at the tail, 1 s apart:
    // the window spreads the glitch over its ±2-point neighborhood, so the
    // maximum comes from the diluted bump (200), never from the raw glitch
    // (300), and the average rises only slightly above 150.
    const track = prepared(eastTrack({
      count: 22,
      time: (i) => i * 1000,
      hr: (i) => (i === 21 ? 300 : 150),
      cad: (i) => (i === 21 ? 500 : 90),
    }));
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    // Windows at the tail: (4·base+glitch)/5, (3·base+glitch)/4, (2·base+glitch)/3.
    assert.closeTo(m.avgHr, (19 * 150 + 180 + 187.5 + 200) / 22, 0.01);
    assert.equal(m.maxHr, 200);
    assert.closeTo(m.avgCad, (19 * 90 + 172 + 192.5 + 680 / 3) / 22, 0.01);
    assert.closeTo(m.maxCad, 680 / 3, 0.01);
  });

  test('pause readings are dropped from hr/cad/power, but temperature ignores pauses', () => {
    // 10 moving segments (~10 m at 10 m/s) around a 30 s stop kept as three
    // co-located points. The stopped readings (hr 160, cad 95, power 220)
    // all sit within 3σ of their series — only the pause filter can remove
    // them. Temperature is ambient, not effort, so its pause reading stays.
    const step = 0.00009;
    const moving = { hr: 150, cad: 90, power: 200, temp: 25 };
    const stopped = { hr: 160, cad: 95, power: 220, temp: 40 };
    const pts = [];
    for (let i = 0; i <= 5; i++) {
      pts.push({ lat: 0, lon: i * step, ele: null, time: i * 10000, ...moving });
    }
    for (let j = 1; j <= 3; j++) {
      pts.push({ lat: 0, lon: 5 * step, ele: null, time: 50000 + j * 10000, ...stopped });
    }
    for (let i = 6; i <= 10; i++) {
      pts.push({ lat: 0, lon: i * step, ele: null, time: 80000 + (i - 5) * 10000, ...moving });
    }
    const track = prepared(pts);
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    assert.equal(m.avgHr, 150);
    assert.equal(m.maxHr, 150);
    assert.equal(m.avgCad, 90);
    assert.equal(m.maxCad, 90);
    assert.equal(m.avgPower, 200);
    assert.equal(m.maxPower, 200);
    assert.closeTo(m.avgTemp, 28.21, 0.01); // (11 × 25 + 3 × 40) / 14
    assert.equal(m.maxTemp, 40);
  });
});

suite('metrics / time', () => {
  /**
   * 11 points: 4 moving segments, a 12 s pause (duplicate position), then
   * 5 more moving segments. Segments ≈ 9.995 m at 10 m/s.
   */
  function pauseTrack() {
    const step = 0.00009;
    const pts = [];
    for (let i = 0; i <= 4; i++) {
      pts.push({ lat: 0, lon: i * step, ele: null, time: i * 1000 });
    }
    pts.push({ ...pts[4], time: 16000 }); // the pause: no movement, 12 s
    for (let i = 5; i <= 9; i++) {
      pts.push({ lat: 0, lon: i * step, ele: null, time: 12000 + i * 1000 });
    }
    return prepared(pts);
  }

  test('elapsed excludes nothing; moving time excludes the pause', () => {
    const track = pauseTrack();
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    assert.closeTo(m.elapsed, 21, 1e-6);
    assert.closeTo(m.moving, 9, 1e-6);
    // Average speed is the mean of per-segment moving speeds — the paused
    // segment never enters the set, so the average is the segment speed.
    assert.closeTo(m.avgSpeed, 10.008, 0.01);
    // Average pace is the per-km inverse of that same filtered average.
    assert.closeTo(m.avgPace, 1000 / m.avgSpeed, 0.01);
    assert.truthy(m.moving < m.elapsed, 'pause must be excluded from moving time');
  });

  test('max speed ignores the paused segment', () => {
    const track = pauseTrack();
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    assert.closeTo(m.maxSpeed, 10.008, 0.01);
  });

  test('GPS spikes beyond 3σ: excluded from the average, interpolated from the computed series', () => {
    // 20 segments at ~5.56 m/s plus one 10×-longer segment (~55.6 m/s). No
    // recorded speeds → the series is computed → the 3σ rule applies to BOTH
    // statistics: the average drops the spike and the maximum comes from the
    // interpolated per-point series the profile draws (5.56).
    const step = 0.00005; // ≈ 5.557 m
    const pts = [];
    for (let i = 0; i <= 21; i++) {
      const lon = i <= 20 ? i * step : 20 * step + 10 * step;
      pts.push({ lat: 0, lon, ele: null, time: i * 1000 });
    }
    const track = prepared(pts);
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    assert.closeTo(m.avgSpeed, 5.56, 0.01);
    const caches = buildCaches(track, 'distance');
    let profileMax = 0;
    for (const v of caches.speeds) if (Number.isFinite(v) && v > profileMax) profileMax = v;
    assert.closeTo(m.maxSpeed, profileMax, 1e-9);
    assert.closeTo(m.maxSpeed, 5.56, 0.01);
  });

  test('recorded speeds: the window dilutes the spike into its neighborhood', () => {
    // The same jump track, but the points carry recorded speeds — the
    // global source predicate switches the average to dilution-only: the
    // spike segment is smeared across its ±2-point neighborhood, so the
    // average counts the diluted remnants instead of dropping them.
    const step = 0.00005; // ≈ 5.557 m
    const pts = [];
    for (let i = 0; i <= 21; i++) {
      const lon = i <= 20 ? i * step : 20 * step + 10 * step;
      pts.push({ lat: 0, lon, ele: null, time: i * 1000, speed: i <= 20 ? 5.557 : 55.57 });
    }
    const track = prepared(pts);
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    // Segments ending at t=1..18 s smooth to the base speed; the tail
    // windows average the spike with 4, 3 and 2 base neighbors.
    const b = track.cumDist[1] - track.cumDist[0];
    const s = track.totalDistance - track.cumDist[20];
    const expected = (18 * b + (4 * b + s) / 5 + (3 * b + s) / 4 + (2 * b + s) / 3) / 21;
    assert.closeTo(m.avgSpeed, expected, 1e-9);
    assert.truthy(m.avgSpeed > 5.6, 'above the pure-3σ result: the diluted remnant still counts');
    assert.closeTo(m.avgPace, 1000 / m.avgSpeed, 1e-6);
  });

  test('sparse recorded sampling: the cross-check drops the drift spikes', () => {
    // The yangtaishan shape: ~4 s between fixes, a pause with zeros, then
    // two drift samples — the device records 11/7 m/s while the positions
    // barely moved. The dd/dt cross-check distrusts both readings and the
    // window fills the hole from the trusted base-speed neighbors.
    const segM = [];
    for (let i = 0; i < 100; i++) segM.push(i % 25 === 0 ? 0.2 : 6.667);
    segM[50] = 0.2;
    segM[51] = 2;    // drift: device says 11.11 m/s, positions moved 2 m
    segM[52] = 1.5;  // drift: device says 6.94 m/s, positions moved 1.5 m
    const pts = [{ lat: 0, lon: 0, ele: null, time: 0, speed: 0 }];
    let lon = 0;
    for (let i = 0; i < 100; i++) {
      lon += segM[i] / 111195;
      const rec = i + 1 === 51 ? 11.1111 : i + 1 === 52 ? 6.9444 : (i + 1) % 25 === 0 ? 0 : 1.6667;
      pts.push({ lat: 0, lon, ele: null, time: (i + 1) * 4000, speed: rec });
    }
    const track = prepared(pts);
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    assert.closeTo(m.maxSpeed, 1.6667, 0.01, 'both drift readings are gone entirely');
    // The average dips a hair below the base speed: the slow drift segments
    // (dd/dt 0.5 / 0.375 m/s) stay in the set — dilution-only keeps them.
    assert.closeTo(m.avgSpeed, 1.6411, 0.01);
  });

  test('two-pace sectors keep both clusters — 3σ trims spikes, not real speeds', () => {
    const track = twoSpeedTrack();
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    // Clusters at ~5 and ~10 m/s: every point is within 3σ of the mean.
    assert.closeTo(m.avgSpeed, 7.493, 0.02);
    assert.closeTo(m.maxSpeed, 10.008, 0.01);
    assert.closeTo(m.avgPace, 1000 / m.avgSpeed, 1e-6);
  });

  test('no moving segments → avg/pace null; maxSpeed still mirrors the profile curve', () => {
    // Two crawl segments at ~0.12 m/s: the first confirms a pause, the second
    // sits inside it — no per-segment moving speed survives, so the average
    // metrics are null. The maximum speed deliberately reads the profile's
    // per-point series instead, which still carries values (~0.12 m/s).
    const track = prepared(eastTrack({ count: 3, time: (i) => i * 900000 }));
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    assert.isNull(m.avgSpeed);
    assert.isNull(m.avgPace);
    assert.isNull(m.moving);
    assert.truthy(m.elapsed > 0);
    const caches = buildCaches(track, 'distance');
    let profileMax = 0;
    for (const v of caches.speeds) if (Number.isFinite(v) && v > profileMax) profileMax = v;
    assert.closeTo(m.maxSpeed, profileMax, 1e-9);
  });

  test('maxSpeed equals the profile speed-curve maximum (recorded spike cross-checked away)', () => {
    // A fast/slow track with an absurd recorded spike at one point: the
    // device says 500 m/s where the positions moved ~5 m per fix — the
    // dd/dt cross-check drops the reading and the window fills the hole,
    // so both the list and the curve end at the real fast-half speed.
    const track = twoSpeedTrack();
    track.points[57].speed = 500; // sensor glitch in the recorded series
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    const caches = buildCaches(track, 'distance');
    let profileMax = 0;
    for (const v of caches.speeds) if (Number.isFinite(v) && v > profileMax) profileMax = v;
    assert.closeTo(m.maxSpeed, profileMax, 1e-9);
    assert.closeTo(m.maxSpeed, 10.008, 0.01, 'only the real fast-half speed may remain');
    assert.truthy(m.maxSpeed < 500, 'the spike must not survive');
  });

  test('pause speed boundary: ≥ 0.5 km/h counts, sub-threshold stretches do not', () => {
    // 0.5 km/h = 0.1389 m/s → 111.195 m segments straddling the threshold.
    // seg1: 900 s → 0.445 km/h (a confirmed pause); seg2/seg3: 600 s → 0.667 km/h.
    const pts = eastTrack({
      count: 4,
      time: (i) => (i === 0 ? 0 : i === 1 ? 900000 : i === 2 ? 1500000 : 2100000),
    });
    const track = prepared(pts);
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    // ...so moving time = segment 2 + segment 3 = 600 + 600 = 1200 s.
    assert.closeTo(m.moving, 1200, 0.01);
    assert.truthy(m.moving < m.elapsed, 'sustained sub-threshold stretch must be excluded');
  });

  test('brief sub-threshold dips are movement, not pauses', () => {
    // 10 s moving, a 5 s crawl at 0.36 km/h (< 0.5), 10 s moving again.
    // The crawl is shorter than a pause, so all 25 s count as moving.
    const step = 0.00009;       // ≈ 9.995 m
    const crawl = 0.5 / 111195; // ≈ 0.5 m
    const pts = [
      { lat: 0, lon: 0, ele: null, time: 0 },
      { lat: 0, lon: step, ele: null, time: 10000 },
      { lat: 0, lon: step + crawl, ele: null, time: 15000 },
      { lat: 0, lon: 2 * step + crawl, ele: null, time: 25000 },
    ];
    const track = prepared(pts);
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    assert.closeTo(m.elapsed, 25, 1e-6);
    assert.closeTo(m.moving, 25, 1e-6);
  });

  test('a stop becomes a pause at exactly 10 s', () => {
    const step = 0.00009;
    const crawl = 0.5 / 111195;
    const build = (stopMs) => prepared([
      { lat: 0, lon: 0, ele: null, time: 0 },
      { lat: 0, lon: step, ele: null, time: 10000 },
      { lat: 0, lon: step + crawl, ele: null, time: 10000 + stopMs },
      { lat: 0, lon: 2 * step + crawl, ele: null, time: 20000 + stopMs },
    ]);
    const tenS = build(10000);
    const m10 = computeSectorMetrics(tenS, 0, tenS.totalDistance);
    assert.closeTo(m10.moving, 20, 1e-3);  // the 10 s stop itself is a pause

    const short = build(9900);
    const m9 = computeSectorMetrics(short, 0, short.totalDistance);
    assert.closeTo(m9.moving, 29.9, 1e-3); // 9.9 s is still movement
  });

  test('VAM and VDM: vertical rates over climbing/descending time only', () => {
    // Climb 100 m over the first half (all 50 segments trend upward),
    // descend 50 m over the second (−1 m/segment: the 3 m filter credits
    // only 12 full events = 48 m), 1 h total, 0.5 h climbing + 0.5 h descending.
    const pts = eastTrack({
      count: 101,
      ele: (i) => (i <= 50 ? i * 2 : 100 - (i - 50)),
      time: (i) => i * 36000, // 36 s per segment → 3600 s total
    });
    const track = prepared(pts);
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    assert.closeTo(m.vam, 200, 1);   // 100 m gained in 0.5 h of climbing
    assert.closeTo(m.vdm, 96, 1);    // 48 m lost in 0.5 h of descending
  });

  test('flat stretch inside a sector does not dilute VAM', () => {
    // 4 climb segments, 10 flat segments, 4 climb segments, 2 flat ones;
    // 16 m of gain over 480 s of climbing in a 1200 s sector.
    const pts = eastTrack({
      count: 21,
      ele: (i) => (i <= 4 ? i * 2 : i <= 14 ? 8 : i <= 18 ? 8 + (i - 14) * 2 : 16),
      time: (i) => i * 60000,
    });
    const track = prepared(pts);
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    assert.equal(m.gain, 16);
    assert.closeTo(m.elapsed, 1200, 1e-6);
    assert.closeTo(m.vam, 120, 1); // 16 m / (480 s / 3600) — elapsed basis would give 48
  });

  test('VAM excludes pause seconds spent inside a climb', () => {
    // 5 climb segments (+2 m, 10 s each), a 12 s stop at the same position,
    // 5 more climb segments: 20 m of gain over 100 s of moving climb →
    // VAM = 720 m/h; counting the stop would pull it to ~643.
    const step = 0.00009;
    const pts = [];
    for (let i = 0; i <= 5; i++) pts.push({ lat: 0, lon: i * step, ele: i * 2, time: i * 10000 });
    pts.push({ lat: 0, lon: 5 * step, ele: 10, time: 62000 }); // the pause
    for (let i = 6; i <= 10; i++) {
      pts.push({ lat: 0, lon: i * step, ele: i * 2, time: 62000 + (i - 5) * 10000 });
    }
    const track = prepared(pts);
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    assert.equal(m.gain, 20);
    assert.closeTo(m.moving, 100, 1e-6);
    assert.closeTo(m.vam, 720, 1);
    assert.isNull(m.vdm);
  });

  test('VDM excludes pause seconds spent inside a descent', () => {
    // Mirror of the VAM track: 20 m of loss over 100 s of moving descent.
    const step = 0.00009;
    const pts = [];
    for (let i = 0; i <= 5; i++) pts.push({ lat: 0, lon: i * step, ele: 20 - i * 2, time: i * 10000 });
    pts.push({ lat: 0, lon: 5 * step, ele: 10, time: 62000 }); // the pause
    for (let i = 6; i <= 10; i++) {
      pts.push({ lat: 0, lon: i * step, ele: 20 - i * 2, time: 62000 + (i - 5) * 10000 });
    }
    const track = prepared(pts);
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    assert.equal(m.loss, 20);
    assert.closeTo(m.vdm, 720, 1);
    assert.isNull(m.vam);
  });

  test('flat sectors have neither VAM nor VDM; missing time yields nulls', () => {
    const flat = prepared(eastTrack({ count: 51, ele: () => 500, time: (i) => i * 1000 }));
    const m = computeSectorMetrics(flat, 0, flat.totalDistance);
    assert.isNull(m.vam);
    assert.isNull(m.vdm);

    const noTime = prepared(eastTrack({ count: 10, ele: (i) => i }));
    const m2 = computeSectorMetrics(noTime, 0, noTime.totalDistance);
    assert.isNull(m2.vam);
    assert.isNull(m2.vdm);
  });

  test('missing timestamps → time metrics are null, not zero', () => {
    const track = prepared(eastTrack({ count: 10, ele: (i) => i }));
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    assert.isNull(m.elapsed);
    assert.isNull(m.moving);
    assert.isNull(m.avgSpeed);
    assert.isNull(m.avgPace);
    assert.isNull(m.fastestKm);
    assert.isNull(m.slowestKm);
    assert.isNull(m.vam);
  });

  test('missing elevation → elevation metrics are null, not zero (time still works)', () => {
    const track = prepared(eastTrack({ count: 10, time: (i) => i * 1000 }));
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    assert.isNull(m.gain);
    assert.isNull(m.loss);
    assert.isNull(m.distance3D);
    assert.isNull(m.effortDistance);
    assert.isNull(m.avgGrade);
    assert.isNull(m.eleStart);
    assert.truthy(m.horizontalDistance > 0);
    assert.closeTo(m.elapsed, 9, 1e-6);
  });
});

suite('metrics / GAP (grade-adjusted pace)', () => {
  test('Minetti factor is 1 on flat, grows uphill, clamped to ±45 %', () => {
    assert.equal(minettiFactor(0), 1);
    assert.closeTo(minettiFactor(0.05), 1.3014, 1e-3);
    assert.closeTo(minettiFactor(-0.05), 0.7628, 1e-3);
    assert.equal(minettiFactor(0.9), minettiFactor(0.45)); // clamp
    assert.equal(minettiFactor(-0.9), minettiFactor(-0.45));
  });

  test('constant 6 % grade: avgGap = pace ÷ Minetti factor', () => {
    // 50 segments of 111.195 m climbing 6 %, 60 s each → pace ≈ 539.8 s/km.
    const track = prepared(eastTrack({
      count: 51,
      ele: (i) => i * (111.195 * 0.06),
      time: (i) => i * 60000,
    }));
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    const pace = (m.moving / (track.totalDistance / 1000));
    assert.closeTo(m.avgGap, pace / minettiFactor(0.06), 1);
    // Uphill effort is higher than flat: the adjusted pace is faster (smaller).
    assert.truthy(m.avgGap < pace);
  });

  test('recorded speeds switch the GAP average to the window rule (constant pace unaffected)', () => {
    // One recorded speed anywhere flips the global predicate, so the GAP
    // segments are window-smoothed. At 60 s per segment every window holds
    // only its own reading — the constant pace is unaffected.
    const track = prepared(eastTrack({
      count: 51,
      ele: (i) => i * (111.195 * 0.06),
      time: (i) => i * 60000,
    }));
    track.points[10].speed = 1.85;
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    const pace = (m.moving / (track.totalDistance / 1000));
    assert.closeTo(m.avgGap, pace / minettiFactor(0.06), 1);
  });

  test('tracks without elevation have no GAP', () => {
    const track = prepared(eastTrack({ count: 10, time: (i) => i * 1000 }));
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    assert.isNull(m.avgGap);
  });
});

suite('metrics / pace windows', () => {  test('fastest/slowest sliding 1 km windows find both halves', () => {
    const track = twoSpeedTrack();
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    assert.truthy(m.fastestKm, 'expected a 1 km window');
    assert.truthy(m.slowestKm, 'expected a 1 km window');
    assert.closeTo(m.fastestKm.pace, 100, 2);   // 1000 m at 10 m/s
    assert.closeTo(m.slowestKm.pace, 200, 2);   // 1000 m at 5 m/s
  });

  test('sectors shorter than 1 km have no pace windows', () => {
    const track = twoSpeedTrack();
    const m = computeSectorMetrics(track, 0, 900);
    assert.isNull(m.fastestKm);
    assert.isNull(m.slowestKm);
  });

  test('a pause inside a window neither wins nor loses the ranking', () => {
    // 2 km at 10 m/s with a 30 s stop after 600 m: every 1 km window holds
    // ~100 s of movement, so fastest and slowest must agree once the pause
    // is excluded (raw elapsed would crown the pause windows slowest at ~130).
    const step = 0.00009; // ≈ 10 m per segment, 1 s each
    const pts = [];
    for (let i = 0; i <= 60; i++) pts.push({ lat: 0, lon: i * step, ele: null, time: i * 1000 });
    pts.push({ lat: 0, lon: 60 * step, ele: null, time: 90000 }); // the pause
    for (let i = 61; i <= 200; i++) {
      pts.push({ lat: 0, lon: i * step, ele: null, time: 90000 + (i - 60) * 1000 });
    }
    const track = prepared(pts);
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    assert.truthy(m.fastestKm && m.slowestKm, 'expected 1 km windows');
    assert.closeTo(m.fastestKm.pace, 100, 2);
    assert.closeTo(m.slowestKm.pace, 100, 2);
  });
});

suite('metrics / segment type', () => {
  // The segment-list capsule: gains/losses in meters as computeSectorMetrics
  // reports them (loss positive), net = end − start elevation.

  test('no elevation data → null', () => {
    assert.isNull(segmentType(null, null, null));
  });

  test('relief under 5 m is flat, even one-sided', () => {
    assert.equal(segmentType(2, 1, 1), 'flat');
    assert.equal(segmentType(4, 0, 4), 'flat'); // pure rise, still noise-scale
  });

  test('outright dominance: ≥ 65% share with the net agreeing', () => {
    assert.equal(segmentType(65, 35, 30), 'climb');   // exactly at the share
    assert.equal(segmentType(100, 0, 100), 'climb');
    assert.equal(segmentType(35, 65, -30), 'descent');
  });

  test('weak dominance follows the 1.4× fallbacks, net on the same side', () => {
    assert.equal(segmentType(60, 40, 20), 'climb');   // 60 > 56, below 65%
    assert.equal(segmentType(40, 60, -20), 'descent');
    assert.equal(segmentType(55, 45, 10), 'mixed');   // 55 ≤ 63: too balanced
  });

  test('balanced rolling terrain is mixed', () => {
    assert.equal(segmentType(50, 50, 0), 'mixed');
    assert.equal(segmentType(48, 52, -4), 'mixed');
  });
});
