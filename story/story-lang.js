/**
 * The story page's loader — loads the page's language file and renders it.
 * This build ships exactly one version: story-en.js (English).
 *
 * Theme follows the same 'wayslice-theme' preference the app shell boots
 * with. The page listens for storage events, so a theme switch in the app
 * (the story dialog stays open above the drawer) applies here live.
 */

/** Language file, relative to this page. */
const PACK_FILE = './story-en.js';

/** @private Import promise — the file loads at most once. */
let packPromise = null;

/** Loads the language file. The promise resolves to the pack OBJECT, not
 *  the module namespace.
 * @returns {Promise<object>} */
function loadPack() {
  if (!packPromise) packPromise = import(PACK_FILE).then((mod) => mod.STORY_EN);
  return packPromise;
}

/**
 * Renders one pack into the page anchors.
 * @param {{title: HTMLElement, tagline: HTMLElement, lede: HTMLElement,
 *   sections: HTMLElement}} els
 * @param {object} pack  the loaded story-en.js pack object
 */
export function renderStory(els, pack) {
  els.title.textContent = pack.heading;
  els.tagline.textContent = pack.tagline;
  els.lede.textContent = pack.lede;
  els.sections.replaceChildren(
    ...pack.sections.map((section) => {
      const h = document.createElement('h2');
      h.textContent = section.h;
      const box = document.createElement('section');
      box.appendChild(h);
      for (const text of section.ps) {
        const p = document.createElement('p');
        p.textContent = text;
        box.appendChild(p);
      }
      return box;
    }),
  );
}

/** @private Re-applies the app's theme preference to this document. */
function applyTheme() {
  let pref = 'system';
  try { pref = localStorage.getItem('wayslice-theme') || 'system'; } catch { /* ignore */ }
  if (pref !== 'light' && pref !== 'dark') pref = 'system';
  const dark = pref === 'dark' ||
    (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.themePref = pref;
  root.style.colorScheme = dark ? 'dark' : 'light';
}

// ---- page bootstrap (the test suite imports this module for the pure parts)
const els = {
  title: document.getElementById('story-page-title'),
  tagline: document.getElementById('story-page-tagline'),
  lede: document.getElementById('story-page-lede'),
  sections: document.getElementById('story-sections'),
};

if (els.title && els.tagline && els.lede && els.sections) {
  // Inside the story dialog's iframe the sheet head already carries the
  // title, so the page's own header hides (css/story.css).
  if (window.self !== window.top) document.body.classList.add('story-embedded');

  loadPack().then((pack) => {
    document.title = pack.title;
    document.documentElement.lang = pack.htmlLang;
    renderStory(els, pack);
  });
  applyTheme();

  // The app (the parent document of the iframe, or another tab) writes this
  // key; storage events only fire in OTHER same-origin documents, which is
  // exactly this page.
  window.addEventListener('storage', (e) => {
    if (e.key === 'wayslice-theme' || e.key === null) applyTheme();
  });
  window.matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', applyTheme);
}
