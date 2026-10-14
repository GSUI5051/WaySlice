/**
 * Header cadence-convention notice — a lone square right after the route
 * note, shown while the loaded track carries cadence whose reading depends
 * on the file's convention (js/parsers/cadenceConvention.js judges it for
 * FIT; every other format is 'unknown'):
 *
 *   single   the values were single-leg cycles, WaySlice converts ×2 —
 *            the square says the numbers are steps per minute;
 *   unknown  the convention could not be determined (no step-length data),
 *            the square says raw device values are shown.
 *
 * The shape and palette follow the route-source notice (same pill, popover
 * lifecycle and close contract); the (i) icon wears the accent color — this
 * is an explanation, not the route warning's alarm. Two separate sentences
 * by design: "converted" and "cannot determine" mean opposite things and
 * must never merge.
 *
 * At the header's emergency level the square folds away (layout.css) and
 * its sentence moves into the chip's compact popover, exactly like the
 * route warning: fileChip.js asks cadenceNoteActive() and renders
 * cadenceNoteText() — the (i) icon row plus the sentence.
 */
import { trackStore } from '../core/stores.js';
import { t } from '../language/language.js';
import { on } from '../core/events.js';
import { createHintPopover } from './hint-popover.js';

/** The notice's popover — shared singleton lifecycle (js/ui/hint-popover.js),
 *  left-aligned under the marker like the chip's. @private */
const notePop = createHintPopover({ variantClass: 'file-chip-popover', align: 'left' });

/** @type {HTMLElement|null} the notice square */
let btn = null;

/** The sentence key for a track: single is converted, unknown is not judged.
 *  'double' (and no track) never shows the square — raw values are already
 *  steps and need no explanation. @private */
function noteKeyFor(track) {
  if (!track || !track.hasCad) return null;
  if (track.cadenceConvention === 'single') return 'cadenceConventionNote';
  if (track.cadenceConvention === 'unknown') return 'cadenceConventionUnknown';
  return null;
}

/** Binds the marker's DOM and the track/language wiring. Call once from boot. */
export function initCadenceNote() {
  btn = document.getElementById('cadence-note');

  btn.addEventListener('click', () => {
    if (notePop.isOpen) {
      closeNote();
    } else {
      const key = noteKeyFor(trackStore.get());
      if (!key) return;
      notePop.open(btn, (pop) => {
        const row = document.createElement('div');
        row.className = 'file-chip-pop-row';
        row.textContent = t(key);
        pop.appendChild(row);
      });
      btn.setAttribute('aria-expanded', 'true');
    }
  });
  // Same close contract as the route note's popover: any click outside the
  // marker, any scroll, Escape. A language switch closes it too — an open
  // sentence would go stale.
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

  // Visibility rides the track store: only a track with cadence whose
  // convention the user must know about shows the square.
  trackStore.subscribe((track) => {
    const show = noteKeyFor(track) != null;
    btn.hidden = !show;
    if (!show) closeNote();
    refreshNoteLabel();
  });
}

/** @private aria-label + native tooltip in the active language. */
function refreshNoteLabel() {
  const text = t(noteKeyFor(trackStore.get()) ?? 'cadenceConventionNote');
  btn.setAttribute('aria-label', text);
  btn.title = text;
}

/**
 * True while a track with a cadence notice is loaded — the state in which
 * the square shows, and ALSO the state in which the square is folded away
 * by the header's emergency level (CSS display:none; the hidden attribute
 * stays false, like the route note) while its sentence lives on in the
 * chip's compact popover (ui/fileChip.js).
 */
export function cadenceNoteActive() {
  return !!btn && !btn.hidden;
}

/**
 * The sentence the square (or the chip popover at the emergency level)
 * carries in the active language: the converted note on a single-leg file,
 * the cannot-determine note on an undeterminable one. Null when no track
 * qualifies ('double' and cadence-less tracks have nothing to explain).
 */
export function cadenceNoteText() {
  const key = noteKeyFor(trackStore.get());
  return key ? t(key) : null;
}

/** @private Closes the open popover, if any. Safe to call when closed. */
function closeNote() {
  notePop.close();
  btn.setAttribute('aria-expanded', 'false');
}
