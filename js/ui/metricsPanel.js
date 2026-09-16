/**
 * Metrics panel — telemetry-dashboard style readout for the selected sector.
 *
 * Layout follows the UI spec: strong numeric hierarchy (hero distance on
 * top, dense label/value rows below), grouped details, and honest
 * "Unavailable ≠ 0" handling when elevation or timestamps are missing.
 * The same detail groups are rendered into the mobile "All metrics" sheet.
 */
import { trackStore } from '../core/stores.js';
import { sectorStore, resetSector, isEntireTrack } from '../sector/sectorStore.js';
import { computeSectorMetrics } from '../metrics/sectorMetrics.js';
import { computeHeartRateZoneStats } from '../metrics/heartRateStats.js';
import { zoneDisplayRange } from '../metrics/heartRateZones.js';
import { t } from '../language/language.js';
import { on, emit } from '../core/events.js';
import { icon } from './icons.js';
import {
  formatDistance, formatSignedElevation, formatElevation, formatGrade,
  formatPace, formatSpeed, formatDuration, formatDateTime,
  formatSectorRangeBounds,
  formatVam, formatBpm, formatBpmRange, formatPercent, formatRpm,
  formatTemp, formatPower,
} from '../utils/format.js';

let paneRoot = null;
let detailsRoot = null;   // target inside the "All metrics" sheet

// Every render is an O(n) pass over the track plus two innerHTML rebuilds, so
// it must not run at event frequency. Sector changes (handle drags reach
// 60–120 Hz) go through a rAF-batched, ~100 ms-throttled schedule (same
// rAF pattern as mapView.scheduleSectorSync); a trailing edge guarantees the
// final drag position always lands on screen. Language / units / zone / track
// changes bypass the throttle and render immediately — their output must be
// identical to the previous synchronous behavior, ARIA attributes included.
/** Minimum spacing between sector-driven renders during a continuous drag. @private */
const SECTOR_RENDER_INTERVAL_MS = 100;
/** rAF coalescing flag (id of the pending frame, 0 = none). @private */
let renderRaf = 0;
/** Trailing-edge timer so the last sector change is never dropped. @private */
let trailingTimer = 0;
/** performance.now() of the last executed render. @private */
let lastRenderAt = 0;

/**
 * @param {HTMLElement} pane  metrics pane container
 * @param {HTMLElement} detailsTarget  container inside the details sheet
 */
export function initMetricsPanel(pane, detailsTarget) {
  paneRoot = pane;
  detailsRoot = detailsTarget;

  sectorStore.subscribe(() => scheduleRender());
  trackStore.subscribe(() => renderNow());
  on('language:changed', () => renderNow());
  on('units:changed', () => renderNow());
  // Zone edits (mode / boundaries / base heart rates) change the zone table
  // the Heart Rate Zones group is built from — re-render immediately.
  on('hrzones:changed', () => renderNow());
  wireHintPopovers();
  renderNow();
}

/** @private Immediate render; cancels pending scheduled renders and resets the throttle. */
function renderNow() {
  if (renderRaf) {
    cancelAnimationFrame(renderRaf);
    renderRaf = 0;
  }
  if (trailingTimer) {
    clearTimeout(trailingTimer);
    trailingTimer = 0;
  }
  lastRenderAt = performance.now();
  render();
}

/** @private rAF-batched, drag-throttled render entry for sector changes. */
function scheduleRender() {
  if (renderRaf) return;
  renderRaf = requestAnimationFrame(() => {
    renderRaf = 0;
    const sinceLast = performance.now() - lastRenderAt;
    if (sinceLast >= SECTOR_RENDER_INTERVAL_MS) {
      renderNow();
    } else if (!trailingTimer) {
      // Trailing edge at the end of the current throttle window: mid-drag
      // renders keep the readout at ~10 Hz, and this timer doubles as the
      // guarantee that the values shown after release are the final ones.
      trailingTimer = setTimeout(() => {
        trailingTimer = 0;
        renderNow();
      }, SECTOR_RENDER_INTERVAL_MS - sinceLast);
    }
  });
}

/** @private Full re-render of the panel and the details sheet target. */
function render() {
  if (!paneRoot) return;
  // A rebuild would orphan the open popover's anchor button and could show
  // a stale note — close it; reopening is one click away.
  closeHintPopover();
  const track = trackStore.get();
  if (!track) {
    paneRoot.innerHTML = `<div class="metrics-empty">${t('dropTitle')}<br>${t('dropSubtitle')}</div>`;
    if (detailsRoot) detailsRoot.innerHTML = '';
    return;
  }

  const { start, end } = sectorStore.get();
  const m = computeSectorMetrics(track, start, end);
  const entire = isEntireTrack();
  const [rangeStartText, rangeEndText] = formatSectorRangeBounds(start, end);

  paneRoot.innerHTML = `
    <div class="metrics-head">
      <h2 class="metrics-title">${t('sector')}</h2>
      <span class="badge" ${entire ? '' : 'hidden'}>${t('entireTrack')}</span>
      <span class="flex-spacer"></span>
      <button type="button" class="btn btn-ghost btn-icon" id="btn-reset-sector"
              title="${t('resetSector')}" aria-label="${t('resetSector')}">${icon('rotate-ccw')}</button>
      <button type="button" class="btn btn-ghost btn-small metrics-details-btn" id="btn-details-2"
              title="${t('allMetrics')}">${t('allMetrics')}</button>
    </div>
    <div class="sector-range num" aria-hidden="true">
      <span>${rangeStartText}</span>
      <span class="sector-range-arrow">→</span>
      <span>${rangeEndText}</span>
    </div>
    <div class="metric-hero">
      <span class="metric-hero-label">${t('distance')}</span>
      <span class="metric-hero-value num">${formatDistance(m.horizontalDistance)}</span>
    </div>
    <div class="metric-rows">
      ${row(t('threeDDistance'), formatDistance(m.distance3D), !track.hasElevation, t('threeDDistanceHint'))}
      ${row(t('effortDistance'), formatDistance(m.effortDistance), !track.hasElevation, t('effortDistanceHint'))}
      ${row(t('elevationGain'), formatElevation(m.gain ?? NaN), !track.hasElevation, t('elevationGainHint'))}
      ${row(t('elevationLoss'), m.loss == null ? '—' : formatElevation(m.loss), !track.hasElevation, t('elevationLossHint'))}
      ${row(t('avgGrade'), formatGrade(m.avgGrade), !track.hasElevation, t('gradeWindowNote'))}
      ${row(t('avgPace'), formatPace(m.avgPace ?? NaN), !track.hasTime, t('speedOutlierNote'))}
      ${row(t('avgGap'), formatPace(m.avgGap ?? NaN), !track.hasTime || !track.hasElevation, t('gapNote'))}
      ${row(t('avgSpeed'), formatSpeed(m.avgSpeed ?? NaN), !track.hasTime, t('speedOutlierNote'))}
    </div>
    ${detailsHtml(track, m, start, end)}
  `;

  if (detailsRoot) detailsRoot.innerHTML = detailsHtml(track, m, start, end);

  paneRoot.querySelector('#btn-reset-sector')?.addEventListener('click', resetSector);
  paneRoot.querySelector('#btn-details-2')?.addEventListener('click', () => emit('details:open'));
}

/**
 * Detail groups — Elevation, Gradient, Speed, Time — rendered below the
 * summary. On narrow screens each group becomes a distinct page module; on
 * desktop they live in the right rail.
 * @private
 */
function detailsHtml(track, m, start, end) {
  const eleNA = !track.hasElevation;
  const timeNA = !track.hasTime;
  return `
    <div class="metric-groups">
      <div class="metric-group">
        <div class="metric-group-title">${t('elevationGroup')}</div>
        ${row(t('startElevation'), formatElevation(m.eleStart ?? NaN), eleNA)}
        ${row(t('endElevation'), formatElevation(m.eleEnd ?? NaN), eleNA)}
        ${row(t('minElevation'), formatElevation(m.eleMin ?? NaN), eleNA)}
        ${row(t('maxElevation'), formatElevation(m.eleMax ?? NaN), eleNA)}
        ${row(t('netElevationChange'), m.netElevation == null ? '—' : formatSignedElevation(m.netElevation), eleNA)}
        ${groupNote(eleNA, t('noElevationData'))}
      </div>
      <div class="metric-group">
        <div class="metric-group-title">${t('gradientGroup')}</div>
        ${row(t('maxGrade'), formatGrade(m.maxGrade), eleNA, t('gradeWindowNote'))}
        ${row(t('minGrade'), formatGrade(m.minGrade), eleNA, t('gradeWindowNote'))}
        ${groupNote(eleNA, t('noElevationData'))}
      </div>
      <div class="metric-group">
        <div class="metric-group-title">${t('speedGroup')}</div>
        ${row(t('avgSpeed'), formatSpeed(m.avgSpeed ?? NaN), timeNA, t('speedOutlierNote'))}
        ${row(t('maxSpeed'), formatSpeed(m.maxSpeed ?? NaN), timeNA, t('maxSpeedNote'))}
        ${row(t('fastestKm'), m.fastestKm ? formatPace(m.fastestKm.pace) : '—', timeNA, t('pauseNote'))}
        ${row(t('slowestKm'), m.slowestKm ? formatPace(m.slowestKm.pace) : '—', timeNA, t('pauseNote'))}
        ${row(t('vam'), formatVam(m.vam ?? NaN), eleNA || timeNA, t('pauseNote'))}
        ${row(t('vdm'), formatVam(m.vdm ?? NaN), eleNA || timeNA, t('pauseNote'))}
        ${groupNote(timeNA, t('noTimestampData'))}
      </div>
      <div class="metric-group">
        <div class="metric-group-title">${t('timeGroup')}</div>
        ${row(t('elapsed'), formatDuration(m.elapsed ?? NaN), timeNA)}
        ${row(t('movingTime'), formatDuration(m.moving ?? NaN), timeNA, t('movingNote'))}
        ${row(t('startTime'), formatDateTime(m.timeStart ?? NaN), timeNA)}
        ${row(t('endTime'), formatDateTime(m.timeEnd ?? NaN), timeNA)}
        ${groupNote(timeNA, t('noTimestampData'))}
      </div>
      <div class="metric-group">
        <div class="metric-group-title">${t('fitnessGroup')}</div>
        ${row(t('avgHr'), formatBpm(m.avgHr ?? NaN), m.avgHr == null, t('fitnessPauseNote'))}
        ${row(t('maxHr'), formatBpm(m.maxHr ?? NaN), m.maxHr == null, t('fitnessPauseNote'))}
        ${row(t('avgCadence'), formatRpm(m.avgCad ?? NaN), m.avgCad == null, t('fitnessPauseNote'))}
        ${row(t('maxCadence'), formatRpm(m.maxCad ?? NaN), m.maxCad == null, t('fitnessPauseNote'))}
        ${row(t('avgPower'), formatPower(m.avgPower ?? NaN), m.avgPower == null, t('fitnessPauseNote'))}
        ${row(t('maxPower'), formatPower(m.maxPower ?? NaN), m.maxPower == null, t('fitnessPauseNote'))}
        ${row(t('avgTemp'), formatTemp(m.avgTemp ?? NaN), m.avgTemp == null, t('fitnessOutlierNote'))}
        ${row(t('minTemp'), formatTemp(m.minTemp ?? NaN), m.minTemp == null, t('fitnessOutlierNote'))}
        ${row(t('maxTemp'), formatTemp(m.maxTemp ?? NaN), m.maxTemp == null, t('fitnessOutlierNote'))}
        ${groupNote(!track.hasHr && !track.hasCad && !track.hasPower && !track.hasTemp, t('noFitnessData'))}
      </div>
      ${hrZonesGroupHtml(track, start, end)}
    </div>
  `;
}

/**
 * Heart Rate Zones — Garmin-style time-in-zone distribution for a distance
 * range. Bars scale relative to the largest zone share (the sketch's longest
 * bar spans the full width); seconds come from the same pause-excluded moving
 * time the Time group reports, and stretches without a heart-rate reading
 * enter no zone at all. The main panel renders it for the selected sector;
 * the auto-split segment details reuse it per segment range.
 * @param {import('../types.js').Track} track
 * @param {number} start  meters along the track
 * @param {number} end    meters along the track
 */
export function hrZonesGroupHtml(track, start, end) {
  if (!track.hasHr) {
    return `
      <div class="metric-group">
        <div class="metric-group-title">${t('hrZones')}</div>
        ${groupNote(true, t('noHeartRateData'))}
      </div>
    `;
  }
  if (!track.hasTime) {
    return `
      <div class="metric-group">
        <div class="metric-group-title">${t('hrZones')}</div>
        ${groupNote(true, t('noTimestampData'))}
      </div>
    `;
  }
  const stats = computeHeartRateZoneStats(track, start, end);
  if (!stats) {
    return `
      <div class="metric-group">
        <div class="metric-group-title">${t('hrZones')}</div>
        ${groupNote(true, t('noHeartRateData'))}
      </div>
    `;
  }
  // The percentage denominator EXCLUDES below-B1 time: those readings are
  // "not counted" (like pauses), so they must not silently dilute the zone
  // shares either — a track whose heart rate almost never reaches Zone 1
  // would otherwise show single-digit percentages for all its zone time.
  // noHr stays in the denominator: per spec, missing readings are one of the
  // reasons the zone shares need not sum to 100 %.
  const denominator = Math.max(stats.moving - stats.below, 0);
  const rows = stats.zones.map((zone, i) => {
    const pct = denominator > 0 ? Math.round((zone.seconds / denominator) * 100) : 0;
    // Integer readout of the continuous bounds: [ceil(lo), ceil(hi) - 1] —
    // adjacent zones read as strictly consecutive whole bpm values.
    const d = zoneDisplayRange(zone);
    return `
      <div class="hrzone-row">
        <div class="hrzone-line">
          <span class="hrzone-name">${t('zoneN', { n: i + 1 })}</span>
          <span class="hrzone-range num">${formatBpmRange(d.lo, d.hi)}</span>
          <span class="hrzone-pct num">${formatPercent(pct)}</span>
          <span class="hrzone-time num">${formatDuration(zone.seconds)}</span>
        </div>
        <div class="hrzone-bar" role="presentation">
          <div class="hrzone-bar-fill" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
  const noHrNote = stats.noHr > 0.5
    ? `<div class="metric-group-note">${t('hrNoHrNote', { time: formatDuration(stats.noHr) })}</div>`
    : '';
  const belowNote = stats.below > 0.5
    ? `<div class="metric-group-note">${t('hrBelowNote', { time: formatDuration(stats.below) })}</div>`
    : '';
  return `
    <div class="metric-group">
      <div class="metric-group-title">${t('hrZones')}</div>
      <div class="hrzone-rows">${rows}</div>
      ${noHrNote}
      ${belowNote}
      <div class="metric-group-note">${t('hrZonesDenominatorNote')}</div>
    </div>
  `;
}

/**
 * One label/value row. Unavailable rows show a dash plus a reason —
 * they never fall back to 0. `hint` is the row's explanation (the reason
 * when data is missing, a methodology note when it is present), surfaced
 * through the circled-question-mark button right after the label —
 * "Climb (?)" — whose click opens a small popover with the text (the
 * extended hit radius makes it touch-friendly — see wireHintPopovers); the
 * value stays on the far right. There is deliberately no hover tooltip:
 * the popover replaced it. The auto-split segment details reuse this row
 * so their entries carry the same buttons as the main panel's.
 */
export function row(label, value, unavailable, hint) {
  const valueHtml = unavailable ? `<span class="metric-na">${t('unavailable')}</span>` : value;
  const hintBtn = hint
    ? `<button type="button" class="metric-hint-btn" data-hint="${hint}"` +
      ` aria-label="${hint}" aria-expanded="false">${icon('circle-question-mark')}</button>`
    : '';
  return `
    <div class="metric-row">
      <span class="metric-label">${label}</span>${hintBtn}
      <span class="metric-value num ${unavailable ? 'is-na' : ''}">${valueHtml}</span>
    </div>
  `;
}

/** @private Reason line shown once per group when data is missing. */
function groupNote(unavailable, reason) {
  return unavailable ? `<div class="metric-group-note">${reason}</div>` : '';
}

// Hint popovers -----------------------------------------------------------------
//
// Every hint row's circled-question-mark button opens a small popover with
// the same text its row shows on hover. One popover exists at a time; it is
// a singleton element appended OUTSIDE the panel markup (re-renders rebuild
// the rows and would orphan it), anchored to the clicked button's rect. The
// wiring is global on purpose: row() is shared with the auto-split segment
// details and the mobile "All metrics" sheet, and those live in other
// containers (including a modal <dialog>, which the popover must be appended
// INTO to sit above its top layer).

/** Click hit extension beyond the icon's outer circle, px. @private */
const HINT_HIT_EXTEND_PX = 30;

/** The one open popover element, null when closed. @private */
let hintPopover = null;
/** The button it is anchored to, null when closed. @private */
let openHintBtn = null;
/** Guards the once-only global wiring. @private */
let hintWired = false;

/** @private Global listeners for opening/closing hint popovers. */
function wireHintPopovers() {
  if (hintWired) return;
  hintWired = true;
  // A click on the button itself (pointer OR keyboard activation — both
  // dispatch click with the button as target) toggles its popover. A click
  // anywhere else opens the nearest icon's popover while it lands inside
  // that icon's extended hit radius, and closes the popover otherwise —
  // with one carve-out: the extended radius may only claim DEAD ZONES. A
  // precise click on another control (the settings gear, the drawer's rows
  // or its backdrop, the sheet's segment rows — all of which can sit within
  // the radius of an icon underneath them) must never proximity-open a
  // popover; it just closes one, like any click outside.
  document.addEventListener('click', (event) => {
    const btn = event.target.closest('.metric-hint-btn');
    if (btn) {
      if (btn === openHintBtn) closeHintPopover();
      else openHintPopover(btn);
      return;
    }
    if (event.target.closest('button, a, input, select, textarea, label, dialog')) {
      closeHintPopover();
      return;
    }
    const hit = hintBtnNear(event.clientX, event.clientY, event.target);
    if (hit) {
      if (hit === openHintBtn) closeHintPopover();
      else openHintPopover(hit);
      return;
    }
    closeHintPopover();
  });
  // The popover would detach from its anchor or go stale.
  document.addEventListener('scroll', closeHintPopover, true);
  window.addEventListener('resize', closeHintPopover);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeHintPopover();
  });
}

/**
 * @private The hint button whose extended hit radius contains the point,
 * nearest center wins — null when none does. Hidden rows (collapsed segment
 * details) report zero-size rects and never match. Two STRICT-VISIBILITY
 * gates keep the touch extension from hijacking clicks aimed at another
 * surface, however close that surface floats to an icon:
 *   1. the icon is genuinely VISIBLE — its center's topmost painted element
 *      is the icon itself, not the settings drawer, a dialog backdrop or any
 *      other cover;
 *   2. the click landed inside the icon's OWN surface root (the metrics pane,
 *      or the dialog the icon lives in) — a click on the elevation profile's
 *      canvas, the map or a drawer row was aimed elsewhere.
 */
function hintBtnNear(x, y, clickTarget) {
  let best = null;
  let bestDist = Infinity;
  for (const btn of document.querySelectorAll('.metric-hint-btn')) {
    const rect = btn.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const top = document.elementFromPoint(cx, cy);
    if (!top || !btn.contains(top)) continue;
    const root = btn.closest('dialog, #metrics-pane');
    if (!root || !root.contains(clickTarget)) continue;
    const svg = btn.querySelector('svg');
    // The icon's outer circle ≈ half its rendered box (the drawn circle of
    // the Lucide glyph fills the viewBox), extended by a fixed touch margin.
    const iconRadius = (svg ? svg.clientWidth : rect.width) / 2;
    const hitRadius = iconRadius + HINT_HIT_EXTEND_PX;
    const dist = Math.hypot(x - cx, y - cy);
    if (dist <= hitRadius && dist < bestDist) {
      best = btn;
      bestDist = dist;
    }
  }
  return best;
}

/** @private Opens the singleton popover for one hint button. */
function openHintPopover(btn) {
  const text = btn.getAttribute('data-hint');
  if (!text) return;
  closeHintPopover();
  hintPopover = document.createElement('div');
  hintPopover.className = 'hint-popover';
  hintPopover.setAttribute('role', 'tooltip');
  hintPopover.textContent = text;
  // Inside a modal <dialog> the top layer sits above any body-level fixed
  // element, so the popover must live where its anchor lives.
  (btn.closest('dialog') || document.body).appendChild(hintPopover);
  openHintBtn = btn;
  btn.setAttribute('aria-expanded', 'true');
  positionHintPopover();
}

/** @private Anchors the open popover below its icon, right-aligned, clamped
 *  to the viewport; flips above when there is no room below. */
function positionHintPopover() {
  if (!hintPopover || !openHintBtn) return;
  const anchor = openHintBtn.getBoundingClientRect();
  const pop = hintPopover.getBoundingClientRect();
  const margin = 8;
  let left = anchor.right - pop.width;
  left = Math.min(Math.max(left, margin), window.innerWidth - margin - pop.width);
  let top = anchor.bottom + 6;
  if (top + pop.height > window.innerHeight - margin) top = anchor.top - 6 - pop.height;
  hintPopover.style.left = `${Math.round(Math.max(margin, left))}px`;
  hintPopover.style.top = `${Math.round(top)}px`;
}

/** @private Closes the open popover, if any. Safe to call when closed. */
function closeHintPopover() {
  if (openHintBtn) openHintBtn.setAttribute('aria-expanded', 'false');
  if (hintPopover) hintPopover.remove();
  hintPopover = null;
  openHintBtn = null;
}
