/**
 * Parse worker — runs the shared pipeline (parseJob.js) off the main thread.
 *
 * Module worker, no bundler: constructed by parseWorkerClient.js via
 * new Worker(new URL('./parseWorker.js', import.meta.url), { type: 'module' }).
 *
 * Replies one message per job:
 *  - { id, ok: true, track }                       — the prepared Track
 *  - { id, ok: false, key, message }               — ParseError key + detail;
 *    the class instance itself cannot cross the boundary (structured clone of
 *    Error subclasses is lossy), so the client re-hydrates it into a real
 *    ParseError and upload.js's showError path stays byte-identical.
 */
import { runParseJob } from './parseJob.js';

self.addEventListener('message', async (event) => {
	const { id, buffer, fileName } = event.data;
	try {
		const track = await runParseJob(buffer, fileName);
		self.postMessage({ id, ok: true, track });
	} catch (err) {
		self.postMessage({
			id,
			ok: false,
			key: err?.key ?? 'invalid',
			message: String(err?.message ?? err),
		});
	}
});
