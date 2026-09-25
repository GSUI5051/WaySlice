/**
 * Global mount for the vendored MapLibre GL JS ESM build.
 *
 * MapLibre 6 ships an ES-module distribution only (no UMD file), so this
 * adapter exposes the module namespace as the `maplibregl` global — the same
 * integration surface the Leaflet UMD script used to provide. js/main.js's
 * boot check (typeof maplibregl) relies on it; module scripts execute in
 * document order, so this file's script tag sits before js/main.js.
 */
import * as maplibregl from './maplibre-gl.mjs';
window.maplibregl = maplibregl;
