/**
 * WaySlice — application entry point.
 * Boots theme + language, initializes map / profile / metrics / upload and
 * wires the header controls. All heavy lifting lives in dedicated modules.
 * MapLibre itself is NOT loaded here: it downloads on demand when a track
 * file starts parsing (see mapView.preloadMapLibre).
 */
import * as theme from './theme/theme.js';
import * as language from './language/language.js';
import * as units from './units/units.js';
import { initMap, setTrack as mapSetTrack, fitTrack, fitSector, showHover as mapShowHover, setWaypointsVisible } from './map/mapView.js';
import { initProfile, setProfileTrack } from './charts/elevation-profile/index.js';
import { initDualVariableAnalysis } from './charts/dual-variable-analysis/index.js';
import { initMetricsPanel } from './ui/metricsPanel.js';
import { initUpload } from './ui/upload.js';
import { initFileChip, setFileChipContent } from './ui/fileChip.js';
import { initExport } from './export/exporter.js';
import { initAutoSegments } from './ui/autoSegments.js';
import { initSheets, openDetailsSheet } from './ui/sheets.js';
import { initDrawer } from './ui/drawer.js';
import { initHeartZonesDialog } from './ui/heartZonesDialog.js';
import { initStoryDialog } from './ui/storyDialog.js';
import { createMenu } from './ui/menus.js';
import { buildMapSourceItems, pickMapSource } from './ui/optionLists.js';
import { applyStaticTranslations } from './ui/i18n.js';
import { icon } from './ui/icons.js';
import { trackStore } from './core/stores.js';
import { setTrackTotal } from './sector/sectorStore.js';
import { on } from './core/events.js';
import { t } from './language/language.js';
import { formatDistance, formatInt } from './utils/format.js';

boot();

async function boot() {
  theme.init();
  // The boot language pack loads on demand (English fallback + the user's
  // language) — everything below renders text, so it waits for the dict.
  await language.init();
  units.initUnits();

  initMap(document.getElementById('map'));
  // The library downloads on demand (first track file); a failure surfaces
  // here with the same total-failure page the old boot-time check produced.
  on('maplibre:error', () => {
    document.body.innerHTML =
      '<p style="padding:2rem;font-family:system-ui">MapLibre failed to load. Serve the app over HTTP (see README).</p>';
  });
  initProfile(document.getElementById('profile-body'));
  initSheets(document.getElementById('sheet'));
  wireDetailsSheet();
  initMetricsPanel(
    document.getElementById('metrics-root'),
    document.getElementById('metrics-details-host'),
  );
  initUpload({
    fileInput: document.getElementById('file-input'),
    overlay: document.getElementById('overlay-state'),
    openButtons: [document.getElementById('btn-open')],
  });
  initFileChip(document.getElementById('app-header'));
  initExport(document.getElementById('btn-export'));
  initAutoSegments(document.getElementById('btn-auto-segments'));
  initDualVariableAnalysis({
    button: document.getElementById('btn-dual-variable'),
    dialog: document.getElementById('dual-variable-dialog'),
  });
  wireHeader();
  wireWaypoints();
  wireStores();
  wireLanguage();
}

/** @private */
function wireHeader() {
  // GitHub link: which logo file shows follows the data state, so it listens to
  // the track store like the Export and Auto split buttons do. layout.css owns
  // the lockup/mark and theme rules.
  const githubLink = document.getElementById('btn-github');
  const supportLink = document.getElementById('btn-support');
  trackStore.subscribe((track) => {
    githubLink.classList.toggle('is-loaded', !!track);
    supportLink.classList.toggle('is-loaded', !!track);
  });
  initDrawer(
    document.getElementById('settings-drawer'),
    document.getElementById('btn-settings'),
  );
  // The zone editor opens as a second dialog on top of the drawer.
  initHeartZonesDialog(document.getElementById('hr-zones-dialog'));
  // The author's story popup — same on-top-of-the-drawer pattern.
  initStoryDialog(document.getElementById('story-dialog'));
  // Basemap picker lives on the map itself, under the waypoint toggle.
  createMenu({
    button: document.getElementById('btn-layers'),
    buildItems: buildMapSourceItems,
    onPick: pickMapSource,
  });
  // Arrow wrappers: fitTrack takes an options object — a raw binding would
  // hand the click event to it.
  document.getElementById('btn-fit').addEventListener('click', () => fitTrack());
  document.getElementById('btn-fit-sector').addEventListener('click', () => fitSector());
}

/**
 * @private Waypoint visibility toggle, next to "zoom to track". The icon
 * announces the ACTION: map-pin (show) while hidden, map-pin-off (hide)
 * while shown. Only visible for tracks that actually carry waypoints.
 */
let waypointsVisible = true;

function wireWaypoints() {
  const btn = document.getElementById('btn-waypoints');
  btn.addEventListener('click', () => {
    waypointsVisible = !waypointsVisible;
    setWaypointsVisible(waypointsVisible);
    refreshWaypointsButton();
  });
  on('language:changed', refreshWaypointsButton);
}

function refreshWaypointsButton() {
  const btn = document.getElementById('btn-waypoints');
  if (btn.hidden) return;
  btn.querySelector('.btn-icon-slot').innerHTML = icon(waypointsVisible ? 'map-pin-off' : 'map-pin');
  const key = waypointsVisible ? 'waypointsHide' : 'waypointsShow';
  btn.title = t(key);
  btn.setAttribute('aria-label', t(key));
}

/**
 * @private "All metrics" sheet keeps its content node between opens: the
 * metrics panel renders the detail groups into the host once, the sheet
 * borrows the node while open and hands it back on close.
 */
function wireDetailsSheet() {
  const sheet = document.getElementById('sheet');
  const sheetBody = document.querySelector('#sheet-body');
  const host = document.getElementById('metrics-details-host');
  const holder = document.getElementById('metrics-details-holder');

  on('details:open', () => {
    // The sheet body is shared with the auto-segment list, which leaves its
    // DOM in place when its own sheet closes — replace the body's children so
    // the All metrics popup holds the metrics groups and nothing else
    // (render() in autoSegments.js clears the body the same way in reverse).
    sheetBody.replaceChildren(host);
    openDetailsSheet();
  });
  sheet.addEventListener('close', () => {
    holder.appendChild(host);
  });
}

/** @private Track → map/profile/chip updates. */
function wireStores() {
  trackStore.subscribe((track) => {
    // A fresh track always starts with its waypoints shown — reset before the
    // map rebuilds its layers so the waypoint group is created in one pass.
    waypointsVisible = true;
    mapSetTrack(track);
    setProfileTrack(track);
    // Select the whole track by default; this also triggers the first
    // synchronized sector redraw across map, profile and metrics.
    setTrackTotal(track.totalDistance);

    setWaypointsVisible(true);
    const hasWaypoints = (track.waypoints || []).length > 0;
    document.getElementById('btn-waypoints').hidden = !hasWaypoints;
    document.getElementById('btn-waypoint-snap').hidden = !hasWaypoints;
    refreshWaypointsButton();

    // "No elevation data" hint above the profile.
    document.getElementById('profile-note').hidden = track.hasElevation;

    document.getElementById('file-chip').hidden = false;
    refreshFileChip();
  });

  on('units:changed', refreshFileChip);
  on('language:changed', refreshFileChip);

  on('hover:dist', ({ dist, origin }) => {
    if (origin === 'profile') mapShowHover(dist, origin);
  });
}

/**
 * @private The header file chip's content: name, one-line meta and the same
 * three facts as popover lines. Number formatting and unit labels come from
 * the language pack and the unit system, so it is rewritten on track load,
 * unit switch and language switch alike — anything less leaves the chip in
 * the previous language. Whether the chip shows the full line or degrades
 * to the (i) button is measured in fileChip.js on every rewrite.
 */
function refreshFileChip() {
  const track = trackStore.get();
  if (!track) return;
  const points = t('pointsCount', { n: formatInt(track.pointCount) });
  const distance = formatDistance(track.totalDistance);
  setFileChipContent({
    name: track.name,
    meta: `${points} · ${distance}`,
    lines: [track.name, distance, points],
  });
}

/** @private Live language switching without reload. */
function wireLanguage() {
  const applyAll = () => {
    document.title = t('appTitle');
    applyStaticTranslations();
  };
  applyAll(); // boot-time hydration of data-i18n / data-icon content
  hydrateStaticIcons();
  on('language:changed', () => {
    applyAll();
  });
}

/** @private Replaces <span data-icon="name"> placeholders with inline SVGs. */
function hydrateStaticIcons() {
  for (const el of document.querySelectorAll('[data-icon]')) {
    el.innerHTML = icon(el.dataset.icon);
  }
}
