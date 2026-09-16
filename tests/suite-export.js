/**
 * Export tests — the build* functions are pure, so file content is asserted
 * directly: panel order, tab separators, group titles, Unavailable rows,
 * headerless md tables, RFC 4180 CSV quoting, and GPX structure/sector
 * filtering.
 */
import { suite, test, assert } from './runner.js';
import {
  buildTxtExport, buildMdExport, buildCsvExport, buildGpxExport, buildExportFilename,
} from '../js/export/exporter.js';
import { computeSectorMetrics } from '../js/metrics/sectorMetrics.js';
import { resetHeartRateSettings } from '../js/metrics/heartRateSettings.js';
import { prepareTrack } from '../js/geo/track.js';
import { eastTrack } from './helpers.js';
import { setLanguage, getCurrentLanguage } from '../js/language/language.js';
import { getUnitSystem, metersToMiles, setUnitSystem } from '../js/units/units.js';

/** Full-sensor track: elevation, timestamps, hr, cadence, temperature. */
function fullTrack() {
  const track = prepareTrack(eastTrack({
    count: 5,
    ele: (i) => 100 + i * 10,
    time: (i) => i * 60000,
    hr: (i) => 140 + i,
    cad: (i) => 80 + i,
    temp: (i) => 25 + i * 0.5,
  }), 'Test Track');
  track.sourceName = 'test-track.gpx';
  return track;
}

suite('export / txt', () => {
  test('file name first, then the sector range, then tab-separated rows', () => {
    const track = fullTrack();
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    const text = buildTxtExport(track, m, { start: 0, end: track.totalDistance });
    const lines = text.split('\n');
    assert.equal(lines[0], 'Source File: test-track.gpx', 'source label + full file name with extension');
    assert.truthy(lines[1].includes(' -> '), 'second line is the sector range');
    const distanceRow = lines.find((l) => l.startsWith('Distance\t'));
    assert.truthy(distanceRow, 'Distance row uses a tab separator');
    assert.equal(distanceRow, 'Distance\t445 m', 'metric display, same as the panel');
  });

  test('group titles and sensor rows appear in panel order', () => {
    const track = fullTrack();
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    const text = buildTxtExport(track, m, { start: 0, end: track.totalDistance });
    const lines = text.split('\n');
    // Group titles come from the i18n packs in their display form.
    for (const title of ['Elevation', 'Gradient', 'Speed', 'Time', 'Fitness']) {
      assert.truthy(lines.includes(title), `missing group title ${title}`);
    }
    assert.truthy(lines.some((l) => l.startsWith('Start Elevation\t100 m')));
    assert.truthy(lines.some((l) => l.startsWith('Average Heart Rate\t142 bpm')), `avg hr: ${lines.find((l) => l.startsWith('Average Heart Rate'))}`);
    assert.truthy(lines.some((l) => l.startsWith('Maximum Temperature\t27 °C')));
  });

  test('missing data exports the honest Unavailable marker', () => {
    const track = preparedNoSensors();
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    const text = buildTxtExport(track, m, { start: 0, end: track.totalDistance });
    assert.truthy(text.split('\n').includes('Average Heart Rate\tUnavailable'));
  });
});

suite('export / md', () => {
  test('headings per section, headerless tables for rows', () => {
    const track = fullTrack();
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    const text = buildMdExport(track, m, { start: 0, end: track.totalDistance });
    const lines = text.split('\n');
    assert.equal(lines[0], '# Source File: test-track.gpx');
    assert.truthy(lines.includes('# Elevation'));
    assert.truthy(lines.includes('# Fitness'));
    assert.truthy(lines.includes('|  |  |'), 'headerless table opener');
    assert.truthy(lines.includes('| --- | --- |'), 'table separator');
    assert.truthy(lines.includes('| Distance | 445 m |'));
  });
});

suite('export / csv', () => {
  const csvLines = (text) => text.replace(/^\uFEFF/, '').split('\r\n');

  test('mirrors the txt rows as comma cells: source, range, metrics, group titles', () => {
    const track = fullTrack();
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    const text = buildCsvExport(track, m, { start: 0, end: track.totalDistance });
    const lines = csvLines(text);
    assert.equal(lines[0], 'Source File: test-track.gpx', 'source line as one field');
    assert.truthy(lines[1].includes(' -> '), 'second line is the sector range');
    assert.truthy(lines.includes('Distance,445 m'), 'metric row: label,display value');
    assert.truthy(lines.includes('Elevation'), 'bare group-title line');
    assert.truthy(lines.includes('Start Elevation,100 m'));
  });

  test('heart-rate zone rows keep their four cells', () => {
    resetHeartRateSettings();
    const track = fullTrack();
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    const text = buildCsvExport(track, m, { start: 0, end: track.totalDistance });
    const lines = csvLines(text);
    assert.truthy(lines.includes('Heart Rate Zones'), 'group title present');
    assert.truthy(lines.includes('Zone 3,133–151 bpm,100%,4:00'), lines.find((l) => l.startsWith('Zone 3')));
    assert.truthy(lines.includes('Zone 1,95–113 bpm,0%,0:00'));
  });

  test('a UTF-8 BOM leads the file for spreadsheet encoding detection', () => {
    const track = fullTrack();
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    const text = buildCsvExport(track, m, { start: 0, end: track.totalDistance });
    assert.equal(text.charCodeAt(0), 0xfeff, 'BOM first');
    assert.equal(text.charCodeAt(1), 0x53, 'plain "S" follows — BOM only');
  });

  test('fields containing commas are RFC-4180 quoted (fr decimal must not split the row)', async () => {
    const track = fullTrack();
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    const saved = getCurrentLanguage();
    try {
      await setLanguage('fr');
      const text = buildCsvExport(track, m, { start: 0, end: track.totalDistance });
      const lines = csvLines(text);
      const speedLine = lines.find((l) => l.startsWith('Vitesse moyenne,'));
      assert.truthy(speedLine, `fr avg-speed row present: ${lines.find((l) => l.includes('km/h'))}`);
      assert.truthy(
        /^Vitesse moyenne,"\d,\d km\/h"$/.test(speedLine),
        `comma-decimal value is one quoted field: ${speedLine}`,
      );
    } finally {
      await setLanguage(saved);
    }
  });

  test('missing data exports the honest Unavailable marker', () => {
    const track = preparedNoSensors();
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    const text = buildCsvExport(track, m, { start: 0, end: track.totalDistance });
    assert.truthy(csvLines(text).includes('Average Heart Rate,Unavailable'));
  });
});

suite('export / gpx', () => {
  test('GPX 1.1 skeleton with only the sector points between the handles', () => {
    const track = fullTrack();
    // Handles at points 1 and 3 → exactly points 1..3 land in the file.
    const range = { start: track.cumDist[1], end: track.cumDist[3] };
    const text = buildGpxExport(track, range);
    assert.truthy(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    assert.truthy(text.includes('<gpx version="1.1"'), 'GPX 1.1 root');
    assert.equal((text.match(/<trkpt /g) || []).length, 3);
    assert.truthy(text.includes('<ele>110</ele>'));
    assert.truthy(text.includes('<gpxtpx:hr>141</gpxtpx:hr>'));
    assert.truthy(text.includes('<time>1970-01-01T00:01:00.000Z</time>'), 'time is ISO');
  });

  test('track name is XML-escaped', () => {
    const track = prepareTrack(eastTrack({ count: 2 }), '<X> & "Y"');
    const text = buildGpxExport(track, { start: 0, end: track.totalDistance });
    assert.truthy(text.includes('&lt;X&gt; &amp; &quot;Y&quot;'));
    assert.truthy(!text.includes('<X>'));
  });

  test('metadata: whole-track export carries the fixed-English source, no range', () => {
    const track = fullTrack();
    const text = buildGpxExport(track, { start: 0, end: track.totalDistance });
    const metadata = '<metadata>\n    <name>WaySlice</name>\n    <desc>Source: test-track.gpx</desc>\n  </metadata>';
    assert.truthy(text.includes(metadata), `metadata block: ${text.match(/<metadata>[\s\S]*?<\/metadata>/)[0]}`);
    assert.truthy(text.indexOf('<metadata>') < text.indexOf('<trk>'), 'metadata precedes the track (GPX 1.1 schema order)');
    assert.truthy(!text.includes('Range:'), 'whole track has no Range');
  });

  test('metadata: sector export adds the range in the active unit system, machine format', () => {
    const track = fullTrack();
    const range = { start: track.cumDist[1], end: track.cumDist[3] };
    setUnitSystem('metric');
    const metricText = buildGpxExport(track, range);
    const match = metricText.match(/<desc>Source: test-track\.gpx; Range: ([\d.]+) km - ([\d.]+) km<\/desc>/);
    assert.truthy(match, `metric range desc: ${metricText.match(/<desc>[^<]*<\/desc>/)[0]}`);
    assert.closeTo(parseFloat(match[1]), track.cumDist[1] / 1000, 0.006, 'start in km');
    assert.closeTo(parseFloat(match[2]), track.cumDist[3] / 1000, 0.006, 'end in km');
    setUnitSystem('imperial');
    const imperialText = buildGpxExport(track, range);
    const miMatch = imperialText.match(/Range: ([\d.]+) mi - ([\d.]+) mi/);
    assert.truthy(miMatch, `imperial range desc: ${imperialText.match(/<desc>[^<]*<\/desc>/)[0]}`);
    assert.closeTo(parseFloat(miMatch[1]), metersToMiles(track.cumDist[1]), 0.006, 'start in mi');
    setUnitSystem('metric');
  });

  test('metadata stays machine-format under a localized UI (fr must not inject commas)', async () => {
    const track = fullTrack();
    const range = { start: track.cumDist[1], end: track.totalDistance };
    const saved = getCurrentLanguage();
    try {
      await setLanguage('fr');
      const text = buildGpxExport(track, range);
      assert.truthy(/Range: [\d.]+ km - [\d.]+ km/.test(text), `dot decimals + km literal: ${text.match(/<desc>[^<]*<\/desc>/)[0]}`);
      assert.truthy(!text.includes(','), 'a fr UI must not leak comma decimals into GPX metadata');
    } finally {
      await setLanguage(saved);
    }
  });
});

suite('export / filename', () => {
  test('WaySlice-YYYY-MM-DD-HH-MM-SS plus the picked extension', () => {
    for (const ext of ['csv', 'txt', 'md', 'gpx']) {
      assert.truthy(
        new RegExp(`^WaySlice-\\d{4}-\\d{2}-\\d{2}-\\d{2}-\\d{2}-\\d{2}\\.${ext}$`).test(buildExportFilename(ext)),
        `unexpected name for .${ext}: ${buildExportFilename(ext)}`,
      );
    }
  });
});

suite('export / heart rate zones', () => {
  test('txt: numeric zone rows (label, bpm range, share, time) after Fitness', () => {
    resetHeartRateSettings(); // default MAX zones 95/114/133/152/171 of 190
    const track = fullTrack(); // hr 140–144, 4 × 60 s segments, all in zone 3
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    const text = buildTxtExport(track, m, { start: 0, end: track.totalDistance });
    const lines = text.split('\n');
    assert.truthy(lines.includes('Heart Rate Zones'), 'group title present');
    assert.truthy(lines.indexOf('Heart Rate Zones') > lines.indexOf('Fitness'), 'group follows Fitness');
    assert.truthy(lines.includes('Zone 3\t133–151 bpm\t100%\t4:00'), lines.find((l) => l.startsWith('Zone 3')));
    assert.truthy(lines.includes('Zone 1\t95–113 bpm\t0%\t0:00'));
    assert.truthy(lines.includes('Zone 5\t171+ bpm\t0%\t0:00'));
  });

  test('md: the zone group is a four-column headerless table', () => {
    resetHeartRateSettings();
    const track = fullTrack();
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    const text = buildMdExport(track, m, { start: 0, end: track.totalDistance });
    const lines = text.split('\n');
    assert.truthy(lines.includes('# Heart Rate Zones'));
    assert.truthy(lines.includes('|  |  |  |  |'), '4-column empty header row');
    assert.truthy(lines.includes('| --- | --- | --- | --- |'));
    assert.truthy(lines.includes('| Zone 3 | 133–151 bpm | 100% | 4:00 |'));
    assert.truthy(lines.includes('| Zone 1 | 95–113 bpm | 0% | 0:00 |'));
  });

  test('no heart rate exports the unavailable note instead of numbers', () => {
    resetHeartRateSettings();
    const track = preparedNoSensors();
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    const text = buildTxtExport(track, m, { start: 0, end: track.totalDistance });
    const lines = text.split('\n');
    assert.equal(lines[0], 'Source File: Bare', 'falls back to the track name without a source file');
    assert.truthy(lines.includes('Heart Rate Zones'));
    assert.truthy(lines.includes('No heart rate data'));
    assert.truthy(!lines.some((l) => l.startsWith('Zone ')), 'no zone rows without data');
  });
});

suite('export / locale as-is', () => {
  test('txt in French: numbers localize, unit symbols stay the ones the panel shows', async () => {
    resetHeartRateSettings();
    const track = fullTrack();
    const m = computeSectorMetrics(track, 0, track.totalDistance);
    const saved = getCurrentLanguage();
    try {
      await setLanguage('fr');
      const text = buildTxtExport(track, m, { start: 0, end: track.totalDistance });
      const lines = text.split('\n');
      assert.truthy(lines.includes('0 m -> 445 m'), `range line: ${lines[1]}`);
      const speedLine = lines.find((l) => l.includes('\t') && l.includes('km/h'));
      assert.truthy(speedLine, `speed row present: ${lines.find((l) => l.includes('km/h'))}`);
      assert.truthy(/,\d km\/h$/.test(speedLine), `fr speed uses the comma decimal + shared symbol: ${speedLine}`);
    } finally {
      await setLanguage(saved);
    }
  });

});

function preparedNoSensors() {
  return prepareTrack(eastTrack({ count: 5 }), 'Bare');
}
