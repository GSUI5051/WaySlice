/**
 * English language pack — the story page's English version, the fallback for
 * every non-Chinese interface language (only
 * these two language files exist). Pure content: the selection logic lives
 * in story-lang.js.
 *
 * Structure mirrors the Chinese pack section for section, paragraph for
 * paragraph, so the two versions stay in lockstep. 
 * Every factual claim mirrors what the app actually does.
 */

export const STORY_EN = {
  htmlLang: 'en',
  title: 'WaySlice — Story',
  heading: 'WaySlice',
  tagline: 'Telemetry for every way. Sliced.',
  lede: 'The story behind the analyzer, told by its author.',
  sections: [
    {
      h: 'What is WaySlice?',
      ps: [
        'An open-source, pure-frontend activity data analyzer for GPX / FIT / TCX / KML / KMZ files.',
        'The analyzer brings the concept of telemetry into outdoor activity data analysis — an analysis method long proven in other fields.',
        'It is built around sector-based analysis: a whole track tells you what happened, a sector tells you where it happened. You can read a sector’s data the same way you read the data of a whole track.',
        'The dual-variable analysis describes how your body reacts to external conditions, and how efficient your body turns energy into performance — the relationship between speed and grade, or between heart rate and pace.',
        'Hence the tagline: Telemetry for every way. Sliced.',
        'I hope you will analyze your own outdoor activity data the way an engineer analyzes motorsport telemetry or QAR (Quick Access Recorder) data in aviation.',
      ],
    },
    {
      h: 'Where did WaySlice come from?',
      ps: [
        'The starting point was simple: know more about a climb, a descent of an outdoor activity. That became the Track → Select Sector → Analyze Sector flow.',
        'Later, thinking of motorsport telemetry and QAR (Quick Access Recorder) data in aviation, came the attempt to apply telemetry analysis methods to outdoor activity data.',
        'The UI/UX design and the browser-based architecture come from pure-frontend web-based games. They prove that a browser can host a complex analysis system, run it smoothly, and even tailor the web interface to desktop and mobile.',
      ],
    },
    {
      h: 'What is a sector?',
      ps: [
        'Any two points of an outdoor activity bound a sector — the entire activity itself can also be a single sector.',
        'Typical sectors: the route between two waypoints, or a climb, a descent, a flat stretch.',
      ],
    },
    {
      h: 'Why slice first, then analyze?',
      ps: [
        'The entire track is the complete record of an outdoor activity; sector analysis is what brings the questions to light. To understand an outdoor activity in depth, slice it into climbs, descents, and waypoint-to-waypoint sections, then analyze them.',
        'Comparing the first sectors with the last ones also reveals your pacing strategy: natural fade, strict even pacing, even a negative split (a faster second half).',
      ],
    },
    {
      h: 'Why WaySlice?',
      ps: [
        'Traditional activity analysis: total distance, total time, elevation gain/loss, average and maximum heart rate, average and best pace … all of it belongs to the entire track only.',
        'WaySlice: complete analysis of the entire track or any sector, by distance or by time. Dual-variable plot applies to the entire track or any sector just the same.',
      ],
    },
    {
      h: 'Why telemetry?',
      ps: [
        'Reading motorsport telemetry to analyze a sector of a lap, even a turn; reading aviation telemetry to analyze a phase of a flight; reading the telemetry WaySlice presents, analyze a part of an outdoor activity — climbs, descents, and routes between waypoints.',
        'Analysis methods long proven in other fields, applied to outdoor activity data: treat a GPX/TCX/FIT/KML/KMZ file as what it is — a sequence of measurements that can be sliced and analyzed.',
      ],
    },
    {
      h: 'What gets analyzed?',
      ps: [
        'Spatial data: horizontal distance, the track, the map, the elevation profile, waypoints, sectors.',
        'Temporal data: total time, moving time, pace/speed.',
        'Physiological data: heart rate, cadence, temperature, power.',
        'Derived data: grade, GAP, 3D distance, effort distance, elevation gain/loss, climb/descent rate.',
      ],
    },
    {
      h: 'How is real outdoor activity data handled?',
      ps: [
        'Tracks with 100,000+ points stay smooth: Douglas–Peucker and per-pixel sampling simplify the display only — every metric is always computed from the full data.',
        'For the noise in GPS altitude and barometric altitude there is the 3 m threshold filter on climbs; for device positioning drift there is speed spike cleaning; for supply stops and mid-route rests there is pause detection.',
        'Raw records do not turn into reliable analysis on their own. WaySlice does the post-processing of outdoor activity data, and the post-processing steps it applies are written into hints visible to the user.',
        '3D distance and horizontal distance are computed separately, so grade, the profile and GAP stand on a correct basis. GAP uses the classic model proposed by Minetti in 2002, no commercial model.',
        'Data the device never recorded reads as honestly "no data" — a limitation of the device, not a defect of the app.',
        'The dual-variable analysis draws a two-dimensional density heatmap instead of a plain X-Y scatter plot: a hundred thousand points overlap into an ink blot in a scatter, while the heatmap reveals the structure between them.',
      ],
    },
    {
      h: 'Privacy?',
      ps: [
        'The analyzer itself needs no server, nothing needs to be uploaded, and there is no need to collect user data.',
        'Everything happens in your own browser: File → Browser → Parse → Analyze → Render. All settings live in your own browser too.',
        'The only network-dependent feature is loading map tiles from the map providers\' servers.',
      ],
    },
    {
      h: 'Design principles?',
      ps: [
        'A fully offline web app: a natural fit for offline and privacy-sensitive scenarios — open and use, no complex deployment procedures.',
        'UI/UX design: built around "sector-based analysis + telemetry", shaped by how desktops and phones are actually used.',
        'Multilingual by design: the world\'s lingua franca and your own mother language.',
        'The multilingual architecture borrows from the localization scheme of web-based games, and completeness validation check gives users of every language exactly the same experience.',
        'UI language and unit system are independent: a Chinese interface with imperial units, or an English interface with metric ones — whichever you are used to.',
      ],
    },
    {
      h: 'Why open-source?',
      ps: [
        'Making every outdoor enthusiast and every athlete can read each outdoor activity more deeply.',
        'Making more people learn that the word "telemetry" can also used in outdoor activities.',
        'The project itself is already very complete, but for real outdoor data, there is always a better algorithm to adopt.',
      ],
    },
    {
      h: 'Future improvements?',
      ps: [
        'A better speed spike cleaning algorithm, to cope with device positioning drift and sparse sampling.',
        'A better grade detection algorithm.',
      ],
    },
    {
      h: 'Special thanks',
      ps: [
        'The analyzer was inspired by the Trail Running Movement article "GPS data analysis in trail running: how to interpret it".',
        'Thanks to the providers of GPX / FIT / TCX / KML / KMZ files and track data.',
        'Thanks to everyone who supports the maintenance and hosting of this project.',
      ],
    },
  ],
};
