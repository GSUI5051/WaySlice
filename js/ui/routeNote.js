/**
 * Header route-source notice — a lone warning square right after the file
 * chip, shown only for degraded route GPX files (sourceType 'route'). The
 * shape and palette follow the chip's compact info button (same pill,
 * popover lifecycle and close contract); the triangle wears the heart-rate
 * curve red, the chart's alarm color. Clicking it opens the full notice
 * sentence in the same kind of popover the compact chip uses.
 */
import { trackStore } from '../core/stores.js';
import { t } from '../language/language.js';
import { on } from '../core/events.js';
import { createHintPopover } from './hint-popover.js';

/** The notice's popover — shared singleton lifecycle (js/ui/hint-popover.js),
 *  left-aligned under the marker like the chip's. @private */
const notePop = createHintPopover({ variantClass: 'file-chip-popover', align: 'left' });

/** @type {HTMLElement|null} the warning square */
let btn = null;

/** Binds the marker's DOM and the track/language wiring. Call once from boot. */
export function initRouteNote() {
  btn = document.getElementById('route-note');

  btn.addEventListener('click', () => {
    if (notePop.isOpen) {
      closeNote();
    } else {
      notePop.open(btn, (pop) => {
        const row = document.createElement('div');
        row.className = 'file-chip-pop-row';
        row.textContent = t('routeSourceNote');
        pop.appendChild(row);
      });
      btn.setAttribute('aria-expanded', 'true');
    }
  });
  // Same close contract as the chip's popover: any click outside the marker,
  // any scroll, Escape. A language switch closes it too — an open sentence
  // would go stale.
  document.addEventListener('click', (event) => {
    if (notePop.isOpen && !btn.contains(event.target)) closeNote();
  });
  document.addEventListener('scroll', closeNote, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeNote();
  });
  on('language:changed', () => {
    closeNote();
    refreshNoteLabel();
  });

  // Visibility rides the track store: only a route-source track shows the
  // square, and loading any ordinary track hides it again.
  trackStore.subscribe((track) => {
    const route = !!track && track.sourceType === 'route';
    btn.hidden = !route;
    if (!route) closeNote();
    refreshNoteLabel();
  });
}

/** @private aria-label + native tooltip in the active language. */
function refreshNoteLabel() {
  btn.setAttribute('aria-label', t('routeSourceNote'));
  btn.title = t('routeSourceNote');
}

/**
 * True while a route-source track is loaded — the state in which the
 * warning square shows (or, at the header's emergency level, the state in
 * which the square is folded away and the chip's popover carries the
 * warning in its place; see ui/headerFit.js and ui/fileChip.js).
 */
export function routeNoteActive() {
  return !!btn && !btn.hidden;
}

/** @private Closes the open popover, if any. Safe to call when closed. */
function closeNote() {
  notePop.close();
  btn.setAttribute('aria-expanded', 'false');
}
