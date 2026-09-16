// Minimal stand-in for the npm `buffer` package, vendored for fit-parser.
// The upstream bundle imports `{ Buffer } from 'buffer'` in exactly one place
// (binary.js, string-field decoding: `Buffer.from(byteValues).toString('utf-8')`),
// and this shim covers precisely that call shape — no build step needed.
// If a future fit-parser upgrade touches Buffer beyond `from` + `toString`,
// extend this shim or switch to the real `buffer` polyfill via an import map.

class BufferShim extends Uint8Array {
	static from(input) {
		if (typeof input === 'string') {
			const bytes = new TextEncoder().encode(input);
			const buf = new BufferShim(bytes.length);
			buf.set(bytes);
			return buf;
		}
		if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
			const view = input instanceof ArrayBuffer ? new Uint8Array(input) : Uint8Array.from(input);
			const buf = new BufferShim(view.length);
			buf.set(view);
			return buf;
		}
		// array/iterable of byte values (the only upstream call shape)
		const arr = Array.from(input, (v) => v & 255);
		const buf = new BufferShim(arr.length);
		buf.set(arr);
		return buf;
	}

	static isBuffer(value) {
		return value instanceof BufferShim;
	}

	toString(encoding = 'utf8', start, end) {
		const enc = String(encoding).toLowerCase();
		const view = start === undefined && end === undefined ? this : this.subarray(start, end);
		if (enc === 'utf8' || enc === 'utf-8') return new TextDecoder('utf-8').decode(view);
		if (enc === 'ascii') {
			let out = '';
			for (const byte of view) out += String.fromCharCode(byte & 127);
			return out;
		}
		if (enc === 'latin1' || enc === 'binary') {
			let out = '';
			for (const byte of view) out += String.fromCharCode(byte);
			return out;
		}
		if (enc === 'hex') {
			let out = '';
			for (const byte of view) out += byte.toString(16).padStart(2, '0');
			return out;
		}
		throw new TypeError(`Unsupported encoding: ${encoding}`);
	}
}

export { BufferShim as Buffer };
