/**
 * FIT + TCX parser tests. The FIT samples are binary, so the committed
 * fixtures under tests/fixtures/ (deterministic: 60 one-second records,
 * 3 laps, hr+cadence on every record, one altitude gap, one position-less
 * record) are fetched over HTTP (skip gracefully when served from file://);
 * the TCX sensor fixture is an inline document. Sensor data (hr/cad/power),
 * lap windows and elevation-gap interpolation are the interesting parts of
 * both pipelines.
 */
import { suite, test, assert } from './runner.js';
import { parseFIT } from '../js/parsers/fit.js';
import { parseTCX } from '../js/parsers/tcx.js';
import { detectFormat, parseTrackFile } from '../js/parsers/index.js';
import { ParseError, PARSE_ERROR_KEYS } from '../js/parsers/parseError.js';
import { prepareTrack } from '../js/geo/track.js';
import { runParseJob } from '../js/workers/parseJob.js';
import { detectCadenceConvention } from '../js/parsers/cadenceConvention.js';
import { computeSectorMetrics } from '../js/metrics/sectorMetrics.js';

const FIT_FIXTURE_URL = './fixtures/telemetry-mini.fit';
const TCX_FIXTURE_URL = './fixtures/telemetry-mini.tcx';

/** Fetches a fixture as an ArrayBuffer, or returns null when unreachable (file://). */
async function fetchSample(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

const TCX_SENSOR = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
    xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
  <Activities><Activity Sport="Running"><Id>2026-08-15T07:00:00Z</Id>
    <Lap StartTime="2026-08-15T07:00:00Z"><TotalTimeSeconds>120</TotalTimeSeconds><DistanceMeters>300</DistanceMeters>
      <Track>
        <Trackpoint><Time>2026-08-15T07:00:00Z</Time>
          <Position><LatitudeDegrees>47.2</LatitudeDegrees><LongitudeDegrees>11.3</LongitudeDegrees></Position>
          <AltitudeMeters>900</AltitudeMeters><DistanceMeters>0</DistanceMeters>
          <HeartRateBpm><Value>140</Value></HeartRateBpm>
        </Trackpoint>
        <Trackpoint><Time>2026-08-15T07:01:00Z</Time>
          <Position><LatitudeDegrees>47.21</LatitudeDegrees><LongitudeDegrees>11.31</LongitudeDegrees></Position>
          <AltitudeMeters>950</AltitudeMeters><DistanceMeters>150</DistanceMeters>
          <HeartRateBpm><Value>150</Value></HeartRateBpm>
          <Extensions><ns3:TPX><ns3:Watts>250</ns3:Watts><ns3:RunCadence>85</ns3:RunCadence></ns3:TPX></Extensions>
        </Trackpoint>
        <Trackpoint><Time>2026-08-15T07:02:00Z</Time>
          <Position><LatitudeDegrees>47.22</LatitudeDegrees><LongitudeDegrees>11.32</LongitudeDegrees></Position>
        </Trackpoint>
      </Track>
    </Lap>
  </Activity></Activities>
</TrainingCenterDatabase>`;

suite('parsers / tcx', () => {
  test('trackpoints map onto the shared TrackPoint shape', async () => {
    const buffer = new TextEncoder().encode(TCX_SENSOR).buffer;
    const { points, waypoints } = await parseTCX(buffer);
    assert.equal(points.length, 3);
    assert.equal(waypoints.length, 0);
    assert.closeTo(points[0].lat, 47.2, 1e-9);
    assert.closeTo(points[2].lon, 11.32, 1e-9);
    assert.equal(points[0].time, Date.parse('2026-08-15T07:00:00Z'));
    assert.equal(points[0].ele, 900);
  });

  test('per-point hr, watts and run cadence survive the unified model', async () => {
    const buffer = new TextEncoder().encode(TCX_SENSOR).buffer;
    const { points } = await parseTCX(buffer);
    assert.equal(points[0].hr, 140);
    assert.equal(points[1].hr, 150);
    assert.equal(points[1].power, 250);
    assert.equal(points[1].cad, 85);
    assert.equal(points[0].power, null);
  });

  test('points without altitude get bridged by interpolation, time is never invented', async () => {
    const buffer = new TextEncoder().encode(TCX_SENSOR).buffer;
    const { points } = await parseTCX(buffer);
    assert.equal(points[2].ele, 950); // gap at the end extends the last known value
    const track = prepareTrack(points, 't');
    assert.equal(track.hasElevation, true);
    assert.equal(track.hasTime, true);
    assert.equal(track.hasHr, true);
    assert.equal(track.hasCad, true);
  });

  test('detection: extension and <TrainingCenterDatabase> sniffing', () => {
    const buffer = new TextEncoder().encode(TCX_SENSOR).buffer;
    assert.equal(detectFormat('a.tcx', buffer), 'tcx');
    assert.equal(detectFormat('a.xml', buffer), 'tcx'); // mislabeled, sniffed
  });

  test('non-XML garbage raises errorInvalidFile, activity-less docs errorNoTrackPoints', async () => {
    const garbage = new TextEncoder().encode('definitely not tcx').buffer;
    const err = await assert.throwsAsync(() => parseTCX(garbage));
    assert.truthy(err instanceof ParseError);
    assert.equal(err.key, PARSE_ERROR_KEYS.invalid);

    const empty = new TextEncoder().encode(
      '<TrainingCenterDatabase><Activities/></TrainingCenterDatabase>'
    ).buffer;
    const err2 = await assert.throwsAsync(() => parseTCX(empty));
    assert.equal(err2.key, PARSE_ERROR_KEYS.noTrack);
  });

  test('committed fixture: 60 points across a 3-lap document keep position, hr and cadence', async () => {
    const buffer = await fetchSample(TCX_FIXTURE_URL);
    if (!buffer) return; // not served over HTTP — skip
    const { points } = await parseTCX(buffer);
    assert.equal(points.length, 60);
    const withHr = points.filter((p) => p.hr != null).length;
    assert.equal(withHr, 60);
    assert.closeTo(points[0].lat, 22.6, 1e-6);
    assert.equal(points[0].time, Date.parse('2026-01-15T08:00:00Z'));
  });
});

suite('parsers / fit', () => {
  test('detection: extension and ".FIT" magic at header bytes 8..12', async () => {
    const buffer = await fetchSample(FIT_FIXTURE_URL);
    if (!buffer) return;
    assert.equal(detectFormat('a.fit', buffer), 'fit');
    assert.equal(detectFormat('a.bin', buffer), 'fit'); // mislabeled, magic-sniffed
    assert.equal(detectFormat('a.gpx', buffer), 'gpx'); // extension still wins
  });

  test('committed fixture: 3-lap document, sensors and session-start drop', async () => {
    const buffer = await fetchSample(FIT_FIXTURE_URL);
    if (!buffer) return;
    const { points, waypoints } = await parseFIT(buffer);
    assert.equal(waypoints.length, 0);
    // Record 0 carries no position and drops out, like real session starts —
    // 60 written records minus that one.
    assert.equal(points.length, 59);
    const withHr = points.filter((p) => p.hr != null).length;
    const withCad = points.filter((p) => p.cad != null).length;
    assert.equal(withHr, 59);
    assert.equal(withCad, 59);
    assert.closeTo(points[0].lat, 22.60005, 1e-6);
    assert.equal(points[0].time, Date.parse('2026-01-15T08:00:01Z'));
  });

  test('committed fixture: the altitude-less reading is bridged, track stays usable', async () => {
    const buffer = await fetchSample(FIT_FIXTURE_URL);
    if (!buffer) return;
    const { points } = await parseFIT(buffer);
    const missingEle = points.filter((p) => p.ele == null).length;
    assert.equal(missingEle, 0); // record 25 arrives without altitude and is bridged
    const track = prepareTrack(points, 'f');
    assert.equal(track.hasElevation, true);
    assert.equal(track.hasTime, true);
    assert.equal(track.hasHr, true);
    assert.equal(track.hasCad, true);
    assert.truthy(track.totalDistance > 400 && track.totalDistance < 800,
      `expected ~580 m, got ${track.totalDistance}`);
  });

  test('garbage bytes raise errorInvalidFile', async () => {
    const garbage = crypto.getRandomValues(new Uint8Array(200)).buffer;
    const err = await assert.throwsAsync(() => parseFIT(garbage));
    assert.truthy(err instanceof ParseError);
    assert.equal(err.key, PARSE_ERROR_KEYS.invalid);
  });

  test('unified entry point parses the fixture end to end', async () => {
    const buffer = await fetchSample(FIT_FIXTURE_URL);
    if (!buffer) return;
    const format = detectFormat('telemetry-mini.fit', buffer);
    const { points } = await parseTrackFile(buffer, format);
    assert.equal(points.length, 59);
  });
});

suite('parsers / cadence convention', () => {
  // The three generated cadence fixtures walk a straight line at constant
  // speed (0.917 m/s), step length (0.5 m) and cadence, so the k ratio is
  // constant: 55 @ 0.5 m gives k=2 (single-leg), 110 gives k=1 (double-step).
  // Constant cadence also means the converted point reading equals the
  // sector average (110 steps/min), which is what locks the profile and
  // panel readout paths together.

  test('single-leg fixture: judged single, factor 2, averages convert ×2', async () => {
    const buffer = await fetchSample('./fixtures/telemetry-cad-single.fit');
    if (!buffer) return;
    const track = await runParseJob(buffer, 'telemetry-cad-single.fit');
    assert.equal(track.cadenceConvention, 'single');
    assert.equal(track.cadenceFactor, 2);
    assert.equal(track.hasCad, true);
    // Raw TrackPoint.cad stays the recorded value — conversion happens on read.
    assert.equal(track.points[0].cad, 55);
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    assert.closeTo(m.avgCad, 110, 1e-9);
    assert.closeTo(m.maxCad, 110, 1e-9);
  });

  test('double-step fixture: judged double, factor 1, raw values display', async () => {
    const buffer = await fetchSample('./fixtures/telemetry-cad-double.fit');
    if (!buffer) return;
    const track = await runParseJob(buffer, 'telemetry-cad-double.fit');
    assert.equal(track.cadenceConvention, 'double');
    assert.equal(track.cadenceFactor, 1);
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    assert.closeTo(m.avgCad, 110, 1e-9);
    assert.closeTo(m.maxCad, 110, 1e-9);
  });

  test('short fixture: below the 30-sample floor degrades to unknown, raw values', async () => {
    const buffer = await fetchSample('./fixtures/telemetry-cad-short.fit');
    if (!buffer) return;
    const track = await runParseJob(buffer, 'telemetry-cad-short.fit');
    assert.equal(track.cadenceConvention, 'unknown');
    assert.equal(track.cadenceFactor, 1);
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    assert.closeTo(m.avgCad, 55, 1e-9);
  });

  test('detection unit: band agreement decides, degenerate input stays unknown', () => {
    // k = v×60 / (step/1000) / cadence: 1 m/s × 60 / 1 m / 30 = k 2 → single.
    const single = Array.from({ length: 40 }, () => ({ speed: 1, cadence: 30, step_length: 1000 }));
    assert.deepEqual(detectCadenceConvention(single), { convention: 'single', factor: 2 });
    // 2 m/s × 60 / 1 m / 120 = k 1 → double, factor 1.
    const double = Array.from({ length: 40 }, () => ({ speed: 2, cadence: 120, step_length: 1000 }));
    assert.deepEqual(detectCadenceConvention(double), { convention: 'double', factor: 1 });
    // Garmin files carry only enhanced_speed — same verdict through the fallback.
    const enhanced = Array.from({ length: 40 }, () => ({ enhanced_speed: 1, cadence: 30, step_length: 1000 }));
    assert.deepEqual(detectCadenceConvention(enhanced), { convention: 'single', factor: 2 });
    // Standing still / missing fields never count toward the sample floor.
    assert.deepEqual(detectCadenceConvention(single.slice(0, 29)), { convention: 'unknown', factor: 1 });
    const still = Array.from({ length: 40 }, () => ({ speed: 0.2, cadence: 30, step_length: 1000 }));
    assert.deepEqual(detectCadenceConvention(still), { convention: 'unknown', factor: 1 });
    // Scattered k values agree with neither band → unknown.
    const scatter = Array.from({ length: 40 }, (_, i) => ({
      speed: 1, cadence: 30, step_length: i % 2 ? 500 : 8000,
    }));
    assert.deepEqual(detectCadenceConvention(scatter), { convention: 'unknown', factor: 1 });
  });
});
