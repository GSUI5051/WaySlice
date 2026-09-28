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
        'WaySlice needs no server, no account and no sign-in, and it uploads nothing. Your file is read, parsed, analyzed and rendered entirely in your own browser.',
        'There\'s no server for WaySlice. Nothing about yourself or your tracks is collected, and there is no analytics.',
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
      h: 'The only network-dependent feature: map',
      ps: [
        'The only network-dependent feature is the map. Everything about maps are downloaded from the basemap provider\'s servers: OpenStreetMap, Thunderforest, Mapy, Stadia, OpenFreeMap, EOX and Esri.',
        'Map request is the only web request, like image loading on any page. Your track, your files and your settings never leave your own browser.',
      ],
    },
    {
      h: 'Open source',
      ps: [
        'WaySlice is open source: everything on this page can be verified by its code.',
        'You can even run WaySlice on your own. It is a static web app for any static file server, and there is no need to build.',
      ],
    },
  ],
};
