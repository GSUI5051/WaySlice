/**
 * Cooperative touch gestures (Google-Maps-embed style).
 *
 * On touch devices the workspace is one long scrolling page, so the map must
 * not swallow single-finger swipes: one finger scrolls the page, two fingers
 * pan/zoom the map.
 *
 * Mechanism: `initMap` disables `dragging` but keeps `touchZoom`, so the
 * container ends up with Leaflet's `leaflet-touch-zoom` class
 * (`touch-action: pan-x pan-y`) — the browser scrolls the page on one-finger
 * swipes, while two-finger gestures are claimed by Leaflet's TouchZoom
 * handler (preventDefault) and drive pinch-zoom + two-finger panning.
 *
 * This module adds the brief "use two fingers" hint shown when a single
 * finger touches the map. Fine-pointer (mouse) environments never enter
 * this mode at all.
 */
import { icon } from '../ui/icons.js';
import { t } from '../language/language.js';

/** True when the primary input is a touch screen (phones, tablets). */
export function wantsCooperativeGestures() {
  return window.matchMedia('(pointer: coarse)').matches;
}

/**
 * Adds the one-finger hint overlay for a map in cooperative mode.
 *
 * @param {HTMLElement} container  the map container element
 */
export function addGestureHint(container) {
  const hint = document.createElement('div');
  hint.className = 'map-gesture-hint';
  hint.setAttribute('aria-live', 'polite');
  hint.hidden = true;
  container.appendChild(hint);

  let hideTimer = null;
  const hide = () => {
    hint.hidden = true;
    clearTimeout(hideTimer);
  };
  const show = () => {
    hint.innerHTML = `${icon('hand')}<span>${t('mapGestureHint')}</span>`;
    hint.hidden = false;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 1600);
  };

  container.addEventListener('touchstart', (e) => {
    if (e.touches.length >= 2) hide();
    else show();
  }, { passive: true });
  container.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) hide();
  }, { passive: true });
  container.addEventListener('touchcancel', hide, { passive: true });
}
