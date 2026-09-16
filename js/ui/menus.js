/**
 * Generic popover menu.
 *
 * Desktop: a compact popover anchored to the trigger button.
 * Narrow screens: the same DOM is restyled by CSS into a bottom sheet with a
 * backdrop, so touch users get large targets without a second implementation.
 *
 * Accessibility: aria-haspopup/expanded on the trigger, menuitemradio items,
 * Arrow/Enter/Space/Escape/Home/End keyboard support, click-outside close.
 */
import { icon } from './icons.js';

const isNarrow = () => window.matchMedia('(max-width: 720px)').matches;
// Wide layout (the desktop grid in layout.css): menu subgroups open as
// flyouts beside the panel. Below this breakpoint — narrow desktop windows
// and phones alike — subgroups render inline as an indented group instead.
const isWideLayout = () => window.matchMedia('(min-width: 1100px)').matches;

/**
 * @param {{
 *   button: HTMLButtonElement,
 *   buildItems: () => MenuItem[],
 *   onPick: (value: string) => void,
 *   panelClass?: string,
 * }} cfg
 * @returns {{close: () => void}}
 *
 * `panelClass` appends a class to the popover panel for menu-specific styling
 * (e.g. the export menu centers its rows).
 *
 * @typedef {{kind:'label', label:string}|{kind:'option', value:string, label:string, icon?:string, hint?:string, checked?:boolean, disabled?:boolean}} MenuItem
 */
export function createMenu({ button, buildItems, onPick, panelClass }) {
  let panel = null;
  let backdrop = null;
  let open = false;

  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');

  button.addEventListener('click', () => (open ? close() : openMenu()));
  button.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      if (!open) { e.preventDefault(); openMenu(); }
    }
  });

  function openMenu() {
    panel = document.createElement('div');
    panel.className = 'menu-panel' + (panelClass ? ` ${panelClass}` : '');
    panel.setAttribute('role', 'menu');

    let firstOption = null;
    let selectedOption = null;
    for (const item of buildItems()) {
      if (item.kind === 'label') {
        const label = document.createElement('div');
        label.className = 'menu-group-label';
        label.textContent = item.label;
        panel.appendChild(label);
        continue;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'menu-item';
      btn.setAttribute('role', 'menuitemradio');
      btn.setAttribute('aria-checked', String(!!item.checked));
      btn.disabled = !!item.disabled;
      if (item.icon) {
        const ic = document.createElement('span');
        ic.className = 'menu-item-icon';
        ic.innerHTML = icon(item.icon);
        btn.appendChild(ic);
      }
      const text = document.createElement('span');
      text.className = 'menu-item-label';
      text.textContent = item.label;
      btn.appendChild(text);
      if (item.hint) {
        const hint = document.createElement('span');
        hint.className = 'menu-item-hint';
        hint.textContent = item.hint;
        btn.appendChild(hint);
      }
      if (item.checked) {
        const check = document.createElement('span');
        check.className = 'menu-item-check';
        check.innerHTML = icon('check');
        btn.appendChild(check);
        selectedOption = btn;
      }
      btn.addEventListener('click', () => {
        close();
        onPick(item.value);
      });
      if (!firstOption) firstOption = btn;
      panel.appendChild(btn);
    }

    positionPanel();
    document.body.appendChild(panel);

    if (isNarrow()) {
      backdrop = document.createElement('div');
      backdrop.className = 'menu-backdrop';
      backdrop.addEventListener('click', close);
      document.body.appendChild(backdrop);
    }

    button.setAttribute('aria-expanded', 'true');
    open = true;
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKeydown, true);

    const focusTarget = selectedOption || firstOption;
    if (focusTarget) focusTarget.focus();
  }

  function positionPanel() {
    const rect = button.getBoundingClientRect();
    if (!isNarrow()) {
      // Measure synchronously (offsetHeight forces layout): positioning must
      // not wait on an animation frame, or the popover pops in late on busy
      // pages and never lands in occluded/backgrounded tabs at all.
      panel.style.visibility = 'hidden';
      panel.style.left = '0';
      panel.style.top = '0';
      const h = panel.offsetHeight;
      const spaceBelow = window.innerHeight - rect.bottom;
      panel.style.left = '';
      panel.style.top = '';
      panel.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
      if (h < spaceBelow - 8) {
        panel.style.top = `${rect.bottom + 6}px`;
      } else {
        panel.style.bottom = `${window.innerHeight - rect.top + 6}px`;
      }
      panel.style.visibility = '';
    }
  }

  function onOutside(e) {
    if (panel && !panel.contains(e.target) && !button.contains(e.target)) close();
  }

  function onKeydown(e) {
    if (!open) return;
    const options = [...panel.querySelectorAll('.menu-item:not(:disabled)')];
    const idx = options.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      button.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown'
        ? options[(idx + 1 + options.length) % options.length]
        : options[(idx - 1 + options.length) % options.length];
      next?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      options[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      options[options.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      close();
    }
  }

  function close() {
    if (!open) return;
    open = false;
    panel?.remove();
    panel = null;
    backdrop?.remove();
    backdrop = null;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKeydown, true);
  }

  return { close };
}

/**
 * Multi-select menu (checkbox semantics). Toggling an item applies the
 * change immediately and keeps the menu open; Escape / outside click close.
 * Items: { value, label, colorToken?, checked?, disabled?, children? }.
 *
 * An item with a non-empty `children` array becomes a submenu group: on wide
 * screens its row opens a flyout beside the panel (left side — the overlays
 * trigger sits at the header's right edge), on narrow screens the children
 * render inline as an indented group under the row. The parent row itself
 * stays a checkbox on narrow screens (toggle the whole group); on wide
 * screens its only job is opening the flyout. Child picks go through the
 * same onToggle as top-level items.
 *
 * Desktop panels use the fit-content width (`.menu-panel-fit`): the popover
 * hugs its longest item instead of the shared 230px menu floor, right edge
 * pinned to the trigger. Narrow screens still get the full-width bottom sheet.
 *
 * `positionOverride(panelEl)` — optional wide-screen escape hatch. When it
 * returns true the built-in below-the-trigger positioning is skipped; the
 * caller owns `top`/`bottom`/`left`/`right` for that open. Narrow screens
 * should return false so the default (bottom sheet via CSS) still applies.
 */
export function createMultiSelectMenu({ button, buildItems, onToggle, positionOverride }) {
  // .menu-panel padding — needed to line a flyout's first row up with the
  // parent row (both panels share it, so it cancels out of the offset).
  const PANEL_PAD = 6;
  let panel = null;
  let backdrop = null;
  let open = false;
  let flyout = null;        // desktop-only submenu panel
  let flyoutAnchor = null;  // parent row the flyout is anchored to

  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');

  /** One toggle row, used for top-level items and flyout children alike. */
  const buildRow = (item) => {
    const isParent = !!item.children?.length;
    const flyoutParent = isParent && isWideLayout();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'menu-item' + (flyoutParent ? ' menu-item-parent' : '');
    btn.setAttribute('role', 'menuitemcheckbox');
    btn.setAttribute('aria-checked', String(!!item.checked));
    btn.disabled = !!item.disabled;
    const dot = document.createElement('span');
    dot.className = 'menu-item-icon';
    if (item.colorToken) {
      dot.innerHTML = `<span class="menu-color-dot" style="--dot-color: var(${item.colorToken})"></span>`;
    }
    btn.appendChild(dot);
    const text = document.createElement('span');
    text.className = 'menu-item-label';
    text.textContent = item.label;
    btn.appendChild(text);
    if (isParent) {
      const caret = document.createElement('span');
      caret.className = 'menu-item-caret';
      caret.innerHTML = icon(flyoutParent ? 'chevron-left' : 'chevron-down');
      btn.appendChild(caret);
    }
    if (item.checked) {
      const check = document.createElement('span');
      check.className = 'menu-item-check';
      check.innerHTML = icon('check');
      btn.appendChild(check);
    }
    if (flyoutParent) {
      btn.setAttribute('aria-haspopup', 'menu');
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', () =>
        (flyout && flyoutAnchor === btn ? closeFlyout() : openFlyout(btn, item.children)));
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') { e.preventDefault(); openFlyout(btn, item.children); }
      });
    } else {
      btn.addEventListener('click', () => {
        onToggle(item.value);
        renderItems();
      });
    }
    return btn;
  };

  const renderItems = () => {
    if (!panel) return;
    closeFlyout(); // rows are rebuilt — the anchor node never survives
    panel.replaceChildren();
    for (const item of buildItems()) {
      if (item.children?.length && !isWideLayout()) {
        panel.appendChild(buildRow(item));
        const list = document.createElement('div');
        list.className = 'menu-sublist';
        for (const child of item.children) list.appendChild(buildRow(child));
        panel.appendChild(list);
        continue;
      }
      panel.appendChild(buildRow(item));
    }
  };

  const openFlyout = (anchorRow, children) => {
    closeFlyout();
    flyout = document.createElement('div');
    flyout.className = 'menu-panel menu-panel-fit menu-flyout';
    flyout.setAttribute('role', 'menu');
    for (const child of children) flyout.appendChild(buildRow(child));
    flyoutAnchor = anchorRow;
    anchorRow.setAttribute('aria-expanded', 'true');
    document.body.appendChild(flyout);
    positionFlyout();
    document.addEventListener('pointerdown', onFlyoutOutside, true);
  };

  /** Desktop flyout: left of the parent row, first item level with that row
   *  (the shared panel padding cancels out of the offset), flipping to the
   *  row's right side when the window edge is closer than the panel.
   *  Measured synchronously — offsetWidth/Height force layout — so the
   *  position never waits on an animation frame. */
  function positionFlyout() {
    if (!flyout || !flyoutAnchor) return;
    const row = flyoutAnchor.getBoundingClientRect();
    const w = flyout.offsetWidth;
    const h = flyout.offsetHeight;
    const top = Math.min(Math.max(row.top - PANEL_PAD, 8), Math.max(8, window.innerHeight - h - 8));
    let left = row.left - w - 6;
    if (left < 8) left = row.right + 6;
    flyout.style.left = `${left}px`;
    flyout.style.top = `${top}px`;
  }

  const onFlyoutOutside = (e) => {
    // A press outside the flyout but on its anchor row toggles via the row's
    // own click handler; any other outside press just dismisses the flyout
    // and lets the main panel's handlers take over.
    if (flyout && !flyout.contains(e.target) && !flyoutAnchor?.contains(e.target)) closeFlyout();
  };

  const closeFlyout = () => {
    if (!flyout) return;
    flyout.remove();
    flyout = null;
    flyoutAnchor?.setAttribute('aria-expanded', 'false');
    flyoutAnchor = null;
    document.removeEventListener('pointerdown', onFlyoutOutside, true);
  };

  const openMenu = () => {
    panel = document.createElement('div');
    panel.className = 'menu-panel menu-panel-fit';
    panel.setAttribute('role', 'menu');
    renderItems();
    positionPanel();
    document.body.appendChild(panel);

    if (isNarrow()) {
      backdrop = document.createElement('div');
      backdrop.className = 'menu-backdrop';
      backdrop.addEventListener('click', close);
      document.body.appendChild(backdrop);
    }

    button.setAttribute('aria-expanded', 'true');
    open = true;
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKeydown, true);
    const first = panel.querySelector('.menu-item:not(:disabled)');
    first?.focus();
  };

  function positionPanel() {
    // Caller-owned placement (e.g. the profile's overlays panel dropping from
    // its trigger row over the chart, height-capped before the x-axis, on
    // wide screens).
    if (positionOverride?.(panel)) return;
    const rect = button.getBoundingClientRect();
    if (!isNarrow()) {
      panel.style.visibility = 'hidden';
      panel.style.left = '0';
      panel.style.top = '0';
      const height = panel.offsetHeight;
      const spaceBelow = window.innerHeight - rect.bottom;
      // Clear the measuring position: a leftover inline `left: 0` plus
      // `right` would over-constrain the fixed panel (with a set width,
      // `right` loses and the popover jumps to the window's left edge).
      panel.style.left = '';
      panel.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
      panel.style.top = '';
      panel.style.bottom = '';
      if (height < spaceBelow - 8) panel.style.top = `${rect.bottom + 6}px`;
      else panel.style.bottom = `${window.innerHeight - rect.top + 6}px`;
      panel.style.visibility = '';
    }
  }

  const onOutside = (e) => {
    // The flyout lives outside `.menu-panel` in the DOM — presses inside it
    // must not count as "outside" for the main panel.
    if (panel && !panel.contains(e.target) && !flyout?.contains(e.target) && !button.contains(e.target)) close();
  };

  const onKeydown = (e) => {
    if (!open) return;
    // Flyout first: it is its own focus scope, and Escape / ArrowLeft step
    // back to the parent row before the whole menu goes away.
    if (flyout) {
      if (e.key === 'Escape' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const anchor = flyoutAnchor;
        closeFlyout();
        anchor?.focus();
        return;
      }
      if (flyout.contains(document.activeElement)) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const items = [...flyout.querySelectorAll('.menu-item:not(:disabled)')];
          const idx = items.indexOf(document.activeElement);
          const next = e.key === 'ArrowDown'
            ? items[(idx + 1 + items.length) % items.length]
            : items[(idx - 1 + items.length) % items.length];
          next?.focus();
        } else if (e.key === 'Tab') {
          close();
        }
        return;
      }
      if (document.activeElement === flyoutAnchor && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const items = [...flyout.querySelectorAll('.menu-item:not(:disabled)')];
        (e.key === 'ArrowDown' ? items[0] : items[items.length - 1])?.focus();
        return;
      }
    }
    const options = [...panel.querySelectorAll('.menu-item:not(:disabled)')];
    const idx = options.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      button.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown'
        ? options[(idx + 1 + options.length) % options.length]
        : options[(idx - 1 + options.length) % options.length];
      next?.focus();
    } else if (e.key === 'Tab') {
      close();
    }
  };

  const close = () => {
    if (!open) return;
    open = false;
    closeFlyout();
    panel?.remove();
    panel = null;
    backdrop?.remove();
    backdrop = null;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKeydown, true);
  };

  button.addEventListener('click', () => (open ? close() : openMenu()));
  button.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      if (!open) { e.preventDefault(); openMenu(); }
    }
  });

  return { close };
}

/**
 * Renders a static option list (used inside sheets), same item shape as menus.
 *
 * @param {MenuItem[]} items
 * @param {(value: string) => void} onPick
 * @param {'menuitemradio'|'radio'} [role]
 * @returns {HTMLElement}
 */
export function renderOptionList(items, onPick, role = 'radio') {
  const wrap = document.createElement('div');
  wrap.className = 'option-list';
  wrap.setAttribute('role', role === 'radio' ? 'radiogroup' : 'menu');
  for (const item of items) {
    if (item.kind === 'label') {
      const label = document.createElement('div');
      label.className = 'menu-group-label';
      label.textContent = item.label;
      wrap.appendChild(label);
      continue;
    }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'menu-item';
      // Lets containers that re-render after a pick (the settings drawer)
      // find and re-focus the row the pointer/keyboard was on.
      btn.dataset.value = item.value;
      btn.setAttribute('role', role);
    btn.setAttribute('aria-checked', String(!!item.checked));
    if (item.icon) {
      const ic = document.createElement('span');
      ic.className = 'menu-item-icon';
      ic.innerHTML = icon(item.icon);
      btn.appendChild(ic);
    }
    const text = document.createElement('span');
    text.className = 'menu-item-label';
    text.textContent = item.label;
    btn.appendChild(text);
    if (item.hint) {
      const hint = document.createElement('span');
      hint.className = 'menu-item-hint';
      hint.textContent = item.hint;
      btn.appendChild(hint);
    }
    if (item.checked) {
      const check = document.createElement('span');
      check.className = 'menu-item-check';
      check.innerHTML = icon('check');
      btn.appendChild(check);
    }
    btn.addEventListener('click', () => onPick(item.value));
    wrap.appendChild(btn);
  }
  return wrap;
}
