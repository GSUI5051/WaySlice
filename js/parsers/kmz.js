/**
 * KMZ parser — a KMZ is a ZIP archive containing a KML document (usually
 * `doc.kml`). Instead of pulling in a ZIP library, this implements the small
 * subset of the ZIP format needed to read one stored/deflated entry:
 *
 *   End of Central Directory → Central Directory entries → Local File Header
 *
 * Deflate decompression uses the browser-native DecompressionStream API
 * (Chrome 103+, Firefox 113+, Safari 16.4+), keeping the app dependency-free.
 */
import { ParseError, PARSE_ERROR_KEYS } from './parseError.js';
import { parseKML } from './kml.js';

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

/**
 * @param {ArrayBuffer} buffer  raw KMZ bytes
 * @returns {Promise<import('../types.js').ParsedFile>}
 */
export async function parseKMZ(buffer) {
  const kmlText = await extractKmlText(buffer);
  return parseKML(kmlText);
}

/** @private Extracts and decodes the first KML entry from the archive. */
async function extractKmlText(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // Locate the End of Central Directory record (scan back over the comment).
  let eocd = -1;
  const scanFrom = Math.max(0, bytes.length - 66 - 65535);
  for (let i = bytes.length - 22; i >= scanFrom; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new ParseError(PARSE_ERROR_KEYS.invalid, 'KMZ: no EOCD record');

  const entryCount = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);

  let best = null; // { name, method, compSize, localOffset }
  let offset = cdOffset;
  for (let idx = 0; idx < entryCount; idx++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== SIG_CENTRAL) break;
    const method = view.getUint16(offset + 10, true);
    const compSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    if (/\.kml$/i.test(name)) {
      const isDoc = /(^|\/)doc\.kml$/i.test(name);
      if (!best || (isDoc && !best.isDoc)) best = { name, method, compSize, localOffset, isDoc };
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  if (!best) throw new ParseError(PARSE_ERROR_KEYS.kmzNoKml);

  // Read the local file header to find where the data actually starts
  // (extra field lengths may differ between central and local headers).
  const lo = best.localOffset;
  if (lo + 30 > bytes.length || view.getUint32(lo, true) !== SIG_LOCAL) {
    throw new ParseError(PARSE_ERROR_KEYS.invalid, 'KMZ: bad local header');
  }
  const localNameLen = view.getUint16(lo + 26, true);
  const localExtraLen = view.getUint16(lo + 28, true);
  const dataStart = lo + 30 + localNameLen + localExtraLen;
  const compressed = bytes.subarray(dataStart, dataStart + best.compSize);

  let kmlBytes;
  if (best.method === 0) {
    kmlBytes = compressed;
  } else if (best.method === 8) {
    if (typeof DecompressionStream !== 'function') {
      throw new ParseError(PARSE_ERROR_KEYS.unsupported, 'KMZ: DecompressionStream unavailable');
    }
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    kmlBytes = new Uint8Array(await new Response(stream).arrayBuffer());
  } else {
    throw new ParseError(PARSE_ERROR_KEYS.unsupported, `KMZ: compression method ${best.method}`);
  }
  return new TextDecoder('utf-8').decode(kmlBytes);
}
