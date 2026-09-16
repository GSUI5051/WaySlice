/**
 * Elevation profile — the one chart instance's shared mutable state.
 *
 * The profile is a small system of modules (data / render / interaction /
 * tooltip, orchestrated by index.js) that all operate on a single chart.
 * This module is the explicit home of everything those modules share, so
 * no module needs hidden module-level globals of its own:
 *
 *   dom              — the chart's DOM assets, filled once by initProfile
 *   track/xs/…       — the loaded track and its per-point caches
 *   xMode/view/plot  — axis mode, zoom window, plot geometry
 *   selectedOverlays — overlay picks + per-overlay show/hide
 *   hover*           — crosshair position and origin (profile/map/waypoint)
 *   probe            — touch probe position (mobile hover inspector)
 *   waypointsShown   — mirror of the map's waypoint toggle
 *
 * Deliberately NOT here: single-module machinery (render's rAF flag and
 * sampled-hr curve, interaction's overlay menu, snap flags and toast timer)
 * — that stays private to the module that owns it. Pure functions and the
 * overlay metric definitions live in profile-data.js.
 */

/** The desktop-wide layout breakpoint (matches menus.js / layout.css). The
 *  profile's overlays-menu placement and waypoint-click panning are
 *  wide-screen features only. */
export const isWideLayout = () => window.matchMedia('(min-width: 1100px)').matches;

export const state = {
  /** DOM assets — assigned once by initProfile (index.js). */
  dom: {
    root: null,
    canvas: null,
    ctx: null,
    tooltip: null,
    readout: null,     // the touch probe's fixed telemetry band (outside root)
    handles: { start: null, end: null },
    masks: { left: null, right: null },
    xButtons: { distance: null, time: null },
    snapBtn: null,
  },

  /** The loaded track and its per-point caches (built by profile-data). */
  track: null,
  xs: null,           // per-point x coordinate in the current mode
  speeds: null,       // per-point speed in m/s (null when unavailable)
  gapSpeeds: null,    // per-point grade-adjusted speed in m/s (null without elevation/time)
  profileWaypoints: [],  // track waypoints resolved onto the track: [{dist, name}]

  /** Chart view. */
  xMode: 'distance',     // 'distance' | 'time'
  view: null,            // visible x window {start, end} (null = whole track)
  plot: { x0: 0, y0: 0, w: 0, h: 0 },

  /** Overlay picks, in selection order, and per-overlay show/hide. */
  selectedOverlays: [],
  hiddenOverlays: new Set(),

  /** Crosshair position (as distance and as raw x) and what drives it:
   *  'profile' | 'map' | 'waypoint'. */
  hoverDist: null,
  hoverX: null,
  hoverOrigin: null,
  waypointHover: null,   // {dist, name} while a waypoint pin is hovered on the MAP
  pinnedWaypoint: null,  // {dist, name} pinned by a waypoint click

  /** Touch probe — the mobile equivalent of the desktop hover inspector:
   *  {dist} along the track while active, null otherwise. Created by tapping
   *  the chart, dragged along x, repositioned by tapping elsewhere on the
   *  chart, dismissed by tapping outside it. Anchored to the DATA position
   *  (never a screen pixel), so zooming/panning keeps it on its point; x is
   *  always derived through distToX at draw/hit-test time. While a probe is
   *  active the hover crosshair stands down (drawHover). */
  probe: null,

  /** Mirrors the map's waypoint toggle. */
  waypointsShown: true,
};
