/**
 * The one-open-at-a-time hint popover shared by the file chip and the
 * metrics rows: creation, anchor positioning and aria state live here;
 * content, host and trigger wiring stay with the callers. Positioned 6 px
 * below the anchor — flipped above when there is no room below — and
 * clamped to the viewport with an 8 px margin. A popover whose anchor sits
 * inside a modal <dialog> is appended into that dialog: the top layer sits
 * above any body-level fixed element, so it must live where its anchor
 * lives.
 */

/**
 * @param {{variantClass?: string, align?: 'left'|'right'}} [opts]
 *   variantClass  extra class next to .hint-popover (e.g. the chip's rows)
 *   align         which anchor edge the popover lines up with
 */
export function createHintPopover({ variantClass = '', align = 'left' } = {}) {
  let el = null;
  let anchorEl = null;

  return {
    /** Opens (rebuilding) the popover under `anchor`; `build(pop)` fills it. */
    open(anchor, build) {
      this.close();
      anchorEl = anchor;
      el = document.createElement('div');
      el.className = variantClass ? `hint-popover ${variantClass}` : 'hint-popover';
      el.setAttribute('role', 'tooltip');
      build(el);
      (anchorEl.closest('dialog') || document.body).appendChild(el);
      anchorEl.setAttribute('aria-expanded', 'true');
      this.position();
    },

    /** Re-anchors to the current anchor rect (no-op while closed). */
    position() {
      if (!el || !anchorEl) return;
      const a = anchorEl.getBoundingClientRect();
      const p = el.getBoundingClientRect();
      const margin = 8;
      let left = align === 'right' ? a.right - p.width : a.left;
      left = Math.min(Math.max(left, margin), window.innerWidth - margin - p.width);
      let top = a.bottom + 6;
      if (top + p.height > window.innerHeight - margin) top = a.top - 6 - p.height;
      el.style.left = `${Math.round(Math.max(margin, left))}px`;
      el.style.top = `${Math.round(top)}px`;
    },

    /** Closes the popover. Safe to call when closed. */
    close() {
      if (anchorEl) anchorEl.setAttribute('aria-expanded', 'false');
      el?.remove();
      el = null;
      anchorEl = null;
    },

    /** True while a popover is open. */
    get isOpen() { return !!el; },

    /** The anchor the open popover is attached to, null when closed. */
    get anchor() { return anchorEl; },
  };
}
