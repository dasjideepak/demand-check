---
name: demand-check
description: "Check real demand for an app or package idea: top apps, installs, low-star complaints, npm downloads, verdict. Use when the user asks whether an idea is worth building, wants competitor or demand research, or says 'check demand for X'."
---

# demand-check

Run the demand-check CLI for an idea, read its JSON, group the complaints into themes, and write a scorecard file. Report only what the CLI returned. Do not add apps, reviews or numbers from memory.

## Steps

### 1. Run the CLI with --json

Turn the idea into a short store search phrase (two to four words, what a user would type into the Play Store). If the idea is vague, pick the most literal phrase and say which one you used.

Pick the command in this order:

1. The CLI bundled with this skill: `node "${CLAUDE_SKILL_DIR}/../../bin/demand-check.js"` (installed as a Claude Code plugin, the repo root is two folders above this skill)
2. `demand-check` if it is on PATH (`command -v demand-check`)
3. `node bin/demand-check.js` if the current directory is the demand-check repo

If none of these work, tell the user to install the tool (see the README) instead of downloading it yourself.

Options:

- `--country <cc>`: the two-letter code the user names. Default `us`.
- `--store <list>`: `all` unless the user only cares about one kind, for example `--store npm` for a library idea.
- `--json --quiet --out reports/<slug>.json`: JSON on stdout, no progress lines, and a copy of the JSON on disk. `<slug>` is the term lowercased with everything except letters and digits replaced by a single hyphen.

Example:

```sh
node "${CLAUDE_SKILL_DIR}/../../bin/demand-check.js" "swipe photo cleaner" --country us --json --quiet --out reports/swipe-photo-cleaner.json
```

Exit codes: `0` ok (per-source errors are inside the JSON), `1` every requested source failed (tell the user and stop; do not write a scorecard), `2` usage error (fix the arguments and retry once).

### 2. Read the JSON

The output is a `CheckResult` (documented in `src/types.js` of the repo). The fields you need:

- `term`, `country`, `checkedAt`
- `play.apps` and `ios.apps`: `title`, `installs` and `minInstalls` (Play only, iOS is null), `rating`, `ratings`, `ads`, `iap`, `price`, `released`, `updated`, `url`
- `npm.packages`: `name`, `weeklyDownloads`, `lastPublish`, `url`
- `tags`: counts per complaint tag (`ads`, `paywall`, `crash`, `dataLoss`, `offline`, `login`, `support`, `bugs`)
- `complaintSamples`: up to 12 low-star reviews with `store`, `appTitle`, `score`, `text`, `date`
- `verdict.level`, `verdict.summary`, `verdict.reasons`, `verdict.signals`. `signals.lowStarShare` is `0` when no reviews were read (for example `--reviews 0`); quote it as a percentage only when `play.reviewsFetched` or `ios.reviewsFetched` is above zero.
- `play.errors`, `ios.errors`, `npm.errors`: what went wrong for that source, including the search results it skipped as off-topic. A source that was not requested or failed entirely is `null`.
- `errors`: top-level list of sources that failed entirely (for example "Google Play: search failed"); the matching source key is `null`.

### 3. Group the complaints into themes

Read every entry in `complaintSamples` and group them into 3 to 6 themes. For each theme give a short name, the count of samples in it, the apps it came from, and one quoted example under 25 words, cut with "..." if the review is longer. The `tags` counts are keyword matches; use them as a hint, not as the grouping. If `complaintSamples` is empty, say so and skip the themes.

### 4. Write the scorecard

Write markdown to the path the user names, default `./reports/<slug>.md` (create the folder if needed). Sections, in this order:

1. `# Demand check: <term>`
2. `## Demand`: one table with the top apps and packages. Columns: Store, Name, Installs (Play) or Ratings count (iOS) or Weekly downloads (npm), Rating, Ads / IAP, Released, Updated. Sort by installs (Play), ratings count (iOS) or weekly downloads (npm), largest first, the same order as the CLI report. Keep it to the top five per store unless the user asks for all.
3. `## Complaints`: the themes from step 3, one bullet each: name, count, apps, quoted example.
4. `## Verdict`: the `verdict.level` with `verdict.summary` in brackets, then every line of `verdict.reasons` as given. Then one short paragraph "What an edge would need": the specific complaint themes an entrant would have to fix, or, if complaints are few, a note that pain is not the edge here. Base it only on the themes and the numbers above.
5. `## Caveats`: every string from `errors`, `play.errors`, `ios.errors` and `npm.errors`, then these fixed caveats:
   - Play install counts are public buckets, not exact numbers.
   - Apple publishes no install counts; iOS rows show ratings only.
   - Review tags are keyword matches over a small sample (at most 12 samples shown).
   - Results depend on the exact search term and one store country.
   - The verdict is a heuristic, not a decision.
6. `Checked on <date>`: the date part of `checkedAt`, plus the country and the stores that returned data.

### 5. Reply

Reply in chat with: the verdict level, the three numbers that matter most (usually leader installs, count of apps at 100k+, and either the low-star share when reviews were read or the top weekly downloads), and the scorecard path. Keep it to a few lines; the detail is in the file.

## Rules

- Never claim a gap without the numbers. If `verdict.level` is not `gap`, do not call it one, and if it is, show the demand number and the complaint count that support it.
- Every number cites its source and date: for example "1,000,000+ installs (Play, 2026-09-26)".
- Mark anything unverified. If you add context the CLI did not return, label it "not from the check".
- Do not invent apps, reviews or quotes. Every quote must be a substring of a `complaintSamples` entry.
- If the CLI fails for a store, say so in the reply and in Caveats. Do not fill the gap from memory.
- Do not run the CLI more than three times for one idea (for example to try another phrasing) without telling the user.
