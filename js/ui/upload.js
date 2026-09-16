/**
 * File loading + application state overlay (empty / loading / error).
 *
 * Privacy by architecture: the file is read with the File API and parsed in
 * the browser. Nothing ever leaves the page — there is no upload code to audit.
 */
import { ParseError, PARSE_ERROR_KEYS } from '../parsers/parseError.js';
import { parseTrackOffThread } from '../workers/parseWorkerClient.js';
import { trackStore } from '../core/stores.js';
import { t } from '../language/language.js';
import { on } from '../core/events.js';
import { icon } from './icons.js';

const ACCEPTED = /\.(gpx|kml|kmz|fit|tcx)$/i;

let overlay = null;
let fileInput = null;
let errorKey = null;

/**
 * Wires the upload entry points and prepares the state overlay.
 * @param {{fileInput: HTMLInputElement, overlay: HTMLElement, openButtons: HTMLElement[]}} cfg
 */
export function initUpload({ fileInput: input, overlay: overlayEl, openButtons }) {
  overlay = overlayEl;
  fileInput = input;

  fileInput.accept = '.gpx,.kml,.kmz,.fit,.tcx';
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (file) loadFile(file);
    fileInput.value = '';
  });
  for (const btn of openButtons) {
    btn.addEventListener('click', () => fileInput.click());
  }

  // Drag & drop anywhere on the page.
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    showDropTarget(true);
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) showDropTarget(false);
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    showDropTarget(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) loadFile(file);
  });

  on('language:changed', () => {
    // Re-render the overlay text in the new language (keeps current state).
    if (overlay.dataset.state === 'error' && errorKey) showError(errorKey);
    else if (overlay.dataset.state === 'empty') showEmpty();
    else if (overlay.dataset.state === 'loading') showLoading();
  });

  showEmpty();
}

/**
 * Loads a track file end to end: read → detect → parse → validate → prepare.
 * @param {File} file
 */
export async function loadFile(file) {
  if (!ACCEPTED.test(file.name)) {
    showError(PARSE_ERROR_KEYS.unsupported);
    return;
  }
  showLoading();
  try {
    // Yield a frame so the loading state paints before the file is read; the
    // parse itself runs in the worker (parseWorkerClient.js) and never
    // blocks this thread — with a main-thread fallback for restricted runs.
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const buffer = await file.arrayBuffer();
    const track = await parseTrackOffThread(buffer, file.name);
    // Full source file name (with extension) for the text exports' first line;
    // track.name itself stays the extension-less base name.
    track.sourceName = file.name;
    trackStore.set(track);
    hideOverlay();
  } catch (err) {
    const key = err instanceof ParseError ? err.key : PARSE_ERROR_KEYS.invalid;
    console.warn('[WaySlice] parse failed:', err);
    showError(key);
  }
}

/** @private */
function setState(state, html) {
  overlay.dataset.state = state;
  overlay.innerHTML = html;
  overlay.hidden = false;
}

/** @private */
export function showEmpty() {
  setState('empty', `
    <div class="state-card">
      <div class="state-brand"><img src="icons/favicon.svg" alt=""></div>
      <h2 class="state-title">WaySlice</h2>
      <p class="state-text">${t('dropTitle')}<br>${t('dropSubtitle')}</p>
      <button type="button" class="btn btn-primary btn-large" id="btn-empty-open">${icon('folder-open')}<span>${t('openTrack')}</span></button>
      <p class="state-privacy">${icon('shield-check')}<span>${t('privacyNote')}</span></p>
    </div>
  `);
  overlay.querySelector('#btn-empty-open')?.addEventListener('click', () => fileInput.click());
}

/** @private */
export function showLoading() {
  setState('loading', `
    <div class="state-card">
      <div class="spinner" role="status" aria-label="${t('parsingTrack')}"></div>
      <p class="state-text">${t('parsingTrack')}</p>
    </div>
  `);
}

/** @private */
export function showError(key) {
  errorKey = key;
  setState('error', `
    <div class="state-card">
      <div class="state-error-icon">${icon('triangle-alert')}</div>
      <h2 class="state-title">${t('errorTitle')}</h2>
      <p class="state-text">${t(key)}</p>
      <button type="button" class="btn btn-primary" id="btn-error-retry">${icon('folder-open')}<span>${t('tryAnotherFile')}</span></button>
    </div>
  `);
  overlay.querySelector('#btn-error-retry')?.addEventListener('click', () => fileInput.click());
}

/** @private */
function hideOverlay() {
  overlay.hidden = true;
  overlay.dataset.state = '';
  overlay.innerHTML = '';
}

/** @private */
function showDropTarget(active) {
  let zone = document.getElementById('drop-overlay');
  if (active) {
    if (!zone) {
      zone = document.createElement('div');
      zone.id = 'drop-overlay';
      zone.innerHTML = `<div class="drop-card">${icon('upload')}<span>${t('dropTitle')}</span></div>`;
      document.body.appendChild(zone);
    }
    zone.hidden = false;
  } else if (zone) {
    zone.hidden = true;
  }
}
