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
      'road-overlay-line-major',
      'road-overlay-line-minor',
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
    assert.equal(lineLayers.length, 4, 'four road line layers (tunnel included)');
    assert.equal(symbolLayers.length, 2, 'two label layers');
  });

  test('surface road layers skip tunnels; a dedicated dashed layer draws them dimmed', () => {
    const minzooms = Object.fromEntries(ROAD_OVERLAY_LAYERS.map((l) => [l.id, l.minzoom]));
    assert.equal(minzooms['road-overlay-line-major'], 8);
    assert.equal(minzooms['road-overlay-line-minor'], 11);
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

  test('labels are bilingual with identically-sized text; per-layer line layout', () => {
    for (const { code } of language.getLanguages()) {
      for (const layerId of ['road-overlay-label-road', 'road-overlay-label-place']) {
        const multiline = layerId === 'road-overlay-label-place';
        const field = roadOverlayTextField(layerId, code);
        assert.equal(field[0], 'case', `bilingual case for ${code}/${layerId}`);
        const both = field[2]; // ['format', primary, opts, separator, {}, secondary, opts]
        const single = field[3]; // ['format', primary, opts]
        assert.equal(both[0], 'format', `format type for ${code}/${layerId}`);
        assert.equal(both[3], multiline ? '\n' : ' ', `separator for ${code}/${layerId}`);
        // Primary: the documented fallback chain (trailing '' keeps every
        // branch a string even for nameless features).
        const primaryKeys = both[1].slice(1).map((e) => (Array.isArray(e) ? e[1] : e));
        assert.deepEqual(primaryKeys, [`name:${code}`, 'name:en', 'name_int', 'name:latin', 'name', ''], `primary chain for ${code}/${layerId}`);
        // Secondary: ONLY the raw local name — never name_int/name:latin.
        assert.deepEqual(both[5], ['coalesce', ['get', 'name'], ''], `secondary source for ${code}/${layerId}`);
        // Both sections styled identically — same font, same size (no
        // font-scale), so the secondary is exactly as large as the primary.
        assert.deepEqual(both[2], both[6], `identical section styling for ${code}/${layerId}`);
        assert.deepEqual(both[6], { 'text-font': ['literal', ['Noto Sans Regular']] }, `no font-scale for ${code}/${layerId}`);
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
