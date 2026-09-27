/**
 * The desktop-wide layout breakpoint (matches layout.css): the app grid,
 * menu flyouts and the profile's overlays-menu placement are wide-screen
 * features. Below 1100 px — narrow desktop windows and phones alike —
 * inline/fallback rendering applies.
 */

/** @returns {boolean} true on a ≥1100 px viewport */
export const isWideLayout = () => window.matchMedia('(min-width: 1100px)').matches;
