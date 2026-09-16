/**
 * FIT + TCX parser tests. The FIT samples are binary, so the real sample file
 * is fetched over HTTP (skip gracefully when served from file://); the TCX
 * sensor fixture is an inline document. Sensor data (hr/cad/power) and
 * elevation-gap interpolation are the interesting parts of both pipelines.
 */
import { suite, test, assert } from './runner.js';
import { parseFIT } from '../js/parsers/fit.js';
import { parseTCX } from '../js/parsers/tcx.js';
import { detectFormat, parseTrackFile } from '../js/parsers/index.js';
import { ParseError, PARSE_ERROR_KEYS } from '../js/parsers/parseError.js';
import { prepareTrack } from '../js/geo/track.js';

const FIT_SAMPLE_URL = '../sample/telemetry.fit';
const TCX_SAMPLE_URL = '../sample/telemetry.tcx';

/** Fetches a sample as an ArrayBuffer, or returns null when unreachable (file://). */
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
    assert.equal(points[0].distance, 0);
    assert.equal(points[0].lap, 0);
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

  test('real-world sample: telemetry export keeps position + hr + laps', async () => {
    const buffer = await fetchSample(TCX_SAMPLE_URL);
    if (!buffer) return; // not served over HTTP — skip
    const { points } = await parseTCX(buffer);
    assert.equal(points.length, 4325);
    const withHr = points.filter((p) => p.hr != null).length;
    assert.truthy(withHr > 4000, `expected most points to carry hr, got ${withHr}`);
    assert.closeTo(points[0].lat, 22.566973, 1e-6);
    assert.equal(points[0].time, Date.parse('2025-12-11T11:53:40Z'));
  });
});

suite('parsers / fit', () => {
  test('detection: extension and ".FIT" magic at header bytes 8..12', async () => {
    const buffer = await fetchSample(FIT_SAMPLE_URL);
    if (!buffer) return;
    assert.equal(detectFormat('a.fit', buffer), 'fit');
    assert.equal(detectFormat('a.bin', buffer), 'fit'); // mislabeled, magic-sniffed
    assert.equal(detectFormat('a.gpx', buffer), 'gpx'); // extension still wins
  });

  test('real-world sample: 10 laps, sensors, laps carried per point', async () => {
    const buffer = await fetchSample(FIT_SAMPLE_URL);
    if (!buffer) return;
    const { points, waypoints } = await parseFIT(buffer);
    assert.equal(waypoints.length, 0);
    // The sample has 4326 records; the position-less session start drops out.
    assert.equal(points.length, 4325);
    assert.equal(new Set(points.map((p) => p.lap)).size, 10);
    const withHr = points.filter((p) => p.hr != null).length;
    const withCad = points.filter((p) => p.cad != null).length;
    assert.truthy(withHr > 4000, `expected most points to carry hr, got ${withHr}`);
    assert.truthy(withCad > 4000, `expected most points to carry cadence, got ${withCad}`);
    assert.closeTo(points[0].lat, 22.566973, 1e-6);
    assert.equal(points[0].time, Date.parse('2025-12-11T11:53:40Z'));
  });

  test('real-world sample: dropped altitude readings are bridged, track stays usable', async () => {
    const buffer = await fetchSample(FIT_SAMPLE_URL);
    if (!buffer) return;
    const { points } = await parseFIT(buffer);
    const missingEle = points.filter((p) => p.ele == null).length;
    assert.equal(missingEle, 0);
    const track = prepareTrack(points, 'f');
    assert.equal(track.hasElevation, true);
    assert.equal(track.hasTime, true);
    assert.equal(track.hasHr, true);
    assert.equal(track.hasCad, true);
    assert.truthy(track.totalDistance > 9000, `expected ~9.8 km, got ${track.totalDistance}`);
  });

  test('garbage bytes raise errorInvalidFile', async () => {
    const garbage = crypto.getRandomValues(new Uint8Array(200)).buffer;
    const err = await assert.throwsAsync(() => parseFIT(garbage));
    assert.truthy(err instanceof ParseError);
    assert.equal(err.key, PARSE_ERROR_KEYS.invalid);
  });

  test('unified entry point parses the sample end to end', async () => {
    const buffer = await fetchSample(FIT_SAMPLE_URL);
    if (!buffer) return;
    const format = detectFormat('telemetry.fit', buffer);
    const { points } = await parseTrackFile(buffer, format);
    assert.equal(points.length, 4325);
  });
});
