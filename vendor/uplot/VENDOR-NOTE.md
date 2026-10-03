# Vendored: uPlot

- Library: uPlot, **version 1.6.32** (pinned single version)
- Source: official npm release package `uplot@1.6.32`
  (`https://registry.npmjs.org/uplot/-/uplot-1.6.32.tgz`),
  files copied unmodified from its `dist/` directory
- License: **MIT** — copyright (c) 2019-2026 Leon Sorokin (leeoniya); the
  license text ships in the npm package and is vendored next to this note.
  Project homepage: <https://github.com/leeoniya/uPlot>

## Files

| File | Role |
| --- | --- |
| `uPlot.esm.js` | ES-module entry (upstream's unminified ESM build — the package ships no minified ESM variant) |
| `uPlot.min.css` | vendor stylesheet for uPlot's own DOM chrome (cursor lines, legend). WaySlice disables most of that chrome and only relies on the cursor-line rules it keeps |
| `uPlot.d.ts` | upstream TypeScript definitions, kept for reference only (not imported) |

## Loading

Never imported statically. `js/charts/elevation-profile/uplot-loader.js`
dynamic-imports the ESM entry the first time the elevation profile actually
renders a track and caches the promise (reset on failure so a later attempt
can retry). The stylesheet link is injected alongside it, before the app's
own stylesheets (same insertion rule as the MapLibre vendor CSS).

Serving note: the `.js` file must be delivered as JavaScript
(`text/javascript`); any static file server with a normal MIME table works.
