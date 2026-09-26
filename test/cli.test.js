import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseCliArgs, run, USAGE } from '../src/cli.js';
import { checkResult } from './fixtures/check-result.js';

function sink() {
  let text = '';
  return {
    write(chunk) {
      text += String(chunk);
      return true;
    },
    get text() {
      return text;
    },
  };
}

// Fakes stand in for the network sources and the analyzer so run() is offline.
function fakeSources(overrides = {}) {
  return {
    play: async () => structuredClone(checkResult.play),
    ios: async () => structuredClone(checkResult.ios),
    npm: async () => structuredClone(checkResult.npm),
    ...overrides,
  };
}

const fakeAnalyze = {
  tagComplaints: (reviews) => ({ tags: structuredClone(checkResult.tags), samples: reviews.slice(0, 3) }),
  verdict: () => structuredClone(checkResult.verdict),
};

async function exec(argv, deps = {}) {
  const stdout = sink();
  const stderr = sink();
  const code = await run(argv, { stdout, stderr, sources: fakeSources(), analyze: fakeAnalyze, ...deps });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

test('parseCliArgs applies the documented defaults', () => {
  const parsed = parseCliArgs(['swipe photo cleaner']);
  assert.equal(parsed.action, 'run');
  assert.deepEqual(parsed.options, {
    term: 'swipe photo cleaner',
    stores: ['play', 'ios', 'npm'],
    country: 'us',
    lang: 'en',
    limit: 10,
    reviews: 3,
    json: false,
    out: null,
    quiet: false,
  });
});

test('parseCliArgs joins unquoted words into one term', () => {
  assert.equal(parseCliArgs(['swipe', 'photo', 'cleaner']).options.term, 'swipe photo cleaner');
});

test('parseCliArgs reads every option', () => {
  const parsed = parseCliArgs([
    'x', '--store', 'npm,play', '--country', 'IN', '--lang', 'hi', '--limit', '25',
    '--reviews', '0', '--json', '--out', 'r.md', '--quiet',
  ]);
  assert.deepEqual(parsed.options, {
    term: 'x',
    stores: ['play', 'npm'],
    country: 'in',
    lang: 'hi',
    limit: 25,
    reviews: 0,
    json: true,
    out: 'r.md',
    quiet: true,
  });
});

test('parseCliArgs validates the store list', () => {
  assert.deepEqual(parseCliArgs(['x', '--store', 'all']).options.stores, ['play', 'ios', 'npm']);
  assert.deepEqual(parseCliArgs(['x', '--store', 'ios']).options.stores, ['ios']);
  assert.deepEqual(parseCliArgs(['x', '--store', ' ios , play ']).options.stores, ['play', 'ios']);
  for (const bad of ['steam', 'play,web', '', ',']) {
    const parsed = parseCliArgs(['x', '--store', bad]);
    assert.equal(parsed.action, 'error', `store "${bad}" is rejected`);
    assert.match(parsed.error, /--store/);
  }
});

test('parseCliArgs validates numbers and the country code', () => {
  for (const argv of [
    ['x', '--limit', '0'],
    ['x', '--limit', '26'],
    ['x', '--limit', 'ten'],
    ['x', '--limit', '1.5'],
    ['x', '--reviews', '-1'],
    ['x', '--reviews', '26'],
    ['x', '--country', 'usa'],
    ['x', '--country', '1a'],
    ['x', '--lang', 'english language'],
  ]) {
    assert.equal(parseCliArgs(argv).action, 'error', `${argv.join(' ')} is rejected`);
  }
  assert.equal(parseCliArgs(['x', '--limit', '1']).options.limit, 1);
  assert.equal(parseCliArgs(['x', '--reviews', '25']).options.reviews, 25);
});

test('parseCliArgs rejects unknown options and a missing term', () => {
  const unknown = parseCliArgs(['x', '--bogus']);
  assert.equal(unknown.action, 'error');
  assert.match(unknown.error, /bogus/);
  const missing = parseCliArgs([]);
  assert.equal(missing.action, 'error');
  assert.match(missing.error, /term/);
  assert.equal(parseCliArgs(['   ']).action, 'error');
});

test('parseCliArgs recognises help and version before validating the term', () => {
  assert.equal(parseCliArgs(['--help']).action, 'help');
  assert.equal(parseCliArgs(['-h']).action, 'help');
  assert.equal(parseCliArgs(['--version']).action, 'version');
});

test('run --help prints usage to stdout and returns 0', async () => {
  const { code, stdout, stderr } = await exec(['--help']);
  assert.equal(code, 0);
  assert.equal(stdout, USAGE);
  assert.match(stdout, /Usage: demand-check <term> \[options\]/);
  assert.equal(stderr, '');
});

test('run --version prints the package.json version and returns 0', async () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const { code, stdout } = await exec(['--version']);
  assert.equal(code, 0);
  assert.equal(stdout, `${pkg.version}\n`);
});

test('run returns 2 and prints usage to stderr on a usage error', async () => {
  for (const argv of [[], ['x', '--bogus'], ['x', '--store', 'steam'], ['x', '--limit', '99']]) {
    const { code, stdout, stderr } = await exec(argv);
    assert.equal(code, 2, `${argv.join(' ') || '(no args)'} returns 2`);
    assert.equal(stdout, '');
    assert.match(stderr, /^demand-check: /);
    assert.match(stderr, /Usage: demand-check/);
  }
});

test('run renders markdown from injected sources and returns 0', async () => {
  const { code, stdout, stderr } = await exec(['swipe photo cleaner', '--quiet']);
  assert.equal(code, 0);
  assert.match(stdout, /^# Demand check: swipe photo cleaner\n/);
  assert.match(stdout, /## Verdict/);
  assert.match(stdout, /\*\*Crowded\*\*/);
  assert.match(stdout, /## Google Play/);
  assert.match(stdout, /## App Store/);
  assert.match(stdout, /## npm/);
  assert.equal(stderr, '');
});

test('run passes the parsed options to each source', async () => {
  const calls = {};
  const sources = fakeSources({
    play: async (term, opts) => ((calls.play = [term, opts]), structuredClone(checkResult.play)),
    ios: async (term, opts) => ((calls.ios = [term, opts]), structuredClone(checkResult.ios)),
    npm: async (term, opts) => ((calls.npm = [term, opts]), structuredClone(checkResult.npm)),
  });
  const { code } = await exec(['x', '--country', 'in', '--lang', 'hi', '--limit', '5', '--reviews', '2', '--quiet'], {
    sources,
  });
  assert.equal(code, 0);
  assert.deepEqual(calls.play, ['x', { country: 'in', lang: 'hi', limit: 5, reviewsPer: 2 }]);
  assert.deepEqual(calls.ios, ['x', { country: 'in', limit: 5, reviewsPer: 2 }]);
  assert.deepEqual(calls.npm, ['x', { limit: 5 }]);
});

test('run only calls the requested stores', async () => {
  const called = [];
  const sources = fakeSources({
    play: async () => (called.push('play'), structuredClone(checkResult.play)),
    ios: async () => (called.push('ios'), structuredClone(checkResult.ios)),
    npm: async () => (called.push('npm'), structuredClone(checkResult.npm)),
  });
  const { code, stdout } = await exec(['x', '--store', 'npm', '--quiet', '--json'], { sources });
  assert.equal(code, 0);
  assert.deepEqual(called, ['npm']);
  const result = JSON.parse(stdout);
  assert.equal(result.play, null);
  assert.equal(result.ios, null);
  assert.equal(result.npm.packages.length, 2);
});

test('run --json prints a CheckResult with every contract field', async () => {
  const { code, stdout } = await exec(['swipe photo cleaner', '--json', '--quiet']);
  assert.equal(code, 0);
  const result = JSON.parse(stdout);
  assert.deepEqual(Object.keys(result), [
    'term', 'country', 'checkedAt', 'play', 'ios', 'npm', 'tags', 'complaintSamples', 'verdict', 'errors',
  ]);
  assert.equal(result.term, 'swipe photo cleaner');
  assert.equal(result.country, 'us');
  assert.match(result.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(result.verdict.level, 'crowded');
  assert.equal(result.complaintSamples.length, 3);
  assert.deepEqual(result.errors, []);
});

test('run keeps going when one source rejects and lists the error in Notes', async () => {
  const sources = fakeSources({ ios: async () => { throw new Error('search failed after one retry'); } });
  const { code, stdout, stderr } = await exec(['x'], { sources });
  assert.equal(code, 0);
  assert.equal(stdout.includes('## App Store'), false);
  assert.match(stdout, /^- App Store: search failed after one retry$/m);
  assert.match(stderr, /App Store: failed \(search failed after one retry\)/);
});

test('run returns 1 when every requested source rejects', async () => {
  const sources = fakeSources({
    play: async () => { throw new Error('play down'); },
    npm: async () => { throw new Error('npm down'); },
  });
  const { code, stdout, stderr } = await exec(['x', '--store', 'play,npm', '--quiet'], { sources });
  assert.equal(code, 1);
  assert.equal(stdout, '');
  assert.match(stderr, /demand-check: Google Play: play down/);
  assert.match(stderr, /demand-check: npm: npm down/);
});

test('run prints progress lines unless --quiet', async () => {
  const noisy = await exec(['x']);
  assert.match(noisy.stderr, /Searching Google Play\.\.\./);
  assert.match(noisy.stderr, /Searching App Store\.\.\./);
  assert.match(noisy.stderr, /Searching npm\.\.\./);
  assert.match(noisy.stderr, /Fetching reviews for up to 3 apps per store\.\.\./);
  assert.match(noisy.stderr, /Google Play: 3 apps, 4 low-star reviews/);
  assert.match(noisy.stderr, /Done in \d+\.\ds/);

  const quiet = await exec(['x', '--quiet']);
  assert.equal(quiet.stderr, '');

  const noReviews = await exec(['x', '--reviews', '0']);
  assert.equal(noReviews.stderr.includes('Fetching reviews'), false);

  const one = await exec(['x', '--reviews', '1']);
  assert.match(one.stderr, /Fetching reviews for up to 1 app per store\.\.\./);
});

test('run --out writes the same text to the file, creating the directory', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'demand-check-'));
  try {
    const file = path.join(dir, 'nested', 'report.md');
    const { code, stdout } = await exec(['x', '--quiet', '--out', file]);
    assert.equal(code, 0);
    assert.equal(await readFile(file, 'utf8'), stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('run returns 1 when the analyzer throws', async () => {
  const analyze = { ...fakeAnalyze, verdict: () => { throw new Error('bad tags'); } };
  const { code, stderr } = await exec(['x', '--quiet'], { analyze });
  assert.equal(code, 1);
  assert.match(stderr, /demand-check: bad tags/);
});

test('run passes the total number of reviews the sources read to the verdict', async () => {
  let received = null;
  const analyze = { ...fakeAnalyze, verdict: (input) => { received = input; return structuredClone(checkResult.verdict); } };
  await exec(['x', '--quiet'], { analyze });
  assert.equal(received.reviewCount, checkResult.play.reviewsFetched + checkResult.ios.reviewsFetched);

  const sources = fakeSources({ ios: async () => { throw new Error('down'); } });
  await exec(['x', '--quiet'], { analyze, sources });
  assert.equal(received.reviewCount, checkResult.play.reviewsFetched);
});
