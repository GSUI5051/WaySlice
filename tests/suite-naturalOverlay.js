/**
 * Natural landmark overlay tests: tag-model purity (the seven natural=*
 * values, the independent optionality of name and elevation, the
 * meters-canonical elevation parse across metric/feet/unitied/ambiguous
 * sources), the zoom gates, and the render-path invariants that keep the
 * feature a lightweight citizen of the road overlay (one GeoJSON source,
 * one symbol layer, no DOM markers, no interaction machinery). The live
 * mount/toggle/declutter behavior is verified against a real map by the
 * acceptance tool.
 */
import { suite, test, assert } from './runner.js';
import {
  NATURAL_TYPES, NATURAL_POI_TYPES, TILE_NATURAL_CLASSES, NATURAL_SOURCE_ID, NATURAL_LAYERS,
  NATURAL_GATES, NATURAL_ICON_SIZES, NATURAL_TEXT_SIZES,
  NATURAL_TILE_MAX_ZOOM, LATCH_BOOST, OVERPASS_ELEMENT_CAP,
  parseElevationTag, parseFeetTag, canonicalElevationMeters, localizedName, buildNaturalLabel,
  gateClassFor, overpassQuery, parseOverpassElements, peaksFromTileFeatures, mergeModels,
  buildNaturalFeatureCollection, rasterizeNaturalIcon,
} from '../js/map/naturalOverlay.js';
import { ROAD_OVERLAY_LABEL_FONT, overlayNameKeys, ROAD_OVERLAY_SOURCE_ID } from '../js/map/roadOverlay.js';
import { setUnitSystem } from '../js/units/units.js';
import { setLanguage } from '../js/language/language.js';
import '../js/language/langs.js';

suite('natural overlay / the seven types', () => {
  test('exactly the seven spec values are supported', () => {
    assert.deepEqual(NATURAL_TYPES, [
      'peak', 'saddle', 'volcano', 'cave_entrance', 'spring', 'rock', 'stone',
    ]);
  });

  test('the tile feed takes only the three point landforms — cliff/ridge stay out', () => {
    assert.deepEqual(TILE_NATURAL_CLASSES, ['peak', 'saddle', 'volcano']);
    const lifted = peaksFromTileFeatures([
      { properties: { class: 'peak', ele: 957, rank: 1 }, geometry: { type: 'Point', coordinates: [114.0, 22.5] } },
      // The planet tiles really do carry these two in mountain_peak.
      { properties: { class: 'cliff' }, geometry: { type: 'Point', coordinates: [114.0, 22.5] } },
      { properties: { class: 'ridge' }, geometry: { type: 'Point', coordinates: [114.0, 22.5] } },
      { properties: { class: 'peak' }, geometry: { type: 'LineString', coordinates: [[114, 22], [114.1, 22.1]] } },
      { properties: { class: 'peak' }, geometry: { type: 'Point', coordinates: [NaN, 22.5] } },
    ]);
    assert.equal(lifted.length, 1, 'only the valid point peak survives');
    assert.equal(lifted[0].type, 'peak');
  });

  test('the Overpass feed takes only the four tile-absent values', () => {
    assert.deepEqual(NATURAL_POI_TYPES, ['cave_entrance', 'spring', 'rock', 'stone']);
    const features = parseOverpassElements({ elements: [
      { type: 'node', lat: 47.5, lon: 13.0, tags: { natural: 'spring', name: 'Quelle' } },
      { type: 'node', lat: 47.5, lon: 13.1, tags: { natural: 'peak', name: 'must come from tiles' } },
      { type: 'node', lat: 47.5, lon: 13.2, tags: { natural: 'beach' } },
      { type: 'way', lat: 47.5, lon: 13.3, tags: { natural: 'rock' } },
      { type: 'node', lat: 47.5, lon: 13.4, tags: { amenity: 'cafe' } },
    ] });
    assert.equal(features.length, 1, 'non-target values and non-nodes are dropped');
    assert.equal(features[0].type, 'spring');
  });

  test('the Overpass query names exactly the four types over the padded bbox', () => {
    const q = overpassQuery({ s: 47.0, w: 12.5, n: 48.0, e: 13.5 });
    for (const t of NATURAL_POI_TYPES) {
      assert.truthy(q.includes(`node["natural"="${t}"]`), `query clause for ${t}`);
    }
    assert.truthy(q.includes('[bbox:47,12.5,48,13.5]'), 'south,west,north,east order');
    assert.truthy(q.includes(`out body ${OVERPASS_ELEMENT_CAP} qt;`), 'the server truncates before the network');
    assert.truthy(!q.includes('peak'), 'peaks never ride Overpass — the tiles already carry them');
  });

  test('the element cap is 4000, enforced again at parse time', () => {
    assert.equal(OVERPASS_ELEMENT_CAP, 4000);
    const elements = [];
    for (let i = 0; i < 5000; i++) {
      elements.push({ type: 'node', lat: 50 + (i % 1000) / 10000, lon: 14 + i / 10000, tags: { natural: 'stone' } });
    }
    const out = parseOverpassElements({ elements });
    assert.truthy(out.length <= OVERPASS_ELEMENT_CAP, `a 5000-element response parses to ≤ 4000, got ${out.length}`);
    assert.equal(out.length, 4000);
  });

  test('overlapping tiles dedup to one feature per summit', () => {
    const mk = (lon) => ({ properties: { class: 'peak', rank: 2 }, geometry: { type: 'Point', coordinates: [lon, 22.5] } });
    assert.equal(peaksFromTileFeatures([mk(114.000001), mk(114.0000009), mk(114.001)]).length, 2);
  });
});

suite('natural overlay / deep-zoom hold', () => {
  const mk = (type, lon, lat, extra = {}) => ({ type, lon, lat, tags: { natural: type }, rank: 5, ...extra });

  test('the tile maxzoom is pinned to the road source TileJSON value', () => {
    assert.equal(NATURAL_TILE_MAX_ZOOM, 14);
  });

  test('an empty lift returns the held set untouched', () => {
    const kept = [mk('peak', 114, 22.5)];
    assert.equal(mergeModels(kept, []), kept, 'same array, no rewrap');
    assert.deepEqual(mergeModels([], []), []);
  });

  test('only new keys are appended — kept entries keep their rank and name', () => {
    const kept = [mk('peak', 114, 22.5, { rank: 1, tags: { natural: 'peak', name: 'Tai Mo Shan', ele: '957' } })];
    const merged = mergeModels(kept, [
      mk('peak', 114, 22.5), // same summit returning from an overzoomed query — the kept state wins
      mk('volcano', 138.5, 35.4),
    ]);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].rank, 1, 'kept rank survives');
    assert.equal(merged[0].tags.name, 'Tai Mo Shan', 'kept name survives');
    assert.equal(merged[1].type, 'volcano', 'the new key is appended');
  });

  test('same class at different coordinates stays two summits', () => {
    const merged = mergeModels([mk('peak', 114, 22.5)], [mk('peak', 114.1, 22.5)]);
    assert.equal(merged.length, 2, 'the key carries the coordinates, not just the class');
  });
});

suite('natural overlay / see-become-latched', () => {
  const key = (type, lon, lat) => `${type}@${lon.toFixed(5)},${lat.toFixed(5)}`;
  const rankOf = (model, latched) => buildNaturalFeatureCollection([model], [], latched).features[0].properties.sortRank;

  test('unlatched features carry the base collision rank', () => {
    assert.equal(rankOf({ type: 'peak', lon: 114, lat: 22.5, tags: {}, rank: 5 }, new Set()), 2);
  });

  test('a latched summit drops base minus the boost — a negative sortRank', () => {
    assert.equal(LATCH_BOOST, 20);
    const model = { type: 'peak', lon: 114, lat: 22.5, tags: {}, rank: 5 };
    const rank = rankOf(model, new Set([key('peak', 114, 22.5)]));
    assert.equal(rank, 2 - 20);
    assert.truthy(rank < 0, 'negative ranks win symbol-sort-key placement');
  });

  test('only the tile trio latches — small classes keep their base rank', () => {
    const bases = { cave_entrance: 6, spring: 7, rock: 8, stone: 9 };
    for (const [type, base] of Object.entries(bases)) {
      const model = { type, lon: 14.1, lat: 50.9, tags: {}, rank: 5 };
      assert.equal(rankOf(model, new Set([key(type, 14.1, 50.9)])), base, `${type} is never boosted`);
    }
  });

  test('the latch key carries coordinates — a latched summit never boosts a same-class neighbor', () => {
    const model = { type: 'peak', lon: 114.1, lat: 22.5, tags: {}, rank: 5 };
    assert.equal(rankOf(model, new Set([key('peak', 114, 22.5)])), 2, 'different summit, no boost');
  });

  test('omitting the latch set renders every feature unlatched', () => {
    const fc = buildNaturalFeatureCollection(
      [{ type: 'peak', lon: 114, lat: 22.5, tags: {}, rank: 5 }], [],
    );
    assert.equal(fc.features[0].properties.sortRank, 2);
  });
});

suite('natural overlay / name and elevation are independent', () => {
  test('all four name/ele combinations produce a model — none is filtered out', () => {
    const combos = [
      [{ name: 'Tai Mo Shan' }, { ele: '957' }],
      [{ name: 'Tai Mo Shan' }, {}],
      [{}, { ele: '957' }],
      [{}, {}],
    ];
    for (const [nameTags, eleTags] of combos) {
      const tags = { ...nameTags, ...eleTags, natural: 'peak' };
      const fc = buildNaturalFeatureCollection([{ type: 'peak', lon: 114, lat: 22.5, tags, rank: 1 }], []);
      assert.equal(fc.features.length, 1, `feature kept for ${JSON.stringify(tags)}`);
      assert.equal(fc.features[0].geometry.type, 'Point');
    }
  });

  test('label text: name+ele stacks, each alone renders, neither renders the tag', () => {
    setUnitSystem('metric');
    assert.equal(buildNaturalLabel('Mount Example', '', 842), 'Mount Example\n842 m');
    assert.equal(buildNaturalLabel('Mount Example', '', null), 'Mount Example');
    assert.truthy(buildNaturalLabel('', '', 842).includes('842'), 'elevation alone labels the feature');
    assert.equal(buildNaturalLabel('', '', null), '', 'bare icon — never the internal natural=peak tag');
  });

  test('the local sub-name stacks between the main name and the elevation', () => {
    setUnitSystem('metric');
    assert.equal(buildNaturalLabel('Mount Example', '本地名', 842), 'Mount Example\n本地名\n842 m');
  });

  test('a sub-name identical to the main name never repeats — case-insensitively', () => {
    assert.equal(buildNaturalLabel('Tai Mo Shan', 'Tai Mo Shan', null), 'Tai Mo Shan');
    assert.equal(buildNaturalLabel('Tai Mo Shan', 'tai mo shan', 842), 'Tai Mo Shan\n842 m');
  });

  test('a sub-name without a main name still labels; all three missing is empty', () => {
    assert.equal(buildNaturalLabel('', 'Quelle', null), 'Quelle');
    assert.equal(buildNaturalLabel('', 'Quelle', 520), 'Quelle\n520 m');
    assert.equal(buildNaturalLabel('', '', null), '');
  });

  test('the built feature label is main name over the raw local name over the elevation', async () => {
    await setLanguage('de');
    setUnitSystem('metric');
    const fc = buildNaturalFeatureCollection([
      { type: 'peak', lon: -123.2, lat: 49.4, tags: { natural: 'peak', name: 'Mount Example', 'name:de': 'Beispielberg', ele: '1000' }, rank: 1 },
    ], []);
    // de UI picks name:de as the main name and formats the height the
    // German way — the label is composed from the live language + units.
    assert.equal(fc.features[0].properties.label, 'Beispielberg\nMount Example\n1.000 m');
    await setLanguage('en');
  });

  test('the name follows the same fallback chain as the road/place labels', () => {
    assert.deepEqual(overlayNameKeys('de'), ['name:de', 'name:en', 'name_int', 'name:latin', 'name']);
    assert.equal(localizedName({ name: 'raw', 'name:ja': '日本語名' }, 'ja'), '日本語名', 'UI language wins');
    assert.equal(localizedName({ name: 'raw', 'name:ja': '日本語名' }, 'de'), 'raw', 'falls through to the local name');
    assert.equal(localizedName({}, 'en'), '', 'nameless stays nameless');
  });

  test('elevation: metric parses, ele:ft parses, both present never double-show', () => {
    assert.equal(parseElevationTag('1234'), 1234);
    assert.equal(parseElevationTag('1234 m'), 1234);
    assert.equal(parseElevationTag('1234m'), 1234);
    assert.closeTo(parseElevationTag('4042 ft'), 1232.0016, 0.001);
    assert.closeTo(parseElevationTag("4042'"), 1232.0016, 0.001);
    assert.closeTo(parseElevationTag('-415'), -415, 0.0001, 'below-sea-level springs parse');
    assert.closeTo(parseFeetTag('4042'), 1232.0016, 0.001);
    assert.closeTo(parseFeetTag(4042), 1232.0016, 0.001, 'the tiles\' numeric ele_ft');
    // ele wins; ele:ft stays auxiliary — one canonical value, one label line.
    assert.equal(canonicalElevationMeters({ ele: '1234', 'ele:ft': '4042' }), 1234);
    assert.equal(canonicalElevationMeters({ 'ele:ft': '4042' }), canonicalElevationMeters({ ele: '1232.0016' }));
    assert.equal(canonicalElevationMeters({ ele: '1234' }), 1234, 'canonical unit is meters');
  });

  test('unparseable elevation degrades to unavailable, never a crash or a half-parsed number', () => {
    for (const bad of ['', '   ', 'abc', '12 furlongs', '1,234', null, undefined]) {
      assert.isNull(parseElevationTag(bad), `unparseable: ${JSON.stringify(bad)}`);
    }
    // A nameless+unparseable feature still renders — as a bare icon.
    const fc = buildNaturalFeatureCollection([
      { type: 'stone', lon: 14.18, lat: 50.92, tags: { natural: 'stone', ele: 'about yea big' } },
    ], []);
    assert.equal(fc.features.length, 1);
    assert.equal(fc.features[0].properties.label, '');
  });

  test('metric and imperial: the unit setting decides, never the raw source unit', async () => {
    await setLanguage('en');
    const digits = (s) => s.replace(/[^\d]/g, '');
    const unitOf = (s) => s.trim().split(/\s+/).pop();
    // A feet-only source (ele:ft=4042) must read METERS in metric mode.
    const metersOnly = canonicalElevationMeters({ 'ele:ft': '4042' });
    setUnitSystem('metric');
    const metric = buildNaturalLabel('', '', metersOnly);
    assert.equal(unitOf(metric), 'm', 'metric mode shows meters');
    assert.equal(Number(digits(metric)), 1232, 'converted from the feet source');
    // And a meters-only source must read FEET in imperial mode.
    setUnitSystem('imperial');
    const imperial = buildNaturalLabel('', '', canonicalElevationMeters({ ele: '842' }));
    assert.equal(unitOf(imperial), 'ft', 'imperial mode shows feet');
    assert.equal(Number(digits(imperial)), 2762, '842 m → 2762 ft, integer display');
    setUnitSystem('metric');
  });
});

suite('natural overlay / zoom gates', () => {
  /** Per-gate-class value map at one zoom stop of a single-curve gate. */
  function classStop(curve, zoom, message) {
    assert.equal(curve[0], 'interpolate', message);
    assert.deepEqual(curve[2], ['zoom'], message);
    for (let i = 3; i < curve.length; i += 2) {
      if (curve[i] !== zoom) continue;
      const match = curve[i + 1];
      const out = {};
      for (let j = 2; j < match.length - 1; j += 2) {
        for (const key of Array.isArray(match[j]) ? match[j] : [match[j]]) out[key] = match[j + 1];
      }
      return out;
    }
    throw new Error(`${message}: no stop for zoom ${zoom}`);
  }

  test('icons open before labels, majors lead, stone/rock/spring stay quiet until high zoom', () => {
    for (const [cls, { icon, text }] of Object.entries(NATURAL_GATES)) {
      assert.truthy(text >= icon, `${cls}: label never precedes its icon`);
      assert.truthy(text - icon >= 0.5 && text - icon <= 3, `${cls}: label follows within a sensible step`);
    }
    const iconAt = (cls, zoom) => classStop(NATURAL_ICON_SIZES, zoom, 'icons')[cls];
    const textAt = (cls, zoom) => classStop(NATURAL_TEXT_SIZES, zoom, 'text')[cls];
    // At the layer's minzoom (8) only the two majors show — below it the
    // curve clamps to the z8 row and the layer minzoom keeps the map quiet.
    for (const cls of Object.keys(NATURAL_GATES)) {
      const expected = cls === 'peak-major' || cls === 'volcano-major' ? 0.5 : 0;
      assert.equal(iconAt(cls, 8), expected, `${cls} gate at z8`);
    }
    // A class stays exactly 0 through its last zero stop and enters AT the
    // next stop (fading in between — the place-label curve convention).
    assert.equal(iconAt('stone', 14.5), 0, 'stone still hidden at z14.5');
    assert.equal(iconAt('stone', 15.5), 0.5, 'stone enters at z15.5');
    assert.equal(iconAt('rock', 13.5), 0, 'rock hidden at z13.5');
    assert.equal(iconAt('rock', 14.5), 0.5, 'rock enters at z14.5');
    assert.equal(iconAt('spring', 13), 0, 'spring hidden at z13');
    assert.equal(iconAt('spring', 13.5), 0.5, 'spring enters at z13.5');
    assert.equal(iconAt('saddle', 11), 0, 'saddle hidden at z11');
    assert.equal(iconAt('saddle', 12), 0.5, 'saddle enters at z12');
    // Labels open a notch later than icons everywhere.
    assert.equal(textAt('peak', 12.5), 0, 'peak label hidden at z12.5');
    assert.equal(textAt('peak', 13), 11.25, 'peak label from z13');
    assert.equal(textAt('stone', 15.5), 0, 'stone label hidden at z15.5');
    assert.equal(textAt('stone', 16.5), 11.5, 'stone label from z16.5');
    assert.equal(textAt('cave_entrance', 14.5), 11.5, 'cave label from z14.5');
    // Small-class alignment anchors (specs/ ZCode Prompt - Natural
    // small-class size alignment.md): the four Overpass classes converge on
    // the trio's 13.75 by z19 and ride the shared icon growth model.
    assert.equal(iconAt('spring', 15.5), 0.6, 'spring icon rides the cave ramp through z15.5');
    assert.equal(textAt('stone', 19), 13.75, 'stone label reaches the trio terminal at z19');
    assert.equal(textAt('rock', 16), 12.5, 'rock label mid-ramp at z16');
  });

  test('every gate is one single zoom curve (MapLibre silently rejects nested ones)', () => {
    for (const expr of [NATURAL_ICON_SIZES, NATURAL_TEXT_SIZES]) {
      const blob = JSON.stringify(expr);
      assert.equal(blob.split('"zoom"').length - 1, 1, 'exactly one zoom reference');
    }
  });
});

suite('natural overlay / render path', () => {
  test('one GeoJSON source, one symbol layer — no per-feature DOM markers', () => {
    assert.equal(NATURAL_LAYERS.length, 1, 'a single layer renders all seven types');
    const layer = NATURAL_LAYERS[0];
    assert.equal(layer.type, 'symbol', 'symbol layers create no DOM elements');
    assert.equal(layer.source, NATURAL_SOURCE_ID);
    assert.equal(layer.minzoom, 8, 'nothing renders before the first gate');
  });

  test('the label is a plain property — the local sub-name is composed JS-side, never by a bilingual text-field', () => {
    const layer = NATURAL_LAYERS[0];
    assert.deepEqual(layer.layout['text-field'], ['get', 'label'], 'text comes from the built label property, sub-name included');
    assert.deepEqual(layer.layout['text-font'], ROAD_OVERLAY_LABEL_FONT, 'shared glyph set');
    // mapView rewrites text-field only for the tile-source label layers; the
    // natural layer's source binding is what keeps it out of that pass — the
    // sub-name must keep arriving through the JS-composed `label` property.
    assert.truthy(layer.source !== ROAD_OVERLAY_SOURCE_ID, 'not bound to the tile source');
  });

  test('small classes carry the 1.05em label offset, the trio keeps 0.6 — per-class match', () => {
    const offset = NATURAL_LAYERS[0].layout['text-offset'];
    assert.deepEqual(offset.slice(0, 2), ['match', ['get', 'naturalClass']]);
    assert.deepEqual(offset[2], ['cave_entrance', 'spring', 'rock', 'stone']);
    assert.deepEqual(offset[3], ['literal', [0, 1.05]], 'the small-class offset');
    assert.deepEqual(offset[4], ['literal', [0, 0.6]], 'the trio offset is untouched');
  });

  test('feature properties carry the identification the click model promises', () => {
    const fc = buildNaturalFeatureCollection([
      { type: 'volcano', lon: 138.5, lat: 35.4, tags: { natural: 'volcano', name: 'Fuji', ele: '3776' }, rank: 1 },
    ], []);
    const props = fc.features[0].properties;
    assert.equal(props.naturalClass, 'volcano', 'type');
    assert.equal(props.label, 'Fuji\n3,776 m', 'name + elevation through the shared formatter');
    assert.equal(props.gateClass, 'volcano-major', 'rank 1 rides the early gate');
    assert.truthy(Number.isFinite(props.sortRank), 'collision priority present');
  });

  test('importance tiering is a two-way split, not a ranking system', () => {
    assert.equal(gateClassFor('peak', 1), 'peak-major');
    assert.equal(gateClassFor('peak', 2), 'peak-major');
    assert.equal(gateClassFor('peak', 3), 'peak');
    assert.equal(gateClassFor('peak', undefined), 'peak', 'rankless features ride the base gate');
    assert.equal(gateClassFor('stone', 1), 'stone', 'small types have no major tier');
  });

  test('garbage Overpass responses degrade to an empty set', () => {
    assert.deepEqual(parseOverpassElements(null), []);
    assert.deepEqual(parseOverpassElements({}), []);
    assert.deepEqual(parseOverpassElements({ elements: 'nope' }), []);
  });
});

suite('natural overlay / sprite fills', () => {
  /** RGBA of one pixel of a rasterized sprite (center samples sit far from
   * halo edges, so the value is the plain fill/stroke color). */
  const pixel = (image, x, y) => {
    const i = (y * image.width + x) * 4;
    return [image.data[i], image.data[i + 1], image.data[i + 2], image.data[i + 3]];
  };
  const closeToColor = (actual, expected, message) => {
    for (let i = 0; i < 4; i++) {
      assert.truthy(Math.abs(actual[i] - expected[i]) <= 2, `${message}: channel ${i} — expected ~${expected}, got ${actual}`);
    }
  };

  test('the volcano body fills with the fixed hr red, the peak stays white', () => {
    // Body interiors, ≥2 units clear of every edge in the 24-unit space.
    const volcano = pixel(rasterizeNaturalIcon('volcano', 48), 24, 26);
    closeToColor(volcano, [239, 68, 68, 255], 'volcano fill = --series-hr #ef4444');
    const peak = pixel(rasterizeNaturalIcon('peak', 48), 24, 28);
    closeToColor(peak, [255, 255, 255, 255], 'peak fill stays white');
  });

  test('the eruption scratches ride the 5%-translucent white stroke', () => {
    const scratch = pixel(rasterizeNaturalIcon('volcano', 48), 24, 6);
    closeToColor(scratch, [244, 244, 244, 254], 'volcano line details stay white at 0.95 alpha');
  });

  test('the fill is theme-independent — no re-rasterization difference', () => {
    const root = document.documentElement;
    const before = pixel(rasterizeNaturalIcon('volcano', 48), 24, 26);
    const prev = root.getAttribute('data-theme');
    root.setAttribute('data-theme', prev === 'dark' ? 'light' : 'dark');
    const after = pixel(rasterizeNaturalIcon('volcano', 48), 24, 26);
    if (prev == null) root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', prev);
    closeToColor(after, before, 'volcano fill identical across themes');
  });
});
