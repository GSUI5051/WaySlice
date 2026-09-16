/** Unit-system conversion and presentation tests. */
import { suite, test, assert } from './runner.js';
import { setLanguage, getCurrentLanguage } from '../js/language/language.js';
import '../js/language/langs.js';
import {
  getUnitSystem, initUnits, setUnitSystem,
  metersToFeet, metersToMiles, mpsToKmh, mpsToMph,
  secPerKmToSecPerMi,
  distanceUnit, shortDistanceUnit, elevationUnit, speedUnit, paceUnit, vamUnit,
  bpmUnit, rpmUnit, powerUnit, percentUnit, tempUnit,
} from '../js/units/units.js';
import {
  formatDistance, formatDistanceShort, formatElevation,
  formatSignedElevation, formatSpeed, formatPace, formatGrade, formatVam,
  formatBpm, formatSectorRangeBounds,
} from '../js/utils/format.js';

suite('units / conversion constants', () => {
  test('1000 m converts to 0.621371 mi', () => {
    assert.closeTo(metersToMiles(1000), 0.621371192, 1e-9);
  });
  test('100 m converts to 328.084 ft', () => {
    assert.closeTo(metersToFeet(100), 328.0839895, 1e-6);
  });
  test('10 m/s converts to 36 km/h and 22.3694 mph', () => {
    assert.closeTo(mpsToKmh(10), 36, 1e-12);
    assert.closeTo(mpsToMph(10), 22.3693629, 1e-6);
  });
  test('pace converts from seconds/km to seconds/mi', () => {
    assert.closeTo(secPerKmToSecPerMi(420), 675.92448, 1e-6);
  });
});

suite('units / formatter display', () => {
  test('Metric formats distance, elevation, speed, pace and VAM', () => {
    setUnitSystem('metric');
    assert.equal(formatDistance(1000), '1 km');
    assert.equal(formatDistanceShort(850), '850 m');
    assert.equal(formatElevation(100), '100 m');
    assert.equal(formatSignedElevation(100), '+100 m');
    assert.equal(formatSpeed(10), '36 km/h');
    assert.equal(formatPace(420), '7:00 /km');
    assert.equal(formatVam(600), '600 m/h');
  });

  test('Imperial formats distance, elevation, speed, pace and VAM', () => {
    setUnitSystem('imperial');
    assert.equal(formatDistance(1000), '3,281 ft', 'imperial switches to mi only at one mile');
    assert.equal(formatDistance(1609.344), '1 mi', 'exactly one mile reads in miles');
    assert.equal(formatDistanceShort(1000), '3,281 ft');
    assert.equal(formatDistanceShort(850), '2,789 ft');
    assert.equal(formatElevation(100), '328 ft');
    assert.equal(formatSignedElevation(-100), '−328 ft');
    assert.equal(formatSpeed(10), '22.4 mph');
    assert.equal(formatPace(420), '11:16 /mi');
    assert.equal(formatVam(600), '1,969 ft/h');
  });

  test('gradient stays identical in both unit systems', () => {
    setUnitSystem('metric');
    const metric = formatGrade(0.053);
    setUnitSystem('imperial');
    assert.equal(formatGrade(0.053), metric);
  });

  test('pace rounding never emits seconds >= 60', () => {
    setUnitSystem('metric');
    assert.equal(formatPace(59.6), '1:00 /km');
    setUnitSystem('imperial');
    assert.equal(formatPace(59.6), '1:36 /mi');
  });
});

/** Runs fn with a language set, restoring the previous one even on failure —
 * a throwing assert must never leak the language into later suites.
 * setLanguage loads the pack on demand, so it is awaited. */
async function withLanguage(code, fn) {
  const saved = getCurrentLanguage();
  await setLanguage(code);
  try {
    await fn();
  } finally {
    await setLanguage(saved);
  }
}

suite('units / localized labels', () => {
  test('en/fr/ja/ko keep the international unit symbols', async () => {
    for (const code of ['en', 'fr', 'ja', 'ko']) {
      await withLanguage(code, () => {
        setUnitSystem('metric');
        assert.equal(distanceUnit(), 'km', `${code} metric distance`);
        assert.equal(shortDistanceUnit(), 'm', `${code} metric short distance`);
        assert.equal(elevationUnit(), 'm', `${code} metric elevation`);
        assert.equal(speedUnit(), 'km/h', `${code} metric speed`);
        assert.equal(paceUnit(), '/km', `${code} metric pace`);
        assert.equal(vamUnit(), 'm/h', `${code} metric VAM`);
        setUnitSystem('imperial');
        assert.equal(distanceUnit(), 'mi', `${code} imperial distance`);
        assert.equal(shortDistanceUnit(), 'ft', `${code} imperial short distance`);
        assert.equal(elevationUnit(), 'ft', `${code} imperial elevation`);
        assert.equal(speedUnit(), 'mph', `${code} imperial speed`);
        assert.equal(paceUnit(), '/mi', `${code} imperial pace`);
        assert.equal(vamUnit(), 'ft/h', `${code} imperial VAM`);
        setUnitSystem('metric');
      });
    }
  });

  test('sensor labels: symbolic % and temperature, sensors never convert', async () => {
    await withLanguage('en', () => {
      setUnitSystem('metric');
      assert.equal(bpmUnit(), 'bpm');
      assert.equal(rpmUnit(), 'rpm');
      assert.equal(powerUnit(), 'W');
      assert.equal(percentUnit(), '%');
      assert.equal(tempUnit(), '°C');
      setUnitSystem('imperial');
      assert.equal(bpmUnit(), 'bpm', 'bpm never converts');
      assert.equal(rpmUnit(), 'rpm', 'rpm never converts');
      assert.equal(powerUnit(), 'W', 'watts never convert');
      assert.equal(percentUnit(), '%', 'percent never converts');
      assert.equal(tempUnit(), '°F');
    });
  });

  test('locale × unit system compose independently (fr localizes numbers, not symbols)', async () => {
    await withLanguage('fr', () => {
      setUnitSystem('metric');
      assert.equal(formatDistance(4880), '4,88 km');
      assert.equal(formatSpeed(5), '18 km/h');
      assert.equal(formatPace(420), '7:00 /km');
      setUnitSystem('imperial');
      assert.equal(formatDistance(4880), '3,03 mi');
      assert.equal(formatSpeed(5), '11,2 mph');
      assert.equal(formatPace(420), '11:16 /mi');
      setUnitSystem('metric');
    });
  });
});

suite('units / sector range bounds', () => {
  test('metric: segment under 1 km reads both ends in whole meters', () => {
    setUnitSystem('metric');
    assert.deepEqual(formatSectorRangeBounds(0, 445), ['0 m', '445 m']);
    assert.deepEqual(formatSectorRangeBounds(200, 1000), ['200 m', '1,000 m'], 'length 800 m still meters');
    assert.deepEqual(formatSectorRangeBounds(850, 1849.4), ['850 m', '1,849 m'], 'length 999.4 m stays meters');
  });

  test('metric: segment of 1 km or more reads both ends in km', () => {
    setUnitSystem('metric');
    assert.deepEqual(formatSectorRangeBounds(850, 1850), ['0.85 km', '1.85 km'], 'length exactly 1000 m switches');
    assert.deepEqual(formatSectorRangeBounds(4890, 9780), ['4.89 km', '9.78 km']);
    assert.deepEqual(formatSectorRangeBounds(0, 9780), ['0 km', '9.78 km'], 'whole track reads one unit');
  });

  test('imperial: segment under one mile reads both ends in whole feet', () => {
    setUnitSystem('imperial');
    assert.deepEqual(formatSectorRangeBounds(0, 445), ['0 ft', '1,460 ft']);
    assert.deepEqual(formatSectorRangeBounds(200, 1000), ['656 ft', '3,281 ft'], 'length 800 m still feet');
    assert.deepEqual(formatSectorRangeBounds(0, 1600), ['0 ft', '5,249 ft'], 'length 1600 m = 5249 ft stays feet');
    setUnitSystem('metric');
  });

  test('imperial: segment of one mile or more reads both ends in miles', () => {
    setUnitSystem('imperial');
    assert.deepEqual(formatSectorRangeBounds(0, 1700), ['0 mi', '1.06 mi'], 'length 1700 m crosses the mile');
    assert.deepEqual(formatSectorRangeBounds(4890, 9780), ['3.04 mi', '6.08 mi']);
    setUnitSystem('metric');
  });

  test('non-finite bounds render the em dash', () => {
    setUnitSystem('metric');
    assert.deepEqual(formatSectorRangeBounds(NaN, 100), ['—', '—']);
  });
});

suite('units / preference', () => {
  test('defaults to Metric and persists choices', () => {
    localStorage.removeItem('wayslice-units');
    initUnits();
    assert.equal(getUnitSystem(), 'metric');
    setUnitSystem('imperial');
    assert.equal(getUnitSystem(), 'imperial');
    assert.equal(localStorage.getItem('wayslice-units'), 'imperial');
    setUnitSystem('metric');
  });

  test('invalid saved values safely fall back to Metric', () => {
    localStorage.setItem('wayslice-units', 'league');
    initUnits();
    assert.equal(getUnitSystem(), 'metric');
  });
});
