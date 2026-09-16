/**
 * Option list builders for the two settings surfaces: the map-area basemap
 * menu (buildMapSourceItems, wired in main.js) and the settings drawer
 * (ui/drawer.js), so every list stays in sync with the stored preferences
 * from one place.
 */
import { groupedSources, getSavedSourceId } from '../map/sources.js';
import { setSourceById } from '../map/mapView.js';
import { getPreference, setPreference } from '../theme/theme.js';
import { getLanguages, setLanguage, t } from '../language/language.js';
import { getUnitSystem, setUnitSystem } from '../units/units.js';

/** Map source items, grouped like: Street / Outdoor / Satellite / Minimal. */
export function buildMapSourceItems() {
  const savedId = getSavedSourceId();
  const items = [];
  for (const group of groupedSources()) {
    items.push({ kind: 'label', label: t(group.groupKey) });
    for (const source of group.sources) {
      items.push({
        kind: 'option',
        value: source.id,
        label: t(source.labelKey),
        hint: source.hintKey ? t(source.hintKey) : undefined,
        checked: source.id === savedId,
      });
    }
  }
  return items;
}

export function pickMapSource(id) {
  setSourceById(id);
}

/** Appearance items: System / Light / Dark with Monitor / Sun / Moon icons. */
export function buildThemeItems() {
  const pref = getPreference();
  return [
    { kind: 'option', value: 'system', icon: 'monitor', label: t('system'), checked: pref === 'system' },
    { kind: 'option', value: 'light', icon: 'sun', label: t('light'), checked: pref === 'light' },
    { kind: 'option', value: 'dark', icon: 'moon', label: t('dark'), checked: pref === 'dark' },
  ];
}

export function pickTheme(value) {
  setPreference(/** @type {'system'|'light'|'dark'} */ (value));
}

/** Language items with native names. */
export function buildLanguageItems() {
  return getLanguages().map((lang) => ({
    kind: 'option',
    value: lang.code,
    label: lang.nativeName,
    checked: lang.current,
  }));
}

export function pickLanguage(code) {
  setLanguage(code);
}

export function buildUnitItems() {
  const current = getUnitSystem();
  return [
    { kind: 'option', value: 'metric', label: t('metric'), hint: t('metricUnitHint'), checked: current === 'metric' },
    { kind: 'option', value: 'imperial', label: t('imperial'), hint: t('imperialUnitHint'), checked: current === 'imperial' },
  ];
}

export function pickUnit(system) {
  setUnitSystem(system);
}
