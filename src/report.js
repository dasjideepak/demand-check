// Renders a CheckResult as Markdown. All number and date formatting lives here so
// the source modules can keep raw numbers and ISO dates.

export const STORE_LABELS = { play: 'Google Play', ios: 'App Store', npm: 'npm' };

const LEVEL_LABELS = {
  owned: 'Owned',
  crowded: 'Crowded',
  gap: 'Gap',
  served: 'Served',
  'no-demand': 'No demand',
  unknown: 'Unknown',
};

const LEVEL_GLOSS = {
  owned: 'a giant holds the category',
  crowded: 'many strong players',
  gap: 'demand exists, few strong players, users complain',
  served: 'demand exists, few players, users are happy',
  'no-demand': 'nobody big enough to prove demand',
  unknown: 'not enough data',
};

// Each caveat names the stores it applies to, so an npm-only run does not talk
// about the Play scraper.
const CAVEATS = [
  ['play', 'Play data comes from an unofficial scraper and can break when Google changes its pages.'],
  ['play', 'Installs are the public buckets Play shows (for example 1,000,000+), not exact counts.'],
  ['ios', 'The App Store does not publish install counts, so iOS apps are compared by rating count.'],
  ['play,ios', 'Only the chosen store country was checked; other countries can look very different.'],
  ['play,ios', 'Reviews are the newest 1-2 star ones, not a random sample, so they show current pain rather than overall sentiment.'],
  ['play,ios,npm', 'Search results that share too few of the term\'s words are skipped and listed above, so the tables may hold fewer rows than asked for.'],
];

const MAX_SAMPLES = 12;
const SAMPLE_CHARS = 220;
const DESCRIPTION_CHARS = 80;

const number = new Intl.NumberFormat('en-US');

/**
 * @param {import('./types.js').CheckResult} result
 * @returns {string}
 */
export function renderMarkdown(result) {
  const sections = [
    renderHeader(result),
    renderVerdict(result),
    renderPlay(result.play),
    renderIos(result.ios),
    renderNpm(result.npm),
    renderComplaints(result),
    renderNotes(result),
  ];
  return `${sections.filter(Boolean).join('\n\n')}\n`;
}

function renderHeader(result) {
  const stores = Object.keys(STORE_LABELS)
    .filter((key) => result[key])
    .map((key) => STORE_LABELS[key]);
  const date = String(result.checkedAt ?? '').slice(0, 10) || '-';
  // Country only matters to the app stores; an npm-only run has no store country.
  const country = usesStores(result) ? `, country ${String(result.country ?? '').toUpperCase() || '-'}` : '';
  return [
    `# Demand check: ${collapse(result.term)}`,
    '',
    `Checked ${date}${country}, stores ${stores.join(', ') || 'none'}.`,
  ].join('\n');
}

function usesStores(result) {
  return Boolean(result.play || result.ios);
}

function renderVerdict(result) {
  const verdict = result.verdict;
  const level = verdict?.level ?? 'unknown';
  const label = LEVEL_LABELS[level] ?? level;
  const gloss = collapse(verdict?.summary) || LEVEL_GLOSS[level];
  const lines = ['## Verdict', '', gloss ? `**${label}** (${gloss})` : `**${label}**`];
  const reasons = Array.isArray(verdict?.reasons) ? verdict.reasons : [];
  if (reasons.length) lines.push('', ...reasons.map((reason) => `- ${collapse(reason)}`));
  return lines.join('\n');
}

function renderPlay(play) {
  if (!play) return null;
  const lines = ['## Google Play', ''];
  if (!play.apps?.length) return [...lines, 'No apps found.'].join('\n');
  const apps = sortDesc(play.apps, (app) => app.minInstalls);
  lines.push(
    ...table(
      ['App', 'Installs', 'Rating', 'Ads / IAP', 'Released', 'Updated'],
      apps.map((app) => [
        link(app.title, app.url),
        app.installs ?? '-',
        formatRating(app),
        formatAdsIap(app),
        app.released ?? '-',
        app.updated ?? '-',
      ]),
    ),
  );
  return lines.join('\n');
}

function renderIos(ios) {
  if (!ios) return null;
  const lines = ['## App Store', ''];
  if (!ios.apps?.length) return [...lines, 'No apps found.'].join('\n');
  const apps = sortDesc(ios.apps, (app) => app.ratings);
  lines.push(
    ...table(
      ['App', 'Rating', 'Price', 'Released', 'Updated'],
      apps.map((app) => [
        link(app.title, app.url),
        formatRating(app),
        formatPrice(app),
        app.released ?? '-',
        app.updated ?? '-',
      ]),
    ),
  );
  return lines.join('\n');
}

function renderNpm(npm) {
  if (!npm) return null;
  const lines = ['## npm', ''];
  if (!npm.packages?.length) return [...lines, 'No packages found.'].join('\n');
  const packages = sortDesc(npm.packages, (pkg) => pkg.weeklyDownloads);
  lines.push(
    ...table(
      ['Package', 'Weekly downloads', 'Last publish', 'Description'],
      packages.map((pkg) => [
        link(pkg.name, pkg.url),
        formatInt(pkg.weeklyDownloads),
        pkg.lastPublish ?? '-',
        truncate(collapse(pkg.description), DESCRIPTION_CHARS),
      ]),
    ),
  );
  return lines.join('\n');
}

function renderComplaints(result) {
  const lines = ['## Complaints (1-2 star reviews)', ''];
  const reviews = [...(result.play?.reviews ?? []), ...(result.ios?.reviews ?? [])];
  const samples = (result.complaintSamples ?? []).slice(0, MAX_SAMPLES);
  if (reviews.length === 0 && samples.length === 0) {
    return [...lines, 'No low-star reviews were fetched.'].join('\n');
  }
  const apps = new Set(reviews.map((review) => `${review.store}:${review.appId}`)).size;
  const counts = tagCounts(result.tags);
  const summary = counts.length
    ? counts.map(([tag, count]) => `${tag} ${formatInt(count)}`).join(', ')
    : 'none matched the known patterns';
  lines.push(
    `${plural(reviews.length, 'low-star review')} from ${plural(apps, 'app')}. Complaints: ${summary}.`,
  );
  for (const sample of samples) {
    const text = truncate(escapePipes(collapse(sample.text)), SAMPLE_CHARS);
    lines.push('', `> [${sample.score}] ${text} - ${escapePipes(collapse(sample.appTitle))}`);
  }
  return lines.join('\n');
}

function renderNotes(result) {
  const errors = [
    ...(result.errors ?? []),
    ...sourceErrors('play', result.play),
    ...sourceErrors('ios', result.ios),
    ...sourceErrors('npm', result.npm),
  ];
  const caveats = CAVEATS.filter(([stores]) => stores.split(',').some((key) => result[key])).map(([, text]) => text);
  return ['## Notes', '', ...errors.map((error) => `- ${collapse(error)}`), ...caveats.map((c) => `- ${c}`)].join('\n');
}

function plural(n, noun) {
  return `${formatInt(n)} ${n === 1 ? noun : `${noun}s`}`;
}

function sourceErrors(key, source) {
  return (source?.errors ?? []).map((error) => `${STORE_LABELS[key]}: ${error}`);
}

function tagCounts(tags) {
  return Object.entries(tags ?? {})
    .filter(([, count]) => typeof count === 'number' && count > 0)
    .sort((a, b) => b[1] - a[1]);
}

function table(headers, rows) {
  const line = (cells) => `| ${cells.map(cell).join(' | ')} |`;
  return [line(headers), `|${headers.map(() => ' --- |').join('')}`, ...rows.map(line)];
}

function link(title, url) {
  const text = collapse(title).replace(/[[\]]/g, '\\$&');
  return url ? `[${text}](${url})` : text;
}

function formatRating(app) {
  if (app.rating == null) return '-';
  const score = Number(app.rating).toFixed(1);
  return app.ratings == null ? score : `${score} (${formatInt(app.ratings)})`;
}

function formatAdsIap(app) {
  if (app.ads == null && app.iap == null) return '-';
  const parts = [];
  if (app.ads) parts.push('ads');
  if (app.iap) parts.push('iap');
  return parts.length ? parts.join(', ') : 'none';
}

function formatPrice(app) {
  const base = app.price ? Number(app.price).toFixed(2) : 'Free';
  return app.iap ? `${base} + IAP` : base;
}

function formatInt(value) {
  return value == null ? '-' : number.format(value);
}

// Nulls sort last so unrated or unranked entries never float to the top.
function sortDesc(items, get) {
  return [...items].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return y - x;
  });
}

function cell(value) {
  return escapePipes(collapse(value)) || '-';
}

// Emoji and their invisible helpers (joiners, variation selectors, keycaps,
// skin tones, flag tags). Symbols that default to text, such as (R), are kept.
const EMOJI = /\p{Emoji}️⃣?|\p{Emoji_Presentation}|\p{Emoji_Modifier}|[‍️⃣]|[\u{E0020}-\u{E007F}]/gu;

// Review text, titles and descriptions come from users, so they are cleaned
// before they land in a table cell or a blockquote.
function collapse(value) {
  return String(value ?? '')
    .replace(EMOJI, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapePipes(text) {
  return text.replace(/\|/g, '\\|');
}

function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3).trimEnd()}...`;
}
