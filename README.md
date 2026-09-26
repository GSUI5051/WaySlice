<p align="center">
  <img src="./icons/android-chrome-512x512.png" alt="WaySlice">
</p>

<h1 align="center">WaySlice</h1>

<p align="center">
  <strong>Telemetry for every way. Sliced.</strong>
</p>

<p align="center">
  English | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a><br><a href="README.fr.md">Français</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.it.md">Italiano</a>
</p>

WaySlice is an open-source, pure-frontend analyzer for GPX/FIT/TCX/KML/KMZ activity data. Whole-track
statistics tell you little: what you want to know is how you did on the long climb, on the
technical descent, in the last 5 km of the race. WaySlice lets you slice out any sector and
analyze it on its own, the way you would read racing telemetry or aviation QAR
(flight-data recorder) data:

```text
Track → Select Sector → Analyze Sector
```

<p align="center"><img src="./screenshots/overview.jpg" alt="image"></p>

<p align="center"><a href="./screenshots/README.md">More screenshots</a></p>

New to the terms? Start with the [Terminology](#terminology) section — every other section uses
those words exactly as defined there.

## Table of contents

- [Terminology](#terminology)
- [Features](#features)
- [Supported formats](#supported-formats)
- [Getting started](#getting-started)
  - [How to analyze a sector](#how-to-analyze-a-sector)
- [Privacy](#privacy)
- [Unit systems](#unit-systems)
- [Design notes](#design-notes)
- [Tests](#tests)
- [Contributing](#contributing)
  - [Project structure](#project-structure)
  - [Adding a UI language](#adding-a-ui-language)
  - [Adding or editing basemaps](#adding-or-editing-basemaps)
  - [Replacing the site icons](#replacing-the-site-icons)
  - [Adding a translated README](#adding-a-translated-readme)
- [Improvements](#improvements)
- [License](#license)
- [Special Thanks](#special-thanks)
- [Supporters](#supporters)

## Terminology

These terms have fixed meanings in this README and in the app UI. When a word appears with a
capital letter, it means exactly this:

| Term | Meaning |
|------|---------|
| Track | One recorded route, loaded from a single file: an ordered list of track points. |
| Track point | A single measurement along the track: position, plus elevation, timestamp, heart rate, cadence, power and temperature where the file provides them. |
| **Sector** | The core concept of WaySlice. A sector is the part of a track between a start point and an end point that you choose. Boundaries can sit anywhere between two track points (interpolated). The whole track is a sector too: the default "Entire track". Every metric is computed for the current sector. |
| Sector handle | The draggable dot that sets one sector boundary: green = start, red = end. Handles appear on both the map and the elevation profile and stay in sync. |
| Elevation gain / loss | Total ascent / descent inside the sector, after the 3 m noise filter (see [Design notes](#design-notes)). |
| VAM / VDM | Vertical Ascent / Descent Meters per hour: ascent / descent speed in m/h, computed only from the time spent actually climbing / descending. |
| Moving time | Elapsed time minus pauses: a pause is speed below 0.5 km/h sustained for 10 s or more. |
| GAP | Grade-adjusted pace: the sector pace divided by the Minetti (2002) slope factor — the flat-ground pace at the same effort. |
| Effort distance | Horizontal distance + elevation gain ÷ 100: each 100 m of climbing counts as 1 km. |
| 3D distance | Distance that follows the terrain: the segment-wise sum of √(horizontal² + vertical²), reported separately from horizontal distance. |
| Grade | Steepness at a point or over a stretch: vertical change ÷ horizontal distance, shown in % (positive = uphill, negative = downhill). |
| Pace | Time per unit of distance: min/km or min/mi. |
| Waypoint | A named place stored in the track file itself (GPX `<wpt>`, KML `<Point>` placemarks). |
| Basemap | The map tile source drawn underneath your track. Defaults to OpenStreetMap. |

## Features

- **Map + elevation profile.** Drag the sector handles on either surface. Both stay in sync in
  real time, and a boundary can sit anywhere between two track points, interpolation included.
- **Waypoints on map and profile.** GPX (`<wpt>`) and KML (`<Point>`) waypoints render as pins
  with name tooltips — toggle them with the pin button below "zoom to track". Hovering a pin
  marks the matching spot on the elevation profile, and clicking one centers the map on it without
  changing the zoom level.
- **Profile wheel zoom (desktop), pinch zoom (touch).** Hover the elevation profile and scroll to zoom its
  distance/time axis around the cursor; Shift-drag to pan; on touch, one finger pans and a two-finger
  pinch zooms the same way.
  Double-click anywhere on the profile — or double-tap on touch — restores the full track.
- **Auto sector.** The scissors button in the header builds a sector list for the whole track: split
  at waypoints (CP to CP), by fixed distance (1 km / 5 km / custom — miles when Imperial is
  active), or by grade into climb/descent stretches. Each row reads number, range, type capsule (climb, descent, flat or mixed, from its
  relief), then time, pace and heart rate; on narrow screens the row splits in two, the capsule
  gains its text label and the stats line up with the range's start. Expanding a row reveals that sector's details — 3D distance, effort distance,
  gain/loss, GAP, VAM/VDM — and moves the main sector onto it.
- **Sector metrics.** Horizontal and 3D distance, effort distance, elevation gain/loss, grades,
  elapsed and moving time, pace, speed, GAP, plus heart rate, cadence, power and temperature
  when the file carries them. When input data is missing you get *Unavailable*, not 0.
- **Dual-variable analysis.** The scatter icon beside the profile controls opens a 2D density
  heatmap of any valid pair of quantities — heart rate, speed, pace, GAP, cadence, power,
  temperature, grade, elevation. The analysis follows the currently selected sector, and every
  quantity's values come from the metrics panel's own mechanism: heart rate, cadence and power
  drop paused readings and get the panel's 5-point smoothing, temperature stays raw (paused
  readings included), grade uses the panel's 50 m gradient windows, and the speed family is the
  panel's Maximum Speed series for the sector. Hovering reads the cell's X, Y and relative
  density. Themes, units and languages apply live, and a dedicated chart module keeps even
  100k-point tracks fast and smooth. On touch, two fingers zoom and pan the chart, one finger scrubs the reading, and a double-tap
  brings the full range back.
- **Export.** Download the current sector — its metrics as csv, txt or md, its track points as a GPX
  file. Exports follow the language and unit system active when you click.
- **Metric / Imperial units.** Switch display units at any time. Metric is the default, and your
  choice is stored locally.
- **Multilingual.** English, Français, 日本語, 한국어, Deutsch, Español and Italiano are
  built in. Each additional language is a single data file (see [Contributing](#contributing)).
- **Privacy by architecture.** There is no upload code. Your file is read with the File API, then
  parsed, analyzed and rendered in your browser.
- **No build step.** Plain ES modules. Read them, run them, change them.

## Supported formats

| Format | Geometry | Elevation | Timestamps |
|--------|----------|-----------|------------|
| `.gpx` | `<trk><trkseg><trkpt>` (multi-segment) | ✅ | ✅ |
| `.fit` | Garmin FIT binary activity files | ✅ | ✅ |
| `.tcx` | TrainingCenterDatabase XML | ✅ | ✅ |
| `.kml` | `LineString` + `gx:Track` | ✅ (from coordinates) | ✅ (`gx:Track` / `<when>`) |
| `.kmz` | ZIP → KML (native `DecompressionStream`, no library) | ✅ | ✅ |

FIT decoding is done by the vendored [fit-parser](https://github.com/jimmykane/fit-parser) library
(MIT) in `vendor/fit-parser/`; TCX is read by a built-in DOM parser. GPX sensor extensions are read
namespace-agnostically: Garmin TrackPointExtension (heart rate, cadence, temperature, speed,
distance) and the three common power flavors (bare `<power>`, `PowerInWatts`, `ns3:Watts`). Every
format funnels into the same track-point model, so sector metrics work identically regardless of
the source format.

## Getting started

**Try it: https://wayslice.com**

Any static file server works. There is nothing to build:

```bash
# Python
python -m http.server 8080

# or Node
npx serve .
```

Then open <http://localhost:8080> and drop a GPX/FIT/TCX/KML/KMZ file.

> Opening `index.html` directly via `file://` will not work because browsers block ES-module
> imports on `file://` URLs.

### How to analyze a sector

1. Import your track. The whole track is selected by default.
2. **Drag the green/red sector handles** on the map or the elevation profile. You can also click the
   track or profile to move the nearest boundary, or drag on the profile to select a new range. On
   touch, one finger pans the zoomed profile and a pinch zooms — sector changes are made with the handles.
3. Every change re-computes the sector instantly: distance, 3D distance, gain/loss, grades,
   pace/speed, fastest/slowest kilometer.
4. Keyboard: focus a handle and use the arrow keys (Shift = ×10, Home/End = jump). `Esc` closes
   menus.
5. Touch devices use cooperative gestures: one finger scrolls the page, two fingers pan and zoom
   the map (a hint appears on the map).
6. Ready-made sectors: the `Auto sector` button in the header builds a sector list for the whole
   track — by waypoint, fixed distance or grade.

## Privacy

- Your track is processed **only** in your browser: parse → analyze → render, all local.
- The only network requests are **map tiles** from the basemap you choose. Your track data is
  never transmitted, and there is no analytics.
- Theme, language, basemap and unit choices are stored in `localStorage` on your device only.

## Unit systems

WaySlice defaults to **Metric** and also supports **Imperial**. Open the `Settings` drawer from
the gear button in the header — units live next to language and theme:

| Display | Metric | Imperial |
|---|---|---|
| Long distance | km | mi |
| Short distance / elevation | m | ft |
| Speed | km/h | mph |
| Pace | min/km | min/mi |
| Gradient | % | % |

All parsing and calculations stay in SI units (meters, meters/second, seconds/kilometer).
Switching units only re-formats the numbers you see: the file is not re-parsed, the sector is not
recalculated, and the track geometry does not change. The preference is stored as
`wayslice-units` and survives reloads. Language and units are independent settings, so any
language works with either system.

## Design notes

- **3D distance** is computed segment-wise as `√(horizontal² + vertical²)` and reported
  separately from horizontal distance.
- **Effort distance** = horizontal distance + elevation gain ÷ 100 (100 m of climbing counts
  as 1 km).
- **Average grade** is the sector's accumulated ascent divided by horizontal distance, not the mean of
  per-point grades; a sector that only descends has no ascent to average and shows the unavailable
  marker (—). Max/min grades use ~50 m windows so GPS noise cannot fake a record slope.
- **Elevation gain/loss** apply a 3 m threshold filter: elevation change accumulates until it passes
  ±3 m and only then counts, so sub-3 m noise never inflates the totals.
- **VAM/VDM** divide gain/loss by the time actually spent climbing/descending (the filtered
  elevation trend), not by the whole sector time.
- **Moving time** counts segments outside pauses (speed below 0.5 km/h sustained for 10 s or more).
- **Average speed and average pace** are computed from per-segment moving speeds and cleaned like the
  profile curve: with recorded speeds a 5-point sliding window dilutes the spike into its neighborhood;
  without recorded speeds only the 3σ rule applies. **Maximum speed** reads the profile's cleaned
  per-point curve, so the list always matches the chart.
- **Average GAP** divides each segment pace by the Minetti (2002) slope factor (clamped to ±45 % grade) before
  averaging: the flat-ground pace at the same effort. In the profile, speed/pace/GAP share one overlay slot.
- **Profile speed plots** clean spikes by source: tracks with recorded speeds first cross-check every reading
  against the concurrent dd/dt (readings more than 50 % above it are dropped), then smooth the rest with a
  5-point sliding window (each value = the mean of up to five points centered on it); tracks without recorded
  speeds derive speeds from position deltas and apply the 3σ rule directly. Rest-stop zeros are data and take
  part in the window mean like any other value.
- **Display simplification** (Douglas–Peucker for the map, per-pixel min–max sampling for the
  profile) never touches the original points. Metrics always run on the full data.
- **Profile zoom** works down to a 1 km window in distance mode and 20 minutes in time mode; touch
  devices zoom with a two-finger pinch — there is no wheel.
- Large tracks (100k+ points) work fine. While you drag a handle, the boundary lookup starts from
  the previous match and expands its search window as needed.

## Tests

Open `tests/index.html` on the same server:

```text
http://localhost:8080/tests/
```

The suite covers distance math, interpolation between points, gradient windows, time metrics,
GPX/FIT/TCX/KML/KMZ parsing (including malformed files and archives, plus the GPX power and
sensor-extension flavors), the theme preference matrix
(system/manual × OS light/dark), the language fallback chain, and Metric/Imperial conversions
(including pace rounding, VAM, persistence and unit-independent gradients), plus the sector
export (csv/txt/md/gpx content and file names).

## Contributing

### Project structure

```text
index.html              shell + theme boot script (no flash of wrong theme)
icons/                  site icon assets (favicon.svg + PNG/ICO sizes, preview page)
site.webmanifest        PWA install metadata (name, theme colors, icons)
css/                    design tokens (light/dark), base, layout, components
js/
  parsers/              GPX / FIT / TCX / KML / KMZ → one unified track-point array
  geo/                  haversine + 3D distance, interpolation, simplification
  metrics/              sector metrics (pure functions, independently testable)
  sector/               sector selection state (single source of truth)
  map/                  MapLibre view, basemap catalog, sector handles
  charts/               canvas charts (elevation profile, dual-variable analysis)
  theme/                system / light / dark with live OS sync
  language/             language core + lang-*.js packs + template
  units/                Metric / Imperial preference, SI display conversions, localized unit labels
  ui/                   metrics panel, settings drawer, auto split, menus, sheets, upload, icons
  core/                 tiny event bus + stores
  utils/                locale-aware formatting (Intl)
tests/                  browser-runnable test suite (tests/index.html)
vendor/fit-parser/      vendored fit-parser toolkit (FIT decode, MIT) + buffer shim
```

Calculation logic lives apart from the UI: `computeSectorMetrics()` and the other metric
functions never touch the DOM, and the test suite covers them.

### Adding a UI language

The translation system has no framework behind it: **a language is one data file**. If you can
edit a JavaScript file, you can translate the app.

1. Copy [`js/language/lang-template.js`](js/language/lang-template.js) to `lang-xx.js`
   (`xx` = a BCP 47 code such as `es`, `pt-BR`).
2. Translate the values on the right side. Keep the keys and `{placeholders}` as they are, and
   keep technical terms consistent (Sector, 3D Distance, Elevation Gain/Loss, Grade, Pace, VAM).
3. Add one entry to the catalog in [`js/language/langs.js`](js/language/langs.js) — language
   code, native name and a lazy loader. Packs load on demand: at boot only the visitor's
   language plus English are fetched.
4. Open the app, switch to your language, and check the console. WaySlice validates the loaded
   packs against the English keys and warns about missing or unknown ones.
5. Submit a pull request.

Missing keys fall back to English (and then to the key itself), so the UI never shows
`undefined`. Language, theme and basemap choices survive reloads in `localStorage`.

### Adding or editing basemaps

The basemap catalog lives in one file: [`js/map/sources.js`](js/map/sources.js). The map menu,
the settings sheet, persistence and tile-layer creation all read from it — adding or editing a
source needs no UI code.

**Add a source** — append an object to `MAP_SOURCES`:

```js
{
  id: 'esri-topo',           // unique; doubles as the persistence key
  labelKey: 'srcEsriTopo',   // translation key of the display name
  group: 'outdoor',          // street | outdoor | satellite | minimal
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
  maxZoom: 19,
  attribution: 'Tiles &copy; Esri',
},
```

| Field | Meaning |
|---|---|
| `id` | Unique id and the persistence key. Changing it acts as a new source (saved selections fall back to the default); removing an entry also falls back safely. |
| `labelKey` | i18n key of the display name. |
| `group` | One of `street`, `outdoor`, `satellite`, `minimal`. |
| `url` | Tile template: `{z}` `{x}` `{y}`, optional `{s}` (needs `subdomains`) and `{r}` (retina). Mind the provider's coordinate order — Esri uses `{z}/{y}/{x}`. |
| `overlayUrl` | Optional transparent label overlay drawn above the base tiles. |
| `maxZoom` | Highest zoom the provider serves. |
| `attribution` | Legally required by OSM, OpenTopoMap, Thunderforest, Mapy, Stadia Maps, OpenFreeMap and Esri — keep it. |
| `subdomains`, `crossOrigin`, `hintKey` | Optional: subdomain rotation; `crossOrigin: false` for tile servers that send no CORS headers; grey hint line in the selector. |

Then add the display name to **every** language pack — `srcEsriTopo: 'Esri Topo',` in
`lang-en.js`, `lang-fr.js`, `lang-ko.js`, `lang-ja.js`, `lang-de.js`,
`lang-es.js`, `lang-it.js` and `lang-template.js`. The
language-completeness test stays red until all packs have the key; that is on purpose.

**Edit a source** by changing `url`, `maxZoom`, names or attribution in place. For a **new
group**, add it to the `GROUP_ORDER` array, use it on your sources, and add a `group<Name>` key
(e.g. `groupTopo`). Services that need an API key (Maptiler, Mapbox) work with the key baked
into `url`, but do not commit your own key. Prefer HTTPS tiles: on HTTPS-hosted pages browsers
block plain-HTTP tiles or force them through HTTPS. To verify: refresh, open the
`Map` menu, and check tiles, max zoom and attribution.

### Replacing the site icons

All site icons derive from one source file, `icons/favicon.svg` — a 1024×1024 rounded tile
with two orange mountain ridges on a dark gradient, a white GPX track line, and green/red
dots matching the in-app sector handles. From it, regenerate `favicon.ico`, the 16–512 px
PNG sizes, `apple-touch-icon.png`, the Android Chrome icons and `site.webmanifest`.
Search engines have requirements of their own (Google needs a 48 px+ PNG, the manifest, and
crawlable robots.txt — hence the `robots.txt` in the repo root). `icons/icon-preview.html` shows
every size locally. Inside the app, the header and empty state reuse the `icons/favicon.svg`
brand mark; the functional icons come from the Lucide icon library (ISC license) and are
collected in `js/ui/icons.js`. The header's GitHub link is the one exception: it loads the
GitHub logo files in `icons/` as images (trademarks of GitHub, Inc., used only to link to
this repository).

To swap in your own mark, edit `icons/favicon.svg`, regenerate the other sizes from it, and keep
the links in `index.html` and `site.webmanifest` in sync.

### Adding a translated README

The existing translations ([日本語](README.ja.md), [한국어](README.ko.md), [Français](README.fr.md), [Deutsch](README.de.md),
[Español](README.es.md), [Italiano](README.it.md)) are your examples. To add one:

1. Copy this `README.md` (or any existing translation) to `README.xx.md`
   (`xx` = a BCP 47 code, e.g. `README.es.md`).
2. Translate the prose. Keep the structure, section order, tables, code blocks and file paths
   unchanged, so all versions stay easy to compare and maintain.
3. Update the language switcher line under the title in **every** README: add your language as a
   link elsewhere, and keep the format `A | B | C | D`. In your own version, your language is the
   plain-text entry.
4. Submit a pull request.

## Improvements

- Better spike-cleaning algorithm when considering GPS drift and sparse-sampling. 
- Better slope-detection algorithm for auto sector. (climb/descend/flat/mixed)
- Optional elevation enhancement from external DEM services (opt-in only — the default stays
  fully local)

## License

Released under the [MIT License](LICENSE). Free for commercial and private use — please keep
the map providers' attributions intact:

- [MapLibre GL JS](https://maplibre.org) (BSD-3-Clause)
- © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL)
- [OpenTopoMap](https://opentopomap.org) (CC-BY-SA), [CyclOSM](https://github.com/cyclosm/cyclosm-cartocss-style)
- [Thunderforest](https://www.thunderforest.com), [Mapy.com](https://mapy.com), [Stadia Maps](https://stadiamaps.com), [OpenFreeMap](https://openfreemap.org), [Esri World Imagery](https://www.esri.com) basemaps
- Icons by [Lucide](https://lucide.dev) (ISC)

## Special Thanks

- The project is loosely inspired by the [GPS data analysis](https://trailrunningmovement.com/training/gps-data-analysis/) article from [Trail Running Movement](https://trailrunningmovement.com/).

Thanks to everyone who contributed their GPX, TCX, FIT
and other data used in development and testing of WaySlice.

- [Ken Zemach](https://fastestknowntime.com/athlete/ken-zemach) for his Bruksleden 100 Miler (Sweden) [GPX track](https://fastestknowntime.com/fkt/ken-zemach-bruksleden-100-miler-sweden-2020-08-02).
- [polyvertex](https://github.com/polyvertex) for his [FIT files](https://github.com/polyvertex/fitdecode/tree/master/tests/files).
- [ToolElewaut](https://github.com/ToonElewaut) for Tour de France 2020 - 2023 [TCX files](https://github.com/ToonElewaut/TDF/tree/main/src/Data/Routes).
- [tingard](https://github.com/tingard) for his [TCX files](https://github.com/tingard/cycling_power_analysis)
- [pherris](https://github.com/pherris) for his long distance riding [TCX file](https://github.com/pherris/IOT-Value-Cycling/tree/master/rides) with power.
- [Tommi](https://www.youtube.com/@bewarethemountainman) for his Kai Kung Leng - Tai To Yan - Tai Mo Shan hiking [GPX track](https://drive.google.com/file/d/1lPVebrcOImAw035d9r0tqP63O-2yZe4E/view) in Hong Kong.

## Supporters

Thanks to everyone who helps keep WaySlice maintained and running.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/I8U4273MZK)

### Ko-fi
