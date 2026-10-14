/**
 * English content pack — the privacy page's English version. Pure content:
 * the selection logic lives in privacy-lang.js, the same split the story
 * page uses (story-en.js + story-lang.js).
 *
 * Every factual claim mirrors what the app actually does.
 */

export const PRIVACY_EN = {
  htmlLang: 'en',
  title: 'WaySlice — Privacy',
  heading: 'Privacy',
  tagline: 'Telemetry for every way. Sliced.',
  lede: 'How WaySlice handles your data.',
  sections: [
    {
      h: 'Privacy by architecture',
      ps: [
        'WaySlice needs no server, no account and no sign-in: there is no upload code. Your file is read with the browser\'s built-in File API, then parsed, analyzed and rendered entirely in your own browser.',
        'Nothing about yourself or your tracks is collected, and there is no analytics.',
      ],
    },
    {
      h: 'What stays on your device',
      ps: [
        'The only data WaySlice keeps is your own settings. They live in localStorage on your device and are never sent anywhere.',
        'Clearing the site\'s data in your browser erases them completely.',
      ],
    },
    {
      h: 'Network-dependent features: the map, and optional terrain tiles',
      ps: [
        'The map downloads basemap tiles from the map providers\' servers: OpenStreetMap, OpenTopoMap, CyclOSM, Thunderforest, Mapy, Stadia, OpenFreeMap, EOX and Esri. On a satellite basemap, the optional road-network overlay additionally loads vector road tiles from OpenFreeMap.',
        'The optional elevation correction (Settings → Track data) samples terrain tiles from Mapterhorn (mapterhorn.com) to fill missing elevations or replace recorded ones. It requests only the few tiles the track actually touches — never the whole track, and never the track file itself. Tile addresses alone can still tell the server which area you are looking at, so using the feature adds that one location disclosure; leaving it unused sends nothing.',
        'These tile requests are ordinary web requests, like image loading on any page. Your track, your files and your settings are never uploaded anywhere.',
      ],
    },
    {
      h: 'Open source',
      ps: [
        'WaySlice is open source (MIT license): everything on this page can be verified by its code.',
        'You can even run WaySlice on your own: a static web app for any static file server, no build needed.',
      ],
    },
  ],
};
