/**
 * Locale-aware value formatting.
 *
 * Every number the app DISPLAYS goes through this module — the metrics panel,
 * the auto-split segment details, the elevation profile axes and tooltip, the
 * map readouts and the TXT/Markdown exports all call the same formatters, so
 * an export always matches what the page renders.
 *
 * Two layers stay separate by design:
 *   raw value → unit conversion (units.js) → formatted number (here)
 *   → localized unit label
 * Analysis data is always the raw SI number, never a formatted string.
 *
 * Number localization is wired but NOT enabled: every formatter reads the UI
 * locale from language.js (getLocale()), and all five shipped languages use
 * the dot decimal separator, so output is unchanged. The seam for future
 * locales is `formatNumber(value, locale)` — it accepts an explicit BCP 47
 * tag (`formatNumber(4.88, 'de-DE')` → `'4,88'`) for previews and tests;
 * enabling locale-aware output app-wide then means pointing getLocale() at a
 * number locale, with no analysis or call-site changes.
 *
 * Pace (min:sec per km) and durations are formatted manually since Intl has
 * no duration unit style worth the fuss. Unit labels come from the language
 * packs via units.js's locale-aware getters (native sport-app names in
 * Chinese, international abbreviations elsewhere; % and °C/°F stay symbolic
 * everywhere) and stay outside the number. GPX export deliberately does NOT
 * go through this module: its values are machine data in canonical form.
 */
import { getLocale } from '../language/language.js';
import {
  getUnitSystem,
  metersToFeet,
  metersToMiles,
  mpsToMph,
  secPerKmToSecPerMi,
  METERS_PER_MILE,
  distanceUnit,
  shortDistanceUnit,
  elevationUnit,
  speedUnit,
  paceUnit,
  vamUnit,
  bpmUnit,
  rpmUnit,
  powerUnit,
  percentUnit,
  tempUnit,
} from '../units/units.js';

const cache = new Map();

/** @private Pass an explicit locale to preview a locale's conventions. */
function nf(options, locale = getLocale()) {
  const key = locale + JSON.stringify(options);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, options);
    cache.set(key, f);
  }
  return f;
}

/**
 * Raw number → string, with no unit and no domain policy — the seam future
 * number localization routes through. Reads the UI locale unless one is
 * passed explicitly.
 * @param {number} value
 * @param {string} [locale]  BCP 47 tag, e.g. 'de-DE' formats 4.88 as "4,88".
 */
export function formatNumber(value, locale = getLocale()) {
  if (!Number.isFinite(value)) return '—';
  return nf({}, locale).format(value);
}

/**
 * Horizontal/3D distance: meters below ~1 km, kilometers above; imperial
 * switches feet→miles at one MILE (5280 ft), not at 1 km.
 * @param {number} meters
 */
export function formatDistance(meters) {
  if (!Number.isFinite(meters) || meters < 0) return '—';
  if (getUnitSystem() === 'imperial') {
    if (meters < METERS_PER_MILE) return `${nf({ maximumFractionDigits: 0 }).format(metersToFeet(meters))} ${shortDistanceUnit()}`;
    const digits = meters < 160934.4 ? 2 : 1;
    return `${nf({ maximumFractionDigits: digits }).format(metersToMiles(meters))} ${distanceUnit()}`;
  }
  if (meters < 1000) return `${nf({ maximumFractionDigits: 0 }).format(meters)} ${shortDistanceUnit()}`;
  const digits = meters < 100_000 ? 2 : 1;
  return `${nf({ maximumFractionDigits: digits }).format(meters / 1000)} ${distanceUnit()}`;
}

/** Short distance for axis ticks / range readouts. @param {number} meters */
export function formatDistanceShort(meters) {
  if (!Number.isFinite(meters) || meters < 0) return '—';
  if (getUnitSystem() === 'imperial') {
    if (meters < METERS_PER_MILE) return `${nf({ maximumFractionDigits: 0 }).format(metersToFeet(meters))} ${shortDistanceUnit()}`;
    return `${nf({ maximumFractionDigits: 2 }).format(metersToMiles(meters))} ${distanceUnit()}`;
  }
  if (meters < 1000) return `${nf({ maximumFractionDigits: 0 }).format(meters)} ${shortDistanceUnit()}`;
  return `${nf({ maximumFractionDigits: 2 }).format(meters / 1000)} ${distanceUnit()}`;
}

/**
 * The two boundary readouts of a sector range — ALWAYS one unit for the
 * pair, chosen by the segment's own length (end − start): metric below
 * 1 km reads both ends in whole meters, at 1 km and above both in
 * kilometers with two decimals; imperial below one MILE (5280 ft) reads
 * both ends in whole feet, at a mile and above both in miles with two
 * decimals — so a range line never mixes units. Shared by the metrics
 * panel's "A → B" line and the text exports' range line, so an export
 * always matches the panel.
 * @param {number} start  meters along the track
 * @param {number} end    meters along the track
 * @returns {[string, string]}
 */
export function formatSectorRangeBounds(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < 0) return ['—', '—'];
  if (getUnitSystem() === 'imperial') {
    if (end - start < METERS_PER_MILE) {
      const whole = nf({ maximumFractionDigits: 0 });
      return [`${whole.format(metersToFeet(start))} ${shortDistanceUnit()}`, `${whole.format(metersToFeet(end))} ${shortDistanceUnit()}`];
    }
    const two = nf({ maximumFractionDigits: 2 });
    return [`${two.format(metersToMiles(start))} ${distanceUnit()}`, `${two.format(metersToMiles(end))} ${distanceUnit()}`];
  }
  if (end - start < 1000) {
    const whole = nf({ maximumFractionDigits: 0 });
    return [`${whole.format(start)} ${shortDistanceUnit()}`, `${whole.format(end)} ${shortDistanceUnit()}`];
  }
  const two = nf({ maximumFractionDigits: 2 });
  return [`${two.format(start / 1000)} ${distanceUnit()}`, `${two.format(end / 1000)} ${distanceUnit()}`];
}

/** Elevation with sign for gain/loss (+684 m / -102 m). @param {number} meters */
export function formatSignedElevation(meters) {
  if (!Number.isFinite(meters)) return '—';
  const sign = meters > 0 ? '+' : meters < 0 ? '−' : '';
  const value = getUnitSystem() === 'imperial' ? metersToFeet(Math.abs(meters)) : Math.abs(meters);
  return `${sign}${nf({ maximumFractionDigits: 0 }).format(value)} ${elevationUnit()}`;
}

/** Plain elevation. @param {number} meters */
export function formatElevation(meters) {
  if (!Number.isFinite(meters)) return '—';
  const value = getUnitSystem() === 'imperial' ? metersToFeet(meters) : meters;
  return `${nf({ maximumFractionDigits: 0 }).format(value)} ${elevationUnit()}`;
}

/** Grade as percentage, e.g. 5.3 %. @param {number} grade fraction (0.053) */
export function formatGrade(grade) {
  if (!Number.isFinite(grade)) return '—';
  return `${nf({ maximumFractionDigits: 1 }).format(grade * 100)}${percentUnit()}`;
}

/** Speed m/s → km/h. @param {number} mps */
export function formatSpeed(mps) {
  if (!Number.isFinite(mps)) return '—';
  const value = getUnitSystem() === 'imperial' ? mpsToMph(mps) : mps * 3.6;
  return `${nf({ maximumFractionDigits: 1 }).format(value)} ${speedUnit()}`;
}

/** Seconds per km → "7:42 /km". @param {number} secPerKm */
export function formatPace(secPerKm) {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return '—';
  const seconds = getUnitSystem() === 'imperial' ? secPerKmToSecPerMi(secPerKm) : secPerKm;
  return `${formatDuration(seconds)} ${paceUnit()}`;
}

/** VAM is calculated in m/h internally, then converted only for display. */
export function formatVam(metersPerHour) {
  if (!Number.isFinite(metersPerHour)) return '—';
  const value = getUnitSystem() === 'imperial' ? metersToFeet(metersPerHour) : metersPerHour;
  return `${nf({ maximumFractionDigits: 0 }).format(value)} ${vamUnit()}`;
}

/** Heart rate: beats per minute — same in both unit systems. */
export function formatBpm(bpm) {
  if (!Number.isFinite(bpm)) return '—';
  return `${nf({ maximumFractionDigits: 0 }).format(bpm)} ${bpmUnit()}`;
}

/**
 * Heart-rate zone range from the zone's continuous bounds: [lo, hi) reads as
 * "133–151 bpm", an open-top zone as "171+ bpm". Shared by the metrics panel,
 * the zone editor and the text exports.
 * @param {number} lo
 * @param {number|null} hi
 */
export function formatBpmRange(lo, hi) {
  return hi == null
    ? `${formatInt(lo)}+ ${bpmUnit()}`
    : `${formatInt(lo)}–${formatInt(hi)} ${bpmUnit()}`;
}

/**
 * A value already expressed in PERCENT units → "42%" (42.6 rounds to "43").
 * Used for zone shares and the zone editor's boundary labels; grade goes
 * through formatGrade instead because its input is a fraction (0.053).
 * @param {number} value
 */
export function formatPercent(value) {
  if (!Number.isFinite(value)) return '—';
  return `${nf({ maximumFractionDigits: 0 }).format(value)}${percentUnit()}`;
}

/** Cadence: revolutions per minute — same in both unit systems. */
export function formatRpm(rpm) {
  if (!Number.isFinite(rpm)) return '—';
  return `${nf({ maximumFractionDigits: 0 }).format(rpm)} ${rpmUnit()}`;
}

/**
 * Ambient temperature. SI math (°C); Imperial display converts to °F.
 * One decimal in Celsius — the half-degree differences between files read
 * better unrounded — and whole degrees in Fahrenheit.
 */
export function formatTemp(celsius) {
  if (!Number.isFinite(celsius)) return '—';
  if (getUnitSystem() === 'imperial') {
    const f = (celsius * 9) / 5 + 32;
    return `${nf({ maximumFractionDigits: 0 }).format(f)} ${tempUnit()}`;
  }
  return `${nf({ maximumFractionDigits: 1 }).format(celsius)} ${tempUnit()}`;
}

/** Power: watts — same in both unit systems. */
export function formatPower(watts) {
  if (!Number.isFinite(watts)) return '—';
  return `${nf({ maximumFractionDigits: 0 }).format(watts)} ${powerUnit()}`;
}

/** Seconds → h:mm:ss (or m:ss below one hour). @param {number} seconds */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Unix ms → [short date] [short time] in the SYSTEM locale — the OS-wide
 * "short date" + "short time" pair (e.g. "2026/8/31 07:12" or "8/31/26,
 * 7:12 AM"). Deliberately not the UI locale: wall-clock timestamps read
 * best in the format the user's machine uses everywhere else.
 * @param {number} ms
 */
let systemDateTimeFormat = null;
export function formatDateTime(ms) {
  if (!Number.isFinite(ms)) return '—';
  if (!systemDateTimeFormat) {
    systemDateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' });
  }
  return systemDateTimeFormat.format(new Date(ms));
}

/** Integer with locale group separators. @param {number} value */
export function formatInt(value) {
  if (!Number.isFinite(value)) return '—';
  return nf({ maximumFractionDigits: 0 }).format(value);
}
