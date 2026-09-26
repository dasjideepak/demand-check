// App Store source: iTunes Search API for the app list, the public RSS customer
// reviews feed for low-star reviews. Returns the StoreResult shape from src/types.js.

import { guardActive, splitByRelevance, skippedNote } from '../relevance.js';

const USER_AGENT = 'demand-check (https://github.com/dasjideepak/demand-check)';
const TIMEOUT_MS = 15000;
const MAX_CONCURRENT = 3;
const MAX_LIMIT = 25;
const REVIEW_PAGES = 2;
const FEED_PAGE_SIZE = 50;
const MAX_COMPLAINT_SCORE = 2;
const MIN_COMPLAINT_LENGTH = 30;
// Apps with only a handful of ratings often have no written review at all, so
// an empty feed is only worth a note once the app clearly has reviewers.
const EMPTY_FEED_MIN_RATINGS = 10;
// The search is asked for more hits than `limit` so that skipping off-topic
// ones still leaves a full table.
const SEARCH_OVERFETCH = 2;
const SEARCH_MAX = 50;

/**
 * Search the App Store and pull the newest 1-2 star reviews for the top apps.
 * Throws only when the search itself fails twice; everything else lands in errors.
 * @param {string} term
 * @param {{ country?: string, limit?: number, reviewsPer?: number }} [options]
 * @returns {Promise<import('../types.js').StoreResult>}
 */
export async function searchIos(term, { country = 'us', limit = 10, reviewsPer = 3 } = {}) {
  const cc = String(country).toLowerCase();
  const result = { store: 'ios', term, country: cc, apps: [], reviews: [], reviewsFetched: 0, errors: [] };

  const size = clampLimit(limit);
  const raw = await searchWithRetry(term, cc, guardActive(term) ? Math.min(SEARCH_MAX, size * SEARCH_OVERFETCH) : size);
  const hits = raw.filter((item) => item && item.trackId != null);
  result.apps = pickRelevant(term, hits, result.errors).slice(0, size).map(normalizeApp);

  const targets = result.apps.slice(0, Math.max(0, Number(reviewsPer) || 0));
  const perApp = await mapLimit(targets, MAX_CONCURRENT, (app) => collectReviews(app, cc, result));
  result.reviews = perApp.flat();
  return result;
}

// Title only: App Store descriptions are long marketing text in which every
// storage cleaner mentions photos, so they would let the giants through.
function pickRelevant(term, hits, errors) {
  const { kept, skipped, required } = splitByRelevance(term, hits, (hit) => hit.trackName ?? '');
  const note = skippedNote(skipped.map((hit) => hit.trackName || String(hit.trackId)), required, 'the title');
  if (note) errors.push(note);
  return kept;
}

/**
 * Turn one iTunes Search API result into an AppRecord.
 * @param {object} raw
 * @returns {import('../types.js').AppRecord}
 */
export function normalizeApp(raw) {
  const ratings = toNumber(raw.userRatingCount);
  return {
    store: 'ios',
    id: String(raw.trackId),
    title: raw.trackName ?? '',
    url: raw.trackViewUrl ?? `https://apps.apple.com/app/id${raw.trackId}`,
    developer: raw.sellerName || raw.artistName || '',
    installs: null,
    minInstalls: null,
    // Apple reports 0 for apps nobody has rated yet; the contract wants null there.
    rating: ratings > 0 ? toNumber(raw.averageUserRating) : null,
    ratings,
    ads: null,
    // The search API does not say whether an app has in-app purchases.
    iap: null,
    price: toNumber(raw.price) ?? 0,
    released: toIsoDate(raw.releaseDate),
    updated: toIsoDate(raw.currentVersionReleaseDate),
  };
}

/**
 * Turn one RSS feed entry into a ReviewRecord for the given app.
 * @param {object} entry
 * @param {import('../types.js').AppRecord} app
 * @returns {import('../types.js').ReviewRecord}
 */
export function normalizeReview(entry, app) {
  const title = String(label(entry.title) ?? '').trim();
  const body = String(label(entry.content) ?? '').trim();
  return {
    store: 'ios',
    appId: app.id,
    appTitle: app.title,
    score: toNumber(label(entry['im:rating'])),
    // Apple review titles usually carry the gist of the complaint, so keep them.
    text: title ? `${title}: ${body}` : body,
    date: toIsoDate(label(entry.updated)),
  };
}

async function searchWithRetry(term, country, limit) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await searchOnce(term, country, limit);
    } catch (err) {
      lastError = err;
      await sleep(500);
    }
  }
  throw new Error(`App Store search failed for "${term}" (${describe(lastError)})`);
}

async function searchOnce(term, country, limit) {
  const params = new URLSearchParams({ term, country, entity: 'software', limit: String(limit) });
  const data = await fetchJson(`https://itunes.apple.com/search?${params}`);
  if (!data || !Array.isArray(data.results)) throw new Error('unexpected payload');
  return data.results;
}

// Never throws: feed problems become one errors[] line for this app.
async function collectReviews(app, country, result) {
  const { errors } = result;
  const entries = [];
  for (let page = 1; page <= REVIEW_PAGES; page++) {
    let pageEntries;
    try {
      pageEntries = feedEntries(await fetchJson(feedUrl(country, app.id, page)));
    } catch (err) {
      const which = page === 1 ? 'reviews' : `reviews page ${page}`;
      errors.push(`${which} unavailable for ${app.title} (feed returned ${describe(err)})`);
      break;
    }
    if (pageEntries.length === 0) {
      if (page === 1 && (app.ratings ?? 0) >= EMPTY_FEED_MIN_RATINGS) {
        errors.push(`reviews unavailable for ${app.title} (feed returned no entries)`);
      }
      break;
    }
    entries.push(...pageEntries);
    if (pageEntries.length < FEED_PAGE_SIZE) break;
  }
  result.reviewsFetched += entries.length;
  return entries.filter(isLowStarComplaint).map((entry) => normalizeReview(entry, app));
}

function feedUrl(country, id, page) {
  return `https://itunes.apple.com/${country}/rss/customerreviews/page=${page}/id=${id}/sortby=mostrecent/json`;
}

// feed.entry is an array, a single object when there is one review, or missing.
function feedEntries(data) {
  const entry = data && data.feed && data.feed.entry;
  if (Array.isArray(entry)) return entry;
  return entry && typeof entry === 'object' ? [entry] : [];
}

function isLowStarComplaint(entry) {
  const score = toNumber(label(entry['im:rating']));
  const body = String(label(entry.content) ?? '').trim();
  return score !== null && score >= 1 && score <= MAX_COMPLAINT_SCORE && body.length > MIN_COMPLAINT_LENGTH;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // Apple serves JSON with a text/javascript content type, so parse the body ourselves.
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('non-JSON body');
  }
}

async function mapLimit(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

function clampLimit(limit) {
  const n = Math.floor(Number(limit));
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), MAX_LIMIT) : 10;
}

// The feed wraps every value as { label: "..." }; the search API uses plain values.
function label(node) {
  return node && typeof node === 'object' ? node.label : node;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toIsoDate(value) {
  if (typeof value !== 'string') return null;
  // Keep the calendar date Apple reports instead of shifting it through UTC.
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (match) return match[1];
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function describe(err) {
  if (err && err.name === 'TimeoutError') return `timeout after ${TIMEOUT_MS / 1000}s`;
  return (err && err.message) || String(err);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
