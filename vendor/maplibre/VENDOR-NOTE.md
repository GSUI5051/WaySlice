# Vendored: MapLibre GL JS

- Library: MapLibre GL JS, **version 6.11.2** (pinned single version)
- Source: official npm release package `maplibre-gl@6.11.2`
  (`https://registry.npmjs.org/maplibre-gl/-/maplibre-gl-6.11.2.tgz`),
  files copied unmodified from its `dist/` directory
- License: **BSD-3-Clause** — copyright MapLibre contributors; the license
  text ships in the npm package and is published at
  <https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt>.
  Project homepage: <https://maplibre.org>

## Files

| File | Role |
| --- | --- |
| `maplibre-gl.mjs` | ES-module entry (minified release build) |
| `maplibre-gl-shared.mjs` | shared chunk imported by the entry |
| `maplibre-gl-worker.mjs` | WebWorker chunk spawned by the entry at runtime (resolved relative to `import.meta.url`, so all three must stay side by side) |
| `maplibre-gl.css` | required stylesheet for controls/markers |
| `maplibre-global.mjs` | two-line project adapter (NOT part of the upstream package): mounts the ES-module namespace as the `window.maplibregl` global so the rest of the app can keep a library-loaded check |

Upstream ships no UMD/single-file build since the v6 major (ESM only), which
is why the global mount is a tiny shim next to the unmodified dist files.
Serving note: the `.mjs` files must be delivered as JavaScript
(`text/javascript`); any static file server with a normal MIME table works.
