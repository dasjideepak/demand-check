import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/report.js';
import { checkResult } from './fixtures/check-result.js';

const clone = () => structuredClone(checkResult);

// Text of one "## Heading" section, up to the next "## " heading.
function section(markdown, heading) {
  const start = markdown.indexOf(`## ${heading}`);
  assert.notEqual(start, -1, `section "${heading}" is present`);
  const rest = markdown.slice(start + heading.length + 3);
  const next = rest.search(/\n## /);
  // Body only: no heading line, no surrounding blank lines.
  return (next === -1 ? rest : rest.slice(0, next)).replace(/^\n+/, '').replace(/\n+$/, '');
}

// Data rows of the section's table: everything after the header and separator.
function tableRows(sectionText) {
  return sectionText
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .slice(2);
}

test('header names the term, date, country and stores', () => {
  const md = renderMarkdown(checkResult);
  assert.ok(md.startsWith('# Demand check: swipe photo cleaner\n'));
  assert.match(md, /Checked 2026-09-26, country US, stores Google Play, App Store, npm\./);
});

test('sections appear in the documented order', () => {
  const md = renderMarkdown(checkResult);
  const order = ['# Demand check', '## Verdict', '## Google Play', '## App Store', '## npm', '## Complaints', '## Notes'];
  const positions = order.map((h) => md.indexOf(h));
  positions.forEach((pos, i) => {
    assert.notEqual(pos, -1, `${order[i]} is present`);
    if (i > 0) assert.ok(pos > positions[i - 1], `${order[i]} comes after ${order[i - 1]}`);
  });
});

test('verdict shows the level in bold and every reason as a bullet', () => {
  const text = section(renderMarkdown(checkResult), 'Verdict');
  assert.match(text, /^\*\*Crowded\*\*/);
  const bullets = text.split('\n').filter((line) => line.startsWith('- '));
  assert.equal(bullets.length, 4);
  assert.equal(bullets[0], `- ${checkResult.verdict.reasons[0]}`);
});

test('verdict level words cover every level', () => {
  for (const [level, word] of [
    ['owned', 'Owned'],
    ['gap', 'Gap'],
    ['served', 'Served'],
    ['no-demand', 'No demand'],
    ['unknown', 'Unknown'],
  ]) {
    const result = clone();
    result.verdict.level = level;
    assert.match(section(renderMarkdown(result), 'Verdict'), new RegExp(`\\*\\*${word}\\*\\*`));
  }
});

test('Google Play table is sorted by installs and formats each column', () => {
  const rows = tableRows(section(renderMarkdown(checkResult), 'Google Play'));
  assert.equal(rows.length, 3);
  assert.equal(
    rows[0],
    '| [Swipewipe: Clean Photos](https://play.google.com/store/apps/details?id=com.swipewipe.app) | 5,000,000+ | 4.6 (88,412) | ads, iap | 2020-11-05 | 2026-09-14 |',
  );
  assert.match(rows[1], /^\| \[Slidebox - Photo Manager\]\(.*\) \| 1,000,000\+ \| 4\.3 \(31,204\) \| iap \|/);
  assert.match(rows[2], /Photo Cleaner - Swipe & Delete.*\| 100,000\+ \| 4\.1 \(2,310\) \| ads \|/);
});

test('Google Play table puts unknown installs last and shows none or - for ads and iap', () => {
  const result = clone();
  const [slidebox, swipewipe, cleaner] = result.play.apps;
  swipewipe.minInstalls = null;
  swipewipe.installs = null;
  swipewipe.ads = null;
  swipewipe.iap = null;
  slidebox.ads = false;
  slidebox.iap = false;
  cleaner.rating = null;
  const rows = tableRows(section(renderMarkdown(result), 'Google Play'));
  assert.match(rows[0], /Slidebox.*\| none \|/);
  assert.match(rows[1], /Photo Cleaner.*\| 100,000\+ \| - \| ads \|/);
  assert.match(rows[2], /Swipewipe.*\| - \| 4\.6 \(88,412\) \| - \|/);
});

test('Google Play section is skipped when play is null and says so when apps are empty', () => {
  const missing = clone();
  missing.play = null;
  const md = renderMarkdown(missing);
  assert.equal(md.includes('## Google Play'), false);
  assert.match(md, /stores App Store, npm\./);

  const empty = clone();
  empty.play.apps = [];
  assert.equal(section(renderMarkdown(empty), 'Google Play'), 'No apps found.');
});

test('App Store table is sorted by rating count and shows price', () => {
  const rows = tableRows(section(renderMarkdown(checkResult), 'App Store'));
  assert.equal(rows.length, 2);
  assert.equal(
    rows[0],
    '| [Swipewipe: Clean Photos](https://apps.apple.com/us/app/swipewipe-clean-photos/id1541212220) | 4.8 (61,900) | Free + IAP | 2020-12-01 | 2026-09-10 |',
  );
  assert.match(rows[1], /Clean Swipe.*\| 4\.7 \(8,750\) \| Free \+ IAP \|/);

  const paid = clone();
  paid.ios.apps[0].price = 2.99;
  paid.ios.apps[0].iap = false;
  assert.match(section(renderMarkdown(paid), 'App Store'), /Clean Swipe.*\| 2\.99 \|/);
});

test('npm table is sorted by downloads and truncates long descriptions', () => {
  const rows = tableRows(section(renderMarkdown(checkResult), 'npm'));
  assert.equal(rows.length, 2);
  assert.equal(
    rows[0],
    '| [photoswipe](https://www.npmjs.com/package/photoswipe) | 312,450 | 2025-03-08 | JavaScript image gallery and lightbox |',
  );
  const description = rows[1].split(' | ')[3].replace(/ \|$/, '');
  assert.ok(description.length <= 80, `description is ${description.length} chars`);
  assert.ok(description.endsWith('...'));
  assert.match(rows[1], /^\| \[swipe-cleaner\]\(.*\) \| 12 \| 2023-06-01 \|/);
});

test('complaints line counts reviews and lists tags sorted by count', () => {
  const text = section(renderMarkdown(checkResult), 'Complaints (1-2 star reviews)');
  assert.match(text, /^6 low-star reviews from 4 apps\. Complaints: paywall 4, ads 3, bugs 2, crash 1, dataLoss 1, support 1\.$/m);
});

test('complaint samples are blockquotes with pipes escaped and whitespace collapsed', () => {
  const text = section(renderMarkdown(checkResult), 'Complaints');
  const quotes = text.split('\n').filter((line) => line.startsWith('> ['));
  assert.equal(quotes.length, 3);
  assert.equal(
    quotes[1],
    '> [2] Ads \\| ads \\| more ads. Every third swipe shows a full screen video ad and the app crashed twice. - Swipewipe: Clean Photos',
  );
  // Blank lines between quotes keep them separate in rendered Markdown.
  assert.match(text, /\n\n> \[1\][^\n]*\n\n> \[2\]/);
});

test('complaint samples are truncated to 220 characters and capped at 12', () => {
  const result = clone();
  const long = { ...result.complaintSamples[0], text: 'word '.repeat(80) };
  result.complaintSamples = Array.from({ length: 20 }, () => ({ ...long }));
  const quotes = section(renderMarkdown(result), 'Complaints')
    .split('\n')
    .filter((line) => line.startsWith('> ['));
  assert.equal(quotes.length, 12);
  const body = quotes[0].replace(/^> \[1\] /, '').replace(/ - [^-]*$/, '');
  assert.ok(body.length <= 220, `sample is ${body.length} chars`);
  assert.ok(body.endsWith('...'));
});

test('complaints section says so when no reviews were fetched', () => {
  const result = clone();
  result.play.reviews = [];
  result.ios.reviews = [];
  result.complaintSamples = [];
  assert.match(section(renderMarkdown(result), 'Complaints'), /No low-star reviews were fetched\./);
});

test('notes list source errors, top-level errors and the fixed caveats', () => {
  const result = clone();
  result.errors = ['App Store: search failed after one retry (timeout)'];
  const text = section(renderMarkdown(result), 'Notes');
  assert.match(text, /^- App Store: search failed after one retry \(timeout\)$/m);
  assert.match(text, /^- Google Play: reviews unavailable for Photo Cleaner - Swipe & Delete$/m);
  assert.match(text, /unofficial scraper/);
  assert.match(text, /public buckets/);
  assert.match(text, /does not publish install counts/);
  assert.match(text, /Only the chosen store country/);
  assert.match(text, /newest 1-2 star ones, not a random sample/);
});

test('report contains no emoji', () => {
  assert.doesNotMatch(renderMarkdown(checkResult), /\p{Extended_Pictographic}/u);
});

test('emoji in user text are stripped while ordinary symbols survive', () => {
  const result = clone();
  result.complaintSamples[0].text = 'Lost my photos \u{1F494} and support never replied ❤️ ok';
  result.play.apps[0].title = 'Slidebox ® Photo Manager \u{1F525}';
  result.npm.packages[0].description = 'Swipe helper \u{1F44D}\u{1F3FD} for Expo';
  const md = renderMarkdown(result);
  assert.doesNotMatch(md, /\p{Emoji_Presentation}|️|‍/u);
  assert.match(md, /> \[1\] Lost my photos and support never replied ok -/);
  assert.match(md, /\[Slidebox ® Photo Manager\]\(/);
  assert.match(md, /Swipe helper for Expo/);
});

test('complaints line uses the singular for one review and one app', () => {
  const result = clone();
  result.play.reviews = [result.play.reviews[0]];
  result.ios.reviews = [];
  assert.match(section(renderMarkdown(result), 'Complaints'), /^1 low-star review from 1 app\./m);
});

test('verdict heading uses the summary from the analyzer when present', () => {
  const result = clone();
  result.verdict.level = 'served';
  result.verdict.summary = 'demand exists, complaints not measured';
  assert.match(section(renderMarkdown(result), 'Verdict'), /^\*\*Served\*\* \(demand exists, complaints not measured\)/);
  delete result.verdict.summary;
  assert.match(section(renderMarkdown(result), 'Verdict'), /^\*\*Served\*\* \(demand exists, few players, users are happy\)/);
});

test('npm-only report has no country and no app store caveats', () => {
  const result = clone();
  result.play = null;
  result.ios = null;
  const md = renderMarkdown(result);
  assert.match(md, /^Checked 2026-09-26, stores npm\.$/m);
  const notes = section(md, 'Notes');
  assert.doesNotMatch(notes, /unofficial scraper|public buckets|does not publish install counts|chosen store country|newest 1-2 star/);
  assert.match(notes, /Search results that share too few/);

  const playOnly = clone();
  playOnly.ios = null;
  playOnly.npm = null;
  const playNotes = section(renderMarkdown(playOnly), 'Notes');
  assert.match(playNotes, /unofficial scraper/);
  assert.doesNotMatch(playNotes, /does not publish install counts/);
});

test('report uses plain hyphens, not en or em dashes', () => {
  assert.doesNotMatch(renderMarkdown(checkResult), /[\u2013\u2014]/);
});
