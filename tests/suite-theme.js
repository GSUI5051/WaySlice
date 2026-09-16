/** Theme tests: preference matrix, override priority, persistence. */
import { suite, test, assert } from './runner.js';
import { resolve, getPreference, setPreference, init } from '../js/theme/theme.js';

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

suite('theme / preference resolution matrix', () => {
  test('System → OS Light → Light', () => {
    assert.equal(resolve('system', false), 'light');
  });

  test('System → OS Dark → Dark', () => {
    assert.equal(resolve('system', true), 'dark');
  });

  test('Manual Light → OS Dark → Light (override wins)', () => {
    assert.equal(resolve('light', true), 'light');
  });

  test('Manual Dark → OS Light → Dark (override wins)', () => {
    assert.equal(resolve('dark', false), 'dark');
  });
});

suite('theme / application state', () => {
  test('setPreference persists and applies data-theme + color-scheme', () => {
    setPreference('dark');
    assert.equal(getPreference(), 'dark');
    assert.equal(document.documentElement.dataset.theme, 'dark');
    assert.equal(document.documentElement.style.colorScheme, 'dark');
    assert.equal(localStorage.getItem('wayslice-theme'), 'dark');

    setPreference('light');
    assert.equal(document.documentElement.dataset.theme, 'light');
    assert.equal(localStorage.getItem('wayslice-theme'), 'light');
  });

  test('system preference follows the OS (live, no reload)', () => {
    setPreference('system');
    assert.equal(getPreference(), 'system');
    const expected = systemDark() ? 'dark' : 'light';
    assert.equal(document.documentElement.dataset.theme, expected);
    assert.equal(document.documentElement.dataset.themePref, 'system');
  });

  test('init() restores a saved preference', () => {
    localStorage.setItem('wayslice-theme', 'dark');
    init();
    assert.equal(document.documentElement.dataset.theme, 'dark');
    // Restore system for other suites.
    setPreference('system');
  });
});
