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
      h: '2026-10-02',
      ps: [
        'The elevation profile header keeps its loaded height before a track is imported, so the icon and title no longer shift when one loads.',
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
