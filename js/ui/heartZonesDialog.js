/**
 * Heart-rate zones dialog — the Garmin-style zone editor opened from the
 * settings drawer (ui/drawer.js).
 *
 * The zones' bpm LOWER bounds are the editable truth: each row's input sets
 * where that zone begins, a zone ends where the next one begins, and zone 5
 * is open above its bound. The bpm range and the boundary percentage on the
 * left of each row are derived, read-only readouts — percentages are
 * computed from the active mode's base heart rate (MAX / HRR / LTHR) and
 * never edited. In LTHR mode zone 5 opens at the threshold itself (its
 * 100 %): its input is disabled and follows the LTHR field automatically.
 *
 * Everything valid applies and persists the moment it is committed (no save
 * button — like the drawer itself); invalid input is refused with an inline
 * error and the field reverts to the last saved value, so an illegal number
 * is never kept on screen or in storage. The body re-renders after every
 * commit and on live language switches, restoring focus to the field being
 * edited.
 */
import { t } from '../language/language.js';
import { icon } from './icons.js';
import { on } from '../core/events.js';
import {
  loadHeartRateSettings, saveHeartRateSettings, validateSettings,
  HR_LIMITS,
} from '../metrics/heartRateSettings.js';
import {
  computeZoneBounds, computeBoundaryPcts, zoneDisplayRange,
} from '../metrics/heartRateZones.js';
import { bpmUnit } from '../units/units.js';
import { formatBpmRange, formatPercent } from '../utils/format.js';

let dialog = null;
let bodyEl = null;
/** The settings on display — replaced wholesale after every commit. */
let settings = null;
/** data-key of the input to refocus after a re-render. */
let refocusKey = null;
/** Validation error key currently shown under the form ('' = none). */
let errorKey = '';

/** Mode chip definitions: id, label key, description key. */
const MODES = [
  { id: 'max', labelKey: 'hrModeMax', descKey: 'hrModeDescMax' },
  { id: 'hrr', labelKey: 'hrModeHrr', descKey: 'hrModeDescHrr' },
  { id: 'lthr', labelKey: 'hrModeLthr', descKey: 'hrModeDescLthr' },
];

/** Wires the dialog and its close button. Opened via openHeartZonesDialog(). */
export function initHeartZonesDialog(dialogEl) {
  dialog = dialogEl;
  bodyEl = dialog.querySelector('#hrzones-body');
  const closeBtn = dialog.querySelector('#hrzones-close');
  closeBtn.innerHTML = icon('x');
  closeBtn.setAttribute('aria-label', t('close'));
  closeBtn.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { refocusKey = null; errorKey = ''; });
  on('language:changed', () => {
    if (!dialog.open) return;
    settings = loadHeartRateSettings();
    errorKey = '';
    render();
  });
}

/** Opens the editor over the (still open) settings drawer. */
export function openHeartZonesDialog() {
  settings = loadHeartRateSettings();
  errorKey = '';
  render();
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

/** @private Full rebuild of the editor body. */
function render() {
  const bounds = computeZoneBounds(settings);
  const focusKey = refocusKey;
  refocusKey = null;

  const frag = document.createDocumentFragment();
  frag.appendChild(buildModeBar());
  frag.appendChild(buildDesc(MODES.find((m) => m.id === settings.mode).descKey));
  frag.appendChild(buildParams());
  frag.appendChild(buildZoneRows(bounds));
  frag.appendChild(buildHint());
  frag.appendChild(buildError());
  bodyEl.replaceChildren(frag);

  if (focusKey) {
    const input = bodyEl.querySelector(`[data-key="${CSS.escape(focusKey)}"]`);
    if (input) {
      input.focus();
      const len = input.value.length;
      try { input.setSelectionRange(len, len); } catch { /* number input quirks */ }
    }
  }
}

/** @private Commit a candidate: valid ones save + re-render, invalid ones
 *  only raise the inline error and restore the stored values. */
function commit(candidate, key) {
  const error = validateSettings(candidate);
  refocusKey = key;
  if (error) {
    errorKey = error;
  } else {
    errorKey = '';
    settings = candidate;
    saveHeartRateSettings(candidate);
  }
  render();
}

/** @private A field was left non-numeric: flag it and revert via re-render. */
function commitInvalid(key) {
  refocusKey = key;
  errorKey = 'hrZoneErrorInvalid';
  render();
}

/** @private Mode chips — like the auto-split toolbar. */
function buildModeBar() {
  const bar = document.createElement('div');
  bar.className = 'seg-toolbar hrzones-modes';
  for (const m of MODES) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'seg-chip';
    chip.textContent = t(m.labelKey);
    chip.setAttribute('aria-pressed', String(settings.mode === m.id));
    chip.addEventListener('click', () => {
      if (settings.mode === m.id) return;
      commit({ ...settings, mode: m.id }, null);
    });
    bar.appendChild(chip);
  }
  return bar;
}

/** @private One-line explanation of what the mode's percentages mean. */
function buildDesc(descKey) {
  const p = document.createElement('p');
  p.className = 'hrzones-desc';
  p.textContent = t(descKey);
  return p;
}

/** @private Base heart-rate inputs for the active mode.
 *
 *  MAX: max HR only. HRR: resting + max. LTHR: the LTHR alone — the mode
 *  derives every percentage from the threshold and never uses the resting
 *  HR. */
function buildParams() {
  const wrap = document.createElement('div');
  wrap.className = 'hrzones-params';
  if (settings.mode === 'max') {
    wrap.appendChild(paramRow('maxHR', t('maxHr'), settings.maxHR));
  } else if (settings.mode === 'hrr') {
    wrap.appendChild(paramRow('restingHR', t('hrRestLabel'), settings.restingHR));
    wrap.appendChild(paramRow('maxHR', t('maxHr'), settings.maxHR));
  } else {
    wrap.appendChild(paramRow('lthr', t('hrLthrLabel'), settings.lthr));
  }
  return wrap;
}

/** @private One label + bpm input row. */
function paramRow(key, label, value) {
  const row = document.createElement('label');
  row.className = 'hrzones-param';
  const name = document.createElement('span');
  name.className = 'hrzones-param-label';
  name.textContent = label;
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'num hrzones-input';
  input.inputMode = 'numeric';
  input.min = '1';
  input.max = String(HR_LIMITS.absoluteMax);
  input.step = '1';
  // Data-entry boundary: number inputs read machine-format values only —
  // String() of the raw bpm, never a locale- or display-formatted string.
  input.value = String(value);
  input.dataset.key = key;
  input.setAttribute('aria-label', label);
  wireInput(input, key, () => ({ ...settings, [key]: Math.round(Number(input.value)) }));
  row.append(name, input, unitSpan(bpmUnit()));
  return row;
}

/**
 * @private The five zone rows: label, bpm range, derived percentage range,
 * and the editable bpm lower bound.
 *
 * Each row's input is that zone's LOWER bound B_{i+1}; the bpm range reads
 * [B_{i+1}, B_{i+2} − 1] (zone 5 open above B5) and the percentage range
 * runs from pct(B_{i+1}) to pct(B_{i+2}) — zone 5 reads "pct(B5)%+". In
 * LTHR mode zone 5's bound IS the threshold (its 100 %), so its input is
 * disabled and mirrors the LTHR field.
 */
function buildZoneRows(bounds) {
  const list = document.createElement('div');
  list.className = 'hrzones-zones';
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', t('hrZones'));
  if (!bounds) return list;
  const pcts = computeBoundaryPcts(settings);
  const arrKey = settings.mode === 'lthr' ? 'lthr' : settings.mode;
  for (let i = 0; i < 5; i++) {
    const zone = bounds.zones[i];
    const row = document.createElement('div');
    row.className = 'hrzones-zone';

    const name = document.createElement('span');
    name.className = 'hrzones-zone-name';
    name.textContent = t('zoneN', { n: i + 1 });

    // bpm range — the whole bpm values that can fall inside the zone's
    // continuous interval [B, next B − 1]. Zone 5 is open.
    const d = zoneDisplayRange(zone);
    const range = document.createElement('span');
    range.className = 'hrzones-zone-range num';
    range.textContent = formatBpmRange(d.lo, d.hi);

    // Derived percentage range — read-only information, never an input.
    const pct = document.createElement('span');
    pct.className = 'hrzones-zone-pct num';
    pct.textContent = i === 4
      ? `(${formatPercent(pcts[i])}+)`
      : `(${formatPercent(pcts[i])}–${formatPercent(pcts[i + 1])})`;

    // The editable bpm lower bound. LTHR zone 5 follows the threshold.
    const fixed = settings.mode === 'lthr' && i === 4;
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'num hrzones-input';
    input.inputMode = 'numeric';
    input.min = '1';
    input.max = String(HR_LIMITS.absoluteMax);
    input.step = '1';
    input.value = String(fixed ? settings.lthr : settings.zones[arrKey][i]);
    input.dataset.key = `zone-${i}`;
    input.setAttribute('aria-label', t('zoneN', { n: i + 1 }));
    if (fixed) {
      input.disabled = true;
    } else {
      wireInput(input, `zone-${i}`, () => {
        const edges = [...settings.zones[arrKey]];
        edges[i] = Math.round(Number(input.value));
        return { ...settings, zones: { ...settings.zones, [arrKey]: edges } };
      });
    }
    row.append(name, range, pct, input, unitSpan(bpmUnit()));
    list.appendChild(row);
  }
  return list;
}

/** @private */
function unitSpan(text) {
  const span = document.createElement('span');
  span.className = 'hrzones-unit';
  span.textContent = text;
  return span;
}

/** @private Usage hint, mirroring Garmin's tip line. */
function buildHint() {
  const p = document.createElement('p');
  p.className = 'hrzones-desc';
  p.textContent = t('hrZonesHint');
  return p;
}

/** @private Inline validation error (aria-live). */
function buildError() {
  const p = document.createElement('p');
  p.className = 'hrzones-error';
  p.setAttribute('role', 'alert');
  if (errorKey) p.textContent = t(errorKey);
  return p;
}

/**
 * @private Wires one number input to a candidate builder. Commit-time only:
 * typing never triggers work; the change event validates and either saves
 * (recomputing every derived display) or refuses with the inline error.
 */
function wireInput(input, key, buildCandidate) {
  input.addEventListener('change', () => {
    const raw = input.value.trim();
    const num = Number(raw);
    if (raw === '' || !Number.isFinite(num)) {
      commitInvalid(key);
      return;
    }
    commit(buildCandidate(), key);
  });
}
