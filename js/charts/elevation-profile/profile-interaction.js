/**
 * Elevation profile — user interaction.
 *
 * Three input pathways, all mutating the shared chart state and triggering
 * redraws exclusively through scheduleSync() (they never draw):
 *
 *   wireControls  — the header controls: Distance/Time x-axis toggle, the
 *                   overlays multi-select menu, the waypoint-snap toggle,
 *                   plus the responsive level controller (full / compact /
 *                   overflow / emergency / minimum) and the overflow panel
 *   wirePointer   — canvas pointer: crosshair + tooltip, rubber-band sector
 *                   selection, Shift + drag window panning, wheel zoom
 *                   (fine pointers), touch gestures (pan / pinch zoom /
 *                   tap probe / boundary-handle grab), double-click /
 *                   double-tap reset
 *   wireHandles   — the sector boundary handles: drag (with waypoint
 *                   snapping) and keyboard nudging
 *
 * plus the overlay-slot toggle rule and the profile toast.
 */
import { t } from '../../language/language.js';
import { emit } from '../../core/events.js';
import {
  sectorStore, moveBoundary, setRange, resetSector, getTrackTotal, MIN_SECTOR_M,
  boundaryKeyAction,
} from '../../sector/sectorStore.js';
import { createMultiSelectMenu } from '../../ui/menus.js';
import { state, isWideLayout } from './profile-state.js';
import {
  OVERLAY_METRICS, SPEED_FAMILY, overlayAvailability, applyOverlayToggle,
  buildCaches, distToX, xToDist, clientXtoX, xvToPx, sectorFitWindow,
} from './profile-data.js';
import { scheduleSync } from './profile-render.js';
import { showTooltipAt, hideTooltip, resetProbeReadout } from './profile-tooltip.js';
import {
  TAP_SLOP, createDoubleTapRule, createTouchViewport, zoomStep,
} from '../viewport-gestures.js';

// Wheel-zoom floors (fine pointers only): at max zoom the visible window
// spans 1 km of track in distance mode, 20 minutes in time mode.
const MIN_VIEW_M = 1000;
const MIN_VIEW_MS = 20 * 60_000;
// Waypoint snap radius in screen pixels around the dragged handle.
const SNAP_RADIUS_PX = 30;

// Interaction-private state — never read outside this module.
let overlaysMenu = null;
// Last variant the user picked — the family toggle (parent row) re-selects it.
let lastSpeedVariant = 'speed';
let waypointSnap = true;    // waypoint snapping while dragging sector handles
let lastSnapDist = null;    // waypoint dist the last toast was shown for
let profileToastTimer = 0;

/** Overlay slot cap: every currently-available series family gets one slot
 *  (speed/pace share theirs), so the cap grows with the loaded track's
 *  sensors instead of being a fixed number. */
function maxOverlays() {
  const avail = overlayAvailability(state.track, state);
  return [avail.hr, avail.speed, avail.cad, avail.temp, avail.power].filter(Boolean).length;
}

/** Speed and pace (and their grade-adjusted view) share one series. */
function speedFamilyOn() {
  return state.selectedOverlays.some((v) => SPEED_FAMILY.includes(v));
}

/** Header controls: x-axis mode, overlay menu, waypoint-snap toggle. */
export function wireControls() {
  const { xButtons } = state.dom;
  xButtons.distance.addEventListener('click', () => setXMode('distance'));
  xButtons.time.addEventListener('click', () => setXMode('time'));
  const overlaysButton = document.getElementById('btn-overlays');
  overlaysMenu = createMultiSelectMenu({
    button: overlaysButton,
    // Wide screens own their placement: the panel hangs below the Overlays
    // button like every popover (right edge at the trigger), but positioned
    // in DOCUMENT coordinates (absolute, not fixed) so it stays glued to the
    // button while the page scrolls, and its height is capped at the VIEWPORT
    // bottom. Deep browser zoom or a short window can leave less room below
    // the trigger than the panel's natural height; without the cap the panel
    // would run past the screen edge — the app shell clips there — putting
    // the lower rows out of reach. The cap makes .menu-panel's overflow-y
    // scroll the rows instead, driven by mouse wheel and touch swipe alike.
    // The small floor keeps at least a couple of scrollable rows visible in
    // the extreme case. Narrow screens return false and keep the default
    // placement (the CSS bottom sheet).
    positionOverride: (panelEl) => {
      if (!isWideLayout()) return false;
      const btnRect = overlaysButton.getBoundingClientRect();
      panelEl.style.position = 'absolute';
      panelEl.style.top = `${btnRect.bottom + 6 + window.scrollY}px`;
      panelEl.style.right = `${Math.max(8, document.documentElement.clientWidth - btnRect.right)}px`;
      panelEl.style.maxHeight = `${Math.max(96, window.innerHeight - btnRect.bottom - 8)}px`;
      return true;
    },
    buildItems: () => {
      const avail = overlayAvailability(state.track, state);
      // The speed family (speed | pace) owns one overlay slot; its parent row
      // carries the group check and opens the two-variant submenu.
      const familyFree = !speedFamilyOn() && state.selectedOverlays.length >= maxOverlays();
      const speedChild = (id) => ({
        value: id,
        label: t(id === 'speed' ? 'legendSpeed' : id === 'gap' ? 'legendGap' : 'legendPace'),
        colorToken: '--series-speed',
        checked: state.selectedOverlays.includes(id),
        disabled: !avail[id] || familyFree,
      });
      const item = (id) => ({
        value: id,
        label: t(OVERLAY_METRICS.find((d) => d.id === id).labelKey),
        colorToken: OVERLAY_METRICS.find((d) => d.id === id).colorToken,
        checked: state.selectedOverlays.includes(id),
        disabled: !avail[id] ||
          (!state.selectedOverlays.includes(id) && state.selectedOverlays.length >= maxOverlays()),
      });
      return [
        item('hr'),
        {
          value: 'speed-family',
          label: t('legendSpeed'),
          colorToken: '--series-speed',
          checked: speedFamilyOn(),
          disabled: !avail.speed,
          children: [speedChild('speed'), speedChild('pace'), speedChild('gap')],
        },
        item('cad'),
        item('temp'),
        item('power'),
      ];
    },
    onToggle: toggleOverlay,
  });
  state.dom.snapBtn = document.getElementById('btn-waypoint-snap');
  state.dom.snapBtn?.addEventListener('click', () => {
    waypointSnap = !waypointSnap;
    refreshSnapToggle();
  });
  refreshSnapToggle();
  state.dom.controls = document.querySelector('.profile-controls');
  state.dom.fitBtn = document.getElementById('btn-profile-fit-sector');
  state.dom.fitBtn.addEventListener('click', fitViewToSector);
  state.dom.overflowWrap = state.dom.controls.querySelector('.profile-overflow');
  state.dom.moreBtn = document.getElementById('btn-more-controls');
  state.dom.overflowPanel = document.getElementById('profile-overflow-panel');
  state.dom.moreBtn.addEventListener('click', toggleOverflowPanel);
  // Close the panel on any pointerdown outside it (capture, observational —
  // a click on a panel row must still land) and on Escape.
  document.addEventListener('pointerdown', (e) => {
    if (!state.dom.overflowPanel || state.dom.overflowPanel.hidden) return;
    if (!state.dom.overflowWrap.contains(e.target)) closeOverflowPanel();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || state.dom.overflowPanel.hidden) return;
    // An open modal (the dual-variable dialog) owns Escape while it is up.
    if (document.querySelector('dialog[open]')) return;
    closeOverflowPanel();
    state.dom.moreBtn.focus();
  });
  refreshControls();
}

/** Waypoint snap toggle reflects state + current language. */
export function refreshSnapToggle() {
  const { snapBtn } = state.dom;
  if (!snapBtn) return;
  snapBtn.setAttribute('aria-pressed', String(waypointSnap));
  snapBtn.title = t('waypointSnap');
  snapBtn.setAttribute('aria-label', t('waypointSnap'));
}

/**
 * Nearest waypoint within the snap radius of a raw x position, in SCREEN
 * pixels. Screen distance (not track distance) is the requirement: the same
 * 30 px covers very different track spans depending on zoom.
 * @returns {{d: number, dist: number}|null}
 */
function snapWaypointAt(xv) {
  if (!waypointSnap || !state.profileWaypoints.length) return null;
  const pxOf = (v) => xvToPx(v, state.view, state.xs, state.plot);
  const cursorPx = pxOf(xv);
  let best = null;
  for (const wp of state.profileWaypoints) {
    const d = Math.abs(pxOf(distToX(wp.dist, state.track, state.xMode)) - cursorPx);
    if (d <= SNAP_RADIUS_PX && (!best || d < best.d)) best = { d, dist: wp.dist };
  }
  return best;
}

/** Single self-fading toast on the profile (snap / pan hints). */
function showProfileToast(text) {
  let toast = document.getElementById('profile-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'profile-toast';
    toast.className = 'profile-toast';
    // The hint text swaps while the pill is already on screen; the live
    // region lets screen readers hear the snap/pan hint like sighted users.
    toast.setAttribute('aria-live', 'polite');
    state.dom.root.appendChild(toast);
  }
  toast.textContent = text;
  toast.classList.add('is-visible');
  clearTimeout(profileToastTimer);
  profileToastTimer = setTimeout(() => toast.classList.remove('is-visible'), 1500);
}

/** Toggle buttons + overlay menu reflect the current track/state. */
export function refreshControls() {
  const { xButtons } = state.dom;
  if (!xButtons.time) return;
  const timeUsable = !!state.track && state.track.hasTime;
  xButtons.time.disabled = !timeUsable;
  // The Time button's tooltip is state-dependent, so it is owned HERE and not
  // by data-i18n-title (which the static pass would re-apply after this runs,
  // wiping the reason): enabled it names the axis — the button renders
  // icon-only from the emergency level on, where the tooltip is the only cue —
  // and disabled it explains why. refreshControls also runs on a language
  // change, so the string always comes from the active pack.
  xButtons.time.title = timeUsable ? t('timeGroup') : t('noTimestampData');
  xButtons.distance.setAttribute('aria-pressed', String(state.xMode === 'distance'));
  xButtons.time.setAttribute('aria-pressed', String(state.xMode === 'time'));
  // The whole control row stays hidden until a track exists — with nothing
  // loaded none of its buttons has anything to act on (the row starts
  // `hidden` in index.html; a track, once loaded, is never cleared).
  if (state.dom.controls) state.dom.controls.hidden = !state.track;
  // Fit to sector needs a sector to fit — track-gated like the analysis
  // button (a track, once loaded, is never cleared).
  if (state.dom.fitBtn) state.dom.fitBtn.hidden = !state.track;
  refreshControlsFit();
}

/**
 * The toolbar's responsive level, MEASURED from the header's real width —
 * the successor of both the old 720 px media query and the single
 * text/icon flip. The controller walks the levels
 *
 *   full → is-compact → is-overflow → is-emergency → is-minimum
 *
 * applying each one (classes on #profile-pane plus the level's row/panel
 * split) and keeping the first whose header fits its own width. Per the
 * toolbar spec: Distance/Time stays in the row through the emergency level
 * (it is the chart's core axis control), Fit to sector is the last action to
 * leave the row, and everything that leaves moves as the REAL button node
 * into the overflow panel — same listeners, same aria, same state, nothing
 * duplicated; the panel only changes where a control renders, never what it
 * does, and its rows follow PANEL_ORDER rather than the row's DOM order.
 * The classes are cumulative (minimum = emergency + overflow + compact),
 * so the CSS layers: icon-only from compact on, identity text and the axis
 * toggle compressed from emergency on.
 *
 * The probe is a fixed point per (width, language): no hysteresis and no
 * flapping, because applying a level cannot change the width it was decided
 * from — #profile-pane tracks its grid track (`minmax(0, …)` on both axes)
 * instead of growing to its own nowrap content. Below the last level the row
 * overflows to the right instead of compressing: buttons keep their hit
 * areas, nothing wraps, truncates or overlaps, and the parent layout owns a
 * container under the toolbar's floor (~profile icon + More, ≈ 80 px).
 *
 * Runs on pane resizes (the ResizeObserver), on language changes, when the
 * row is revealed with a track, and one frame into setProfileTrack so the
 * no-elevation note is laid out before measuring.
 */
const LEVEL_CLASSES = [null, 'is-compact', 'is-overflow', 'is-emergency', 'is-minimum'];
/** Which of the movable controls STAY in the row per level (full, compact,
 *  overflow, emergency, minimum); the rest are hosted by the overflow panel.
 *  Two spec invariants live in these rows: the axis toggle leaves only in the
 *  last resort, and Fit to sector is the last action taken out of the row. */
const LEVEL_ROW = [
  ['xmode', 'snap', 'dualvar', 'overlays', 'fit'],
  ['xmode', 'snap', 'dualvar', 'overlays', 'fit'],
  ['xmode', 'snap', 'fit'],
  ['xmode', 'fit'],
  [],
];
/** Panel rows top-to-bottom, mirroring the row's own DOM order: the axis
 *  toggle leads whenever it is panelled, then snap, then Fit to sector,
 *  then overlays before the analysis button. */
const PANEL_ORDER = ['xmode', 'snap', 'fit', 'overlays', 'dualvar'];

/** @private The row's reparentable controls, in row DOM order. */
function movableControls() {
  const { xButtons, snapBtn, fitBtn } = state.dom;
  return [
    ['xmode', xButtons.distance?.closest('.xmode-toggle')],
    ['snap', snapBtn],
    ['fit', fitBtn],
    ['overlays', document.getElementById('btn-overlays')],
    ['dualvar', document.getElementById('btn-dual-variable')],
  ];
}

/** @private Apply level `i`: the level's classes, the trigger's visibility
 *  and its row/panel split. Idempotent — only nodes whose parent actually
 *  changes are moved. */
function applyLevel(pane, i) {
  LEVEL_CLASSES.forEach((cls, k) => { if (cls) pane.classList.toggle(cls, k <= i); });
  const { controls, overflowWrap, overflowPanel } = state.dom;
  overflowWrap.hidden = i < 2;
  const inRow = new Set(LEVEL_ROW[i]);
  const panelled = [];
  for (const [key, el] of movableControls()) {
    if (!el) continue;
    if (inRow.has(key)) {
      if (el.parentElement !== controls) controls.insertBefore(el, overflowWrap);
    } else {
      panelled.push([key, el]);
    }
  }
  // appendChild also re-hosts nodes already in the panel, so walking the
  // canonical order rebuilds the panel's row order on every level change.
  for (const key of PANEL_ORDER) {
    const hit = panelled.find(([k]) => k === key);
    if (hit) overflowPanel.appendChild(hit[1]);
  }
}

/** @private True while the header's one measured line — identity, note and
 *  the whole control row — sits inside the head's content box. The row's last
 *  box is compared against the content-box edge: an engine-independent
 *  overflow test (the head is nowrap, so anything overflowing does so to the
 *  right), and one the visually hidden h2 cannot perturb — it is absolutely
 *  positioned out of the flex line at the emergency level. */
function headFits(head) {
  const padRight = parseFloat(getComputedStyle(head).paddingRight) || 0;
  const edge = head.getBoundingClientRect().right - padRight;
  return state.dom.controls.getBoundingClientRect().right <= edge + 1;
}

export function refreshControlsFit() {
  const { controls } = state.dom;
  if (!controls || controls.hidden) return;
  const pane = controls.closest('#profile-pane');
  const head = pane?.querySelector('.profile-head');
  if (!pane || !head) return;
  let level = LEVEL_CLASSES.length - 1;
  for (let i = 0; i < LEVEL_CLASSES.length; i++) {
    applyLevel(pane, i);
    if (headFits(head)) { level = i; break; }
  }
  // The trigger only exists in the row from the overflow level on, so an open
  // panel below it would outlive its own trigger (and its aria-expanded).
  if (level < 2) closeOverflowPanel();
}

/** @private The More panel: the trigger toggles it; it closes on any outside
 *  pointerdown (capture listener in wireControls) and on Escape. */
function toggleOverflowPanel() {
  const { overflowPanel, moreBtn } = state.dom;
  const open = overflowPanel.hidden;
  overflowPanel.hidden = !open;
  moreBtn.setAttribute('aria-expanded', String(open));
}

/** @private */
function closeOverflowPanel() {
  const { overflowPanel, moreBtn } = state.dom;
  if (overflowPanel.hidden) return;
  overflowPanel.hidden = true;
  moreBtn.setAttribute('aria-expanded', 'false');
}

/** x-axis mode switch (rebuilds the per-point caches; drops the zoom
 *  window — x units change from meters to milliseconds). */
function setXMode(mode) {
  if (mode === state.xMode) return;
  if (mode === 'time' && (!state.track || !state.track.hasTime)) return;
  state.xMode = mode;
  state.view = null;
  ({ xs: state.xs, speeds: state.speeds, gapSpeeds: state.gapSpeeds } =
    buildCaches(state.track, state.xMode));
  refreshControls();
  scheduleSync();
}

/** Fit to sector (the header's Focus button): pure viewport operation that
 *  shows the selected sector at FIT_SECTOR_FRACTION of the x window,
 *  centered — the selection itself never moves. The window math is the pure
 *  sectorFitWindow (profile-data), floored at the wheel-zoom floor so the
 *  fit and the gestures share one max-zoom definition; a sector near the
 *  full track fits the whole view (window null). Sector meters go through
 *  distToX, so Distance and Time share this unchanged. */
function fitViewToSector() {
  const { track, xs, xMode } = state;
  if (!track || !xs || !xs.length) return;
  const { start, end } = sectorStore.get();
  const floor = xMode === 'time' ? MIN_VIEW_MS : MIN_VIEW_M;
  state.view = sectorFitWindow(
    distToX(start, track, xMode), distToX(end, track, xMode),
    xs[xs.length - 1], floor,
  );
  scheduleSync();
}

/**
 * Overlay toggling — the pure transition lives in profile-data
 * (applyOverlayToggle); this applies it to the chart state.
 */
function toggleOverlay(id) {
  const result = applyOverlayToggle(state.selectedOverlays, id, maxOverlays(), lastSpeedVariant);
  if (result) {
    state.selectedOverlays = result.selected;
    if (SPEED_FAMILY.includes(id)) lastSpeedVariant = id;
  }
  scheduleSync();
}

/** Clears a pinned waypoint (click on map or profile). */
export function unpinWaypoint() {
  if (!state.pinnedWaypoint) return;
  state.pinnedWaypoint = null;
  // The map's pinned-marker glyph mirrors the profile's pin state — report
  // the clear here; a pin switch reports through 'waypoint:select' instead.
  emit('waypoint:pinned', null);
  hideTooltip();
  scheduleSync();
}

const GRAB_RADIUS = 30; // px — touch grab radius around handle positions
// Precise-pointer (mouse/pen) handle hit half-width — the reach of the old
// 44px-wide handle element. Hovering anywhere on the chart reads telemetry;
// only a press inside this hit area starts a locked handle drag.
const HANDLE_HIT_HALF = 22;
// Touch grab radius around the probe cursor line. Slightly tighter than the
// handle radius so a contested touch always resolves to the handle
// (priority: selection handle > probe > normal chart).
const PROBE_GRAB_RADIUS = 24;
// The tap-vs-drag slop and the double-tap rule live in the shared viewport
// gestures module (js/charts/viewport-gestures.js), which the dual-variable
// chart runs too: TAP_SLOP is the radius a touch may travel and still be a
// tap (probe create / reposition), and it is the same radius the double-tap
// detector uses, so both agree on what a "tap" is.

/** Returns 'start' | 'end' if `clientX` is within `radius` px of either
 *  handle's rendered position, picking the nearer one; null otherwise. */
function handleGrabAt(clientX, radius = GRAB_RADIUS) {
  const { canvas } = state.dom;
  if (!canvas || !state.track || !state.xs || !state.xs.length) return null;
  const rect = canvas.getBoundingClientRect();
  const { start, end } = sectorStore.get();
  const closest = (dist) => {
    const xv = distToX(dist, state.track, state.xMode);
    const px = xvToPx(xv, state.view, state.xs, state.plot);
    return Math.abs(px + rect.left - clientX);
  };
  const dStart = closest(start);
  const dEnd = closest(end);
  if (dStart < radius && dStart <= dEnd) return 'start';
  if (dEnd < radius) return 'end';
  return null;
}

/** The active probe's cursor-line x in CLIENT pixels (same windowed mapping
 *  the renderer draws with), or null when there is no probe or it sits
 *  outside the visible window — an invisible probe is not grabbable. */
function probeClientX() {
  if (!state.probe || !state.xs || !state.xs.length) return null;
  const v0 = state.view ? state.view.start : 0;
  const v1 = state.view ? state.view.end : state.xs[state.xs.length - 1];
  if (state.probe.dist == null) return null;
  const xv = distToX(state.probe.dist, state.track, state.xMode);
  if (xv < v0 || xv > v1) return null;
  const rect = state.dom.canvas.getBoundingClientRect();
  return rect.left + xvToPx(xv, state.view, state.xs, state.plot);
}

/** True when clientX is within PROBE_GRAB_RADIUS of the probe line. */
function probeGrabAt(clientX) {
  const px = probeClientX();
  return px != null && Math.abs(px - clientX) <= PROBE_GRAB_RADIUS;
}

/** Tap on the chart with no probe: create one; with a probe: reposition it
 *  to the tapped position. The probe is stored as a TRACK distance — x is
 *  re-derived through distToX wherever it is drawn or hit-tested, so zoom,
 *  pan and x-mode switches all keep it on its data point. */
function placeProbeAt(clientX) {
  const rect = state.dom.canvas.getBoundingClientRect();
  const xv = clientXtoX(clientX, rect, state.plot, state.view, state.xs);
  state.probe = { dist: xToDist(xv, state.track, state.xs) };
  // A pinned waypoint line and the probe are both full-height cursors — the
  // newest interaction wins, exactly like a desktop click unpins.
  unpinWaypoint();
  scheduleSync();
  // The probe is the touch inspection cursor, so it wears the same map
  // mirror as the desktop hover: the orange dot rides the track at the
  // probe's distance (dismissal hides it again).
  emit('hover:dist', { dist: state.probe.dist, origin: 'profile' });
}

/** Drag: move the probe along the x axis to the finger position. */
function moveProbeTo(clientX) {
  if (!state.probe) return;
  const rect = state.dom.canvas.getBoundingClientRect();
  const xv = clientXtoX(clientX, rect, state.plot, state.view, state.xs);
  state.probe.dist = xToDist(xv, state.track, state.xs);
  scheduleSync();
  emit('hover:dist', { dist: state.probe.dist, origin: 'profile' });
}

/** Dismiss the probe — a clear tap outside the chart, never a pan that
 *  happens to end outside it. The fixed readout band returns to its idle
 *  hint with the same reserved height (no layout shift). */
function dismissProbe() {
  if (!state.probe) return;
  state.probe = null;
  hideTooltip();
  resetProbeReadout();
  scheduleSync();
  emit('hover:dist', { dist: null, origin: 'profile' });
}

/** Canvas hover → tooltip + map dot (fine pointers); rubber-band selection
 *  and Shift + drag window panning on drag (fine pointers); on touch, one
 *  finger pans the zoomed window, a two-finger pinch zooms it, and the
 *  sector changes only by dragging the boundary handles. Those three touch
 *  gestures (and the double-tap reset) are the shared viewport machine
 *  (js/charts/viewport-gestures.js) — the dual-variable chart runs the very
 *  same one. */
export function wirePointer() {
  let anchor = null;
  let dragging = false;
  // While Shift-drag panning: the pointer's start clientX and the window that
  // was current when the drag began (deltas apply to it, so repeated clamps
  // at the track edges can never accumulate drift).
  let panning = null;
  // Pan-hint toast: while zoomed in, a plain drag still selects a sector, so
  // a user trying to pan gets one hint per drag. The first successful
  // Shift-pan dismisses it for the rest of the page session (deliberately
  // not persisted to localStorage).
  let panHintShown = false;
  let panHintDone = false;
  // Pinch-hint toast: the first touch on the chart gets one "pinch to zoom"
  // nudge per page session — panning and selection keep working either way.
  let pinchHintShown = false;
  // Touch grab radius: a finger landing within 30 px of a handle grabs it
  // even when the 44 px DOM strip doesn't cover the tap. The virtual handle
  // is driven from canvas pointermove/pointerup, so the real DOM handles
  // (which have their own pointerdown) are never involved in touch drags.
  let virtualHandle = null;   // { which: 'start'|'end', pointerId }
  // Precise-pointer drag: the mouse/pen currently dragging a boundary — the
  // canvas-level twin of the touch virtual handle (the DOM handles are
  // pointer-events:none so their hot zone never blocks hover telemetry).
  let mouseHandle = null;     // { which: 'start'|'end', pointerId }
  // Touch probe drag: the pointer currently dragging the probe cursor line.
  let probeDrag = null;       // { pointerId }
  const { canvas } = state.dom;
  const profileBody = canvas.closest('#profile-body');

  // The chart's x axis as the shared machine sees it: the same domain, zoom
  // floor and plot geometry the renderer draws with, so a gesture can never
  // resolve to a window the chart won't show. One axis — the profile zooms
  // and pans the x axis only.
  const profileAxes = () => {
    const { track, xs, plot } = state;
    if (!track || !xs || !xs.length) return null;
    const total = xs[xs.length - 1];
    if (!(total > 0)) return null;
    return [{
      axis: 'x',
      domain: [0, total],
      minSpan: state.xMode === 'time' ? MIN_VIEW_MS : MIN_VIEW_M,
      px0: plot.x0,
      pxw: plot.w,
      get: () => (state.view ? [state.view.start, state.view.end] : null),
      set: (win) => { state.view = win ? { start: win[0], end: win[1] } : null; },
    }];
  };
  // A tap inspects (probe create / reposition); the machine itself never
  // draws and never decides what a tap means.
  const viewport = createTouchViewport({
    getRect: () => canvas.getBoundingClientRect(),
    getAxes: profileAxes,
    onChange: () => {
      hideTooltip();
      scheduleSync();
    },
    onTap: (e) => placeProbeAt(e.clientX),
    onFirstTouch: () => {
      if (pinchHintShown) return;
      pinchHintShown = true;
      showProfileToast(t('profilePinchHint'));
    },
  });

  // Double-click / double-tap detection (restore the full view) — the shared
  // rule, listened on the profile BODY, not the canvas, so taps that land on
  // a handle (a 22 px touch target with an enlarged hit area) count too. A
  // mouse double-click also resets the sector; on touch the reset is
  // zoom-only — the sector changes exclusively through the boundary handles.
  // Both bubble to #profile-body.
  const doubleTap = createDoubleTapRule({
    isActive: () => !!state.track,
    onDoubleTap: (e) => {
      state.view = null;
      if (e.pointerType !== 'touch') resetSector();
      hideTooltip();
      scheduleSync();
      showProfileToast(t('dblclickReset'));
    },
  });
  // A release out of a pinch is not a tap and never arms the rule: a plain
  // tap right where a finger lifted, straight after a pinch, must not read as
  // the second tap of a double-tap (the gesture machine reports it).
  profileBody.addEventListener('pointerdown', (e) => {
    if (!viewport.isMultiRelease()) doubleTap.down(e);
  });
  profileBody.addEventListener('pointerup', (e) => {
    if (!viewport.isMultiRelease()) doubleTap.up(e);
  });

  // Probe dismissal — a clear TAP that starts AND ends outside the profile
  // chart removes the probe (the touch equivalent of the pointer leaving the
  // chart). The keep-alive test is anchored to the SAME elements the
  // tap-to-probe path is wired to below — the canvas (its box fills
  // #profile-body) plus the two sector handles, whose enlarged hit strips
  // deliberately reach past the chart edge — so the add and remove regions
  // cannot drift apart. The decision keys on the pointerdown point, so a
  // chart pan that drifts past the chart edge (it started inside) never
  // dismisses, and a pointer that travels further than TAP_SLOP is a drag,
  // not a tap. Capture-phase and purely observational — no event is ever
  // swallowed.
  const outsideDowns = new Map(); // pointerId → {x, y, outside}
  const onChart = (target) =>
    canvas.contains(target) ||
    !!state.dom.handles.start?.contains(target) ||
    !!state.dom.handles.end?.contains(target);
  document.addEventListener('pointerdown', (e) => {
    if (!state.probe) return;
    outsideDowns.set(e.pointerId, { x: e.clientX, y: e.clientY, outside: !onChart(e.target) });
  }, true);
  document.addEventListener('pointerup', (e) => {
    const down = outsideDowns.get(e.pointerId);
    outsideDowns.delete(e.pointerId);
    if (!state.probe || !down || !down.outside) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > TAP_SLOP) return;
    dismissProbe();
  }, true);
  document.addEventListener('pointercancel', (e) => outsideDowns.delete(e.pointerId), true);

  const canvasX = (e) => {
    const rect = canvas.getBoundingClientRect();
    return e.clientX - rect.left;
  };
  /** Mouse → raw x in the CURRENT axis domain (distance or elapsed time),
   *  mapped through the visible zoom window. */
  const xFromEvent = (e) => clientXtoX(e.clientX, canvas.getBoundingClientRect(), state.plot, state.view, state.xs);
  /** Mouse → distance along the track (x-domain aware). */
  const distFromEvent = (e) => xToDist(xFromEvent(e), state.track, state.xs);

  canvas.addEventListener('pointerdown', (e) => {
    if (!state.track) return;
    canvas.setPointerCapture(e.pointerId);
    // Touch model: tap inspects (probe), one finger pans the zoomed window,
    // two fingers pinch-zoom, and the sector only changes via the boundary
    // handles — a touch drag never touches the selection.
    if (e.pointerType === 'touch') {
      // Priority: selection handle > probe > normal chart area. Whatever the
      // pointerdown hit locks the whole gesture: a handle drag never turns
      // into a pan, a probe drag never into a selection edit, and neither
      // into a tap — those pointers never reach the gesture machine, which
      // only ever sees the fingers that landed on the plain chart.
      const grab = handleGrabAt(e.clientX);
      if (grab) {
        virtualHandle = { which: grab, pointerId: e.pointerId };
        lastSnapDist = null;
        hideTooltip();
        return;
      }
      if (state.probe && probeGrabAt(e.clientX)) {
        probeDrag = { pointerId: e.pointerId };
        return;
      }
      // Normal chart area: the shared machine decides between tap, pan and
      // pinch (a finger travelling past TAP_SLOP pans; a finger released
      // inside the slop taps → probe create / reposition).
      viewport.down(e);
      return;
    }
    // Precise pointers (mouse/pen) grab a handle at the handle's own hit
    // width, exactly like touch — the old 44px-wide element hot zone is
    // pointer-transparent, so plain hovering keeps reading the chart
    // telemetry everywhere and only a press inside the hit area starts a
    // drag. The drag is locked to this pointer until release.
    const grab = handleGrabAt(e.clientX, HANDLE_HIT_HALF);
    if (grab) {
      e.preventDefault();
      mouseHandle = { which: grab, pointerId: e.pointerId };
      lastSnapDist = null;
      // The hover crosshair (accent hairline + curve intersection dots) is
      // suppressed for the whole locked drag — the moving boundary is the
      // indicator; hover telemetry resumes on release.
      state.hoverX = null;
      state.hoverDist = null;
      state.hoverOrigin = null;
      emit('hover:dist', { dist: null, origin: 'profile' });
      hideTooltip();
      scheduleSync();
      return;
    }
    // A click on the chart unpins the waypoint line; the drag continues.
    unpinWaypoint();
    if (e.shiftKey) {
      // Shift + drag pans the visible window; nothing to pan when the whole
      // track already fits (view === null), so the drag is simply inert.
      if (state.view) {
        panning = { clientX: e.clientX, v0: state.view.start, v1: state.view.end };
        canvas.style.cursor = 'grabbing';
      }
      return;
    }
    dragging = true;
    panHintShown = false;
    // A rubber-band drag changes the sector on every move: tell the metrics
    // panel a drag is running so its (O(sector points)) renders take the
    // slow mid-drag cadence ('sector:drag', see metricsPanel). The final
    // commit on pointerup releases it.
    emit('sector:drag', true);
    anchor = distFromEvent(e);
    setRange(anchor, anchor);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!state.track) return;
    if (e.pointerType === 'touch') {
      if (virtualHandle && virtualHandle.pointerId === e.pointerId) {
        dragHandleTo(virtualHandle.which, e.clientX);
        return;
      }
      if (probeDrag && probeDrag.pointerId === e.pointerId) {
        // Probe drag: x-axis only — the probe follows the finger's data
        // position; no pan, no selection, no y semantics.
        moveProbeTo(e.clientX);
        return;
      }
      // Touch: the finger is a pan/pinch control — no hover crosshair or
      // tooltip; the machine redraws through its onChange.
      viewport.move(e);
      return;
    }
    if (mouseHandle && mouseHandle.pointerId === e.pointerId) {
      // Locked handle drag: the boundary follows the pointer and nothing
      // else — no crosshair, no tooltip, no pan — until the button releases.
      dragHandleTo(mouseHandle.which, e.clientX);
      return;
    }
    if (panning) {
      panHintDone = true; // a real Shift-pan: the hint has done its job
      const total = state.xs[state.xs.length - 1];
      const width = panning.v1 - panning.v0;
      // Grab semantics (chartjs-plugin-zoom, as in gpx.studio): the profile
      // follows the hand — drag right reveals LOWER x values.
      const dx = (panning.clientX - e.clientX) / state.plot.w * width;
      let s = panning.v0 + dx;
      let e1 = panning.v1 + dx;
      if (s < 0) { e1 -= s; s = 0; }
      if (e1 > total) { s -= e1 - total; e1 = total; }
      state.view = { start: s, end: e1 };
      hideTooltip();
      scheduleSync();
      return;
    }
    if (dragging && anchor != null) {
      if (state.view && !e.shiftKey && !panHintDone && !panHintShown) {
        // Zoomed in and dragging without Shift: likely trying to pan. The
        // rubber-band selection keeps working; nudge toward Shift+drag.
        panHintShown = true;
        showProfileToast(t('panHint'));
      }
      setRange(anchor, distFromEvent(e));
      hideTooltip();
      return;
    }
    // Grab cursor over a zoomed axis with Shift held: the pan affordance.
    // Over a handle hit area: the resize affordance — a hint only, hover
    // telemetry keeps working across the whole zone.
    canvas.style.cursor = e.shiftKey && state.view ? 'grab'
      : handleGrabAt(e.clientX, HANDLE_HIT_HALF) ? 'ew-resize' : '';
    // The chart's own hover stays live while a waypoint is pinned — the
    // hover crosshair + readout take over and the pinned line yields
    // (drawHoverCrosshair restores the pin when the pointer leaves).
    const xv = xFromEvent(e);
    state.hoverX = xv;
    state.hoverDist = distFromEvent(e);
    state.hoverOrigin = 'profile';
    showTooltipAt(state.hoverDist, xv);
    scheduleSync();
    // Mirror the hover on the map (orange dot), same channel the map uses
    // to drive this chart's crosshair.
    emit('hover:dist', { dist: state.hoverDist, origin: 'profile' });
  });
  canvas.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'touch') {
      if (virtualHandle && virtualHandle.pointerId === e.pointerId) {
        virtualHandle = null;
        return;
      }
      if (probeDrag && probeDrag.pointerId === e.pointerId) {
        // Probe drag over — the probe simply stays where the finger left it.
        // (A stationary tap on the probe lands here too: it never destroys or
        // repositions the probe, per the probe lifecycle.)
        probeDrag = null;
        return;
      }
      viewport.up(e);
      return;
    }
    if (mouseHandle && mouseHandle.pointerId === e.pointerId) {
      // Drag over — the boundary was committed per move; hover telemetry
      // resumes with the next pointermove. The cursor stays as the hover
      // hint left it (ew-resize over the hit area).
      mouseHandle = null;
      return;
    }
    if (panning) {
      panning = null;
      canvas.style.cursor = e.shiftKey && state.view ? 'grab' : '';
      // The cursor kept its screen position while the window moved under it —
      // re-derive crosshair + tooltip, same as after a wheel zoom.
      state.hoverX = xFromEvent(e);
      state.hoverDist = xToDist(state.hoverX, state.track, state.xs);
      state.hoverOrigin = 'profile';
      showTooltipAt(state.hoverDist, state.hoverX);
      scheduleSync();
      emit('hover:dist', { dist: state.hoverDist, origin: 'profile' });
      return;
    }
    if (!dragging) return;
    dragging = false;
    // Release the metrics panel's slow mid-drag cadence BEFORE the final
    // commit, so the resting values render at the fast interval.
    emit('sector:drag', false);
    const dist = distFromEvent(e);
    if (anchor != null && Math.abs(dist - anchor) < MIN_SECTOR_M / 4) {
      // Tap: move the nearest boundary to the tap position.
      const { start, end } = sectorStore.get();
      const which = Math.abs(start - dist) <= Math.abs(end - dist) ? 'start' : 'end';
      moveBoundary(which, dist);
    } else {
      setRange(anchor, dist);
    }
    anchor = null;
  });
  canvas.addEventListener('pointerleave', () => {
    hideTooltip();
    state.hoverDist = null;
    state.hoverX = null;
    state.hoverOrigin = null;
    scheduleSync();
    // A touch pointer "leaves" the instant it lifts (pointerup → pointerout →
    // pointerleave), but the probe outlives the finger and keeps owning the
    // map dot — only a mouse hover actually ends here.
    if (!state.probe) emit('hover:dist', { dist: null, origin: 'profile' });
  });
  // The browser can revoke an active touch at any moment (notification shade,
  // incoming gesture); a stale pan or a half-finished pinch must not linger.
  canvas.addEventListener('pointercancel', (e) => {
    if (e.pointerType !== 'touch') {
      // A revoked mouse capture must not leave the metrics panel on its
      // slow mid-drag cadence forever.
      if (dragging) { dragging = false; anchor = null; emit('sector:drag', false); }
      if (mouseHandle && mouseHandle.pointerId === e.pointerId) mouseHandle = null;
      return;
    }
    if (virtualHandle && virtualHandle.pointerId === e.pointerId) virtualHandle = null;
    if (probeDrag && probeDrag.pointerId === e.pointerId) probeDrag = null;
    viewport.cancel(e);
  });

  // Wheel zoom, gpx.studio-style: scroll to zoom the x axis around the
  // cursor. Fine pointers (desktop mouse/trackpad) only — touch devices zoom
  // with a two-finger pinch (the shared machine). Double-click or double-tap
  // anywhere restores the full track (the double-tap rule above). The
  // window math is the shared one, so the wheel and the pinch clamp alike.
  const finePointer = () =>
    window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  canvas.addEventListener('wheel', (e) => {
    if (!finePointer()) return;
    const [axis] = profileAxes() ?? [];
    if (!axis) return;
    e.preventDefault();
    const frac = Math.min(Math.max((canvasX(e) - state.plot.x0) / state.plot.w, 0), 1);
    // deltaY > 0 (scroll down) zooms out. Line-mode deltas (Firefox) scale to
    // roughly the same per-notch factor as pixel-mode deltas (Chrome).
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    zoomStep(axis, frac, Math.exp(dy * 0.004));
    // The cursor kept its screen position but its x value moved with the
    // window — re-derive crosshair + tooltip from the same event.
    state.hoverX = xFromEvent(e);
    state.hoverDist = xToDist(state.hoverX, state.track, state.xs);
    state.hoverOrigin = 'profile';
    showTooltipAt(state.hoverDist, state.hoverX);
    scheduleSync();
    emit('hover:dist', { dist: state.hoverDist, origin: 'profile' });
  }, { passive: false });
}

/** DOM handle dragging + keyboard. */
/** Maps one pointer x onto boundary `which` (windowed mapping, waypoint
 *  snapping) and moves it — shared by the element handles and the touch
 *  grab-with-radius path in wirePointer. @private */
function dragHandleTo(which, clientX) {  const rect = state.dom.canvas.getBoundingClientRect();
  const xv = clientXtoX(clientX, rect, state.plot, state.view, state.xs);
  let dist = xToDist(xv, state.track, state.xs);
  // Waypoint snapping (toggleable): within 30 screen px of a waypoint
  // the handle locks onto it; one toast per waypoint, not per move.
  const snap = snapWaypointAt(xv);
  if (snap) {
    if (lastSnapDist !== snap.dist) showProfileToast(t('snappedToWaypoint'));
    lastSnapDist = snap.dist;
    dist = snap.dist;
  } else {
    lastSnapDist = null;
  }
  moveBoundary(which, dist);
}

export function wireHandles() {
  for (const which of ['start', 'end']) {
    const el = state.dom.handles[which];
    if (!el) continue;
    // Pointer interaction is canvas-driven (see wirePointer): the handles
    // are pointer-events:none so their wide hot zone never blocks hover
    // telemetry, and the canvas grabs mouse, pen and touch alike. Only the
    // keyboard adjustment stays bound here.
    el.addEventListener('keydown', (e) => {
      if (!state.track) return;
      const action = boundaryKeyAction(which, e, getTrackTotal());
      if (!action) return;
      e.preventDefault();
      if (action.to !== undefined) {
        moveBoundary(which, action.to);
        return;
      }
      const { start, end } = sectorStore.get();
      moveBoundary(which, (which === 'start' ? start : end) + action.delta);
    });
  }
}
