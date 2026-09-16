/**
 * Main-thread client for the parse worker: runs the pipeline off-thread when
 * module workers are available and falls back transparently to the identical
 * main-thread pipeline (parseJob.js) when they are not — old browsers,
 * file:// restrictions, or a worker that fails to load.
 *
 * Data-transfer trade-offs:
 * - The file ArrayBuffer is posted WITHOUT a transfer list. A transfer would
 *   detach the main thread's only copy, leaving nothing for the fallback to
 *   re-parse if the worker never comes up. The kept copy costs one memcpy
 *   (~10 ms per 100 MB) — negligible next to the seconds of parsing it
 *   moves off the UI thread.
 * - The finished Track comes back as a structured clone: TrackPoint is an
 *   object array with nullable fields, so it is not transferable, and a
 *   typed-array serialization would duplicate the TrackPoint schema in two
 *   modules to save ~30 ms once per file load. Rejected for maintenance.
 */
import { ParseError, PARSE_ERROR_KEYS } from '../parsers/parseError.js';

/**
 * The main-thread fallback pipeline — loaded on first use, not at boot.
 * parseJob statically reaches every parser module (for FIT, the whole
 * vendor chain), so a static import here would hang the entire graph off
 * the eager module tree and defeat parsers/index.js's per-format lazy
 * loading in the worker.
 * @type {Promise<{runParseJob: (buffer: ArrayBuffer, fileName: string) => Promise<object}>|null}
 * @private
 */
let parseJobModule = null;

/** @private Runs runParseJob on the main thread (no worker, or worker died). */
function runOnMainThread(buffer, fileName) {
	return (parseJobModule ??= import('./parseJob.js')).then((m) => m.runParseJob(buffer, fileName));
}

/** @type {Worker | null} lazily created, reused across files */
let worker = null;
/** Set once the worker proved unusable — every request then takes the fallback. */
let workerBroken = false;
/** @type {Map<number, {resolve: (track: object) => void, reject: (err: Error) => void}>} */
const pending = new Map();
let nextJobId = 1;
/** Sentinel for "the worker died" — distinct from parse errors, which are real results. */
const WORKER_FAILED = Symbol('worker failed');

/**
 * Parses a track file like parseTrackFile + prepareTrack, off-thread when
 * possible. Errors are always ParseError instances with the pipeline's keys.
 * @param {ArrayBuffer} buffer
 * @param {string} fileName
 * @returns {Promise<import('../types.js').Track>}
 */
export function parseTrackOffThread(buffer, fileName) {
	const w = getWorker();
	if (!w) return runOnMainThread(buffer, fileName);
	const id = nextJobId++;
	return new Promise((resolve, reject) => {
		pending.set(id, { resolve, reject });
		w.postMessage({ id, buffer, fileName });
	}).catch((err) => {
		if (err === WORKER_FAILED) return runOnMainThread(buffer, fileName);
		if (err instanceof ParseError) throw err;
		throw new ParseError(PARSE_ERROR_KEYS.invalid, String(err?.message ?? err));
	});
}

/** @private Creates (once) and wires the module worker; null when unsupported. */
function getWorker() {
	if (workerBroken) return null;
	if (worker) return worker;
	try {
		worker = new Worker(new URL('./parseWorker.js', import.meta.url), { type: 'module' });
		worker.onmessage = (event) => {
			const { id, ok, track, key, message } = event.data;
			const job = pending.get(id);
			if (!job) return;
			pending.delete(id);
			if (ok) job.resolve(track);
			else job.reject(new ParseError(key, message));
		};
		worker.onerror = (event) => {
			// Script load/eval failure (blocked worker, broken import): stop using
			// the worker and let every pending job re-run on the main thread.
			event.preventDefault();
			workerBroken = true;
			worker = null;
			for (const job of pending.values()) job.reject(WORKER_FAILED);
			pending.clear();
		};
		return worker;
	} catch {
		workerBroken = true;
		return null;
	}
}
