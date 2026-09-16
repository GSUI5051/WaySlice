/**
 * TCX parser — Garmin's Training Center XML (TrainingCenterDatabase >
 * Activities > Activity > Lap > Track > Trackpoint). Pure DOM walk, same
 * technique as gpx.js: no vendor toolkit and no namespace-prefix assumptions
 * — every lookup goes through getElementsByTagNameNS('*', localName), which
 * matches any prefix (ns3, TPX, up2, none …).
 *
 * Corpus behaviors mirrored here (see sample/Routes/** and sample/*.tcx):
 *  - All activities / laps / tracks concatenate in document order; the lap
 *    index is recorded per point.
 *  - Trackpoints without a Position (session starts, 28 in the largest
 *    sample) are dropped, like malformed GPX points.
 *  - Cadence: the TCX core <Cadence> wins; the running-specific TPX
 *    <RunCadence> fills in only when core is absent (values are copied
 *    verbatim — cadence normalization is a display concern).
 *  - Per-point sensors (HeartRateBpm/Value, TPX Watts/Speed/RunCadence) are
 *    read in place at their own node — no order-based realignment. A missing
 *    sensor (no HR strap) yields null, never a fabricated value; 0 W is a
 *    real reading and survives.
 *  - Short altitude gaps are bridged by interpolation (eleGaps.js).
 *  - TCX carries no waypoints; the array is empty, matching the FIT path.
 */
import { ParseError, PARSE_ERROR_KEYS } from './parseError.js';
import { fillElevationGaps, numberFromText } from './eleGaps.js';
import { parseXmlDocument } from './xmlDocument.js';

/**
 * @param {ArrayBuffer} buffer  raw TCX bytes (UTF-8 XML)
 * @returns {Promise<import('../types.js').ParsedFile>}
 */
export function parseTCX(buffer) {
  const text = new TextDecoder('utf-8').decode(buffer);
  const doc = parseXmlDocument(text);
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new ParseError(PARSE_ERROR_KEYS.invalid, 'XML parsererror');
  }
  const root = doc.documentElement;
  if (root.localName !== 'TrainingCenterDatabase') {
    throw new ParseError(PARSE_ERROR_KEYS.unsupported, `no <TrainingCenterDatabase> root (got <${root.localName}>)`);
  }

  const activities = root.getElementsByTagNameNS('*', 'Activity');
  if (!activities.length) {
    throw new ParseError(PARSE_ERROR_KEYS.noTrack, 'no <Activity> in TCX');
  }

  const points = [];
  let lapIndex = 0;
  for (const lap of root.getElementsByTagNameNS('*', 'Lap')) {
    for (const track of lap.getElementsByTagNameNS('*', 'Track')) {
      for (const tp of track.getElementsByTagNameNS('*', 'Trackpoint')) {
        const point = readTrackpoint(tp, lapIndex);
        if (point) points.push(point);
      }
    }
    lapIndex++;
  }

  fillElevationGaps(points);
  return Promise.resolve({ points, waypoints: [] });
}

/**
 * @private Maps one Trackpoint to a TrackPoint; entries without a Position
 * are dropped (FIT session starts and the corpus behave the same way).
 */
function readTrackpoint(tp, lapIndex) {
  const position = first(tp, 'Position');
  const lat = position ? childNumber(position, 'LatitudeDegrees') : NaN;
  const lon = position ? childNumber(position, 'LongitudeDegrees') : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const point = {
    lat,
    lon,
    ele: childNumber(tp, 'AltitudeMeters'),
    time: timeOrNull(first(tp, 'Time')?.textContent ?? null),
    hr: null, cad: null, power: null, temp: null, speed: null, distance: null,
    lap: lapIndex,
  };

  const heartRate = first(tp, 'HeartRateBpm');
  if (heartRate) point.hr = childNumber(heartRate, 'Value');
  const cadence = childNumber(tp, 'Cadence');
  if (cadence != null) point.cad = cadence;
  point.distance = childNumber(tp, 'DistanceMeters');

  const extensions = first(tp, 'Extensions');
  if (extensions) {
    const watts = first(extensions, 'Watts');
    if (watts) point.power = childNumber(extensions, 'Watts');
    const speed = first(extensions, 'Speed');
    if (speed) point.speed = childNumber(extensions, 'Speed');
    const runCadence = first(extensions, 'RunCadence');
    if (runCadence && point.cad == null) point.cad = childNumber(extensions, 'RunCadence');
  }
  return point;
}

/** @private First descendant with the given localName, any namespace. */
function first(el, localName) {
  return el.getElementsByTagNameNS('*', localName)[0] ?? null;
}

/** @private Text of the first descendant localName as a finite number. */
function childNumber(el, localName) {
  return numberFromText(first(el, localName));
}

/** @private ISO 8601 / RFC 3339 text → unix ms, null when unparsable. */
function timeOrNull(text) {
  if (text == null) return null;
  const t = Date.parse(text.trim());
  return Number.isFinite(t) ? t : null;
}
