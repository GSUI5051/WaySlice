/**
 * Reads a themed design token off :root (the values live in css/tokens.css).
 * For per-frame canvas drawing, cache getComputedStyle(documentElement)
 * yourself instead — one live lookup per frame, not per token.
 */

/**
 * @param {string} name  custom property name, e.g. '--accent'
 * @returns {string} the trimmed token value ('' when undefined)
 */
export function cssToken(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
