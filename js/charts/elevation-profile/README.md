# Elevation Profile — Maintenance Guide

English | [日本語](README.ja.md) | [한국어](README.ko.md)

> **This file is machine-generated and may contain errors. If you find issues, please submit a PR.**

How to maintain the elevation / telemetry profile chart: what each module owns, where new
code belongs, which rules keep the architecture sound, and how changes are verified.

## What this directory is

The elevation / telemetry profile is the chart under the map, rendered by **uPlot** (the
vendored ES module in `vendor/uplot/`, lazy-loaded on the first track — see
`uplot-loader.js`): elevation line, metric overlay curves (heart rate, speed/pace/GAP,
cadence, temperature, power), heart-rate zone bands, grid and axes. uPlot always draws the
COMPLETE raw series — zooming and the sector view act on the chart's x scale range, never
on the data. The DATA stays full-resolution end to end; the sector selection dims the
curves AND the grid lines OUTSIDE the selected span through their own strokes (one
gradient stroke of one cached path each — no second pass, no overlay mask, never touching
the data; see the selection
dimming below). WaySlice
owns the business layers: the sector selection, hover crosshair, waypoint pins, the
per-overlay axis strip (drawn on its own annotation canvas above the chart) and the
map-linked interactions. It used to be one ~1500-line file; it is now a system of
responsibility modules.

The **public API is two functions** and nothing else:

```js
import { initProfile, setProfileTrack } from './charts/elevation-profile/index.js';
initProfile(document.getElementById('profile-body'));  // main.js, boot
setProfileTrack(track);                                // main.js, on every loaded track
```

DOM contract: `#profile-body` with `#profile-chart` (the uPlot host, beneath),
`#profile-canvas` (WaySlice's annotation canvas and the pointer surface, above),
`#profile-tooltip`, `#handle-start`, `#handle-end` inside it; `#profile-readout` (the touch
probe's fixed telemetry band, between `.profile-head` and `#profile-body`), `#btn-x-distance`,
`#btn-x-time`, `#btn-waypoint-snap`, `#btn-overlays`, `#btn-profile-fit-sector`,
`#btn-more-controls` with the `#profile-overflow-panel` outside it. Never rename these ids.
The `#profile-tooltip` node stays inside `#profile-body` (absolute) so it tracks the
workspace scroll natively; the touch probe renders its readings into the fixed band
between the profile header and the chart instead — part of the profile module itself, so it can never cover
the plot and never shifts the layout when readings come and go (see
`showTooltipAt` / `initProfile`).

## Module map

| File | Responsibility | Exports |
|---|---|---|
| `index.js` | Orchestrator: DOM assembly, external event surface, track lifecycle, resize handling | `initProfile`, `setProfileTrack` |
| `profile-state.js` | The one chart instance's shared mutable state (`state`) + `isWideLayout` | `state`, `isWideLayout` |
| `profile-data.js` | Pure computation: per-point caches, full-resolution scale ranges, coordinate conversions, overlay definitions & toggle rule. No DOM, no sibling imports | `OVERLAY_METRICS`, `SPEED_FAMILY`, `buildCaches`, `overlayAvailability`, `overlayValueAt`, `seriesExtremes`, `overlayExtremes`, `overlayYRange`, `eleYRange`, `distToX`, `xToDist`, `clientXtoX`, `xvToPx`, `sectorDimSteps`, `speedToPace`, `formatOverlayValue`, `applyOverlayToggle`, `sectorFitWindow`, `FIT_SECTOR_FRACTION` |
| `profile-render.js` | The uPlot chart lifecycle (lazy create, setData/setScale/setSize updates) + the annotation canvas pass (axis strip, waypoint pins, crosshair), the selection dimming (curves and grid lines step to `--profile-series-dim` outside the sector through one gradient stroke each), `scheduleSync`, handle positioning | `initRender`, `scheduleSync`, `sync`, `resizeCanvas`, `refreshHandleLabels`, `invalidateChartStyle` |
| `uplot-loader.js` | The lazy loader for the vendored uPlot ES module: one cached download promise (reset on failure, retryable), the vendor CSS link | `loadUPlot` |
| `profile-interaction.js` | The three input pathways (header controls, canvas pointer — hover/select/zoom + the touch probe gestures, sector handles) + toast + waypoint snapping. The touch pinch/pan/double-tap state machine is NOT here: it is the shared `js/charts/viewport-gestures.js` the dual-variable chart runs too. Never draws | `wireControls`, `wirePointer`, `wireHandles`, `refreshControls`, `refreshControlsFit`, `refreshSnapToggle`, `unpinWaypoint` |
| `profile-tooltip.js` | The hover tooltip and the touch probe's readout DOM + content | `showTooltipAt`, `hideTooltip`, `resetProbeReadout` |

Dependency graph (arrows = imports; verified against the current import statements and
kept acyclic):

```text
index       → state, data, render, interaction, tooltip
interaction → state, data, render (scheduleSync only), tooltip, ../viewport-gestures (touch pinch / pan / double-tap reset)
render      → state, data, tooltip (showTooltipAt, called from the crosshair pass), ./uplot-loader
tooltip     → state, data
loader      → nothing in this directory (imports the vendored vendor/uplot module)
data        → nothing in this directory (only geo / metrics / utils outside it)
state       → nothing in this directory (re-exports isWideLayout from ../utils/layout)
```

`profile-data.js` is the bottom of the graph: it imports nothing from this directory, which
is exactly what makes it unit-testable. There is **no** `profile-utils.js`: at present
every small helper has exactly one consuming module and lives there.

## Shared state

Everything the modules share lives in the `state` object (`profile-state.js`). Anything only
one module uses stays a module-private `let` — check before moving a field in.

`state.dom` (assembled once during initialization: `index.js` fills the queried nodes and
`initRender` binds canvas/ctx; `wireControls` fills `snapBtn`):
`root`, `canvas`, `ctx`, `chart` (the uPlot host), `tooltip`, `readout` (the probe's band, outside root),
`handles.{start,end}`, `xButtons.{distance,time}`, `snapBtn`.

Chart data: `track`, `xs` (per-point x in the current axis mode), `speeds`, `gapSpeeds`,
`profileWaypoints`. The `speeds`/`gapSpeeds` caches always pass through a source-based clean:
recorded speeds are first cross-checked against the concurrent dd/dt (readings more than 50 % above it are
dropped — GPS drift) and then diluted by the 5-point sliding-window smooth (`cleanSpeedSeries`, from
sectorMetrics: each point = the mean of the finite values among itself and its two nearest neighbors on
each side);
fully computed series take the 3σ clean (`cleanComputedSpeeds`: outliers replaced by interpolation from
the nearest kept neighbors); rest-stop zeros are data and take part in the window mean.
Chart view: `xMode` (`'distance' | 'time'`), `view` (`{start,end}` or `null` = full track),
`plot` (`{x0,y0,w,h}` in CSS px — mirrored from uPlot's plot bbox on every chart sync/resize).
Overlays: `selectedOverlays` (selection order).
Hover: `hoverDist`, `hoverX`, `hoverOrigin` (`'profile' | 'map' | 'waypoint'`),
`waypointHover`, `pinnedWaypoint`.
Touch probe: `probe` (`{dist}` while active, else `null`) — the mobile equivalent of the
hover inspector. Anchored to the track distance (x is re-derived through `distToX` on
every draw/hit-test), so pan/zoom/mode switches keep it on its data point. While it is
active the hover crosshair stands down and the readout belongs to the probe
(`showTooltipAt` ignores non-probe calls, `hideTooltip` needs `force`).
Misc: `waypointsShown` (mirror of the map's waypoint toggle).

Module-private (do **not** move into `state`): render owns `syncPending`, the uPlot
instance, its per-track series/scale caches, the style-token snapshot and the bound DOM
aliases; interaction owns `lastSpeedVariant`, `overlaysMenu`,
`waypointSnap`, `lastSnapDist`, the toast timer, the pan-hint flags and the touch-gesture
flags (virtual handle, probe drag, outside-tap map). The tap candidate, the pinch baseline and the pan window belong to the shared gesture machine (`js/charts/viewport-gestures.js`), which interaction only feeds.

Conventions:

- Mutable scalars are always read/written as `state.X` — that prefix is how shared state
  stays visible in review.
- Immutable-after-init references (ctx, canvas, handles…) are destructured once in the
  owning module's init (`initRender`) into module-level `let`s.
- The renderer is the only writer of `state.plot` (mirrored from the uPlot bbox).

## The render pass

Rendering is async (the first pass awaits the uPlot download; later passes are
microtask-fast) and single-flight: scheduleSync batches through rAF, and a sync requested
while a render runs re-runs once when it finishes. Each pass is two halves:

**Chart half (`syncChart` inside `chart.batch()` — one synchronous uPlot draw):** the
scale cache is recomputed only when track / x-mode / speed-family variant changes
(`ensureScales`); the data tuple is swapped by REFERENCE when the caches changed
(`setData` — uPlot never gets a copy); series visibility flags are applied (`show`);
every y scale is set explicitly with `setScale` (uPlot never re-ranges an explicit
setScale — WaySlice's full-resolution ranges ARE the chart's ranges); the x scale is set
to the view window (`state.view`, or the full domain). uPlot then draws: grid, axes, x
ticks (the shared `niceStep` rule), HR zone bands (`drawAxes` hook, beneath every
series), the overlay curves and the elevation line (full-resolution, `spanGaps`, line only —
the area fill below the curve was dropped by design, user decision 2026-10-03), and —
for tracks without elevation — the flat dashed reference line (`draw` hook, above the
series). uPlot's cursor and legend are disabled: it binds no pointer listeners.

**Selection dimming (inside the same uPlot draw):** with a partial sector selected, every
telemetry series strokes through `selectionStroke` — the plain series color inside the
sector span, `--profile-series-dim` outside it, stepped by a horizontal CanvasGradient
whose stops sit at the handle positions (mapped through the same `xvToPx` conversion as
everything else). The elevation grid rows (the ele axis's native grid, one path per draw)
and the hand-drawn x grid verticals share the same gradient, so the grid fades with the
curves; a vertical line simply takes the gradient's color at its own x. One stroke of the
ONE cached path each: the curves stay continuous across the boundaries, no second pass or
overlay can double-draw anything, and the axes, ticks, tick labels, zone bands and hover/
legend layers keep their strength everywhere. A whole-track selection strokes plain; since
uPlot re-evaluates every stroke on each draw, handle drags re-derive the style from live
state — `chartKey` carries the sector span so the moves reach the chart.

**Annotation half (the `#profile-canvas` pass, after the chart):** overlay axis strip →
waypoint pins → hover/probe crosshair (hairline, surface-filled dot with an
accent ring on the elevation curve, solid dot where the crosshair crosses the drawn HR
polyline — interpolated along the same segment the drawn line spans). While a touch probe
is active it draws in the crosshair's place — same line and dots, anchored to the probe's
data position; its readings render into the fixed telemetry band between the profile header and
the chart — a fixed 2×4 slot grid, position / elevation / grade / speed family / heart
rate over cadence / temperature / power: position, elevation and grade always show (the
grade reads the nearest gradient window across the ≤20 m blind spots after each 50 m
reset, and goes blank without elevation); a sensor
slot shows its value while its overlay is enabled, a muted "Not selected" while the
track carries the data but the overlay is off, and stays blank when the track lacks
the sensor; an enabled slot without a reading shows an em dash. The heart-rate slot
is two-level — value on top, zone underneath — and all slots center their content,
so single-line slots stay vertically centered in the taller row (`#profile-readout`,
coarse-pointer devices; fine-pointer devices keep the floating fallback box capped
at half the screen width, rows breaking between readings, never inside one).
`positionHandles()` closes the pass (the handle DOM elements position from the same plot
rect).

Rules baked into this pass:

- Overlays scale over the **full track** (global y); zooming stretches only x.
- The speed family's axis strip ends at the speed series' **per-point maximum**
  (`overlayYRange` keeps the raw `hi`), so the top label always reads the same value the
  metrics list's Maximum Speed reports. Every other overlay keeps the padded top
  (`hi + pad`); bpm/rpm/speed scales never drop below zero.
- Zone bands and the hover dot map bpm → y through the **hr overlay's own lo/hi scale** and
  are clipped to it; they are drawn only while the hr series is shown with data. Never
  widen the axis for a zone; never invent a second mapping. The bands are
  additionally gated by the settings drawer's band toggle (`showZones`,
  `js/metrics/heartRateDisplay.js`); the crosshair's intersection dot is not — it belongs
  to the crosshair, not to the bands.
- While hovering — or while a touch probe is active — the band containing the inspected
  HR reading is tinted deeper — about 2× the resting alpha, still faint (`BAND_ALPHA` /
  `ACTIVE_BAND_ALPHA`). The active band is classified through the same reading path as the
  tooltip's zone label, so highlight and label always agree; nothing inspected, no
  highlight — and no highlight without the drawer's
  highlight toggle either (`js/metrics/heartRateDisplay.js`): it needs the band toggle on,
  and its stored choice survives while the bands are hidden. The bands draw inside uPlot's
  draw cycle, which a hover move alone does not reach — the renderer re-classifies the
  inspected zone on every render pass and bumps `zoneStamp` (in `chartKey`) when it
  changes, so crossing a band boundary costs exactly one chart redraw; the
  `hrzones:display` / `hrzones:changed` events bump the stamp outright (toggles and zone
  edits must repaint the bands too).
- Draw order matters: zone bands → overlay lines → elevation line → hover. The selection
  dimming is not a layer: it is each series' own stroke color stepping at the handles.
- Chart update granularity: view change → `setScale('x')` only; overlay toggle → `show`
  flags; track/x-mode → `setData` with the swapped caches; sector → a plain redraw
  (`chartKey` carries the span); zone toggle/edit or a hovered zone-band change → a plain
  redraw (`zoneStamp`); theme → per-draw color functions (a plain redraw);
  resize → `setSize` (never destroy/recreate). Hover frames touch only the annotation
  canvas — uPlot is not asked to redraw.
- A failed uPlot download surfaces a muted note inside `#profile-body`
  (`t('profileChartError')`) plus a console error; the loader resets its cached promise so
  the NEXT explicit render trigger retries — nothing retries in a loop, and nothing else
  in the app is affected.
- The annotation pass reads chart state without mutating it. Its output is determined by
  `state`, `sectorStore` and the current theme tokens (`getComputedStyle`), and its writes
  go to the annotation canvas plus the render-owned DOM (handles) and, via
  `showTooltipAt`, the tooltip. It is deterministic per frame, but not a pure function —
  it draws.

## Coordinate conversions

`distToX` / `xToDist` (data↔x domain, axis-mode aware), `clientXtoX` (cursor px → x
through the zoom window) and its draw-side inverse `xvToPx` (x → canvas px) live in
`profile-data.js` and are the **single source of truth**.
Every cursor path (hover, rubber-band drag, handle drag, touch-probe tap/drag, wheel zoom)
and every drawn element
must go through them, or handles drift off the cursor when zoomed. If you need a new
conversion, add it there as a pure function with explicit parameters.

## Recipes

### Add an overlay metric (e.g. a new sensor)

1. Add the definition to `OVERLAY_METRICS` (`id`, `colorToken`, `labelKey`, `axis`).
2. Give the track a `hasX` flag in the parser, wire it into `overlayAvailability`.
3. Add the per-point reader to `overlayValueAt` — the scale (via `overlayExtremes`) and
   the uPlot series data both derive from it; nothing else is needed.
4. Add `labelKey` to **all** language packs (`js/language/` — parity is test-enforced).
5. Slot cap: extend `maxOverlays()` in `profile-interaction.js` if the family should get a slot.

### Add a drawn layer

- uPlot-drawn series layers: add a series config in `buildSeriesConfigs` (draw order =
  array order) and its data array in `currentRefs`/`buildData`; the scale, if new, goes
  into the `scales` config plus the explicit `setScale` loop in `syncChart`.
- WaySlice business layers: draw on the annotation canvas (`drawAnnotation`), positioning
  through `xvToPx`/`pyOf` — never read pixel positions from the chart canvas.
- Colors come from CSS design tokens (`--series-*`, `--hr-zone-*`), snapshotted per
  render pass for theme switches.
- Insert at the correct z-order slot (chart hooks: zone bands beneath / reference line
  above; annotation pass: strip → pins → crosshair); update the layer list
  in this README.

### Add an interactive control

- Wire it in `profile-interaction.js` (header controls → `wireControls`, canvas gestures →
  `wirePointer`, sector handles → `wireHandles`).
- Mutate `state`, then call `scheduleSync()`. Interaction code **never draws** and never
  touches `ctx`.
- A **header** control also declares its responsive priority: register it in
  `movableControls()` and in every `LEVEL_ROW` entry that keeps it in the row (rule 9). Its
  business state must survive any level change.

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
   The renderer touches only its own DOM assets (canvas, handles); the one call it
   makes into another module's DOM is `drawHover → showTooltipAt` (tooltip).
3. Overlay family rule: speed/pace/GAP are one series with one slot. In
   `applyOverlayToggle` a sibling variant **replaces** the selected one even when all slots
   are full — the sibling check must come before the slot-cap check. `toggleOverlay`
   applies the returned `{selected}` to `state` and updates `lastSpeedVariant`.
4. Import depth: modules live one directory deeper than the old flat file — `menus.js` is
   `../../ui/menus.js`, stores are `../../core/…`, NOT `../…`.
5. Libraries only via the vendor directory: uPlot is the ONE vendored chart library
   (`vendor/uplot/`, version-pinned in its VENDOR-NOTE) and is loaded exclusively through
   `uplot-loader.js`'s cached promise — never import it statically, never fetch it from a
   CDN, never copy a second chart library in. No globals: ES modules only.
6. The chart renderer receives the FULL-RESOLUTION series — never reintroduce a
   per-pixel-column sampler (bucketing by canvas width, per-column min/max/mean) as a
   "uPlot adapter": the suite pins `sampleElevation`/`sampleOverlay` to `undefined`, and
   any new pixel-width-dependent data path is a regression, not an optimization.
   The sector selection is no exception: it lives in the STROKES (the series and the grid
   lines share one gradient over their cached paths), never in a data copy, a second draw
   pass or an overlaying mask.
7. Canvas caching: during development the browser may serve stale modules — the project
   has no build step and the dev server sends no explicit caching directives, so browsers
   can apply heuristic caching. Hard-reload via CDP `Page.reload {ignoreCache: true}`
   before doubting your changes.

8. Viewport gestures are shared, not forked: the pinch / pan / tap / double-tap machine lives in
   `js/charts/viewport-gestures.js` and is what the dual-variable chart runs as well. The profile
   supplies one x-axis adapter (domain, zoom floor, plot geometry, `state.view` accessors); the
   wheel zoom commits through `zoomStep` for exactly that reason. Never re-derive the window math
   (`zoomWindow` / `panWindow`) or its clamps locally — two copies would drift apart at the edges.

9. The header toolbar degrades by MEASUREMENT, never by a breakpoint or a language check:
   `refreshControlsFit` walks full → is-compact → is-overflow → is-emergency → is-minimum and keeps
   the first level whose row fits the pane's real width. `LEVEL_CLASSES` is the level list (the
   classes are cumulative, so the CSS layers) and `LEVEL_ROW` says which controls stay in the row
   per level; below the last level the row overflows and the parent layout owns the width. The row
   never wraps, shrinks a control below its hit area, truncates a label or overlaps buttons — do not
   add rules that do. Controls that leave the row move as the SAME node into the overflow panel
   (`#profile-overflow-panel`), so state, listeners and aria survive every level change; nothing is
   re-implemented for the panel. Priority order is the spec's: Distance/Time is the core axis control
   (leaves the row last), Fit to sector is the last ACTION to leave, and the identity title folds
   into its icon only at the emergency level.

## Testing

**Automated** — `tests/index.html` (serve the repo root, e.g. `python -m http.server`).
The suite imports this module's pure data layer directly (`tests/suite-profileData.js` over
`profile-data.js` — caches, scale ranges, conversions, plus the sampling-removal pin and
the uPlot loader's promise-caching rule); the chart/annotation parts are outside the suite.
It is also the regression net for the shared math (`metrics/`, `geo/`) and for
`tests/suite-viewport.js` (the shared zoom/pan window math + the double-tap rule). Expected: all green.

**Manual** — load a real-world GPX track with a full sensor set (elevation, timestamps, heart rate, cadence), then
replay at least:

- overlays menu: HR on/off → zone bands appear/disappear; speed → pace → GAP replace each
  other; cadence blocked when all slots are taken
- hover: crosshair, elevation dot, HR intersection dot, tooltip readouts (HR carries its
  zone label only while the drawer's zone-band toggle is on, highlighted in its zone
  color while the highlight toggle is also on)
- touch probe (mobile / touch): tap the chart → cursor line + the fixed telemetry band
  between the profile header and the chart — a 2×4 grid of permanent slots: [position] [elevation] [grade] [speed/pace]
  [heart rate] / [cadence] [temperature] [power]. Every slot is independently
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
- header levels: drag the window narrow and watch the toolbar step full → compact → overflow →
  emergency (and back) — one line at every width, the action labels turn into icons, then the
  lower-priority controls move into the "More" panel and keep working from there (toggles,
  overlays menu, axis mode, fit), with a tooltip and an accessible name on every icon-only button.
  Repeat in French / Spanish / German: no second line, no truncated label
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
