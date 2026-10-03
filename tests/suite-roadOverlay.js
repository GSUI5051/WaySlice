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
    assert.equal(lineLayers.length, 3, 'three road line layers');
    assert.equal(symbolLayers.length, 2, 'two label layers');
  });

  test('road line layers skip tunnels and start where their classes appear', () => {
    const minzooms = Object.fromEntries(ROAD_OVERLAY_LAYERS.map((l) => [l.id, l.minzoom]));
    assert.equal(minzooms['road-overlay-line-major'], 7);
    assert.equal(minzooms['road-overlay-line-minor'], 11);
    assert.equal(minzooms['road-overlay-line-path'], 13);
    for (const layer of ROAD_OVERLAY_LAYERS.filter((l) => l.type === 'line')) {
      const hasTunnelDrop = JSON.stringify(layer.filter).includes('tunnel')
        && layer.filter[0] === 'all'
        && JSON.stringify(layer.filter[1]) === JSON.stringify(['!=', ['get', 'brunnel'], 'tunnel']);
      assert.truthy(hasTunnelDrop, `tunnel exclusion in ${layer.id}`);
    }
  });

  test('labels use the shared glyphs set and Latin-first name fields', () => {
    for (const layer of ROAD_OVERLAY_LAYERS.filter((l) => l.type === 'symbol')) {
      assert.deepEqual(layer.layout['text-font'], ['Noto Sans Regular'], `font of ${layer.id}`);
      assert.equal(layer.layout['text-field'][0], 'coalesce', `text field of ${layer.id}`);
      const fields = layer.layout['text-field'].slice(1).map((expr) => expr[1]);
      assert.deepEqual(fields, ['name:latin', 'name_en', 'name'], `name fields of ${layer.id}`);
    }
  });

  test('layers mount visible — the toggle rides native visibility, not re-creation', () => {
    for (const layer of ROAD_OVERLAY_LAYERS) {
      assert.equal(layer.layout.visibility, 'visible', `initial visibility of ${layer.id}`);
    }
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
