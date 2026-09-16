/**
 * Bottom sheet built on <dialog> — used for the detailed metrics view.
 * On wide viewports the same dialog is styled as a centered popover-like
 * panel; on narrow viewports CSS anchors it to the bottom edge.
 * (Application settings live in the settings drawer, ui/drawer.js.)
 */
import { t } from '../language/language.js';
import { icon } from './icons.js';

let dialog = null;
let titleEl = null;
let bodyEl = null;

/** Wires the shared sheet dialog. */
export function initSheets(sheetDialog) {
  dialog = sheetDialog;
  titleEl = dialog.querySelector('#sheet-title');
  bodyEl = dialog.querySelector('#sheet-body');
  dialog.querySelector('#sheet-close').innerHTML = icon('x');
  dialog.querySelector('#sheet-close').setAttribute('aria-label', t('close'));
  dialog.querySelector('#sheet-close').addEventListener('click', closeSheet);
}

/** Opens the detailed metrics sheet (content rendered by the metrics panel). */
export function openDetailsSheet() {
  openSheet(t('allMetrics'));
}

/**
 * Opens the shared sheet with an arbitrary title — the auto-segment list
 * builds its own content into #sheet-body (ui/autoSegments.js).
 * @param {string} title
 */
export function openSheet(title) {
  titleEl.textContent = title;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

/** Re-titles the open sheet (live language switch while it stays open). */
export function setSheetTitle(title) {
  if (titleEl) titleEl.textContent = title;
}

/** Closes the sheet if open. */
export function closeSheet() {
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}
