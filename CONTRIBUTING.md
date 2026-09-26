# Contributing

Thanks for looking. This is a small tool, so the rules are short.

## Running tests

```sh
npm test                          # offline tests only
DEMAND_CHECK_NETWORK=1 npm test   # also the live tests that hit the stores
```

Tests live in `test/<name>.test.js` and use `node:test` with `node:assert/strict`. Anything that touches the network must be wrapped with `{ skip: !process.env.DEMAND_CHECK_NETWORK }` so the default run passes offline. To run one file: `node --test test/<name>.test.js`.

## Where things are

- `src/types.js` is the contract. Every source, the analyzer and the report use the shapes defined there (`AppRecord`, `ReviewRecord`, `PackageRecord`, `StoreResult`, `RegistryResult`, `CheckResult`). Change it only when the contract really has to change, and say so in the PR.
- `src/sources/` holds one module per store or registry (Google Play, App Store, npm). `src/relevance.js` is the off-topic guard they share.
- `src/cli.js` parses arguments and runs the sources; `bin/demand-check.js` is the thin executable wrapper.
- `src/analyze.js` tags complaints and decides the verdict (thresholds are the constants at the top).
- `src/report.js` renders the markdown; all number and date formatting lives there.

## Adding a source

- Return exactly the shapes in `src/types.js`: a `StoreResult` for an app store, a `RegistryResult` for a package registry.
- Never throw for a partial failure. One app's reviews missing or one download count failing goes into the `errors` array as a short, plain sentence, and the rest of the run continues. Throw only when the whole source cannot run, such as search itself failing after one retry.
- Be polite to the service: at most three concurrent detail or review fetches, `AbortSignal.timeout(15000)` on every fetch, and the `User-Agent` header `demand-check (https://github.com/dasjideepak/demand-check)`.
- Only built-in Node modules, the global `fetch`, and `google-play-scraper`. No new dependencies without a discussion first.
- Dates are ISO `YYYY-MM-DD` strings. Numbers stay numbers; the report does the formatting.
- Node 18.17 or newer, ESM only.

## Pull requests

- Describe what you tested against a real store: the command, the country, the date, and what came back. A pasted excerpt of the report is ideal.
- Keep functions small and comments for the reasons that are not obvious from the code.
- Plain English, no emojis, in code, output and docs.
