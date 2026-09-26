import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { tagComplaints, verdict } from '../src/analyze.js';

// Fixtures reproduce four real searches made on 2026-09-26; the date is pinned
// so the 18-month newcomer window does not drift as time passes.
const NOW = '2026-09-26';

function playApp(overrides) {
  return {
    store: 'play',
    id: 'com.example.app',
    title: 'App',
    url: 'https://play.google.com/store/apps/details?id=com.example.app',
    developer: 'Example',
    installs: null,
    minInstalls: null,
    rating: 4.2,
    ratings: 1200,
    ads: true,
    iap: true,
    price: 0,
    released: '2020-01-15',
    updated: '2026-09-01',
    ...overrides,
  };
}

function iosApp(overrides) {
  return {
    store: 'ios',
    id: '123456',
    title: 'iOS App',
    url: 'https://apps.apple.com/us/app/id123456',
    developer: 'Example',
    installs: null,
    minInstalls: null,
    rating: 4.5,
    ratings: 500,
    ads: null,
    iap: true,
    price: 0,
    released: '2021-03-01',
    updated: '2026-08-20',
    ...overrides,
  };
}

function review(overrides) {
  return {
    store: 'play',
    appId: 'com.example.app',
    appTitle: 'App',
    score: 1,
    text: 'Bad.',
    date: '2026-09-20',
    ...overrides,
  };
}

function storeResult(store, apps, reviews = []) {
  return { store, term: 'test', country: 'us', apps, reviews, errors: [] };
}

function npmResult(packages) {
  return { registry: 'npm', term: 'test', packages, errors: [] };
}

function pkg(name, weeklyDownloads) {
  return {
    registry: 'npm',
    name,
    description: '',
    version: '1.0.0',
    weeklyDownloads,
    lastPublish: '2026-01-01',
    url: `https://www.npmjs.com/package/${name}`,
  };
}

function zeroTags(overrides = {}) {
  return { ads: 0, paywall: 0, crash: 0, dataLoss: 0, offline: 0, login: 0, support: 0, bugs: 0, ...overrides };
}

const joined = (v) => v.reasons.join(' ');

describe('tagComplaints', () => {
  test('one review can hit several tags', () => {
    const { tags, samples } = tagComplaints([
      review({ text: 'Too many ads and it crashes every time I try to pay for premium' }),
    ]);
    assert.deepEqual(tags, zeroTags({ ads: 1, paywall: 1, crash: 1 }));
    assert.equal(samples.length, 1);
  });

  test('understands Hinglish complaints', () => {
    const { tags } = tagComplaints([
      review({ text: 'Bakwas app, saara data gayab ho gaya aur support koi jawab nahi deta' }),
    ]);
    assert.equal(tags.bugs, 1);
    assert.equal(tags.dataLoss, 1);
    assert.equal(tags.support, 1);
  });

  test('word boundaries keep "added" and "bad" out of the ads tag', () => {
    const { tags } = tagComplaints([review({ text: 'I added my photos and it was bad, load time is fine' })]);
    assert.equal(tags.ads, 0);
  });

  test('matches case-insensitively and curly apostrophes', () => {
    const { tags } = tagComplaints([review({ text: 'WON\u2019T OPEN after the update, DOESN\u2019T WORK at all' })]);
    assert.equal(tags.crash, 1);
    assert.equal(tags.bugs, 1);
  });

  test('catches data-loss and breakage phrasings from real Indian store reviews', () => {
    const texts = [
      'data erase ho jata hai apne aap bhot hi gatiya aap',
      'customers data automatic deleting why please solve the problem',
      'automatically customer details deleat/repeated',
      'fake app..after some days your data automatically erased',
    ];
    const { tags } = tagComplaints(texts.map((text) => review({ text })));
    assert.equal(tags.dataLoss, 4);
    assert.equal(tagComplaints([review({ text: 'not properly working this application' })]).tags.bugs, 1);
    // Deleting photos is the job of a photo cleaner, not a data-loss complaint.
    assert.equal(tagComplaints([review({ text: 'I deleted 269 photos and it asked me again' })]).tags.dataLoss, 0);
  });

  test('ignores reviews above 2 stars', () => {
    const { tags, samples } = tagComplaints([
      review({ score: 5, text: 'Great app, no ads at all' }),
      review({ score: 2, text: 'Full of ads' }),
    ]);
    assert.equal(tags.ads, 1);
    assert.equal(samples.length, 1);
    assert.equal(samples[0].score, 2);
  });

  test('empty input gives zero tags and no samples', () => {
    assert.deepEqual(tagComplaints([]), { tags: zeroTags(), samples: [] });
    assert.deepEqual(tagComplaints(undefined), { tags: zeroTags(), samples: [] });
  });

  test('caps samples at 12', () => {
    const reviews = Array.from({ length: 20 }, (_, i) => review({ text: `Review number ${i} keeps crashing on my phone` }));
    const { tags, samples } = tagComplaints(reviews);
    assert.equal(tags.crash, 20);
    assert.equal(samples.length, 12);
  });

  test('drops samples that share their first 60 characters', () => {
    const prefix = 'This app keeps crashing whenever I open the gallery tab and try';
    assert.ok(prefix.length >= 60);
    const { samples } = tagComplaints([
      review({ text: `${prefix} to delete something.` }),
      review({ text: `${prefix} to swipe.` }),
      review({ text: 'Different complaint about ads.' }),
    ]);
    assert.equal(samples.length, 2);
    const prefixes = samples.map((s) => s.text.slice(0, 60));
    assert.equal(new Set(prefixes).size, 2);
  });

  test('round-robins across apps and prefers tagged, longer reviews', () => {
    const a = (text, score = 1) => review({ appId: 'a', appTitle: 'A', text, score });
    const b = (text, score = 1) => review({ appId: 'b', appTitle: 'B', text, score });
    const { samples } = tagComplaints([
      a('Short untagged text that is nevertheless quite a bit longer than the others'),
      a('Ads everywhere'),
      a('Ads everywhere and the subscription is expensive, very long tagged review'),
      b('Meh'),
      b('Crashes on launch every single time'),
    ]);
    assert.deepEqual(
      samples.map((s) => s.appId),
      ['a', 'b', 'a', 'b', 'a'],
    );
    assert.equal(samples[0].text, 'Ads everywhere and the subscription is expensive, very long tagged review');
    assert.equal(samples[1].text, 'Crashes on launch every single time');
    assert.equal(samples[2].text, 'Ads everywhere');
    assert.equal(samples[3].text, 'Meh');
  });

  test('skips reviews with empty text when sampling', () => {
    const { samples } = tagComplaints([review({ text: '' }), review({ text: '   ' }), review({ text: 'Broken' })]);
    assert.equal(samples.length, 1);
    assert.equal(samples[0].text, 'Broken');
  });
});

describe('verdict fixtures from 2026-09-26', () => {
  test('swipe photo cleaner is crowded and newcomers still get traction', () => {
    const apps = [
      playApp({ id: 'a', title: 'Cleaner A', installs: '1,000,000+', minInstalls: 1_000_000, ratings: 42_000, released: '2019-05-10' }),
      playApp({ id: 'b', title: 'Cleaner B', installs: '500,000+', minInstalls: 500_000, ratings: 18_000, released: '2020-11-02' }),
      playApp({ id: 'c', title: 'Cleaner C', installs: '500,000+', minInstalls: 500_000, ratings: 9_000, released: '2021-06-18' }),
      playApp({ id: 'd', title: 'Cleaner D', installs: '100,000+', minInstalls: 100_000, ratings: 2_100, released: '2022-02-01' }),
      playApp({ id: 'e', title: 'Cleaner E', installs: '50,000+', minInstalls: 50_000, ratings: 900, released: '2025-03-30' }),
      playApp({ id: 'f', title: 'Cleaner F', installs: '10,000+', minInstalls: 10_000, ratings: 150, released: '2025-07-15' }),
    ];
    const complaints = [
      'Too many ads, an ad after every swipe',
      'Forced to watch an ad to delete photos',
      'Ads ads ads. Unusable without paying',
      'Only 20 swipes then subscription wall, greedy',
      'Premium is too expensive per month for a photo cleaner',
      'Trial ended and now everything is limited',
      'Constant advertisements and popups',
      'Pay to delete my own photos? No thanks',
      'Full of adds and the free version is useless',
      'Subscription is a rip off, paid and still ads',
      'Crashes when I swipe fast',
    ].map((text, i) => review({ appId: apps[i % 3].id, appTitle: apps[i % 3].title, text, score: 1 + (i % 2) }));
    const play = storeResult('play', apps, complaints);
    const { tags } = tagComplaints(complaints);
    assert.ok(tags.ads >= 6, `ads tagged: ${tags.ads}`);
    assert.ok(tags.paywall >= 6, `paywall tagged: ${tags.paywall}`);

    const v = verdict({ play, ios: null, npm: null, tags, reviewCount: 60, now: NOW });
    assert.equal(v.level, 'crowded');
    assert.equal(v.signals.leaderInstalls, 1_000_000);
    assert.equal(v.signals.appsOver1m, 1);
    assert.equal(v.signals.appsOver100k, 4);
    assert.equal(v.signals.newcomersOver10k, 2);
    assert.match(v.reasons[0], /4 Play apps have 100,000\+ installs/);
    assert.match(joined(v), /2 apps launched in the last 18 months already have 10,000\+ installs/);
    assert.match(joined(v), /Top complaints: (ads|paywall) \(\d+\), (ads|paywall) \(\d+\)/);
    assert.match(joined(v), /no ads/);
    assert.match(joined(v), /one-time price or unlimited free tier/);
  });

  test('developer news is owned by a 5M+ leader far ahead of the rest', () => {
    const play = storeResult('play', [
      playApp({ id: 'leader', title: 'Dev News Leader', installs: '5,000,000+', minInstalls: 5_000_000, ratings: 19_760, released: '2017-04-01' }),
      playApp({ id: 'second', title: 'Runner Up', installs: '500,000+', minInstalls: 500_000, ratings: 6_000, released: '2019-01-01' }),
    ]);
    const v = verdict({ play, ios: null, npm: null, tags: zeroTags(), reviewCount: 0, now: NOW });
    assert.equal(v.level, 'owned');
    assert.match(v.reasons[0], /5,000,000\+ installs/);
    assert.match(v.reasons[0], /Dev News Leader/);
    assert.equal(v.signals.leaderInstalls, 5_000_000);
    assert.equal(v.signals.appsOver1m, 1);
  });

  test('startup funding news has no demand', () => {
    const play = storeResult('play', [
      playApp({ id: 'x', title: 'Funding Feed', installs: '1,000+', minInstalls: 1_000, ratings: 30, released: '2023-01-01' }),
      playApp({ id: 'y', title: 'Startup Wire', installs: '500+', minInstalls: 500, ratings: 8, released: '2024-06-01' }),
    ]);
    const v = verdict({ play, ios: null, npm: npmResult([]), tags: zeroTags(), reviewCount: 0, now: NOW });
    assert.equal(v.level, 'no-demand');
    assert.match(v.reasons[0], /1,000\+ installs/);
    assert.equal(v.signals.leaderInstalls, 1_000);
    assert.equal(v.signals.topWeeklyDownloads, 0);
  });

  test('milk collection is a gap: real demand, weak apps, real complaints', () => {
    const apps = [
      playApp({ id: 'm1', title: 'Milk Collection 1', installs: '100,000+', minInstalls: 100_000, ratings: 1_500, released: '2018-09-01' }),
      playApp({ id: 'm2', title: 'Milk Collection 2', installs: '100,000+', minInstalls: 100_000, ratings: 1_100, released: '2019-02-01' }),
      playApp({ id: 'm3', title: 'Milk Collection 3', installs: '100,000+', minInstalls: 100_000, ratings: 800, released: '2020-07-01' }),
      playApp({ id: 'm4', title: 'Milk Collection 4', installs: '50,000+', minInstalls: 50_000, ratings: 300, released: '2021-01-01' }),
    ];
    const lowStars = Array.from({ length: 16 }, (_, i) => review({ appId: apps[i % 4].id, text: `complaint ${i}` }));
    const play = storeResult('play', apps, lowStars);
    const tags = zeroTags({ crash: 6, dataLoss: 4, offline: 3, support: 3 });
    const v = verdict({ play, ios: null, npm: npmResult([]), tags, reviewCount: 80, now: NOW });
    assert.equal(v.level, 'gap');
    assert.equal(v.signals.appsOver100k, 3);
    assert.equal(v.signals.appsOver1m, 0);
    assert.equal(v.signals.lowStarShare, 0.2);
    assert.equal(v.signals.newcomersOver10k, 0);
    assert.match(v.reasons[0], /16 tagged complaints in 16 low-star reviews/);
    assert.match(v.reasons[0], /20% of 80 fetched reviews/);
    assert.match(joined(v), /No app launched in the last 18 months has reached 10,000 installs/);
    assert.match(joined(v), /Top complaints: crash \(6\), dataLoss \(4\), (offline|support) \(3\)/);
    assert.match(joined(v), /reliability/);
    assert.match(joined(v), /safe delete with undo/);
  });
});

describe('verdict rules', () => {
  test('unknown when every source is null or empty', () => {
    const empty = verdict({ play: null, ios: null, npm: null, tags: zeroTags(), reviewCount: 0, now: NOW });
    assert.equal(empty.level, 'unknown');
    assert.match(empty.reasons[0], /0 Play apps, 0 iOS apps and 0 npm packages/);
    assert.deepEqual(empty.signals, {
      leaderInstalls: null,
      appsOver100k: 0,
      appsOver1m: 0,
      newcomersOver10k: 0,
      lowStarShare: 0,
      topWeeklyDownloads: 0,
    });

    const hollow = verdict({ play: storeResult('play', []), ios: storeResult('ios', []), npm: npmResult([]), tags: zeroTags(), reviewCount: 0, now: NOW });
    assert.equal(hollow.level, 'unknown');
  });

  test('owned by a 10M+ Play leader', () => {
    const play = storeResult('play', [
      playApp({ title: 'Giant', installs: '10,000,000+', minInstalls: 10_000_000, ratings: 400_000 }),
      playApp({ id: 'b', title: 'Big', installs: '1,000,000+', minInstalls: 1_000_000 }),
      playApp({ id: 'c', title: 'Big 2', installs: '1,000,000+', minInstalls: 1_000_000 }),
    ]);
    const v = verdict({ play, tags: zeroTags(), now: NOW });
    assert.equal(v.level, 'owned');
    assert.match(v.reasons[0], /10,000,000\+ installs/);
  });

  test('owned by a 5M+ Play leader with 50k+ ratings even next to another 1M app', () => {
    const play = storeResult('play', [
      playApp({ title: 'Giant', installs: '5,000,000+', minInstalls: 5_000_000, ratings: 61_000 }),
      playApp({ id: 'b', title: 'Big', installs: '1,000,000+', minInstalls: 1_000_000 }),
    ]);
    const v = verdict({ play, tags: zeroTags(), now: NOW });
    assert.equal(v.level, 'owned');
    assert.match(v.reasons[0], /61,000 ratings/);
  });

  test('5M+ leader with few ratings and another 1M app is crowded, not owned', () => {
    const play = storeResult('play', [
      playApp({ title: 'Giant', installs: '5,000,000+', minInstalls: 5_000_000, ratings: 20_000 }),
      playApp({ id: 'b', title: 'Big', installs: '1,000,000+', minInstalls: 1_000_000 }),
    ]);
    const v = verdict({ play, tags: zeroTags(), now: NOW });
    assert.equal(v.level, 'crowded');
    assert.match(v.reasons[0], /2 Play apps have 1,000,000\+ installs/);
  });

  test('owned by an iOS app with 100k+ ratings', () => {
    const ios = storeResult('ios', [iosApp({ title: 'Apple Giant', ratings: 150_000 })]);
    const v = verdict({ play: null, ios, npm: null, tags: zeroTags(), now: NOW });
    assert.equal(v.level, 'owned');
    assert.match(v.reasons[0], /Apple Giant/);
    assert.match(v.reasons[0], /150,000 ratings/);
    assert.equal(v.signals.leaderInstalls, null);
  });

  test('owned by a 1M+ weekly npm package when npm is the only source', () => {
    const npm = npmResult([pkg('big-lib', 2_500_000), pkg('small-lib', 400)]);
    const v = verdict({ npm, tags: zeroTags(), now: NOW });
    assert.equal(v.level, 'owned');
    assert.match(v.reasons[0], /big-lib/);
    assert.match(v.reasons[0], /2,500,000 weekly downloads/);
    assert.equal(v.signals.topWeeklyDownloads, 2_500_000);
  });

  test('a 1M+ npm package next to app results does not make it owned', () => {
    const npm = npmResult([pkg('big-lib', 2_500_000)]);
    const play = storeResult('play', [playApp({ installs: '100,000+', minInstalls: 100_000 })]);
    const v = verdict({ play, npm, tags: zeroTags(), now: NOW });
    assert.notEqual(v.level, 'owned');
  });

  test('crowded when three npm packages clear 10k weekly downloads', () => {
    const npm = npmResult([pkg('a', 50_000), pkg('b', 20_000), pkg('c', 10_000), pkg('d', 50)]);
    const v = verdict({ npm, tags: zeroTags(), now: NOW });
    assert.equal(v.level, 'crowded');
    assert.match(v.reasons[0], /3 npm packages have 10,000\+ weekly downloads/);
  });

  test('crowded when iOS ratings stand in for installs', () => {
    const ios = storeResult('ios', [
      iosApp({ id: '1', ratings: 12_000 }),
      iosApp({ id: '2', ratings: 30_000 }),
      iosApp({ id: '3', ratings: 200 }),
    ]);
    const v = verdict({ ios, tags: zeroTags(), now: NOW });
    assert.equal(v.level, 'crowded');
    assert.match(v.reasons[0], /2 iOS apps have 10,000\+ ratings/);
  });

  test('no-demand needs both tiny apps and tiny npm numbers', () => {
    const play = storeResult('play', [playApp({ installs: '5,000+', minInstalls: 5_000 })]);
    const tiny = verdict({ play, npm: npmResult([pkg('x', 120)]), tags: zeroTags(), now: NOW });
    assert.equal(tiny.level, 'no-demand');
    assert.match(tiny.reasons[0], /5,000\+ installs/);
    assert.match(tiny.reasons[0], /120 weekly downloads/);

    const npmSaves = verdict({ play, npm: npmResult([pkg('x', 900)]), tags: zeroTags(), now: NOW });
    assert.notEqual(npmSaves.level, 'no-demand');
  });

  test('served when demand exists and complaints are low', () => {
    const play = storeResult('play', [
      playApp({ installs: '200,000+', minInstalls: 200_000 }),
    ], [review({ text: 'a' }), review({ text: 'b' })]);
    const v = verdict({ play, tags: zeroTags({ ads: 2 }), reviewCount: 40, now: NOW });
    assert.equal(v.level, 'served');
    assert.equal(v.signals.lowStarShare, 0.05);
    assert.match(v.reasons[0], /Demand exists/);
    assert.match(v.reasons[0], /2 tagged complaints in 2 low-star reviews, 5% of 40 fetched reviews/);
  });

  test('gap when the low-star share alone is high enough', () => {
    const lowStars = Array.from({ length: 8 }, (_, i) => review({ text: `r${i}` }));
    const play = storeResult('play', [playApp({ installs: '200,000+', minInstalls: 200_000 })], lowStars);
    const v = verdict({ play, tags: zeroTags({ crash: 3 }), reviewCount: 40, now: NOW });
    assert.equal(v.level, 'gap');
    assert.equal(v.signals.lowStarShare, 0.2);
  });

  test('gap when the tag sum alone is high enough', () => {
    const play = storeResult('play', [playApp({ installs: '200,000+', minInstalls: 200_000 })], [review({ text: 'x' })]);
    const v = verdict({ play, tags: zeroTags({ offline: 7, support: 4 }), reviewCount: 0, now: NOW });
    assert.equal(v.level, 'gap');
    assert.equal(v.signals.lowStarShare, 0);
    assert.match(v.reasons[0], /low-star share unknown/);
    assert.match(joined(v), /offline-first/);
    assert.match(joined(v), /responsive support/);
  });

  test('modest demand without complaints is served with a caveat when no reviews were fetched', () => {
    const play = storeResult('play', [playApp({ installs: '50,000+', minInstalls: 50_000 })]);
    const v = verdict({ play, tags: zeroTags(), reviewCount: 0, now: NOW });
    assert.equal(v.level, 'served');
    assert.match(v.reasons[0], /Demand is modest/);
    assert.match(joined(v), /No low-star reviews were fetched \(0\)/);
  });

  test('every level carries a summary for the report heading', () => {
    const play = storeResult('play', [playApp({ installs: '200,000+', minInstalls: 200_000 })], [review({ text: 'x' })]);
    for (const input of [
      { play: null, tags: zeroTags() },
      { play: storeResult('play', [playApp({ minInstalls: 10_000_000 })]), tags: zeroTags() },
      { play, tags: zeroTags({ ads: 12 }) },
      { play, tags: zeroTags() },
    ]) {
      const v = verdict({ ...input, now: NOW });
      assert.equal(typeof v.summary, 'string');
      assert.ok(v.summary.length > 0, `${v.level} has a summary`);
    }
  });

  test('gap needs demand: modest demand with real complaints stays served and says why', () => {
    const lowStars = Array.from({ length: 12 }, (_, i) => review({ text: `r${i}` }));
    const play = storeResult('play', [playApp({ installs: '50,000+', minInstalls: 50_000 })], lowStars);
    const v = verdict({ play, tags: zeroTags({ ads: 12 }), reviewCount: 0, now: NOW });
    assert.equal(v.level, 'served');
    assert.equal(v.summary, 'demand is modest, users complain');
    assert.match(v.reasons[0], /^Demand is modest .* and complaints are real: .*, but demand is too small to call a gap\.$/);
  });

  test('no low-star reviews means the complaint side is unmeasured, not happy', () => {
    const play = storeResult('play', [playApp({ installs: '200,000+', minInstalls: 200_000 })]);
    const v = verdict({ play, tags: zeroTags(), reviewCount: 0, now: NOW });
    assert.equal(v.level, 'served');
    assert.equal(v.summary, 'demand exists, complaints not measured');
    assert.match(v.reasons[0], /but no low-star reviews were fetched, so pain is unmeasured\.$/);
    assert.doesNotMatch(v.reasons[0], /complaints are low/);
  });

  test('gap when one complaint covers half of a handful of low-star reviews', () => {
    const lowStars = Array.from({ length: 8 }, (_, i) => review({ text: `r${i}` }));
    const play = storeResult('play', [playApp({ installs: '100,000+', minInstalls: 100_000 })], lowStars);
    const v = verdict({ play, tags: zeroTags({ dataLoss: 4, bugs: 2 }), reviewCount: 600, now: NOW });
    assert.equal(v.level, 'gap');
    assert.match(v.reasons[0], /6 tagged complaints in 8 low-star reviews, 1% of 600 fetched reviews are 1-2 stars, and dataLoss alone covers 4 of the 8\./);

    const three = verdict({ play: storeResult('play', play.apps, lowStars.slice(0, 3)), tags: zeroTags({ dataLoss: 2 }), reviewCount: 600, now: NOW });
    assert.equal(three.level, 'served', 'fewer than 4 low-star reviews is too few to call a pattern');
  });

  test('newcomer cutoff clamps to the end of the month instead of rolling over', () => {
    const play = storeResult('play', [playApp({ installs: '100,000+', minInstalls: 100_000, released: '2024-09-30' })]);
    assert.equal(verdict({ play, tags: zeroTags(), now: '2026-03-31' }).signals.newcomersOver10k, 1);
    assert.equal(verdict({ play, tags: zeroTags(), now: '2026-04-01' }).signals.newcomersOver10k, 0);
  });

  test('newcomer window is 18 months from the reference date', () => {
    const apps = [
      playApp({ id: 'old', installs: '100,000+', minInstalls: 100_000, released: '2025-03-20' }),
      playApp({ id: 'new', installs: '10,000+', minInstalls: 10_000, released: '2025-04-01' }),
      playApp({ id: 'small', installs: '5,000+', minInstalls: 5_000, released: '2026-01-01' }),
      playApp({ id: 'undated', installs: '100,000+', minInstalls: 100_000, released: null }),
    ];
    const v = verdict({ play: storeResult('play', apps), tags: zeroTags(), now: NOW });
    assert.equal(v.signals.newcomersOver10k, 1);
    assert.match(joined(v), /1 app launched in the last 18 months already has 10,000\+ installs/);

    const later = verdict({ play: storeResult('play', apps), tags: zeroTags(), now: '2026-10-15' });
    assert.equal(later.signals.newcomersOver10k, 0);
  });

  test('missing release dates do not claim newcomers struggle', () => {
    const play = storeResult('play', [playApp({ installs: '100,000+', minInstalls: 100_000, released: null })]);
    const v = verdict({ play, tags: zeroTags(), now: NOW });
    assert.match(joined(v), /Release dates are missing/);
  });

  test('tolerates a missing tags object and odd tag values', () => {
    const play = storeResult('play', [playApp({ installs: '200,000+', minInstalls: 200_000 })]);
    const v = verdict({ play, tags: { ads: '3', crash: -1, bogus: 9 }, now: NOW });
    assert.equal(v.level, 'served');
    assert.match(joined(v), /Top complaints: ads \(3\)\./);
    const none = verdict({ play, now: NOW });
    assert.equal(none.level, 'served');
  });

  test('rejects an unparseable reference date', () => {
    assert.throws(() => verdict({ play: null, tags: zeroTags(), now: 'yesterday' }), TypeError);
  });
});
