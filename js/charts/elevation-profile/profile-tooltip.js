/**
 * Elevation profile — the telemetry readouts (DOM).
 *
 * One data pipeline, two presentations:
 *
 *  - Desktop hover (fine pointers): a single floating readout anchored to
 *    the chart body's bottom edge (the x axis): x position (distance or
 *    elapsed time), elevation, then the visible overlay readings
 *    (HR/speed/cadence…) in their series colors.
 *  - Touch probe (coarse pointers): the FIXED telemetry band between the profile header and the chart
 *    (#profile-readout) — a 2×4 grid of permanent slots ([position]
 *    [elevation] [speed family] [heart rate] / [cadence] [temperature]
 *    [power] [empty]), each slot independently centered. Sensor slots have
 *    three states: value while the overlay is enabled, muted "Not selected"
 *    while the track has the data but the overlay is off, blank when the
 *    track lacks the sensor. The band is part of the profile module itself
 *    (chart = context, band = exact values), so it can never cover the plot,
 *    never flip at a screen edge and never re-flow while the probe slides
 *    along x. On fine-pointer devices (hybrid touchscreen laptops, desktop
 *    test browsers) the band does not exist and the probe keeps the classic
 *    floating box instead.
 *
 * Driven by the interaction layer (profile pointer moves, wheel/pan
 * re-derivations) and by the renderer (map hovers and pinned waypoints draw
 * their crosshair through drawHover, which shows the tooltip at the same
 * position). Reads the shared chart state; owns no state of its own beyond
 * the DOM node references in state.dom (tooltip + readout).
 */
import { pointAtDistance } from '../../geo/interpolate.js';
import { loadHeartRateSettings } from '../../metrics/heartRateSettings.js';
import { getHeartRateDisplay } from '../../metrics/heartRateDisplay.js';
import { computeZoneBounds, classifyHr } from '../../metrics/heartRateZones.js';
import { t } from '../../language/language.js';
import { formatDuration, formatDistanceShort, formatElevation } from '../../utils/format.js';
import { state } from './profile-state.js';
import { OVERLAY_METRICS, SPEED_FAMILY, distToX, formatOverlayValue } from './profile-data.js';

/** True when the fixed telemetry band is rendered (coarse-pointer media). */
function probeBandVisible() {
  const band = state.dom.readout;
  return !!band && getComputedStyle(band).display !== 'none';
}

/**
 * The fixed band's two telemetry rows — a 2×4 grid of PERMANENT slots:
 * [position] [elevation] [speed family] [heart rate] / [cadence]
 * [temperature] [power] [empty]. Slots never move or re-flow, and every
 * sensor slot has three states:
 *   overlay enabled + reading      → the value in its series color
 *   data exists, overlay disabled  → a muted "Not selected" (t('notSelected'))
 *   the track lacks the sensor     → a blank slot
 * An enabled slot without a reading at the probed point renders an em dash.
 * The heart-rate slot is two-level: main value on top, its zone underneath.
 * The zone shows only while the drawer's show-HR-zones toggle is on (the
 * zone bands' gate — readout and profile always agree), and wears its
 * zone-band color while zone highlight is on; a reading below the Zone 1 lower
 * bound belongs to no zone → main value only. All cells are
 * centered flex boxes, so the single-line slots stay vertically centered
 * inside the taller row the HR slot creates. Position and elevation are
 * base info and always show. The speed slot follows the user's selected
 * family variant.
 */
function renderProbeBand(pt, xText) {
  const { track, selectedOverlays, hiddenOverlays, speeds, gapSpeeds, dom } = state;
  // Nearest track point to the probe position carries the sensor readings —
  // the same reading path the desktop hover uses.
  const idx = pt.t < 0.5 ? pt.i : Math.min(pt.i + 1, track.pointCount - 1);
  const defs = new Map(OVERLAY_METRICS.map((d) => [d.id, d]));
  const cell = (text, colorToken, subText = null) =>
    `<span class="readout-cell${subText != null ? ' has-sub' : ''}"${colorToken ? ` style="color: var(${colorToken})"` : ''}>` +
    `<span class="readout-main">${text}</span>` +
    (subText != null ? `<span class="readout-sub">${subText}</span>` : '') +
    '</span>';
  const dash = '<span class="readout-cell is-empty">—</span>';
  const blank = '<span class="readout-cell is-blank"></span>';
  const unselected = `<span class="readout-cell is-unselected">${t('notSelected')}</span>`;
  const valueOf = (v) => (v != null && Number.isFinite(v) ? v : null);
  // Exactly the overlays the renderer draws — the band mirrors the chart.
  const shown = new Set(selectedOverlays.filter((id) => !hiddenOverlays.has(id)));
  const sensor = (id, v, hasSensor, subText = null) => {
    if (!shown.has(id)) return hasSensor ? unselected : blank;
    const def = defs.get(id);
    const val = valueOf(v);
    return val != null ? cell(formatOverlayValue(def, val), def.colorToken, subText) : dash;
  };

  const speedId = selectedOverlays.find(
    (id) => SPEED_FAMILY.includes(id) && !hiddenOverlays.has(id),
  ) ?? null;
  let speedSlot;
  if (speedId) {
    const speedCache = speedId === 'gap' ? gapSpeeds : speeds;
    const val = valueOf(speedCache?.[idx]);
    speedSlot = val != null
      ? cell(formatOverlayValue(defs.get(speedId), val), defs.get(speedId).colorToken)
      : dash;
  } else {
    // A speed series exists (recorded or derivable) but no family variant is
    // drawn; without one there is nothing to read at all.
    speedSlot = speeds != null ? unselected : blank;
  }
  // The HR zone label uses the same classification path as the desktop
  // tooltip and follows the SAME display toggles: it shows only while the
  // drawer's show-HR-zones toggle is on (the zone bands' gate), and with
  // zone highlight on it wears its zone-band color — the hue the profile deepens
  // under the probe. A reading below the Zone 1 lower bound belongs to no
  // zone → main value only.
  const hrVal = valueOf(track.points[idx].hr);
  let hrSub = null;
  if (hrVal != null) {
    const display = getHeartRateDisplay();
    if (display.showZones) {
      const bounds = computeZoneBounds(loadHeartRateSettings());
      if (bounds) {
        const zone = classifyHr(hrVal, bounds);
        if (zone > 0) {
          const zoneText = t('zoneN', { n: zone });
          hrSub = display.highlight
            ? `<span class="readout-zone-hl" style="color: var(--hr-zone-${zone})">${zoneText}</span>`
            : zoneText;
        }
      }
    }
  }
  const eleVal = valueOf(pt.ele);
  dom.readout.classList.remove('is-idle');
  dom.readout.innerHTML = [
    cell(xText),
    eleVal != null ? cell(formatElevation(eleVal)) : dash,
    speedSlot,
    sensor('hr', track.points[idx].hr, track.hasHr, hrSub),
    sensor('cad', track.points[idx].cad, track.hasCad),
    sensor('temp', track.points[idx].temp, track.hasTemp),
    sensor('power', track.points[idx].power, track.hasPower),
  ].join('');
}

/**
 * The readout for the current caller: x readout (distance or elapsed time) +
 * elevation, followed by the visible overlay readings (HR/speed/cadence) in
 * their series colors. Content is shared by every caller — desktop hover,
 * map hover, pinned waypoint and the mobile touch probe. `opts.probe` marks
 * the touch-probe call: it renders into the fixed band between the profile header and the chart (or,
 * where the band does not exist, floats the classic box above the profile
 * module's top edge — see the `.is-probe` rules in profile.css). While a
 * probe is active concurrent non-probe callers (a mouse hover on a hybrid
 * device) are ignored — the readout belongs to the probe.
 */
export function showTooltipAt(dist, xv = null, name = null, opts = null) {
  const { track, xMode, selectedOverlays, hiddenOverlays, speeds, gapSpeeds, view, xs, plot, dom } = state;
  const tooltip = dom.tooltip;
  if (!track || !tooltip) return;
  const isProbe = !!(opts && opts.probe);
  if (state.probe && !isProbe) return;
  const pt = pointAtDistance(track, dist);
  if (!pt) return;
  let xText;
  if (xMode === 'time' && track.hasTime) {
    let v = xv;
    if (v == null) {
      const time = pt.time != null ? pt.time : track.points[0].time;
      v = Math.max(0, time - track.points[0].time);
    }
    xText = formatDuration(v / 1000);
  } else {
    xText = formatDistanceShort(xv ?? dist);
  }

  if (isProbe && probeBandVisible()) {
    // Touch probe on a coarse-pointer device: the fixed 2×4 slot grid below
    // the chart (renderProbeBand). Independent of the selected overlays and
    // of the items list below — the grid reads the track's sensors directly.
    // The hover tooltip must not linger from a pre-probe mouse hover.
    tooltip.hidden = true;
    renderProbeBand(pt, xText);
    return;
  }

  // Every reading is tagged with its row for the floating probe fallback's
  // MOBILE layout (coarse-pointer devices render the fixed slot grid
  // instead):
  //   row 0 — [distance/time] [elevation]
  //   row 1 — [speed family] (speed / pace / GAP share one slot)
  //   row 2 — [heart rate]
  //   row 3 — [cadence] [temperature] [power]
  // A row whose reading is not selected, or whose sensor the track lacks,
  // collapses away entirely. The desktop hover keeps the flat
  // selection-order list.
  const items = [];
  const push = (row, html) => items.push({ row, html });
  const rowOf = (id) => (SPEED_FAMILY.includes(id) ? 1 : id === 'hr' ? 2 : 3);
  // Waypoint pin hovers lead with the pin's own name (raw file data — escaped).
  if (name) push(0, `<span style="color: var(--map-waypoint); font-weight: 600">${escapeHtml(name)}</span>`);
  push(0, `<span>${xText}</span>`);
  if (track.hasElevation && pt.ele != null) {
    push(0, `<span>${formatElevation(pt.ele)}</span>`);
  }
  // Nearest track point to the hover position carries the overlay readings.
  const idx = pt.t < 0.5 ? pt.i : Math.min(pt.i + 1, track.pointCount - 1);
  const defs = new Map(OVERLAY_METRICS.map((d) => [d.id, d]));
  for (const id of selectedOverlays) {
    if (hiddenOverlays.has(id)) continue;
    const def = defs.get(id);
    let v = null;
    if (id === 'hr') v = track.points[idx].hr;
    else if (id === 'cad') v = track.points[idx].cad;
    else if (id === 'temp') v = track.points[idx].temp;
    else if (id === 'power') v = track.points[idx].power;
    else if ((id === 'speed' || id === 'pace') && speeds) v = speeds[idx];
    else if (id === 'gap' && gapSpeeds) v = gapSpeeds[idx];
    if (id === 'hr' && (v == null || !Number.isFinite(v))) {
      // No reading under the cursor: say so instead of a stale zone.
      push(rowOf(id), `<span class="tip-ov" style="color: var(${def.colorToken})">${t('noHeartRateData')}</span>`);
      continue;
    }
    if (v == null || !Number.isFinite(v)) continue;
    let text = formatOverlayValue(def, v);
    // Heart-rate readings carry their zone label "147 bpm Zone 3" — but only
    // while the drawer's show-HR-zones toggle is on (the same gate as the
    // profile's zone bands); with zone highlight on, the label wears its zone-band
    // color, matching the deepened band under the crosshair. A reading below
    // the Zone 1 lower bound belongs to no zone — no label then.
    if (id === 'hr') {
      const display = getHeartRateDisplay();
      if (display.showZones) {
        const bounds = computeZoneBounds(loadHeartRateSettings());
        if (bounds) {
          const zone = classifyHr(v, bounds);
          if (zone > 0) {
            const zoneText = t('zoneN', { n: zone });
            text += display.highlight
              ? ` <span class="tip-zone-hl" style="color: var(--hr-zone-${zone})">${zoneText}</span>`
              : ` ${zoneText}`;
          }
        }
      }
    }
    push(rowOf(id), `<span class="tip-ov" style="color: var(${def.colorToken})">${text}</span>`);
  }

  if (isProbe) {
    // Floating fallback (fine-pointer devices): group the readings into
    // their fixed rows — each row renders as one block line, rows without
    // readings collapse.
    const rows = [];
    for (const { row, html } of items) {
      (rows[row] ??= []).push(html);
    }
    tooltip.innerHTML = rows.filter(Boolean)
      .map((row) => `<span class="tip-row">${row.join('<span class="tip-sep"> · </span>')}</span>`)
      .join('');
  } else {
    tooltip.innerHTML = items.map(({ html }) => html).join('<span class="tip-sep"> · </span>');
  }
  tooltip.hidden = false;
  // Tag BEFORE measuring: `.is-probe` fixes the box width (max-content,
  // capped at 50vw — see profile.css), so the clamp below works on the
  // width the box will actually render with.
  tooltip.classList.toggle('is-probe', isProbe);

  // The tooltip lives inside #profile-body (absolute) and therefore tracks
  // the workspace scroll natively — compositor-smooth, no scroll listeners;
  // the anchor below holds during scrolling without any JS. Horizontal
  // placement is clamped to the chart body in body coordinates.
  const rect = dom.root.getBoundingClientRect();
  const v0 = view ? view.start : 0;
  const v1 = view ? view.end : (xs ? xs[xs.length - 1] : 1);
  const pxRaw = ((xv ?? distToX(dist, track, xMode)) - v0) / Math.max(v1 - v0, 1e-9) * plot.w + plot.x0;
  const half = tooltip.offsetWidth / 2;
  const px = Math.min(Math.max(pxRaw, half + 2), rect.width - half - 2);
  tooltip.style.left = `${px}px`;
  if (isProbe) {
    // Probe fallback: the bottom edge sits on the profile module's top edge
    // — the map's bottom line — so the box covers Leaflet's scale bar and
    // attribution strip where they overlap (it out-stacks them,
    // --z-profile-tooltip), and the plot below stays unobstructed. What
    // pokes above the workspace scrollport is covered by the fixed app
    // header (--z-header). The pane-to-body offset is scroll-invariant
    // (both rects shift equally when the workspace scrolls), so this
    // anchor holds through scrolling with no repositioning.
    const paneTop = dom.root.parentElement.getBoundingClientRect().top - rect.top;
    tooltip.style.bottom = 'auto';
    tooltip.style.top = `${paneTop - tooltip.offsetHeight}px`;
  } else {
    // Hover: the stylesheet's bottom anchor (the x axis).
    tooltip.style.top = '';
    tooltip.style.bottom = '';
  }
}

/**
 * Puts the fixed telemetry band back into its idle state: the muted
 * "tap the chart" hint spanning the whole grid, same reserved height — no
 * layout shift when the probe's readings come and go. Called on probe
 * dismissal, track changes and whenever the probe leaves the visible window.
 */
export function resetProbeReadout() {
  const band = state.dom.readout;
  if (!band) return;
  band.classList.add('is-idle');
  band.innerHTML = `<span class="readout-hint">${t('profileTapHint')}</span>`;
}

/**
 * Hides the floating readout. Soft by default: while a touch probe is active
 * the pan/pinch/leave paths call this on every frame and must not extinguish
 * the probe's readout (the next sync re-shows it anyway). Only probe teardown
 * (dismissProbe clears the probe first) and the out-of-view probe pass in
 * `drawHover` hide for real. The fixed band is untouched here — its idle
 * state is `resetProbeReadout`'s job.
 */
export function hideTooltip(force = false) {
  if (state.probe && !force) return;
  const { tooltip } = state.dom;
  if (tooltip) tooltip.hidden = true;
}

/** Waypoint names come from file data — never trust them into HTML. */
function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}
