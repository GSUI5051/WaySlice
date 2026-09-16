/**
 * Applies translations to static DOM: elements declare their key with
 * data-i18n (textContent), data-i18n-aria (aria-label) or data-i18n-title
 * (title). Re-run on every language change so switching is live.
 */
import { t } from '../language/language.js';

export function applyStaticTranslations(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of root.querySelectorAll('[data-i18n-aria]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  }
  for (const el of root.querySelectorAll('[data-i18n-title]')) {
    el.title = t(el.dataset.i18nTitle);
  }
}
