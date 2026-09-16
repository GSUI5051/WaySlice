/**
 * Format detection and the unified parse entry point.
 * Every supported format funnels into the same TrackPoint array.
 *
 * Parser modules load lazily — one dynamic `import()` per parsed file, so a
 * format's code (for FIT, the whole vendor chain incl. the ~460 KB generated
 * Garmin message profile) is downloaded only by files that actually use it.
 * Detection itself needs no parser, only the error keys.
 */
import { ParseError, PARSE_ERROR_KEYS } from './parseError.js';

/** @typedef {'gpx'|'kml'|'kmz'|'fit'|'tcx'} TrackFormat */

/** Lazy loader per format — a format's cost is paid only by its own files. @private */
const PARSERS = {
  gpx: () => import('./gpx.js'),
  kml: () => import('./kml.js'),
  kmz: () => import('./kmz.js'),
  fit: () => import('./fit.js'),
  tcx: () => import('./tcx.js'),
};

/**
 * Detects the format from the file extension first, then from magic bytes /
 * document sniffing as a fallback (so a mislabeled file still opens).
 *
 * @param {string} filename
 * @param {ArrayBuffer} buffer
 * @returns {TrackFormat}
 */
export function detectFormat(filename, buffer) {
  const ext = (filename.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  if (ext === 'gpx' || ext === 'kml' || ext === 'kmz' || ext === 'fit' || ext === 'tcx') return ext;

  const bytes = new Uint8Array(buffer, 0, Math.min(16, buffer.byteLength));
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'kmz'; // "PK"
  // FIT: ".FIT" magic in header bytes 8..12 of every v1.0+ file
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(8, 12)) === '.FIT') return 'fit';
  const head = new TextDecoder('utf-8', { fatal: false })
    .decode(new Uint8Array(buffer, 0, Math.min(512, buffer.byteLength)))
    .toLowerCase();
  if (head.includes('<gpx')) return 'gpx';
  if (head.includes('<trainingcenterdatabase')) return 'tcx';
  if (head.includes('<kml')) return 'kml';
  throw new ParseError(PARSE_ERROR_KEYS.unsupported, `unknown extension ".${ext}"`);
}

/**
 * Parses any supported file into track points plus waypoints. Resolves the
 * format's parser module on demand — repeated parses reuse the module cache,
 * so the loader promise itself is not memoized here.
 *
 * @param {ArrayBuffer} buffer
 * @param {TrackFormat} format
 * @returns {Promise<import('../types.js').ParsedFile>}
 */
export async function parseTrackFile(buffer, format) {
  const load = PARSERS[format];
  if (!load) throw new ParseError(PARSE_ERROR_KEYS.unsupported, String(format));
  const parser = await load();
  switch (format) {
    case 'gpx': return parser.parseGPX(decodeText(buffer));
    case 'kml': return parser.parseKML(decodeText(buffer));
    case 'kmz': return parser.parseKMZ(buffer);
    case 'fit': return parser.parseFIT(buffer);
    case 'tcx': return parser.parseTCX(buffer);
    default: throw new ParseError(PARSE_ERROR_KEYS.unsupported, String(format));
  }
}

/** @private UTF-8 text decode with BOM handling. */
function decodeText(buffer) {
  return new TextDecoder('utf-8').decode(buffer);
}
