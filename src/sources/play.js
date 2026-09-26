// Google Play source: ranked search hits, per-app details and the newest low-star
// reviews, normalized to the shapes in ../types.js.

import gplay from 'google-play-scraper';
import { guardActive, splitByRelevance, skippedNote } from '../relevance.js';

const USER_AGENT = 'demand-check (https://github.com/dasjideepak/demand-check)';
const TIMEOUT_MS = 15000;
const CONCURRENCY = 3;
const RETRY_DELAY_MS = 1000;
const LOW_STAR_MAX_SCORE = 2;
const MIN_REVIEW_LENGTH = 30;
const PLAY_APP_URL = 'https://play.google.com/store/apps/details?id=';
// The search is asked for more hits than `limit` so that skipping off-topic
// ones still leaves a full table.
const SEARCH_OVERFETCH = 2;
const SEARCH_MAX = 50;

/**
 * Search Google Play for `term` and return apps, low-star reviews and errors.
 * Throws only when the search itself fails twice; everything else is recorded
 * in `errors` and the rest of the data is still returned.
 *
 * @param {string} term
 * @param {{ country?: string, lang?: string, limit?: number, reviewsPer?: number, reviewCount?: number }} [options]
 * @returns {Promise<import('../types.js').StoreResult>}
 */
export async function searchPlay (term, { country = 'us', lang = 'en', limit = 10, reviewsPer = 3, reviewCount = 200 } = {}) {
  const result = { store: 'play', term, country, apps: [], reviews: [], reviewsFetched: 0, errors: [] };
  const num = clamp(limit, 1, 250);

  let hits;
  try {
    hits = await withRetry(() => gplay.search({ term, num: searchSize(term, num), lang, country, requestOptions: requestOptions() }));
  } catch (err) {
    throw new Error(`Play Store search failed for "${term}": ${err.message}`, { cause: err });
  }

  const ranked = pickRelevant(term, (hits || []).filter((hit) => hit && hit.appId), result.errors).slice(0, num);
  result.apps = await mapLimit(ranked, CONCURRENCY, (hit) => loadApp(hit, { lang, country }, result.errors));

  const targets = result.apps.slice(0, clamp(reviewsPer, 0, result.apps.length));
  const perApp = await mapLimit(targets, CONCURRENCY, (app) => loadReviews(app, { lang, country, num: clamp(reviewCount, 1, 1000) }, result));
  result.reviews = perApp.flat();

  return result;
}

// Title plus the short store description; the guard is off for one-word terms.
function pickRelevant (term, hits, errors) {
  const { kept, skipped, required } = splitByRelevance(term, hits, (hit) => `${hit.title ?? ''} ${hit.summary ?? ''}`);
  const note = skippedNote(skipped.map((hit) => hit.title || hit.appId), required, 'the title and short description');
  if (note) errors.push(note);
  return kept;
}

function searchSize (term, num) {
  return guardActive(term) ? Math.min(SEARCH_MAX, num * SEARCH_OVERFETCH) : num;
}

/**
 * Map a raw google-play-scraper app (search hit, details, or both merged) to an AppRecord.
 * @param {object} raw
 * @returns {import('../types.js').AppRecord}
 */
export function normalizeApp (raw) {
  const id = String(raw.appId ?? raw.id ?? '');
  return {
    store: 'play',
    id,
    title: String(raw.title ?? ''),
    url: raw.url || `${PLAY_APP_URL}${id}`,
    developer: String(raw.developer ?? ''),
    installs: typeof raw.installs === 'string' ? raw.installs : null,
    minInstalls: toNumberOrNull(raw.minInstalls),
    rating: toNumberOrNull(raw.score),
    ratings: toNumberOrNull(raw.ratings),
    ads: typeof raw.adSupported === 'boolean' ? raw.adSupported : null,
    iap: typeof raw.offersIAP === 'boolean' ? raw.offersIAP : null,
    price: toNumberOrNull(raw.price) ?? 0,
    released: toIsoDate(raw.released),
    updated: toIsoDate(raw.updated)
  };
}

/**
 * Map a raw google-play-scraper review to a ReviewRecord.
 * @param {object} raw
 * @param {import('../types.js').AppRecord} app  The app the review belongs to.
 * @returns {import('../types.js').ReviewRecord}
 */
export function normalizeReview (raw, app) {
  return {
    store: 'play',
    appId: app.id,
    appTitle: app.title,
    score: Number(raw.score),
    text: String(raw.text ?? '').trim(),
    date: toIsoDate(raw.date)
  };
}

/**
 * Keep only reviews that read as complaints: 1-2 stars with enough text to tag.
 * @param {object[]} rawReviews
 * @returns {object[]}
 */
export function pickLowStarReviews (rawReviews) {
  return (rawReviews || []).filter((review) => {
    const score = Number(review?.score);
    const text = String(review?.text ?? '').trim();
    return score >= 1 && score <= LOW_STAR_MAX_SCORE && text.length > MIN_REVIEW_LENGTH;
  });
}

// Details are fetched in English because the scraper returns the release date
// as page text, which only parses in English. The search hit keeps the title
// and developer in the requested language.
async function loadApp (hit, { lang, country }, errors) {
  try {
    const details = await withRetry(() => gplay.app({ appId: hit.appId, lang: 'en', country, requestOptions: requestOptions() }));
    const localized = lang === 'en' ? {} : { title: hit.title ?? details.title, developer: hit.developer ?? details.developer };
    return normalizeApp({ ...hit, ...details, ...localized });
  } catch (err) {
    errors.push(`Details unavailable for "${hit.title || hit.appId}": ${err.message}`);
    return normalizeApp(hit);
  }
}

async function loadReviews (app, { lang, country, num }, result) {
  try {
    const { data } = await withRetry(() => gplay.reviews({
      appId: app.id,
      sort: gplay.sort.NEWEST,
      num,
      lang,
      country,
      requestOptions: requestOptions({ 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' })
    }));
    result.reviewsFetched += (data || []).length;
    return pickLowStarReviews(data).map((raw) => normalizeReview(raw, app));
  } catch (err) {
    result.errors.push(`Reviews unavailable for "${app.title || app.id}": ${err.message}`);
    return [];
  }
}

// google-play-scraper talks to Play through got, which takes its timeout and
// headers as options rather than an AbortSignal. The reviews call replaces the
// scraper's own headers object with ours, so callers pass back any it relied on.
function requestOptions (extraHeaders = {}) {
  return {
    headers: { 'User-Agent': USER_AGENT, ...extraHeaders },
    timeout: { request: TIMEOUT_MS }
  };
}

// One retry for network and server errors; a 4xx such as "App not found (404)"
// will not change on a second try.
async function withRetry (fn) {
  try {
    return await fn();
  } catch (err) {
    if (err && err.status >= 400 && err.status < 500) throw err;
    await sleep(RETRY_DELAY_MS);
    return fn();
  }
}

// Run fn over items with at most `limit` in flight, keeping the input order.
async function mapLimit (items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker () {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp (value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function toNumberOrNull (value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/;

// Accepts epoch milliseconds, Date objects, ISO timestamps and plain date text.
function toIsoDate (value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && !ISO_TIMESTAMP.test(value)) return isoDateFromText(value);
  const ms = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : Number(value);
  return isoDateFromMs(ms);
}

function isoDateFromMs (ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
}

// Release dates arrive as text like "Feb 7, 2024" with no time zone. Date.parse
// reads that as local midnight, so the calendar date is read back in local time;
// toISOString would move it to the previous day anywhere east of UTC.
function isoDateFromText (text) {
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function pad2 (n) {
  return String(n).padStart(2, '0');
}
