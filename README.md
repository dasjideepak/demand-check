# demand-check

Check real demand for an app or package idea before you build it. Give it a search term and it pulls the top Google Play and App Store results (installs, ratings, ads and in-app purchases, release and last-update dates), the newest 1–2 star reviews of the leading apps, and npm package download counts. It tags the complaints and prints a verdict: owned, crowded, gap, served, no-demand or unknown. It is a small Node CLI plus a Claude Code skill that wraps it.

Requires Node 18.17 or newer.

```sh
npx github:dasjideepak/demand-check "swipe photo cleaner"
```

Or install it once:

```sh
npm install -g github:dasjideepak/demand-check
demand-check "swipe photo cleaner"
```

## Why

I checked about 30 app ideas in one day, and every check was the same four manual steps: look up the top apps and their install counts, read the newest 1–2 star reviews, check package downloads, and decide. This tool runs those steps in one command and prints what it found. It does not tell you what to build; it tells you what already exists and what users complain about.

## Usage

```
demand-check <term> [options]
```

| Option | Meaning | Default |
| --- | --- | --- |
| `--store <list>` | Comma-separated list of `play`, `ios`, `npm`, or `all` | `all` |
| `--country <cc>` | Two-letter store country | `us` |
| `--lang <code>` | Play Store language | `en` |
| `--limit <n>` | Apps or packages per store (max 25) | `10` |
| `--reviews <n>` | Apps per store to pull low-star reviews from (`0` disables) | `3` |
| `--json` | Print the CheckResult JSON instead of markdown | off |
| `--out <file>` | Also write the report to this file | none |
| `--quiet` | No progress lines on stderr | off |
| `--help` | Show usage | |
| `--version` | Show the version | |

Exit codes: `0` ok (partial source errors are listed inside the report), `1` every requested source failed, `2` usage error.

Examples:

```sh
# All three sources, US stores, markdown report on stdout
demand-check "swipe photo cleaner"

# Only npm, for a library idea
demand-check "markdown table generator" --store npm

# Indian Play Store and App Store, no npm
demand-check "upi expense tracker" --country in --store play,ios

# JSON for scripts, also saved to a file
demand-check "swipe photo cleaner" --json --out reports/swipe-photo-cleaner.json
```

The markdown report goes to stdout, progress lines go to stderr, so `demand-check "idea" > report.md` works.

## Example report

Excerpt from a real run on 2026-09-26 (`demand-check "swipe photo cleaner"`). Rows are trimmed and review samples are left out; a full report also has the App Store and npm tables, up to 12 review samples and a Notes section.

```markdown
# Demand check: swipe photo cleaner

Checked 2026-09-26, country US, stores Google Play, App Store, npm.

## Verdict

**Crowded** (many strong players)

- Many strong players: 3 iOS apps have 10,000+ ratings, the size of 1,000,000-install apps.
- 2 apps launched in the last 18 months already have 10,000+ installs, so newcomers still get traction.
- Top complaints: paywall (84), ads (81), bugs (23).
- An edge would need: one-time price or unlimited free tier, no ads, reliability.

## Google Play

| App | Installs | Rating | Ads / IAP | Released | Updated |
| --- | --- | --- | --- | --- | --- |
| Photo Cleaner: Swipewipe | 1,000,000+ | 4.6 (7,401) | ads, iap | 2023-09-19 | 2026-09-21 |
| Sponge - Gallery Cleaner | 500,000+ | 4.7 (6,160) | iap | 2023-06-21 | 2026-07-06 |
| Slidebox - Photo Cleaner | 500,000+ | 4.5 (12,313) | iap | 2016-03-30 | 2025-11-23 |
| Swipe & Delete: Photo Cleaner | 100,000+ | 4.2 (3,382) | ads, iap | 2024-02-07 | 2025-01-20 |

## Complaints (1-2 star reviews)

198 low-star reviews from 6 apps. Complaints: paywall 84, ads 81, bugs 23, crash 14, dataLoss 9, offline 5, login 2, support 2.
```

## How the verdict works

The verdict is a heuristic over the numbers in the report. It is a starting point for reading the reviews yourself, not a decision.

| Level | Rule |
| --- | --- |
| owned | A Play app with 10M+ installs, or 5M+ installs with 50k+ ratings, or an iOS app with 100k+ ratings, or (npm only) a package with 1M+ weekly downloads. One giant holds the category. |
| crowded | 2+ apps at 1M+ installs, or 5+ apps at 100k+, or 3+ npm packages at 10k+ weekly downloads. Many strong players. |
| gap | Demand (leader at 100k+ installs, or an npm package at 10k+ weekly downloads) plus real complaints: 10+ tagged complaints, or 15%+ of the fetched reviews are 1–2 stars. |
| served | Demand, but few complaints. Users are happy, so an edge has to come from something other than pain. |
| no-demand | Leader under 10k installs and under 500 weekly downloads. Nobody big enough to prove people want this. |
| unknown | No usable data: every requested source failed or returned nothing. |

The rules are checked in the order owned, crowded, no-demand, gap, served; the first match wins. The report also counts newcomers (Play apps released in the last 18 months with 10k+ installs). That number does not change the level, but it tells you whether new entrants still get traction in the category.

Things the verdict cannot see: Play install counts are public buckets ("1,000,000+"), Apple publishes no install counts at all, review tags are keyword matches over a small sample, and the search results depend on the exact term you type. Try two or three phrasings before you trust a level.

npm downloads measure libraries, not services. A term like "supabase backup" can come out as no-demand on npm even when several paid backup services exist, because people buy those as websites, not packages. For SaaS ideas, treat the npm result as one weak signal and search for existing services too.

## Data sources and limits

- Google Play: search, app details and reviews through the unofficial [google-play-scraper](https://github.com/facundoolano/google-play-scraper). It reads Google's web pages, so it can break when Google changes them. Installs are the public buckets shown on the store page, not exact counts.
- App Store: Apple's public iTunes Search API for the app list and the customer reviews RSS feed for 1–2 star reviews. Apple publishes no install counts, so iOS rows have ratings only. The reviews feed is sometimes unavailable for an app or a country; the report says so instead of failing.
- npm: the public registry search API for packages and the downloads API for weekly download counts.

Not included yet: Google Trends (no official API), Chrome Web Store, PyPI search, App Store install estimates. One store country per run; run the command again with another `--country` to compare.

Store searches often return one unrelated giant for a niche term (a general storage cleaner for "swipe photo cleaner", a business news app for "startup funding news"). Results whose names share too few words with your term are dropped before the verdict, so one off-topic app can't decide it.

Every request carries a `demand-check` user agent, at most three detail or review fetches run at once, and each request times out after 15 seconds. When one app's reviews or one package's download count fails, the error is listed in the report and the rest of the run continues.

## Use it from Claude Code

Copy the skill folder into your skills directory:

```sh
# personal, every project
cp -r skill/demand-check ~/.claude/skills/demand-check

# or one project only
cp -r skill/demand-check <project>/.claude/skills/demand-check
```

Then ask Claude "check demand for <idea>". The skill runs the CLI with `--json`, groups the complaint samples into themes, and writes a scorecard markdown file to `./reports/<slug>.md` (or the path you name). That grouping and the scorecard file are what the skill adds over the CLI.

## Roadmap

Short list, in no fixed order:

- PyPI search and download counts
- Chrome Web Store
- Google Trends through a pasted CSV export (no official API)
- App Store review sampling beyond the RSS feed's first pages
- A JSON schema for the CheckResult output

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports with the exact command and the store country are the most useful thing you can send.

## License

MIT. See [LICENSE](LICENSE).
