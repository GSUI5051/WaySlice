/**
 * Export — serializes the CURRENT SECTOR into downloadable files.
 *
 * Four formats:
 *
 *   .csv  the metrics panel as RFC 4180 comma-separated rows — the same rows
 *         as the .txt export (source, sector range, Label,Value metric rows,
 *         bare group-title lines, four-cell heart-rate zone rows), with any
 *         field containing a comma/quote/newline quoted, and a UTF-8 BOM so
 *         spreadsheets detect the encoding
 *   .txt  the metrics panel as `Label<tab>Value` lines, group titles as bare
 *         lines (ELEVATION / GRADIENT / SPEED / TIME / FITNESS)
 *   .md   the same data with the group titles as `#` headings and each
 *         group's rows as a headerless two-column table
 *   .gpx  the track points between the two sector handles, mirroring the
 *         structure of an imported GPX 1.1 track (fixed-English machine
 *         metadata, ele/time/TrackPointExtension)
 *
 * Labels and values go through the same t() / formatting calls the panel
 * uses, so an export always matches what the page renders in the language
 * and unit system active at the moment of export. Files are UTF-8.
 *
 * The menu wiring (initExport) owns the download plumbing; the build* functions
 * are pure and unit-tested.
 */
import { trackStore } from '../core/stores.js';
import { sectorStore } from '../sector/sectorStore.js';
import { computeSectorMetrics } from '../metrics/sectorMetrics.js';
import { computeHeartRateZoneStats } from '../metrics/heartRateStats.js';
import { zoneDisplayRange } from '../metrics/heartRateZones.js';
import { createMenu } from '../ui/menus.js';
import { t } from '../language/language.js';
import { getUnitSystem, metersToMiles } from '../units/units.js';
import {
  formatDistance, formatSignedElevation, formatElevation, formatGrade,
  formatPace, formatSpeed, formatDuration, formatDateTime,
  formatVam, formatBpm, formatRpm, formatTemp, formatPower,
  formatBpmRange, formatPercent, formatSectorRangeBounds,
} from '../utils/format.js';

/** @private One metric row: i18n label key + the rendered panel value
 *  (already formatted; null renders as the honest Unavailable marker). */
function row(key, value) {
  return [t(key), value == null ? t('unavailable') : value];
}

/** @private The summary rows, in panel order (values pre-formatted). */
function summaryRows(m) {
  return [
    row('distance', formatDistance(m.horizontalDistance)),
    row('threeDDistance', opt(m.distance3D, formatDistance)),
    row('effortDistance', opt(m.effortDistance, formatDistance)),
    row('elevationGain', opt(m.gain, formatElevation)),
    row('elevationLoss', opt(m.loss, formatElevation)),
    row('avgGrade', opt(m.avgGrade, formatGrade)),
    row('avgPace', opt(m.avgPace, formatPace)),
    row('avgGap', opt(m.avgGap, formatPace)),
    row('avgSpeed', opt(m.avgSpeed, formatSpeed)),
  ];
}

/** @private Detail groups (i18n title key + rows), in panel order. */
function groupRows(m) {
  return [
    ['elevationGroup', [
      row('startElevation', opt(m.eleStart, formatElevation)),
      row('endElevation', opt(m.eleEnd, formatElevation)),
      row('minElevation', opt(m.eleMin, formatElevation)),
      row('maxElevation', opt(m.eleMax, formatElevation)),
      row('netElevationChange', opt(m.netElevation, (v) => formatSignedElevation(v))),
    ]],
    ['gradientGroup', [
      row('maxGrade', opt(m.maxGrade, formatGrade)),
      row('minGrade', opt(m.minGrade, formatGrade)),
    ]],
    ['speedGroup', [
      row('avgSpeed', opt(m.avgSpeed, formatSpeed)),
      row('maxSpeed', opt(m.maxSpeed, formatSpeed)),
      m.fastestKm ? row('fastestKm', formatPace(m.fastestKm.pace)) : row('fastestKm', null),
      m.slowestKm ? row('slowestKm', formatPace(m.slowestKm.pace)) : row('slowestKm', null),
      row('vam', opt(m.vam, formatVam)),
      row('vdm', opt(m.vdm, formatVam)),
    ]],
    ['timeGroup', [
      row('elapsed', opt(m.elapsed, formatDuration)),
      row('movingTime', opt(m.moving, formatDuration)),
      row('startTime', opt(m.timeStart, formatDateTime)),
      row('endTime', opt(m.timeEnd, formatDateTime)),
    ]],
    ['fitnessGroup', [
      row('avgHr', opt(m.avgHr, formatBpm)),
      row('maxHr', opt(m.maxHr, formatBpm)),
      row('avgCadence', opt(m.avgCad, formatRpm)),
      row('maxCadence', opt(m.maxCad, formatRpm)),
      row('avgPower', opt(m.avgPower, formatPower)),
      row('maxPower', opt(m.maxPower, formatPower)),
      row('avgTemp', opt(m.avgTemp, formatTemp)),
      row('minTemp', opt(m.minTemp, formatTemp)),
      row('maxTemp', opt(m.maxTemp, formatTemp)),
    ]],
  ];
}

/** @private Applies the formatter to a finite value, else null → Unavailable. */
function opt(value, format) {
  return value == null || !Number.isFinite(value) ? null : format(value);
}

/**
 * @private Heart Rate Zones group for the text exports — the numbers of the
 * metrics panel's Heart Rate Zones group, one row per zone as
 * [label, bpmRange, share, duration] (no bar graphics). `note` mirrors the
 * panel's unavailable reason when the group has no numbers to show.
 * @param {import('../types.js').Track} track
 * @param {number} start
 * @param {number} end
 * @returns {{title: string, rows?: [string, string, string, string][], note?: string}}
 */
function hrZoneGroup(track, start, end) {
  const title = t('hrZones');
  if (!track.hasHr) return { title, note: t('noHeartRateData') };
  if (!track.hasTime) return { title, note: t('noTimestampData') };
  const stats = computeHeartRateZoneStats(track, start, end);
  if (!stats) return { title, note: t('noHeartRateData') };
  // Same denominator as the panel: below-Z1 time is excluded from the shares.
  const denominator = Math.max(stats.moving - stats.below, 0);
  const rows = stats.zones.map((zone, i) => {
    const pct = denominator > 0 ? Math.round((zone.seconds / denominator) * 100) : 0;
    const d = zoneDisplayRange(zone);
    return [t('zoneN', { n: i + 1 }), formatBpmRange(d.lo, d.hi), formatPercent(pct), formatDuration(zone.seconds)];
  });
  return { title, rows };
}

/**
 * Builds the .txt export: file name, sector range, then every metric row as
 * `Label<tab>Value`, with bare group-title lines between the sections.
 * @param {import('../types.js').Track} track
 * @param {import('../types.js').SectorMetrics} m
 * @param {{start:number, end:number}} range
 * @returns {string}
 */
export function buildTxtExport(track, m, range) {
  const lines = [
    `${t('sourceFile')} ${track.sourceName ?? track.name}`,
    `${formatSectorRangeBounds(range.start, range.end).join(' -> ')}`,
    ...summaryRows(m).map(([label, value]) => `${label}\t${value}`),
  ];
  for (const [titleKey, rows] of groupRows(m)) {
    lines.push(t(titleKey), ...rows.map(([label, value]) => `${label}\t${value}`));
  }
  const hr = hrZoneGroup(track, range.start, range.end);
  lines.push(hr.title);
  if (hr.note) {
    lines.push(hr.note);
  } else {
    for (const [label, bpm, pct, time] of hr.rows) lines.push(`${label}\t${bpm}\t${pct}\t${time}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Builds the .md export: the same data with `#` headings per section and
 * headerless two-column tables for the rows.
 * @param {import('../types.js').Track} track
 * @param {import('../types.js').SectorMetrics} m
 * @param {{start:number, end:number}} range
 * @returns {string}
 */
export function buildMdExport(track, m, range) {
  const table = (rows) =>
    ['|  |  |', '| --- | --- |', ...rows.map(([label, value]) => `| ${label} | ${value} |`)];
  // Each block is a heading plus its contiguous table lines; blocks are
  // separated by a blank line (a blank inside a table would break it).
  const blocks = [
    [`# ${t('sourceFile')} ${track.sourceName ?? track.name}`],
    [`${formatSectorRangeBounds(range.start, range.end).join(' -> ')}`],
    [`# ${t('allMetrics')}`, ...table(summaryRows(m))],
  ];
  for (const [titleKey, rows] of groupRows(m)) {
    blocks.push([`# ${t(titleKey)}`, ...table(rows)]);
  }
  const hr = hrZoneGroup(track, range.start, range.end);
  if (hr.note) {
    blocks.push([`# ${hr.title}`, hr.note]);
  } else {
    // Four numeric columns per zone; the headerless-table convention matches
    // the other groups (empty header row + separator).
    blocks.push([
      `# ${hr.title}`,
      '|  |  |  |  |',
      '| --- | --- | --- | --- |',
      ...hr.rows.map(([label, bpm, pct, time]) => `| ${label} | ${bpm} | ${pct} | ${time} |`),
    ]);
  }
  return blocks.map((block) => block.join('\n')).join('\n\n') + '\n';
}

/** @private Escapes one CSV field per RFC 4180: a field containing a comma,
 *  quote or newline is wrapped in quotes and inner quotes are doubled — a
 *  French decimal ("9,82") must never split its row into two columns. */
function csvField(text) {
  const value = String(text);
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * Builds the .csv export: the same rows as the .txt export — sector source,
 * range line, then every metric as Label,Value with bare group-title lines
 * between the sections, and the heart-rate zone rows carrying their four
 * cells — joined as RFC 4180 CSV (CRLF line endings, quoted fields). The
 * file leads with a UTF-8 BOM so spreadsheet apps detect the encoding; like
 * the txt/md exports it is headerless.
 * @param {import('../types.js').Track} track
 * @param {import('../types.js').SectorMetrics} m
 * @param {{start:number, end:number}} range
 * @returns {string}
 */
export function buildCsvExport(track, m, range) {
  const rows = [
    [`${t('sourceFile')} ${track.sourceName ?? track.name}`],
    [formatSectorRangeBounds(range.start, range.end).join(' -> ')],
    ...summaryRows(m),
  ];
  for (const [titleKey, groupMRows] of groupRows(m)) {
    rows.push([t(titleKey)], ...groupMRows);
  }
  const hr = hrZoneGroup(track, range.start, range.end);
  rows.push([hr.title]);
  if (hr.note) {
    rows.push([hr.note]);
  } else {
    for (const zoneRow of hr.rows) rows.push(zoneRow);
  }
  return '\uFEFF' + rows.map((cells) => cells.map(csvField).join(',')).join('\r\n') + '\r\n';
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';
const TPX_NS = 'http://www.garmin.com/xmlschemas/TrackPointExtension/v1';

/** Fixed machine format for GPX metadata ranges: dot decimals, two places,
 *  no group separators — deliberately independent of the UI locale. */
const METADATA_RANGE_FORMAT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: false,
});

/**
 * Fixed-English machine metadata for the GPX export — never localized, so
 * the labels and dot-decimal numbers stay parseable in any tool regardless
 * of the UI language. The km/mi unit follows the active UNIT SYSTEM only.
 * A whole-track export carries just the source file; a sector adds its range
 * (whole-track rule mirrors sectorStore.isEntireTrack's 0.5 m tolerance).
 * @private
 */
function metadataXml(track, range) {
  const entire = range.start <= 0.5 && range.end >= track.totalDistance - 0.5;
  let desc = `Source: ${track.sourceName ?? track.name}`;
  if (!entire) {
    const imperial = getUnitSystem() === 'imperial';
    const unit = imperial ? 'mi' : 'km';
    const toUnit = (m) => (imperial ? metersToMiles(m) : m / 1000);
    desc += `; Range: ${METADATA_RANGE_FORMAT.format(toUnit(range.start))} ${unit} - ${METADATA_RANGE_FORMAT.format(toUnit(range.end))} ${unit}`;
  }
  return `  <metadata>\n    <name>WaySlice</name>\n    <desc>${xmlEscape(desc)}</desc>\n  </metadata>`;
}

/** @private Escapes XML special characters in text/attribute values. */
function xmlEscape(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** @private One <trkpt> block, mirroring the structure of an imported track. */
function trkptXml(point) {
  const parts = [
    `      <trkpt lat="${point.lat}" lon="${point.lon}">`,
  ];
  if (point.ele != null) parts.push(`        <ele>${point.ele}</ele>`);
  if (point.time != null) parts.push(`        <time>${new Date(point.time).toISOString()}</time>`);
  const extensions = [];
  if (point.temp != null || point.hr != null || point.cad != null || point.power != null) {
    extensions.push('        <extensions>', `          <gpxtpx:TrackPointExtension xmlns:gpxtpx="${TPX_NS}">`);
    if (point.temp != null) extensions.push(`            <gpxtpx:atemp>${point.temp}</gpxtpx:atemp>`);
    if (point.hr != null) extensions.push(`            <gpxtpx:hr>${point.hr}</gpxtpx:hr>`);
    if (point.cad != null) extensions.push(`            <gpxtpx:cad>${point.cad}</gpxtpx:cad>`);
    if (point.power != null) extensions.push(`            <gpxtpx:power>${point.power}</gpxtpx:power>`);
    extensions.push('          </gpxtpx:TrackPointExtension>', '        </extensions>');
  }
  parts.push(...extensions, '      </trkpt>');
  return parts.join('\n');
}

/**
 * Builds the .gpx export: the real track points between the two sector
 * handles, in GPX 1.1 track form with the sensor extensions preserved, plus
 * a fixed-English machine <metadata> block (source file, sector range).
 *
 * GPX values are machine data and stay in canonical form: lat/lon/ele and
 * sensor readings are the raw stored numbers (dot decimal) and time is ISO
 * 8601 — deliberately NOT routed through the locale-aware formatters, so a
 * future number-localized UI can never leak e.g. "4,89" into GPX output.
 * The metadata is fixed-English too (see metadataXml).
 *
 * @param {import('../types.js').Track} track
 * @param {{start:number, end:number}} range
 * @returns {string}
 */
export function buildGpxExport(track, range) {
  const pts = [];
  for (let i = 0; i < track.pointCount; i++) {
    const d = track.cumDist[i];
    if (d >= range.start - 1e-6 && d <= range.end + 1e-6) pts.push(track.points[i]);
  }
  const body = [
    XML_HEADER,
    `<gpx version="1.1" creator="WaySlice" xmlns="http://www.topografix.com/GPX/1/1">`,
    metadataXml(track, range),
    `  <trk>`,
    `    <name>${xmlEscape(track.name)}</name>`,
    `    <trkseg>`,
    ...pts.map(trkptXml),
    `    </trkseg>`,
    `  </trk>`,
    `</gpx>`,
  ];
  return body.join('\n') + '\n';
}

/**
 * WaySlice-YYYY-MM-DD-HH-MM-SS.<ext>, local time at the moment of export.
 * @param {string} ext
 * @returns {string}
 */
export function buildExportFilename(ext) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `WaySlice-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.${ext}`;
}

/**
 * Wires the header Export button: hidden until a track is loaded, opens the
 * format menu, downloads the current sector in the picked format.
 * @param {HTMLButtonElement} button
 */
export function initExport(button) {
  button.hidden = true;
  trackStore.subscribe((track) => {
    button.hidden = !track;
  });
  createMenu({
    button,
    panelClass: 'menu-panel-export',
    buildItems: () => [
      { kind: 'option', value: 'csv', label: t('exportCsv') },
      { kind: 'option', value: 'txt', label: t('exportTxt') },
      { kind: 'option', value: 'md', label: t('exportMd') },
      { kind: 'option', value: 'gpx', label: t('exportGpx') },
    ],
    onPick: (format) => exportAs(format),
  });
}

/** @private Builds and downloads the picked format for the current sector. */
function exportAs(format) {
  const track = trackStore.get();
  if (!track) return;
  const range = sectorStore.get();
  const metrics = computeSectorMetrics(track, range.start, range.end);
  let content;
  let mime;
  if (format === 'gpx') {
    content = buildGpxExport(track, range);
    mime = 'application/gpx+xml';
  } else if (format === 'md') {
    content = buildMdExport(track, metrics, range);
    mime = 'text/markdown';
  } else if (format === 'csv') {
    content = buildCsvExport(track, metrics, range);
    mime = 'text/csv';
  } else {
    content = buildTxtExport(track, metrics, range);
    mime = 'text/plain';
  }
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = buildExportFilename(format);
  a.click();
  URL.revokeObjectURL(url);
}
