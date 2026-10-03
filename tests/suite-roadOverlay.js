/**
 * Satellite road-network overlay tests: the catalog gating invariant (the
 * overlay only ever mounts on a raster/minimal style), the pure layer-stack
 * shape (lightweight roads + labels — no fills, no POI, no buildings) and the
 * label vocabulary (glyphs endpoint, font, name fields). The live toggle and
 * style-reload behavior is verified against a real map by the scenario tool;
 * these tests pin everything that is decidable without a WebGL context.
 */
import { suite, test, assert } from './runner.js';
import { MAP_SOURCES } from '../js/map/sources.js';
import {
  ROAD_OVERLAY_SOURCE_ID, ROAD_OVERLAY_SOURCE, ROAD_OVERLAY_LAYERS, ROAD_OVERLAY_GLYPHS,
  roadOverlayTextField, ROAD_OVERLAY_STORAGE_KEY, savedRoadOverlayOn, saveRoadOverlayOn,
} from '../js/map/roadOverlay.js';
import * as language from '../js/language/language.js';
import '../js/language/langs.js';

suite('road overlay / basemap gating', () => {
  test('every satellite-group source is a raster basemap (no provider style)', () => {
    const satellite = MAP_SOURCES.filter((s) => s.group === 'satellite');
    assert.truthy(satellite.length >= 1, 'satellite group must not be empty');
    for (const s of satellite) {
      assert.truthy(s.url && !s.styleUrl, `satellite source ${s.id} must be raster`);
    }
    // The overlay's layer stack is written against the minimal style, and
    // only raster sources run on it — a satellite source with a styleUrl
    // would make the toggle's mount/wipe reasoning invalid.
  });

  test('no non-satellite source needs the overlay glyphs implicitly', () => {
    // The minimal style carries a glyphs endpoint for the overlay's text
    // layers; provider styles bring their own. Nothing to assert beyond the
    // raster invariant above — this documents the pairing.
    assert.truthy(ROAD_OVERLAY_GLYPHS.includes('{fontstack}'), 'glyphs fontstack placeholder');
    assert.truthy(ROAD_OVERLAY_GLYPHS.includes('{range}'), 'glyphs range placeholder');
  });
});

suite('road overlay / layer stack', () => {
  test('source is the OpenFreeMap planet endpoint (keyless, like the OFM basemaps)', () => {
    assert.equal(ROAD_OVERLAY_SOURCE.type, 'vector');
    assert.equal(ROAD_OVERLAY_SOURCE.url, 'https://tiles.openfreemap.org/planet');
    assert.truthy(!ROAD_OVERLAY_SOURCE.tiles, 'TileJSON url, not a raw tiles array');
  });

  test('layers are unique, ordered roads-then-labels, and bound to the overlay source', () => {
    const ids = ROAD_OVERLAY_LAYERS.map((l) => l.id);
    assert.deepEqual(ids, [
      'road-overlay-line-tunnel',
      'road-overlay-line-casing',
      'road-overlay-line-major',
      'road-overlay-line-service',
      'road-overlay-line-track',
      'road-overlay-line-path',
      'road-overlay-label-road',
      'road-overlay-label-place',
    ]);
    for (const layer of ROAD_OVERLAY_LAYERS) {
      assert.equal(layer.source, ROAD_OVERLAY_SOURCE_ID, `source binding for ${layer.id}`);
    }
  });

  test('the stack stays lightweight: lines and symbols only, road/place data only', () => {
    for (const layer of ROAD_OVERLAY_LAYERS) {
      assert.truthy(layer.type === 'line' || layer.type === 'symbol', `type of ${layer.id}`);
      // OpenMapTiles layers that would drag in the forbidden cargo: landuse /
      // building polygons, POIs, water polygons, 3D extrusions.
      assert.truthy(
        ['transportation', 'transportation_name', 'place'].includes(layer['source-layer']),
        `source-layer of ${layer.id}`,
      );
    }
    const lineLayers = ROAD_OVERLAY_LAYERS.filter((l) => l.type === 'line');
    const symbolLayers = ROAD_OVERLAY_LAYERS.filter((l) => l.type === 'symbol');
    assert.equal(lineLayers.length, 6, 'six road line layers (tunnel, casing, major, service, track, path)');
    assert.equal(symbolLayers.length, 2, 'two label layers');
  });

  test('surface road layers skip tunnels; a dedicated dashed layer draws them dimmed', () => {
    const minzooms = Object.fromEntries(ROAD_OVERLAY_LAYERS.map((l) => [l.id, l.minzoom]));
    assert.equal(minzooms['road-overlay-line-casing'], 5);
    assert.equal(minzooms['road-overlay-line-major'], 5);
    assert.equal(minzooms['road-overlay-line-track'], 12);
    assert.equal(minzooms['road-overlay-line-service'], 13);
    assert.equal(minzooms['road-overlay-line-path'], 13);
    for (const layer of ROAD_OVERLAY_LAYERS.filter((l) => l.type === 'line' && l.id !== 'road-overlay-line-tunnel')) {
      const hasTunnelDrop = JSON.stringify(layer.filter).includes('tunnel')
        && layer.filter[0] === 'all'
        && JSON.stringify(layer.filter[1]) === JSON.stringify(['!=', ['get', 'brunnel'], 'tunnel']);
      assert.truthy(hasTunnelDrop, `tunnel exclusion in ${layer.id}`);
    }
    const tunnel = ROAD_OVERLAY_LAYERS.find((l) => l.id === 'road-overlay-line-tunnel');
    assert.equal(tunnel.minzoom, 8, 'tunnels draw from the major-road zoom');
    assert.deepEqual(tunnel.filter[0], 'all', 'tunnel filter shape');
    assert.deepEqual(tunnel.filter[1], ['==', ['get', 'brunnel'], 'tunnel'], 'tunnel layer draws ONLY tunnels');
    assert.truthy(Array.isArray(tunnel.paint['line-dasharray']), 'tunnels render dashed');
    assert.truthy(tunnel.paint['line-opacity'] < 0.8, 'tunnels render dimmer than surface roads');
  });

  /** The per-class value map at one zoom stop of a single-curve gate
   * (interpolate over zoom, match-per-class at every stop). */
  function classStop(curve, zoom, message) {
    assert.equal(curve[0], 'interpolate', message);
    assert.deepEqual(curve[1], ['linear'], message);
    assert.deepEqual(curve[2], ['zoom'], message);
    for (let i = 3; i < curve.length; i += 2) {
      if (curve[i] !== zoom) continue;
      const match = curve[i + 1];
      assert.equal(match[0], 'match', message);
      assert.deepEqual(match[1], ['get', 'class'], message);
      const out = {};
      for (let j = 2; j < match.length - 1; j += 2) {
        for (const key of Array.isArray(match[j]) ? match[j] : [match[j]]) out[key] = match[j + 1];
      }
      return out;
    }
    throw new Error(`${message}: no stop for zoom ${zoom}`);
  }

  test('casing and core draw the six major classes from z5 on the shared width table', () => {
    const casing = ROAD_OVERLAY_LAYERS.find((l) => l.id === 'road-overlay-line-casing');
    const major = ROAD_OVERLAY_LAYERS.find((l) => l.id === 'road-overlay-line-major');
    const six = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'];
    for (const layer of [casing, major]) {
      assert.deepEqual(layer.filter[2], ['match', ['get', 'class'], six, true, false], `six-class filter of ${layer.id}`);
    }
    assert.equal(casing.paint['line-color'], 'rgba(30, 30, 30, 0.6)', 'casing color');
    assert.equal(major.paint['line-color'], 'rgba(255, 255, 255, 0.92)', 'core color, alpha in the color');
    assert.truthy(!('line-opacity' in major.paint), 'no per-class line-opacity on the core');
    const casingTable = {
      5: { motorway: 2.2, trunk: 2.0, primary: 1.8, secondary: 0, tertiary: 0, minor: 0 },
      9: { motorway: 3.4, trunk: 3.2, primary: 2.8, secondary: 2.4, tertiary: 2.2, minor: 1.4 },
      13: { motorway: 5, trunk: 4.6, primary: 4, secondary: 3.6, tertiary: 3.4, minor: 2.6 },
      16: { motorway: 9, trunk: 8.5, primary: 8, secondary: 7, tertiary: 6.5, minor: 5 },
      19: { motorway: 10.5, trunk: 10, primary: 9.5, secondary: 8.5, tertiary: 8, minor: 6 },
    };
    const coreTable = {
      5: { motorway: 1.1, trunk: 1.0, primary: 0.9, secondary: 0, tertiary: 0, minor: 0 },
      9: { motorway: 1.9, trunk: 1.7, primary: 1.5, secondary: 1.3, tertiary: 1.2, minor: 0.5 },
      13: { motorway: 3, trunk: 2.8, primary: 2.4, secondary: 2.2, tertiary: 2, minor: 1.4 },
      16: { motorway: 6, trunk: 5.5, primary: 5, secondary: 4.4, tertiary: 4, minor: 2.8 },
      19: { motorway: 7, trunk: 6.5, primary: 6, secondary: 5.2, tertiary: 4.6, minor: 3.2 },
    };
    for (const zoom of [5, 9, 13, 16, 19]) {
      assert.deepEqual(classStop(casing.paint['line-width'], zoom, `casing widths z${zoom}`), casingTable[zoom]);
      assert.deepEqual(classStop(major.paint['line-width'], zoom, `core widths z${zoom}`), coreTable[zoom]);
      for (const cls of six) {
        assert.truthy(
          coreTable[zoom][cls] <= casingTable[zoom][cls],
          `core never wider than casing (${cls} z${zoom})`,
        );
      }
    }
  });

  test('service roads and tracks get their own symbols, distinct from roads and paths', () => {
    const service = ROAD_OVERLAY_LAYERS.find((l) => l.id === 'road-overlay-line-service');
    const track = ROAD_OVERLAY_LAYERS.find((l) => l.id === 'road-overlay-line-track');
    const path = ROAD_OVERLAY_LAYERS.find((l) => l.id === 'road-overlay-line-path');
    assert.deepEqual(service.filter[2], ['==', ['get', 'class'], 'service'], 'service class filter');
    assert.equal(service.minzoom, 13);
    assert.truthy(!('line-dasharray' in service.paint), 'service roads draw solid');
    assert.equal(service.paint['line-opacity'], 0.6);
    assert.deepEqual(service.paint['line-width'].slice(3), [13, 0.7, 16, 1.1, 19, 1.6], 'service width anchors');
    assert.deepEqual(track.filter[2], ['==', ['get', 'class'], 'track'], 'track class filter');
    assert.equal(track.minzoom, 12);
    assert.deepEqual(track.paint['line-dasharray'], [3, 1.5], 'tracks are the LONG dash, vs the path dash');
    assert.deepEqual(path.paint['line-dasharray'], [1.5, 1], 'paths keep the short dash');
    assert.equal(track.paint['line-opacity'], 0.85);
    assert.deepEqual(track.paint['line-width'].slice(3), [12, 0.8, 14, 1.4, 16, 2.0, 19, 2.8], 'track width anchors');
  });

  test('every paint/layout gate is one single zoom curve (MapLibre silently rejects nested ones)', () => {
    for (const layer of ROAD_OVERLAY_LAYERS) {
      const exprs = [layer.paint && layer.paint['line-width'], layer.layout && layer.layout['text-size']]
        .filter((e) => Array.isArray(e));
      for (const expr of exprs) {
        assert.equal(expr[0], 'interpolate', `top-level curve in ${layer.id}`);
        assert.deepEqual(expr[2], ['zoom'], `zoom-driven curve in ${layer.id}`);
        const blob = JSON.stringify(expr);
        assert.equal(blob.split('"zoom"').length - 1, 1, `exactly one zoom reference in ${layer.id}`);
      }
    }
  });

  test('road names label every named class from z12 with dark-on-white paint and ref fallback', () => {
    const road = ROAD_OVERLAY_LAYERS.find((l) => l.id === 'road-overlay-label-road');
    assert.truthy(!('filter' in road), 'no class filter — every named road labels, trails included');
    assert.equal(road.minzoom, 12);
    assert.equal(road.layout['symbol-placement'], 'line', '2D labels repeat along the line');
    assert.deepEqual(road.layout['text-size'].slice(3), [12, 10, 16, 12.5, 19, 14], 'text-size anchors');
    assert.equal(road.paint['text-color'], 'rgba(45, 45, 45, 0.95)', 'dark text riding the white roads');
    assert.equal(road.paint['text-halo-color'], 'rgba(255, 255, 255, 0.9)', 'white halo');
    assert.equal(road.paint['text-halo-width'], 1.1);
    assert.equal(road.paint['text-halo-blur'], 0.3);
    // The ref fallback lives in the shared text-field builder — the chain
    // test above pins it for both label layers.
  });

  test('place labels gate seven settlement classes on one zoom curve', () => {
    const place = ROAD_OVERLAY_LAYERS.find((l) => l.id === 'road-overlay-label-place');
    assert.deepEqual(place.filter, ['match', ['get', 'class'],
      ['city', 'town', 'village', 'hamlet', 'suburb', 'quarter', 'neighbourhood'], true, false]);
    assert.equal(place.minzoom, 3);
    assert.equal(place.layout['text-max-width'], 8);
    // Spot-check the gate table: class, entered-at zoom, z19 anchor.
    assert.deepEqual(classStop(place.layout['text-size'], 10, 'place sizes z10'), {
      city: 13.5, town: 11.5, village: 9.5, suburb: 8.5, quarter: 8.5, neighbourhood: 8.5, hamlet: 0,
    });
    assert.deepEqual(classStop(place.layout['text-size'], 13, 'place sizes z13'), {
      city: 15.5, town: 13, village: 10.5, suburb: 9.5, quarter: 9.5, neighbourhood: 9.5, hamlet: 8.5,
    });
    assert.deepEqual(classStop(place.layout['text-size'], 19, 'place sizes z19'), {
      city: 17, town: 15, village: 13, suburb: 12, quarter: 12, neighbourhood: 12, hamlet: 11,
    });
    // A 0 output hides the class; every class enters at its documented zoom.
    assert.deepEqual(classStop(place.layout['text-size'], 3, 'place sizes z3'), {
      city: 11, town: 0, village: 0, suburb: 0, quarter: 0, neighbourhood: 0, hamlet: 0,
    });
    assert.equal(place.paint['text-color'], '#ffffff', 'white text straight on the imagery');
    assert.equal(place.paint['text-halo-color'], 'rgba(40, 40, 40, 0.9)', 'dark halo');
    assert.equal(place.paint['text-halo-width'], 1.2);
    assert.equal(place.paint['text-halo-blur'], 0.3);
  });

  test('labels use the shared glyphs set and the language-first name fallback', () => {
    for (const layer of ROAD_OVERLAY_LAYERS.filter((l) => l.type === 'symbol')) {
      assert.deepEqual(layer.layout['text-font'], ['Noto Sans Regular'], `font of ${layer.id}`);
      // Static defs ship the English default; mapView rebuilds text-field
      // from roadOverlayTextField(layer.id, getCurrentLanguage()) at mount
      // time and on every language switch.
      assert.deepEqual(layer.layout['text-field'], roadOverlayTextField(layer.id, 'en'), `default text field of ${layer.id}`);
    }
    // Layout variants: place names stack, road names share one line.
    assert.equal(ROAD_OVERLAY_LAYERS.find((l) => l.id === 'road-overlay-label-place').layout['text-field'][2][3], '\n', 'place labels two-line');
    assert.equal(ROAD_OVERLAY_LAYERS.find((l) => l.id === 'road-overlay-label-road').layout['text-field'][2][3], ' ', 'road labels one-line');
  });

  test('labels are bilingual with same-size text; per-layer line layout', () => {
    for (const { code } of language.getLanguages()) {
      for (const layerId of ['road-overlay-label-road', 'road-overlay-label-place']) {
        const multiline = layerId === 'road-overlay-label-place';
        const field = roadOverlayTextField(layerId, code);
        assert.equal(field[0], 'case', `bilingual case for ${code}/${layerId}`);
        const both = field[2]; // ['format', primary, opts, separator, {}, secondary, opts]
        const single = field[3]; // ['format', primary, opts]
        assert.equal(both[0], 'format', `format type for ${code}/${layerId}`);
        assert.equal(both[3], multiline ? '\n' : ' ', `separator for ${code}/${layerId}`);
        // Primary: the documented fallback chain, ref before the trailing ''
        // (motorway stubs often only carry a number).
        const primaryKeys = both[1].slice(1).map((e) => (Array.isArray(e) ? e[1] : e));
        assert.deepEqual(primaryKeys, [`name:${code}`, 'name:en', 'name_int', 'name:latin', 'name', 'ref', ''], `primary chain for ${code}/${layerId}`);
        // Secondary: ONLY the raw local name — never name_int/name:latin.
        assert.deepEqual(both[5], ['coalesce', ['get', 'name'], ''], `secondary source for ${code}/${layerId}`);
        // Both sections styled identically — same font, NO font-scale: the
        // secondary is exactly as large as the primary, the deliberate
        // bilingual-map convention (two scripts equally readable).
        assert.deepEqual(both[2], { 'text-font': ['literal', ['Noto Sans Regular']] }, `primary section styling for ${code}/${layerId}`);
        assert.deepEqual(both[6], both[2], `identical section styling (no font-scale) for ${code}/${layerId}`);
        // Hidden whenever the primary already is the local name
        // (case-insensitive) or the feature has no local name at all.
        assert.deepEqual(field[1], [
          'all',
          ['!=', both[5], ''],
          ['!=', ['downcase', both[5]], ['downcase', both[1]]],
        ], `dedup condition for ${code}/${layerId}`);
        assert.deepEqual(single, ['format', both[1], both[2]], `single-name branch for ${code}/${layerId}`);
      }
    }
  });

  test('label expressions never touch the deprecated name_ keys (name_int excepted)', () => {
    const blob = JSON.stringify(ROAD_OVERLAY_LAYERS)
      + language.getLanguages().map(({ code }) => JSON.stringify(roadOverlayTextField('road-overlay-label-place', code))).join();
    // The legacy localized underscore keys (name_en, name_de, …) are
    // deprecated; name_int is a current-schema field and explicitly wanted.
    assert.truthy(!/name_(?!int\b)[a-z]/.test(blob), 'no deprecated name_ keys other than name_int');
  });

  test('layers mount visible — the toggle rides native visibility, not re-creation', () => {
    for (const layer of ROAD_OVERLAY_LAYERS) {
      assert.equal(layer.layout.visibility, 'visible', `initial visibility of ${layer.id}`);
    }
  });
});

suite('road overlay / persisted toggle', () => {
  test('the preference round-trips through localStorage and defaults to off', () => {
    localStorage.removeItem(ROAD_OVERLAY_STORAGE_KEY);
    assert.equal(savedRoadOverlayOn(), false, 'absent preference = off');
    saveRoadOverlayOn(true);
    assert.equal(localStorage.getItem(ROAD_OVERLAY_STORAGE_KEY), 'on');
    assert.equal(savedRoadOverlayOn(), true);
    saveRoadOverlayOn(false);
    assert.equal(localStorage.getItem(ROAD_OVERLAY_STORAGE_KEY), 'off');
    assert.equal(savedRoadOverlayOn(), false);
    localStorage.removeItem(ROAD_OVERLAY_STORAGE_KEY);
  });

  test('the storage key follows the wayslice- convention', () => {
    assert.equal(ROAD_OVERLAY_STORAGE_KEY, 'wayslice-road-overlay');
  });
});

suite('road overlay / i18n label', () => {
  test('the toggle label resolves in every registered language', async () => {
    const codes = language.getLanguages().map((l) => l.code);
    for (const code of codes) {
      await language.setLanguage(code);
      const label = language.t('roadOverlay');
      assert.truthy(label && label !== 'roadOverlay', `roadOverlay unresolved in ${code}`);
    }
    await language.setLanguage('en');
  });

  test('the label names the road network, not a basemap switch', async () => {
    // The button overlays roads on satellite imagery — its label must not
    // read as a basemap picker (that is the "Map" menu's job).
    await language.setLanguage('en');
    const label = language.t('roadOverlay').toLowerCase();
    assert.truthy(label.includes('road'), 'en label speaks of roads');
    assert.truthy(!label.startsWith('map'), 'en label is not a basemap switch');
  });
});
