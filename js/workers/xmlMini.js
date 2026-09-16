/**
 * Minimal XML → mini-DOM parser for the parse worker.
 *
 * DOMParser is a window-only API and does not exist inside workers, but the
 * XML parsers (gpx/kml/tcx via xmlDocument.js) must run off-thread. This
 * module implements exactly the DOM surface they use — getElementsByTagName,
 * getElementsByTagNameNS('*', localName), getAttribute, children, localName,
 * textContent, documentElement — and nothing else. It is NOT a general XML
 * tool: no validation beyond well-formedness, no DTD/entity declarations
 * (only the five predefined + numeric entities), no namespace-URI tracking
 * (every lookup in this codebase uses '*').
 *
 * Well-formedness errors return a document whose root is <parsererror>,
 * mirroring the platform parser, so the existing error checks in gpx/kml/tcx
 * fire identically on both paths.
 */

class MiniElement {
	/** @param {string} tagName  qualified name, prefix included */
	constructor(tagName) {
		this.tagName = tagName;
		const colon = tagName.indexOf(':');
		this.localName = colon === -1 ? tagName : tagName.slice(colon + 1);
		/** @type {Map<string, string>} attribute name → entity-decoded value */
		this.attributes = new Map();
		/** Element and text children in document order (strings = text). */
		this.children = [];
		this._text = null;
	}

	getAttribute(name) {
		const value = this.attributes.get(name);
		return value === undefined ? null : value;
	}

	/** Concatenated descendant text (whitespace-only text nodes are dropped by the tokenizer). */
	get textContent() {
		if (this._text === null) {
			let out = '';
			for (const child of this.children) {
				out += typeof child === 'string' ? child : child.textContent;
			}
			this._text = out;
		}
		return this._text;
	}

	getElementsByTagName(name) {
		return collect(this, (el) => el.tagName === name);
	}

	getElementsByTagNameNS(_namespace, localName) {
		return collect(this, (el) => el.localName === localName);
	}
}

/** Document node — a detached container whose lookups span the whole tree. */
class MiniDocument extends MiniElement {
	constructor() {
		super('#document');
	}
	get documentElement() {
		return this.children.find((child) => typeof child !== 'string') ?? null;
	}
}

/** Pre-order collection of descendant elements matching `match`. @private */
function collect(node, match) {
	const out = [];
	const walk = (el) => {
		for (const child of el.children) {
			if (typeof child === 'string') continue;
			if (match(child)) out.push(child);
			walk(child);
		}
	};
	walk(node);
	return out;
}

/** A <parsererror> document, like the platform parser returns on bad input. @private */
function parsererrorDocument() {
	const doc = new MiniDocument();
	doc.children.push(new MiniElement('parsererror'));
	return doc;
}

const PREDEFINED_ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/**
 * Decodes the five predefined entities plus numeric references. Returns null
 * on anything the platform XML parser rejects as a reference — an unknown
 * named entity, an unterminated one, or a bare '&'. Null means "malformed
 * document", never "leave the text literal": platform parity is required so
 * the worker and the main-thread fallback accept exactly the same files.
 * @private
 * @returns {string | null}
 */
function decodeEntities(raw) {
	if (!raw.includes('&')) return raw;
	let out = '';
	for (let i = 0; i < raw.length; ) {
		const amp = raw.indexOf('&', i);
		if (amp === -1) {
			out += raw.slice(i);
			break;
		}
		const semi = raw.indexOf(';', amp + 1);
		if (semi === -1) return null;
		const body = raw.slice(amp + 1, semi);
		let decoded = null;
		if (body[0] === '#') {
			const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
			if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff) decoded = String.fromCodePoint(code);
		} else {
			decoded = PREDEFINED_ENTITIES[body] ?? null;
		}
		if (decoded === null) return null;
		out += raw.slice(i, amp) + decoded;
		i = semi + 1;
	}
	return out;
}

/** Whitespace-only text is dropped: it bloats big documents and every reader here trims anyway. @private */
function addText(stack, raw) {
	const text = decodeEntities(raw);
	if (text === null) return false;
	if (/\S/.test(text)) stack[stack.length - 1].children.push(text);
	return true;
}

/** Scans a quoted attribute value; returns the index after the closing quote or -1. @private */
function attributeValue(text, i) {
	const quote = text[i];
	if (quote !== '"' && quote !== "'") return -1;
	const close = text.indexOf(quote, i + 1);
	return close === -1 ? -1 : close + 1;
}

/**
 * Parses one open-tag body (between '<' and its '>') into an element with
 * attributes. `inherited` is the set of namespace prefixes declared by the
 * ancestors; prefixes used here must resolve against it plus any xmlns:*
 * declared on this very tag — undeclared prefixes are a well-formedness
 * error for the platform parser, so they are here too. Returns null on
 * syntax the platform parser would reject.
 * @private
 */
function parseOpenTag(body, inherited) {
	const nameMatch = /^([^\s/>]+)/.exec(body);
	if (!nameMatch) return null;
	const tagName = nameMatch[1];
	const attrs = [];
	let i = tagName.length;
	const len = body.length;
	while (i < len) {
		while (i < len && /\s/.test(body[i])) i++;
		if (i >= len) break;
		let j = i;
		while (j < len && !/\s/.test(body[j]) && body[j] !== '=') j++;
		const attrName = body.slice(i, j);
		if (!attrName) return null;
		i = j;
		while (i < len && /\s/.test(body[i])) i++;
		if (body[i] !== '=') return null; // XML requires quoted values — no bare attributes
		i++;
		const after = attributeValue(body, i);
		if (after === -1) return null;
		const value = decodeEntities(body.slice(i + 1, after - 1));
		if (value === null) return null;
		attrs.push([attrName, value]);
		i = after;
	}

	// Namespace prefixes: collect this tag's own xmlns:* declarations, then
	// validate the tag name and every prefixed attribute against the scope.
	let scope = inherited;
	for (const [name] of attrs) {
		if (name.startsWith('xmlns:')) {
			if (scope === inherited) scope = new Set(inherited);
			scope.add(name.slice(6));
		}
	}
	const tagColon = tagName.indexOf(':');
	if (tagColon !== -1 && !scope.has(tagName.slice(0, tagColon))) return null;
	for (const [name] of attrs) {
		const colon = name.indexOf(':');
		if (colon !== -1 && name.slice(0, colon) !== 'xmlns' && !scope.has(name.slice(0, colon))) return null;
	}

	const element = new MiniElement(tagName);
	for (const [name, value] of attrs) element.attributes.set(name, value);
	element.declaredPrefixes = scope === inherited ? null : scope;
	return element;
}

/** Index of the '>' closing an open tag, honoring quoted attribute values; -1 when unterminated. @private */
function findTagEnd(text, start) {
	let quote = null;
	for (let i = start; i < text.length; i++) {
		const ch = text[i];
		if (quote) {
			if (ch === quote) quote = null;
		} else if (ch === '"' || ch === "'") {
			quote = ch;
		} else if (ch === '>') {
			return i;
		}
	}
	return -1;
}

/**
 * Parses XML text into a mini document. Malformed input yields a
 * <parsererror> document instead of throwing (platform parity).
 * @param {string} text
 * @returns {MiniDocument}
 */
export function parseXmlMini(text) {
	const doc = new MiniDocument();
	const stack = [doc];
	// Namespace-prefix scopes, parallel to the element stack (the document
	// itself declares nothing).
	const scopes = [new Set()];
	const len = text.length;
	let i = 0;

	while (i < len) {
		const lt = text.indexOf('<', i);
		if (lt === -1) break; // trailing text after the root closes: ignored, like the platform parser
		if (lt > i && !addText(stack, text.slice(i, lt))) return parsererrorDocument();
		i = lt;

		if (text.startsWith('<!--', i)) {
			const end = text.indexOf('-->', i + 4);
			if (end === -1) return parsererrorDocument();
			i = end + 3;
		} else if (text.startsWith('<![CDATA[', i)) {
			const end = text.indexOf(']]>', i + 9);
			if (end === -1) return parsererrorDocument();
			const raw = text.slice(i + 9, end);
			if (/\S/.test(raw)) stack[stack.length - 1].children.push(raw); // CDATA text is never entity-decoded
			i = end + 3;
		} else if (text.startsWith('<?', i)) {
			const end = text.indexOf('?>', i + 2);
			if (end === -1) return parsererrorDocument();
			i = end + 2;
		} else if (text.startsWith('<!', i)) {
			// DOCTYPE and friends: no DTD handling, skip the declaration.
			const bracket = text.indexOf('[', i);
			const gt = text.indexOf('>', i);
			if (gt === -1) return parsererrorDocument();
			if (bracket !== -1 && bracket < gt) {
				const close = text.indexOf(']', bracket);
				if (close === -1) return parsererrorDocument();
				i = text.indexOf('>', close) + 1;
			} else {
				i = gt + 1;
			}
		} else if (text[i + 1] === '/') {
			const gt = text.indexOf('>', i);
			if (gt === -1) return parsererrorDocument();
			const name = text.slice(i + 2, gt).trim();
			const top = stack[stack.length - 1];
			if (top === doc || top.tagName !== name) return parsererrorDocument();
			stack.pop();
			scopes.pop();
			i = gt + 1;
		} else {
			const gt = findTagEnd(text, i);
			if (gt === -1) return parsererrorDocument();
			let body = text.slice(i + 1, gt);
			let selfClosing = false;
			if (body.endsWith('/')) {
				selfClosing = true;
				body = body.slice(0, -1);
			}
			const element = parseOpenTag(body, scopes[scopes.length - 1]);
			if (!element) return parsererrorDocument();
			stack[stack.length - 1].children.push(element);
			if (!selfClosing) {
				stack.push(element);
				scopes.push(element.declaredPrefixes ?? scopes[scopes.length - 1]);
			}
			i = gt + 1;
		}
	}

	if (stack.length > 1 || !doc.children.some((child) => typeof child !== 'string')) {
		return parsererrorDocument();
	}
	return doc;
}
