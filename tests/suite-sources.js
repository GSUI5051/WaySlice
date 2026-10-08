/** Basemap catalog tests: source shape, i18n labels, default source. */
import { suite, test, assert } from './runner.js';
import {
  MAP_SOURCES, groupedSources, DEFAULT_SOURCE_ID,
  getSavedSource, getSavedSourceId, naturalOverlayEnabled,
} from '../js/map/sources.js';
import * as language from '../js/language/language.js';
import '../js/language/langs.js';

suite('basemap / catalog integrity', () => {
  test('every source has the required fields and a unique id', () => {
    const ids = MAP_SOURCES.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate source ids');
    for (const s of MAP_SOURCES) {
      assert.truthy(s.id && s.labelKey && s.group && (s.url || s.styleUrl) && s.maxZoom && s.attribution, `incomplete source: ${s.id}`);
    }
  });

  test('grouped sources cover every source exactly once', () => {
    const grouped = groupedSources().flatMap((g) => g.sources.map((s) => s.id)).sort();
    assert.deepEqual(grouped, MAP_SOURCES.map((s) => s.id).sort());
  });

  test('street and minimal groups follow the documented selector order', () => {
    const idsFor = (group) => MAP_SOURCES.filter((s) => s.group === group).map((s) => s.id);
    assert.deepEqual(idsFor('street'), ['osm', 'OpenFreeMapBright', 'StadiaOSMBright', 'TFAtlas']);
    assert.deepEqual(idsFor('satellite'), ['EOXSentinel2', 'esri-imagery', 'MapyAerial']);
    assert.deepEqual(idsFor('minimal'), ['OpenFreeMapPositron', 'OpenFreeMapDark', 'StadiaSmooth', 'StadiaSmoothDark']);
  });

  test('vector style sources point at their provider style endpoints', () => {
    const vector = MAP_SOURCES.filter((s) => s.styleUrl);
    assert.deepEqual(vector.map((s) => s.id).sort(), ['OpenFreeMapBright', 'OpenFreeMapDark', 'OpenFreeMapPositron', 'StadiaOSMBright', 'StadiaSmooth', 'StadiaSmoothDark', 'TFAtlas']);
    for (const s of vector.filter((s) => s.id.startsWith('Stadia'))) {
      assert.truthy(s.styleUrl.startsWith('https://tiles-eu.stadiamaps.com/styles/'), `style host for ${s.id}`);
      assert.truthy(s.styleUrl.endsWith('.json'), `style file for ${s.id}`);
    }
    for (const s of vector.filter((s) => s.id.startsWith('OpenFreeMap'))) {
      assert.truthy(s.styleUrl.startsWith('https://tiles.openfreemap.org/styles/'), `style host for ${s.id}`);
      assert.truthy(!s.url, `vector-only provider serves no raster url: ${s.id}`);
    }
    for (const s of vector.filter((s) => s.id === 'TFAtlas')) {
      assert.truthy(s.styleUrl.startsWith('https://api.thunderforest.com/styles/'), `style host for ${s.id}`);
      assert.truthy(s.styleUrl.includes('apikey='), `api key for ${s.id}`);
    }
  });

  test('default source id resolves to a registered source', () => {
    assert.truthy(MAP_SOURCES.some((s) => s.id === DEFAULT_SOURCE_ID));
  });
});

suite('basemap / i18n labels', () => {
  test('every source label resolves in every registered language', async () => {
    const codes = language.getLanguages().map((l) => l.code);
    for (const source of MAP_SOURCES) {
      for (const code of codes) {
        await language.setLanguage(code);
        const label = language.t(source.labelKey);
        assert.truthy(label && label !== source.labelKey, `${source.labelKey} unresolved in ${code}`);
      }
    }
    await language.setLanguage('en');
  });
});

suite('basemap / default source', () => {
  test('with no saved choice the catalog default applies, whatever the UI language', async () => {
    localStorage.removeItem('wayslice-basemap');
    for (const { code } of language.getLanguages()) {
      await language.setLanguage(code);
      assert.equal(getSavedSourceId(), DEFAULT_SOURCE_ID, `default for ${code}`);
      assert.equal(getSavedSource().id, DEFAULT_SOURCE_ID, `default source for ${code}`);
    }
    await language.setLanguage('en');
  });

  test('an explicit choice beats the default', () => {
    localStorage.setItem('wayslice-basemap', 'opentopomap');
    assert.equal(getSavedSourceId(), 'opentopomap');
    assert.equal(getSavedSource().id, 'opentopomap');
    localStorage.removeItem('wayslice-basemap');
    assert.equal(getSavedSourceId(), DEFAULT_SOURCE_ID);
  });

  test('a stale saved id falls back to the default', () => {
    localStorage.setItem('wayslice-basemap', 'not-a-source');
    assert.equal(getSavedSourceId(), DEFAULT_SOURCE_ID);
    localStorage.removeItem('wayslice-basemap');
  });
});

/* ---- the natural overlay gate (js/map/mapView.js natural face) ---- */

suite('basemap / natural overlay gate', () => {
  test('exactly the seven vector styles carry the natural face', () => {
    // The gate alone says nothing about the satellite group — the roads
    // face owns it, and the controller (mapView naturalFaceActive) checks
    // the group BEFORE the gate. The catalog half is what this pins.
    const gated = MAP_SOURCES.filter((s) => s.group !== 'satellite' && naturalOverlayEnabled(s, false));
    assert.deepEqual(gated.map((s) => s.id).sort(), [
      'OpenFreeMapBright', 'OpenFreeMapDark', 'OpenFreeMapPositron',
      'StadiaOSMBright', 'StadiaSmooth', 'StadiaSmoothDark', 'TFAtlas',
    ]);
    for (const s of gated) {
      assert.truthy(s.styleUrl, `the natural face rides vector styles only: ${s.id}`);
      assert.equal(s.naturalOverlay, undefined, `ungated entries stay unmarked: ${s.id}`);
    }
  });

  test('the plain raster maps gate the face to 3D (their tiles draw their own markers)', () => {
    for (const s of MAP_SOURCES.filter((x) => x.url && x.group !== 'satellite')) {
      assert.equal(s.naturalOverlay, '3d', `raster entry gated '3d': ${s.id}`);
      assert.equal(naturalOverlayEnabled(s, false), false, `face closed in 2D: ${s.id}`);
      assert.equal(naturalOverlayEnabled(s, true), true, `face open in 3D: ${s.id}`);
    }
  });

  test('the satellite group needs no gate — the roads face owns it', () => {
    for (const s of MAP_SOURCES.filter((x) => x.group === 'satellite')) {
      assert.equal(s.naturalOverlay, undefined, `satellite entries unmarked: ${s.id}`);
    }
  });

  test('naturalOverlayEnabled truth table', () => {
    assert.equal(naturalOverlayEnabled(null, true), false, 'no basemap = no overlay');
    assert.equal(naturalOverlayEnabled(undefined, false), false);
    assert.equal(naturalOverlayEnabled({}, false), true, 'unset = every view mode');
    assert.equal(naturalOverlayEnabled({ naturalOverlay: false }, true), false, 'false opts out entirely');
    assert.equal(naturalOverlayEnabled({ naturalOverlay: '3d' }, false), false, "'3d' closed in 2D");
    assert.equal(naturalOverlayEnabled({ naturalOverlay: '3d' }, true), true, "'3d' open in 3D");
  });
});
