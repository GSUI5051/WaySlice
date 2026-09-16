/**
 * Language system core.
 *
 * Design goals (see README "Adding a language"):
 * - every language is ONE plain data file (`lang-xx.js`) that self-registers;
 * - translators never touch application code;
 * - missing keys fall back to English, then to the key itself — the UI can
 *   never show `undefined`;
 * - packs load on demand: the boot language plus the English fallback at
 *   startup, any other pack the first time it is picked. The catalog in
 *   `langs.js` carries only codes and native names, so listing seven
 *   languages does not mean downloading seven dictionaries.
 *
 * The canonical language is English. All user-visible strings in the app go
 * through `t()`.
 */
import { emit } from '../core/events.js';
import { LANGUAGE_CATALOG } from './langs.js';

const STORAGE_KEY = 'wayslice-language';
export const FALLBACK_LANGUAGE = 'en';

/** Packs whose module has been imported — dict available. */
const registry = new Map();
/** Catalog entries by code — metadata for every supported language. */
const catalog = new Map(LANGUAGE_CATALOG.map((entry) => [entry.code, entry]));

/** @type {string|null} */
let current = null;
/** Guards concurrent setLanguage calls: only the newest switch applies. */
let switchSeq = 0;

/**
 * Registers a language pack. Called from `lang-xx.js` files when their
 * module is imported (at boot for the current language, on first pick for
 * every other one).
 *
 * @param {string} code        BCP 47 tag, e.g. "pt-BR".
 * @param {string} nativeName  Language name in its own language, e.g. "Deutsch".
 * @param {Record<string, string>} dict  Flat key → translated string map.
 */
export function register(code, nativeName, dict) {
  registry.set(code, { nativeName, dict });
}

/**
 * True when `code` names a supported language — loaded or still catalog-only.
 * @private
 */
function isKnown(code) {
  return registry.has(code) || catalog.has(code);
}

/**
 * Imports a pack module if its dict is not loaded yet. The module
 * self-registers as an import side effect.
 * @private
 * @returns {Promise<boolean>} false when the pack failed to load or register
 */
async function ensureLoaded(code) {
  if (registry.has(code)) return true;
  const entry = catalog.get(code);
  if (!entry) return false;
  try {
    await entry.load();
  } catch (error) {
    console.warn(`[WaySlice] language pack "${code}" failed to load:`, error);
    return false;
  }
  return registry.has(code);
}

/**
 * Initializes the language: saved preference → browser language → English.
 * The English dict loads unconditionally (it backs every missing key), the
 * picked pack right after — the caller awaits this before rendering text.
 * Also runs a validation pass so missing keys are reported during development.
 */
export async function init() {
  await ensureLoaded(FALLBACK_LANGUAGE);
  current = pickInitialLanguage();
  if (!(await ensureLoaded(current))) current = FALLBACK_LANGUAGE;
  apply();
  const report = validate();
  if (report.length) {
    // Dev-mode guard: a typo in a language pack should surface here, not as
    // "undefined" on screen.
    console.warn('[WaySlice] language validation report:', report);
  }
}

/**
 * Decides the initial language.
 * @private
 */
function pickInitialLanguage() {
  let saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* ignore */ }
  if (saved && isKnown(saved)) return saved;

  const candidates = navigator.languages || [navigator.language || 'en'];
  const knownCodes = [...new Set([...registry.keys(), ...catalog.keys()])];
  for (const tag of candidates) {
    if (!tag) continue;
    if (isKnown(tag)) return tag;
    const lower = tag.toLowerCase();
    const base = lower.split('-')[0];
    const sameBase = knownCodes.filter((c) => c.toLowerCase().split('-')[0] === base);
    if (!sameBase.length) continue;
    // Prefer a supported variant whose full code appears in the tag
    // (e.g. "pt-BR" → pt-BR), otherwise the first supported variant.
    const refined = sameBase.find((c) => lower.includes(c.toLowerCase()));
    return refined || sameBase[0];
  }
  return FALLBACK_LANGUAGE;
}

/** @returns {string} current language code */
export function getCurrentLanguage() {
  return current || FALLBACK_LANGUAGE;
}

/** Locale tag used for Intl formatting (equals the language code). */
export function getLocale() {
  return getCurrentLanguage();
}

/**
 * Switches the UI language live: loads the pack if it is not loaded yet,
 * then persists the choice, updates <html lang>, and emits 'language:changed'
 * so every component re-renders. Resolves with nothing; a pack that fails to
 * load keeps the previous language (its strings fall back to English anyway).
 *
 * @param {string} code
 */
export async function setLanguage(code) {
  if (!isKnown(code)) return;
  const seq = ++switchSeq;
  if (!(await ensureLoaded(code)) || seq !== switchSeq) return;
  current = code;
  try { localStorage.setItem(STORAGE_KEY, code); } catch { /* ignore */ }
  apply();
  // Same dev guard as init(): a pack loaded after boot must still face the
  // canonical key check (validate() reads the loaded packs only).
  const report = validate();
  if (report.length) console.warn('[WaySlice] language validation report:', report);
}

/** @private */
function apply() {
  document.documentElement.lang = getCurrentLanguage();
  emit('language:changed', { language: getCurrentLanguage() });
}

/**
 * List of supported languages for selectors — catalog metadata plus any
 * test-registered pack that is not in the catalog.
 * @returns {{code:string, nativeName:string, current:boolean}[]}
 */
export function getLanguages() {
  const names = new Map(LANGUAGE_CATALOG.map(({ code, nativeName }) => [code, nativeName]));
  for (const [code, { nativeName }] of registry) {
    if (!names.has(code)) names.set(code, nativeName);
  }
  return [...names.entries()]
    .map(([code, nativeName]) => ({ code, nativeName, current: code === getCurrentLanguage() }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Translation lookup with fallback chain: current language → English → key.
 *
 * @param {string} key
 * @param {Record<string, string|number>} [vars]  Interpolates {name} placeholders.
 * @returns {string}
 */
export function t(key, vars) {
  const entry = registry.get(getCurrentLanguage());
  let text = entry && entry.dict[key];
  if (text == null) {
    const fallback = registry.get(FALLBACK_LANGUAGE);
    text = fallback && fallback.dict[key];
  }
  if (text == null) text = key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
    }
  }
  return text;
}

/**
 * Compares every LOADED pack against the English canonical keys.
 * Missing keys are fatal for translations (they fall back), unknown keys
 * usually indicate typos. Returns a report and logs a warning — used by
 * init(), by setLanguage() and by the test suite. Packs that have never
 * been loaded are invisible here; load them first (tests switch through
 * getLanguages(), the app does it when picked).
 *
 * @returns {{language:string, missing:string[], unknown:string[]}[]}
 */
export function validate() {
  const canonical = registry.get(FALLBACK_LANGUAGE);
  if (!canonical) return [];
  const canonicalKeys = new Set(Object.keys(canonical.dict));
  /** @type {{language:string, missing:string[], unknown:string[]}[]} */
  const report = [];
  for (const [code, { dict }] of registry) {
    if (code === FALLBACK_LANGUAGE) continue;
    const keys = new Set(Object.keys(dict));
    const missing = [...canonicalKeys].filter((k) => !keys.has(k));
    const unknown = [...keys].filter((k) => !canonicalKeys.has(k));
    if (missing.length || unknown.length) {
      report.push({ language: code, missing, unknown });
    }
  }
  return report;
}
