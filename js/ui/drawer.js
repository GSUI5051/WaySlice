/**
 * Right-side settings drawer — the single entry point for the heart-rate
 * zones editor, appearance, language and units on every viewport. It
 * replaces the former header popovers and the mobile-only settings sheet, so
 * there is exactly one settings surface to keep in sync. (The basemap picker
 * lives on the map, next to its controls — main.js wires it with ui/menus.js.)
 *
 * Built on <dialog>: showModal() provides the top layer, Escape handling and
 * focus containment for free; a click on the ::backdrop (which the browser
 * targets at the dialog element itself) closes it. Sections are accordion
 * groups: every group toggles independently (several can be open at once)
 * and all start collapsed on each open; picks apply immediately and the
 * drawer stays open. Sections re-render after every pick — and on language
 * change while open — so checkmarks and labels never go stale; keyboard
 * focus follows the re-rendered row via its data-value.
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
/** Accordion state — the section keys whose group is expanded. Lives across
 *  re-renders (picks and language switches rebuild every section) and resets
 *  on each open, so the drawer always starts fully collapsed. */
const openSections = new Set();

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
  openSections.clear();
  renderSections();
  trigger.setAttribute('aria-expanded', 'true');
  dialog.showModal();
  // showModal() parks focus on the dialog itself; with every group collapsed
  // the first accordion trigger is where keyboard users want to land.
  dialog.querySelector('.drawer-acc-trigger')?.focus();
}

/**
 * Rebuilds the setting sections. Keyboard focus is restored to the row
 * holding the same data-value across the rebuild — the freshly picked (or
 * language-changed) node is a new element the old focus does not survive.
 */
function renderSections() {
  const refocusValue = document.activeElement?.dataset?.value;
  bodyEl.replaceChildren(
    accordionSection('heart-rate', 'hrZones', heartRateContent),
    accordionSection('appearance', 'appearance', () =>
      renderOptionList(buildThemeItems(), (value) => { pickTheme(value); renderSections(); })),
    accordionSection('language', 'language', () =>
      renderOptionList(buildLanguageItems(), (value) => { pickLanguage(value); renderSections(); })),
    accordionSection('units', 'units', () =>
      renderOptionList(buildUnitItems(), (value) => { pickUnit(value); renderSections(); })),
    accordionSection('about', 'aboutSection', aboutContent),
  );
  if (refocusValue) {
    bodyEl.querySelector(`[data-value="${CSS.escape(refocusValue)}"]`)?.focus();
  }
}

/**
 * @private One accordion group: a full-width trigger row (the section title
 * plus a chevron that flips between Lucide's chevron-down when collapsed and
 * chevron-up when expanded) above its content. Clicking toggles just this
 * group in place — no re-render, so the height animation runs — while picks
 * inside still rebuild everything with the group's stored state.
 *
 * Anatomy follows the ARIA accordion pattern: the trigger is an
 * aria-expanded button inside the heading, the collapsible body is a
 * labelled region. The body stays in the DOM when collapsed (the height
 * collapse is CSS); `visibility: hidden` there keeps its rows out of the
 * Tab order while closed.
 */
function accordionSection(key, titleKey, buildContent) {
  const open = openSections.has(key);
  const wrap = document.createElement('div');
  wrap.className = 'drawer-section drawer-acc';
  if (open) wrap.setAttribute('data-open', '');

  const heading = document.createElement('h3');
  const triggerBtn = document.createElement('button');
  triggerBtn.type = 'button';
  triggerBtn.className = 'drawer-acc-trigger';
  triggerBtn.id = `drawer-trigger-${key}`;
  triggerBtn.dataset.value = `sec-${key}`;
  triggerBtn.setAttribute('aria-expanded', String(open));
  triggerBtn.setAttribute('aria-controls', `drawer-panel-${key}`);
  const label = document.createElement('span');
  label.className = 'drawer-section-title';
  label.textContent = t(titleKey);
  triggerBtn.appendChild(label);
  // Both chevron states render up front; drawer.css picks the visible one
  // from [data-open], so toggling never touches the markup.
  const chev = document.createElement('span');
  chev.className = 'drawer-acc-chev';
  chev.innerHTML =
    `<span class="drawer-acc-chev-down">${icon('chevron-down')}</span>` +
    `<span class="drawer-acc-chev-up">${icon('chevron-up')}</span>`;
  triggerBtn.appendChild(chev);
  triggerBtn.addEventListener('click', () => {
    const nowOpen = !openSections.has(key);
    if (nowOpen) openSections.add(key);
    else openSections.delete(key);
    wrap.toggleAttribute('data-open', nowOpen);
    triggerBtn.setAttribute('aria-expanded', String(nowOpen));
  });
  heading.appendChild(triggerBtn);
  wrap.appendChild(heading);

  const body = document.createElement('div');
  body.className = 'drawer-acc-body';
  body.id = `drawer-panel-${key}`;
  body.setAttribute('role', 'region');
  body.setAttribute('aria-labelledby', triggerBtn.id);
  const inner = document.createElement('div');
  inner.className = 'drawer-acc-inner';
  inner.appendChild(buildContent());
  body.appendChild(inner);
  wrap.appendChild(body);
  return wrap;
}

/**
 * @private The heart-rate group's content — the zone editor entry (an action
 * row, not a radio pick: it opens the zone editor dialog on top of the
 * drawer, which stays open so the user returns straight into their other
 * settings; its hint shows the active zone mode) plus the two profile
 * display toggles from heartRateDisplay.js. Toggling re-renders the whole
 * drawer so the highlight row's disabled state always follows showZones.
 */
function heartRateContent() {
  const frag = document.createDocumentFragment();

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
  frag.appendChild(row);

  const display = getHeartRateDisplay();
  frag.appendChild(toggleRow('showHrZones', 'hr-zones-show', display.showZones, false, () => {
    setHeartRateDisplay({ showZones: !getHeartRateDisplay().showZones });
    renderSections();
  }));
  // The highlight only does anything while the bands are drawn, so its row
  // is unclickable whenever showZones is off; the stored highlight choice
  // is kept and comes back with the bands.
  frag.appendChild(toggleRow('hrZoneHighlight', 'hr-zones-highlight', display.highlight, !display.showZones, () => {
    setHeartRateDisplay({ highlight: !getHeartRateDisplay().highlight });
    renderSections();
  }));
  return frag;
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

/**
 * @private The About group's content — the author's story, changelog and
 * privacy entries. Action rows like the zone editor's: each opens the story
 * dialog (the changelog and privacy entries pass their page) on top of the
 * drawer, which stays open so the user returns straight into their other
 * settings.
 */
function aboutContent() {
  const frag = document.createDocumentFragment();

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
  frag.appendChild(row);

  // The changelog entry shares the story dialog's window; its page content
  // stays English-only, like the story content itself.
  const changelog = document.createElement('button');
  changelog.type = 'button';
  changelog.className = 'menu-item';
  changelog.dataset.value = 'changelog';
  changelog.setAttribute('aria-haspopup', 'dialog');
  changelog.setAttribute('aria-expanded', 'false');
  const cic = document.createElement('span');
  cic.className = 'menu-item-icon';
  cic.innerHTML = icon('file-clock');
  changelog.appendChild(cic);
  const clabel = document.createElement('span');
  clabel.className = 'menu-item-label';
  clabel.textContent = t('changelog');
  changelog.appendChild(clabel);
  changelog.addEventListener('click', () => openStoryDialog('changelog'));
  frag.appendChild(changelog);

  // The privacy entry shares the story dialog's window; its page content
  // stays English-only, like the story content itself.
  const privacy = document.createElement('button');
  privacy.type = 'button';
  privacy.className = 'menu-item';
  privacy.dataset.value = 'privacy';
  privacy.setAttribute('aria-haspopup', 'dialog');
  privacy.setAttribute('aria-expanded', 'false');
  const pic = document.createElement('span');
  pic.className = 'menu-item-icon';
  pic.innerHTML = icon('shield-check');
  privacy.appendChild(pic);
  const plabel = document.createElement('span');
  plabel.className = 'menu-item-label';
  plabel.textContent = t('privacy');
  privacy.appendChild(plabel);
  privacy.addEventListener('click', () => openStoryDialog('privacy'));
  frag.appendChild(privacy);
  return frag;
}
