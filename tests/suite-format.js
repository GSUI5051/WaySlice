/**
 * Formatter-layer tests — the central number-formatting seam
 * (js/utils/format.js) and the machine-format boundaries around it.
 *
 * Number localization IS locale-driven: en/ja/ko use the dot decimal
 * separator, fr uses the comma — every default-locale assertion pins exactly
 * that per-language behavior. The explicit-locale calls (e.g.
 * formatNumber(4.88, 'de-DE')) are DEV VERIFICATION of the seam for future
 * languages — they are not reachable through the app UI and must not be read
 * as supported display behavior.
 */
import { suite, test, assert } from './runner.js';
import { setLanguage, getLanguages, getCurrentLanguage } from '../js/language/language.js';
import {
  formatNumber, formatPercent, formatBpmRange,
} from '../js/utils/format.js';
import { buildGpxExport } from '../js/export/exporter.js';
import { prepareTrack } from '../js/geo/track.js';
import { eastTrack } from './helpers.js';

suite('format / number seam (dev verification)', () => {
  test('explicit en-US keeps the dot decimal', () => {
    assert.equal(formatNumber(4.88, 'en-US'), '4.88');
  });

  test('explicit de-DE / fr-FR use the comma decimal — future seam, not current UI', () => {
    assert.equal(formatNumber(4.88, 'de-DE'), '4,88');
    assert.equal(formatNumber(4.88, 'fr-FR'), '4,88');
  });

  test('default locale follows the UI language — dots, except the French comma', async () => {
    const saved = getCurrentLanguage();
    try {
      for (const code of ['en', 'ja', 'ko']) {
        await setLanguage(code);
        assert.equal(formatNumber(4.88), '4.88', `${code} must keep the dot decimal`);
      }
      await setLanguage('fr');
      assert.equal(formatNumber(4.88), '4,88', 'fr localizes the decimal separator');
    } finally {
      await setLanguage(saved);
    }
  });
});

suite('format / percent and bpm range', () => {
  test('formatPercent: integer percent values, no decimals', () => {
    assert.equal(formatPercent(0), '0%');
    assert.equal(formatPercent(48), '48%');
    assert.equal(formatPercent(100), '100%');
  });

  test('formatPercent rounds fractional input to whole percents', () => {
    assert.equal(formatPercent(48.4), '48%');
    assert.equal(formatPercent(48.5), '49%');
  });

  test('formatPercent: non-finite renders the em dash', () => {
    assert.equal(formatPercent(NaN), '—');
  });

  test('formatBpmRange: closed zone and open-top zone', () => {
    assert.equal(formatBpmRange(133, 151), '133–151 bpm');
    assert.equal(formatBpmRange(171, null), '171+ bpm');
  });
});

suite('format / machine-format boundaries', () => {
  test('GPX numeric values stay canonical dot decimals in every UI language', async () => {
    const track = prepareTrack(eastTrack({
      count: 4,
      ele: (i) => 100 + i * 10 + 0.55, // fractional ele forces a decimal separator
      time: (i) => i * 60000,
    }), 'Test Track');
    const canonical = /^-?\d+(\.\d+)?$/;
    const saved = getCurrentLanguage();
    try {
      for (const { code } of getLanguages()) {
        await setLanguage(code);
        const text = buildGpxExport(track, { start: 0, end: track.totalDistance });
        const nums = [
          ...[...text.matchAll(/(?:lat|lon)="([^"]*)"/g)].map((m) => m[1]),
          ...[...text.matchAll(/<ele>([^<]*)<\/ele>/g)].map((m) => m[1]),
        ];
        assert.truthy(nums.length >= 12, `sampled enough GPX numbers (${nums.length})`);
        for (const n of nums) {
          assert.truthy(canonical.test(n), `${code}: non-canonical GPX number "${n}"`);
        }
      }
    } finally {
      await setLanguage(saved);
    }
  });
});
