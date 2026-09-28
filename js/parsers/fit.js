/**
 * FIT parser — Garmin's Flexible and Interoperable Data Transfer binary
 * format. Decoding is delegated to the vendored fit-parser toolkit
 * (vendor/fit-parser/, MIT; see its VENDOR-NOTE.md for output semantics);
 * this module maps its record messages onto the same TrackPoint array the
 * GPX/KML parsers produce.
 *
 * One shape difference against the raw records is normalized here:
 *  - Modern devices write altitude/speed into the enhanced_* fields; the
 *    plain fields are preferred when present, with the enhanced value as
 *    fallback (Suunto/COROS write plain, Garmin writes enhanced). The flat
 *    records[] are consumed in file order; laps[] metadata is not used.
 */
import FitParser from '../../vendor/fit-parser/fit-parser.js';
import { ParseError, PARSE_ERROR_KEYS } from './parseError.js';
import { fillElevationGaps } from './eleGaps.js';

/** @type {FitParser | null}  Lazy singleton — the instance holds no per-file state. */
let fitParser = null;

function getParser() {
  if (!fitParser) {
    fitParser = new FitParser({
      force: true, // damaged files: recover what is readable instead of bailing
      speedUnit: 'm/s',
      lengthUnit: 'm',
      temperatureUnit: 'celsius',
    });
  }
  return fitParser;
}

/**
 * @param {ArrayBuffer} buffer  raw FIT bytes
 * @returns {Promise<import('../types.js').ParsedFile>}
 */
export async function parseFIT(buffer) {
  let fit;
  try {
    fit = await getParser().parseAsync(buffer);
  } catch (message) {
    // parseAsync rejects with an error string, not an Error instance
    throw new ParseError(PARSE_ERROR_KEYS.invalid, `fit-parser: ${message ?? 'unreadable file'}`);
  }
  const records = fit?.records ?? [];
  if (!records.length) throw new ParseError(PARSE_ERROR_KEYS.noTrack, 'fit-parser: no record messages');

  const points = [];
  for (const rec of records) {
    const p = readRecord(rec);
    if (p) points.push(p);
  }
  if (!points.length) {
    throw new ParseError(PARSE_ERROR_KEYS.noTrack, 'fit-parser: no record with a position');
  }
  fillElevationGaps(points);
  return { points, waypoints: [] };
}

/**
 * @private Maps one fit-parser record to a TrackPoint; records without a
 * usable position (common at FIT session starts) are dropped, like GPX does
 * for malformed points.
 */
function readRecord(rec) {
  const lat = rec.position_lat;
  const lon = rec.position_long;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  return {
    lat,
    lon,
    ele: numberOrNull(rec.altitude ?? rec.enhanced_altitude),
    time: timeOrNull(rec.timestamp),
    hr: numberOrNull(rec.heart_rate),
    cad: numberOrNull(rec.cadence),
    power: numberOrNull(rec.power),
    temp: numberOrNull(rec.temperature),
    speed: numberOrNull(rec.speed ?? rec.enhanced_speed),
  };
}

/** @private fit-parser gives Date instances for timestamps. */
function timeOrNull(value) {
  if (value == null) return null;
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/** @private */
function numberOrNull(value) {
  if (value == null) return null;
  return Number.isFinite(value) ? value : null;
}
