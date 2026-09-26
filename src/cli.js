// Command-line entry: parses arguments, runs the requested sources, and prints the
// report. The sources and the analyzer are loaded lazily and can be injected, so
// this module is testable without the network and without the sibling modules.

import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderMarkdown, STORE_LABELS } from './report.js';

const STORES = ['play', 'ios', 'npm'];
const MAX_LIMIT = 25;
const MAX_REVIEWS = 25;
const MAX_SAMPLES = 12;

export const USAGE = `Usage: demand-check <term> [options]

Check real demand for an app or package idea before you build it.

Options:
  --store <list>    play,ios,npm or all (default all)
  --country <cc>    two-letter store country (default us)
  --lang <code>     Play Store language (default en)
  --limit <n>       apps or packages per store (default 10, max ${MAX_LIMIT})
  --reviews <n>     apps per store to pull low-star reviews from (default 3, 0 disables, max ${MAX_REVIEWS})
  --json            print the CheckResult JSON instead of markdown
  --out <file>      also write the report to this file
  --quiet           no progress lines on stderr
  --help, -h        show this help
  --version, -v     print the version

Exit codes: 0 ok (partial source errors are listed inside the report),
1 every requested source failed, 2 usage error.

Example:
  demand-check "swipe photo cleaner" --store play,ios --reviews 5 --out report.md
`;

const OPTION_SPEC = {
  store: { type: 'string', default: 'all' },
  country: { type: 'string', default: 'us' },
  lang: { type: 'string', default: 'en' },
  limit: { type: 'string', default: '10' },
  reviews: { type: 'string', default: '3' },
  json: { type: 'boolean', default: false },
  out: { type: 'string' },
  quiet: { type: 'boolean', default: false },
  help: { type: 'boolean', default: false, short: 'h' },
  version: { type: 'boolean', default: false, short: 'v' },
};

// Real sources are imported on first use so a broken or missing module only
// affects the store that needs it.
const realSources = {
  play: async (term, opts) => (await import('./sources/play.js')).searchPlay(term, opts),
  ios: async (term, opts) => (await import('./sources/ios.js')).searchIos(term, opts),
  npm: async (term, opts) => (await import('./sources/npm.js')).searchNpm(term, opts),
};

/**
 * Pure argument parsing and validation.
 * @param {string[]} argv
 * @returns {{ action: 'help' } | { action: 'version' } | { action: 'error', error: string } |
 *   { action: 'run', options: { term: string, stores: string[], country: string, lang: string,
 *     limit: number, reviews: number, json: boolean, out: string|null, quiet: boolean } }}
 */
export function parseCliArgs(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTION_SPEC, allowPositionals: true, strict: true });
  } catch (err) {
    return { action: 'error', error: messageOf(err) };
  }
  const { values, positionals } = parsed;
  if (values.help) return { action: 'help' };
  if (values.version) return { action: 'version' };

  const term = positionals.join(' ').trim();
  if (!term) return { action: 'error', error: 'missing <term>: say which idea to check' };

  const stores = parseStores(values.store);
  if (!stores) {
    return {
      action: 'error',
      error: `--store must be a comma-separated list of play, ios, npm, or the word all (got "${values.store}")`,
    };
  }
  const limit = parseInteger(values.limit, 1, MAX_LIMIT);
  if (limit === null) return { action: 'error', error: `--limit must be a whole number from 1 to ${MAX_LIMIT}` };
  const reviews = parseInteger(values.reviews, 0, MAX_REVIEWS);
  if (reviews === null) {
    return { action: 'error', error: `--reviews must be a whole number from 0 to ${MAX_REVIEWS}` };
  }
  const country = String(values.country).trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(country)) {
    return { action: 'error', error: `--country must be a two-letter code such as us or in (got "${values.country}")` };
  }
  const lang = String(values.lang).trim();
  if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(lang)) {
    return { action: 'error', error: `--lang must be a language code such as en or pt-br (got "${values.lang}")` };
  }

  return {
    action: 'run',
    options: {
      term,
      stores,
      country,
      lang,
      limit,
      reviews,
      json: Boolean(values.json),
      out: values.out ? String(values.out) : null,
      quiet: Boolean(values.quiet),
    },
  };
}

/**
 * Runs the CLI and returns the exit code instead of exiting.
 * @param {string[]} argv
 * @param {{ stdout?: { write: Function }, stderr?: { write: Function },
 *   sources?: { play?: Function, ios?: Function, npm?: Function },
 *   analyze?: { tagComplaints: Function, verdict: Function } }} [deps]
 * @returns {Promise<number>}
 */
export async function run(argv, { stdout = process.stdout, stderr = process.stderr, sources, analyze } = {}) {
  const parsed = parseCliArgs(argv);
  if (parsed.action === 'error') {
    stderr.write(`demand-check: ${parsed.error}\n\n${USAGE}`);
    return 2;
  }
  if (parsed.action === 'help') {
    stdout.write(USAGE);
    return 0;
  }
  if (parsed.action === 'version') {
    stdout.write(`${readVersion()}\n`);
    return 0;
  }

  const { options } = parsed;
  const log = options.quiet ? () => {} : (line) => stderr.write(`${line}\n`);
  const started = Date.now();
  try {
    const { results, errors } = await runSources(options, sources ?? realSources, log);
    if (options.stores.every((store) => results[store] === null)) {
      stderr.write(errors.map((error) => `demand-check: ${error}\n`).join(''));
      return 1;
    }
    const tools = analyze ?? (await import('./analyze.js'));
    const result = buildResult(options, results, errors, tools);
    const text = options.json ? JSON.stringify(result, null, 2) : renderMarkdown(result);
    const output = text.endsWith('\n') ? text : `${text}\n`;
    stdout.write(output);
    if (options.out) await writeOut(options.out, output);
    log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return 0;
  } catch (err) {
    stderr.write(`demand-check: ${messageOf(err)}\n`);
    return 1;
  }
}

function parseStores(value) {
  const parts = String(value)
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.includes('all')) return parts.every((p) => p === 'all' || STORES.includes(p)) ? [...STORES] : null;
  if (!parts.every((p) => STORES.includes(p))) return null;
  return STORES.filter((store) => parts.includes(store));
}

function parseInteger(value, min, max) {
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n >= min && n <= max ? n : null;
}

async function runSources(options, sources, log) {
  const wanted = options.stores;
  for (const store of wanted) log(`Searching ${STORE_LABELS[store]}...`);
  if (options.reviews > 0 && wanted.some((store) => store !== 'npm')) {
    log(`Fetching reviews for up to ${options.reviews} ${options.reviews === 1 ? 'app' : 'apps'} per store...`);
  }
  const settled = await Promise.allSettled(wanted.map((store) => callSource(store, sources, options)));
  const results = { play: null, ios: null, npm: null };
  const errors = [];
  wanted.forEach((store, i) => {
    const outcome = settled[i];
    if (outcome.status === 'fulfilled') {
      results[store] = outcome.value;
      log(`${STORE_LABELS[store]}: ${describe(store, outcome.value)}`);
    } else {
      const message = messageOf(outcome.reason);
      errors.push(`${STORE_LABELS[store]}: ${message}`);
      log(`${STORE_LABELS[store]}: failed (${message})`);
    }
  });
  return { results, errors };
}

async function callSource(store, sources, options) {
  const fn = sources[store];
  if (typeof fn !== 'function') throw new Error('no source available for this store');
  const value = await fn(options.term, sourceOptions(store, options));
  if (!value || typeof value !== 'object') throw new Error('source returned no data');
  return value;
}

function sourceOptions(store, options) {
  if (store === 'npm') return { limit: options.limit };
  if (store === 'ios') return { country: options.country, limit: options.limit, reviewsPer: options.reviews };
  return { country: options.country, lang: options.lang, limit: options.limit, reviewsPer: options.reviews };
}

function describe(store, value) {
  if (store === 'npm') return `${(value.packages ?? []).length} packages`;
  return `${(value.apps ?? []).length} apps, ${(value.reviews ?? []).length} low-star reviews`;
}

function buildResult(options, results, errors, tools) {
  const reviews = [...(results.play?.reviews ?? []), ...(results.ios?.reviews ?? [])];
  const { tags, samples } = tools.tagComplaints(reviews);
  // Sources count every review they read before the 1-2 star filter, which
  // gives the verdict its low-star share.
  const reviewCount = (results.play?.reviewsFetched ?? 0) + (results.ios?.reviewsFetched ?? 0);
  const verdict = tools.verdict({ play: results.play, ios: results.ios, npm: results.npm, tags, reviewCount });
  return {
    term: options.term,
    country: options.country,
    checkedAt: new Date().toISOString(),
    play: results.play,
    ios: results.ios,
    npm: results.npm,
    tags,
    complaintSamples: (samples ?? []).slice(0, MAX_SAMPLES),
    verdict,
    errors,
  };
}

async function writeOut(file, text) {
  const target = path.resolve(file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, text, 'utf8');
}

function readVersion() {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  return pkg.version;
}

function messageOf(err) {
  return err instanceof Error ? err.message : String(err);
}
