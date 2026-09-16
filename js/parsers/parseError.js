/**
 * A parsing failure carrying a translation key instead of user-facing text.
 * UI layers translate these through the language system.
 */
export class ParseError extends Error {
  /**
   * @param {string} key  i18n key describing the failure, e.g. "errorInvalidFile".
   * @param {string} [detail]  Technical detail for the console, never shown in the UI.
   */
  constructor(key, detail) {
    super(detail || key);
    this.name = 'ParseError';
    this.key = key;
  }
}

/** Well-known error keys, centralized so tests and UI stay in sync. */
export const PARSE_ERROR_KEYS = {
  invalid: 'errorInvalidFile',
  unsupported: 'errorUnsupportedType',
  noTrack: 'errorNoTrackPoints',
  kmzNoKml: 'errorKmzNoKml',
  readFailed: 'errorFileRead',
};
