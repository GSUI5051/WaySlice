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
      h: 'The only network-dependent feature: the map',
      ps: [
        'The only network-dependent feature is the map. Basemap tiles are downloaded from the map providers\' servers: OpenStreetMap, OpenTopoMap, CyclOSM, Thunderforest, Mapy, Stadia, OpenFreeMap, EOX and Esri.',
        'The map request is the only web request, like image loading on any page. Your track, your files and your settings never leave your own browser.',
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
