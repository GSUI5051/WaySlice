/** Parser tests: GPX, KML, KMZ + error paths. */
import { suite, test, assert } from './runner.js';
import { parseGPX } from '../js/parsers/gpx.js';
import { parseKML } from '../js/parsers/kml.js';
import { parseKMZ } from '../js/parsers/kmz.js';
import { parseTCX } from '../js/parsers/tcx.js';
import { detectFormat, parseTrackFile } from '../js/parsers/index.js';
import { ParseError } from '../js/parsers/parseError.js';
import { prepareTrack } from '../js/geo/track.js';
import { buildStoredZip, deflateRaw } from './helpers.js';

const GPX_FULL = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="WaySlice tests" xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <trk><name>Test</name>
    <trkseg>
      <trkpt lat="47.2000" lon="11.3000"><ele>900</ele><time>2026-08-15T07:00:00Z</time>
        <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>140</gpxtpx:hr><gpxtpx:cad>80</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions>
      </trkpt>
      <trkpt lat="47.2010" lon="11.3010"><ele>910</ele><time>2026-08-15T07:01:00Z</time>
        <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>150</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>
      </trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="47.2020" lon="11.3020"><ele>930</ele><time>2026-08-15T07:03:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`;

suite('parsers / gpx', () => {
  test('tracks across multiple trkseg concatenate in order', () => {
    const pts = parseGPX(GPX_FULL).points;
    assert.equal(pts.length, 3);
    assert.closeTo(pts[0].lat, 47.2, 1e-9);
    assert.closeTo(pts[2].lon, 11.302, 1e-9);
    assert.equal(pts[0].time, Date.parse('2026-08-15T07:00:00Z'));
  });

  test('Garmin extension fields (hr, cad) are read namespace-agnostically', () => {
    const pts = parseGPX(GPX_FULL).points;
    assert.equal(pts[0].hr, 140);
    assert.equal(pts[0].cad, 80);
    assert.equal(pts[1].hr, 150);
    assert.equal(pts[2].hr, null);
  });

  test('prepareTrack flags elevation + time as available', () => {
    const track = prepareTrack(parseGPX(GPX_FULL).points, 'g');
    assert.equal(track.hasElevation, true);
    assert.equal(track.hasTime, true);
  });

  test('GPX without elevation still parses (graceful degradation)', () => {
    const gpx = GPX_FULL.replace(/<ele>[^<]*<\/ele>/g, '');
    const pts = parseGPX(gpx).points;
    assert.equal(pts.length, 3);
    assert.equal(prepareTrack(pts, 'g').hasElevation, false);
  });

  test('GPX without timestamps still parses (no fake times)', () => {
    const gpx = GPX_FULL.replace(/<time>[^<]*<\/time>/g, '');
    const pts = parseGPX(gpx).points;
    assert.equal(pts.length, 3);
    assert.equal(prepareTrack(pts, 'g').hasTime, false);
  });

  test('single-point and empty tracks return no usable sector base', () => {
    const single = '<gpx version="1.1"><trk><trkseg><trkpt lat="1" lon="2"/></trkseg></trk></gpx>';
    assert.equal(parseGPX(single).points.length, 1);
    assert.equal(parseGPX('<gpx version="1.1"/>').points.length, 0);
  });

  test('invalid XML raises ParseError(errorInvalidFile)', () => {
    const err = assert.throws(() => parseGPX('<gpx><trk></gpx>'));
    assert.truthy(err instanceof ParseError);
    assert.equal(err.key, 'errorInvalidFile');
  });

  test('non-GPX XML raises ParseError(errorUnsupportedType)', () => {
    const err = assert.throws(() => parseGPX('<foo/>'));
    assert.equal(err.key, 'errorUnsupportedType');
  });
});

suite('parsers / gpx waypoints', () => {
  const GPX_WPT = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="WaySlice tests" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="47.1900" lon="11.2950"><ele>700</ele><time>2026-08-15T06:50:00Z</time><name><![CDATA[Trailhead]]></name><sym>Flag, Blue</sym></wpt>
  <wpt lat="47.2100" lon="11.3150"><name>Summit</name></wpt>
  <wpt lat="47.2050" lon="11.3080"><name></name></wpt>
  <trk><trkseg>
    <trkpt lat="47.2000" lon="11.3000"><ele>900</ele></trkpt>
    <trkpt lat="47.2010" lon="11.3010"><ele>910</ele></trkpt>
  </trkseg></trk>
</gpx>`;

  test('root-level <wpt> elements parse with name, ele and time', () => {
    const { points, waypoints } = parseGPX(GPX_WPT);
    assert.equal(points.length, 2);       // waypoints stay out of the track
    assert.equal(waypoints.length, 3);
    assert.closeTo(waypoints[0].lat, 47.19, 1e-9);
    assert.closeTo(waypoints[0].lon, 11.295, 1e-9);
    assert.equal(waypoints[0].name, 'Trailhead');
    assert.equal(waypoints[0].ele, 700);
    assert.equal(waypoints[0].time, Date.parse('2026-08-15T06:50:00Z'));
  });

  test('waypoints without a name report null, not an empty string', () => {
    const { waypoints } = parseGPX(GPX_WPT);
    assert.equal(waypoints[1].name, 'Summit');
    assert.equal(waypoints[2].name, null);
    assert.equal(waypoints[2].ele, null);
  });

  test('prepareTrack carries waypoints without touching track math', () => {
    const { points, waypoints } = parseGPX(GPX_WPT);
    const track = prepareTrack(points, 'g', waypoints);
    assert.equal(track.waypoints.length, 3);
    assert.equal(track.waypoints[0].name, 'Trailhead');
    assert.equal(track.pointCount, 2);
  });

  test('a track-only file yields an empty waypoint array', () => {
    const { waypoints } = parseGPX(GPX_FULL);
    assert.equal(waypoints.length, 0);
  });
});

suite('parsers / gpx power', () => {
  // The two real-world encodings of power in GPX: a bare <power> element and
  // the Stages-style <gpxpx:PowerInWatts> extension.
  const GPX_POWER_BARE = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="WaySlice tests" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><trkseg>
    <trkpt lat="47.2000" lon="11.3000"><ele>900</ele><time>2026-08-15T07:00:00Z</time>
      <extensions><power>200</power></extensions>
    </trkpt>
    <trkpt lat="47.2010" lon="11.3010"><ele>910</ele><time>2026-08-15T07:01:00Z</time>
      <extensions><power>250</power></extensions>
    </trkpt>
  </trkseg></trk>
</gpx>`;

  const GPX_POWER_GPXPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="WaySlice tests" xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:gpxpx="http://www.garmin.com/xmlschemas/GpxExtensions/v3.gpxpx">
  <trk><trkseg>
    <trkpt lat="47.2000" lon="11.3000"><ele>900</ele><time>2026-08-15T07:00:00Z</time>
      <extensions><gpxpx:PowerExtension><gpxpx:PowerInWatts>200</gpxpx:PowerInWatts></gpxpx:PowerExtension></extensions>
    </trkpt>
    <trkpt lat="47.2010" lon="11.3010"><ele>910</ele><time>2026-08-15T07:01:00Z</time>
      <extensions><gpxpx:PowerExtension><gpxpx:PowerInWatts>260</gpxpx:PowerInWatts></gpxpx:PowerExtension></extensions>
    </trkpt>
  </trkseg></trk>
</gpx>`;

  test('bare <extensions><power> elements parse as watts', () => {
    const pts = parseGPX(GPX_POWER_BARE).points;
    assert.equal(pts[0].power, 200);
    assert.equal(pts[1].power, 250);
  });

  test('gpxpx:PowerInWatts extension parses as watts (case-different localName)', () => {
    const pts = parseGPX(GPX_POWER_GPXPX).points;
    assert.equal(pts[0].power, 200);
    assert.equal(pts[1].power, 260);
  });

  const GPX_POWER_NS3 = GPX_POWER_GPXPX
    .replace(/<gpxpx:PowerExtension><gpxpx:PowerInWatts>(\d+)<\/gpxpx:PowerInWatts><\/gpxpx:PowerExtension>/g,
      '<ns3:Watts>$1</ns3:Watts>')
    .replace(/xmlns:gpxpx="[^"]*"/, 'xmlns:ns3="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"');

  test('ns3:Watts extension parses as watts (Garmin-Connect style)', () => {
    const pts = parseGPX(GPX_POWER_NS3).points;
    assert.equal(pts[0].power, 200);
    assert.equal(pts[1].power, 260);
  });

  test('prepareTrack flags hasPower for both flavors, and only with data', () => {
    assert.equal(prepareTrack(parseGPX(GPX_POWER_BARE).points, 'g').hasPower, true);
    assert.equal(prepareTrack(parseGPX(GPX_POWER_GPXPX).points, 'g').hasPower, true);
    assert.equal(prepareTrack(parseGPX(GPX_FULL).points, 'g').hasPower, false);
  });
});

suite('parsers / gpx ns3 TrackPointExtension (telemetry.gpx style)', () => {
  // Full Garmin Connect export shape: every series item the ns3
  // TrackPointExtension can carry, nested inside its container.
  const GPX_NS3_TPE = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="WaySlice tests" xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:ns3="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <trk><trkseg>
    <trkpt lat="22.566962" lon="113.977272"><ele>35.78</ele><time>2025-12-11T11:53:40Z</time>
      <extensions><ns3:TrackPointExtension>
        <ns3:speed>0.0</ns3:speed><ns3:cad>0.0</ns3:cad><ns3:hr>93</ns3:hr><ns3:distance>0.2</ns3:distance>
        <ns3:atemp>18.5</ns3:atemp><ns3:Watts>180</ns3:Watts>
      </ns3:TrackPointExtension></extensions>
    </trkpt>
    <trkpt lat="22.567062" lon="113.977372"><ele>35.9</ele><time>2025-12-11T11:53:41Z</time>
      <extensions><ns3:TrackPointExtension>
        <ns3:speed>2.7</ns3:speed><ns3:cad>78</ns3:cad><ns3:hr>96</ns3:hr><ns3:distance>3.4</ns3:distance>
        <ns3:atemp>19.0</ns3:atemp><ns3:Watts>240</ns3:Watts>
      </ns3:TrackPointExtension></extensions>
    </trkpt>
  </trkseg></trk>
</gpx>`;

  test('hr / cad / speed / distance / atemp / watts all read from the ns3 series', () => {
    const pts = parseGPX(GPX_NS3_TPE).points;
    assert.equal(pts[0].hr, 93);
    assert.equal(pts[0].cad, 0);
    assert.equal(pts[0].speed, 0);
    assert.closeTo(pts[0].distance, 0.2, 1e-9);
    assert.closeTo(pts[0].temp, 18.5, 1e-9);
    assert.equal(pts[0].power, 180);
    assert.equal(pts[1].hr, 96);
    assert.equal(pts[1].cad, 78);
    assert.closeTo(pts[1].speed, 2.7, 1e-9);
    assert.closeTo(pts[1].distance, 3.4, 1e-9);
    assert.closeTo(pts[1].temp, 19, 1e-9);
    assert.equal(pts[1].power, 240);
  });
});

suite('parsers / tcx (dom parser)', () => {
  // Self-contained TrainingCenterDatabase exercising the corpus behaviors:
  // multi-lap concatenation, position-less drop, sensor priorities, an
  // altitude gap, and the TPX extension family.
  const TCX_FULL = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
    xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
  <Activities>
    <Activity Sport="Biking">
      <Id>2026-08-15T07:00:00Z</Id>
      <Lap StartTime="2026-08-15T07:00:00Z">
        <Track>
          <Trackpoint>
            <Time>2026-08-15T07:00:00Z</Time>
            <Position><LatitudeDegrees>47.2</LatitudeDegrees><LongitudeDegrees>11.3</LongitudeDegrees></Position>
            <AltitudeMeters>900</AltitudeMeters><DistanceMeters>0</DistanceMeters>
            <HeartRateBpm><Value>140</Value></HeartRateBpm><Cadence>80</Cadence>
            <Extensions><ns3:TPX><ns3:Speed>8.2</ns3:Speed><ns3:Watts>210</ns3:Watts></ns3:TPX></Extensions>
          </Trackpoint>
          <Trackpoint>
            <Time>2026-08-15T07:01:00Z</Time>
            <Position><LatitudeDegrees>47.201</LatitudeDegrees><LongitudeDegrees>11.301</LongitudeDegrees></Position>
            <AltitudeMeters>910</AltitudeMeters><DistanceMeters>120</DistanceMeters>
            <Cadence>82</Cadence>
            <Extensions><ns3:TPX><ns3:RunCadence>170</ns3:RunCadence></ns3:TPX></Extensions>
          </Trackpoint>
        </Track>
      </Lap>
      <Lap>
        <Track>
          <Trackpoint>
            <Time>2026-08-15T07:03:00Z</Time>
            <Position><LatitudeDegrees>47.202</LatitudeDegrees><LongitudeDegrees>11.302</LongitudeDegrees></Position>
            <HeartRateBpm><Value>150</Value></HeartRateBpm>
            <Extensions><ns3:TPX><ns3:RunCadence>171</ns3:RunCadence></ns3:TPX></Extensions>
          </Trackpoint>
          <Trackpoint>
            <Time>2026-08-15T07:04:00Z</Time>
            <Position><LatitudeDegrees>47.203</LatitudeDegrees><LongitudeDegrees>11.303</LongitudeDegrees></Position>
            <AltitudeMeters>940</AltitudeMeters><DistanceMeters>300</DistanceMeters>
          </Trackpoint>
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;

  test('async entry parses laps in document order and drops position-less points', async () => {
    const { points, waypoints } = await parseTCX(new TextEncoder().encode(TCX_FULL).buffer);
    assert.equal(points.length, 4);       // lap-2 first point has no Position
    assert.equal(waypoints.length, 0);
    assert.closeTo(points[0].lat, 47.2, 1e-9);
    assert.closeTo(points[2].lat, 47.202, 1e-9);
    assert.equal(points[0].lap, 0);
    assert.equal(points[2].lap, 1);
    assert.equal(points[0].time, Date.parse('2026-08-15T07:00:00Z'));
  });

  test('core sensors, TPX watts/speed and the Cadence > RunCadence priority', async () => {
    const { points } = await parseTCX(new TextEncoder().encode(TCX_FULL).buffer);
    assert.equal(points[0].hr, 140);
    assert.equal(points[0].cad, 80);
    assert.equal(points[0].power, 210);
    assert.closeTo(points[0].speed, 8.2, 1e-9);
    // core <Cadence> beats TPX <RunCadence>; RunCadence fills a cadence hole
    assert.equal(points[1].cad, 82);
    assert.equal(points[2].cad, 171);
    assert.equal(points[2].power, null);  // no Watts element → null, not 0
    assert.equal(points[3].hr, null);     // no strap, no fabricated value
  });

  test('altitude gap is bridged and hasElevation stays true', async () => {
    const { points } = await parseTCX(new TextEncoder().encode(TCX_FULL).buffer);
    assert.equal(points[1].ele, 910);
    assert.equal(points[2].ele, 925);     // (910 + 940) / 2
    assert.equal(points[3].ele, 940);
    assert.equal(prepareTrack(points, 'tcx').hasElevation, true);
  });

  test('empty Activities raise noTrack, invalid XML raises invalid', async () => {
    const empty = '<TrainingCenterDatabase><Activities/></TrainingCenterDatabase>';
    let err = assert.throws(() => parseTCX(new TextEncoder().encode(empty).buffer));
    assert.truthy(err instanceof ParseError);
    assert.equal(err.key, 'errorNoTrackPoints');
    err = assert.throws(() => parseTCX(new TextEncoder().encode('<gpx/>').buffer));
    assert.equal(err.key, 'errorUnsupportedType');
    err = assert.throws(() => parseTCX(new TextEncoder().encode('<TrainingCenterDatabase><unclosed>').buffer));
    assert.equal(err.key, 'errorInvalidFile');
  });

  test('unified entry point dispatches tcx buffers', async () => {
    const buffer = new TextEncoder().encode(TCX_FULL).buffer;
    const { points } = await parseTrackFile(buffer, 'tcx');
    assert.equal(points.length, 4);
  });
});

suite('parsers / kml', () => {
  const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark><LineString><coordinates>
      11.300,47.200,900 11.310,47.210,950
      11.320,47.220,980
    </coordinates></LineString></Placemark>
  </Document>
</kml>`;

  test('LineString coordinates parse as lon,lat,ele triples', () => {
    const pts = parseKML(KML).points;
    assert.equal(pts.length, 3);
    assert.closeTo(pts[0].lon, 11.3, 1e-9);
    assert.closeTo(pts[0].lat, 47.2, 1e-9);
    assert.equal(pts[0].ele, 900);
  });

  test('gx:Track reads <when>/<gx:coord> pairs', () => {
    const kml = `<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
  <Placemark><gx:Track>
    <when>2026-08-15T07:00:00Z</when><gx:coord>11.3 47.2 900</gx:coord>
    <when>2026-08-15T07:01:00Z</when><gx:coord>11.31 47.21 950</gx:coord>
  </gx:Track></Placemark>
</kml>`;
    const pts = parseKML(kml).points;
    assert.equal(pts.length, 2);
    assert.equal(pts[0].time, Date.parse('2026-08-15T07:00:00Z'));
    assert.equal(pts[1].ele, 950);
  });

  test('invalid KML raises ParseError', () => {
    const err = assert.throws(() => parseKML('<kml><unclosed>'));
    assert.equal(err.key, 'errorInvalidFile');
  });
});

suite('parsers / kmz', () => {
  const KML_DOC = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Placemark><LineString><coordinates>11.3,47.2,900 11.31,47.21,950</coordinates></LineString></Placemark>
</kml>`;

  test('stored (uncompressed) doc.kml inside a ZIP parses', async () => {
    const buffer = buildStoredZip([
      { name: 'doc.kml', data: KML_DOC },
      { name: 'styles.xml', data: '<x/>' },
    ]);
    const { points } = await parseKMZ(buffer);
    assert.equal(points.length, 2);
    assert.equal(points[1].ele, 950);
  });

  test('deflated doc.kml parses via DecompressionStream', async () => {
    if (typeof CompressionStream !== 'function') return; // environment lacks it
    const deflated = await deflateRaw(KML_DOC);
    const buffer = buildStoredZipEntryDeflated({ name: 'doc.kml', data: deflated, size: KML_DOC.length });
    const { points } = await parseKMZ(buffer);
    assert.equal(points.length, 2);
  });

  test('nested doc.kml is preferred over other kml entries', async () => {
    const buffer = buildStoredZip([
      { name: 'other.kml', data: '<kml/>' },
      { name: 'files/doc.kml', data: KML_DOC },
    ]);
    const { points } = await parseKMZ(buffer);
    assert.equal(points.length, 2);
  });

  test('KMZ without any KML entry raises errorKmzNoKml', async () => {
    const buffer = buildStoredZip([{ name: 'readme.txt', data: 'hello' }]);
    const err = await assert.throwsAsync(() => parseKMZ(buffer));
    assert.equal(err.key, 'errorKmzNoKml');
  });
});

suite('parsers / detection', () => {
  test('extension wins when present; magic bytes rescue mislabeled files', () => {
    const gpxBuffer = new TextEncoder().encode(GPX_FULL).buffer;
    assert.equal(detectFormat('a.gpx', gpxBuffer), 'gpx');
    assert.equal(detectFormat('a.bin', gpxBuffer), 'gpx'); // sniffed via <gpx
    const zip = buildStoredZip([{ name: 'doc.kml', data: '<kml/>' }]);
    assert.equal(detectFormat('a.dat', zip), 'kmz'); // "PK" magic
  });

  test('unknown type raises errorUnsupportedType', () => {
    const err = assert.throws(() => detectFormat('a.txt', new TextEncoder().encode('hello world').buffer));
    assert.equal(err.key, 'errorUnsupportedType');
  });

  test('unified entry point parses gpx buffers', async () => {
    const buffer = new TextEncoder().encode(GPX_FULL).buffer;
    const { points, waypoints } = await parseTrackFile(buffer, 'gpx');
    assert.equal(points.length, 3);
    assert.equal(waypoints.length, 0);
  });
});

suite('parsers / kml waypoints', () => {
  // Real-world shape (a Japanese hiking app's exports): route + 48 Point placemarks.
  const KML_WPT = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
  <Document>
    <Placemark><LineString><coordinates>
      114.178,22.561,65 114.180,22.563,70
    </coordinates></LineString></Placemark>
    <Placemark>
      <name>登り口・8番出口</name>
      <Point><coordinates>114.1785,22.5609,66.0</coordinates></Point>
    </Placemark>
    <Placemark>
      <name></name>
      <description>&lt;b&gt;東屋&lt;/b&gt; 休憩所</description>
      <Point><coordinates>114.190,22.570,480</coordinates></Point>
    </Placemark>
    <Placemark>
      <Point><coordinates>114.195,22.575</coordinates></Point>
    </Placemark>
  </Document>
</kml>`;

  test('Point placemarks become waypoints, separate from track points', () => {
    const { points, waypoints } = parseKML(KML_WPT);
    assert.equal(points.length, 2);   // only the LineString feeds the track
    assert.equal(waypoints.length, 3);
    assert.closeTo(waypoints[0].lat, 22.5609, 1e-9);
    assert.closeTo(waypoints[0].lon, 114.1785, 1e-9);
    assert.equal(waypoints[0].ele, 66);
    assert.equal(waypoints[0].name, '登り口・8番出口');
  });

  test('name falls back to stripped description, then null', () => {
    const { waypoints } = parseKML(KML_WPT);
    assert.equal(waypoints[1].name, '東屋 休憩所');
    assert.equal(waypoints[2].name, null);
    assert.equal(waypoints[2].ele, null);
  });

  test('KMZ passthrough keeps the same shape', async () => {
    if (typeof DecompressionStream !== 'function') return;
    const kml = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2">
      <Placemark><Point><coordinates>114.1,22.5,10</coordinates></Point></Placemark>
    </kml>`;
    const deflated = await deflateRaw(kml);
    const buffer = buildStoredZipEntryDeflated({ name: 'doc.kml', data: deflated, size: kml.length });
    const { points, waypoints } = await parseKMZ(buffer);
    assert.equal(points.length, 0);
    assert.equal(waypoints.length, 1);
  });
});

/** Builds a single-entry ZIP with a deflated payload (method 8). */
function buildStoredZipEntryDeflated({ name, data, size }) {
  const encoder = new TextEncoder();
  const nameBytes = encoder.encode(name);
  const local = new Uint8Array(30 + nameBytes.length);
  let dv = new DataView(local.buffer);
  dv.setUint32(0, 0x04034b50, true);
  dv.setUint16(4, 20, true);
  dv.setUint16(8, 8, true); // deflate
  dv.setUint32(18, data.length, true);
  dv.setUint32(22, size, true);
  dv.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);

  const cd = new Uint8Array(46 + nameBytes.length);
  dv = new DataView(cd.buffer);
  dv.setUint32(0, 0x02014b50, true);
  dv.setUint16(10, 8, true);
  dv.setUint32(20, data.length, true);
  dv.setUint32(24, size, true);
  dv.setUint16(28, nameBytes.length, true);
  dv.setUint32(42, 0, true);
  cd.set(nameBytes, 46);

  const eocd = new Uint8Array(22);
  dv = new DataView(eocd.buffer);
  dv.setUint32(0, 0x06054b50, true);
  dv.setUint16(8, 1, true);
  dv.setUint16(10, 1, true);
  dv.setUint32(12, cd.length, true);
  dv.setUint32(16, local.length + data.length, true);

  const out = new Uint8Array(local.length + data.length + cd.length + eocd.length);
  out.set(local, 0);
  out.set(data, local.length);
  out.set(cd, local.length + data.length);
  out.set(eocd, local.length + data.length + cd.length);
  return out.buffer;
}
