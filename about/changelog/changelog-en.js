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
      h: '2026-10-10',
      ps: [
        'The overlays popup now opens as a dropdown right under the Overlays button, right-aligned with it. It used to pin itself to the toolbar row at the window\'s right edge, hanging over the metrics panel away from its own trigger.',
        'Both the map-source picker and the overlays picker now follow the page layout. While the page shows its single-column layout the two open as a full-width list docked to the bottom of the screen with a backdrop, and on the wide layout they open as dropdowns. The map-source picker used to keep the dropdown form all the way down to 720 px, floating free of its button across the tablet range in between.',
        'On the wide layout the overlays dropdown caps its height at the bottom of the viewport. Deep browser zoom or a short window used to let it run past the screen edge, where the app clips and the lower rows were out of reach; the rows now scroll inside the panel, driven by the mouse wheel and by touch swipes alike.',
        'In dropdown mode both panels hug their longest row instead of a fixed width, so each language renders at its own width.',
        'The elevation profile no longer re-draws the curve for the selected sector. The elevation curve now renders in the accent color at one constant stroke width in every state, and the span outside the handles is simply dimmed by the translucent veils; the separate orange highlight over the selected span and the gray outside it are gone.',
        'Outside a selected sector the chart curves and grid lines now dim to 70 percent opacity in their own colors, and the translucent veils that used to darken everything outside the handles are gone. The axes, tick labels and zone bands keep full strength everywhere, and the curves stay at one constant stroke width through the boundary.',
        'The hovered heart-rate zone band deepens again while the pointer or the touch probe moves across zones, and the zone bands appear and disappear again with the zone toggles in the settings drawer. They draw inside the chart redraw cycle, which hover moves and toggles no longer reached since the chart moved to uPlot.',
        'The sector handles no longer block hover telemetry. Moving the pointer across a handle shows the crosshair and its readings there like everywhere else on the chart. A boundary drag starts when the pointer is pressed inside a handle\'s hit area and stays locked until the button is released, with the hover crosshair out of the way while the drag runs.',
      ],
    },
    {
      h: '2026-10-09',
      ps: [
        'Waterfalls now join the natural landmarks, over satellite imagery and on the vector basemaps alike. OSM tags them waterway=waterfall rather than natural=waterfall, so the overlay queries that tag, with the rare natural=waterfall alias alongside it. The waterfall shares the spring\'s entry zoom, so the two water features appear together, and its icon is the OSM wiki\'s waterfall glyph, filled white like the summit icons.',
        'The elevation profile\'s toolbar buttons now sit in a new order, in the row and in the More panel alike.',
      ],
    },
    {
      h: '2026-10-08',
      ps: [
        'Natural landmarks now draw on the OpenFreeMap, Stadia Maps and Thunderforest World Map basemaps too: peaks, saddles, volcanoes, cave entrances, springs, rocks and stones, with names and elevations. They used to appear only over satellite imagery, as part of the road overlay. The same map button toggles the landmarks there; its icon and title change with the basemap, the choice is remembered on its own and defaults to on, and on the plain raster maps the button stays disabled because their tiles already carry their own peak markers.',
        'The elevation profile\'s axis labels now repaint immediately when the language or the unit system changes. The chart used to keep the previous language\'s or unit\'s tick strings on screen until a data change forced a full redraw.',
        'The elevation profile\'s horizontal grid now lands on whole units of the active system: whole miles at a mile and up and whole hundreds of feet below it under imperial, whole meters and kilometers under metric. A metric grid converted for display used to read as 1.24 miles per division.',
        'In time mode the horizontal grid now steps in whole minutes and hours (15:00, 1:00:00, 2:00:00) instead of decimal-time fractions such as 1:23:20.',
        'The elevation profile\'s y-axis gutter now widens to fit its longest label, so extreme-altitude tracks keep their leading digits: the old fixed-width gutter clipped grouped five-digit feet readings such as 29,032 ft.',
        'The dual-variable analysis\'s elevation axis draws its tick labels and gridlines under imperial units again: a reversed meters–feet conversion used to push every tick past the chart edge, leaving the axis blank.',
        'Dragging and swiping the elevation profile now keeps up with the pointer on long tracks. The sector highlight used to draw one path segment per recorded point — 92,000 segments a frame on a long route; on dense spans it now draws per-pixel min/max bars instead, the rule uPlot applies to the curves underneath, so a frame follows the chart width rather than the point count. The data itself stays full-resolution.',
        'The metrics panel now recalculates at a calmer pace while a sector boundary is being dragged, and settles to the exact values the moment the drag ends. Dragging a boundary across a 90,000-point track used to stutter the chart and the map.',
      ],
    },
    {
      h: '2026-10-07',
      ps: [
        'Waypoints are now matched to the track before anything renders. Each waypoint lands on its nearest spot along the route, and the list is ordered by that distance, so a file that lists its waypoints out of order still shows them along the track.',
        'A waypoint farther than 50 m from the track is left out entirely: no pin on the map, no line on the elevation profile, no boundary in the CP-to-CP table.',
        'GPX files that carry a <rte> route instead of a recorded <trk> track now load. Race websites hand out this form. The route points enter the same pipeline as track points, so the map line, the distance, the elevation profile, gain and loss, sectors and waypoints all work as usual.',
        'Route files never invent activity data. Time, speed, pace, heart rate and cadence stay unavailable and say so. A warning square next to the file chip explains why: the file is a route rather than a recording, and clicking it shows the full notice. A file with both forms uses the track and ignores the route.',
      ],
    },
    {
      h: '2026-10-06',
      ps: [
        'The pinned waypoint now stands out on the map: its marker wears a pushpin badge filled in the waypoint purple, outlined in the same border color as every waypoint, with the needle planted on the marker\'s center. The badge follows a new pin and disappears when the pin clears, so the pinned spot reads at a glance.',
        'The elevation profile\'s pinned waypoint line no longer blocks the chart\'s hover: moving the mouse across the chart shows the cursor\'s own readings again, and hovering another waypoint pin on the map borrows the violet line for that waypoint while it lies inside the zoomed window. The pinned line steps aside during the hover and returns when the pointer leaves. The pin itself still clears only on the next click anywhere.',
        'The auto-split segment details now list their rows in the metrics panel\'s order: Distance, 3D Distance, Effort Distance, Elevation Gain and Loss, Average Grade, Average GAP, VAM, VDM, Average Heart Rate, Maximum Heart Rate, then the heart-rate zones. Distance, Average Grade and the two heart-rate rows were missing from the sheet entirely before.',
      ],
    },
    {
      h: '2026-10-05',
      ps: [
        'The satellite overlay\'s spring landmark now draws as a single water droplet filling its icon box and the ripple line beneath is gone, so the shape still reads as water at the smallest sizes.',
        'The cave-entrance landmark\'s arch now rises higher (radius 6 → 7.5), keeping the low mouth-over-ground-line shape clearly legible at the smallest zooms.',
        'The natural landmark icons now draw a cooler near-black halo and a white stroke with 5% transparency, a subtly finer look with shapes and sizes unchanged.',
        'Small landmark queries on the satellite overlay now remember the mirror that answered last and try it first. A mirror that stays silent for three seconds is raced in parallel by the next one, and each mirror carries its own timeout, so on unstable or restricted networks the landmarks appear faster instead of waiting behind one dead mirror.',
        'With the whole track selected the map no longer paints the orange highlight on top of the blue track line, so the track shows in its own color by default. The orange highlight now appears only once an actual sub-range is selected, and skipping that redundant full-length duplicate makes every track load lighter.',
        'The range highlight is now carved from the same simplified line the map draws for the track, so it hugs the track exactly at every zoom. The two lines no longer diverge, and a range change builds a fraction of the geometry it did before.',
        'The track line and its range highlight are now thinned by the same even stride, one linear pass that keeps a uniform sample of the raw recording. Long runs and hikes render closer to what was actually recorded, and range changes build less geometry still.',
        'While a range boundary is being dragged the map now renders a lighter preview of the highlight, then settles to the exact line the moment the drag ends. The handle keeps up with fast drags on very long tracks instead of falling behind them.',
        'The elevation profile\'s vertical grid lines no longer poke out above the top elevation row. They start at the row grid and run to the chart floor as before.',
      ],
    },
    {
      h: '2026-10-04',
      ps: [
        'The satellite road overlay now draws natural landmarks: peaks, saddles, volcanoes, cave entrances, springs, rocks and stones join the same Roads toggle with no new switch, always beneath your track. Icons appear first at each zoom, names and elevations follow, and elevations always render in your units.',
        'The landmark data follows the real OSM terrain. Summits come straight from the overlay\'s existing vector tiles with their importance ranking, while the smaller landmarks (cave entrances, springs, rocks, stones) load once per viewport area and are cached. Names and elevations are optional in OSM, so a landmark renders with whatever it has, never filtered away for missing fields.',
        'Zooming in past the road tiles\' own detail limit no longer drops the summits. Above that zoom the landmark set only grows, so the peak you zoomed into stays on the map, and returning to the tile-supported zooms restores the tile-truth set.',
        'A landmark you have already seen keeps its place while you zoom closer: once drawn, a summit is no longer squeezed out by better-ranked neighbours. Small landmarks like rocks and stones never get this boost, and zooming back out still hides everything by the usual size rules.',
        'Peak and volcano icons now form one solid triangle family: the plain summit triangle against the flat-topped crater cone with eruption marks. The shapes stay recognizable in grayscale and at the smallest sizes, and the volcano adds the chart\'s heart-rate red as a secondary cue, fixed and identical in both themes.',
        'Natural landmark labels now follow the overlay\'s bilingual convention: the raw local name joins the main name as a same-size second line whenever it differs, stacked above the elevation.',
        'Toggling the Roads overlay back on no longer risks blank landmarks: the natural layer now rides the same restack as the road layers on every re-enable, keeping it above the imagery and beneath the track.',
        'The small landmarks\' viewport queries now walk a wider Overpass mirror chain (private.coffee, the mail.ru mirror, the project\'s z and lz4 instances, rambler), so the canonical endpoint\'s rate limits no longer gate their arrival.',
        'Map labels on the satellite road overlay, road names and settlement names alike, now draw 1.25× larger at every zoom, so they read comfortably against the imagery.',
        'The satellite road overlay gained a full road symbol system: every major road draws with a dark casing beneath the white line, so roads keep their edge on bright imagery. Widths graduate per road class from the continent zooms (z5) down to z19.',
        'The overlay now distinguishes the small roads: minor roads draw as hairlines from z9, service roads (park and scenic-area loops, parking aisles) as thin faint lines from z13, and tracks (forest and farm roads) as a long dash that clearly reads coarser than the short-dashed walking paths.',
        'Overlay labels repainted and broadened: road names render dark with a white halo riding the white roads, while place names stay white with a dark halo on the imagery. Every named road labels regardless of class, trail names included, and falls back to the route number when a road has no name. Place names start at z3 across the full seven-class settlement hierarchy.',
      ],
    },
    {
      h: '2026-10-03',
      ps: [
        'Switching between satellite basemaps no longer buries the road overlay: the fresh imagery restacks beneath the road network on every basemap change.',
        'The road-network toggle now reads simply "Roads" in every language.',
        'The road-network toggle is now remembered: its state lives in localStorage like the basemap choice and survives reloads and basemap switches. A non-satellite basemap only suspends it until a satellite one returns.',
        'The road-network toggle\'s pressed state now paints the accent tint over its opaque elevated panel, so the imagery no longer shows through. Hover and active deepen the tint and lift the shadow instead of falling back to the neutral button style.',
        'The road overlay now draws tunnels too: a dimmed dashed line beneath the surface roads from the street-detail zooms, so a route through a mountain shows where it goes underground.',
        'The map no longer shows the scale bar in its bottom-left corner.',
        'Satellite basemaps gained a hybrid view: the new road-network toggle at the map area\'s top-left draws vector roads, road names and place labels over the imagery, always beneath your track. The toggle is only active on a satellite basemap, switching basemaps turns it off, and the overlay reuses OpenFreeMap\'s keyless road tiles.',
        'Overlay labels are bilingual: the primary name follows the selected UI language (name:xx, then English, international, Latin and the raw local name), and where the local name differs it joins at the same size, stacked as a second line for place names and on one line for road names. A localized name that already is the local name never repeats.',
        'The elevation profile is now rendered by the uPlot chart library, lazy-loaded on the first imported track. Opening the app downloads nothing of it.',
        'The profile chart draws the complete raw track series: the per-pixel-column downsampling was removed, so narrow spikes render at full amplitude and the overlay axis strip always reads the same values as the metrics list.',
        'The elevation profile is drawn as a line only: the translucent area fill below the curve is gone.',
        'The privacy statement now names the current basemap providers, OpenTopoMap and CyclOSM included, and the open-source note names the MIT license. The story page no longer mentions the removed per-pixel-column downsampling.'
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
