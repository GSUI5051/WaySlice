/**
 * Sector selection state — single source of truth for the selected range.
 *
 * The sector is parameterized by horizontal distance along the track (meters),
 * which map handles, the profile chart and the metrics panel all share.
 * Boundaries may sit between two track points; precision is preserved by
 * interpolation at analysis time (see geo/interpolate.js).
 */
import { createStore } from '../core/events.js';

/** Minimum selectable sector length in meters. */
export const MIN_SECTOR_M = 5;

export const sectorStore = createStore(/** @type {{start:number, end:number}} */({ start: 0, end: 0 }));

let total = 0;

/** Total track distance the sector is measured against. */
export function getTrackTotal() {
  return total;
}

/** Resets the sector to the whole track (used on load and via "reset"). */
export function resetSector() {
  total = Math.max(total, 0);
  sectorStore.set({ start: 0, end: total });
}

/** Sets the reference total and resets the selection (call on track load). */
export function setTrackTotal(newTotal) {
  total = newTotal;
  resetSector();
}

/** Moves one boundary ('start' | 'end') to `dist`, clamped against the other. */
export function moveBoundary(which, dist) {
  const { start, end } = sectorStore.get();
  if (which === 'start') {
    sectorStore.set({ start: clamp(dist, 0, end - MIN_SECTOR_M), end });
  } else {
    sectorStore.set({ start, end: clamp(dist, start + MIN_SECTOR_M, total) });
  }
}

/**
 * Keyboard action for a sector-boundary handle. Arrow keys nudge by
 * (shift ? 10 : 1) × max(total/400, 10) meters; Home snaps to the track
 * start (start handle) or the current start (end handle); End to the current
 * end (start handle) or the track end (end handle). Null for other keys —
 * the caller owns preventDefault/stopPropagation policy.
 * @param {'start'|'end'} which
 * @param {KeyboardEvent} e
 * @param {number} total
 * @returns {{delta?: number, to?: number}|null}
 */
export function boundaryKeyAction(which, e, total) {
  const step = (e.shiftKey ? 10 : 1) * Math.max(total / 400, 10);
  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') return { delta: step };
  if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') return { delta: -step };
  const { start, end } = sectorStore.get();
  if (e.key === 'Home') return { to: which === 'start' ? 0 : start };
  if (e.key === 'End') return { to: which === 'end' ? total : end };
  return null;
}

/** Sets both boundaries at once (profile rubber-band selection). */
export function setRange(start, end) {
  let lo = clamp(Math.min(start, end), 0, total);
  let hi = clamp(Math.max(start, end), 0, total);
  if (hi - lo < MIN_SECTOR_M) {
    // Degenerate drag (tap): widen to the minimum, anchored at the tap.
    lo = clamp(lo - MIN_SECTOR_M / 2, 0, total);
    hi = clamp(lo + MIN_SECTOR_M, 0, total);
  }
  sectorStore.set({ start: lo, end: hi });
}

/**
 * True when the given selection covers (almost) the whole track — 0.5 m of
 * tolerance per end. Defaults to the live selection; the exporter passes its
 * own range and total so the GPX metadata never depends on store timing.
 * @param {{start: number, end: number}} [range]
 * @param {number} [total]
 */
export function isEntireTrack(range = sectorStore.get(), total = getTrackTotal()) {
  return range.start <= 0.5 && range.end >= total - 0.5;
}

/** @private */
function clamp(v, min, max) {
  return Math.min(Math.max(v, min), Math.max(min, max));
}
