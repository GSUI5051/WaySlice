# Vendored: fit-file-parser

Source: <https://github.com/jimmykane/fit-parser> — npm package
[`fit-file-parser`](https://www.npmjs.com/package/fit-file-parser), version **5.0.2**.
License: MIT (see `LICENSE`). The `package.json` is kept for version provenance.

## What is vendored

The ESM `dist/` subset only — no CJS mirror, no `.d.ts`, no dev tooling:

```
binary.js                    low-level record/message decoder
fit-parser.js                FitParser class (options + parse loop)
fit.js / fit_types.js        generated FIT profile (types + messages)
garmin_profile.generated.js  generated Garmin product/profile data
helper.js                    lap/session cascade mapping
messages.js                  message-number lookup
types.js                     type re-exports
fit-encoder.js               kept only because fit-parser.js re-exports it
```

## Local modifications (one line)

`binary.js` line 1 — the upstream bare specifier

```js
import { Buffer } from 'buffer';
```

was rewritten to

```js
import { Buffer } from './buffer-shim.js';
```

because the app has no build step and no import map. `buffer-shim.js` implements
the single upstream call shape (`Buffer.from(bytes).toString('utf-8')`, string-field
decoding) on top of `TextEncoder`/`TextDecoder`. See the file header for upgrade notes.

## Notes for the WaySlice adapter (`js/parsers/fit.js`)

- Output field names are the FIT profile names verbatim (snake_case):
  `position_lat`, `position_long`, `altitude`, `enhanced_altitude`, `heart_rate`,
  `cadence`, `power`, `temperature`, `speed`, `enhanced_speed`, `distance`.
- Coordinates arrive in **degrees** (semicircle conversion built in); speeds in
  m/s, lengths in m, temperatures in °C with the options used by the adapter
  (`force: true`, `speedUnit: 'm/s'`, `lengthUnit: 'm'`, `temperatureUnit: 'celsius'`).
- Invalid/sentinel fields are omitted from records (not `null`), timestamps are `Date`.
- `parse()` reports failures by calling back with an error **string**; `parseAsync()`
  rejects with that string.
- Default `mode: 'list'` yields flat `records` / `laps` / `sessions` arrays; records
  carry no lap number, so the adapter assigns laps by timestamp windows.
