/**
 * Minimal HTML escaping for file-sourced strings interpolated into
 * innerHTML (waypoint names, segment labels): & < > " ' — the five
 * characters that can break out of text content or a double-quoted
 * attribute. export/xmlEscape is a separate, deliberately smaller set:
 * its XML output is generated, not file-sourced.
 */

/**
 * @param {string} text
 * @returns {string}
 */
export function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
