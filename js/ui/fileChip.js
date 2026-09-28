/**
 * Header file chip — the track's name + summary in one pill, with exactly
 * two display modes:
 *
 *   full  — name and meta on one line, shown whenever that line FITS the
 *           space the header has left for the chip;
 *   info  — a lone (i) button when it doesn't; clicking it opens a small
 *           popover repeating the same three facts, one per line.
 *
 * The switch point is measured, never hard-coded. Every re-check lays the
 * chip out in full mode and asks the flexbox whether the content still
 * overflows (`scrollWidth` vs `clientWidth`): the answer already folds in
 * the real brand width, the real action-button widths and the real header
 * width, so future header buttons, other translations and other devices
 * move the breakpoint by themselves.
 *
 * Re-checks run on every content change (track load, language, units) and
 * on header geometry changes (ResizeObserver on the header — viewport
 * resizes, the phone media flip, buttons gaining/losing labels).
 */
import { createHintPopover } from './hint-popover.js';

/** Sub-pixel rounding slack for the fits/doesn't-fit read, px. @private */
const MEASURE_SLACK_PX = 1;

/** @type {HTMLElement|null} the chip pill */
let chip = null;
/** @type {HTMLElement|null} the name / meta spans and the info button */
let nameEl = null;
let metaEl = null;
let infoBtn = null;
/** Popover facts, set with every content update: [name, distance, points]. @private */
let popoverLines = [];
/** The chip's popover — shared singleton lifecycle (js/ui/hint-popover.js),
 *  left-aligned under the chip. @private */
const chipPop = createHintPopover({ variantClass: 'file-chip-popover', align: 'left' });

/**
 * Binds the chip's DOM and the global close/remeasure wiring. Call once
 * from boot; content updates arrive through setFileChipContent().
 * @param {HTMLElement} headerEl  the header — observed for size changes
 */
export function initFileChip(headerEl) {
  chip = document.getElementById('file-chip');
  nameEl = document.getElementById('file-name');
  metaEl = document.getElementById('file-meta');
  infoBtn = document.getElementById('file-chip-info');

  infoBtn.addEventListener('click', () => {
    if (chipPop.isOpen) closeFileChipPopover();
    else openFileChipPopover();
  });
  // Same close contract as the metrics hint popover: any click outside the
  // chip, any scroll, Escape. A click elsewhere in the header (buttons,
  // menus) closes it like any outside click.
  document.addEventListener('click', (event) => {
    if (chipPop.isOpen && !chip.contains(event.target)) closeFileChipPopover();
  });
  document.addEventListener('scroll', closeFileChipPopover, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeFileChipPopover();
  });

  // Geometry changes re-measure the breakpoint and strand the popover
  // (its anchor rect would be stale).
  const onGeometryChange = () => {
    closeFileChipPopover();
    refreshFileChipMode();
  };
  new ResizeObserver(onGeometryChange).observe(headerEl);
}

/**
 * Sets the chip's three facts and re-decides the mode. `lines` feeds the
 * compact popover: [name, distance, point count].
 * @param {{name: string, meta: string, lines: [string, string, string]}} content
 */
export function setFileChipContent({ name, meta, lines }) {
  nameEl.textContent = name;
  metaEl.textContent = meta;
  infoBtn.setAttribute('aria-label', name);
  popoverLines = lines;
  closeFileChipPopover();
  refreshFileChipMode();
}

/**
 * Re-decides the mode. Both states are applied synchronously before the
 * browser paints, so a resize never shows a truncated intermediate frame.
 * @private
 */
function refreshFileChipMode() {
  if (!chip || chip.hidden) return;
  // Measure with the FULL content laid out: dropping the class reveals
  // name + meta (the class list, not widths, hides them).
  chip.classList.remove('is-compact');
  const overflowed = chip.scrollWidth - chip.clientWidth > MEASURE_SLACK_PX;
  chip.classList.toggle('is-compact', overflowed);
}

/**
 * Opens the compact popover: the three facts on their own lines —
 * left-aligned under the chip, per the shared factory's positioning.
 * @private
 */
function openFileChipPopover() {
  chipPop.open(infoBtn, (pop) => {
    const [name, ...rest] = popoverLines;
    for (const [text, extra] of [[name, ' is-name'], ...rest.map((v) => [v, ''])]) {
      const row = document.createElement('div');
      row.className = `file-chip-pop-row${extra}`;
      row.textContent = text;
      pop.appendChild(row);
    }
  });
}

/** @private Closes the open popover, if any. Safe to call when closed. */
function closeFileChipPopover() {
  chipPop.close();
}
