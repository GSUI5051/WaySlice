/**
 * Auto split — header button opening a segment-list sheet.
 *
 * The sheet carries a mode toolbar — slope / 1 km / 5 km / custom length —
 * and an accordion list of consecutive segment ranges. Each collapsed row
 * shows its range, elapsed time, pace and heart rate; expanding a row reveals
 * the effort details (3D/effort distance, gain/loss, GAP, VAM, VDM) computed
 * by computeSectorMetrics plus the segment's time-in-zone distribution (the
 * same Heart Rate Zones group the main metrics panel renders). Detail rows
 * reuse the metrics panel's row builder, so every entry carries the same
 * hover tooltip (methodology note) it has in the main panel, and selecting a
 * row scrolls the main sector (map + profile + metrics) onto that segment.
 * Content re-renders on language and unit switches while it stays open.
 */
import { t } from '../language/language.js';
import { icon } from './icons.js';
import { trackStore } from '../core/stores.js';
import { on } from '../core/events.js';
import { setRange } from '../sector/sectorStore.js';
import { computeSectorMetrics } from '../metrics/sectorMetrics.js';
import { splitByLength, splitByGrade, splitByWaypoints, segmentType } from '../metrics/autoSegments.js';
import { openSheet, setSheetTitle } from './sheets.js';
import { row as metricRow, hrZonesGroupHtml } from './metricsPanel.js';
import {
  formatDistance, formatDistanceShort, formatElevation,
  formatPace, formatVam, formatDuration, formatBpm,
} from '../utils/format.js';
import { getUnitSystem, METERS_PER_MILE, distanceUnit } from '../units/units.js';

/**
 * Toolbar modes in display order. The labeled chips carry their slice length
 * in the ACTIVE unit system — 1 km / 5 km in metric, 1 mi / 5 mi in imperial
 * — so they are rebuilt by render() and relabel on units:changed.
 */
function toolbarModes() {
  const imperial = getUnitSystem() === 'imperial';
  const slice = imperial ? METERS_PER_MILE : 1000;
  return [
    { id: 'grade', labelKey: 'modeGrade' },
    { id: '1k', label: imperial ? '1 mi' : '1 km', lengthM: slice },
    { id: '5k', label: imperial ? '5 mi' : '5 km', lengthM: slice * 5 },
    { id: 'waypoints', labelKey: 'modeWaypoint' },
    { id: 'custom', labelKey: 'modeCustom' },
  ];
}
/** Custom length bounds and step, expressed in the active unit. */
const CUSTOM_MIN = 0.5;
const CUSTOM_MAX = 200;
/** Custom slice length in meters — the stored truth; the input converts. */
let customLenM = 10_000;

/** Row type capsule: classification → Lucide icon and label key. */
const TYPE_ICONS = {
  climb: 'trending-up',
  descent: 'trending-down',
  flat: 'move-right',
  mixed: 'move-vertical',
};
const TYPE_LABEL_KEYS = {
  climb: 'segmentTypeClimb',
  descent: 'segmentTypeDescent',
  flat: 'segmentTypeFlat',
  mixed: 'segmentTypeMixed',
};

let button = null;
let bodyEl = null;
let mode = '1k';

/** Extra radius (px) around a row's chevron that still counts as a toggle
 *  tap — same fat-finger scheme as the metrics hint buttons. */
const CHEVRON_HIT_EXTEND_PX = 30;

/** Wires the header button: hidden until a track is loaded. */
export function initAutoSegments(autoSegmentsButton) {
  button = autoSegmentsButton;
  bodyEl = document.getElementById('sheet-body');
  button.hidden = true;
  button.addEventListener('click', openSegmentsSheet);
  // Fat-finger tolerance around each row's chevron (see handleChevronTaps).
  document.addEventListener('click', handleChevronTaps);
  trackStore.subscribe((track) => {
    button.hidden = !track;
  });
}

/**
 * @private A click landing within the chevron's half box + 30 px toggles its
 * row — nearest chevron wins, zero-size rects (closed sheet) are skipped.
 * Clicks that already landed on a row are left to the row's own handler, so
 * the extension only claims dead zones around the icon.
 */
function handleChevronTaps(e) {
  if (e.target.closest('.seg-row')) return;
  let best = null;
  let bestDist = Infinity;
  for (const el of document.querySelectorAll('.seg-list .seg-chevron')) {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    if (d <= Math.max(r.width, r.height) / 2 + CHEVRON_HIT_EXTEND_PX && d < bestDist) {
      best = el;
      bestDist = d;
    }
  }
  best?.closest('.seg-row')?.click();
}

/** @private */
function openSegmentsSheet() {
  const track = trackStore.get();
  if (!track) return;
  render(track);
  openSheet(t('segmentsList'));
}

/** @private Rebuilds toolbar + list; keeps working across live switches. */
function render(track) {
  bodyEl.replaceChildren(buildToolbar(track), buildList(track));
}

/** @private Mode chips + the custom-length input. */
function buildToolbar(track) {
  const bar = document.createElement('div');
  bar.className = 'seg-toolbar';
  for (const m of toolbarModes()) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'seg-chip';
    chip.textContent = m.labelKey ? t(m.labelKey) : m.label;
    chip.setAttribute('aria-pressed', String(mode === m.id));
    if (m.id === 'grade' && !track.hasElevation) {
      chip.disabled = true;
      chip.title = t('noElevationData');
    }
    if (m.id === 'waypoints' && !(track.waypoints || []).length) {
      chip.disabled = true;
      chip.title = t('noWaypointData');
    }
    chip.addEventListener('click', () => {
      if (mode === m.id) return;
      mode = m.id;
      render(track);
    });
    bar.appendChild(chip);
  }
  if (mode === 'custom') {
    const wrap = document.createElement('label');
    wrap.className = 'seg-custom';
    wrap.append(
      document.createTextNode(t('customSegmentLength')),
      buildCustomInput(),
      // The input speaks the active distance unit — labelled so the number
      // is never ambiguous (unit switches re-render and convert it).
      Object.assign(document.createElement('span'), {
        className: 'seg-custom-unit',
        textContent: distanceUnit(),
      }),
    );
    bar.appendChild(wrap);
  }
  return bar;
}

/** @private Custom slice length in the active unit; applies on change. */
function buildCustomInput() {
  const imperial = getUnitSystem() === 'imperial';
  const metersPerUnit = imperial ? METERS_PER_MILE : 1000;
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'num';
  input.min = String(CUSTOM_MIN);
  input.max = String(CUSTOM_MAX);
  input.step = '0.5';
  // Data-entry boundary: number inputs read machine-format values only
  // (canonical dot decimals), never display-formatted strings.
  input.value = String(Math.round((customLenM / metersPerUnit) * 100) / 100);
  input.addEventListener('change', () => {
    const value = Number.parseFloat(input.value);
    if (Number.isFinite(value)) {
      customLenM = Math.min(CUSTOM_MAX, Math.max(CUSTOM_MIN, value)) * metersPerUnit;
    }
    render(trackStore.get());
  });
  return input;
}

/** @private The accordion list of segment ranges. */
function buildList(track) {
  const ranges = currentRanges(track);
  const list = document.createElement('div');
  list.className = 'seg-list';
  const hasHr = track.points.some((p) => p.hr != null);
  ranges.forEach((range, i) => list.appendChild(buildItem(track, range, i + 1, hasHr)));
  return list;
}

/** @private */
function currentRanges(track) {
  if (mode === 'grade') return splitByGrade(track) || [];
  if (mode === 'waypoints') return splitByWaypoints(track) || [];
  const selected = toolbarModes().find((m) => m.id === mode);
  const lengthM = selected.id === 'custom' ? customLenM : selected.lengthM;
  return splitByLength(track.totalDistance, lengthM);
}

/**
 * @private One accordion item: the summary row (chevron, name, range, time,
 * pace, heart rate) plus the collapsible detail panel. Expanding a row moves
 * the main sector onto the segment so map, profile and metrics follow.
 */
function buildItem(track, range, index, hasHr) {
  const item = document.createElement('div');
  item.className = 'seg-item';

  const m = computeSectorMetrics(track, range.start, range.end);
  const detailsId = `seg-details-${index}`;
  // Waypoint mode titles rows after the real place at the segment's start
  // boundary (a named waypoint); the first segment starts at the track start
  // itself and is titled accordingly. Every other mode counts. Waypoint
  // names come from the parsed file — escaped before touching innerHTML.
  const rawName = mode === 'waypoints' ? range.name : null;
  const name = rawName ? escapeHtml(rawName)
    : mode === 'waypoints' && index === 1 ? t('trackStart')
    : t('segmentN', { n: index });

  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'seg-row';
  row.setAttribute('aria-expanded', 'false');
  row.setAttribute('aria-controls', detailsId);
  // Type capsule after the range: icon-only pill on wide screens, icon +
  // text label on narrow (bottom-sheet) screens; hidden without elevation
  // data — a dash is not a reading here either. The time/pace/HR cluster
  // rides in one container so the narrow two-line grid can move it as a
  // block under the range's start.
  const type = segmentType(m.gain, m.loss, m.netElevation);
  const typeLabel = type ? t(TYPE_LABEL_KEYS[type]) : null;
  // Pace and heart rate wear the profile overlay series colors (speed blue,
  // HR red) so a row reading matches the chart's overlay curves; missing
  // data stays muted — a dash is not a reading.
  row.innerHTML = `
    <span class="seg-chevron">${icon('chevron-down')}</span>
    <span class="seg-name">${name}</span>
    <span class="seg-range num">${formatDistanceShort(range.start)} → ${formatDistanceShort(range.end)}</span>
    ${type ? `<span class="seg-type seg-type-${type}" role="img" aria-label="${typeLabel}" title="${typeLabel}">${icon(TYPE_ICONS[type])}<span class="seg-type-label">${typeLabel}</span></span>` : ''}
    <span class="seg-stats"><span class="seg-stat num">${formatDuration(m.elapsed ?? NaN)}</span><span class="seg-stat num${m.avgPace != null ? ' seg-stat-pace' : ''}">${formatPace(m.avgPace ?? NaN)}</span>${hasHr ? `<span class="seg-stat num${m.avgHr != null ? ' seg-stat-hr' : ''}">${formatBpm(m.avgHr ?? NaN)}</span>` : ''}</span>
  `;
  row.addEventListener('click', () => {
    const open = item.classList.toggle('open');
    row.setAttribute('aria-expanded', String(open));
    item.querySelector(`#${detailsId}`).hidden = !open;
    if (open) setRange(range.start, range.end);
  });

  const details = document.createElement('div');
  details.className = 'seg-details';
  details.id = detailsId;
  details.hidden = true;
  // The metrics panel's row builder: same hover tooltip per entry as the
  // main panel (methodology note), same missing-data dash. The Heart Rate
  // Zones group is computed over THIS segment's range, not the main sector.
  details.innerHTML = `
    <div class="seg-details-title">${t('segmentDetails')}</div>
    ${metricRow(t('threeDDistance'), formatDistance(m.distance3D ?? NaN), false, t('threeDDistanceHint'))}
    ${metricRow(t('effortDistance'), formatDistance(m.effortDistance ?? NaN), false, t('effortDistanceHint'))}
    ${metricRow(t('elevationGain'), formatElevation(m.gain ?? NaN), false, t('elevationGainHint'))}
    ${metricRow(t('elevationLoss'), m.loss == null ? '—' : formatElevation(m.loss), false, t('elevationLossHint'))}
    ${metricRow(t('avgGap'), formatPace(m.avgGap ?? NaN), false, t('gapNote'))}
    ${metricRow(t('vam'), formatVam(m.vam ?? NaN), false, t('pauseNote'))}
    ${metricRow(t('vdm'), formatVam(m.vdm ?? NaN), false, t('pauseNote'))}
    ${hrZonesGroupHtml(track, range.start, range.end)}
  `;

  item.append(row, details);
  return item;
}

/** @private Minimal HTML escaping for file-sourced strings in innerHTML. */
function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

// Live language / unit switches re-render the open sheet in place.
on('language:changed', () => {
  const track = trackStore.get();
  if (!track || !button.isConnected) return;
  if (document.getElementById('sheet').open && bodyEl.querySelector('.seg-list')) {
    setSheetTitle(t('segmentsList'));
    render(track);
  }
});
on('units:changed', () => {
  const track = trackStore.get();
  if (!track) return;
  if (document.getElementById('sheet').open && bodyEl.querySelector('.seg-list')) {
    render(track);
  }
});
