/**
 * Auto segmentation — splits a track into consecutive distance ranges.
 *
 * Pure functions, no DOM: the segmenter returns plain [{start, end}] ranges
 * in meters along the track, ready for computeSectorMetrics() and
 * sectorStore.setRange(). Two strategies:
 *  - splitByLength: equal-length slices (1 km, 5 km, custom length)
 *  - splitByGrade:  climb / descent / flat stretches from the window-smoothed
 *    gradient, with short transitions merged into their predecessor
 */
import { nearestOnTrack } from '../geo/interpolate.js';
import { GRADIENT_WINDOW_M } from './sectorMetrics.js';

/** A segment shorter than this is not worth its own row, meters. */
const MIN_SEGMENT_M = 200;

/** Grade above/below which a window counts as climb / descent (fraction). */
const GRADE_SPLIT_THRESHOLD = 0.025;

/** Merging floor for grade segments, meters — shorter ones fold backwards. */
const GRADE_MIN_SEGMENT_M = 400;

/** Waypoint boundaries closer than this fold away instead of making sliver
 *  segments, meters. */
const WAYPOINT_MIN_SPACING_M = 100;

/** Relief below which a segment reads as flat, meters. */
const TYPE_FLAT_RELIEF_M = 5;

/** Share of relief (gain or loss) that decides the type outright. */
const TYPE_DOMINANT_SHARE = 0.65;

/** Weak dominance: one side must exceed the other by this factor. */
const TYPE_DOMINANT_FACTOR = 1.4;

/**
 * Splits [0, total] into consecutive slices of `length` meters. A trailing
 * remainder shorter than MIN_SEGMENT_M folds into the last full slice.
 *
 * @param {number} total    track length, meters
 * @param {number} length   slice length, meters (> 0)
 * @returns {{start:number, end:number}[]}
 */
export function splitByLength(total, length) {
  if (!(total > 0) || !(length > 0)) return [];
  const ranges = [];
  for (let s = 0; s < total - MIN_SEGMENT_M; s += length) {
    ranges.push({ start: s, end: Math.min(s + length, total) });
  }
  if (!ranges.length) ranges.push({ start: 0, end: total });
  return ranges;
}

/**
 * Splits the track into climb / descent / flat stretches. The gradient at
 * each point comes from the elevation difference across a ±GRADIENT_WINDOW_M/2
 * window (same smoothing scale as the profile's gradient readout), classified
 * at ±GRADE_SPLIT_THRESHOLD; runs shorter than GRADE_MIN_SEGMENT_M merge into
 * their predecessor so switchback noise does not shred the list.
 *
 * @param {import('../types.js').Track} track
 * @returns {{start:number, end:number}[]|null} null without elevation data
 */
export function splitByGrade(track) {
  if (!track.hasElevation) return null;
  const { points, cumDist, totalDistance } = track;
  const n = points.length;
  if (n < 2) return null;

  const half = GRADIENT_WINDOW_M / 2;
  const cls = new Array(n).fill(0);
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < n; i++) {
    const d = cumDist[i];
    while (lo < i && cumDist[lo] < d - half) lo++;
    if (hi < i) hi = i;
    while (hi + 1 < n && cumDist[hi + 1] <= d + half) hi++;
    const span = cumDist[hi] - cumDist[lo];
    const eleA = points[lo].ele;
    const eleB = points[hi].ele;
    if (span >= half && eleA != null && eleB != null) {
      const grade = (eleB - eleA) / span;
      cls[i] = grade > GRADE_SPLIT_THRESHOLD ? 1 : grade < -GRADE_SPLIT_THRESHOLD ? -1 : 0;
    }
  }

  // Run-length encode the classes, anchored to the exact track ends.
  const runs = [];
  for (let i = 0; i < n; i++) {
    if (i === 0 || cls[i] !== cls[i - 1]) runs.push({ start: cumDist[i], end: cumDist[i], cls: cls[i] });
    runs[runs.length - 1].end = cumDist[i];
  }
  if (!runs.length) return null;
  runs[0].start = 0;
  runs[runs.length - 1].end = totalDistance;
  return consolidate(runs, GRADE_MIN_SEGMENT_M);
}

/**
 * Splits the track at its waypoints — the CP-to-CP table. Each waypoint is
 * resolved to its nearest distance along the track (file order primes the
 * search, same as the profile's waypoint placement); a boundary closer than
 * WAYPOINT_MIN_SPACING_M to the previous one or to either track end folds
 * away instead of producing a sliver segment. `name` carries the waypoint
 * name at each segment's start boundary (null for the track start) so the
 * list can title rows after real places.
 *
 * @param {import('../types.js').Track} track
 * @returns {{start:number, end:number, name:string|null}[]|null} null when
 *   the track has no waypoints (or every boundary folded away)
 */
export function splitByWaypoints(track) {
  const wpts = track.waypoints || [];
  if (!wpts.length) return null;
  const total = track.totalDistance;
  let hint = 0;
  const bounds = [{ dist: 0, name: null }];
  for (const w of wpts) {
    const near = nearestOnTrack(track, w.lat, w.lon, hint);
    hint = near.i;
    const prev = bounds[bounds.length - 1];
    if (near.dist - prev.dist >= WAYPOINT_MIN_SPACING_M && total - near.dist >= WAYPOINT_MIN_SPACING_M) {
      bounds.push({ dist: near.dist, name: w.name || null });
    }
  }
  bounds.push({ dist: total, name: null });
  if (bounds.length < 3) return null;
  const ranges = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    ranges.push({ start: bounds[i].dist, end: bounds[i + 1].dist, name: bounds[i].name });
  }
  return ranges;
}

/**
 * Classifies a stretch from its elevation totals — the type capsule shown
 * per row in the segment list. gain/loss are the hysteresis-filtered
 * totals, net the honest end-to-end elevation change, exactly as
 * computeSectorMetrics reports them.
 *
 * Decision cascade: relief under 5 m is noise, so the stretch reads flat;
 * an outright dominant side (≥ 65% of relief, net agreeing) is a climb or
 * descent; the weakly dominant band is settled by the 1.4× fallbacks (one
 * side clearly heavier, net on its side); what remains is rolling terrain —
 * both directions carry more than 30% of the relief, or the net change is
 * small against a large relief — and reads mixed.
 *
 * @param {number|null} gain  filtered ascent, meters
 * @param {number|null} loss  filtered descent, meters (positive)
 * @param {number|null} net   end − start elevation, meters
 * @returns {'climb'|'descent'|'flat'|'mixed'|null} null without elevation
 */
export function segmentType(gain, loss, net) {
  if (gain == null || loss == null || net == null) return null;
  const relief = gain + loss;
  if (relief < TYPE_FLAT_RELIEF_M) return 'flat';
  if (net > 0 && gain / relief >= TYPE_DOMINANT_SHARE) return 'climb';
  if (net < 0 && loss / relief >= TYPE_DOMINANT_SHARE) return 'descent';
  if (gain > loss * TYPE_DOMINANT_FACTOR && net > 0) return 'climb';
  if (loss > gain * TYPE_DOMINANT_FACTOR && net < 0) return 'descent';
  return 'mixed';
}

/**
 * @private Folds short runs away until every stretch reaches `minLen`: the
 * shortest run is absorbed into its LONGER neighbor (prev/next), same-class
 * neighbors coalesce, repeat. A naive "merge backwards" pass would let
 * threshold-flutter chains swallow everything into the first run — the
 * dominant class has to win, whichever side it is on.
 */
function consolidate(runs, minLen) {
  let list = coalesce(runs);
  while (list.length > 1) {
    let shortest = 0;
    for (let i = 1; i < list.length; i++) {
      if (len(list[i]) < len(list[shortest])) shortest = i;
    }
    if (len(list[shortest]) >= minLen) break;
    const prevN = list[shortest - 1];
    const nextN = list[shortest + 1];
    if (!prevN) nextN.start = list[shortest].start;
    else if (!nextN) prevN.end = list[shortest].end;
    else if (len(prevN) >= len(nextN)) prevN.end = list[shortest].end;
    else nextN.start = list[shortest].start;
    list.splice(shortest, 1);
    list = coalesce(list);
  }
  return list.map(({ start, end }) => ({ start, end }));

  function coalesce(list2) {
    const out = [];
    for (const r of list2) {
      const prev = out[out.length - 1];
      if (prev && prev.cls === r.cls) prev.end = r.end;
      else out.push({ ...r });
    }
    return out;
  }

  function len(r) {
    return r.end - r.start;
  }
}
