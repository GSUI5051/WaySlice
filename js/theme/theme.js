/**
 * Theme system — three-state appearance preference (system / light / dark).
 *
 * The preference lives in localStorage as 'wayslice-theme'. "system"
 * follows prefers-color-scheme live (no reload), while explicit light/dark
 * override the OS. The actual theme is applied as `data-theme` on <html>
 * plus `color-scheme`, which an inline script in index.html sets *before*
 * first paint to avoid any flash of the wrong theme.
 */
import { emit } from '../core/events.js';

const STORAGE_KEY = 'wayslice-theme';

/** @typedef {'system'|'light'|'dark'} ThemePreference */

/** @returns {ThemePreference} */
export function getPreference() {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === 'light' || saved === 'dark' ? saved : 'system';
}

/**
 * Resolves a preference to a concrete theme.
 * Exported separately so the preference matrix is unit-testable.
 *
 * @param {ThemePreference} preference
 * @param {boolean} systemPrefersDark  matchMedia('(prefers-color-scheme: dark)').matches
 * @returns {'light'|'dark'}
 */
export function resolve(preference, systemPrefersDark) {
  if (preference === 'light') return 'light';
  if (preference === 'dark') return 'dark';
  return systemPrefersDark ? 'dark' : 'light';
}

/** The concrete theme currently applied to the document. */
export function getResolved() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/**
 * Applies a preference: persists it, updates <html data-theme> and
 * color-scheme, refreshes the browser UI color, and notifies the app.
 *
 * @param {ThemePreference} preference
 */
export function setPreference(preference) {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch { /* private mode — preference just won't persist */ }
  apply(preference);
}

/** Initializes the module and starts listening for OS theme changes. */
export function init() {
  apply(getPreference());
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (getPreference() === 'system') apply('system');
  };
  if (media.addEventListener) media.addEventListener('change', onChange);
  else media.addListener(onChange); // older Safari
}

/** @private */
function apply(preference) {
  const resolved = resolve(preference, window.matchMedia('(prefers-color-scheme: dark)').matches);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePref = preference;
  root.style.colorScheme = resolved;

  // Keep the browser UI (mobile chrome, title bar) in sync.
  const bg = getComputedStyle(root).getPropertyValue('--background').trim();
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  if (bg) meta.content = bg;

  emit('theme:changed', { preference, resolved });
}
