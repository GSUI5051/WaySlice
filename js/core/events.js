/**
 * Tiny application-wide event bus + observable stores.
 *
 * Two mechanisms, both dependency-free:
 * - `createStore()` for state with a current value (track, sector range).
 *   Subscribers are called synchronously on every `set()`.
 * - `bus` (a plain EventTarget) for transient notifications such as
 *   `theme:changed`, `language:changed` and `profile:hover`.
 */

/**
 * Creates a minimal observable store.
 *
 * @template T
 * @param {T} initial
 * @returns {{get: () => T, set: (next: T) => void, subscribe: (fn: (state: T) => void) => () => void}}
 */
export function createStore(initial) {
  let state = initial;
  const subscribers = new Set();

  return {
    get: () => state,
    set(next) {
      state = next;
      for (const fn of subscribers) fn(state);
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}

/** Global EventTarget for transient app events. */
export const bus = new EventTarget();

/** Emits a custom event on the app bus. */
export function emit(type, detail) {
  bus.dispatchEvent(new CustomEvent(type, { detail }));
}

/** Subscribes to an app bus event; returns an unsubscribe function. */
export function on(type, handler) {
  bus.addEventListener(type, (e) => handler(e.detail));
  return () => bus.removeEventListener(type, handler);
}
