/**
 * Right-side settings drawer — the single entry point for the heart-rate
 * zones editor, appearance, language and units on every viewport. It
 * replaces the former header popovers and the mobile-only settings sheet, so
 * there is exactly one settings surface to keep in sync. (The basemap picker
 * lives on the map, next to its controls — main.js wires it with ui/menus.js.)
 *
 * Built on <dialog>: showModal() provides the top layer, Escape handling and
 * focus containment for free; a click on the ::backdrop (which the browser
 * targets at the dialog element itself) closes it. All groups render
 * expanded, picks apply immediately and the drawer stays open. Sections
 * re-render after every pick — and on language change while open — so
 * checkmarks and labels never go stale; keyboard focus follows the
 * re-rendered row via its data-value.
 */
import { t } from '../language/language.js';
import { icon } from './icons.js';
import { renderOptionList } from './menus.js';
import { on } from '../core/events.js';
import {
  buildThemeItems, pickTheme,
  buildLanguageItems, pickLanguage,
  buildUnitItems, pickUnit,
} from './optionLists.js';
import { openHeartZonesDialog } from './heartZonesDialog.js';
import { openStoryDialog } from './storyDialog.js';
import {
  loadHeartRateSettings,
} from '../metrics/heartRateSettings.js';
import {
  getHeartRateDisplay, setHeartRateDisplay,
} from '../metrics/heartRateDisplay.js';

let dialog = null;
let bodyEl = null;
let closeBtn = null;
let trigger = null;

/** Wires the settings drawer dialog and its header trigger. */
export function initDrawer(drawerDialog, triggerButton) {
  dialog = drawerDialog;
  trigger = triggerButton;
  bodyEl = dialog.querySelector('#drawer-body');
  closeBtn = dialog.querySelector('#drawer-close');

  closeBtn.innerHTML = icon('x');
  closeBtn.setAttribute('aria-label', t('close'));

  trigger.addEventListener('click', openDrawer);
  closeBtn.addEventListener('click', () => dialog.close());
  // Clicks on the ::backdrop land on the dialog element itself; anything
  // inside the panel targets a child node.
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => {
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus();
  });
  on('language:changed', () => {
    closeBtn.setAttribute('aria-label', t('close'));
    if (dialog.open) renderSections();
  });
  // Zone edits (mode / boundaries / base heart rates) happen in the dialog
  // on top of the still-open drawer — re-render so the heart-rate section's
  // mode hint never goes stale behind it.
  on('hrzones:changed', () => {
    if (dialog.open) renderSections();
  });
}

/** @private */
function openDrawer() {
  renderSections();
  trigger.setAttribute('aria-expanded', 'true');
  dialog.showModal();
  // showModal() parks focus on the dialog itself; the first option is where
  // keyboard users want to land in a panel that is all options.
  dialog.querySelector('.menu-item')?.focus();
}

/**
 * Rebuilds the setting sections. Keyboard focus is restored to the row
 * holding the same data-value across the rebuild — the freshly picked (or
 * language-changed) node is a new element the old focus does not survive.
 */
function renderSections() {
  const refocusValue = document.activeElement?.dataset?.value;
  bodyEl.replaceChildren(
    heartRateZonesSection(),
    section('appearance', buildThemeItems, pickTheme),
    section('language', buildLanguageItems, pickLanguage),
    section('units', buildUnitItems, pickUnit),
    aboutSection(),
  );
  if (refocusValue) {
    bodyEl.querySelector(`[data-value="${CSS.escape(refocusValue)}"]`)?.focus();
  }
}

/**
 * @private The heart-rate zones section — the zone editor entry (an action
 * row, not a radio pick: it opens the zone editor dialog on top of the
 * drawer, which stays open so the user returns straight into their other
 * settings; its hint shows the active zone mode) plus the two profile
 * display toggles from heartRateDisplay.js. Toggling re-renders the whole
 * drawer so the highlight row's disabled state always follows showZones.
 */
function heartRateZonesSection() {
  const wrap = document.createElement('div');
  wrap.className = 'drawer-section';
  const heading = document.createElement('h3');
  heading.className = 'drawer-section-title';
  heading.textContent = t('hrZones');
  wrap.appendChild(heading);

  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'menu-item';
  row.dataset.value = 'hr-zones';
  row.setAttribute('aria-haspopup', 'dialog');
  const ic = document.createElement('span');
  ic.className = 'menu-item-icon';
  ic.innerHTML = icon('heart-pulse');
  row.appendChild(ic);
  const label = document.createElement('span');
  label.className = 'menu-item-label';
  label.textContent = t('hrZonesSettings');
  row.appendChild(label);
  const hint = document.createElement('span');
  hint.className = 'menu-item-hint';
  hint.textContent = t(`hrMode${{ max: 'Max', hrr: 'Hrr', lthr: 'Lthr' }[loadHeartRateSettings().mode]}`);
  row.appendChild(hint);
  row.addEventListener('click', openHeartZonesDialog);
  wrap.appendChild(row);

  const display = getHeartRateDisplay();
  wrap.appendChild(toggleRow('showHrZones', 'hr-zones-show', display.showZones, false, () => {
    setHeartRateDisplay({ showZones: !getHeartRateDisplay().showZones });
    renderSections();
  }));
  // The highlight only does anything while the bands are drawn, so its row
  // is unclickable whenever showZones is off; the stored highlight choice
  // is kept and comes back with the bands.
  wrap.appendChild(toggleRow('hrZoneHighlight', 'hr-zones-highlight', display.highlight, !display.showZones, () => {
    setHeartRateDisplay({ highlight: !getHeartRateDisplay().highlight });
    renderSections();
  }));
  return wrap;
}

/**
 * @private One boolean toggle row — the drawer's checkbox semantics: the
 * same .menu-item anatomy as the option rows (label + accent check mark,
 * aria-checked drives the shared checked styling). `disabled` greys the
 * row out and makes it unclickable. Callers re-render after toggling.
 */
function toggleRow(labelKey, value, checked, disabled, onToggle) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'menu-item';
  row.dataset.value = value;
  row.setAttribute('role', 'checkbox');
  row.setAttribute('aria-checked', String(checked));
  row.disabled = disabled;
  const label = document.createElement('span');
  label.className = 'menu-item-label';
  label.textContent = t(labelKey);
  row.appendChild(label);
  if (checked) {
    const check = document.createElement('span');
    check.className = 'menu-item-check';
    check.innerHTML = icon('check');
    row.appendChild(check);
  }
  row.addEventListener('click', onToggle);
  return row;
}

/** @private One titled option group; picking applies at once and re-renders. */
function section(titleKey, buildItems, onPick) {
  const wrap = document.createElement('div');
  wrap.className = 'drawer-section';
  const heading = document.createElement('h3');
  heading.className = 'drawer-section-title';
  heading.textContent = t(titleKey);
  wrap.appendChild(heading);
  wrap.appendChild(renderOptionList(buildItems(), (value) => {
    onPick(value);
    renderSections();
  }));
  return wrap;
}

/**
 * @private The About section — the author's story entry. An action row like
 * the zone editor's: it opens the story dialog on top of the drawer, which
 * stays open so the user returns straight into their other settings.
 */
function aboutSection() {
  const wrap = document.createElement('div');
  wrap.className = 'drawer-section';
  const heading = document.createElement('h3');
  heading.className = 'drawer-section-title';
  heading.textContent = t('aboutSection');
  wrap.appendChild(heading);

  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'menu-item';
  row.dataset.value = 'story';
  row.setAttribute('aria-haspopup', 'dialog');
  row.setAttribute('aria-expanded', 'false');
  const ic = document.createElement('span');
  ic.className = 'menu-item-icon';
  ic.innerHTML = icon('book-open');
  row.appendChild(ic);
  const label = document.createElement('span');
  label.className = 'menu-item-label';
  label.textContent = t('storyQuotes');
  row.appendChild(label);
  row.addEventListener('click', openStoryDialog);
  wrap.appendChild(row);
  return wrap;
}
