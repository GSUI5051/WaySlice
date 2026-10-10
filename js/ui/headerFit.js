/**
 * Header compression — the top bar's measured level controller, the
 * counterpart of the profile toolbar's refreshControlsFit
 * (charts/elevation-profile/profile-interaction.js). Four cumulative
 * folds on #app-header:
 *
 *   full → is-compact → is-overflow → is-minimum → is-emergency
 *
 *   compact   the GitHub + Support links fold into one ellipsis trigger
 *             wearing the plain button chrome the links share;
 *   overflow  Export / Auto slice / Import track additionally fold into a
 *             second trigger wearing the group's primary chrome;
 *   minimum   everything — Settings included — folds into a single
 *             all-actions trigger;
 *   emergency the route-source notice square folds away too: the warning
 *             lives on inside the chip's compact popover (ui/fileChip.js),
 *             the last visible furniture past the single trigger.
 *
 * Like the profile controller it MEASURES: walk the levels, apply each one
 * (the classes plus the row/panel split), re-decide the file chip's mode
 * for the level's action-row width, and keep the first level whose row fits
 * the header's content box. The probe is the actions row's right edge
 * against the header's padding edge — an engine-independent overflow test
 * that stays honest because nothing in the row may shrink (the flex: none
 * contract in layout.css) and the chip, the one shrinkable item, re-decides
 * its own full-vs-info mode inside the walk. Applying a level cannot change
 * the width it was decided from, so there is no hysteresis and no flapping.
 *
 * The panels host the REAL buttons the controller moved out of the row —
 * same nodes, same listeners, same aria, same state, nothing duplicated;
 * a panel only changes where a control renders, never what it does. They
 * live at the body level (#header-panels) so they can out-stack the shared
 * backdrop, open as bottom sheets at every width (the app's narrow-screen
 * menu idiom), and close on an outside pointerdown, Escape, or any level
 * change. Like the profile panel they stay open while their rows act: the
 * sheet is a disclosure (aria-expanded + aria-controls), and the Export
 * row's format menu anchors to the very button this panel is hosting.
 *
 * Runs on header resizes (the ResizeObserver), on language changes and on
 * track loads — a track reveals Export / Auto slice and squares the two
 * links, all of which move the fit — each time settling before paint.
 */
import { trackStore } from '../core/stores.js';
import { on } from '../core/events.js';
import { remeasureFileChip } from './fileChip.js';

/** Cumulative level classes; index = level. @private */
const LEVEL_CLASSES = [null, 'is-compact', 'is-overflow', 'is-minimum', 'is-emergency'];

/** The header's movable controls, in canonical row DOM order, with the wrap
 *  each one is inserted before when it returns to the row. @private */
const CONTROLS = [
  ['github', 'btn-github', 'more-links'],
  ['support', 'btn-support', 'more-links'],
  ['export', 'btn-export', 'more-actions'],
  ['auto', 'btn-auto-segments', 'more-actions'],
  ['open', 'btn-open', 'more-all'],
  ['settings', 'btn-settings', 'more-all'],
];

/** Panel rows top-to-bottom — the orders the header spec fixes: GitHub,
 *  Support; Export, Auto slice, Import track; and the single all-panel runs
 *  Export, Auto slice, Import track, Settings, GitHub, Support.
 *  @private */
const PANEL_ORDER = {
  links: ['github', 'support'],
  actions: ['export', 'auto', 'open'],
  all: ['export', 'auto', 'open', 'settings', 'github', 'support'],
};

/** @private Where a control renders at a level: the row, or a panel name. */
function hostOf(key, level) {
  if (level >= 3) return 'all';
  if (key === 'github' || key === 'support') return level >= 1 ? 'links' : 'row';
  if (key === 'settings') return 'row';
  return level >= 2 ? 'actions' : 'row';
}

/** @private Module-singleton DOM, bound by initHeaderFit. */
let header = null;
let actions = null;
let controls = [];
let wraps = {};
let panels = {};
let triggers = {};
let anchors = {};
/** The one open panel's name, or null. */
let openName = null;
let backdrop = null;
/** The level currently applied — panel lifecycle hangs on its changes. */
let currentLevel = 0;

/** @private Apply a level: the classes, the wrap visibility and the
 *  row/panel split. Idempotent — only nodes whose parent actually changes
 *  are moved. */
function applyLevel(level) {
  LEVEL_CLASSES.forEach((cls, k) => { if (cls) header.classList.toggle(cls, k <= level); });
  const panelled = { links: [], actions: [], all: [] };
  for (const [key, el] of controls) {
    if (!el) continue;
    const host = hostOf(key, level);
    if (host === 'row') {
      if (el.parentElement !== actions) actions.insertBefore(el, anchors[key]);
    } else {
      panelled[host].push([key, el]);
    }
  }
  // appendChild also re-hosts nodes already in the panel, so walking the
  // canonical order rebuilds the panel's row order on every level change.
  for (const name of ['links', 'actions', 'all']) {
    for (const key of PANEL_ORDER[name]) {
      const hit = panelled[name].find(([k]) => k === key);
      if (hit) panels[name].appendChild(hit[1]);
    }
  }
  // The links trigger serves its own fold AND hosts level 2's pair; the
  // single all-trigger replaces both from the minimum level on (emergency
  // keeps it — it is the last control the header has).
  wraps.links.hidden = level < 1 || level >= 3;
  wraps.actions.hidden = level !== 2;
  wraps.all.hidden = level < 3;
}

/** @private True while the actions row sits inside the header's content box.
 *  The row's right edge is compared against the padding edge: with nothing
 *  in the line allowed to shrink, width pressure overflows to the right, so
 *  this one rectangle is the whole overflow test. */
function rowFits() {
  const padRight = parseFloat(getComputedStyle(header).paddingRight) || 0;
  const edge = header.getBoundingClientRect().right - padRight;
  return actions.getBoundingClientRect().right <= edge + 1;
}

/**
 * Re-decides the header's compression level. Walks the levels, applying
 * each and re-measuring the file chip inside the walk (the chip's own mode
 * changes the width the next level is judged against), then keeps the first
 * level that fits; below the last level the row overflows to the right
 * instead of compressing further. Any level change closes an open panel —
 * its trigger may have vanished with the fold.
 */
export function refreshHeaderFit() {
  if (!header) return;
  let level = LEVEL_CLASSES.length - 1;
  for (let i = 0; i < LEVEL_CLASSES.length; i++) {
    applyLevel(i);
    remeasureFileChip();
    if (rowFits()) { level = i; break; }
  }
  if (level !== currentLevel) {
    currentLevel = level;
    closePanel();
  }
}

/** @private The one open panel, or null when none is. */
function openPanel(name) {
  closePanel();
  openName = name;
  panels[name].hidden = false;
  triggers[name].setAttribute('aria-expanded', 'true');
  backdrop = document.createElement('div');
  backdrop.className = 'menu-backdrop';
  backdrop.addEventListener('click', closePanel);
  document.body.appendChild(backdrop);
}

/** @private Closes the open panel, if any. Safe when none is. */
function closePanel() {
  if (!openName) return;
  panels[openName].hidden = true;
  triggers[openName].setAttribute('aria-expanded', 'false');
  openName = null;
  backdrop?.remove();
  backdrop = null;
}

/**
 * Binds the controller's DOM and the global wiring. Call once from boot.
 * Everything below re-runs refreshHeaderFit after the DOM has settled:
 * resizes synchronously, language and track changes one frame out (the
 * static translation pass and the track's button reveals land first).
 */
export function initHeaderFit() {
  header = document.getElementById('app-header');
  actions = header.querySelector('.header-actions');
  controls = CONTROLS.map(([key, id, anchor]) => (
    [key, document.getElementById(id), document.getElementById(anchor)]
  ));
  for (const name of ['links', 'actions', 'all']) {
    wraps[name] = document.getElementById(`more-${name}`);
    panels[name] = document.getElementById(`panel-more-${name}`);
    triggers[name] = document.getElementById(`btn-more-${name}`);
    triggers[name].addEventListener('click', () =>
      (openName === name ? closePanel() : openPanel(name)));
  }
  anchors = Object.fromEntries(controls.map(([key, , anchor]) => [key, anchor]));

  // Outside pointerdown closes (capture, so a press that starts outside
  // never becomes a click elsewhere) — the trigger's wrap and the body-level
  // panel both count as inside. A modal dialog above the sheet (the settings
  // drawer) is not "outside": its interactions must not dismiss the sheet
  // beneath, exactly like the profile panel under its on-top dialogs.
  document.addEventListener('pointerdown', (e) => {
    if (!openName) return;
    if (e.target.closest?.('dialog[open]')) return;
    if (!wraps[openName].contains(e.target) && !panels[openName].contains(e.target)) closePanel();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !openName) return;
    // Escape belongs to the top dialog while one is open.
    if (document.activeElement?.closest?.('dialog[open]')) return;
    const name = openName;
    closePanel();
    triggers[name].focus();
  }, true);

  new ResizeObserver(refreshHeaderFit).observe(header);
  trackStore.subscribe(() => requestAnimationFrame(refreshHeaderFit));
  on('language:changed', () => requestAnimationFrame(refreshHeaderFit));
  refreshHeaderFit();
}
