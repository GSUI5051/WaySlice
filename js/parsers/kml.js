/**
 * KML parser — supports <LineString><coordinates>, <gx:Track> (with <when>
 * timestamps), any nesting via <MultiGeometry>, and <Point> placemarks as
 * waypoints (approach ported from TrailScope's parser).
 *
 * Coordinate formats differ per element and must not be mixed:
 * - <coordinates>: comma-separated triples "lon,lat[,ele]" separated by whitespace
 * - <gx:coord>:    space-separated triple "lon lat ele" per element
 *
 * A <Placemark> that carries a <Point> is a waypoint annotation: it never
 * contributes track points. Naming falls back name → stripped description.
 */
import { ParseError, PARSE_ERROR_KEYS } from './parseError.js';
import { parseXmlDocument } from './xmlDocument.js';

/**
 * @param {string} text  KML document text
 * @returns {import('../types.js').ParsedFile}
 */
export function parseKML(text) {
  let doc;
  try {
    doc = parseXmlDocument(text);
  } catch (err) {
    throw new ParseError(PARSE_ERROR_KEYS.invalid, String(err));
  }
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new ParseError(PARSE_ERROR_KEYS.invalid, 'XML parsererror');
  }
  if (!doc.getElementsByTagName('kml').length) {
    throw new ParseError(PARSE_ERROR_KEYS.unsupported, 'no <kml> root');
  }

  /** @type {import('../types.js').TrackPoint[]} */
  const points = [];

  for (const ls of doc.getElementsByTagName('LineString')) {
    for (const coords of ls.getElementsByTagName('coordinates')) {
      pushCoordinateList(points, coords.textContent);
    }
  }

  for (const track of doc.getElementsByTagNameNS('*', 'Track')) {
    const coords = track.getElementsByTagNameNS('*', 'coord');
    const whens = track.getElementsByTagName('when');
    for (let i = 0; i < coords.length; i++) {
      const time = i < whens.length ? timeOrNull(whens[i].textContent) : null;
      // gx:coord is a single space-separated "lon lat [ele]" triple.
      const parts = coords[i].textContent.trim().split(/\s+/).map(Number);
      pushPoint(points, parts[1], parts[0], parts[2], time);
    }
  }

  /** @type {import('../types.js').Waypoint[]} */
  const waypoints = [];
  for (const placemark of doc.getElementsByTagName('Placemark')) {
    const pointEls = placemark.getElementsByTagName('Point');
    if (!pointEls.length) continue;
    const coordsEls = pointEls[0].getElementsByTagName('coordinates');
    if (!coordsEls.length) continue;
    // Multiple tokens would mean a malformed <Point>; the first is the anchor.
    const token = coordsEls[0].textContent.trim().split(/\s+/)[0] || '';
    const [lonS, latS, eleS] = token.split(',');
    const lat = Number(latS);
    const lon = Number(lonS);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const name = (firstChildText(placemark, 'name') || '').trim();
    const desc = descriptionText(firstChildText(placemark, 'description') || '');
    waypoints.push({
      lat,
      lon,
      ele: eleS != null && eleS !== '' && Number.isFinite(Number(eleS)) ? Number(eleS) : null,
      time: null,
      name: name || desc || null,
    });
  }

  return { points, waypoints };
}

/**
 * Parses "lon,lat[,ele] lon,lat[,ele] …" coordinate text into points.
 * @private
 */
function pushCoordinateList(points, text) {
  for (const token of text.trim().split(/\s+/)) {
    if (!token) continue;
    const [lonS, latS, eleS] = token.split(',');
    const ele = eleS != null && eleS !== '' ? Number(eleS) : null;
    pushPoint(points, Number(latS), Number(lonS), ele, null);
  }
}

/** @private Validates and appends one track point. */
function pushPoint(points, lat, lon, ele, time) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  points.push({
    lat,
    lon,
    ele: Number.isFinite(ele) ? ele : null,
    time,
    hr: null, cad: null, power: null, temp: null,
    speed: null, distance: null, lap: null,
  });
}

/** @private First descendant element's text, or ''. */
function firstChildText(root, localName) {
  const el = root.getElementsByTagName(localName)[0];
  return el ? el.textContent : '';
}

/**
 * Placemarks often carry HTML in <description>; strip it to plain text for
 * use as a waypoint name fallback (ported from TrailScope).
 * @private
 */
function descriptionText(value) {
  const text = value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>(?=\S)/gi, ' ')
    .replace(/<\/p\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length > 140) return text.slice(0, 139).trimEnd() + '…';
  return text;
}

/** @private */
function timeOrNull(text) {
  if (text == null) return null;
  const t = Date.parse(text.trim());
  return Number.isFinite(t) ? t : null;
}
