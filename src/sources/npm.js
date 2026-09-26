// npm source: registry search plus last-week download counts.
// Returns a RegistryResult (see src/types.js). Partial failures land in
// `errors`; only a failed search (after one retry) throws.

import { setTimeout as sleep } from 'node:timers/promises';
import { guardActive, splitByRelevance, skippedNote } from '../relevance.js';

const USER_AGENT = 'demand-check (https://github.com/dasjideepak/demand-check)';
const SEARCH_URL = 'https://registry.npmjs.org/-/v1/search';
const DOWNLOADS_URL = 'https://api.npmjs.org/downloads/point/last-week/';
const TIMEOUT_MS = 15000;
const MAX_CONCURRENT = 3;
const MAX_LIMIT = 25;
const RETRY_DELAY_MS = 500;
// The search is asked for more hits than `limit` so that skipping off-topic
// ones still leaves a full table.
const SEARCH_OVERFETCH = 2;
const SEARCH_MAX = 50;

/**
 * @param {string} term
 * @param {{ limit?: number }} [options]
 * @returns {Promise<import('../types.js').RegistryResult>}
 */
export async function searchNpm(term, { limit = 10 } = {}) {
  if (typeof term !== 'string' || term.trim() === '') {
    throw new TypeError('npm search needs a non-empty term');
  }
  const size = clampLimit(limit);
  const errors = [];
  const hits = (await searchRegistry(term.trim(), guardActive(term) ? Math.min(SEARCH_MAX, size * SEARCH_OVERFETCH) : size))
    .map((entry) => entry && entry.package)
    .filter((pkg) => pkg && typeof pkg.name === 'string' && pkg.name !== '');
  const found = pickRelevant(term, hits, errors).slice(0, size);

  const counts = await fetchWeeklyDownloads(found.map((pkg) => pkg.name), errors);
  const packages = found.map((pkg) => normalizePackage(pkg, counts.get(pkg.name)));
  return { registry: 'npm', term, packages, errors };
}

// Name, keywords and description together: package names alone are too terse.
function pickRelevant(term, hits, errors) {
  const textOf = (pkg) => [pkg.name, ...(Array.isArray(pkg.keywords) ? pkg.keywords : []), pkg.description ?? ''].join(' ');
  const { kept, skipped, required } = splitByRelevance(term, hits, textOf);
  const note = skippedNote(skipped.map((pkg) => pkg.name), required, 'the name, keywords and description');
  if (note) errors.push(note);
  return kept;
}

/**
 * Turn one `objects[].package` entry from the search API into a PackageRecord.
 * @param {object} pkg
 * @param {number|null|undefined} weeklyDownloads
 * @returns {import('../types.js').PackageRecord}
 */
export function normalizePackage(pkg, weeklyDownloads) {
  const name = typeof pkg.name === 'string' ? pkg.name : '';
  const npmLink = pkg.links && typeof pkg.links.npm === 'string' ? pkg.links.npm : '';
  return {
    registry: 'npm',
    name,
    description: typeof pkg.description === 'string' ? pkg.description.trim() : '',
    version: typeof pkg.version === 'string' ? pkg.version : '',
    weeklyDownloads: Number.isFinite(weeklyDownloads) ? weeklyDownloads : null,
    lastPublish: toIsoDate(pkg.date),
    url: npmLink || `https://www.npmjs.com/package/${name}`,
  };
}

/**
 * Split package names into the requests the downloads API accepts: unscoped
 * names can share one comma-separated request, scoped names go one at a time.
 * Pure, so it is unit-tested without the network.
 * @param {string[]} names
 * @returns {string[][]} One array of names per request.
 */
export function planDownloadRequests(names) {
  const unique = [...new Set(names.filter((name) => typeof name === 'string' && name !== ''))];
  const batch = unique.filter((name) => !name.startsWith('@'));
  const scoped = unique.filter((name) => name.startsWith('@'));
  const requests = scoped.map((name) => [name]);
  if (batch.length > 0) requests.unshift(batch);
  return requests;
}

/**
 * Read download counts out of a downloads API body. A single-name request
 * returns a flat object; a multi-name request is keyed by name, with `null`
 * for packages the API does not know (which means zero downloads so far).
 * Pure, exported for tests.
 * @param {string[]} names   The names that were requested.
 * @param {object} body
 * @returns {Map<string, number>}
 */
export function parseDownloadsBody(names, body) {
  const counts = new Map();
  if (body && typeof body.downloads === 'number') {
    counts.set(typeof body.package === 'string' ? body.package : names[0], body.downloads);
    return counts;
  }
  for (const name of names) {
    const entry = body ? body[name] : null;
    counts.set(name, entry && typeof entry.downloads === 'number' ? entry.downloads : 0);
  }
  return counts;
}

/**
 * Build the downloads URL for one planned request.
 * @param {string[]} names
 */
export function downloadsUrl(names) {
  // The API only resolves a scoped name when the slash is percent-encoded.
  const path = names.length === 1 && names[0].startsWith('@')
    ? names[0].replace('/', '%2F')
    : names.map(encodeURIComponent).join(',');
  return DOWNLOADS_URL + path;
}

function clampLimit(limit) {
  const n = Number.parseInt(limit, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_LIMIT);
}

function toIsoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

async function getJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, body };
}

async function searchRegistry(term, size) {
  const url = `${SEARCH_URL}?text=${encodeURIComponent(term)}&size=${size}`;
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { ok, status, body } = await getJson(url);
      if (ok && body && Array.isArray(body.objects)) return body.objects;
      lastError = new Error(`HTTP ${status}`);
    } catch (err) {
      lastError = err;
    }
    if (attempt === 0) await sleep(RETRY_DELAY_MS);
  }
  throw new Error(`npm search failed for "${term}": ${lastError.message}`);
}

async function fetchWeeklyDownloads(names, errors) {
  const counts = new Map();
  const tasks = planDownloadRequests(names).map((group) => () => fetchDownloadGroup(group, counts, errors));
  await runPool(tasks, MAX_CONCURRENT);
  return counts;
}

async function fetchDownloadGroup(names, counts, errors) {
  try {
    const { ok, status, body } = await getJson(downloadsUrl(names));
    if (status === 404) {
      // A brand-new package has no download row yet; that is zero, not a failure.
      for (const name of names) counts.set(name, 0);
      return;
    }
    if (!ok) throw new Error(`HTTP ${status}`);
    // A 200 without a usable JSON body is a registry hiccup, not zero downloads.
    if (body === null) throw new Error('non-JSON body');
    if (typeof body.error === 'string') throw new Error(body.error);
    for (const [name, value] of parseDownloadsBody(names, body)) counts.set(name, value);
  } catch (err) {
    for (const name of names) counts.set(name, null);
    errors.push(`weekly downloads unavailable for ${describeGroup(names)}: ${errorMessage(err)}`);
  }
}

function describeGroup(names) {
  if (names.length === 1) return names[0];
  return `${names.length} packages (${names.slice(0, 3).join(', ')}${names.length > 3 ? ', ...' : ''})`;
}

function errorMessage(err) {
  if (err && err.name === 'TimeoutError') return `timed out after ${TIMEOUT_MS / 1000}s`;
  return err && err.message ? err.message : String(err);
}

async function runPool(tasks, size) {
  const queue = [...tasks];
  const workers = Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length > 0) await queue.shift()();
  });
  await Promise.all(workers);
}
