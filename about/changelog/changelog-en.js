/**
 * English content pack — the changelog page's English version. Pure
 * content: the selection logic lives in changelog-lang.js, the same split
 * the story and privacy pages use.
 *
 * One section per day of the git history, newest first; the section
 * headings are the dates (YYYY-MM-DD) and the paragraphs summarize that
 * day's commits. Every entry mirrors what the commits actually did.
 */

export const CHANGELOG_EN = {
  htmlLang: 'en',
  title: 'WaySlice — Changelog',
  heading: 'Changelog',
  tagline: 'Telemetry for every way. Sliced.',
  lede: 'What changed in the analyzer, day by day.',
  sections: [
    {
      h: '2026-10-05',
      ps: [
        'The satellite overlay\'s spring landmark now draws as a single water droplet filling its icon box — the ripple line beneath is gone — so the shape still reads unmistakably as water at the smallest sizes.',
        'The cave-entrance landmark\'s arch now rises higher (radius 6 → 7.5), keeping the low mouth-over-ground-line shape clearly legible at the smallest zooms.',
        'The natural landmark icons\' ink recipe now draws a cooler near-black halo and a white stroke that keeps 5% transparency — a subtly finer look with shapes and sizes unchanged.',
        'Small landmark queries on the satellite overlay now remember the mirror that answered last and try it first, and a mirror that stays silent for three seconds is raced in parallel by the next one — each mirror carries its own timeout, so on unstable or restricted networks the landmarks appear faster instead of waiting behind one dead mirror.',
        'With the whole track selected the map no longer paints the orange highlight on top of the blue track line — the track shows in its own color by default, and the orange highlight appears only once an actual sub-range is selected. Skipping that redundant full-length duplicate also makes every track load lighter.',
        'The range highlight is now carved from the same simplified line the map draws for the track, so it hugs the track exactly at every zoom instead of wandering off it where the two lines used to diverge, and a range change builds a fraction of the geometry it did before.',
        'The track line and its range highlight are now thinned by the same even stride — one linear pass that keeps a uniform sample of the raw recording — so long runs and hikes render closer to what was actually recorded, and range changes build less geometry still.',
      ],
    },
    {
      h: '2026-10-04',
      ps: [
        'The satellite road overlay now draws natural landmarks: peaks, saddles, volcanoes, cave entrances, springs, rocks and stones join the same Roads toggle — no new switch, always beneath your track. Icons appear first at each zoom, names and elevations follow, and elevations always render in your units.',
        'The landmark data follows the real OSM terrain: summits come straight from the overlay\'s existing vector tiles with their importance ranking, while the smaller landmarks (cave entrances, springs, rocks, stones) load once per viewport area and are cached — names and elevations are optional in OSM, so a landmark renders with whatever it has, never filtered away for missing fields.',
        'Zooming in past the road tiles\' own detail limit no longer drops the summits: above that zoom the landmark set only ever grows, so the peak you zoomed into stays on the map, and returning to the tile-supported zooms restores the tile-truth set.',
        'A landmark you have already seen keeps its place while you zoom closer: once drawn, a summit is no longer squeezed out by better-ranked neighbours — small landmarks like rocks and stones never get this boost — while zooming back out still hides everything by the usual size rules.',
        'Peak and volcano icons now form one solid triangle family — the plain summit triangle against the flat-topped crater cone with eruption marks — distinguishable by shape alone, so the pair stays recognizable in grayscale and at the smallest sizes; the volcano adds the chart\'s heart-rate red as a secondary cue (fixed, identical in both themes).',
        'Natural landmark labels now follow the overlay\'s bilingual convention: the raw local name joins the main name as a same-size second line whenever it differs, stacked above the elevation.',
        'Toggling the Roads overlay back on no longer risks blank landmarks: the natural layer now rides the same restack as the road layers on every re-enable, keeping it above the imagery and beneath the track.',
        'The small landmarks\' viewport queries now walk a wider Overpass mirror chain (private.coffee, the mail.ru mirror, the project\'s z and lz4 instances, rambler) — the canonical endpoint\'s rate limits no longer gate their arrival.',
        'Map labels on the satellite road overlay draw 1.25× larger at every zoom — road names and settlement names alike — so they read comfortably against the imagery.',
        'The satellite road overlay gained a full road symbol system: every major road now draws with a dark casing beneath the white line, so roads keep their edge on bright imagery, with graduated widths per road class from the continent zooms (z5) down to z19.',
        'The overlay now distinguishes the small roads: minor roads draw as hairlines from z9, service roads (park and scenic-area loops, parking aisles) as thin faint lines from z13, and tracks (forest and farm roads) as a long dash that clearly reads coarser than the short-dashed walking paths.',
        'Overlay labels repainted and broadened: road names render dark with a white halo riding the white roads (place names stay white with a dark halo on the imagery), every named road labels regardless of class — trail names included — falling back to the route number when a road has no name, and place names start at z3 across the full seven-class settlement hierarchy.',
      ],
    },
    {
      h: '2026-10-03',
      ps: [
        'Switching between satellite basemaps no longer buries the road overlay: the fresh imagery restacks beneath the road network on every basemap change.',
        'The road-network toggle now reads simply "Roads" in every language.',
        'The road-network toggle is now remembered: its state lives in localStorage like the basemap choice, surviving reloads and basemap switches — a non-satellite basemap only suspends it until a satellite one returns.',
        'The road-network toggle\'s pressed state now paints the accent tint over its opaque elevated panel — the imagery no longer shows through — and hover and active deepen the tint and lift the shadow instead of falling back to the neutral button style.',
        'The road overlay now draws tunnels too: a dimmed dashed line beneath the surface roads from the street-detail zooms, so a route through a mountain shows where it goes underground.',
        'The map no longer shows the scale bar in its bottom-left corner.',
        'Satellite basemaps gained a hybrid view: the new road-network toggle at the map area\'s top-left draws vector roads, road names and place labels over the imagery, always beneath your track. The toggle is only active on a satellite basemap, switching basemaps turns it off, and the overlay reuses OpenFreeMap\'s keyless road tiles.',
        'Overlay labels are bilingual: the primary name follows the selected UI language (name:xx, then English, international, Latin and the raw local name), and where the local name differs it joins at the same size — stacked as a second line for place names, on one line for road names; a localized name that already is the local name never repeats.',
        'The elevation profile is now rendered by the uPlot chart library, which is lazy-loaded on the first imported track — opening the app downloads nothing of it.',
        'The profile chart draws the complete raw track series: the per-pixel-column downsampling was removed, so narrow spikes render at full amplitude and the overlay axis strip always reads the same values as the metrics list.',
        'The elevation profile is drawn as a line only: the translucent area fill below the curve is gone.',
        'The privacy statement now names the current basemap providers — OpenTopoMap and CyclOSM included — and the open-source note names the MIT license. The story page no longer mentions the removed per-pixel-column downsampling.'
      ],
    },
    {
      h: '2026-10-02',
      ps: [
        'The elevation profile header keeps its loaded height before a track is imported, so the icon and title no longer shift when one loads.',
        'The map area in the mobile layout keeps the height it shows before a track is imported instead of shrinking once one loads.',
      ],
    },
    {
      h: '2026-10-01',
      ps: [
        'Added a "Fit to sector" view control button: one click zooms the x axis so the selected sector fills about 82% of the visible range.',
        'Reworked the elevation profile toolbar around four measured responsive levels: the toolbar never wraps and never shrinks a control below its hit area.',
        'The Distance/Time toggle keeps its labels the longest, and low-priority actions move into a "More" panel as the same buttons.',
        'Touch hit areas grew to at least 44px, with no visual change.',
      ],
    },
    {
      h: '2026-09-30',
      ps: [
        'The settings drawer was rebuilt as an accordion: its five groups (theme, language, units, heart-rate zones, about) toggle independently and start collapsed on every open.',
        'The group titles now match the selected list rows in size and color.',
      ],
    },
    {
      h: '2026-09-28',
      ps: [
        'The entire codebase was simplified.',
        'The monolithic components.css was split into per-component stylesheets.',
        'The mobile view was refined for the state before a track is imported.',
        'The Privacy and Changelog pages were added.',
      ],
    },
    {
      h: '2026-09-27',
      ps: [
        'Website colors now meet the WCAG requirements.',
        'Waypoint markers became keyboard-reachable buttons.',
        'Sector handles are glued to the track line for the whole drag.',
        'The waypoint hover line is back on the profile.',
        'The map\'s marker and control stacking was restored.',
        'The zoom buttons and the map control buttons share one style.',
      ],
    },
    {
      h: '2026-09-26',
      ps: [
        'EOX Sentinel-2 Cloudless 2025 imagery was added.',
        'OpenFreeMap\'s Positron, Bright and Dark styled maps were added.',
        'The Stadia OSM Bright map was added.',
        'The Thunderforest World Map switched to the Vector Styles API.',
      ],
    },
    {
      h: '2026-09-25',
      ps: [
        'The map was ported from Leaflet 1.9.4 to MapLibre GL JS, and lazy loading was implemented for a lighter first paint.',
        'Stadia tile requests are sent only to EU-hosted servers for GDPR.',
        'The Mapy Aerial map was added.',
        'The Stadia satellite imagery was removed.',
        'The app was retitled Track Sector Analyzer across its title and share metadata.',
      ],
    },
    {
      h: '2026-09-24',
      ps: [
        'The mobile touch probe gained its marker on the map, with the tap regions that add and remove it unified, and the mobile map row\'s floor rose so the map button column never overlaps the zoom controls.',
      ],
    },
    {
      h: '2026-09-18',
      ps: [
        'The mobile metrics pane no longer paints the body background below its box — the background split between pane and page is gone on phones.',
      ],
    },
    {
      h: '2026-09-17',
      ps: [
        'The dual-variable analysis is computed only on the selected sector. It now reads exactly what the metrics panel reads.',
      ],
    },
    {
      h: '2026-09-16',
      ps: [
        'Initial commit: the analyzer as a static, no-build web app of plain ES modules.',
        'SEO infrastructure was implemented so that more people can find this website.',
      ],
    },
  ],
};
