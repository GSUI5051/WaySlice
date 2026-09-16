/**
 * Dual-variable analysis — pointer interaction.
 *
 * ONE unified Pointer Events path for mouse and touch (no parallel
 * mouse/touch logic): moving a fine pointer reads the bin under the cursor;
 * pressing (tap or hold — reading never requires a double-tap) does the same
 * on touch and keeps the reading pinned where the finger lifted until the
 * next tap, which either moves it or, landing outside the plot, clears it. The
 * interaction layer only translates events into renderer/tooltip calls —
 * it never draws and never formats values itself. The plot area decides the
 * DATA under the pointer; the tooltip's placement is the tooltip module's
 * concern (whole-dialog safe area, not the plot bounds).
 *
 * Touch adds the chart VIEWPORT gestures — the shared machine the elevation
 * profile runs too (js/charts/viewport-gestures.js), in its 'two-finger' pan
 * mode: ONE finger only ever reads (the reading follows it across the plot),
 * TWO fingers pinch both axes AND drag the chart — a two-finger gesture that
 * keeps its span is a pure pan — and a double-tap restores the full data
 * range. A pinch or a pan drops the pinned reading rather than leaving it
 * over a screen spot that no longer means the same data. The chart card, not
 * the canvas, owns the double-tap listener, so the loading / empty overlays
 * count too — and the reset only fires while the view is actually zoomed,
 * which leaves the desktop double-click exactly as it was.
 */
import {
  hitTest, setHover, render, viewportAxes, resetViewport, isViewportZoomed,
} from './densityRenderer.js';
import { showTooltipAt, hideTooltip } from './tooltip.js';
import { createDoubleTapRule, createTouchViewport } from '../viewport-gestures.js';

/**
 * Wires the chart canvas.
 * @param {object} els  { canvas, wrapper }
 * @param {Function} getDefs  () => ({ xDef, yDef } | null) — the current
 *   axis metrics, so language switches can't leave stale formatters behind
 */
export function wireInteraction({ canvas, wrapper }, getDefs) {
  let activePointer = null;

  const update = (e) => {
    const defs = getDefs();
    const h = hitTest(e.clientX, e.clientY);
    if (!h || !defs) {
      setHover(null);
      hideTooltip();
      return;
    }
    setHover(h);
    showTooltipAt(h, e.clientX, e.clientY, defs, e.pointerType === 'touch');
  };

  // The zoomed window moved under the cursor: the pinned reading belonged to
  // the screen spot the finger last touched, which no longer means the same
  // data — dropped, like the profile drops its tooltip on every pan frame.
  const dropReading = () => {
    setHover(null);
    hideTooltip();
  };

  // 'two-finger': a single finger is the chart's READING control (it scrubs the
  // tooltip across the plot), and the viewport belongs to the two-finger
  // gesture, which both scales and translates.
  const touch = createTouchViewport({
    getRect: () => canvas.getBoundingClientRect(),
    getAxes: viewportAxes,
    panGesture: 'two-finger',
    onChange: () => {
      dropReading();
      render();
    },
  });

  // Two taps in quick succession restore the full data range. Gated on an
  // actual zoom: with the full range already on screen there is nothing to
  // reset, so the rule records nothing and a desktop double-click keeps
  // whatever meaning it has today. Releases out of a pinch or a two-finger
  // pan are not taps and never arm the rule — a tap right where a finger
  // lifted, straight after a pan, must not read as a double-tap.
  const doubleTap = createDoubleTapRule({
    isActive: isViewportZoomed,
    onDoubleTap: () => {
      dropReading();
      resetViewport();
    },
  });
  wrapper.addEventListener('pointerdown', (e) => {
    if (!touch.isMultiRelease()) doubleTap.down(e);
  });
  wrapper.addEventListener('pointerup', (e) => {
    if (!touch.isMultiRelease()) doubleTap.up(e);
  });

  canvas.addEventListener('pointerdown', (e) => {
    activePointer = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* detached */ }
    update(e);
    // A touch may still turn into a pan or a pinch — the machine sees only
    // pointers that landed on the chart, and a tap is only a tap if the
    // finger never travelled.
    if (e.pointerType === 'touch') touch.down(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') {
      // A gesture that panned or pinched owns the move; a finger that is
      // still a tap candidate drags the reading along with it; a moving touch
      // that never pressed the canvas is scroll — not a hover.
      if (touch.move(e)) return;
      if (activePointer === e.pointerId) update(e);
      return;
    }
    update(e);
  });
  canvas.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'touch') touch.up(e);
    if (activePointer !== e.pointerId) return;
    activePointer = null;
    // Touch: the reading stays pinned where the finger lifted (the update
    // already ran on pointerdown/move); a tap outside the plot cleared it.
  });
  canvas.addEventListener('pointercancel', (e) => {
    if (e.pointerType === 'touch') touch.cancel(e);
    if (activePointer !== e.pointerId) return;
    activePointer = null;
    dropReading();
  });
  canvas.addEventListener('pointerleave', (e) => {
    if (activePointer === e.pointerId) return;
    dropReading();
  });
}

/** Clears the hover highlight + tooltip (result view swaps, dialog closes). */
export function clearInteraction() {
  setHover(null);
  hideTooltip();
}
