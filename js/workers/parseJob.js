/**
 * The shared parse pipeline — detect → parse → validate → prepare.
 *
 * Runs verbatim inside the parse worker (parseWorker.js) and, when workers
 * are unavailable, on the main thread (fallback in parseWorkerClient.js).
 * One source of truth, so the worker path and the fallback path behave
 * identically by construction.
 */
import { detectFormat, parseTrackFile } from '../parsers/index.js';
import { prepareTrack } from '../geo/track.js';
import { ParseError, PARSE_ERROR_KEYS } from '../parsers/parseError.js';

/**
 * @param {ArrayBuffer} buffer  raw file bytes
 * @param {string} fileName  original file name (extension selects the format fallback)
 * @returns {Promise<import('../types.js').Track>}
 */
export async function runParseJob(buffer, fileName) {
	const format = detectFormat(fileName, buffer);
	const { points, waypoints } = await parseTrackFile(buffer, format);
	if (points.length < 2) throw new ParseError(PARSE_ERROR_KEYS.noTrack);
	return prepareTrack(points, fileName.replace(/\.[^.]+$/, ''), waypoints);
}
