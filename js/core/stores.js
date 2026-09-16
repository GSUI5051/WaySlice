/** Global observable stores shared across UI modules. */
import { createStore } from './events.js';

/** The currently loaded track, or null before any file is loaded. */
export const trackStore = createStore(/** @type {import('../types.js').Track|null} */ (null));
