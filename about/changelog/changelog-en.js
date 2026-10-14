/**
 * English content pack — the changelog page's English version. Pure
 * content: the selection logic lives in changelog-lang.js, the same split
 * the story and privacy pages use.
 *
 * One section per day of the git history, newest first; the section
 * headings are the dates (YYYY-MM-DD) and the paragraphs summarize that
 * day's changes as the user sees them — what is new or different on
 * screen, never how it is built.
 */

export const CHANGELOG_EN = {
  htmlLang: 'en',
  title: 'WaySlice — Changelog',
  heading: 'Changelog',
  tagline: 'Telemetry for every way. Sliced.',
  lede: 'What changed in the analyzer, day by day.',
  sections: [
    {
      h: '2026-10-14',
      ps: [
        'Settings gains a Track data group with an elevation correction. It can fill the elevations that a track is missing. It can replace every recorded elevation with values from terrain data and restore the originals at any time.',
        'The values come from Mapterhorn, an open collection of terrain data. The correction downloads only the tiles that your track touches, and the track itself never leaves the browser. The corrected values feed every number you already see. That includes the profile, climb and descent, grades, 3D and effort distance, GAP, VAM and VDM, the sectors and the exports.',
        'Before it replaces the recorded elevations, the correction asks you to confirm. The warning says that the terrain values can differ from the values that the device recorded. You can stop a correction while it downloads. Points that the correction cannot sample keep their previous value. They never turn into a fake number.',
        'The privacy statement and the story page now describe the terrain tiles from Mapterhorn.',
        'Some watches record running and hiking cadence as single-leg cycles, so the raw number is half the real step rate. WaySlice now reads the step-length and speed data inside each file to tell how that file counts cadence. It shows the converted value in steps per minute. Files without the data to tell keep the raw values, and a notice in the header says so. On the narrowest screens the notice folds into the file chip popover.',
        'Converted cadence is labeled as step cadence in steps per minute. The exported track file carries the converted values too, matching what the page shows.',
      ],
    },
    {
      h: '2026-10-13',
      ps: [
        'The changelog now uses plainer words. Each entry describes what changed on screen, and entries with no visible change are gone.',
      ],
    },
    {
      h: '2026-10-11',
      ps: [
        'The top bar now compresses through two more steps before it starts folding buttons into menus. The brand name yields to the logo mark alone first, then Export, Auto split and Import track turn icon-only while the GitHub and Support links shrink to compact icon squares, loaded track or not.',
        'The steps now follow the room each language actually needs: German, whose labels run much longer than the English ones, keeps its button labels until the top bar truly runs out of room, and a landscape phone keeps its labels while there is still space for them.',
        'The top bar keeps its spacing at every window width. Resizing across the old narrow boundary no longer nudges the brand icon, the file chip and the route warning square sideways; the bar folds or restores whole buttons instead of squeezing anything.',
      ],
    },
    {
      h: '2026-10-10',
      ps: [
        'The overlays popup now opens as a dropdown right under the Overlays button, right-aligned with it, instead of pinning itself to the toolbar row at the window\'s right edge over the metrics panel.',
        'The map-source picker and the overlays picker now both follow the page layout: on the single-column layout they open as a full-width list docked to the bottom of the screen with a backdrop, and on the wide layout as dropdowns. The map-source picker used to keep the dropdown form across the whole tablet range, floating free of its button.',
        'On the wide layout the overlays dropdown caps its height at the bottom of the viewport. Deep browser zoom or a short window used to let it run past the screen edge, where the lower rows were out of reach; the rows now scroll inside the panel, by mouse wheel and by touch swipe alike.',
        'In dropdown form both panels now hug their longest row instead of a fixed width, so each language renders at its own width.',
        'The elevation profile hover readout now includes the grade right after the elevation, and the mobile band gains it as its third slot where an empty slot used to be.',
        'Outside a selected sector the chart curves and grid lines now dim in their own colors, more in the dark theme than in the light. The translucent veils that used to darken everything outside the handles are gone, the axes, tick labels and zone bands keep full strength everywhere, and the curves keep one constant stroke width across the boundary.',
        'The hovered heart-rate zone band deepens again while the pointer or the touch probe moves across zones, and the zone bands appear and disappear again with the zone toggles in the settings drawer.',
        'The sector handles no longer block the hover readout. Moving the pointer across a handle shows the crosshair and its readings there like everywhere else on the chart, and a boundary drag still starts from the handle and stays locked until the pointer is released, with the crosshair out of the way while the drag runs.',
        'The elevation profile now zooms in deeper. The narrowest visible window is 100 m of track in distance mode and 1 minute in time mode, down from 1 km and 20 minutes. The wheel, the pinch gesture and the Focus button share the floors, so a fit to a short sector can follow it that much closer.',
      ],
    },
    {
      h: '2026-10-09',
      ps: [
        'Waterfalls now join the natural landmarks, over satellite imagery and on the vector basemaps alike. They appear together with the springs at the same entry zoom, and their icon is the standard waterfall glyph, filled white like the summit icons.',
        'The elevation profile\'s toolbar buttons now sit in a new order, in the row and in the More panel alike.',
      ],
    },
    {
      h: '2026-10-08',
      ps: [
        'Natural landmarks now draw on the OpenFreeMap, Stadia Maps and Thunderforest World Map basemaps too: peaks, saddles, volcanoes, cave entrances, springs, rocks and stones, with names and elevations. They used to appear only over satellite imagery. The same map button toggles the landmarks there; its icon and title change with the basemap, the choice is remembered on its own and defaults to on, and on the plain raster maps the button stays disabled because those maps already carry their own peak markers.',
        'The elevation profile\'s axis labels now repaint immediately when the language or the unit system changes, instead of keeping the previous strings on screen until the next data change.',
        'The elevation profile\'s horizontal grid now lands on whole units of the active system: whole miles at a mile and up and whole hundreds of feet below it under imperial, whole meters and kilometers under metric.',
        'In time mode the horizontal grid now steps in whole minutes and hours (15:00, 1:00:00, 2:00:00) instead of decimal-time fractions such as 1:23:20.',
        'The elevation profile\'s y-axis gutter now widens to fit its longest label, so extreme-altitude tracks keep their leading digits: grouped five-digit feet readings such as 29,032 ft no longer clip.',
        'The dual-variable analysis\'s elevation axis draws its tick labels and gridlines under imperial units again; the axis used to come up blank.',
        'Dragging and swiping the elevation profile now keeps up with the pointer on long tracks. Dense spans that used to lag behind the drag now draw smoothly, and the data itself stays full-resolution.',
        'The metrics panel now recalculates at a calmer pace while a sector boundary is being dragged and settles to the exact values the moment the drag ends, so a very long track no longer stutters the chart and the map during the drag.',
      ],
    },
    {
      h: '2026-10-07',
      ps: [
        'Each waypoint now lands on its nearest spot along the route, and the list is ordered along the track, so a file that lists its waypoints out of order still shows them in track order.',
        'A waypoint farther than 50 m from the track is left out entirely: no pin on the map, no line on the elevation profile, no boundary in the CP-to-CP table.',
        'GPX files that carry a route instead of a recorded track now load; race websites hand out this form. The map line, the distance, the elevation profile, gain and loss, sectors and waypoints all work as usual.',
        'Route files never invent activity data. Time, speed, pace, heart rate and cadence stay unavailable and say so. A warning square next to the file chip explains why: the file is a route rather than a recording, and clicking it shows the full notice. A file with both forms uses the track and ignores the route.',
      ],
    },
    {
      h: '2026-10-06',
      ps: [
        'The pinned waypoint now stands out on the map: its marker wears a pushpin badge filled in the waypoint purple and outlined like every waypoint, with the needle planted on the marker\'s center. The badge follows a new pin and disappears when the pin clears, so the pinned spot reads at a glance.',
        'The elevation profile\'s pinned waypoint line no longer blocks the chart\'s hover: moving the mouse across the chart shows the cursor\'s own readings again, and hovering another waypoint pin on the map borrows the violet line for that waypoint while it lies inside the zoomed window. The pinned line steps aside during the hover and returns when the pointer leaves. The pin itself still clears only on the next click anywhere.',
        'The auto-split segment details now list their rows in the metrics panel\'s order: Distance, 3D Distance, Effort Distance, Elevation Gain and Loss, Average Grade, Average GAP, VAM, VDM, Average Heart Rate, Maximum Heart Rate, then the heart-rate zones. Distance, Average Grade and the two heart-rate rows were missing from the sheet entirely before.',
      ],
    },
    {
      h: '2026-10-05',
      ps: [
        'The satellite overlay\'s spring landmark now draws as a single water droplet and the ripple line beneath is gone, so the shape still reads as water at the smallest sizes.',
        'The cave-entrance landmark\'s arch now rises higher, keeping the low mouth-over-ground shape clearly legible at the smallest zooms.',
        'The natural landmark icons now draw with a subtly finer outline, shapes and sizes unchanged.',
        'Small landmark lookups on the satellite overlay now arrive faster on unstable or restricted networks instead of waiting behind one unresponsive source.',
        'With the whole track selected the map no longer paints the orange highlight on top of the blue track line, so the track shows in its own color by default. The orange highlight now appears only once an actual sub-range is selected, and every track loads a little lighter for it.',
        'The range highlight now hugs the track exactly at every zoom, so the highlight and the track line no longer diverge.',
        'Long runs and hikes now render closer to what was actually recorded, and range changes come faster.',
        'While a range boundary is being dragged the map now renders a lighter preview of the highlight, then settles to the exact line the moment the drag ends, so the handle keeps up with fast drags on very long tracks.',
        'The elevation profile\'s vertical grid lines no longer poke out above the top elevation row. They start at the row grid and run to the chart floor as before.',
      ],
    },
    {
      h: '2026-10-04',
      ps: [
        'The satellite road overlay now draws natural landmarks: peaks, saddles, volcanoes, cave entrances, springs, rocks and stones join the same Roads toggle with no new switch, always beneath your track. Icons appear first at each zoom, names and elevations follow, and elevations always render in your units.',
        'Landmarks follow the real OSM terrain. Summits keep their importance ranking, and a landmark with no name or elevation still renders with what it has instead of being filtered away.',
        'Zooming in past the road map\'s own detail limit no longer drops the summits: above that zoom the landmark set only grows, so the peak you zoomed into stays on the map, and returning to the lower zooms restores the usual set.',
        'A summit you have already seen keeps its place while you zoom closer instead of being squeezed out by better-ranked neighbours. Small landmarks like rocks and stones never get this boost, and zooming back out still hides everything by the usual size rules.',
        'Peak and volcano icons now form one solid triangle family: the plain summit triangle against the flat-topped crater cone with eruption marks. The shapes stay recognizable in grayscale and at the smallest sizes, and the volcano adds the chart\'s heart-rate red as a secondary cue.',
        'Natural landmark labels now follow the overlay\'s bilingual convention: the raw local name joins the main name as a same-size second line whenever it differs, stacked above the elevation.',
        'Toggling the Roads overlay back on no longer risks blank landmarks: the natural layer keeps its place above the imagery and beneath the track on every re-enable.',
        'The small landmarks\' lookups now try several independent sources in turn, so one source\'s rate limits no longer gate their arrival.',
        'Map labels on the satellite road overlay, road names and settlement names alike, now draw larger at every zoom, so they read comfortably against the imagery.',
        'The satellite road overlay gained a full road symbol system: every major road draws with a dark casing beneath the white line, so roads keep their edge on bright imagery, with widths graduating by road class from the continent zooms down to the closest.',
        'The overlay now distinguishes the small roads: minor roads draw as hairlines, service roads (park and scenic-area loops, parking aisles) as thin faint lines, and tracks (forest and farm roads) as a long dash that clearly reads coarser than the short-dashed walking paths.',
        'Overlay labels repainted and broadened: road names render dark with a white halo riding the white roads, while place names stay white with a dark halo on the imagery. Every named road labels regardless of class, trail names included, and falls back to the route number when a road has no name. Place names cover the full settlement hierarchy.',
      ],
    },
    {
      h: '2026-10-03',
      ps: [
        'Switching between satellite basemaps no longer buries the road overlay beneath the fresh imagery.',
        'The road-network toggle now reads simply "Roads" in every language.',
        'The road-network toggle is now remembered across reloads and basemap switches, like the basemap choice itself. A non-satellite basemap only suspends it until a satellite one returns.',
        'The road-network toggle\'s pressed state now paints the accent tint over its own panel, so the imagery no longer shows through. Hover and active deepen the tint and lift the shadow.',
        'The road overlay now draws tunnels too: a dimmed dashed line beneath the surface roads from the street-detail zooms, so a route through a mountain shows where it goes underground.',
        'The map no longer shows the scale bar in its bottom-left corner.',
        'Satellite basemaps gained a hybrid view: the new road-network toggle at the map area\'s top-left draws vector roads, road names and place labels over the imagery, always beneath your track. The toggle is only active on a satellite basemap, and switching basemaps turns it off.',
        'Overlay labels are bilingual: the primary name follows the selected UI language, and where the local name differs it joins at the same size, stacked as a second line for place names and on one line for road names. A localized name that already is the local name never repeats.',
        'Opening the app now downloads less: the elevation profile\'s charting loads only when the first track is imported.',
        'The profile chart draws the complete raw track series, so narrow spikes render at full amplitude and the overlay axis strip always reads the same values as the metrics list.',
        'The elevation profile is drawn as a line only: the translucent area fill below the curve is gone.',
        'The privacy statement now names the current basemap providers, OpenTopoMap and CyclOSM included, and the open-source note names the MIT license.',
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
        'Added a "Fit to sector" view control button: one click zooms the x axis so the selected sector fills most of the visible range.',
        'Reworked the elevation profile toolbar around four responsive levels: the toolbar never wraps and never shrinks a control below a comfortable press.',
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
        'The Thunderforest World Map switched to its newer vector styles.',
      ],
    },
    {
      h: '2026-09-25',
      ps: [
        'The map now runs on a new rendering engine, and the app loads lighter with a quicker first paint.',
        'Stadia map requests are sent only to EU-hosted servers for GDPR.',
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
        'Initial release: the track analyzer.',
        'The site gained its search-engine basics so more people can find it.',
      ],
    },
  ],
};
