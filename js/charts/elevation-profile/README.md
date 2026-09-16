# Elevation Profile — Maintenance Guide

English | [日本語](README.ja.md) | [한국어](README.ko.md)

> **This file is machine-generated and may contain errors. If you find issues, please submit a PR.**

How to maintain the elevation / telemetry profile chart: what each module owns, where new
code belongs, which rules keep the architecture sound, and how changes are verified.

## What this directory is

The elevation / telemetry profile is the canvas chart under the map: elevation band, metric
overlay curves (heart rate, speed/pace/GAP, cadence, temperature, power), heart-rate zone
bands, the sector selection, hover crosshair and the map-linked interactions. It used to be
one ~1500-line file; it is now a system of responsibility modules.

The **public API is two functions** and nothing else:

```js
import { initProfile, setProfileTrack } from './charts/elevation-profile/index.js';
initProfile(document.getElementById('profile-body'));  // main.js, boot
setProfileTrack(track);                                // main.js, on every loaded track
```

DOM contract: `#profile-body` with `#profile-canvas`, `#profile-tooltip`, `#handle-start`,
`#handle-end` inside it; `#profile-readout` (the touch probe's fixed telemetry band,
between `.profile-head` and `#profile-body`), `#btn-x-distance`, `#btn-x-time`,
`#btn-waypoint-snap`, `#btn-overlays` outside it. Never rename these ids. The
`#profile-tooltip` node stays inside `#profile-body` (absolute) so it tracks the
workspace scroll natively; the touch probe renders its readings into the fixed band
between the profile header and the chart instead — part of the profile module itself, so it can never cover
the plot and never shifts the layout when readings come and go (see
`showTooltipAt` / `initProfile`).

## Module map

| File | Responsibility | Exports |
|---|---|---|
| `index.js` | Orchestrator: DOM assembly, external event surface, track lifecycle, resize handling | `initProfile`, `setProfileTrack` |
| `profile-state.js` | The one chart instance's shared mutable state (`state`) + `isWideLayout` | `state`, `isWideLayout` |
| `profile-data.js` | Pure computation: per-point caches, downsampling, coordinate conversions, overlay definitions & toggle rule. No DOM, no sibling imports | `OVERLAY_METRICS`, `SPEED_FAMILY`, `buildCaches`, `overlayAvailability`, `overlayValueAt`, `sampleOverlay`, `sampleElevation`, `seriesExtremes`, `distToX`, `xToDist`, `clientXtoX`, `speedToPace`, `formatOverlayValue`, `applyOverlayToggle` |
| `profile-render.js` | All canvas drawing: the `sync()` pass and every layer in it, `scheduleSync`, handle/mask positioning | `initRender`, `scheduleSync`, `sync`, `resizeCanvas`, `positionHandles`, `refreshHandleLabels` |
| `profile-interaction.js` | The three input pathways (header controls, canvas pointer — hover/select/zoom + the touch probe gestures, sector handles) + toast + waypoint snapping. The touch pinch/pan/double-tap state machine is NOT here: it is the shared `js/charts/viewport-gestures.js` the dual-variable chart runs too. Never draws | `wireControls`, `wirePointer`, `wireHandles`, `setXMode`, `toggleOverlay`, `refreshControls`, `refreshSnapToggle`, `unpinWaypoint` |
| `profile-tooltip.js` | The hover tooltip and the touch probe's readout DOM + content | `showTooltipAt`, `hideTooltip`, `resetProbeReadout` |

Dependency graph (arrows = imports; verified against the current import statements and
kept acyclic):

```text
index       → state, data, render, interaction, tooltip
interaction → state, data, render (scheduleSync only), tooltip, ../viewport-gestures (touch pinch / pan / double-tap reset)
render      → state, data, tooltip (showTooltipAt, called from drawHover)
tooltip     → state, data
data        → nothing in this directory (only geo / metrics / utils outside it)
state       → nothing
```

`profile-data.js` is the bottom of the graph: it imports nothing from this directory, which
is exactly what makes it unit-testable. There is **no** `profile-utils.js`: at present
every small helper has exactly one consuming module and lives there.

## Shared state

Everything the modules share lives in the `state` object (`profile-state.js`). Anything only
one module uses stays a module-private `let` — check before moving a field in.

`state.dom` (assembled once during initialization: `index.js` fills the queried nodes and
`initRender` creates the masks and binds canvas/ctx; `wireControls` fills `snapBtn`):
`root`, `canvas`, `ctx`, `tooltip`, `readout` (the probe's band, outside root),
`handles.{start,end}`, `masks.{left,right}`, `xButtons.{distance,time}`, `snapBtn`.

Chart data: `track`, `xs` (per-point x in the current axis mode), `speeds`, `gapSpeeds`,
`profileWaypoints`. The `speeds`/`gapSpeeds` caches always pass through a source-based clean:
recorded speeds are first cross-checked against the concurrent dd/dt (readings more than 50 % above it are
dropped — GPS drift) and then diluted by the 5-point sliding-window smooth (`cleanSpeedSeries`, from
sectorMetrics: each point = the mean of the finite values among itself and its two nearest neighbors on
each side);
fully computed series take the 3σ clean (`cleanComputedSpeeds`: outliers replaced by interpolation from
the nearest kept neighbors); rest-stop zeros are data and take part in the window mean.
Chart view: `xMode` (`'distance' | 'time'`), `view` (`{start,end}` or `null` = full track),
`plot` (`{x0,y0,w,h}` in CSS px).
Overlays: `selectedOverlays` (selection order), `hiddenOverlays` (Set of temporarily hidden ids).
Hover: `hoverDist`, `hoverX`, `hoverOrigin` (`'profile' | 'map' | 'waypoint'`),
`waypointHover`, `pinnedWaypoint`.
Touch probe: `probe` (`{dist}` while active, else `null`) — the mobile equivalent of the
hover inspector. Anchored to the track distance (x is re-derived through `distToX` on
every draw/hit-test), so pan/zoom/mode switches keep it on its data point. While it is
active the hover crosshair stands down and the readout belongs to the probe
(`showTooltipAt` ignores non-probe calls, `hideTooltip` needs `force`).
Misc: `waypointsShown` (mirror of the map's waypoint toggle).

Module-private (do **not** move into `state`): render owns `syncPending`, `hrHoverCurve`,
`MARGIN` and the bound DOM aliases; interaction owns `lastSpeedVariant`, `overlaysMenu`,
`waypointSnap`, `lastSnapDist`, the toast timer, the pan-hint flags and the touch-gesture
flags (virtual handle, probe drag, outside-tap map). The tap candidate, the pinch baseline and the pan window belong to the shared gesture machine (`js/charts/viewport-gestures.js`), which interaction only feeds.

Conventions:

- Mutable scalars are always read/written as `state.X` — that prefix is how shared state
  stays visible in review.
- Immutable-after-init references (ctx, canvas, handles…) are destructured once in the
  owning module's init (`initRender`) into module-level `let`s.
- The renderer is the only writer of `state.plot` (via `resizeCanvas`) and of `hrHoverCurve`.

## The render pass (`sync()`)

Actual call sequence — insert new layers at the right slot, never reorder casually:

1. x ticks (distance or elapsed time, per `xMode`)
2. clipped block: **HR zone bands**, then overlay curves (two-pass: pass 1 samples every
   visible overlay and derives its scale, pass 2 draws the lines — bands therefore sit
   *under* the curves)
3. `placeMasks()` — the sector veil DOM elements are positioned here (before the
   elevation branch)
4. elevation branch: flat dashed reference line if the track has no elevation, otherwise
   grid + y labels, overlay axis strip, elevation band (full track), sector highlight,
   waypoint pins
5. `positionHandles()` — the handle DOM elements are positioned (both branches)
6. hover crosshair (+ surface-filled dot with an accent ring on the elevation curve, +
   solid dot where the crosshair crosses the drawn HR polyline). While a touch probe is
   active it draws in the crosshair's place — same line and dots, anchored to the probe's
   data position; its readings render into the fixed telemetry band between the profile header and
   the chart — a fixed 2×4 slot grid, position / elevation / speed family / heart rate over
   cadence / temperature / power / empty: position and elevation always show; a sensor
   slot shows its value while its overlay is enabled, a muted "Not selected" while the
   track carries the data but the overlay is off, and stays blank when the track lacks
   the sensor; an enabled slot without a reading shows an em dash. The heart-rate slot
   is two-level — value on top, zone underneath — and all slots center their content,
   so single-line slots stay vertically centered in the taller row (`#profile-readout`,
   coarse-pointer devices; fine-pointer devices keep the floating fallback box capped
   at half the screen width, rows breaking between readings, never inside one)

Rules baked into this pass:

- Overlays scale over the **full track** (global y); zooming stretches only x.
- The speed family's axis strip ends at the speed series' **per-point maximum**
  (`seriesExtremes`), so the top label always reads the same value the metrics
  list's Maximum Speed reports; the drawn curve itself stays on `sampleOverlay`'s
  column means. Every other overlay keeps the padded sampled top.
- Zone bands and the hover dot map bpm → y through the **hr overlay's own lo/hi scale** and
  are clipped to it; they are drawn only while that scale exists (hr curve visible with
  data). Never widen the axis for a zone; never invent a second mapping. The bands are
  additionally gated by the settings drawer's band toggle (`showZones`,
  `js/metrics/heartRateDisplay.js`); the crosshair's intersection dot is not — it belongs
  to the crosshair, not to the bands.
- While hovering — or while a touch probe is active — the band containing the inspected
  HR reading is tinted deeper — about 2× the resting alpha, still faint (`BAND_ALPHA` /
  `ACTIVE_BAND_ALPHA`). The active band is classified through the same reading path as the
  tooltip's zone label, so highlight and label always agree; nothing inspected, no
  highlight — and no highlight without the drawer's
  highlight toggle either (`js/metrics/heartRateDisplay.js`): it needs the band toggle on,
  and its stored choice survives while the bands are hidden.
- Draw order matters: zone bands → overlay lines → elevation band → highlight → hover.
- Pass-1 sampling is cached: the per-overlay column means and the per-point speed maxima are
  recomputed only when the track, x-mode, plot width or overlay selection changes — hover,
  probe and handle frames redraw from the stored samples (`sampleVisibleOverlays` +
  `overlaySamples` in `profile-render.js`).
- `sync()` reads chart state without mutating it; the one render-owned write is
  `hrHoverCurve`. Its output is determined by `state`, `sectorStore` and the current theme
  tokens (`getComputedStyle`), and its writes go to the canvas plus the render-owned DOM
  (masks, handles) and, via `showTooltipAt`, the tooltip. It is deterministic per frame,
  but not a pure function — it draws.

## Coordinate conversions

`distToX` / `xToDist` (data↔x domain, axis-mode aware) and `clientXtoX` (cursor px → x
through the zoom window) live in `profile-data.js` and are the **single source of truth**.
Every cursor path (hover, rubber-band drag, handle drag, touch-probe tap/drag, wheel zoom)
and every drawn element
must go through them, or handles drift off the cursor when zoomed. If you need a new
conversion, add it there as a pure function with explicit parameters.

## Recipes

### Add an overlay metric (e.g. a new sensor)

1. Add the definition to `OVERLAY_METRICS` (`id`, `colorToken`, `labelKey`, `axis`).
2. Give the track a `hasX` flag in the parser, wire it into `overlayAvailability`.
3. Add the per-point reader to `overlayValueAt`.
4. Add `labelKey` to **all five** language packs (`js/language/` — parity is test-enforced).
5. Slot cap: extend `maxOverlays()` in `profile-interaction.js` if the family should get a slot.

### Add a drawn layer

- Sample through `profile-data.js` (`sampleOverlay`/`sampleElevation`); never read
  `track.points[]` inside the renderer directly except in existing hover paths.
- Colors come from CSS design tokens (`--series-*`, `--hr-zone-*`), re-read per frame for
  theme switches.
- Insert at the correct z-order slot in `sync()`; update the layer list in this README.

### Add an interactive control

- Wire it in `profile-interaction.js` (header controls → `wireControls`, canvas gestures →
  `wirePointer`, sector handles → `wireHandles`).
- Mutate `state`, then call `scheduleSync()`. Interaction code **never draws** and never
  touches `ctx`.

### Touch heart-rate zone data

- Read-only: `loadHeartRateSettings()` + `computeZoneBounds()` from `js/metrics/`. This
  feature never recalculates or edits the user's zones.
- Zones are per-mode bpm lower bounds; zone 5 is open-topped (clip to the scale).
- Listen to `hrzones:changed` or the drawing goes stale after edits in the settings dialog.
- Band visibility and the hover highlight are the user's display settings
  (`js/metrics/heartRateDisplay.js`: `getHeartRateDisplay` / `setHeartRateDisplay`,
  localStorage `wayslice-hr-display`): `showZones` hides the bands entirely, `highlight`
  gates the hover deepening. Listen to `hrzones:display` — emitted on every change — or
  the bands go stale after toggles in the settings drawer. The readouts' zone label
  follows the same pair: it exists only while `showZones` is on and wears its
  `--hr-zone-N` color while `highlight` is on.

### State changes

- Anything two modules must see → `state` object, then update this README.
- Anything single-module → module-private `let`; do not grow `state` by default.

## Rules that keep the architecture sound

1. `profile-data.js` stays pure: explicit parameters, no DOM, no `state` import. If a
   function needs state, it belongs elsewhere (or the state is passed in).
2. `profile-render.js` never imports `profile-interaction.js`; interaction never draws.
   The renderer touches only its own DOM assets (canvas, masks, handles); the one call it
   makes into another module's DOM is `drawHover → showTooltipAt` (tooltip).
3. Overlay family rule: speed/pace/GAP are one series with one slot. In
   `applyOverlayToggle` a sibling variant **replaces** the selected one even when all slots
   are full — the sibling check must come before the slot-cap check. `toggleOverlay`
   applies the returned `{selected, unhide}` to `state` and updates `lastSpeedVariant`.
4. Import depth: modules live one directory deeper than the old flat file — `menus.js` is
   `../../ui/menus.js`, stores are `../../core/…`, NOT `../…`.
5. No new libraries, no globals: ES modules only, same as the rest of the project.
6. Canvas caching: during development the browser may serve stale modules — the project
   has no build step and the dev server sends no explicit caching directives, so browsers
   can apply heuristic caching. Hard-reload via CDP `Page.reload {ignoreCache: true}`
   before doubting your changes.

7. Viewport gestures are shared, not forked: the pinch / pan / tap / double-tap machine lives in
   `js/charts/viewport-gestures.js` and is what the dual-variable chart runs as well. The profile
   supplies one x-axis adapter (domain, zoom floor, plot geometry, `state.view` accessors); the
   wheel zoom commits through `zoomStep` for exactly that reason. Never re-derive the window math
   (`zoomWindow` / `panWindow`) or its clamps locally — two copies would drift apart at the edges.

## Testing

**Automated** — `tests/index.html` (serve the repo root, e.g. `python -m http.server`).
The suite does not import this module (it is canvas/DOM work); it is the regression net for
the shared math (`metrics/`, `geo/`) and for `tests/suite-viewport.js` (the shared zoom/pan
window math + the double-tap rule). Expected: all green.

**Manual** — load `sample/telemetry.gpx` (full telemetry except temperature and power), then
replay at least:

- overlays menu: HR on/off → zone bands appear/disappear; speed → pace → GAP replace each
  other; cadence blocked when all slots are taken
- hover: crosshair, elevation dot, HR intersection dot, tooltip readouts (HR carries its
  zone label only while the drawer's zone-band toggle is on, highlighted in its zone
  color while the highlight toggle is also on)
- touch probe (mobile / touch): tap the chart → cursor line + the fixed telemetry band
  between the profile header and the chart — a 2×4 grid of permanent slots: [position] [elevation] [speed/pace]
  [heart rate] / [cadence] [temperature] [power] [empty]. Every slot is independently
  centered and never moves; position and elevation always show; a sensor slot shows
  its value while its overlay is enabled, a muted "Not selected" while the track
  carries the data but the overlay is off, and stays blank when the track lacks the
  sensor; an enabled slot without a reading at the point shows an em dash. The
  heart-rate cell stacks its zone under the value — the zone label exists only while
  the drawer's zone-band toggle is on and wears its zone color while the highlight
  toggle is also on — and every slot centers its content,
  so single-line cells stay vertically centered in the taller row. With no
  point selected the band shows a muted "tap the chart" hint;
  drag the probe along x and the values update in place (slot geometry never moves); tap
  another spot → repositions (never destroys); tap outside the chart → dismissed and the
  band returns to the hint. A single-finger drag pans (zoomed), a two-finger pinch zooms,
  neither may create, move or dismiss the probe, and the sector handles keep priority
- sector: rubber-band drag, handle drag with waypoint snapping, keyboard arrows/Home/End
- zoom: wheel (fine pointers only), Shift + drag pan, double-click / double-tap reset
- x-mode: Distance ↔ Time
- live switches: language, theme, units, HR-zone edits, the drawer's two heart-rate
  display toggles (bands on/off, hover highlight) while the chart is open
- mobile viewport (~390 px): no horizontal overflow, layering intact

**Canvas assertions** — pixel probes via `ctx.getImageData` are the practical way to assert
canvas features: count tinted rows down a fixed column (zone bands on/off), measure the
vertical run of series-colored pixels at the crosshair (dot size/position). Zone-band tints
shift RGB by only a few units — use tight thresholds and exclude curve pixels.

## When this README must be updated

- a module's responsibility or exports change
- a state field moves between `state` and a module, or a field is added
- the draw order changes, or a new layer is added
- a new external event is subscribed/emitted
- a rule in "Rules that keep the architecture sound" changes
