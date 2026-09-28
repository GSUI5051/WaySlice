/**
 * GPX 1.0/1.1 parser — <trk><trkseg><trkpt> track points plus root-level
 * <wpt> waypoints (routes remain out of scope; see roadmap).
 *
 * Extensions are read namespace-agnostically via localName so the common
 * Garmin TrackPointExtension (hr / cad / atemp) and the Garmin Power
 * extension work regardless of namespace prefixes.
 */
import { ParseError, PARSE_ERROR_KEYS } from './parseError.js';
import { parseXmlDocument } from './xmlDocument.js';
import { numberFromText, timeOrNull } from './eleGaps.js';

/**
 * @param {string} text  GPX document text
 * @returns {import('../types.js').ParsedFile} points + waypoints
 */
export function parseGPX(text) {
  const doc = parseXmlDocument(text);
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new ParseError(PARSE_ERROR_KEYS.invalid, 'XML parsererror');
  }
  if (!doc.getElementsByTagName('gpx').length) {
    throw new ParseError(PARSE_ERROR_KEYS.unsupported, 'no <gpx> root');
  }

  /** @type {import('../types.js').TrackPoint[]} */
  const points = [];
  const segments = doc.getElementsByTagName('trkseg');
  for (const seg of segments) {
    for (const pt of seg.getElementsByTagName('trkpt')) {
      const p = readPoint(pt);
      if (p) points.push(p);
    }
  }

  /** @type {import('../types.js').Waypoint[]} */
  const waypoints = [];
  // <wpt> only appears at the GPX root, so a doc-wide lookup is safe
  // (track points are <trkpt>, route points <rtept>).
  for (const wpt of doc.getElementsByTagName('wpt')) {
    const w = readWaypoint(wpt);
    if (w) waypoints.push(w);
  }

  return { points, waypoints };
}

/** @private */
function readPoint(pt) {
  const lat = Number(pt.getAttribute('lat'));
  const lon = Number(pt.getAttribute('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  /** @type {import('../types.js').TrackPoint} */
  const point = {
    lat,
    lon,
    ele: numberFromText(firstChild(pt, 'ele')),
    time: timeOrNull(firstChildText(pt, 'time')),
    hr: null, cad: null, power: null, temp: null,
    // GPX 1.1 carries <speed> (m/s) as a CORE trkpt child — gpx.studio and
    // GPSBabel exports rely on it; extensions' ns3:Speed overrides below.
    speed: numberFromText(firstChild(pt, 'speed')),
    distance: null, lap: null,
  };

  const extensions = pt.getElementsByTagName('extensions');
  if (extensions.length) {
    const hr = extensions[0].getElementsByTagNameNS('*', 'hr');
    const cad = extensions[0].getElementsByTagNameNS('*', 'cad');
    const atemp = extensions[0].getElementsByTagNameNS('*', 'atemp');
    const power = extensions[0].getElementsByTagNameNS('*', 'power');
    const speed = extensions[0].getElementsByTagNameNS('*', 'speed');
    if (hr.length) point.hr = numberFromText(hr[0]);
    if (cad.length) point.cad = numberFromText(cad[0]);
    if (atemp.length) point.temp = numberFromText(atemp[0]);
    if (power.length) {
      point.power = numberFromText(power[0]);
    } else {
      // Two more real-world encodings, both with localNames case-different
      // from 'power' (invisible to the lookup above): the Stages-style
      // <gpxpx:PowerInWatts> and the Garmin-Connect/tapiriik <ns3:Watts>.
      let watts = extensions[0].getElementsByTagNameNS('*', 'PowerInWatts');
      if (!watts.length) watts = extensions[0].getElementsByTagNameNS('*', 'Watts');
      if (watts.length) point.power = numberFromText(watts[0]);
    }
    if (speed.length) point.speed = numberFromText(speed[0]);
    // TrackPointExtension v2's cumulative <ns3:distance> (meters) — pairs
    // with speed the same way the TCX DistanceMeters field does.
    const distance = extensions[0].getElementsByTagNameNS('*', 'distance');
    if (distance.length) point.distance = numberFromText(distance[0]);
  }
  return point;
}

/** @private */
function readWaypoint(wpt) {
  const lat = Number(wpt.getAttribute('lat'));
  const lon = Number(wpt.getAttribute('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const name = (firstChildText(wpt, 'name') || '').trim();
  return {
    lat,
    lon,
    ele: numberFromText(firstChild(wpt, 'ele')),
    time: timeOrNull(firstChildText(wpt, 'time')),
    name: name || null,
  };
}

/** @private */
function firstChild(el, localName) {
  for (const child of el.children) {
    if (child.localName === localName) return child;
  }
  return null;
}

/** @private */
function firstChildText(el, localName) {
  return firstChild(el, localName)?.textContent ?? null;
}
