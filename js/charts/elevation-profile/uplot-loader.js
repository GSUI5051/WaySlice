/**
 * uPlot lazy loader — the elevation profile's chart library load strategy.
 *
 * uPlot is the profile's renderer, but the profile only exists once a track
 * is loaded — so the library must not be part of the initial page load:
 * nothing imports it statically, and this module is the only place in the
 * app that requests it, the first time the profile actually draws a track.
 *
 * The promise is cached (not just the resolved module), so concurrent first
 * renders share one download and no later render re-imports. A FAILED import
 * resets the cache: the renderer surfaces a restrained error state and the
 * next explicit render attempt may retry — no rejected promise is cached
 * forever, and nothing retries in a loop by itself.
 *
 * The vendored library ships with a VENDOR-NOTE (version pin, license) in
 * vendor/uplot/; the stylesheet link goes BEFORE the app's own stylesheets,
 * mirroring the MapLibre vendor CSS insertion (the app's cascade must win).
 */

let uPlotPromise = null;

/** Loads and caches the uPlot ES module at most once (retryable on failure).
 *  @returns {Promise<typeof import('../../../vendor/uplot/uPlot.esm.js').default>}
 *    resolves to the uPlot constructor */
export function loadUPlot() {
  if (!uPlotPromise) {
    uPlotPromise = Promise.all([
      import('../../../vendor/uplot/uPlot.esm.js'),
      loadUplotCss(),
    ])
      .then(([mod]) => mod.default)
      .catch((error) => {
        uPlotPromise = null; // allow a later attempt; never cache a rejection
        throw error;
      });
  }
  return uPlotPromise;
}

/** @private Injects the vendor uPlot stylesheet on first use — uPlot's own
 *  DOM chrome (cursor lines, legend) is mostly disabled by the renderer, but
 *  the few rules it keeps come from here. The link goes BEFORE the app's own
 *  stylesheets so app CSS always wins the cascade. Resolves on load; a load
 *  ERROR still resolves (missing chrome styling is survivable) because the
 *  JS import failure is the one worth reporting. */
function loadUplotCss() {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../../../vendor/uplot/uPlot.min.css', import.meta.url).href;
  const firstCss = document.head.querySelector('link[rel="stylesheet"]');
  if (firstCss) document.head.insertBefore(link, firstCss);
  else document.head.appendChild(link);
  return new Promise((resolve) => {
    link.onload = resolve;
    link.onerror = resolve;
  });
}
