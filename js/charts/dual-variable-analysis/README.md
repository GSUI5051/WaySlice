# Dual-Variable Analysis — Maintenance Guide

English | [日本語](README.ja.md) | [한국어](README.ko.md)

> **This document is machine-generated and may contain errors or differences in technical terminology.**
> **The English version is the canonical source.**
> **If you find an error, please submit a PR or refer to the English version.**

How to maintain the dual-variable analysis dialog: what each module owns, where new
code belongs, which rules keep the architecture sound, and how changes are verified.

## What this directory is

The dual-variable analysis is the 2D density heatmap opened from the profile controls row
(`#btn-dual-variable`; like the Overlays button it reads as labeled text on wide screens and
collapses to the `chart-scatter` icon below 720 px): pick an X quantity and a Y quantity, and the
selected sector's samples bin into a 2D grid whose cell colors encode local point density
(relative to the busiest bin). Every quantity's values are the metrics panel's own series for it
(see The data rules) — the chart can never be more, or less, honest than the panel. It shares the
elevation profile's visual language but is a separate chart system — the spec (§22) asked for its
own module directory, and it must never grow imports into the elevation profile beyond the shared
speed pipeline.

The **public API is one function** and nothing else:

```js
import { initDualVariableAnalysis } from './charts/dual-variable-analysis/index.js';
initDualVariableAnalysis({
  button: document.getElementById('btn-dual-variable'),
  dialog: document.getElementById('dual-variable-dialog'),
}); // main.js, boot
```

DOM contract: `#btn-dual-variable` in `.profile-controls`; `#dual-variable-dialog` (class
`sheet dualvar`) with `#dualvar-close`, `#dualvar-body` (the tooltip's safe area),
`#dualvar-select-view` (`#dualvar-x`, `#dualvar-y`,
`#dualvar-select-note`, `#dualvar-analyze`) and `#dualvar-result-view` (`#dualvar-summary`,
`#dualvar-reselect`, `#dualvar-chart` > `#dualvar-canvas`, `#dualvar-empty`, `#dualvar-loading`).
Never rename these ids.

## Module map

| File | Responsibility | Exports |
|---|---|---|
| `index.js` | Orchestrator: button + dialog wiring, the selecting → analyzing → displaying/empty state machine, dynamic select constraints, event surface (language / units / theme / track store / sector store) | `initDualVariableAnalysis` |
| `metrics.js` | Pure metric registry: ids, label keys, unit getters, shared formatters, display↔raw tick conversion, the valid-pair table | `METRICS`, `getMetric`, `isPairAllowed`, `partnersOf` |
| `samples.js` | Pure data layer: the ONE sample table per track, every quantity produced by the metrics panel's mechanism for it (see The data rules), availability, finite-pair extraction | `buildAnalysisSamples`, `metricAvailability`, `extractPair` |
| `densityCalculator.js` | Pure density math: robust quantile domain, fixed-grid 2D binning, relative-density normalization | `computeDensity`, `relativeDensity` (+ constants `X_BINS`, `Y_BINS`, `MIN_PAIR_SAMPLES`, `DOMAIN_QUANTILE`, `DOMAIN_PAD`) |
| `densityRenderer.js` | All canvas drawing: plot + tick grid + stretched density bitmap + hover highlight + axis titles; the themed color LUT; hit-testing geometry; the visible window per axis (the zoom/pan viewport) | `initRenderer`, `setData`, `clearData`, `refresh`, `resize`, `render`, `hitTest`, `setHover`, `viewportAxes`, `getViewport`, `isViewportZoomed`, `resetViewport` |
| `interaction.js` | The unified Pointer Events path (hover, touch tap/hold, pinned touch tooltip) + the SHARED touch viewport gestures in their 'two-finger' pan mode (one finger reads, two fingers pinch AND pan, double-tap resets — `../viewport-gestures.js`); never draws | `wireInteraction`, `clearInteraction` |
| `tooltip.js` | The tooltip DOM node, its three rows (X / Y / relative density), and the touch/mouse placement ladder (pure `computeTooltipPlacement`) | `initTooltip`, `computeTooltipPlacement`, `showTooltipAt`, `hideTooltip` |

Dependency graph (arrows = imports; keep acyclic):

```text
index        → metrics, samples, densityCalculator, densityRenderer, interaction, tooltip
interaction  → densityRenderer (hitTest, setHover, viewport), tooltip, ../viewport-gestures
densityRenderer → language (axis titles)
tooltip      → language, format
metrics      → units, format
samples      → elevation-profile/profile-data (speedToPace), geo/interpolate (pointAtDistance), sectorMetrics (createPauseTracker, cleanSpeedSeries, cleanComputedSpeeds, recordedSpeedImplausible, trackHasRecordedSpeed, minettiFactor, GRADIENT_WINDOW_M, GRADIENT_MIN_WINDOW_M)
densityCalculator → nothing in this directory
```

`metrics.js`, `samples.js` and `densityCalculator.js` are the testable bottom: no DOM, no dialog.
`samples.js` is the ONLY place allowed to import from the elevation profile (the shared speed
pipeline); the renderer and interaction layers must not.

## The data rules (do not loosen casually)

Every quantity's point values come from the METRICS PANEL's own series for that quantity
(`computeSectorMetrics` over the SELECTED SECTOR — the panel's own scope; boundaries may sit
between two track points and are interpolated exactly like the metrics). The chart can never be
more, or less, honest than the panel: a plotted value can never
disagree with — or exceed — the panel's statistics for the same quantity, because it IS the
series those statistics run over. Per quantity:

1. **hr / cadence / power** — the panel's fitness series: finite readings, stripped of
   confirmed-pause timestamps (the `pauseFreeSamples` predicate — exclusive of the last moving
   instant, inclusive of the pause end; spans from the shared `createPauseTracker`, never a
   module-local detector), then smoothed by the shared 5-point sliding window (`cleanSpeedSeries`
   over the compact survivor list — the exact array behind `avgHr/maxHr`, `avgCad/maxCad`,
   `avgPower/maxPower`). Stripped or missing readings stay NaN.
2. **temp** — raw readings, unfiltered and pause-inclusive, exactly like the panel's `rawStats`
   (an ambient reading is not an effort signal).
3. **speed / pace / GAP** — the panel's Maximum Speed series for the sector, built
   RANGE-LOCALLY over the sector's points (a line-for-line mirror of `maxCleanedPointSpeed`:
   recorded → dd/dt cross-check → 5-point window; computed → 3σ; rule selection still the
   GLOBAL trackHasRecordedSpeed predicate, like the profile's `buildCaches`). The smoothing
   window is range-local, so a sub-sector's fastest plotted speed equals the panel's Maximum
   Speed for that range — near a sector edge it can differ (slightly) from the profile's
   whole-track speed curve. Pause points stay in (rest zeros included). GAP is that speed
   divided by the Minetti factor of its raw per-segment grade, as in the profile's GAP overlay.
4. **grade** — the panel's gradient windows over the sector (interpolated boundaries
   included): horizontal meters pile up to `GRADIENT_WINDOW_M` (50 m), the window's rise/run
   lands on its closing point, plus the ≥ 20 m trailing window.
   The finite values are exactly the set `maxGrade/minGrade` run over, so the chart's steepest
   grade IS the panel's Maximum Grade. Grade points are therefore sparse (about one per 50 m) —
   pairs against grade keep only the rows at window-closing points.
5. **ele** — raw point elevations, like `eleMin/eleMax`.
6. **Missing values** — a pair with a non-finite X or Y never bins (no zero-fill, no
   forward-fill, no interpolation).

The original spec's row-level pipeline (whole-row pause drops, and the invalid-power /
invalid-cadence exclusions of the first version's §10) was removed on 2026-09-17 by explicit request:
the panel applies no such rules — a 0 W coasting reading counts in its averages, and temperature
keeps its paused readings — so the chart must not drop them either. The spec's §10 (and §20's
outlier stance) were rewritten the same day to these rules. Exclusion now happens per
quantity exactly where the panel's mechanism excludes, and a point leaves an analysis only
through rule 6. The panel's own aggregate-only statistics (Average Speed / Average Pace from
per-segment dd/dt, average GAP from segment effort paces) have no per-point counterpart to
match here; the chart has no averages of its own.

The domain drawn is the 0.2 %–99.8 % quantile range plus ~4 % padding: rare sensor spikes
compress nothing (§21). Points outside the domain stay in the table; they only fall outside
the drawn grid. Fewer than `MIN_PAIR_SAMPLES` valid pairs → the empty state, never a blank
canvas (§19).

Density is `binCount / maxBinCount` (§14). The tooltip reports this LINEAR value; the bitmap
applies a visual-only sqrt gamma so mid densities stay visible — do not "fix" one to match
the other.

## Rendering conventions

- The density grid lives on a tiny offscreen bitmap (one pixel per bin) stretched with image
  smoothing — never per-point drawing, never per-bin DOM.
- Colors come from a 256-entry LUT sampled off a two-stop gradient of the theme tokens
  `--density-zero` / `--density-max` (tokens.css, one pair per theme). A theme switch is
  rebuild-LUT + redraw — the counts are not recomputed.
- Ticks are nice (1/2/5 × 10ᵏ) numbers in the metric's DISPLAY space (`metrics.js` owns
  toDisplay/fromDisplay), labeled through the shared formatters, so axes can never disagree
  with the rest of the UI. Axis titles are `t(labelKey) + unit` — a unit is never
  tooltip-only knowledge.
- **Pace-family axes read REVERSED on BOTH axes** (`reversed: true` on `pace`/`gap`): a
  smaller pace is a faster effort, so the fast end sits at the TOP of a vertical axis
  (5:00 /km above 15:00 /km) and at the RIGHT of a horizontal one. Every mapping — grid
  lines, tick labels, bitmap rows AND columns (`rebuildBitmap`), hover outline (`render`)
  and the hit-test (`hitTest`) — must go through the same flip decision; a new drawing path
  that maps an axis directly will silently disagree with the tooltip.
- **Desktop dialog height is FIXED to the shared `.sheet` cap** (`min(76vh, 720px)`,
  components.css, ≥721px only): the auto-split list and the dual-variable dialog are always
  exactly as tall, on every track — both would otherwise be content-sized and drift with the
  segment count. The chart fills the room under the summary row (flex, overriding its clamp
  height), and the chart's ResizeObserver re-renders on the resulting resize. The metrics
  details sheet (same `#sheet` element, no `.seg-list`) and all narrow-screen bottom sheets
  stay content-sized.
- The left margin grows to the widest y tick label; x tick labels that would clip at a canvas
  edge are dropped, not nudged off their gridline.

## Interaction contract

One Pointer Events path (§16): fine pointers hover; touch taps or holds and the reading stays
pinned where the finger lifted (reading never requires a double-tap). The PLOT AREA only resolves data
coordinates (`hitTest` is the single client→data conversion, so the highlight and the tooltip
can never disagree); the TOOLTIP's placement is a separate concern (`tooltip.js`
`computeTooltipPlacement`, pure + unit-tested). TOUCH uses the above-the-touch-point strategy
— directly above with an 8–12 px gap, horizontally aligned, with the ENTIRE SCREEN as its only
boundary (the box may leave the chart card and the dialog body; it clamps against the screen
top when the touch is very high) — never a below-flip, never a side search, the plot area's
edges play no part. MOUSE keeps the above → below → beside → clamp ladder with a 14 px gap
inside the dialog body (avoids the modal and the viewport; may read above, below, left or
right of the pointer). A container scroll or window resize
hides the box rather than letting it float stale.

The chart's **viewport** is driven by the shared gesture machine
(`js/charts/viewport-gestures.js`). Which gesture PANS is the host's choice (`panGesture`), and
this chart runs the `two-finger` mode: one finger only ever reads (the tooltip follows it across
the plot and never moves the window), while the two-finger gesture scales AND translates — a
two-finger drag that keeps its span is a pure pan. The elevation profile keeps `one-finger`,
because there a single finger is a viewport control and the sector has its own handles. Two taps in
quick succession restore the full data range. Each axis carries its own window in RAW units, `null`
meaning "the full domain", so the reset always fits the CURRENT data and a pace axis keeps its own
direction. The gestures move the window and nothing else: the X/Y picks, the sample table and the
density grid are untouched, and no re-binning happens at any zoom (the window is a sub-rect of the
same bitmap). A pan or a pinch drops the pinned reading instead of leaving it over a screen spot
that no longer means the same data; a finger that never travels is still a tap. The zoom floor is
5 % of each axis' domain.

## Events

`index.js` subscribes: `language:changed` (re-render the open view), `units:changed` (redraw
ticks), `theme:changed` (rebuild LUT + redraw), `trackStore` (invalidate the sample cache,
close the dialog, toggle the button) and `sectorStore` (invalidate the sample cache — the
analysis reads the SELECTED SECTOR, like the metrics panel; a new open/analyze rebuilds for
the new range). The dialog is modal — the sector cannot move while it is open — so a sector
change in practice arrives between sessions; do not remove these subscriptions.

## Verification

`tests/suite-dualVariable.js` covers the pair table, the per-quantity panel alignment (the
pause strip, the 5-point smoothing, coasting zeros kept, pause-inclusive temperature, the 50 m
grade windows), the sector scope (rows outside the selected sector are NaN; parity against
`computeSectorMetrics` for mid-track ranges with interpolated boundaries, including a sector
born inside a whole-track pause), the panel-parity invariants (the chart's max/avg/min over
each quantity's finite points equal the panel's figures exactly), NaN handling, availability,
pair extraction,
the density grid (robust domain, degenerate ranges, bin consistency) and the tooltip placement
ladder — 42 cases in seven suites. Run the whole suite
at `tests/index.html` on a local HTTP server; keep it green, and extend it for any new data
rule. The shared viewport gestures are covered separately: `tests/suite-viewport.js` pins the
window math (clamps, the per-axis direction conventions, anchor preservation, the double-tap
rule). The pointer paths themselves are a MANUAL check — on a coarse-pointer device or in device
emulation (touch gestures exist nowhere else): pinch and two-finger-drag to zoom and pan, swipe ONE
finger to scrub the reading, double-tap to restore the full range, and confirm a gesture that moves the window drops the pinned
reading instead of leaving it over a screen spot that no longer means the same data.
