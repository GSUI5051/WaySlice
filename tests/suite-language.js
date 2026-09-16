/** Language system tests: fallback chain, interpolation, validation, DOM sync. */
import { suite, test, assert } from './runner.js';
import * as language from '../js/language/language.js';
import '../js/language/langs.js';

suite('language / registry & selection', () => {
  test('official packs are listed with native names', () => {
    const codes = language.getLanguages().map((l) => l.code).sort();
    assert.equal(JSON.stringify(codes), JSON.stringify(['de', 'en', 'es', 'fr', 'it', 'ja', 'ko']));
  });

  test('setLanguage loads the pack, updates <html lang> and persists the choice', async () => {
    await language.setLanguage('de');
    assert.equal(document.documentElement.lang, 'de');
    assert.equal(localStorage.getItem('wayslice-language'), 'de');
    await language.setLanguage('en');
    assert.equal(document.documentElement.lang, 'en');
  });

  test('initial language: saved preference beats browser language', async () => {
    localStorage.setItem('wayslice-language', 'ja');
    await language.init();
    assert.equal(language.getCurrentLanguage(), 'ja');
    await language.setLanguage('en');
  });
});

suite('language / translation lookup', () => {
  test('t() returns the translated string', () => {
    assert.equal(language.t('distance'), 'Distance');
  });

  test('missing keys fall back to English, then to the key — never undefined', async () => {
    language.register('xx-test', 'Test Language', { onlyHere: 'Nur hier' });
    await language.setLanguage('xx-test');
    assert.equal(language.t('onlyHere'), 'Nur hier');
    assert.equal(language.t('elevationGain'), 'Elevation Gain'); // en fallback
    assert.equal(language.t('definitelyNotAKey'), 'definitelyNotAKey'); // key fallback
    await language.setLanguage('en');
  });

  test('interpolation replaces {placeholders}', async () => {
    assert.equal(language.t('pointsCount', { n: 42 }), '42 points');
    await language.setLanguage('de');
    assert.equal(language.t('pointsCount', { n: 42 }), '42 Trackpunkte');
    await language.setLanguage('en');
  });

  test('official packs are complete (no missing keys vs en)', async () => {
    // Packs load on demand — pull every catalog pack before comparing keys.
    for (const { code } of language.getLanguages()) {
      await language.setLanguage(code);
    }
    await language.setLanguage('en');
    const report = language.validate().filter((r) => !r.language.startsWith('xx-'));
    assert.equal(report.length, 0, `incomplete packs: ${JSON.stringify(report)}`);
  });

  test('validate() reports missing keys for incomplete packs', () => {
    language.register('xx-partial', 'Partial', { distance: 'Distanz' });
    const report = language.validate();
    const partial = report.find((r) => r.language === 'xx-partial');
    assert.truthy(partial);
    assert.truthy(partial.missing.includes('elevationGain'));
    assert.equal(partial.unknown.length, 0);
  });
});
