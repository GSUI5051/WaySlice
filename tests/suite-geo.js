/** Geo + interpolation tests. */
import { suite, test, assert } from './runner.js';
import { haversine, segment3D } from '../js/geo/distance.js';
import { prepareTrack } from '../js/geo/track.js';
import { pointAtDistance, nearestOnTrack } from '../js/geo/interpolate.js';
import { simplify, simplifyForDisplay, thinStride } from '../js/geo/simplify.js';
import { eastTrack } from './helpers.js';

suite('geo / distance', () => {
  test('haversine: 1° of longitude at the equator ≈ 111,194.9 m', () => {
    assert.closeTo(haversine(0, 0, 0, 1), 111194.93, 0.5);
  });

  test('haversine: 1° of latitude ≈ 111,194.9 m', () => {
    assert.closeTo(haversine(0, 0, 1, 0), 111194.93, 0.5);
  });

  test('haversine: symmetric, zero for identical points', () => {
    assert.equal(haversine(10, 20, 30, 40), haversine(30, 40, 10, 20));
    assert.equal(haversine(47.2, 11.3, 47.2, 11.3), 0);
  });

  test('3D segment: sqrt(30² + 40²) = 50', () => {
    assert.equal(segment3D(30, 40), 50);
    assert.equal(segment3D(3, -4), 5);
  });
});

suite('geo / track preparation', () => {
  test('cumulative distance + totals', () => {
    const track = prepareTrack(eastTrack({ count: 101 }), 't');
    assert.closeTo(track.totalDistance, 100 * 111.1949, 1);
    assert.equal(track.cumDist[0], 0);
    assert.closeTo(track.cumDist[1], 111.1949, 0.5);
    assert.equal(track.pointCount, 101);
  });

  test('bounds cover all points', () => {
    const track = prepareTrack(eastTrack({ count: 5 }), 't');
    assert.equal(track.bounds.minLat, 0);
    assert.equal(track.bounds.maxLat, 0);
    assert.closeTo(track.bounds.maxLon, 0.004, 1e-9);
  });

  test('elevation availability flags (strict)', () => {
    const full = prepareTrack(eastTrack({ count: 3, ele: (i) => i * 10 }), 'a');
    assert.equal(full.hasElevation, true);
    const partial = prepareTrack(eastTrack({ count: 3, ele: (i) => (i === 1 ? null : i) }), 'b');
    assert.equal(partial.hasElevation, false);
    assert.equal(partial.eleMin, null);
  });

  test('timestamp availability flags (strict)', () => {
    const full = prepareTrack(eastTrack({ count: 3, time: (i) => i * 1000 }), 'a');
    assert.equal(full.hasTime, true);
    const partial = prepareTrack(eastTrack({ count: 3, time: (i) => (i === 2 ? null : i) }), 'b');
    assert.equal(partial.hasTime, false);
  });

  test('duplicated / zero-distance points do not break anything', () => {
    const pts = eastTrack({ count: 5 });
    pts.splice(3, 0, { ...pts[2] }); // exact duplicate
    const track = prepareTrack(pts, 't');
    assert.equal(track.pointCount, 6);
    assert.closeTo(track.totalDistance, 4 * 111.1949, 1);
  });

  test('negative elevations are preserved', () => {
    const track = prepareTrack(eastTrack({ count: 5, ele: (i) => -50 + i * 10 }), 't');
    assert.equal(track.eleMin, -50);
    assert.equal(track.eleMax, -10);
  });
});

suite('geo / interpolation', () => {
  test('pointAtDistance interpolates position, elevation and time', () => {
    const track = prepareTrack(eastTrack({
      count: 2,
      lonStep: 1, // midpoint at 0.5°
      ele: (i) => i * 100,
      time: (i) => 1000000 + i * 100000,
    }), 't');
    const mid = pointAtDistance(track, track.totalDistance / 2);
    assert.closeTo(mid.lat, 0, 1e-9);
    assert.closeTo(mid.lon, 0.5, 1e-6);
    assert.closeTo(mid.ele, 50, 1e-6);
    assert.equal(mid.time, 1050000);
  });

  test('pointAtDistance clamps out-of-range distances', () => {
    const track = prepareTrack(eastTrack({ count: 3, ele: (i) => i }), 't');
    assert.equal(pointAtDistance(track, -5).dist, 0);
    assert.equal(pointAtDistance(track, 1e9).dist, track.totalDistance);
  });

  test('nearestOnTrack snaps onto the polyline (not just the nearest vertex)', () => {
    const track = prepareTrack(eastTrack({ count: 2 }), 't');
    const near = nearestOnTrack(track, 0.0002, 0.0002, null); // off the equator
    assert.closeTo(near.lat, 0, 1e-9);                        // projected back onto the track
    assert.closeTo(near.lon, 0.0002, 1e-9);
    assert.closeTo(near.dist, 0.2 * track.totalDistance, 1);
  });

  test('nearestOnTrack uses the hint window without losing accuracy', () => {
    const track = prepareTrack(eastTrack({ count: 200 }), 't');
    const hint = 100;
    const near = nearestOnTrack(track, 0, track.points[120].lon, hint);
    assert.truthy(near.i === 119 || near.i === 120,
      `expected the segment around point 120, got i=${near.i}`);
    assert.closeTo(near.dist, track.cumDist[120], 0.5);
  });
});

suite('geo / waypoint resolution', () => {
  // A straight east-west track on the equator: 0.0001° of latitude is
  // ~11.12 m, so the "near" waypoints sit 22.2 m off the line and the far
  // one 1.1 km off.
  const count = 11; // 0..1° of longitude, ~1111.9 m total
  const eqTrack = () => eastTrack({ count });

  test('waypoints resolve to their on-track distance, ordered along the track', () => {
    const wpts = [
      { lat: 0.0002, lon: 0.0009, name: 'Late' },   // file order reversed…
      { lat: 0.0002, lon: 0.0002, name: 'Early' },  // …but track order fixes it
      { lat: 0.01, lon: 0.0005, name: 'Far' },      // ~1112 m off, must drop
    ];
    const { waypoints } = prepareTrack(eqTrack(), 't', wpts);
    assert.equal(waypoints.length, 2);
    assert.equal(waypoints[0].name, 'Early');
    assert.closeTo(waypoints[0].dist, 0.0002 * 111194.9, 0.5);
    assert.closeTo(waypoints[0].offTrack, 0.0002 * 111194.9, 0.5);
    assert.equal(waypoints[1].name, 'Late');
    assert.closeTo(waypoints[1].dist, 0.0009 * 111194.9, 0.5);
  });

  test('the 50 m rule keeps nearby waypoints and drops the rest', () => {
    const kept = prepareTrack(eqTrack(), 't', [
      { lat: 0.0004, lon: 0.0005, name: 'On' },     // 44.5 m off the line
    ]).waypoints;
    assert.equal(kept.length, 1);
    assert.closeTo(kept[0].offTrack, 44.478, 0.5);
    const dropped = prepareTrack(eqTrack(), 't', [
      { lat: 0.0005, lon: 0.0015, name: 'Off' },    // 55.6 m off the line
    ]).waypoints;
    assert.equal(dropped.length, 0);
  });

  test('a waypoint exactly on the track reports zero offset', () => {
    const { waypoints } = prepareTrack(eqTrack(), 't', [
      { lat: 0, lon: 0.003, name: 'Mid' },
    ]);
    assert.equal(waypoints.length, 1);
    assert.closeTo(waypoints[0].dist, 3 * 111.1949, 0.5);
    assert.closeTo(waypoints[0].offTrack, 0, 1e-6);
  });
});

suite('geo / display simplification', () => {
  test('Douglas–Peucker keeps shape within tolerance and below the cap', () => {
    const pts = eastTrack({ count: 5000 });
    const capped = simplifyForDisplay(pts, 1000);
    assert.truthy(capped.length <= 1000, `expected ≤ 1000 points, got ${capped.length}`);
    assert.equal(capped[0], pts[0]);
    assert.equal(capped[capped.length - 1], pts[pts.length - 1]);
  });

  test('simplify drops collinear interior points', () => {
    const pts = eastTrack({ count: 4 });
    assert.equal(simplify(pts, 1).length, 2);
  });

  test('thinStride caps size and keeps the last point', () => {
    const pts = eastTrack({ count: 3000 });
    const out = thinStride(pts, 100);
    assert.truthy(out.length <= 101);
    assert.equal(out[out.length - 1], pts[pts.length - 1]);
  });
});
