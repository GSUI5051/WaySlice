/**
 * Charts — the shared viewport gestures.
 *
 * One implementation of the chart viewport model, used verbatim by the
 * elevation profile (one x axis) and the dual-variable analysis (x + y):
 *
 *   the TWO-FINGER gesture always pinch-zooms around the fingers' midpoint,
 *   a still short touch is a TAP (the host decides what a tap means — the
 *   profile creates/moves its probe, the density chart pins its reading), and
 *   two taps in quick succession RESET the viewport to the data's full range.
 *
 * Which gesture PANS is the host's choice (`panGesture`), because the same
 * finger means different things in the two charts:
 *
 *   'one-finger' (default) — one finger pans a zoomed window (the profile:
 *     a single finger is a viewport control, and its sector has its own
 *     handles, so nothing is lost)
 *   'two-finger' — one finger only ever READS (the density chart follows it
 *     with its tooltip), and the two-finger gesture both scales and
 *     translates, so a two-finger drag pans the chart.
 *
 * Nothing here owns chart state. A host describes each axis it wants driven
 * with an axis adapter (domain + screen span + window accessors), so a chart
 * with one axis and a chart with two share the same machine — same clamps,
 * same tap slop, same double-tap rule. A window is always a `[lo, hi]` pair
 * in the axis' own data units, and "fitted" is expressed as `null` (the full
 * domain), never as an assumed coordinate.
 *
 * @typedef {object} ViewportAxis
 * @property {'x' | 'y'} axis  which screen direction the window maps onto
 * @property {[number, number]} domain  the full data range — the fit target
 * @property {number} minSpan  the zoom floor, in data units
 * @property {number} px0  screen start of the axis, in canvas CSS px
 * @property {number} pxw  screen length of the axis, in CSS px
 * @property {boolean} [reversed]  the axis runs DESCENDING on screen — the
 *   pace-family reading where the fast end belongs at the top / right
 * @property {() => ([number, number] | null)} get  current window, null = fitted
 * @property {(win: ([number, number] | null)) => void} set
 *
 * Screen orientation is derived here, once: by default a y axis starts at its
 * data MAX (screen top) and an x axis at its data MIN (screen left), and
 * `reversed` flips whichever one applies. Hosts therefore pass the same
 * `reversed` flag their own renderer flips with, and can never disagree with
 * the machine about which end of the data the screen start means.
 *
 * The desktop paths stay the host's own: this is the TOUCH model plus the
 * pure window math the wheel zoom also uses, because a mouse drag means a
 * different thing in each chart (a sector selection in the profile, a hover
 * inspection in the density chart).
 */

/** Tap-vs-drag slop: a touch travelling further than this is a drag, a touch
 *  released inside it is a tap. The double-tap rule uses the same radius, so
 *  both agree on what a "tap" is. */
export const TAP_SLOP = 12;
/** Double-tap window: a second tap-like release inside this many ms and px of
 *  the previous one restores the full range. */
export const DOUBLE_TAP_MS = 400;
export const DOUBLE_TAP_PX = 30;

/* Window math (pure) ------------------------------------------------------ */

/** The window an axis currently shows — its own, or the full domain while it
 *  is fitted. */
export function windowOf(axis) {
  const win = axis.get();
  return win ? [win[0], win[1]] : [axis.domain[0], axis.domain[1]];
}

/** @private Whether the axis' SCREEN START (left / top) holds the data MAX. */
function startsAtMax(axis) {
  return axis.axis === 'y' ? !axis.reversed : !!axis.reversed;
}

/** @private Data value sitting at a screen fraction (0 = the axis' screen
 *  start, 1 = its screen end). The orientation is decided once, here —
 *  every other function works in screen space and never has to know. */
function valueAt(win, axis, frac) {
  const span = win[1] - win[0];
  return startsAtMax(axis) ? win[1] - frac * span : win[0] + frac * span;
}

/** @private The window that holds `value` at screen fraction `frac`, `span`
 *  wide — the inverse of valueAt, direction-aware. */
function windowAt(axis, value, frac, span) {
  if (startsAtMax(axis)) {
    const hi = value + frac * span;
    return [hi - span, hi];
  }
  const lo = value - frac * span;
  return [lo, lo + span];
}

/** @private A pan may never reveal past the data: translate into the domain,
 *  and collapse a window that already spans it. */
function clampToDomain(win, axis) {
  const [dLo, dHi] = axis.domain;
  const full = dHi - dLo;
  let lo = Math.min(win[0], win[1]);
  let hi = Math.max(win[0], win[1]);
  if (!(full > 0) || hi - lo >= full) return [dLo, dHi];
  if (lo < dLo) { hi += dLo - lo; lo = dLo; }
  if (hi > dHi) { lo -= hi - dHi; hi = dHi; }
  return [lo, hi];
}

/**
 * The window a zoom step produces: `base` (or the axis' current window)
 * scaled by `factor` (> 1 zooms out) around the value sitting at screen
 * fraction `frac`. Clamped to the domain and floored at the axis' minSpan —
 * at the floor the anchor keeps its screen position, the way the wheel keeps
 * the cursor. Pure: the caller commits the result.
 */
export function zoomWindow(axis, frac, factor, base) {
  const win = base ?? windowOf(axis);
  const anchor = valueAt(win, axis, frac);
  const [dLo, dHi] = axis.domain;
  const full = dHi - dLo;
  if (!(full > 0)) return [dLo, dHi];
  let out = [anchor - (anchor - win[0]) * factor, anchor + (win[1] - anchor) * factor];
  if (out[1] - out[0] < full) {
    const minSpan = Math.min(Math.max(axis.minSpan || 0, full * 1e-6), full);
    if (out[1] - out[0] < minSpan) out = windowAt(axis, anchor, frac, minSpan);
    return clampToDomain(out, axis);
  }
  return [dLo, dHi];
}

/**
 * The window a pan produces: `base` (the window the gesture started on)
 * translated so the data under the finger stays under it. The deltas apply to
 * `base` rather than to the live window, so repeated clamping at the data
 * edges can never accumulate drift.
 */
export function panWindow(axis, dxPx, base) {
  const win = base ?? windowOf(axis);
  const span = win[1] - win[0];
  const shift = -(dxPx / Math.max(axis.pxw, 1)) * span * (startsAtMax(axis) ? -1 : 1);
  return clampToDomain([win[0] + shift, win[1] + shift], axis);
}

/** @private Commits a window through the host's axis adapter: a window that
 *  (again) covers the whole domain is stored as "fitted" (null), so the
 *  charts never carry a window that claims to be a zoom. */
function commit(axis, win) {
  const [dLo, dHi] = axis.domain;
  axis.set(win[0] <= dLo && win[1] >= dHi ? null : win);
}

/** One zoom step around a screen fraction, committed to the axis — the
 *  wheel-zoom entry point (the touch pinch goes through the machine below,
 *  which snapshots the window at gesture start). */
export function zoomStep(axis, frac, factor) {
  commit(axis, zoomWindow(axis, frac, factor));
}

/* Touch gestures ---------------------------------------------------------- */

/**
 * The touch gesture machine: feed it the chart canvas' pointerdown / move /
 * up / cancel and it keeps `touches` of its own — the host only has to say
 * which axes exist and what a tap means.
 *
 * `down` / `move` / `up` / `cancel` return false for pointers the machine
 * does not own (a mouse, or a touch the host already claimed elsewhere), so
 * the host's own paths stay in charge of those. `move` returning true means
 * the machine consumed the move.
 *
 * @param {object} opts
 * @param {() => DOMRect} opts.getRect  the canvas rect (client → canvas px)
 * @param {() => (ViewportAxis[] | null)} opts.getAxes  the axes to drive, or
 *   null when there is nothing to drive (no track / no data / no plot yet)
 * @param {() => void} [opts.onChange]  called after every window change —
 *   the host redraws and drops whatever cursor it had pinned
 * @param {(e: PointerEvent) => void} [opts.onTap]  a still short touch on the
 *   chart area
 * @param {(e: PointerEvent) => void} [opts.onFirstTouch]  the first touch of
 *   the page session landed on the chart (hosts hint the pinch once)
 * @param {'one-finger' | 'two-finger'} [opts.panGesture]  which gesture pans
 *   (see the module doc; default 'one-finger')
 */
export function createTouchViewport({
  getRect, getAxes, onChange, onTap, onFirstTouch, panGesture = 'one-finger',
}) {
  const touches = new Map(); // pointerId → {x, y} of the active touch pointers
  let pinch = null;          // {startSpan, mid, axes: [{axis, win, frac}]}
  let pan = null;            // {x, y, axes: [{axis, win}]}
  let tap = null;            // {pointerId, x, y, moved, consumed}
  let hinted = false;
  // Multi-touch bookkeeping for the host's double-tap rule: a release that
  // came out of a pinch or a two-finger pan is never a tap-like release, so
  // it must not arm the rule — otherwise a single tap right where a finger
  // lifted (a very ordinary thing to do next) would read as the second tap of
  // a double-tap and reset the viewport.
  let multiGesture = false;  // a second finger joined the current gesture
  let multiRelease = false;  // …and this event is one of that gesture's releases

  /** @private Screen fraction of a client point on one axis. */
  const fracAt = (axis, x, y) => {
    const rect = getRect();
    const p = axis.axis === 'y' ? y - rect.top : x - rect.left;
    return Math.min(Math.max((p - axis.px0) / Math.max(axis.pxw, 1), 0), 1);
  };
  /** @private The pixel distance a gesture has travelled along one axis. */
  const travelled = (axis, from, origin) => (axis.axis === 'y' ? from.y - origin.y : from.x - origin.x);

  return {
    down(e) {
      const axes = getAxes();
      if (!axes || !axes.length) return false;
      multiRelease = false; // a fresh press starts a fresh gesture
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size >= 2) multiGesture = true;
      if (!hinted) { hinted = true; onFirstTouch?.(e); }
      tap = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: false, consumed: false };
      const multi = touches.size >= 2;
      if (!pinch && multi) {
        // Second finger: the pan becomes a pinch around the gesture midpoint,
        // anchored to the windows the axes were showing when it started (each
        // move reapplies them, so the clamps can never accumulate drift).
        pan = null;
        const [a, b] = [...touches.values()];
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        pinch = {
          startSpan: Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1),
          // The gesture-start midpoint: two-finger pan measures every move
          // against it (one-finger pan does the same with its arming point).
          mid: { x: midX, y: midY },
          axes: axes.map((axis) => ({
            axis, win: windowOf(axis), frac: fracAt(axis, midX, midY),
          })),
        };
        onChange?.();
      }
      // A finger that is (or was ever) part of a multi-touch gesture never
      // taps — a pinch must not leave a probe or a pinned reading behind.
      if (multi || pinch) tap.consumed = true;
      return true;
    },

    move(e) {
      const t = touches.get(e.pointerId);
      if (!t) return false;
      t.x = e.clientX;
      t.y = e.clientY;
      if (pinch && touches.size >= 2) {
        // Spreading the fingers shrinks the window (factor < 1 = zoom in).
        const [a, b] = [...touches.values()];
        const factor = pinch.startSpan / Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        for (const p of pinch.axes) {
          let win = zoomWindow(p.axis, p.frac, factor, p.win);
          // Two-finger pan: the midpoint's own travel translates the window,
          // so the data under the fingers stays under them. Always measured
          // from the gesture start (and applied after the scale, both on the
          // start window), which is what keeps a long gesture drift-free.
          if (panGesture === 'two-finger') {
            win = panWindow(p.axis, travelled(p.axis, mid, pinch.mid), win);
          }
          commit(p.axis, win);
        }
        onChange?.();
        return true;
      }
      if (pan) {
        for (const p of pan.axes) commit(p.axis, panWindow(p.axis, travelled(p.axis, t, pan), p.win));
        onChange?.();
        return true;
      }
      if (tap && tap.pointerId === e.pointerId && !tap.moved && !tap.consumed) {
        // A drift past the slop ends the tap, whichever gesture pans. In
        // 'one-finger' mode it may also arm a pan — only while something is
        // actually zoomed (with the full range on screen there is nothing to
        // pan). In 'two-finger' mode a single finger NEVER pans: the move is
        // left unconsumed so the host keeps tracking the finger (the density
        // chart follows it with its reading).
        if (Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > TAP_SLOP) {
          tap.moved = true;
          const axes = getAxes();
          if (panGesture === 'one-finger' && axes && axes.some((axis) => axis.get())) {
            pan = {
              x: e.clientX,
              y: e.clientY,
              axes: axes.map((axis) => ({ axis, win: windowOf(axis) })),
            };
            // The window has not moved yet, but the gesture is now a pan:
            // the host drops whatever cursor it had pinned for the touch.
            onChange?.();
            return true;
          }
        }
        return false;
      }
      return false;
    },

    up(e) {
      const owned = touches.delete(e.pointerId);
      multiRelease = multiGesture;
      if (touches.size === 0) multiGesture = false;
      if (pinch && touches.size < 2) pinch = null;
      if (pan) {
        pan = null;
        tap = null; // a pan is never a tap, however short
        return true;
      }
      if (tap && tap.pointerId === e.pointerId) {
        const isTap = !tap.moved && !tap.consumed;
        tap = null;
        if (isTap) {
          onTap?.(e);
          return true;
        }
      }
      return owned;
    },

    cancel(e) {
      const owned = touches.delete(e.pointerId);
      multiRelease = multiGesture;
      if (touches.size === 0) multiGesture = false;
      if (touches.size < 2) pinch = null;
      tap = null;
      pan = null;
      return owned;
    },

    /** True while the app is handling a release that came out of a
     *  multi-finger gesture — hosts with a double-tap rule must ignore those
     *  events (see the multi-touch bookkeeping above). */
    isMultiRelease() {
      return multiRelease;
    },
  };
}

/**
 * The double-tap rule both charts reset their viewport with: a second
 * tap-like release within DOUBLE_TAP_MS and DOUBLE_TAP_PX of the previous
 * one, each landing within TAP_SLOP of its own pointerdown. Detected by hand
 * because the native dblclick event is not reliably delivered for touch on
 * every mobile browser — and because a mouse double-click then goes through
 * the very same rule.
 *
 * Feed it from a SURFACE that contains everything a tap may land on (the
 * profile listens on its chart body, so a tap on a sector handle counts too).
 * `isActive` gates the whole rule: with nothing to reset (no track, or a
 * viewport already showing the full range) no tap is recorded and nothing
 * fires, which is also what keeps a desktop double-click from changing
 * meaning.
 *
 * @param {{isActive: () => boolean, onDoubleTap: (e: PointerEvent) => void}} opts
 */
export function createDoubleTapRule({ isActive, onDoubleTap }) {
  let down = null;
  let last = null;
  return {
    down(e) { down = { x: e.clientX, y: e.clientY }; },
    up(e) {
      if (!isActive()) return false;
      const now = performance.now();
      if (
        down &&
        last &&
        Math.hypot(e.clientX - down.x, e.clientY - down.y) < TAP_SLOP &&
        now - last.time < DOUBLE_TAP_MS &&
        Math.hypot(e.clientX - last.x, e.clientY - last.y) < DOUBLE_TAP_PX
      ) {
        last = null;
        onDoubleTap(e);
        return true;
      }
      last = { time: now, x: e.clientX, y: e.clientY };
      return false;
    },
  };
}
