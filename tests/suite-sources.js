/** Basemap catalog tests: source shape, i18n labels, default source. */
import { suite, test, assert } from './runner.js';
import {
  MAP_SOURCES, groupedSources, DEFAULT_SOURCE_ID,
  getSavedSource, getSavedSourceId,
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
    assert.deepEqual(idsFor('street'), ['osm', 'OpenFreeMapBright', 'TFAtlas']);
    assert.deepEqual(idsFor('minimal'), ['OpenFreeMapPositron', 'OpenFreeMapDark', 'StadiaSmooth', 'StadiaSmoothDark']);
  });

  test('vector style sources point at their provider style endpoints', () => {
    const vector = MAP_SOURCES.filter((s) => s.styleUrl);
    assert.deepEqual(vector.map((s) => s.id).sort(), ['OpenFreeMapBright', 'OpenFreeMapDark', 'OpenFreeMapPositron', 'StadiaSmooth', 'StadiaSmoothDark', 'TFAtlas']);
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
