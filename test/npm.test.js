import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  searchNpm,
  normalizePackage,
  planDownloadRequests,
  parseDownloadsBody,
  downloadsUrl,
} from '../src/sources/npm.js';

const searchObject = {
  name: 'smoonb',
  version: '1.0.6',
  description: '  Complete Supabase backup and migration tool.  ',
  date: '2026-02-26T20:58:45.909Z',
  links: {
    homepage: 'https://www.smoonb.com',
    npm: 'https://www.npmjs.com/package/smoonb',
  },
};

test('normalizePackage maps a search object to a PackageRecord', () => {
  assert.deepEqual(normalizePackage(searchObject, 1234), {
    registry: 'npm',
    name: 'smoonb',
    description: 'Complete Supabase backup and migration tool.',
    version: '1.0.6',
    weeklyDownloads: 1234,
    lastPublish: '2026-02-26',
    url: 'https://www.npmjs.com/package/smoonb',
  });
});

test('normalizePackage falls back to the npmjs.com URL when links.npm is missing', () => {
  const record = normalizePackage({ name: '@pixpilot/supabase-backup', version: '3.8.2' }, 0);
  assert.equal(record.url, 'https://www.npmjs.com/package/@pixpilot/supabase-backup');
  assert.equal(record.weeklyDownloads, 0);
  assert.equal(record.description, '');
  assert.equal(record.lastPublish, null);
});

test('normalizePackage turns unknown downloads and bad dates into null', () => {
  const record = normalizePackage({ ...searchObject, date: 'not a date' }, undefined);
  assert.equal(record.weeklyDownloads, null);
  assert.equal(record.lastPublish, null);
  assert.equal(normalizePackage(searchObject, null).weeklyDownloads, null);
  assert.equal(normalizePackage(searchObject, Number.NaN).weeklyDownloads, null);
});

test('planDownloadRequests batches unscoped names and isolates scoped ones', () => {
  const requests = planDownloadRequests([
    'smoonb',
    '@pixpilot/supabase-backup',
    'supabase-cli-backup',
    '@scope/other',
    'smoonb',
  ]);
  assert.deepEqual(requests, [
    ['smoonb', 'supabase-cli-backup'],
    ['@pixpilot/supabase-backup'],
    ['@scope/other'],
  ]);
});

test('planDownloadRequests handles only-scoped and empty input', () => {
  assert.deepEqual(planDownloadRequests(['@a/b']), [['@a/b']]);
  assert.deepEqual(planDownloadRequests([]), []);
  assert.deepEqual(planDownloadRequests(['', null, 'x']), [['x']]);
});

test('downloadsUrl encodes the slash in a scoped name and joins a batch with commas', () => {
  assert.equal(
    downloadsUrl(['@pixpilot/supabase-backup']),
    'https://api.npmjs.org/downloads/point/last-week/@pixpilot%2Fsupabase-backup',
  );
  assert.equal(
    downloadsUrl(['react', 'vue']),
    'https://api.npmjs.org/downloads/point/last-week/react,vue',
  );
});

test('parseDownloadsBody reads a flat single-package body', () => {
  const counts = parseDownloadsBody(['react'], {
    downloads: 201689781,
    start: '2026-09-18',
    end: '2026-09-24',
    package: 'react',
  });
  assert.deepEqual([...counts], [['react', 201689781]]);
});

test('parseDownloadsBody reads a keyed batch body and treats null entries as 0', () => {
  const counts = parseDownloadsBody(['react', 'brand-new-package'], {
    react: { downloads: 201689781, package: 'react' },
    'brand-new-package': null,
  });
  assert.equal(counts.get('react'), 201689781);
  assert.equal(counts.get('brand-new-package'), 0);
});

describe('searchNpm with a stubbed fetch', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const pkg = (name, description, keywords = []) => ({ package: { name, description, keywords, version: '1.0.0', date: '2026-01-01T00:00:00.000Z', links: {} } });

  test('a 200 downloads response without usable JSON is an error, not zero downloads', async () => {
    globalThis.fetch = async (url) => {
      if (String(url).includes('/-/v1/search')) return json({ objects: [pkg('alpha', 'x'), pkg('beta', 'y')] });
      return new Response('<html>oops</html>', { status: 200 });
    };
    const result = await searchNpm('alpha');
    assert.deepEqual(result.packages.map((p) => p.weeklyDownloads), [null, null]);
    assert.match(result.errors[0], /^weekly downloads unavailable for 2 packages \(alpha, beta\): non-JSON body$/);

    globalThis.fetch = async (url) => {
      if (String(url).includes('/-/v1/search')) return json({ objects: [pkg('alpha', 'x')] });
      return json({ error: 'internal server error' });
    };
    const errored = await searchNpm('alpha');
    assert.equal(errored.packages[0].weeklyDownloads, null);
    assert.match(errored.errors[0], /internal server error/);
  });

  test('multi-word term skips packages that share too few words and over-fetches the search', async () => {
    const urls = [];
    globalThis.fetch = async (url) => {
      urls.push(String(url));
      if (String(url).includes('/-/v1/search')) {
        return json({
          objects: [
            pkg('@supabase/postgrest-js', 'Isomorphic PostgREST client', ['postgrest', 'supabase']),
            pkg('smoonb', 'Complete Supabase backup and migration tool'),
            pkg('@pixpilot/supabase-backup', 'Encrypted backups of a Supabase project'),
          ],
        });
      }
      return json({ downloads: 5, package: 'x' });
    };
    const result = await searchNpm('supabase backup', { limit: 2 });
    assert.match(urls[0], /size=4$/);
    assert.deepEqual(result.packages.map((p) => p.name), ['smoonb', '@pixpilot/supabase-backup']);
    assert.match(result.errors[0], /^Skipped 1 off-topic search result with fewer than 2 of the term's words in the name, keywords and description: @supabase\/postgrest-js$/);
  });
});

test(
  'searchNpm returns packages with weekly download counts',
  { skip: !process.env.DEMAND_CHECK_NETWORK },
  async () => {
    const result = await searchNpm('supabase backup', { limit: 5 });
    assert.equal(result.registry, 'npm');
    assert.equal(result.term, 'supabase backup');
    assert.ok(Array.isArray(result.errors));
    assert.ok(result.packages.length > 0);
    assert.ok(result.packages.length <= 5);
    assert.ok(result.packages.some((pkg) => typeof pkg.weeklyDownloads === 'number'));
    for (const pkg of result.packages) {
      assert.equal(pkg.registry, 'npm');
      assert.ok(pkg.name.length > 0);
      assert.match(pkg.url, /^https:\/\/www\.npmjs\.com\/package\//);
      assert.ok(pkg.lastPublish === null || /^\d{4}-\d{2}-\d{2}$/.test(pkg.lastPublish));
    }
  },
);
