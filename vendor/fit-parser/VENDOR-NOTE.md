# Vendored: fit-file-parser

Source: <https://github.com/jimmykane/fit-parser> — npm package
[`fit-file-parser`](https://www.npmjs.com/package/fit-file-parser), version **6.1.2**.
License: MIT (see `LICENSE`). The `package.json` is kept for version provenance.

## What is vendored

The ESM `dist/` subset only — no CJS mirror, no `.d.ts`, no dev tooling
(`type_generator.js` pulls in `typescript` and is skipped):

```
binary.js                    low-level record/message decoder
fit-parser.js                FitParser class (options + parse loop)
fit.js                       thin profile re-export (was the generated FIT profile in 5.x)
profile.js                   generated/maintained FIT profile (messages + types)
profile-lookup.js            manufacturer/product/sport lookup helpers (re-exported)
profile-lookup-data.js       lookup tables backing profile.js and profile-lookup.js
raw-message-reader.js        profile-independent raw-message reader (re-exported)
helper.js                    lap/session cascade mapping
messages.js                  message-number lookup
fit-encoder.js               re-exported by fit-parser.js (FitBaseType, FitEncoder)
```

Since 6.0 the generated `garmin_profile.generated.js` no longer exists
upstream; its content lives in `profile.js` + `profile-lookup-data.js`.

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
decoding) on top of `TextEncoder`/`TextDecoder` — still the only real `Buffer`
use in 6.1.2 (`ArrayBuffer` mentions elsewhere are the type, not the module).
See the file header for upgrade notes.

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
- Default `mode: 'list'` yields flat `records` / `laps` / `sessions` arrays; the
  adapter consumes `records` in file order and leaves `laps` metadata unread.
- 5.0.2 → 6.1.2 was verified output-identical on `tests/fixtures/telemetry-mini.fit`
  (records/laps/sessions byte-for-byte); the 6.x releases only add opt-in raw
  output modes and new sport/sub-sport ids.
