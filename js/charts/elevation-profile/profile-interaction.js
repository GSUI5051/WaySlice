/**
 * Elevation profile — user interaction.
 *
 * Three input pathways, all mutating the shared chart state and triggering
 * redraws exclusively through scheduleSync() (they never draw):
 *
 *   wireControls  — the header controls: Distance/Time x-axis toggle, the
 *                   overlays multi-select menu, the waypoint-snap toggle
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
} from '../../sector/sectorStore.js';
import { createMultiSelectMenu } from '../../ui/menus.js';
import { state, isWideLayout } from './profile-state.js';
import {
  OVERLAY_METRICS, SPEED_FAMILY, overlayAvailability, applyOverlayToggle,
  buildCaches, distToX, xToDist, clientXtoX,
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
    // Wide screens: the open panel drops from the profile header row (covering
    // the trigger line) over the chart's right edge. Positioned in DOCUMENT
    // coordinates (absolute, not fixed) so the panel stays glued to the chart
    // while the page scrolls. The height hugs its rows; the cap is the space
    // down to the chart's x-axis, floored at 160px so a short window still
    // gets a usable panel (which may then overlap the axis and scroll instead)
    // — a tall chart (fullscreen, big monitors) must never stretch the panel
    // into a mostly-empty sheet. Narrow desktop windows and phones return
    // false and keep the default placement.
    positionOverride: (panelEl) => {
      if (!isWideLayout()) return false;
      const controlsRect = overlaysButton.closest('.profile-controls').getBoundingClientRect();
      const chartRect = state.dom.canvas.getBoundingClientRect();
      const scrollY = window.scrollY;
      panelEl.style.position = 'absolute';
      panelEl.style.left = '';
      panelEl.style.bottom = '';
      panelEl.style.right = `${Math.max(8, document.documentElement.clientWidth - controlsRect.right)}px`;
      panelEl.style.top = `${controlsRect.top + scrollY}px`;
      panelEl.style.maxHeight = `${Math.max(160, chartRect.bottom - controlsRect.top - 6)}px`;
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
  const v0 = state.view ? state.view.start : 0;
  const v1 = state.view ? state.view.end : (state.xs ? state.xs[state.xs.length - 1] : 0);
  const vw = Math.max(v1 - v0, 1e-9);
  const pxOf = (v) => state.plot.x0 + ((v - v0) / vw) * state.plot.w;
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
  xButtons.time.title = timeUsable ? '' : t('noTimestampData');
  xButtons.distance.setAttribute('aria-pressed', String(state.xMode === 'distance'));
  xButtons.time.setAttribute('aria-pressed', String(state.xMode === 'time'));
}

/** x-axis mode switch (rebuilds the per-point caches; drops the zoom
 *  window — x units change from meters to milliseconds). */
export function setXMode(mode) {
  if (mode === state.xMode) return;
  if (mode === 'time' && (!state.track || !state.track.hasTime)) return;
  state.xMode = mode;
  state.view = null;
  ({ xs: state.xs, speeds: state.speeds, gapSpeeds: state.gapSpeeds } =
    buildCaches(state.track, state.xMode));
  refreshControls();
  scheduleSync();
}

/**
 * Overlay toggling — the pure transition lives in profile-data
 * (applyOverlayToggle); this applies it to the chart state.
 */
export function toggleOverlay(id) {
  const result = applyOverlayToggle(state.selectedOverlays, id, maxOverlays(), lastSpeedVariant);
  if (result) {
    state.selectedOverlays = result.selected;
    for (const unhidden of result.unhide) state.hiddenOverlays.delete(unhidden);
    if (SPEED_FAMILY.includes(id)) lastSpeedVariant = id;
  }
  scheduleSync();
}

/** Clears a pinned waypoint (click on map or profile). */
export function unpinWaypoint() {
  if (!state.pinnedWaypoint) return;
  state.pinnedWaypoint = null;
  hideTooltip();
  scheduleSync();
}

const GRAB_RADIUS = 30; // px — touch grab radius around handle positions
// Touch grab radius around the probe cursor line. Slightly tighter than the
// handle radius so a contested touch always resolves to the handle
// (priority: selection handle > probe > normal chart).
const PROBE_GRAB_RADIUS = 24;
// The tap-vs-drag slop and the double-tap rule live in the shared viewport
// gestures module (js/charts/viewport-gestures.js), which the dual-variable
// chart runs too: TAP_SLOP is the radius a touch may travel and still be a
// tap (probe create / reposition), and it is the same radius the double-tap
// detector uses, so both agree on what a "tap" is.

/** Returns 'start' | 'end' if `clientX` is within GRAB_RADIUS px of either
 *  handle's rendered position, picking the nearer one; null otherwise. */
function handleGrabAt(clientX) {
  const { canvas } = state.dom;
  if (!canvas || !state.track || !state.xs || !state.xs.length) return null;
  const rect = canvas.getBoundingClientRect();
  const { start, end } = sectorStore.get();
  const closest = (dist) => {
    const xv = distToX(dist, state.track, state.xs);
    const px = state.plot.x0 + (xv - (state.view ? state.view.start : 0))
      / ((state.view ? state.view.end : state.xs[state.xs.length - 1])
         - (state.view ? state.view.start : 0)) * state.plot.w;
    return Math.abs(px + rect.left - clientX);
  };
  const dStart = closest(start);
  const dEnd = closest(end);
  if (dStart < GRAB_RADIUS && dStart <= dEnd) return 'start';
  if (dEnd < GRAB_RADIUS) return 'end';
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
  const vw = Math.max(v1 - v0, 1e-9);
  return rect.left + state.plot.x0 + ((xv - v0) / vw) * state.plot.w;
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
}

/** Drag: move the probe along the x axis to the finger position. */
function moveProbeTo(clientX) {
  if (!state.probe) return;
  const rect = state.dom.canvas.getBoundingClientRect();
  const xv = clientXtoX(clientX, rect, state.plot, state.view, state.xs);
  state.probe.dist = xToDist(xv, state.track, state.xs);
  scheduleSync();
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
  // chart). Taps on the fixed readout band above the chart count as inside —
  // the band is part of the chart component, and a dismissal there would be
  // an accident waiting for a finger aiming at the chart's bottom edge.
  // The decision keys on the pointerdown point, so a chart pan that
  // drifts past the chart edge (it started inside) never dismisses, and a
  // pointer that travels further than TAP_SLOP is a drag, not a tap.
  // Capture-phase and purely observational — no event is ever swallowed.
  const outsideDowns = new Map(); // pointerId → {x, y, outside}
  const outsideOfChart = (target) =>
    !profileBody.contains(target) &&
    !(state.dom.readout && state.dom.readout.contains(target));
  document.addEventListener('pointerdown', (e) => {
    if (!state.probe) return;
    outsideDowns.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      outside: outsideOfChart(e.target),
    });
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
    canvas.style.cursor = e.shiftKey && state.view ? 'grab' : '';
    // While a waypoint is pinned, the chart hover is inert — the pin and
    // its readout stay put until the next click anywhere.
    if (state.pinnedWaypoint) return;
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
    emit('hover:dist', { dist: null, origin: 'profile' });
  });
  // The browser can revoke an active touch at any moment (notification shade,
  // incoming gesture); a stale pan or a half-finished pinch must not linger.
  canvas.addEventListener('pointercancel', (e) => {
    if (e.pointerType !== 'touch') return;
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
    el.addEventListener('pointerdown', (e) => {
      if (!state.track) return;
      el.setPointerCapture(e.pointerId);
      // Each drag gives its own snap feedback, even when it starts inside
      // the radius of the waypoint the previous drag snapped to.
      lastSnapDist = null;
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (!state.track || !el.hasPointerCapture(e.pointerId)) return;
      // Same windowed mapping as the rendered handle position, so the handle
      // follows the cursor exactly at any zoom level.
      dragHandleTo(which, e.clientX);
    });
    el.addEventListener('keydown', (e) => {
      if (!state.track) return;
      const total = getTrackTotal();
      const step = (e.shiftKey ? 10 : 1) * Math.max(total / 400, 10);
      let delta = 0;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') delta = step;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') delta = -step;
      else if (e.key === 'Home') { moveBoundary(which, which === 'start' ? 0 : sectorStore.get().start); e.preventDefault(); return; }
      else if (e.key === 'End') { moveBoundary(which, which === 'end' ? total : sectorStore.get().end); e.preventDefault(); return; }
      else return;
      e.preventDefault();
      const { start, end } = sectorStore.get();
      moveBoundary(which, (which === 'start' ? start : end) + delta);
    });
  }
}
