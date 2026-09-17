/**
 * Dual-variable analysis — entry module and orchestrator.
 *
 * The feature is a system of responsibility modules (this orchestrator plus
 * metrics / samples / densityCalculator / densityRenderer / interaction /
 * tooltip); callers only ever see initDualVariableAnalysis().
 *
 * What lives here: the entry button (hidden until a track is loaded), the
 * analysis dialog and its two views — variable selection with dynamic
 * constraints (Y only ever offers partners of the chosen X; quantities the
 * track lacks stay visible but disabled with their reason), then the result
 * view (chart, empty state, loading state, reselect). Also the external
 * event surface: language / unit / theme switches re-render live, a new
 * track invalidates the cached sample table.
 *
 * The state machine is deliberately small: selecting → analyzing →
 * displaying | empty. Illegal X/Y combinations cannot be built in the UI —
 * the Analyze button is only enabled for a valid pair, so no error path
 * exists for the user to hit.
 */
import { t } from '../../language/language.js';
import { icon } from '../../ui/icons.js';
import { trackStore } from '../../core/stores.js';
import { sectorStore } from '../../sector/sectorStore.js';
import { on } from '../../core/events.js';
import { METRICS, getMetric, isPairAllowed, partnersOf } from './metrics.js';
import { buildAnalysisSamples, metricAvailability, extractPair } from './samples.js';
import { computeDensity } from './densityCalculator.js';
import {
  initRenderer, setData, clearData, resize, render, refresh,
} from './densityRenderer.js';
import { wireInteraction, clearInteraction } from './interaction.js';
import { initTooltip, hideTooltip } from './tooltip.js';

let button = null;
let dialog = null;
let els = null; // the dialog's DOM assets, bound once in init

/** Current axis picks — kept across opens so a reselect starts warm. */
let xId = '';
let yId = '';
/** The loaded track's sample table + availability, cached per track. */
let samples = null;
let availability = null;
let samplesTrack = null;
/** The sector range the cached table was built for ({start, end} meters). */
let samplesRange = null;

/**
 * Wires the entry button and the analysis dialog.
 * @param {{button: HTMLButtonElement, dialog: HTMLDialogElement}} refs
 */
export function initDualVariableAnalysis(refs) {
  button = refs.button;
  dialog = refs.dialog;
  button.hidden = true;
  button.addEventListener('click', openDialog);

  els = {
    closeBtn: dialog.querySelector('#dualvar-close'),
    selectView: dialog.querySelector('#dualvar-select-view'),
    note: dialog.querySelector('#dualvar-select-note'),
    xSelect: dialog.querySelector('#dualvar-x'),
    ySelect: dialog.querySelector('#dualvar-y'),
    analyzeBtn: dialog.querySelector('#dualvar-analyze'),
    resultView: dialog.querySelector('#dualvar-result-view'),
    summary: dialog.querySelector('#dualvar-summary'),
    reselectBtn: dialog.querySelector('#dualvar-reselect'),
    chart: dialog.querySelector('#dualvar-chart'),
    canvas: dialog.querySelector('#dualvar-canvas'),
    empty: dialog.querySelector('#dualvar-empty'),
    loading: dialog.querySelector('#dualvar-loading'),
    body: dialog.querySelector('#dualvar-body'),
  };

  els.closeBtn.innerHTML = icon('x');
  els.closeBtn.setAttribute('aria-label', t('close'));
  els.closeBtn.addEventListener('click', () => dialog.close());
  // Clicks on the ::backdrop land on the dialog element itself — same
  // close-on-backdrop behavior as the settings drawer and zone editor.
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => {
    clearInteraction();
    button.focus();
  });

  els.xSelect.addEventListener('change', () => {
    xId = els.xSelect.value;
    // The old Y may be incompatible with the new X — clear it (spec §7.4).
    if (yId && !isPairAllowed(xId, yId)) yId = '';
    renderSelectView();
  });
  els.ySelect.addEventListener('change', () => {
    yId = els.ySelect.value;
    renderSelectView();
  });
  els.analyzeBtn.addEventListener('click', analyze);
  els.reselectBtn.addEventListener('click', () => {
    showSelectView();
    renderSelectView();
  });

  initRenderer(els.canvas, els.chart);
  // The tooltip's safe area is the WHOLE result container (the dialog's
  // scrollable body) — the plot area only resolves data coordinates.
  initTooltip(dialog, els.body);
  wireInteraction({ canvas: els.canvas, wrapper: els.chart }, () => (
    xId && yId ? { xDef: getMetric(xId), yDef: getMetric(yId) } : null
  ));

  if ('ResizeObserver' in window) {
    new ResizeObserver(() => {
      if (!dialog.open || els.resultView.hidden) return;
      resize();
      render();
    }).observe(els.chart);
  }

  trackStore.subscribe((track) => {
    button.hidden = !track;
    samples = null;
    availability = null;
    samplesTrack = null;
    samplesRange = null;
    if (dialog.open) dialog.close();
  });

  // The analysis reads the SELECTED SECTOR (like the metrics panel), so a
  // sector change invalidates the cached table. The dialog is modal — the
  // sector cannot move while it is open — so the open result stays as
  // analyzed; the next open/analyze reads the new range.
  sectorStore.subscribe(() => {
    samples = null;
    availability = null;
    samplesTrack = null;
    samplesRange = null;
    if (dialog.open) dialog.close();
  });

  on('language:changed', () => {
    els.closeBtn.setAttribute('aria-label', t('close'));
    if (!dialog.open) return;
    if (!els.selectView.hidden) renderSelectView();
    else refreshResultView();
  });
  on('units:changed', () => {
    if (!dialog.open || els.resultView.hidden) return;
    hideTooltip();
    refresh(); // ticks + labels re-render in the active unit system
  });
  on('theme:changed', () => {
    if (!dialog.open || els.resultView.hidden) return;
    refresh(); // the ramp is themed — rebuild LUT + bitmap, no re-analysis
  });
}

/** @private Opens the dialog on the selection view. */
function openDialog() {
  const track = trackStore.get();
  if (!track) return;
  showSelectView();
  renderSelectView();
  dialog.showModal();
  els.xSelect.focus();
}

/** @private View switch — the Analyze flow owns the other direction. */
function showSelectView() {
  els.selectView.hidden = false;
  els.resultView.hidden = true;
}

/** @private Rebuilds both selects with the dynamic constraints applied. */
function renderSelectView() {
  const avail = ensureAvailability();

  // Selections that the CURRENT track can no longer honor (a new file
  // without the sensor, a partner the filters erased) clear automatically —
  // the same no-dead-end rule as changing X, applied across track loads.
  if (xId && !avail[xId].available) {
    xId = '';
    yId = '';
  } else if (yId && (!avail[yId].available || !isPairAllowed(xId, yId))) {
    yId = '';
  }

  // X: every metric, disabled (with its reason) when the track lacks it.
  fillSelect(els.xSelect, xId, (id) => true, avail);
  // Y: only partners of the chosen X; an unchosen X leaves every metric.
  const partners = xId ? partnersOf(xId) : null;
  fillSelect(els.ySelect, yId, (id) => !partners || partners.includes(id), avail);

  // The Analyze button enables only for a complete legal pair — the UI
  // cannot produce an illegal one, so no validation error path exists.
  els.analyzeBtn.disabled = !(xId && yId && isPairAllowed(xId, yId));

  // A track with none of the quantities: say so instead of nine dead selects.
  const noneUsable = METRICS.every((m) => !avail[m.id].available);
  els.note.hidden = !noneUsable;
  if (noneUsable) els.note.textContent = t('dualVarNoData');
}

/**
 * @private One select's options: label, or label + reason while disabled.
 * Disabled options stay VISIBLE at reduced weight (spec §31) — the user
 * keeps seeing that WaySlice supports the quantity; this track lacks it.
 */
function fillSelect(select, current, include, avail) {
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '—';
  const parts = [placeholder];
  for (const metric of METRICS) {
    if (!include(metric.id)) continue;
    const option = document.createElement('option');
    option.value = metric.id;
    const info = avail[metric.id];
    if (info.available) {
      option.textContent = t(metric.labelKey);
    } else {
      option.textContent = `${t(metric.labelKey)} — ${t(info.reasonKey)}`;
      option.disabled = true;
    }
    parts.push(option);
  }
  select.replaceChildren(...parts);
  select.value = current;
  // A selection that just became illegal (new track, new X) reads as the
  // placeholder rather than silently pointing at a removed option.
  if (select.selectedIndex === -1) select.value = '';
}

/** @private The Analyze flow: loading paint, then compute off the click. */
function analyze() {
  if (!xId || !yId || !isPairAllowed(xId, yId)) return;
  const xDef = getMetric(xId);
  const yDef = getMetric(yId);

  els.selectView.hidden = true;
  els.resultView.hidden = false;
  els.empty.hidden = true;
  els.loading.hidden = false;
  renderSummary(xDef, yDef);
  clearData();

  // Double rAF: the loading state paints before the synchronous compute
  // blocks the frame, so a large track never reads as a dead button.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const pair = extractPair(ensureSamples(), xDef.id, yDef.id);
    const density = computeDensity(pair.xs, pair.ys);
    els.loading.hidden = true;
    if (!density) {
      // Not enough valid data — never an empty canvas (spec §19).
      clearData();
      els.empty.hidden = false;
      return;
    }
    setData(density, xDef, yDef);
    resize();
    render();
  }));
}

/** @private "Heart rate → Speed" — the arrow reads X → Y, chart axes confirm. */
function renderSummary(xDef, yDef) {
  els.summary.replaceChildren(
    document.createTextNode(t(xDef.labelKey)),
    Object.assign(document.createElement('span'), {
      className: 'dualvar-summary-arrow',
      'aria-hidden': 'true',
    }),
    document.createTextNode(t(yDef.labelKey)),
  );
  els.summary.querySelector('.dualvar-summary-arrow').innerHTML = icon('move-right');
}

/**
 * @private Re-renders the open result view after a language switch: axis
 * titles and tick labels redraw via refresh(), the summary re-joins in the
 * new language, the stale tooltip goes away.
 */
function refreshResultView() {
  hideTooltip();
  clearInteraction();
  renderSummary(getMetric(xId), getMetric(yId));
  refresh();
}

/** @private The selected sector's sample table, built lazily and cached. */
function ensureSamples() {
  const track = trackStore.get();
  const range = track ? sectorStore.get() : null;
  const stale = !samples
    || samplesTrack !== track
    || !range
    || !samplesRange
    || samplesRange.start !== range.start
    || samplesRange.end !== range.end;
  if (stale) {
    samples = buildAnalysisSamples(track, range ? range.start : 0, range ? range.end : 0);
    samplesTrack = track;
    samplesRange = range ? { start: range.start, end: range.end } : null;
    availability = null;
  }
  return samples;
}

/** @private The per-track availability map (same cache lifecycle). */
function ensureAvailability() {
  ensureSamples();
  if (!availability) availability = metricAvailability(samples, trackStore.get());
  return availability;
}
