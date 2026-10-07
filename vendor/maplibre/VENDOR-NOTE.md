# Vendored: MapLibre GL JS

- Library: MapLibre GL JS, **version 6.13.0** (pinned single version)
- Source: official npm release package `maplibre-gl@6.13.0`
  (`https://registry.npmjs.org/maplibre-gl/-/maplibre-gl-6.13.0.tgz`)
- License: **BSD-3-Clause** — copyright MapLibre contributors; the license
  text ships in the npm package and is published at
  <https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt>.
  Project homepage: <https://maplibre.org>

## Files

| File | Role |
| --- | --- |
| `maplibre-gl.mjs` | ES-module entry (minified release build); since 6.13 self-contained — the former `maplibre-gl-shared.mjs` chunk is folded in (upstream ships that name as an empty stub, not vendored here) |
| `maplibre-gl-worker.mjs` | WebWorker chunk spawned by the entry at runtime (resolved relative to `import.meta.url`); since 6.13 also self-contained, so the two files just have to stay side by side |
| `maplibre-gl.css` | required stylesheet for controls/markers — **local modification**: the upstream file is wrapped in `@layer maplibre { … }` (see the comment at the top of the file); re-vendoring a newer MapLibre must re-apply this wrap |
| `maplibre-global.mjs` | two-line project adapter (NOT part of the upstream package): mounts the ES-module namespace as the `window.maplibregl` global so the rest of the app can keep a library-loaded check |

The `.js` files are copied unmodified from the npm package's `dist/`
directory; the css is the only locally modified file. Upstream ships no
UMD/single-file build since the v6 major (ESM only), which is why the global
mount is a tiny shim next to the dist files.

Serving note: the `.mjs` files must be delivered as JavaScript
(`text/javascript`); any static file server with a normal MIME table works.
