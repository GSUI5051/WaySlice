/**
 * XML document parsing entry for the parsers — picks the platform DOMParser
 * on the main thread and the in-house mini parser (xmlMini.js) inside the
 * parse worker, where DOMParser does not exist. Both implement the same DOM
 * surface, so the parser modules below need no per-context branches.
 */
import { parseXmlMini } from '../workers/xmlMini.js';

/**
 * @param {string} text  XML document text
 * @returns {Document} platform Document or the structurally equivalent mini document
 */
export function parseXmlDocument(text) {
	if (typeof DOMParser !== 'undefined') {
		return new DOMParser().parseFromString(text, 'application/xml');
	}
	return parseXmlMini(text);
}
