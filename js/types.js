/**
 * Shared JSDoc type definitions for WaySlice.
 *
 * The internal data model is format-agnostic: GPX, KML and KMZ parsers all
 * produce the same `TrackPoint` array. Fields reserved for future FIT / TCX
 * telemetry support are already declared here so the model does not have to
 * change later.
 *
 * @typedef {Object} TrackPoint
 * @property {number} lat                      WGS84 latitude, degrees.
 * @property {number} lon                      WGS84 longitude, degrees.
 * @property {number|null} [ele]               Elevation in meters (missing when the source has none).
 * @property {number|null} [time]              Unix timestamp in milliseconds (missing when the source has none).
 * @property {number|null} [hr]                Heart rate, bpm (reserved for FIT/TCX).
 * @property {number|null} [cad]               Cadence, rpm (reserved for FIT/TCX).
 * @property {number|null} [power]             Power, watts (reserved for FIT/TCX).
 * @property {number|null} [temp]              Temperature, °C (reserved for FIT/TCX).
 * @property {number|null} [speed]             Speed, m/s (reserved for FIT/TCX).
 * @property {number|null} [distance]          Cumulative distance, m (reserved for FIT/TCX).
 * @property {number|null} [lap]               Lap index (reserved for FIT/TCX).
 */

/**
 * A named location along the route (GPX `<wpt>`). Waypoints are annotations:
 * they never enter sector selection or metric math.
 *
 * @typedef {Object} Waypoint
 * @property {number} lat                      WGS84 latitude, degrees.
 * @property {number} lon                      WGS84 longitude, degrees.
 * @property {number|null} [ele]               Elevation in meters.
 * @property {number|null} [time]              Unix timestamp in milliseconds.
 * @property {string|null} [name]              Display name (null when the source has none).
 */

/**
 * A parsed file: the track point array plus any waypoints found next to it.
 *
 * @typedef {Object} ParsedFile
 * @property {TrackPoint[]} points             Track points, in file order.
 * @property {Waypoint[]} waypoints            Waypoints (empty when the format carries none).
 */

/**
 * A parsed track with derived geometry. `cumDist[i]` is the horizontal
 * (2D) distance in meters from the first point to point `i`, so the track can
 * be parameterized by distance for sector selection.
 *
 * @typedef {Object} Track
 * @property {string} name                     Display name (usually the file name).
 * @property {TrackPoint[]} points             Track points, in file order.
 * @property {Float64Array} cumDist            Cumulative horizontal distance per point, meters.
 * @property {number} totalDistance            Total horizontal distance, meters.
 * @property {{minLat:number, minLon:number, maxLat:number, maxLon:number}} bounds
 * @property {boolean} hasElevation            True when every point has a numeric elevation.
 * @property {boolean} hasTime                 True when every point has a numeric timestamp.
 * @property {boolean} hasHr                   True when at least one point carries a heart rate.
 * @property {boolean} hasCad                  True when at least one point carries a cadence.
 * @property {boolean} hasTemp                 True when at least one point carries a temperature.
 * @property {boolean} hasPower                True when at least one point carries a power.
 * @property {number|null} eleMin              Minimum elevation, meters (null when no elevation).
 * @property {number|null} eleMax              Maximum elevation, meters (null when no elevation).
 * @property {number} pointCount               Number of track points.
 * @property {Waypoint[]} waypoints            Waypoints from the same file (empty when none).
 */

/**
 * A selected sector, parameterized by horizontal distance along the track.
 * `start`/`end` are meters; they may fall between two track points, in which
 * case boundary points are interpolated.
 *
 * @typedef {Object} SectorRange
 * @property {number} start                    Distance of the sector start, meters.
 * @property {number} end                      Distance of the sector end, meters.
 */

/**
 * Computed metrics for a sector (or the whole track). Time metrics are null
 * when the track has no usable timestamps; elevation metrics are null when
 * the track has no elevations. Unavailable is never reported as 0.
 *
 * @typedef {Object} SectorMetrics
 * @property {number} horizontalDistance       2D surface distance, meters.
 * @property {number|null} distance3D          3D distance (horizontal + vertical), meters.
 * @property {number|null} effortDistance      Horizontal distance + gain ÷ 100, meters (null without elevation).
 * @property {number|null} gain                Elevation gain, meters, using a 3 m hysteresis filter: elevation change accumulates until it passes ±3 m, so sub-3 m noise never counts.
 * @property {number|null} loss                Elevation loss, meters (positive number), same 3 m hysteresis filter as gain.
 * @property {number|null} eleStart            Elevation at sector start, meters.
 * @property {number|null} eleEnd              Elevation at sector end, meters.
 * @property {number|null} eleMin              Minimum elevation in sector, meters.
 * @property {number|null} eleMax              Maximum elevation in sector, meters.
 * @property {number|null} netElevation        eleEnd - eleStart, meters.
 * @property {number|null} avgGrade            gain / horizontal distance, fraction (0.053 = 5.3 %); null when the sector only descends.
 * @property {number|null} maxGrade            Steepest ~50 m window, fraction.
 * @property {number|null} minGrade            Least steep / steepest descent window, fraction.
 * @property {number|null} elapsed             End time - start time, seconds.
 * @property {number|null} moving              Sum of segment durations outside pauses (speed < 0.5 km/h sustained ≥ 10 s), seconds.
 * @property {number|null} avgSpeed            Mean of per-segment moving speeds kept within μ ± 3σ (GPS spikes excluded), m/s.
 * @property {number|null} avgPace              Per-km inverse of the filtered average speed, seconds per kilometer.
 * @property {number|null} maxSpeed            Highest per-point speed in the sector after the source-based clean (5 s sliding-window smooth for recorded speeds, 3σ interpolation for computed ones) — the same series the elevation profile's speed curve draws, m/s.
 * @property {number|null} vam                 Vertical ascent speed, gain per hour of climbing time (the filtered elevation trend rising, pause seconds excluded), m/h.
 * @property {number|null} vdm                 Vertical descent speed, loss per hour of descending time (the filtered elevation trend falling, pause seconds excluded), m/h.
 * @property {number|null} avgHr               Mean heart rate over the sector's moving points after dropping values beyond ±3σ, bpm (null without hr data).
 * @property {number|null} maxHr               Highest moving-point heart rate within ±3σ of the sector's hr set, bpm (null without hr data).
 * @property {number|null} avgCad              Mean cadence over moving points within ±3σ, rpm (null without cadence data).
 * @property {number|null} maxCad              Highest moving-point cadence within ±3σ, rpm (null without cadence data).
 * @property {number|null} avgPower            Mean power over moving points within ±3σ, watts (null without power data).
 * @property {number|null} maxPower            Highest moving-point power within ±3σ, watts (null without power data).
 * @property {number|null} avgTemp             Mean temperature within ±3σ (pause readings included), °C (null without temperature data).
 * @property {number|null} minTemp             Lowest temperature within ±3σ, °C (null without temperature data).
 * @property {number|null} maxTemp             Highest temperature within ±3σ, °C (null without temperature data).
 * @property {{pace:number, dist:number}|null} fastestKm   Fastest sliding 1 km window (pause-free seconds/km).
 * @property {{pace:number, dist:number}|null} slowestKm   Slowest sliding 1 km window (pause-free seconds/km).
 * @property {number|null} timeStart           Unix timestamp (ms) at sector start.
 * @property {number|null} timeEnd             Unix timestamp (ms) at sector end.
 */

export {};
