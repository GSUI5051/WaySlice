/**
 * The story dialog — the "author's story" popup opened from the settings
 * drawer's About section. Desktop presents the
 * same window as the dual-variable analysis dialog; phones get an 80 vh
 * popup (the geometry lives in css/story.css).
 *
 * The content is the standalone /about/story.html page hosted in an iframe,
 * so the page keeps its own language pack in /about and its own
 * theme boot — it follows language and theme changes through localStorage
 * storage events on its own. The src is re-set on every open, so the page
 * re-resolves both preferences at load time even without an open listener.
 * The drawer stays open underneath, like the heart-rate zone editor.
 *
 * The same window also hosts the About section's privacy entry: the
 * standalone /about/privacy.html page, built exactly like the story page
 * (own pack + loader in /about), swapped in via the open argument —
 * identical geometry and chrome, other iframe content.
 */
import { t } from '../language/language.js';
import { icon } from './icons.js';
import { on } from '../core/events.js';

let dialog = null;
let frame = null;
let closeBtn = null;
let title = null;
let opener = null;

/** Wires the story dialog. @param {HTMLDialogElement} storyDialog */
export function initStoryDialog(storyDialog) {
  dialog = storyDialog;
  frame = dialog.querySelector('#story-frame');
  closeBtn = dialog.querySelector('#story-close');
  title = dialog.querySelector('#story-title');

  closeBtn.innerHTML = icon('x');
  closeBtn.setAttribute('aria-label', t('close'));
  closeBtn.addEventListener('click', () => dialog.close());
  // Clicks on the ::backdrop land on the dialog element itself — the same
  // close-on-backdrop behavior as the drawer and the analysis windows.
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => {
    opener?.setAttribute('aria-expanded', 'false');
    opener?.focus();
  });
  on('language:changed', () => {
    closeBtn.setAttribute('aria-label', t('close'));
    // The iframe hears the same change through its own storage listener;
    // nothing to do here beyond the aria-label.
  });
}

/**
 * Opens the story dialog over the still-open settings drawer. Call it
 * without arguments for the author's story; pass 'privacy' to host the
 * privacy page in the same window — identical geometry and chrome, other
 * iframe content.
 */
export function openStoryDialog(page = 'story') {
  const privacy = page === 'privacy';
  opener = document.activeElement;
  // Re-set the src on every open: the page re-resolves language and theme
  // from localStorage at load time.
  frame.src = privacy ? 'about/privacy.html' : 'about/story.html';
  frame.title = privacy ? 'WaySlice privacy' : 'WaySlice story';
  // The privacy page is English-only (like the story content), so its title
  // is a literal. The h2 keeps its data-i18n attribute: with the dialog
  // closed a language change re-applies it and restores the localized story
  // title, and every open re-resolves the title here anyway.
  title.textContent = privacy ? 'Privacy' : t('storyQuotes');
  opener?.setAttribute('aria-expanded', 'true');
  dialog.showModal();
  closeBtn.focus();
}
