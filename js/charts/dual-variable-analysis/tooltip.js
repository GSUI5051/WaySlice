/**
 * Dual-variable analysis — the readout tooltip (DOM).
 *
 * Three rows — X value, Y value, relative density — in the metric formatters
 * so the numbers read exactly like everywhere else in the app.
 *
 * Positioning: the 2D density PLOT AREA only resolves data coordinates and
 * is never the tooltip's boundary — the box may leave the chart canvas, the
 * plot and the chart card freely. The safe area is the whole result
 * container (the dialog's scrollable body — the modal viewport). Two
 * strategies:
 *
 *   TOUCH (the ergonomic default on phones): the box sits DIRECTLY ABOVE the
 *   touch point with an 8–12 px gap, horizontally aligned with it — a finger
 *   reads best when the reading is right where the finger pressed. This is
 *   unconditional: the box may leave the chart card, the dialog's body and
 *   even the dialog itself — the ENTIRE SCREEN is the only boundary, so the
 *   finger never obscures the reading while any screen headroom remains. When
 *   the touch point is too close to the screen's top, the box clamps against
 *   it (fully visible, as high as possible); it never flips below and never
 *   searches sideways, and the plot area's edges play no part.
 *
 *   MOUSE (desktop hover): above → below → beside (the roomier side) →
 *   clamped inside the dialog body — the ladder avoids the modal and the
 *   viewport and may read above, below, left or right of the pointer.
 *
 * Both keep the box clamped inside their safe area, so it is never cropped
 * by the modal, the viewport or any fixed UI. The node lives INSIDE the
 * dialog (a body-level fixed node would sit under the modal's top layer) in
 * viewport-fixed coordinates, so container scrolling never detaches it — a
 * scroll or resize simply hides it.
 */
import { t } from '../../language/language.js';
import { formatPercent } from '../../utils/format.js';

/** Distance between the box edge and the anchor: a mouse cursor needs a
 *  small gap; a finger keeps the reading close — 8–12 px per the spec. */
const MOUSE_GAP = 14;
const TOUCH_GAP = 10;
/** Safe-area inset kept between the box and the boundary edges. */
const SAFE_MARGIN = 8;

/** The touch strategy's only boundary: the ENTIRE SCREEN. The dialog, the
 *  chart card and the plot area never constrain a touch tooltip. */
function screenRect() {
  return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
}

let tooltip = null;
let safeArea = null;

/** Creates the tooltip node inside the dialog. Call once. */
export function initTooltip(dialogEl, safeAreaEl) {
  safeArea = safeAreaEl;
  tooltip = document.createElement('div');
  tooltip.className = 'dualvar-tooltip num';
  tooltip.hidden = true;
  tooltip.setAttribute('role', 'status');
  dialogEl.appendChild(tooltip);
  // A scrolled or resized container would strand the box away from its
  // anchor — hide it instead of letting it float stale.
  safeAreaEl.addEventListener('scroll', hideTooltip, true);
  window.addEventListener('resize', hideTooltip);
}

/**
 * Pure placement for one tooltip box (no DOM).
 *
 * @param {number} clientX  anchor x in viewport px
 * @param {number} clientY  anchor y in viewport px
 * @param {number} boxW  tooltip box width
 * @param {number} boxH  tooltip box height
 * @param {{left:number, top:number, right:number, bottom:number}} safe  the
 *   safe-area rect in viewport px — the ENTIRE SCREEN for touch, the dialog
 *   body for mouse
 * @param {number} gap  clearance between the box and the anchor
 * @param {boolean} touch  touch strategy: ALWAYS above the touch point
 *   (horizontally aligned), clamped against the screen top when the touch is
 *   too high — never a below-flip, never a side placement
 * @returns {{left: number, top: number}} the box's viewport position
 */
export function computeTooltipPlacement(clientX, clientY, boxW, boxH, safe, gap, touch = false) {
  const safeLeft = safe.left + SAFE_MARGIN;
  const safeRight = safe.right - SAFE_MARGIN;
  const safeTop = safe.top + SAFE_MARGIN;
  const safeBottom = safe.bottom - SAFE_MARGIN;
  const clampX = (left) => Math.min(Math.max(left, safeLeft), Math.max(safeLeft, safeRight - boxW));
  const clampY = (top) => Math.min(Math.max(top, safeTop), Math.max(safeTop, safeBottom - boxH));
  const alignedX = () => clampX(clientX - boxW / 2);

  if (touch) {
    // Unconditionally above the touch point; when the dialog's top is too
    // close for the whole box, the clamp parks the box as high as the safe
    // area allows — fully visible, still the topmost placement possible.
    return { left: alignedX(), top: clampY(clientY - gap - boxH) };
  }

  // Mouse: above → below → beside (the roomier side) → clamped.
  let top = clientY - gap - boxH;
  if (top >= safeTop) {
    return { left: clampX(clientX - boxW / 2), top };
  }
  top = clientY + gap;
  if (top + boxH <= safeBottom) {
    return { left: clampX(clientX - boxW / 2), top };
  }
  const leftRoom = clientX - safeLeft;
  const rightRoom = safeRight - clientX;
  const sideLeft = leftRoom >= rightRoom;
  let left = sideLeft ? clientX - gap - boxW : clientX + gap;
  if (left < safeLeft || left + boxW > safeRight) {
    left = clampX(sideLeft ? clientX - gap - boxW : clientX + gap);
  }
  return { left, top: clampY(clientY - boxH / 2) };
}

/**
 * Shows (or moves) the tooltip for a hover.
 * @param {object} h  a hitTest result: xRaw / yRaw / density
 * @param {number} clientX  anchor x in viewport px
 * @param {number} clientY  anchor y in viewport px
 * @param {{xDef: object, yDef: object}} defs  the axis metrics
 * @param {boolean} touch  touch strategy: directly above the touch point
 */
export function showTooltipAt(h, clientX, clientY, defs, touch = false) {
  if (!tooltip || !h) return;
  const rows = [
    { label: 'X', value: defs.xDef.format(h.xRaw) },
    { label: 'Y', value: defs.yDef.format(h.yRaw) },
    { label: t('dualVarRelativeDensity'), value: formatPercent(h.density * 100) },
  ];
  tooltip.replaceChildren(...rows.map(({ label, value }) => {
    const row = document.createElement('span');
    row.className = 'dualvar-tip-row';
    const l = document.createElement('span');
    l.className = 'dualvar-tip-label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'dualvar-tip-value';
    v.textContent = value;
    row.append(l, v);
    return row;
  }));
  tooltip.hidden = false;

  // Touch answers to the whole screen; mouse avoids the modal (the dialog
  // body) and thereby the viewport.
  const safe = touch ? screenRect() : safeArea.getBoundingClientRect();
  const gap = touch ? TOUCH_GAP : MOUSE_GAP;
  const { left, top } = computeTooltipPlacement(
    clientX, clientY,
    tooltip.offsetWidth, tooltip.offsetHeight,
    safe, gap, touch,
  );
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

export function hideTooltip() {
  if (tooltip) tooltip.hidden = true;
}
