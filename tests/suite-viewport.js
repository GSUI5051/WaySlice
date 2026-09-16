/**
 * Shared chart viewport gestures — the window math both charts pan and zoom
 * through, and the double-tap rule they reset with.
 *
 * The touch machine itself is exercised in the browser by
 * tools/tmp-viewport-scenarios.js (it needs real pointer events and layout);
 * what is unit-tested here is everything that can be wrong invisibly: the
 * clamps, the direction conventions (a y axis starts at its data max), the
 * anchor preservation and the reset semantics.
 */
import { suite, test, assert } from './runner.js';
import {
  TAP_SLOP, DOUBLE_TAP_MS, DOUBLE_TAP_PX,
  windowOf, zoomWindow, panWindow, zoomStep, createDoubleTapRule, createTouchViewport,
} from '../js/charts/viewport-gestures.js';

/** A viewport axis adapter over a mutable window, as the charts build them. */
function makeAxis({
  axis = 'x', domain = [0, 100], minSpan = 5, px0 = 0, pxw = 200, reversed = false, win = null,
} = {}) {
  const state = { win };
  return {
    axis, domain, minSpan, px0, pxw, reversed,
    get: () => state.win,
    set: (w) => { state.win = w; },
    read: () => state.win,
  };
}

suite('viewport / window lookup and the fit representation', () => {
  test('a fitted axis (null) reports its full domain', () => {
    const a = makeAxis({ domain: [10, 30] });
    assert.deepEqual(windowOf(a), [10, 30]);
  });

  test('a zoomed axis reports its own window', () => {
    const a = makeAxis({ domain: [10, 30], win: [12, 18] });
    assert.deepEqual(windowOf(a), [12, 18]);
  });
});

suite('viewport / zoom steps', () => {
  test('zoom in narrows the window symmetrically about the anchor', () => {
    const a = makeAxis({ domain: [0, 100], minSpan: 1 });
    const w = zoomWindow(a, 0.5, 0.5);
    assert.closeTo(w[0], 25, 1e-9);
    assert.closeTo(w[1], 75, 1e-9);
  });

  test('the value under the anchor keeps its screen fraction', () => {
    const a = makeAxis({ domain: [0, 100], minSpan: 1 });
    const frac = 0.25;
    const anchor = 25; // valueAt(domain, x, 0.25)
    const w = zoomWindow(a, frac, 0.4);
    assert.closeTo(w[0] + frac * (w[1] - w[0]), anchor, 1e-9);
  });

  /** Value sitting at a screen fraction, in each orientation's own terms. */
  const valueAtFrac = (w, frac, startsAtMax) =>
    (startsAtMax ? w[1] - frac * (w[1] - w[0]) : w[0] + frac * (w[1] - w[0]));

  test('a y axis starts at its data MAX — the same fraction counts from the top', () => {
    const a = makeAxis({ axis: 'y', domain: [0, 100], minSpan: 1 });
    // screen top = 100, so fraction 0.25 sits at 75
    const w = zoomWindow(a, 0.25, 0.5);
    assert.closeTo(valueAtFrac(w, 0.25, true), 75, 1e-9);
  });

  test('a REVERSED y axis counts from its data MIN at the top (pace: fast on top)', () => {
    const a = makeAxis({ axis: 'y', domain: [0, 100], minSpan: 1, reversed: true });
    const w = zoomWindow(a, 0.25, 0.5);
    assert.closeTo(valueAtFrac(w, 0.25, false), 25, 1e-9);
  });

  test('a reversed X axis keeps pace fast at the right', () => {
    const a = makeAxis({ axis: 'x', domain: [0, 100], minSpan: 1, reversed: true });
    const w = zoomWindow(a, 0.25, 0.5); // 0.25 from the LEFT edge = 75 in data
    assert.closeTo(valueAtFrac(w, 0.25, true), 75, 1e-9);
  });

  test('zooming past the domain collapses to "fitted" (null), never wider', () => {
    const a = makeAxis({ domain: [0, 100], minSpan: 1 });
    a.set([20, 30]);
    zoomStep(a, 0.5, 20); // 20 × wider than the window → far beyond the domain
    assert.isNull(a.read(), 'the full domain is stored as fitted');
    assert.deepEqual(windowOf(a), [0, 100]);
  });

  test('the zoom floor holds and the anchor keeps its position on it', () => {
    const a = makeAxis({ domain: [0, 100], minSpan: 10 });
    a.set([40, 60]);
    const frac = 0.3;
    const anchor = 40 + frac * 20; // 46
    const w = zoomWindow(a, frac, 0.01); // absurd zoom-in → the floor
    assert.closeTo(w[1] - w[0], 10, 1e-9);
    assert.closeTo(w[0] + frac * (w[1] - w[0]), anchor, 1e-9);
  });

  test('the floor never exceeds the domain itself', () => {
    const a = makeAxis({ domain: [0, 4], minSpan: 500 }); // nonsensical floor
    const w = zoomWindow(a, 0.5, 0.01);
    assert.deepEqual(w, [0, 4]);
  });

  test('a degenerate domain (zero span) stays fitted', () => {
    const a = makeAxis({ domain: [7, 7], minSpan: 1 });
    assert.deepEqual(zoomWindow(a, 0.5, 0.5), [7, 7]);
  });

  test('zoomStep commits the window through the adapter', () => {
    const a = makeAxis({ domain: [0, 100], minSpan: 1 });
    zoomStep(a, 0.5, 0.5);
    assert.deepEqual(a.read().map((v) => Math.round(v)), [25, 75]);
  });
});

suite('viewport / pan', () => {
  test('dragging left reveals higher x values (the chart follows the hand)', () => {
    const a = makeAxis({ domain: [0, 100], win: [20, 40], pxw: 200 });
    const w = panWindow(a, -20, [20, 40]); // 20 px left = 10 % of the window
    assert.closeTo(w[0], 22, 1e-9);
    assert.closeTo(w[1], 42, 1e-9);
  });

  test('a y axis follows the hand UP toward LOWER values (top = data max)', () => {
    const a = makeAxis({ axis: 'y', domain: [0, 100], win: [20, 40], pxw: 200 });
    const w = panWindow(a, -20, [20, 40]);
    assert.closeTo(w[0], 18, 1e-9);
  });

  test('deltas apply to the gesture base window, so edge clamps cannot drift', () => {
    const a = makeAxis({ domain: [0, 100], win: [0, 20], pxw: 200 });
    const base = [0, 20];
    // A drag past the edge simply clamps…
    assert.deepEqual(panWindow(a, 40, base), [0, 20], 'clamped at the domain edge');
    // …and the NEXT move still measures its own offset from the BASE, so a
    // finger that comes back responds at once instead of unpicking a backlog.
    const back = panWindow(a, -10, base);
    assert.closeTo(back[0], 1, 1e-9);
    assert.closeTo(back[1], 21, 1e-9);
  });

  test('a pan can never leave the domain, and never shrinks the window', () => {
    const a = makeAxis({ domain: [0, 100], win: [80, 100], pxw: 200 });
    assert.deepEqual(panWindow(a, -2000, [80, 100]), [80, 100], 'already at the far edge');
    const out = panWindow(a, 1000, [80, 100]);
    assert.deepEqual(out, [0, 20], 'a long drag clamps at the near edge');
    assert.closeTo(out[1] - out[0], 20, 1e-9, 'the window width is untouched');
  });

  test('a window covering the domain stays there whatever the drag', () => {
    const a = makeAxis({ domain: [0, 100], pxw: 200 });
    assert.deepEqual(panWindow(a, -500, null), [0, 100]);
    assert.deepEqual(panWindow(a, 500, null), [0, 100]);
  });
});

/* The touch machine, driven with synthetic pointer events. It takes plain
   event objects and an injected axis adapter, so both pan modes are testable
   without a browser. */
function harness({ panGesture, win = null, domain = [0, 100], minSpan = 5, pxw = 200 } = {}) {
  const box = { win };
  const axis = {
    axis: 'x', domain, minSpan, px0: 0, pxw,
    get: () => box.win,
    set: (w) => { box.win = w; },
  };
  let changes = 0;
  let taps = 0;
  const viewport = createTouchViewport({
    getRect: () => ({ left: 0, top: 0 }),
    getAxes: () => [axis],
    onChange: () => { changes++; },
    onTap: () => { taps++; },
    panGesture,
  });
  const ev = (pointerId, clientX, clientY = 100) => ({ pointerId, clientX, clientY, pointerType: 'touch' });
  return {
    viewport, ev,
    read: () => box.win,
    changes: () => changes,
    taps: () => taps,
  };
}

suite('viewport / touch machine — one-finger pan mode (the profile)', () => {
  test('a finger dragged past the slop pans the zoomed window', () => {
    const h = harness({ win: [40, 60] }); // 1 px = 0.1 data units
    h.viewport.down(h.ev(1, 100));
    assert.equal(h.viewport.move(h.ev(1, 110)), false, 'still inside the slop');
    assert.deepEqual(h.read(), [40, 60]);
    assert.equal(h.viewport.move(h.ev(1, 130)), true, 'past the slop: panned');
    // The slop crossing itself is swallowed; deltas count from there.
    assert.deepEqual(h.read(), [40, 60]);
    h.viewport.move(h.ev(1, 150));
    assert.deepEqual(h.read(), [38, 58], 'drag right reveals lower values');
  });

  test('the two-finger gesture only scales: a moving midpoint does not pan', () => {
    const h = harness({ win: [40, 60] });
    h.viewport.down(h.ev(1, 80));
    h.viewport.down(h.ev(2, 120)); // span 40
    h.viewport.move(h.ev(1, 90));
    h.viewport.move(h.ev(2, 130)); // span 40, midpoint 100 → 110
    assert.deepEqual(h.read(), [40, 60], 'translation is ignored in this mode');
  });

  test('a still finger taps, a moved one does not', () => {
    const h = harness({ win: [40, 60] });
    h.viewport.down(h.ev(1, 100));
    h.viewport.up(h.ev(1, 100));
    assert.equal(h.taps(), 1);
    h.viewport.down(h.ev(2, 100));
    h.viewport.move(h.ev(2, 140));
    h.viewport.up(h.ev(2, 140));
    assert.equal(h.taps(), 1, 'a drag never taps');
  });
});

suite('viewport / touch machine — two-finger pan mode (the density chart)', () => {
  test('one finger NEVER pans — the move is left to the host (reading follow)', () => {
    const h = harness({ panGesture: 'two-finger', win: [40, 60] });
    h.viewport.down(h.ev(1, 100));
    assert.equal(h.viewport.move(h.ev(1, 130)), false, 'not consumed: the host keeps tracking');
    h.viewport.move(h.ev(1, 180));
    assert.deepEqual(h.read(), [40, 60], 'the window never moved');
    h.viewport.up(h.ev(1, 180));
    assert.equal(h.taps(), 0, 'and the drag is not a tap');
  });

  test('a two-finger drag with a steady span pans by the midpoint travel', () => {
    const h = harness({ panGesture: 'two-finger', win: [40, 60] });
    h.viewport.down(h.ev(1, 80));
    h.viewport.down(h.ev(2, 120)); // span 40, midpoint 100
    h.viewport.move(h.ev(1, 110));
    h.viewport.move(h.ev(2, 150)); // span 40 (pure translation), midpoint 130
    assert.deepEqual(h.read(), [37, 57], '30 px right = -3 data units');
  });

  test('a two-finger gesture scales and translates at once, without drift', () => {
    const h = harness({ panGesture: 'two-finger', win: [40, 60] });
    const anchorStart = 40 + 0.5 * 20; // the value under the start midpoint (50)
    h.viewport.down(h.ev(1, 80));
    h.viewport.down(h.ev(2, 120)); // finger span 40, midpoint 100 (fraction 0.5)
    h.viewport.move(h.ev(1, 105));
    h.viewport.move(h.ev(2, 165)); // finger span 60 (zoom out ×2/3), midpoint 135
    const [lo, hi] = h.read();
    const span = hi - lo;
    assert.closeTo(span, 20 * (40 / 60), 1e-9, 'the data span scaled by the finger span');
    // The data that started under the fingers is still under the new midpoint.
    assert.closeTo(lo + 0.675 * span, anchorStart, 1e-9);
  });

  test('a pinch that only zooms still behaves exactly as before', () => {
    const h = harness({ panGesture: 'two-finger', win: [40, 60] });
    h.viewport.down(h.ev(1, 80));
    h.viewport.down(h.ev(2, 120));
    h.viewport.move(h.ev(1, 60));
    h.viewport.move(h.ev(2, 140)); // finger span 80, midpoint still 100
    const [lo, hi] = h.read();
    assert.closeTo(hi - lo, 10, 1e-9, 'a doubled finger span halves the window');
    assert.closeTo(lo + 0.5 * 10, 50, 1e-9, 'the midpoint anchor stays put');
  });

  test('a pinch never taps, however short', () => {
    const h = harness({ panGesture: 'two-finger', win: [40, 60] });
    h.viewport.down(h.ev(1, 90));
    h.viewport.down(h.ev(2, 110));
    h.viewport.move(h.ev(1, 80));
    h.viewport.move(h.ev(2, 120));
    h.viewport.up(h.ev(1, 80));
    h.viewport.up(h.ev(2, 120));
    assert.equal(h.taps(), 0);
  });

  test('a multi-finger release never arms the double-tap rule', () => {
    const h = harness({ panGesture: 'two-finger', win: [40, 60] });
    h.viewport.down(h.ev(1, 80));
    assert.equal(h.viewport.isMultiRelease(), false, 'the first finger is not multi');
    h.viewport.down(h.ev(2, 120));
    h.viewport.up(h.ev(1, 80));
    assert.equal(h.viewport.isMultiRelease(), true, 'the first release of the pinch');
    h.viewport.up(h.ev(2, 120));
    assert.equal(h.viewport.isMultiRelease(), true, 'and the last one');
    h.viewport.down(h.ev(3, 100));
    assert.equal(h.viewport.isMultiRelease(), false, 'a fresh press is tap-like again');
    h.viewport.up(h.ev(3, 100));
    assert.equal(h.viewport.isMultiRelease(), false);
    assert.equal(h.taps(), 1);
  });

  test('a two-finger drag cannot leave the data domain', () => {
    const h = harness({ panGesture: 'two-finger', win: [80, 100] });
    h.viewport.down(h.ev(1, 80));
    h.viewport.down(h.ev(2, 120));
    h.viewport.move(h.ev(1, 1080));
    h.viewport.move(h.ev(2, 1120)); // midpoint +1000 px, far past the low end
    assert.deepEqual(h.read(), [0, 20], 'clamped at the domain start, width kept');
    h.viewport.move(h.ev(1, -920));
    h.viewport.move(h.ev(2, -880)); // midpoint -1000 px, far past the high end
    assert.deepEqual(h.read(), [80, 100], 'clamped at the domain end');
  });
});

suite('viewport / double-tap rule', () => {
  test('two quick taps near each other fire the reset once', () => {
    let fired = 0;
    const rule = createDoubleTapRule({ isActive: () => true, onDoubleTap: () => { fired++; } });
    const ev = (type, x, y) => ({ clientX: x, clientY: y });
    rule.down(ev('down', 100, 100));
    rule.up(ev('up', 100, 101));
    assert.equal(fired, 0, 'the first tap only arms');
    rule.down(ev('down', 102, 100));
    rule.up(ev('up', 102, 100));
    assert.equal(fired, 1);
    assert.equal(rule.up(ev('up', 102, 100)), false, 'the pair is consumed — no triple fire');
  });

  test('a distant second tap does not reset', () => {
    let fired = 0;
    const rule = createDoubleTapRule({ isActive: () => true, onDoubleTap: () => { fired++; } });
    rule.down({ clientX: 0, clientY: 0 });
    rule.up({ clientX: 0, clientY: 0 });
    rule.down({ clientX: 200, clientY: 0 });
    rule.up({ clientX: 200, clientY: 0 });
    assert.equal(fired, 0);
  });

  test('a drag between the taps is not a tap', () => {
    let fired = 0;
    const rule = createDoubleTapRule({ isActive: () => true, onDoubleTap: () => { fired++; } });
    rule.down({ clientX: 100, clientY: 100 });
    rule.up({ clientX: 100, clientY: 100 });
    rule.down({ clientX: 100, clientY: 100 });
    rule.up({ clientX: 100 + TAP_SLOP + 1, clientY: 100 }); // travelled past the slop
    rule.down({ clientX: 100, clientY: 100 });
    rule.up({ clientX: 100, clientY: 100 });
    // The over-slop release never became a candidate, so only the releases at
    // 100 stay in play: two of them, close in time → one reset.
    assert.equal(fired, 1);
  });

  test('an inactive host records nothing (desktop double-clicks stay inert)', () => {
    let fired = 0;
    let active = false;
    const rule = createDoubleTapRule({ isActive: () => active, onDoubleTap: () => { fired++; } });
    for (let i = 0; i < 4; i++) {
      rule.down({ clientX: 50, clientY: 50 });
      rule.up({ clientX: 50, clientY: 50 });
    }
    assert.equal(fired, 0);
    active = true;
    rule.down({ clientX: 50, clientY: 50 });
    rule.up({ clientX: 50, clientY: 50 });
    rule.down({ clientX: 50, clientY: 50 });
    rule.up({ clientX: 50, clientY: 50 });
    assert.equal(fired, 1, 'activating the host re-arms the rule');
  });

  test('the tap window is the shared 400 ms / 30 px rule', () => {
    assert.equal(DOUBLE_TAP_MS, 400);
    assert.equal(DOUBLE_TAP_PX, 30);
    assert.equal(TAP_SLOP, 12);
  });
});
