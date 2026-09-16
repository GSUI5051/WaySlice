/**
 * Language pack catalog — the ONLY file a new language touches beyond its
 * own `lang-xx.js`: add one entry here.
 * (lang-template.js is intentionally not listed; contributors copy it.)
 *
 * Entries are METADATA (code + native name + lazy loader), so the language
 * picker can list every language without downloading any dictionary. The
 * packs themselves load on demand — the boot language and the English
 * fallback first, every other pack the first time it is picked (language.js
 * awaits the loader; the pack then self-registers via `register()` exactly
 * as it did when this file still imported it statically).
 */
export const LANGUAGE_CATALOG = [
	{ code: 'en', nativeName: 'English', load: () => import('./lang-en.js') },
	{ code: 'ko', nativeName: '한국어', load: () => import('./lang-ko.js') },
	{ code: 'ja', nativeName: '日本語', load: () => import('./lang-ja.js') },
	{ code: 'fr', nativeName: 'Français', load: () => import('./lang-fr.js') },
	{ code: 'de', nativeName: 'Deutsch', load: () => import('./lang-de.js') },
	{ code: 'es', nativeName: 'Español', load: () => import('./lang-es.js') },
	{ code: 'it', nativeName: 'Italiano', load: () => import('./lang-it.js') },
];
