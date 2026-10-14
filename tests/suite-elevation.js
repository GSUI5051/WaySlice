/**
 * Elevation correction suites — DEM tile math, Terrarium decoding, bilinear
 * sampling, correction strategies, async/race behavior, and the metrics and
 * export integration. Every network path is injected: no test touches the
 * real tile service.
 */
import { suite, test, assert } from './runner.js';
import { eastTrack, prepared } from './helpers.js';
import {
  DEM_SOURCE, lonLatToTileFraction, buildSamples, tileKey,
  terrariumElevation, isValidElevation, sampleElevation,
} from '../js/elevation/terrain.js';
import { sampleElevations, CancelledError } from '../js/elevation/demSampler.js';
import {
  buildFillValues, buildReplaceValues, applyElevations, restoreElevations,
  runElevationFix, cancelElevationFix, restoreOriginalElevations,
} from '../js/elevation/elevationFix.js';
import { trackStore } from '../js/core/stores.js';
import { computeSectorMetrics, ELEVATION_THRESHOLD_M } from '../js/metrics/sectorMetrics.js';
import { buildGpxExport } from '../js/export/exporter.js';

const SIZE = DEM_SOURCE.tileSize;
const assertNotEqual = (a, b, msg) => assert(a !== b, msg);
const Z = DEM_SOURCE.zoom;

/* Fixtures ------------------------------------------------------------------ */

/** Terrarium inverse: elevation → RGB channels. */
function encodeTerrarium(ele) {
  const v = ele + 32768;
  const r = Math.floor(v / 256);
  const rem = v - r * 256;
  const g = Math.floor(rem);
  const b = Math.min(255, Math.round((rem - g) * 256));
  return [r, g, b];
}

/** A synthetic tile whose pixel (x, y) encodes fn(x, y) meters. */
function syntheticTile(fn) {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b] = encodeTerrarium(fn(x, y));
      const i = (y * SIZE + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { data, width: SIZE, height: SIZE };
}

/** lon/lat at a chosen pixel fraction inside tile (tx, ty) at the source zoom. */
function inTile(tx, fxFrac, ty, fyFrac) {
  const lon = ((tx + fxFrac) / 2 ** Z) * 360 - 180;
  const n = Math.PI * (1 - (2 * (ty + fyFrac)) / 2 ** Z);
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { lon, lat };
}

/** @private Runs fn with `track` loaded, restoring the previous track after. */
async function withStore(track, fn) {
  const previous = trackStore.get();
  trackStore.set(track);
  try {
    return await fn(track);
  } finally {
    trackStore.set(previous);
  }
}

/* 1. Coordinate → tile mapping -------------------------------------------------- */

suite('Elevation — tile coordinates', () => {
  test('origin maps to the center tile at every zoom', () => {
    const z12 = lonLatToTileFraction(0, 0, 12);
    assert.closeTo(z12.x, 2048, 1e-9, 'x fraction');
    assert.closeTo(z12.y, 2048, 1e-9, 'y fraction');
  });

  test('matches the standard slippy formulas (tilebelt reference)', () => {
    for (const [lon, lat, z] of [[8.5417, 47.3769, 12], [-73.9857, 40.7484, 12], [106.55, 29.56, 12]]) {
      const mine = lonLatToTileFraction(lon, lat, z);
      // @mapbox/tilebelt's pointToTileFraction, inlined as the reference.
      const sinLat = Math.sin((lat * Math.PI) / 180);
      const n = 2 ** z;
      const refX = n * (lon / 360 + 0.5);
      const refY = n * (0.5 - (0.25 * Math.log((1 + sinLat) / (1 - sinLat))) / Math.PI);
      assert.closeTo(mine.x, refX, 1e-7, 'x');
      assert.closeTo(mine.y, refY, 1e-7, 'y');
    }
  });

  test('boundaries: antimeridian wraps, west edge is tile 0', () => {
    assert.equal(Math.floor(lonLatToTileFraction(-180, 0, 12).x), 0, 'west edge');
    assert.equal(Math.floor(lonLatToTileFraction(180, 0, 12).x), 0, 'antimeridian wraps to the west edge');
    const north = lonLatToTileFraction(0, 85.0511287, 2);
    assert.equal(Math.floor(north.y), 0, 'north pole edge is row 0');
    const south = lonLatToTileFraction(0, -85.0511287, 2);
    assert.equal(Math.floor(south.y), 3, 'south pole edge is the last row');
  });

  test('invalid coordinates yield null, not a coerced tile', () => {
    assert.isNull(lonLatToTileFraction(0, 90, 12), 'north of the Mercator bound');
    assert.isNull(lonLatToTileFraction(0, -90, 12), 'south of the Mercator bound');
    assert.isNull(lonLatToTileFraction(NaN, 0, 12), 'NaN lon');
    assert.isNull(lonLatToTileFraction(0, Infinity, 12), 'infinite lat');
  });

  test('points in one tile dedupe to a single tile', () => {
    const a = inTile(2000, 0.30, 2000, 0.40);
    const b = inTile(2000, 0.32, 2000, 0.44);
    const c = inTile(2000, 0.48, 2000, 0.60);
    const { samples, tiles } = buildSamples([a, b, c]);
    assert.equal(tiles.length, 1, 'one unique tile for three nearby points');
    for (const s of samples) assert(s != null, 'every valid point has a sample');
    assert.equal(samples[0].tx, 2000);
    assert.equal(samples[0].ty, 2000);
  });

  test('a window crossing the last column adds the east tile', () => {
    const mid = inTile(1, 0.50, 1, 0.50);
    const edge = inTile(1, 511.5 / SIZE, 1, 0.50);
    const midSet = buildSamples([mid]);
    assert.equal(midSet.tiles.length, 1, 'mid-tile point needs no neighbour');
    const edgeSet = buildSamples([edge]);
    assert(edgeSet.samples[0].fx >= 511, 'edge point sits on the last pixel column');
    assert.equal(edgeSet.tiles.length, 2, 'the east neighbour joins the fetch set');
    assert.deepEqual(edgeSet.tiles.map((t) => t.x).sort((p, q) => p - q), [1, 2], 'tiles 1 and 2');
  });

  test('invalid points are unsampleable but do not break the batch', () => {
    const ok = inTile(5, 0.5, 5, 0.5);
    const { samples, tiles } = buildSamples([
      ok, { lon: NaN, lat: 0 }, { lon: 0, lat: 95 },
    ]);
    assert(samples[0] != null);
    assert.isNull(samples[1], 'NaN lon → no sample');
    assert.isNull(samples[2], 'polar lat → no sample');
    assert.equal(tiles.length, 1);
  });
});

/* 2. Terrarium decoding and validity -------------------------------------------- */

suite('Elevation — Terrarium decoding', () => {
  test('known channel triplets decode exactly', () => {
    assert.closeTo(terrariumElevation(128, 0, 0), 0, 1e-9, 'zero elevation is a legal value');
    assert.closeTo(terrariumElevation(0, 0, 0), -32768, 1e-9, 'nodata sentinel');
    assert.closeTo(terrariumElevation(255, 255, 255), 32767.99609375, 1e-4, 'maximum triplet');
    assert.closeTo(terrariumElevation(150, 37, 128), 150 * 256 + 37 + 0.5 - 32768, 1e-9, 'fractional B channel');
  });

  test('encode/decode round trip via synthetic pixels', () => {
    for (const ele of [-431, 0, 431, 8848, 1234.5]) {
      const [r, g, b] = encodeTerrarium(ele);
      assert.closeTo(terrariumElevation(r, g, b), ele, 1 / 256, `ele ${ele}`);
    }
  });

  test('validity window: 0 is valid, the sentinel is not', () => {
    assert.equal(isValidElevation(0), true, 'sea level must never read as missing');
    assert.equal(isValidElevation(-32768), false, 'nodata');
    assert.equal(isValidElevation(NaN), false, 'NaN');
    assert.equal(isValidElevation(12000), false, 'above the window');
  });
});

/* 3. Bilinear sampling ----------------------------------------------------------- */

suite('Elevation — bilinear sampling', () => {
  test('a flat tile samples flat everywhere', () => {
    const tiles = new Map([[tileKey(0, 0), syntheticTile(() => 500)]]);
    for (const [fx, fy] of [[0, 0], [511.9, 511.9], [256.25, 100.75], [0.1, 400]]) {
      const v = sampleElevation(tiles, { tx: 0, ty: 0, fx, fy });
      assert.closeTo(v, 500, 1e-6, `fx ${fx} fy ${fy}`);
    }
  });

  test('pixel centers read the pixel exactly; between pixels blends', () => {
    const tiles = new Map([[tileKey(0, 0), syntheticTile((x, y) => 1000 + x + 10 * y)]]);
    assert.closeTo(sampleElevation(tiles, { tx: 0, ty: 0, fx: 10, fy: 20 }), 1210, 1e-6, 'exact center');
    assert.closeTo(sampleElevation(tiles, { tx: 0, ty: 0, fx: 10.5, fy: 20 }), 1210.5, 1e-6, 'x midpoint');
    assert.closeTo(sampleElevation(tiles, { tx: 0, ty: 0, fx: 10, fy: 20.25 }), 1212.5, 1e-6, 'y quarter');
    assert.closeTo(sampleElevation(tiles, { tx: 0, ty: 0, fx: 10.5, fy: 20.5 }), 1215.5, 1e-6, 'both halves');
  });

  test('the four window corners agree with a hand-computed blend', () => {
    const tiles = new Map([[tileKey(0, 0), syntheticTile((x, y) => 2000 + 3 * x - 7 * y)]]);
    const v = sampleElevation(tiles, { tx: 0, ty: 0, fx: 100.25, fy: 50.75 });
    const p00 = 2000 + 3 * 100 - 7 * 50;
    const p10 = 2000 + 3 * 101 - 7 * 50;
    const p01 = 2000 + 3 * 100 - 7 * 51;
    const p11 = 2000 + 3 * 101 - 7 * 51;
    const expect = p00 * 0.75 * 0.25 + p10 * 0.25 * 0.25 + p01 * 0.75 * 0.75 + p11 * 0.25 * 0.75;
    assert.closeTo(v, expect, 1e-6);
  });

  test('crossing the last column reads the east tile, never wraps', () => {
    const west = syntheticTile(() => 1000);
    const east = syntheticTile(() => 2000);
    const both = new Map([[tileKey(0, 0), west], [tileKey(1, 0), east]]);
    const wrappedOnly = new Map([[tileKey(0, 0), west]]);
    const s = { tx: 0, ty: 0, fx: 511.5, fy: 100 };
    assert.closeTo(sampleElevation(both, s), 1500, 1e-6, 'blend of west edge and east column 0');
    // The wrap bug would blend 1000 with the WEST tile's own column 0 (=1000).
    assertNotEqual(sampleElevation(both, s), 1000, 'must not wrap to the same tile’s first column');
    assert.closeTo(sampleElevation(wrappedOnly, s), 1000, 1e-6, 'missing east tile clamps to the edge');
  });

  test('crossing the last row reads the south tile', () => {
    const north = syntheticTile(() => 300);
    const south = syntheticTile(() => 500);
    const s = { tx: 4, ty: 6, fx: 40, fy: 511.5 };
    const both = new Map([[tileKey(4, 6), north], [tileKey(4, 7), south]]);
    assert.closeTo(sampleElevation(both, s), 400, 1e-6, 'north/south blend');
    const only = new Map([[tileKey(4, 6), north]]);
    assert.closeTo(sampleElevation(only, s), 300, 1e-6, 'clamped without the south tile');
  });

  test('the diagonal corner uses the diagonal tile', () => {
    const base = syntheticTile(() => 0);
    const diag = syntheticTile(() => 4000);
    const s = { tx: 0, ty: 0, fx: 511.5, fy: 511.5 };
    const tiles = new Map([
      [tileKey(0, 0), base], [tileKey(1, 0), base], [tileKey(0, 1), base], [tileKey(1, 1), diag],
    ]);
    // Only the p11 corner (weight .25) is 4000.
    assert.closeTo(sampleElevation(tiles, s), 1000, 1e-6);
  });

  test('failures are null, never zero', () => {
    const good = syntheticTile(() => 750);
    assert.isNull(sampleElevation(new Map(), { tx: 0, ty: 0, fx: 10, fy: 10 }), 'missing tile');
    const nodata = syntheticTile((x, y) => (x === 10 && y === 10 ? -32768 : 750));
    assert.isNull(
      sampleElevation(new Map([[tileKey(0, 0), nodata]]), { tx: 0, ty: 0, fx: 10, fy: 10 }),
      'nodata primary pixel',
    );
    // A nodata NEIGHBOUR pixel clamps instead of failing the whole sample.
    const v = sampleElevation(new Map([[tileKey(0, 0), nodata]]), { tx: 0, ty: 0, fx: 9.5, fy: 10 });
    assert.closeTo(v, 750, 1e-6, 'invalid neighbour pixel clamps to the valid edge');
  });
});

/* 4. Sampling orchestration -------------------------------------------------------- */

suite('Elevation — tile fetch orchestration', () => {
  /** Three points: two mid-tile in tile A, one mid-tile in the tile to its east. */
  const twoTilePoints = [
    inTile(2000, 0.30, 2000, 0.40),
    inTile(2000, 0.50, 2000, 0.50),
    inTile(2001, 0.30, 2000, 0.40),
  ];

  test('samples every point and reports tile statistics', async () => {
    const seen = new Set();
    const result = await sampleElevations(twoTilePoints, {
      fetchTile: async (x, y) => {
        seen.add(tileKey(x, y));
        return syntheticTile(() => 600);
      },
      concurrency: 2,
    });
    assert.equal(result.sampled, 3, 'all three points sampled');
    assert.equal(result.failed, 0);
    assert.equal(result.tilesTotal, 2, 'two unique tiles');
    assert.equal(result.tilesFailed, 0);
    assert.equal(seen.size, 2, 'each tile fetched once');
    for (const e of result.elevations) assert.closeTo(e, 600, 1e-6);
  });

  test('progress reports done/total tile counts in order', async () => {
    const events = [];
    await sampleElevations(twoTilePoints, {
      fetchTile: async () => syntheticTile(() => 10),
      onProgress: (p) => events.push({ ...p }),
    });
    assert.equal(events[0].done, 0, 'starts at zero');
    assert.equal(events[events.length - 1].done, 2, 'ends at the tile count');
    assert.equal(events[events.length - 1].total, 2);
    for (let i = 1; i < events.length; i++) {
      assert(events[i].done > events[i - 1].done, 'monotonic');
    }
  });

  test('a failed tile leaves its points null — no zeros, batch survives', async () => {
    const failedX = 2000;
    const result = await sampleElevations(twoTilePoints, {
      fetchTile: async (x) => (x === failedX ? null : syntheticTile(() => 900)),
    });
    assert.equal(result.tilesFailed, 1);
    assert.equal(result.elevations.filter((e) => e === null).length, 2, 'both tile-A points have no sample');
    for (const [i, e] of result.elevations.entries()) {
      if (i === 2) assert.closeTo(e, 900, 1e-6, 'tile-B point sampled');
    }
  });

  test('a throwing fetch is a failed tile, not a crashed batch', async () => {
    const result = await sampleElevations(twoTilePoints, {
      fetchTile: async () => { throw new TypeError('network down'); },
    });
    assert.equal(result.tilesFailed, 2);
    assert.equal(result.sampled, 0);
    assert(result.elevations.every((e) => e === null), 'no fabricated zeros');
  });

  test('sea level tiles sample as 0 and count as successes', async () => {
    const result = await sampleElevations(twoTilePoints, {
      fetchTile: async () => syntheticTile(() => 0),
    });
    assert.equal(result.sampled, 3);
    for (const e of result.elevations) assert.equal(e, 0, 'legal zero elevation');
  });

  test('concurrency never exceeds the configured lane count', async () => {
    let inFlight = 0;
    let peak = 0;
    // Twelve points, each mid-tile on its own tile column.
    const points = Array.from({ length: 12 }, (_, i) => inTile(1600 + i, 0.5, 1700, 0.5));
    const result = await sampleElevations(points, {
      fetchTile: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 0));
        inFlight--;
        return syntheticTile(() => 1);
      },
      concurrency: 3,
    });
    assert(peak <= 3, `peak concurrency ${peak} exceeds the cap`);
    assert(peak > 1, `expected some overlap, saw ${peak}`);
    assert.equal(result.tilesTotal, 12, 'each point landed on its own tile');
    assert.equal(result.sampled, 12);
  });

  test('abort cancels the run instead of returning partial results', async () => {
    const controller = new AbortController();
    const points = Array.from({ length: 4 }, (_, i) => inTile(1800 + i, 0.5, 1800, 0.5));
    const run = sampleElevations(points, {
      fetchTile: (x, _y, signal) => new Promise((resolve, reject) => {
        if (x === 1800) resolve(syntheticTile(() => 5)); // one tile completes first
        else signal.addEventListener('abort', () => reject(new CancelledError()), { once: true });
      }),
      signal: controller.signal,
      concurrency: 1,
    });
    await new Promise((r) => setTimeout(r, 0));
    controller.abort();
    let caught = null;
    await run.catch((err) => { caught = err; });
    assert(caught instanceof CancelledError, 'rejection is the CancelledError sentinel');
  });
});

/* 5. Correction strategies --------------------------------------------------------- */

suite('Elevation — correction strategies', () => {
  const pts = (eles) => eles.map((ele, i) => ({
    lat: 0, lon: i * 0.001, ele, time: i * 1000, hr: i % 5 === 0 ? null : 120 + i, speed: null,
  }));

  test('fill: missing points take DEM values, recorded values are untouched (0 included)', () => {
    const points = pts([100, null, 0, null, 300]);
    const samples = [999, 111, 999, 222, 999]; // DEM offers values everywhere
    const { values, applied, failed, candidates } = buildFillValues(points, samples);
    assert.deepEqual(values, [100, 111, 0, 222, 300], 'only the two gaps filled');
    assert.equal(applied, 2);
    assert.equal(failed, 0);
    assert.equal(candidates, 2, 'only missing points are candidates');
  });

  test('fill: a gap DEM cannot sample stays missing — never 0', () => {
    const points = pts([100, null]);
    const { values, applied, failed } = buildFillValues(points, [999, null]);
    assert.deepEqual(values, [100, null]);
    assert.equal(applied, 0);
    assert.equal(failed, 1);
  });

  test('replace: every sampled point takes DEM; failures keep the original', () => {
    const points = pts([100, null, 0, 400]);
    const { values, applied, failed } = buildReplaceValues(points, [500, 600, null, 800]);
    assert.deepEqual(values, [500, 600, 0, 800], 'unsampled original kept, missing stays missing');
    assert.equal(applied, 3);
    assert.equal(failed, 1);
  });

  test('apply captures the originals once; repeat corrections overwrite, never stack', () => {
    const track = prepared(pts([10, 20, 30]), 't');
    const first = applyElevations(track, [50, 60, 70], 'replace');
    assert.deepEqual(first.eleOriginal, [10, 20, 30], 'originals captured on first apply');
    assert.equal(first.eleSource, 'replace');
    const second = applyElevations(first, [80, 90, 100], 'replace');
    assert.deepEqual(second.eleOriginal, [10, 20, 30], 'captured array is not re-captured');
    assert.deepEqual(second.points.map((p) => p.ele), [80, 90, 100], 'values replaced, not added');
    const third = applyElevations(second, [15, 25, 35], 'fill');
    assert.deepEqual(third.points.map((p) => p.ele), [15, 25, 35], 'a later fill overwrites the earlier replace');
    assert.equal(third.eleSource, 'fill');
  });

  test('apply recomputes the Track elevation flags with prepareTrack semantics', () => {
    const partial = prepared(pts([100, null, 300]), 't');
    assert.equal(partial.hasElevation, false);
    const filled = applyElevations(partial, [100, 200, 300], 'fill');
    assert.equal(filled.hasElevation, true, 'fill completed the series');
    assert.equal(filled.eleMin, 100);
    assert.equal(filled.eleMax, 300);
    const stillPartial = applyElevations(partial, [100, null, 300], 'fill');
    assert.equal(stillPartial.hasElevation, false, 'a failed fill keeps the series partial');
    assert.isNull(stillPartial.eleMin, 'partial series keeps null extremes like a fresh parse');
  });

  test('apply touches nothing but elevations', () => {
    const points = pts([10, 20, 30]);
    points[1].time = 5000; points[1].hr = 140; points[1].cad = 90;
    points[1].power = 210; points[1].temp = 12.5;
    const track = prepared(points, 'name');
    track.sourceName = 'name.gpx';
    const snapshot = track.points.map((p) => ({ ...p }));
    const cumDist = track.cumDist;
    const next = applyElevations(track, [1, 2, 3], 'replace');
    assert.equal(next.points, track.points, 'same points array, not a copy');
    assert.equal(next.cumDist, cumDist, 'geometry untouched');
    assert.equal(next.name, 'name');
    assert.equal(next.sourceName, 'name.gpx');
    assert.equal(next.totalDistance, track.totalDistance);
    assert.equal(next.pointCount, track.pointCount);
    for (const [i, before] of snapshot.entries()) {
      const after = next.points[i];
      assert.equal(after.lat, before.lat, `lat ${i}`);
      assert.equal(after.lon, before.lon, `lon ${i}`);
      assert.equal(after.time, before.time, `time ${i}`);
      assert.equal(after.hr, before.hr, `hr ${i}`);
      assert.equal(after.cad, before.cad, `cad ${i}`);
      assert.equal(after.power, before.power, `power ${i}`);
      assert.equal(after.temp, before.temp, `temp ${i}`);
      assert.equal(after.speed, before.speed, `speed ${i}`);
    }
    assert.deepEqual(next.points.map((p) => p.ele), [1, 2, 3]);
  });

  test('restore returns the file’s exact originals and clears the state', () => {
    const track = prepared(pts([10, null, 30]), 't');
    assert.isNull(restoreElevations(track), 'nothing to restore yet');
    const fixed = applyElevations(track, [11, 22, 33], 'replace');
    const refilled = applyElevations(fixed, [44, 55, 66], 'fill');
    const restored = restoreElevations(refilled);
    assert.deepEqual(restored.points.map((p) => p.ele), [10, null, 30], 'exact originals');
    assert.isNull(restored.eleOriginal);
    assert.isNull(restored.eleSource);
    assert.equal(restored.hasElevation, false, 'flags recomputed on the way back');
  });
});

/* 6. Run controller: state, cancellation, races ---------------------------------- */

const okSampler = (value) => async (points) => ({
  elevations: points.map(() => value),
  sampled: points.length,
  failed: 0,
  tilesTotal: 1,
  tilesFailed: 0,
});

suite('Elevation — run controller and races', () => {
  const twoPoints = () => prepared([
    { lat: 0, lon: 0, ele: 100, time: null, hr: null, speed: null },
    { lat: 0, lon: 0.001, ele: 200, time: null, hr: null, speed: null },
  ], 'a');

  test('a successful replace publishes the corrected track', async () => {
    const track = twoPoints();
    await withStore(track, async () => {
      let sawPoints = null;
      const result = await runElevationFix('replace', {
        sampler: async (points) => {
          sawPoints = points;
          return {
            elevations: points.map(() => 500), sampled: points.length,
            failed: 0, tilesTotal: 1, tilesFailed: 0,
          };
        },
      });
      assert.equal(result.status, 'applied');
      assert.equal(result.applied, 2);
      assert.equal(sawPoints, track.points, 'sampler saw the loaded track');
      const live = trackStore.get();
      assertNotEqual(live, track, 'a new track object was published');
      assert.equal(live.points, track.points, 'sharing the points array');
      assert.deepEqual(live.points.map((p) => p.ele), [500, 500]);
      assert.equal(live.eleSource, 'replace');
    });
  });

  test('total failure applies nothing', async () => {
    const track = twoPoints();
    await withStore(track, async () => {
      const result = await runElevationFix('replace', {
        sampler: async (points) => ({
          elevations: points.map(() => null), sampled: 0, failed: points.length,
          tilesTotal: 1, tilesFailed: 1,
        }),
      });
      assert.equal(result.status, 'failed-all');
      assert.equal(trackStore.get(), track, 'store untouched');
      assert.deepEqual(track.points.map((p) => p.ele), [100, 200], 'original elevations intact');
    });
  });

  test('fill with nothing missing reports nothing-to-fill', async () => {
    const track = twoPoints();
    await withStore(track, async () => {
      const result = await runElevationFix('fill', { sampler: okSampler(500) });
      assert.equal(result.status, 'nothing-to-fill');
      assert.equal(trackStore.get(), track);
    });
  });

  test('cancelling a hanging run leaves the store untouched', async () => {
    const track = twoPoints();
    await withStore(track, async () => {
      const run = runElevationFix('fill', {
        sampler: (points, { signal }) => new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(new CancelledError()), { once: true });
        }),
      });
      await Promise.resolve();
      cancelElevationFix();
      const result = await run;
      assert.equal(result.status, 'cancelled');
      assert.equal(trackStore.get(), track, 'no partial result applied');
    });
  });

  test('a run finishing after a new file loaded is discarded', async () => {
    const trackA = twoPoints();
    const trackB = prepared([
      { lat: 40, lon: 5, ele: 70, time: null, hr: null, speed: null },
      { lat: 40, lon: 5.001, ele: 80, time: null, hr: null, speed: null },
    ], 'b');
    await withStore(trackA, async () => {
      let release;
      const gate = new Promise((r) => { release = r; });
      const run = runElevationFix('replace', {
        sampler: async (points) => {
          await gate;
          return {
            elevations: points.map(() => 999), sampled: 2, failed: 0, tilesTotal: 1, tilesFailed: 0,
          };
        },
      });
      // Simulate the user loading another file mid-run.
      trackStore.set(trackB);
      release();
      const result = await run;
      assert.equal(result.status, 'superseded', 'late result discarded');
      assert.deepEqual(trackB.points.map((p) => p.ele), [70, 80], 'the new file was not overwritten');
      assert.equal(trackStore.get(), trackB);
    });
  });

  test('restore publishes the originals through the store', async () => {
    const track = twoPoints();
    await withStore(track, async () => {
      await runElevationFix('replace', { sampler: okSampler(50) });
      const corrected = trackStore.get();
      assert.equal(corrected.eleSource, 'replace');
      const result = restoreOriginalElevations();
      assert.equal(result.status, 'restored');
      const live = trackStore.get();
      assert.deepEqual(live.points.map((p) => p.ele), [100, 200]);
      assert.isNull(live.eleOriginal);
      assert.isNull(live.eleSource);
    });
  });

  test('a new track load cancels an in-flight run', async () => {
    const trackA = prepared([{ lat: 0, lon: 0, ele: 10, time: null, hr: null, speed: null }], 'a');
    const trackB = prepared([{ lat: 40, lon: 5, ele: 70, time: null, hr: null, speed: null }], 'b');
    await withStore(trackA, async () => {
      const run = runElevationFix('fill', {
        sampler: (points, { signal }) => new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(new CancelledError()), { once: true });
        }),
      });
      await Promise.resolve();
      trackStore.set(trackB); // the controller's trackStore subscription aborts
      const result = await run;
      assert.equal(result.status, 'cancelled');
    });
  });
});

/* 7. Metrics and export integration ------------------------------------------------ */

suite('Elevation — metrics and export integration', () => {
  /** An 11-point track: ~111 m steps up a steady 4 m-per-point ramp. */
  function rampTrack() {
    return prepared(eastTrack({
      count: 11,
      lonStep: 0.001,
      ele: (i) => 100 + i * 4,
      time: (i) => 1_000_000 + i * 60_000,
    }), 'ramp');
  }

  test('applying DEM elevations moves every elevation-derived metric', () => {
    const track = rampTrack();
    const before = computeSectorMetrics(track, 0, track.totalDistance);
    // DEM "finds" a twice-as-steep hill.
    const next = applyElevations(track, track.points.map((p, i) => 100 + i * 8), 'replace');
    const after = computeSectorMetrics(next, 0, next.totalDistance);
    assert(after.gain > before.gain, 'gain grows');
    assert(after.distance3D > before.distance3D, '3D distance grows');
    assert(after.effortDistance > before.effortDistance, 'effort distance grows');
    assert(after.eleMax > before.eleMax, 'sector eleMax grows');
    assert.closeTo(after.avgGrade, before.avgGrade * 2, 1e-6, 'average grade doubles on the doubled ramp');
  });

  test('restoring brings every metric back exactly', () => {
    const track = rampTrack();
    const before = JSON.stringify(computeSectorMetrics(track, 0, track.totalDistance));
    const fixed = applyElevations(track, track.points.map((p, i) => 100 + i * 8), 'replace');
    const restored = restoreElevations(fixed);
    const after = JSON.stringify(computeSectorMetrics(restored, 0, restored.totalDistance));
    assert.equal(after, before, 'metrics round-trip exactly');
  });

  test('the 3 m gain threshold still filters sub-threshold wiggle', () => {
    assert.equal(ELEVATION_THRESHOLD_M, 3, 'the documented noise rule');
    const noisy = prepared(eastTrack({
      count: 9,
      ele: (i) => 100 + (i % 2 === 0 ? 0 : 2), // ±2 m wiggle, under the 3 m rule
      time: (i) => 1_000_000 + i * 60_000,
    }), 'noisy');
    const m = computeSectorMetrics(noisy, 0, noisy.totalDistance);
    assert.equal(m.gain, 0, 'sub-threshold wiggle counts as noise');
    const fixed = applyElevations(noisy, noisy.points.map((p, i) => 100 + (i % 2 === 0 ? 0 : 2)), 'replace');
    assert.equal(
      computeSectorMetrics(fixed, 0, fixed.totalDistance).gain, 0,
      'applying identical DEM values keeps the rule intact',
    );
  });

  test('GPX export carries the effective elevations, restore returns the originals', () => {
    const track = rampTrack();
    const next = applyElevations(track, track.points.map((p, i) => 100 + i * 8), 'replace');
    const correctedGpx = buildGpxExport(next, { start: 0, end: next.totalDistance });
    assert(correctedGpx.includes('<ele>180</ele>'), 'DEM ramp top in the export');
    assert(!correctedGpx.includes('<ele>104</ele>'), 'stale original-only elevation gone');
    const restored = restoreElevations(next);
    const originalGpx = buildGpxExport(restored, { start: 0, end: restored.totalDistance });
    assert(originalGpx.includes('<ele>104</ele>'), 'original-only elevation back after restore');
    assert(!originalGpx.includes('<ele>180</ele>'), 'DEM ramp top gone after restore');
    assert(originalGpx.includes('<time>'), 'timestamps still exported');
  });

  test('a fill completing a partial series flips hasElevation for consumers', () => {
    const points = eastTrack({ count: 5, ele: (i) => (i === 2 ? null : 50) });
    const track = prepared(points, 'partial');
    assert.equal(track.hasElevation, false);
    const next = applyElevations(track, [50, 50, 77, 50, 50], 'fill');
    assert.equal(next.hasElevation, true);
    const m = computeSectorMetrics(next, 0, next.totalDistance);
    assert(m.distance3D != null, '3D distance becomes available');
  });
});
