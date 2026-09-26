import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeApp, normalizeReview, pickLowStarReviews, searchPlay } from '../src/sources/play.js';

const NETWORK = Boolean(process.env.DEMAND_CHECK_NETWORK);

// Shape of gplay.search hit merged with gplay.app details.
const detailsFixture = {
  appId: 'com.example.cleaner',
  title: 'Example Cleaner',
  url: 'https://play.google.com/store/apps/details?id=com.example.cleaner&hl=en&gl=us',
  developer: 'Example Labs',
  installs: '1,000,000+',
  minInstalls: 1000000,
  maxInstalls: 2345678,
  score: 4.3,
  scoreText: '4.3',
  ratings: 12345,
  reviews: 4321,
  adSupported: true,
  offersIAP: true,
  IAPRange: '$0.99 - $9.99',
  price: 0,
  free: true,
  released: 'Feb 7, 2024',
  // Noon UTC so the calendar date is the same in every time zone.
  updated: Date.UTC(2024, 5, 15, 12, 0, 0),
  summary: 'Swipe to clean your gallery',
  genre: 'Tools'
};

const appRecord = normalizeApp(detailsFixture);

test('normalizeApp maps full details to an AppRecord', () => {
  assert.deepEqual(appRecord, {
    store: 'play',
    id: 'com.example.cleaner',
    title: 'Example Cleaner',
    url: 'https://play.google.com/store/apps/details?id=com.example.cleaner&hl=en&gl=us',
    developer: 'Example Labs',
    installs: '1,000,000+',
    minInstalls: 1000000,
    rating: 4.3,
    ratings: 12345,
    ads: true,
    iap: true,
    price: 0,
    released: '2024-02-07',
    updated: '2024-06-15'
  });
});

test('normalizeApp keeps numbers as numbers', () => {
  assert.equal(typeof appRecord.minInstalls, 'number');
  assert.equal(typeof appRecord.rating, 'number');
  assert.equal(typeof appRecord.ratings, 'number');
  assert.equal(typeof appRecord.price, 'number');
});

test('normalizeApp turns missing fields into null and builds a url when absent', () => {
  const record = normalizeApp({ appId: 'com.example.bare', title: 'Bare', developer: 'Nobody' });
  assert.equal(record.rating, null);
  assert.equal(record.ratings, null);
  assert.equal(record.installs, null);
  assert.equal(record.minInstalls, null);
  assert.equal(record.ads, null);
  assert.equal(record.iap, null);
  assert.equal(record.price, 0);
  assert.equal(record.released, null);
  assert.equal(record.updated, null);
  assert.equal(record.url, 'https://play.google.com/store/apps/details?id=com.example.bare');
});

test('normalizeApp handles a search hit without details (score present, no installs)', () => {
  const record = normalizeApp({ appId: 'com.example.hit', title: 'Hit', developer: 'Dev', score: 3.9, price: 1.99, url: 'https://play.google.com/store/apps/details?id=com.example.hit' });
  assert.equal(record.rating, 3.9);
  assert.equal(record.price, 1.99);
  assert.equal(record.installs, null);
  assert.equal(record.ads, null);
});

test('normalizeApp returns null for an unparsable release date and keeps a paid price', () => {
  const record = normalizeApp({ ...detailsFixture, released: 'sometime last year', price: 2.49, adSupported: false, offersIAP: false });
  assert.equal(record.released, null);
  assert.equal(record.price, 2.49);
  assert.equal(record.ads, false);
  assert.equal(record.iap, false);
});

test('normalizeApp accepts an ISO timestamp string for updated', () => {
  const record = normalizeApp({ ...detailsFixture, updated: '2023-11-30T23:59:59.000Z' });
  assert.equal(record.updated, '2023-11-30');
});

const reviewFixture = {
  id: 'gp:AOqpTOE',
  userName: 'A User',
  date: '2024-03-01T09:15:00.000Z',
  score: 1,
  scoreText: '1',
  text: '  Deleted the wrong photos and there is no way to recover them. Ads everywhere.  ',
  version: '3.2.1',
  thumbsUp: 12
};

test('normalizeReview maps a review to a ReviewRecord', () => {
  assert.deepEqual(normalizeReview(reviewFixture, appRecord), {
    store: 'play',
    appId: 'com.example.cleaner',
    appTitle: 'Example Cleaner',
    score: 1,
    text: 'Deleted the wrong photos and there is no way to recover them. Ads everywhere.',
    date: '2024-03-01'
  });
});

test('normalizeReview tolerates a missing date and text', () => {
  const record = normalizeReview({ score: 2 }, appRecord);
  assert.equal(record.date, null);
  assert.equal(record.text, '');
  assert.equal(record.score, 2);
});

test('pickLowStarReviews keeps 1-2 star reviews longer than 30 characters', () => {
  const long = 'This app crashes every time I open it, useless now.';
  const picked = pickLowStarReviews([
    { score: 1, text: long },
    { score: 2, text: long },
    { score: 3, text: long },
    { score: 5, text: long },
    { score: 1, text: 'Bad.' },
    { score: 2, text: 'x'.repeat(30) },
    { score: 1, text: 'x'.repeat(31) },
    { score: 1 },
    null
  ]);
  assert.equal(picked.length, 3);
  assert.deepEqual(picked.map((r) => r.score), [1, 2, 1]);
});

test('searchPlay returns ranked apps and low-star reviews (live)', { skip: !NETWORK }, async (t) => {
  const result = await searchPlay('swipe photo cleaner', { limit: 3, reviewsPer: 1, reviewCount: 50 });

  assert.equal(result.store, 'play');
  assert.equal(result.term, 'swipe photo cleaner');
  assert.equal(result.country, 'us');
  assert.ok(Array.isArray(result.errors));
  assert.ok(result.apps.length > 0, 'expected at least one app');
  assert.ok(result.apps.length <= 3);

  for (const app of result.apps) {
    assert.equal(app.store, 'play');
    assert.ok(app.id, 'app has an id');
    assert.ok(app.title, `app ${app.id} has a title`);
    assert.match(app.url, /^https:\/\/play\.google\.com\//, `app ${app.id} has a Play url`);
  }

  for (const review of result.reviews) {
    assert.equal(review.store, 'play');
    assert.ok(review.score >= 1 && review.score <= 2);
    assert.ok(review.text.length > 30);
    assert.equal(review.appId, result.apps[0].id);
  }

  t.diagnostic(`apps=${result.apps.length} reviews=${result.reviews.length} errors=${result.errors.length}`);
  t.diagnostic(`first app: ${JSON.stringify(result.apps[0])}`);
  if (result.errors.length) t.diagnostic(`errors: ${result.errors.join(' | ')}`);
});
