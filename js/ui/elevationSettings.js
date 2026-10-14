/**
 * Elevation correction settings — the "Track data" group inside the settings
 * drawer. This is the ONLY entry point for the feature (no map/profile
 * buttons), and it owns the section's live DOM: the drawer rebuilds its
 * sections on open/pick/language change through content(), while state
 * changes while the drawer sits open repaint just this section's root, so
 * progress ticks never rebuild the drawer around it.
 *
 * States: idle (action rows) → running (tile progress + cancel) → result
 * (applied/restored/cancelled/failed notes). "Replace" asks for an inline
 * confirmation first — it overwrites recorded elevations, and the user must
 * see that DEM values can differ before it runs. Every state re-renders
 * from trackStore (no track → disabled rows + hint; corrected track →
 * restore row), and a genuinely new track resets the notes.
 */
import { t } from '../language/language.js';
import { icon } from './icons.js';
import { trackStore } from '../core/stores.js';
import {
  runElevationFix, cancelElevationFix, restoreOriginalElevations,
} from '../elevation/elevationFix.js';
import { DEM_SOURCE } from '../elevation/terrain.js';
import { formatInt } from '../utils/format.js';

/** @typedef {{phase:'idle'}|
 *             {phase:'confirm'}|
 *             {phase:'running', mode:'fill'|'replace', done:number, total:number}|
 *             {phase:'result', kind:'applied'|'restored'|'cancelled'|'failed-all'|
 *                                 'nothing-to-fill'|'error'|'superseded',
 *              mode?:'fill'|'replace', applied?:number, failed?:number}} EleUiState */

/** @type {EleUiState} */
let uiState = { phase: 'idle' };
let root = null;
/** The running phase's progress line — updated in place, no rebuild. */
let progressLine = null;

let wired = false;

/** Subscribes the section to track and language updates (once). */
export function initElevationSettings() {
  if (wired) return;
  wired = true;
  let wiredPoints = null;
  trackStore.subscribe((track) => {
    const points = track?.points ?? null;
    if (points !== wiredPoints) {
      // A new file (or the empty state): the old track's correction notes
      // describe data that is no longer on screen.
      wiredPoints = points;
      uiState = { phase: 'idle' };
      progressLine = null;
    }
    paint();
  });
}

/**
 * Builds the section's content for the drawer. Each build registers a fresh
 * root; state changes while this root is connected repaint into it.
 * @returns {DocumentFragment}
 */
export function elevationContent() {
  const frag = document.createDocumentFragment();
  root = document.createElement('div');
  root.className = 'ele-fix';
  frag.appendChild(root);
  paint();
  return frag;
}

/** @private Renders the current state into the section's root. The root is
 *  re-registered by every elevationContent() build, so this always paints
 *  the freshest root — connected or not (the drawer builds its sections
 *  before inserting them, and an orphaned older root is harmless). */
function paint() {
  if (!root) return;
  progressLine = null;
  root.replaceChildren(
    note(t('eleIntro'), 'ele-intro'),
    ...stateNodes(),
    attribution(),
  );
}

/** @private The state-specific block between intro and attribution. */
function stateNodes() {
  const track = trackStore.get();
  const nodes = [];
  switch (uiState.phase) {
    case 'confirm':
      nodes.push(note(t('eleReplaceWarn'), 'ele-warn'));
      nodes.push(actionRow(
        { label: t('eleCancel'), value: 'ele-confirm-cancel', ghost: true, action: () => { uiState = { phase: 'idle' }; paint(); } },
        { label: t('eleConfirmReplace'), value: 'ele-confirm-replace', primary: true, action: () => start('replace') },
      ));
      return nodes;
    case 'running':
      nodes.push(note('', 'ele-progress'));
      progressLine = nodes[nodes.length - 1];
      progressLine.textContent = progressText();
      nodes.push(actionRow({
        label: t('eleCancel'), value: 'ele-cancel', ghost: true,
        action: () => {
          uiState = { phase: 'result', kind: 'cancelled' };
          cancelElevationFix();
          paint();
        },
      }));
      return nodes;
    case 'result':
      nodes.push(...resultNotes());
      break;
    default:
      break;
  }
  // Action rows (idle and result phases share them).
  nodes.push(actionRow({
    label: t('eleFill'), value: 'ele-fill', icon: 'mountain',
    disabled: !track || uiState.phase === 'running',
    action: () => start('fill'),
  }));
  nodes.push(actionRow({
    label: t('eleReplace'), value: 'ele-replace', icon: 'mountain',
    disabled: !track || uiState.phase === 'running',
    action: () => { uiState = { phase: 'confirm' }; paint(); },
  }));
  if (track?.eleOriginal) {
    nodes.push(actionRow({
      label: t('eleRestore'), value: 'ele-restore', icon: 'rotate-ccw',
      disabled: uiState.phase === 'running',
      action: () => {
        uiState = { phase: 'result', kind: 'restored' };
        restoreOriginalElevations();
        paint();
      },
    }));
  }
  if (!track) nodes.push(note(t('eleNeedTrack'), 'ele-warn'));
  return nodes;
}

/** @private The result phase's notes: mode + counts, partial failure made
 *  explicit, or the specific dead-end message. */
function resultNotes() {
  if (uiState.kind === 'applied') {
    const label = uiState.mode === 'fill' ? t('eleResultFill', { n: formatInt(uiState.applied ?? 0) })
      : t('eleResultReplace', { n: formatInt(uiState.applied ?? 0) });
    const notes = [note(label, 'ele-ok')];
    if ((uiState.failed ?? 0) > 0) {
      notes.push(note(t('eleResultFailed', { n: formatInt(uiState.failed ?? 0) }), 'ele-warn'));
    }
    return notes;
  }
  if (uiState.kind === 'restored') return [note(t('eleRestored'), 'ele-ok')];
  if (uiState.kind === 'cancelled') return [note(t('eleCancelled'))];
  if (uiState.kind === 'failed-all') return [note(t('eleFailedAll'), 'ele-warn')];
  if (uiState.kind === 'nothing-to-fill') return [note(t('eleNothingToFill'))];
  if (uiState.kind === 'error') return [note(t('eleErrorNote'), 'ele-warn')];
  return [];
}

/** @private Runs one correction, tracking tile progress. */
async function start(mode) {
  uiState = { phase: 'running', mode, done: 0, total: 0 };
  paint();
  const result = await runElevationFix(mode, {
    onProgress: ({ done, total }) => {
      if (uiState.phase !== 'running') return;
      uiState.done = done;
      uiState.total = total;
      // In-place text update — the running block must not rebuild under the
      // user's cursor (the cancel button would lose focus/hover every tick).
      if (progressLine?.isConnected) progressLine.textContent = progressText();
    },
  });
  // A superseded run says nothing: a newer run, a cancel or a new track has
  // already reset the section.
  if (result.status !== 'superseded') {
    uiState = {
      phase: 'result',
      kind: result.status,
      mode: result.mode,
      applied: result.applied,
      failed: result.failed,
    };
    paint();
  }
}

/** @private */
function progressText() {
  return t('eleProgress', {
    done: formatInt(uiState.phase === 'running' ? uiState.done : 0),
    total: formatInt(uiState.phase === 'running' ? uiState.total : 0),
  });
}

/* Building blocks ---------------------------------------------------------------- */

/** @private One small text note block. */
function note(text, extraClass = '') {
  const el = document.createElement('div');
  el.className = `ele-note${extraClass ? ` ${extraClass}` : ''}`;
  el.textContent = text;
  return el;
}

/** @private One full-width .menu-item action row (drawer row anatomy). */
function actionButton({ label, value, icon: iconName, disabled = false, action }) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'menu-item';
  row.dataset.value = value;
  row.disabled = disabled;
  if (iconName) {
    const ic = document.createElement('span');
    ic.className = 'menu-item-icon';
    ic.innerHTML = icon(iconName);
    row.appendChild(ic);
  }
  const text = document.createElement('span');
  text.className = 'menu-item-label';
  text.textContent = label;
  row.appendChild(text);
  row.addEventListener('click', action);
  return row;
}

/** @private A row of small buttons (confirm/cancel pairs). Single actions
 *  span the full menu-item width instead. */
function actionRow(...buttons) {
  if (buttons.length === 1) return actionButton(buttons[0]);
  const row = document.createElement('div');
  row.className = 'ele-actions';
  for (const cfg of buttons) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn btn-small ${cfg.primary ? 'btn-primary' : 'btn-ghost'}`;
    btn.dataset.value = cfg.value;
    btn.textContent = cfg.label;
    btn.addEventListener('click', cfg.action);
    row.appendChild(btn);
  }
  return row;
}

/** @private The tile source's required attribution. */
function attribution() {
  const el = document.createElement('div');
  el.className = 'ele-note ele-attrib';
  el.append(`${t('eleAttributionLabel')} `);
  const link = document.createElement('a');
  link.href = DEM_SOURCE.attributionUrl;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = DEM_SOURCE.attribution;
  el.appendChild(link);
  return el;
}
