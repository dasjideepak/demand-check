import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { searchIos, normalizeApp, normalizeReview } from '../src/sources/ios.js';

// Trimmed from a real iTunes Search API result (September 2026).
const rawApp = {
  kind: 'software',
  trackId: 1583884012,
  trackName: 'Swipewipe: Photo Cleaner',
  trackViewUrl: 'https://apps.apple.com/us/app/swipewipe-photo-cleaner/id1583884012?uo=4',
  sellerName: 'MWM',
  artistName: 'MWM Studio',
  averageUserRating: 4.68939,
  userRatingCount: 94329,
  price: 0,
  releaseDate: '2022-03-05T08:00:00Z',
  currentVersionReleaseDate: '2026-09-22T15:33:21Z',
};

// Trimmed from a real RSS customerreviews feed entry.
const rawEntry = {
  author: { name: { label: 'someone' } },
  updated: { label: '2026-09-24T23:55:26-07:00' },
  'im:rating': { label: '1' },
  'im:version': { label: '3.4.16' },
  title: { label: 'Grrr' },
  content: { label: 'IT SAYS IT FREE BUT ITS NOT U HAVE TO PAY', attributes: { type: 'text' } },
};

const app = { id: '1583884012', title: 'Swipewipe: Photo Cleaner' };

describe('normalizeApp', () => {
  test('maps a search result to an AppRecord', () => {
    const record = normalizeApp(rawApp);
    assert.deepEqual(record, {
      store: 'ios',
      id: '1583884012',
      title: 'Swipewipe: Photo Cleaner',
      url: 'https://apps.apple.com/us/app/swipewipe-photo-cleaner/id1583884012?uo=4',
      developer: 'MWM',
      installs: null,
      minInstalls: null,
      rating: 4.68939,
      ratings: 94329,
      ads: null,
      iap: null,
      price: 0,
      released: '2022-03-05',
      updated: '2026-09-22',
    });
    assert.equal(typeof record.id, 'string');
  });

  test('falls back to artistName when sellerName is missing', () => {
    const { sellerName, ...withoutSeller } = rawApp;
    assert.equal(normalizeApp(withoutSeller).developer, 'MWM Studio');
  });

  test('unrated app gets null rating and null dates when fields are missing', () => {
    const record = normalizeApp({ trackId: 1, trackName: 'New', averageUserRating: 0, userRatingCount: 0 });
    assert.equal(record.rating, null);
    assert.equal(record.ratings, 0);
    assert.equal(record.released, null);
    assert.equal(record.updated, null);
    assert.equal(record.price, 0);
    assert.equal(record.url, 'https://apps.apple.com/app/id1');
  });

  test('paid app keeps its price as a number', () => {
    assert.equal(normalizeApp({ ...rawApp, price: 4.99 }).price, 4.99);
  });
});

describe('normalizeReview', () => {
  test('rating label string becomes a number and the date is trimmed to YYYY-MM-DD', () => {
    const review = normalizeReview(rawEntry, app);
    assert.deepEqual(review, {
      store: 'ios',
      appId: '1583884012',
      appTitle: 'Swipewipe: Photo Cleaner',
      score: 1,
      text: 'Grrr: IT SAYS IT FREE BUT ITS NOT U HAVE TO PAY',
      date: '2026-09-24',
    });
  });

  test('missing updated gives a null date', () => {
    const { updated, ...withoutDate } = rawEntry;
    assert.equal(normalizeReview(withoutDate, app).date, null);
  });

  test('missing title leaves the body alone', () => {
    const { title, ...withoutTitle } = rawEntry;
    assert.equal(normalizeReview(withoutTitle, app).text, 'IT SAYS IT FREE BUT ITS NOT U HAVE TO PAY');
  });

  test('missing rating gives a null score', () => {
    const { 'im:rating': rating, ...withoutRating } = rawEntry;
    assert.equal(normalizeReview(withoutRating, app).score, null);
  });
});

describe('searchIos with a stubbed fetch', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function jsonResponse(body, status = 200) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(text, { status, headers: { 'content-type': 'text/javascript; charset=utf-8' } });
  }

  function entry(rating, content, extra = {}) {
    return { 'im:rating': { label: String(rating) }, content: { label: content }, title: { label: 'T' }, ...extra };
  }

  const longText = 'This app crashes every single time I open the gallery tab.';

  test('collects low-star reviews, handles single-object and missing entries, records feed failures', async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      const u = String(url);
      if (u.startsWith('https://itunes.apple.com/search?')) {
        return jsonResponse({
          resultCount: 4,
          results: [
            { ...rawApp, trackId: 1, trackName: 'One' },
            { ...rawApp, trackId: 2, trackName: 'Two' },
            { ...rawApp, trackId: 3, trackName: 'Three' },
            { ...rawApp, trackId: 4, trackName: 'Four' },
          ],
        });
      }
      if (u.includes('/id=1/')) {
        // Array of entries: keep the low-star long ones only.
        return jsonResponse({
          feed: {
            entry: [
              entry(1, longText, { updated: { label: '2026-09-20T10:00:00-07:00' } }),
              entry(2, longText),
              entry(1, 'too short'),
              entry(5, longText),
              entry(3, longText),
            ],
          },
        });
      }
      if (u.includes('/id=2/')) {
        // A single review comes back as an object, not an array.
        return jsonResponse({ feed: { entry: entry(2, longText) } });
      }
      if (u.includes('/id=3/')) {
        return jsonResponse({ feed: { title: { label: 'no reviews' } } });
      }
      return jsonResponse('Service Unavailable', 503);
    };

    const result = await searchIos('anything', { country: 'US', limit: 10, reviewsPer: 4 });

    assert.equal(result.store, 'ios');
    assert.equal(result.term, 'anything');
    assert.equal(result.country, 'us');
    assert.equal(result.apps.length, 4);
    assert.deepEqual(result.apps.map((a) => a.id), ['1', '2', '3', '4']);

    assert.equal(result.reviews.length, 3);
    assert.deepEqual(result.reviews.map((r) => [r.appId, r.score]), [['1', 1], ['1', 2], ['2', 2]]);
    assert.equal(result.reviews[0].date, '2026-09-20');
    assert.equal(result.reviews[1].date, null);
    assert.equal(result.reviews[0].appTitle, 'One');

    assert.deepEqual(result.errors, [
      'reviews unavailable for Three (feed returned no entries)',
      'reviews unavailable for Four (feed returned HTTP 503)',
    ]);

    // Every request carries the User-Agent and a timeout signal.
    for (const call of calls) {
      assert.equal(call.init.headers['User-Agent'], 'demand-check (https://github.com/dasjideepak/demand-check)');
      assert.ok(call.init.signal instanceof AbortSignal);
    }
    // Short first pages mean page 2 is never requested.
    assert.ok(calls.every((c) => !c.url.includes('page=2')));
    assert.equal(calls[0].url, 'https://itunes.apple.com/search?term=anything&country=us&entity=software&limit=10');
  });

  test('fetches page 2 only when page 1 is full', async () => {
    const urls = [];
    const fullPage = Array.from({ length: 50 }, (_, i) => entry(1, `${longText} ${i}`));
    globalThis.fetch = async (url) => {
      urls.push(String(url));
      if (String(url).includes('/search?')) return jsonResponse({ results: [{ ...rawApp, trackId: 9, trackName: 'Nine' }] });
      if (String(url).includes('page=1')) return jsonResponse({ feed: { entry: fullPage } });
      return jsonResponse({ feed: { entry: [entry(2, longText)] } });
    };
    const result = await searchIos('x', { reviewsPer: 1 });
    assert.equal(result.reviews.length, 51);
    assert.ok(urls.some((u) => u.includes('page=2')));
    assert.deepEqual(result.errors, []);
  });

  test('non-JSON feed body is reported, not thrown', async () => {
    globalThis.fetch = async (url) => {
      if (String(url).includes('/search?')) return jsonResponse({ results: [{ ...rawApp, trackId: 7, trackName: 'Seven' }] });
      return jsonResponse('<html>throttled</html>');
    };
    const result = await searchIos('x', { reviewsPer: 1 });
    assert.equal(result.reviews.length, 0);
    assert.deepEqual(result.errors, ['reviews unavailable for Seven (feed returned non-JSON body)']);
  });

  test('reviewsPer 0 skips the feed entirely', async () => {
    let feedCalls = 0;
    globalThis.fetch = async (url) => {
      if (String(url).includes('/search?')) return jsonResponse({ results: [rawApp] });
      feedCalls++;
      return jsonResponse({ feed: {} });
    };
    const result = await searchIos('x', { reviewsPer: 0 });
    assert.equal(result.apps.length, 1);
    assert.equal(feedCalls, 0);
  });

  test('never runs more than 3 review fetches at once', async () => {
    let inFlight = 0;
    let peak = 0;
    globalThis.fetch = async (url) => {
      if (String(url).includes('/search?')) {
        const results = Array.from({ length: 8 }, (_, i) => ({ ...rawApp, trackId: 100 + i, trackName: `App ${i}` }));
        return jsonResponse({ results });
      }
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return jsonResponse({ feed: { entry: [entry(1, longText)] } });
    };
    const result = await searchIos('x', { reviewsPer: 8 });
    assert.equal(result.reviews.length, 8);
    assert.equal(peak, 3);
  });

  test('multi-word term over-fetches, skips off-topic titles and notes them', async () => {
    const urls = [];
    globalThis.fetch = async (url) => {
      urls.push(String(url));
      if (String(url).includes('/search?')) {
        return jsonResponse({
          results: [
            { ...rawApp, trackId: 1, trackName: 'Cleanup: Phone Storage Cleaner' },
            { ...rawApp, trackId: 2, trackName: 'Swipewipe: Photo Cleaner' },
            { ...rawApp, trackId: 3, trackName: 'Slidebox: Photo Cleaner App' },
            { ...rawApp, trackId: 4, trackName: 'PicFlick - Swipe Photo Cleaner' },
          ],
        });
      }
      return jsonResponse({ feed: {} });
    };
    const result = await searchIos('swipe photo cleaner', { limit: 2, reviewsPer: 0 });
    assert.match(urls[0], /limit=4$/);
    assert.deepEqual(result.apps.map((a) => a.title), ['Swipewipe: Photo Cleaner', 'Slidebox: Photo Cleaner App']);
    assert.deepEqual(result.errors, [
      "Skipped 1 off-topic search result with fewer than 2 of the term's words in the title: Cleanup: Phone Storage Cleaner",
    ]);
  });

  test('empty feed is silent for an app with few ratings and counts fetched reviews', async () => {
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/search?')) {
        return jsonResponse({
          results: [
            { ...rawApp, trackId: 1, trackName: 'One', userRatingCount: 1 },
            { ...rawApp, trackId: 2, trackName: 'Two', userRatingCount: 0 },
            { ...rawApp, trackId: 3, trackName: 'Three', userRatingCount: 40 },
          ],
        });
      }
      if (u.includes('/id=3/')) return jsonResponse({ feed: { entry: [entry(1, longText), entry(5, longText), entry(4, longText)] } });
      return jsonResponse({ feed: {} });
    };
    const result = await searchIos('x', { reviewsPer: 3 });
    assert.deepEqual(result.errors, []);
    assert.equal(result.reviewsFetched, 3);
    assert.equal(result.reviews.length, 1);
  });

  test('search is retried once and then throws', async () => {
    let attempts = 0;
    globalThis.fetch = async () => {
      attempts++;
      return jsonResponse('bad gateway', 502);
    };
    await assert.rejects(() => searchIos('x'), /App Store search failed for "x" \(HTTP 502\)/);
    assert.equal(attempts, 2);
  });

  test('search succeeds on the second attempt', async () => {
    let attempts = 0;
    globalThis.fetch = async () => {
      attempts++;
      if (attempts === 1) throw Object.assign(new Error('aborted'), { name: 'TimeoutError' });
      return jsonResponse({ results: [rawApp] });
    };
    const result = await searchIos('x', { reviewsPer: 0 });
    assert.equal(result.apps.length, 1);
    assert.equal(attempts, 2);
  });
});

test('live: searchIos photo cleaner', { skip: !process.env.DEMAND_CHECK_NETWORK }, async (t) => {
  const result = await searchIos('photo cleaner', { limit: 3, reviewsPer: 1 });
  assert.equal(result.store, 'ios');
  assert.ok(result.apps.length > 0, 'expected at least one app');
  assert.ok(result.apps.length <= 3);
  for (const a of result.apps) {
    assert.equal(typeof a.id, 'string');
    assert.match(a.released ?? '0000-00-00', /^\d{4}-\d{2}-\d{2}$/);
  }
  for (const r of result.reviews) {
    assert.ok(r.score <= 2);
    assert.ok(r.text.length > 30);
  }
  t.diagnostic(`apps: ${result.apps.map((a) => `${a.title} [${a.ratings} ratings]`).join('; ')}`);
  t.diagnostic(`low-star reviews from ${result.apps[0].title}: ${result.reviews.length}`);
  t.diagnostic(`errors: ${result.errors.length ? result.errors.join(' | ') : 'none'}`);
});
