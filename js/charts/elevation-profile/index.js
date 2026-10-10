/**
 * Elevation / telemetry profile — entry module.
 *
 * The profile is a system of responsibility modules (this orchestrator plus
 * profile-state / profile-data / profile-render / profile-interaction /
 * profile-tooltip); callers only ever see initProfile() + setProfileTrack().
 *
 * What lives here: the DOM wiring and the external event surface — the bus
 * subscriptions that make the chart a peer of the map (shared hover channel,
 * waypoint hover/select/visibility, theme/unit/language switches, zone
 * edits), the resize handling, and the track lifecycle. Rendering is driven
 * exclusively through render.scheduleSync(); interaction modules mutate the
 * shared state (profile-state.js) and never draw.
 *
 * uPlot renders the chart (lazily loaded on the first track — see
 * uplot-loader.js) from the complete raw series, with DOM overlay handles
 * for the sector boundaries. Two x-axis modes share one data path; metric
 * overlays can be layered on top, each with its own global scale. On desktop
 * (fine pointers) the wheel zooms the x axis around the cursor,
 * gpx.studio-style; Shift + drag pans the zoomed window. A double-click
 * (mouse) or double-tap (touch) anywhere restores the full track — zoom
 * window and sector selection reset, with a toast. A plain drag while
 * zoomed still selects a sector range (mouse). Touch model: one finger
 * pans the zoomed window, two fingers pinch-zoom (hinted once on the first
 * touch), and the sector changes only via the boundary handles; there is
 * no wheel. Touch has no hover, so the desktop hover inspector becomes a
 * tap probe: tap the chart to pin a telemetry cursor, drag it
 * along x, tap elsewhere to reposition it, tap outside
 * the chart to dismiss it — its readings render into the fixed telemetry
 * band between the profile header and the chart (#profile-readout, coarse-pointer devices only; on
 * fine-pointer devices the classic floating box is kept), never into a
 * floating tooltip over the plot — the sector handles keep priority over
 * all of it, and pans/pinches never create, move or dismiss the probe by
 * accident.
 */
import { sectorStore } from '../../sector/sectorStore.js';
import { trackStore } from '../../core/stores.js';
import { emit, on } from '../../core/events.js';
import { state, isWideLayout } from './profile-state.js';
import { buildCaches, distToX, overlayAvailability } from './profile-data.js';
import {
  initRender, resizeCanvas, sync, scheduleSync, refreshHandleLabels,
  invalidateChartStyle, invalidateZoneBands,
} from './profile-render.js';
import {
  wireControls, wirePointer, wireHandles, refreshControls,
  refreshControlsFit, refreshSnapToggle, unpinWaypoint,
} from './profile-interaction.js';
import { hideTooltip, resetProbeReadout } from './profile-tooltip.js';

/** Wires the chart DOM, the external event surface and the resize handling. */
export function initProfile(rootEl) {
  const dom = state.dom;
  dom.root = rootEl;
  dom.canvas = rootEl.querySelector('#profile-canvas');
  dom.ctx = dom.canvas.getContext('2d');
  dom.chart = rootEl.querySelector('#profile-chart');
  dom.tooltip = rootEl.querySelector('#profile-tooltip');
  // The probe's fixed telemetry band sits BETWEEN the profile header and the
  // chart (outside #profile-body, in front of the x-axis labels) — part of
  // the profile module, never an overlay: it cannot cover the plot and never
  // moves while the probe slides. It exists on coarse-pointer devices only
  // (profile.css); showTooltipAt falls back to the floating box where it is
  // display:none.
  dom.readout = document.getElementById('profile-readout');
  resetProbeReadout();
  dom.handles.start = rootEl.querySelector('#handle-start');
  dom.handles.end = rootEl.querySelector('#handle-end');
  dom.xButtons.distance = document.getElementById('btn-x-distance');
  dom.xButtons.time = document.getElementById('btn-x-time');

  initRender();

  sectorStore.subscribe(() => scheduleSync());
  on('hover:dist', ({ dist, origin }) => {
    if (origin === 'profile') return;
    state.hoverDist = dist;
    state.hoverOrigin = origin;
    scheduleSync();
  });
  on('waypoints:visible', ({ visible }) => {
    state.waypointsShown = visible;
    scheduleSync();
  });
  on('waypoint:hover', ({ dist, name }) => {
    if (dist == null) {
      // The pin's mouseout only owns the hover if the profile cursor has not
      // already moved on to something else.
      state.waypointHover = null;
      if (state.hoverOrigin === 'waypoint') {
        state.hoverDist = null;
        state.hoverX = null;
        state.hoverOrigin = null;
        hideTooltip();
      }
      scheduleSync();
      return;
    }
    state.waypointHover = { dist, name: name || null };
    state.hoverDist = dist;
    state.hoverX = null;
    state.hoverOrigin = 'waypoint';
    scheduleSync();
  });
  on('waypoint:select', ({ dist, name, index }) => {
    // Desktop-wide only: a waypoint click pans the profile's zoom window so
    // the waypoint lands at the window center — the zoom level (window
    // width) stays untouched — and pins the waypoint line + readout until
    // the next click anywhere. With no zoom window the whole track is
    // already visible, so there is nothing to pan; the pin still shows.
    if (!state.track || !isWideLayout()) return;
    if (state.view) {
      const total = state.xs[state.xs.length - 1];
      const width = state.view.end - state.view.start;
      let start = distToX(dist, state.track, state.xMode) - width / 2;
      let end = start + width;
      if (start < 0) { end -= start; start = 0; }
      if (end > total) { start -= end - total; end = total; }
      state.view = { start, end };
    }
    state.pinnedWaypoint = { dist, name: name || null, index };
    // The map flags the pinned marker with the filled map-pin glyph — the
    // profile owns the pin state, the map only mirrors it (`index` is the
    // marker key; two waypoints may share coordinates).
    emit('waypoint:pinned', { index });
    scheduleSync();
  });
  on('waypoint:deselect', unpinWaypoint);
  // Theme/units changes re-style the chart through its per-draw color and
  // label functions — the stamp forces the next sync to re-apply them.
  on('theme:changed', () => {
    invalidateChartStyle();
    scheduleSync();
  });
  on('units:changed', () => {
    invalidateChartStyle();
    scheduleSync();
  });
  on('language:changed', () => {
    // Axis tick labels are format-composed text read at draw time —
    // without the style bump the chartKey memo sees nothing new and skips
    // the resync, leaving the previous language's ticks on the canvas.
    invalidateChartStyle();
    refreshHandleLabels();
    refreshSnapToggle();
    // Also re-decides the header's text-vs-icon LEVEL (it measures the
    // localized texts, so a different language can land on a different level
    // at the same window width) and re-applies the state-dependent control
    // strings the i18n pass cannot know: the Time button's disabled reason.
    refreshControls();
    // The band's idle hint is localized text — re-render it (an active
    // probe's readings re-render through the next sync anyway).
    if (!state.probe) resetProbeReadout();
    scheduleSync();
  });
  // Zone edits (mode / boundaries / base heart rates) change the bands
  // behind the HR curve. Both events need the chart-stamp bump on top of the
  // sync: the bands draw inside uPlot's draw cycle, and these events alone
  // would only repaint the annotation canvas.
  on('hrzones:changed', () => {
    invalidateZoneBands();
    scheduleSync();
  });
  // So do the drawer's display toggles (bands visibility, hover highlight):
  // js/metrics/heartRateDisplay.js emits 'hrzones:display' on every change.
  on('hrzones:display', () => {
    invalidateZoneBands();
    scheduleSync();
  });

  if ('ResizeObserver' in window) {
    const resize = () => {
      resizeCanvas();
      // The controls' text-vs-icon switch is a fit measurement over the
      // current pane width — re-probe whenever the pane is resized.
      refreshControlsFit();
      sync();
    };
    new ResizeObserver(resize).observe(rootEl);
    new ResizeObserver(resize).observe(rootEl.parentElement);
    window.addEventListener('resize', resize, { passive: true });
  }

  wireControls();
  wirePointer();
  wireHandles();
  resizeCanvas();
}

/** Loads a track into the chart and resets mode/overlay state to fit it. */
export function setProfileTrack(newTrack) {
  state.track = newTrack;
  if (!state.track.hasTime) state.xMode = 'distance';
  state.view = null; // a fresh track always starts fully zoomed out
  state.probe = null; // the old track's probe position means nothing here
  // So does the old pin — its dist/name/index describe the previous track's
  // waypoints, and the map's pinned-marker glyph mirrors through the same
  // unpin (no-op when nothing was pinned).
  unpinWaypoint();
  hideTooltip();
  resetProbeReadout(); // the band returns to its idle hint for the new track
  // Rebuild the per-point caches before filtering the selected overlays. This
  // matters when the user loads a second file with different telemetry fields.
  ({ xs: state.xs, speeds: state.speeds, gapSpeeds: state.gapSpeeds, grades: state.grades } =
    buildCaches(state.track, state.xMode));
  rebuildProfileWaypoints();
  const avail = overlayAvailability(state.track, state);
  state.selectedOverlays = state.selectedOverlays.filter((id) => avail[id]);
  state.dom.root.classList.add('has-track');
  // The readout precedes #profile-body in the DOM, so it can't be targeted
  // by a sibling selector — flag it directly (the class is never removed
  // because a loaded track is never cleared).
  state.dom.readout?.classList.add('has-track');
  resizeCanvas();
  refreshControls();
  scheduleSync();
  // The no-elevation note's visibility settles inside sync's rAF pass and it
  // is a flex item of the measured header line — re-probe the controls'
  // text-vs-icon switch once that pass has laid it out.
  requestAnimationFrame(refreshControlsFit);
}

/**
 * The track's waypoints arrive resolved onto the track (each carries its
 * `dist` along the track, ordered by it) — the profile only strips them to
 * the pair the pins draw from.
 * @private
 */
function rebuildProfileWaypoints() {
  state.profileWaypoints = (state.track?.waypoints || [])
    .map((w) => ({ dist: w.dist, name: w.name || null }));
}
