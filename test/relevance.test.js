import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardActive, requiredMatches, skippedNote, splitByRelevance, termWords } from '../src/relevance.js';

test('termWords lower-cases, drops short words and filler, and dedupes', () => {
  assert.deepEqual(termWords('Swipe Photo Cleaner app'), ['swipe', 'photo', 'cleaner']);
  assert.deepEqual(termWords('a UPI tracker for the UPI'), ['upi', 'tracker']);
  assert.deepEqual(termWords('x'), []);
});

test('requiredMatches is off for one word and at least two for longer terms', () => {
  assert.equal(requiredMatches([]), 0);
  assert.equal(requiredMatches(['budget']), 0);
  assert.equal(requiredMatches(['supabase', 'backup']), 2);
  assert.equal(requiredMatches(['a', 'b', 'c']), 2);
  assert.equal(requiredMatches(['a', 'b', 'c', 'd', 'e']), 3);
  assert.equal(guardActive('budget'), false);
  assert.equal(guardActive('supabase backup'), true);
});

test('splitByRelevance keeps hits that share enough words and keeps their order', () => {
  const hits = [
    'Swipe & Delete: Photo Cleaner',
    'Cleanup: Phone Storage Cleaner',
    'Swipewipe: Photo Cleaner',
    'Cleaner Kit - Clean Up Storage',
    'Slidebox: Photo Cleaner App',
  ];
  const { kept, skipped, required } = splitByRelevance('swipe photo cleaner', hits, (t) => t);
  assert.equal(required, 2);
  assert.deepEqual(kept, ['Swipe & Delete: Photo Cleaner', 'Swipewipe: Photo Cleaner', 'Slidebox: Photo Cleaner App']);
  assert.deepEqual(skipped, ['Cleanup: Phone Storage Cleaner', 'Cleaner Kit - Clean Up Storage']);
});

test('splitByRelevance needs both words of a two-word term', () => {
  const names = ['@supabase/postgrest-js Isomorphic PostgREST client', 'smoonb Complete Supabase backup tool'];
  const { kept, skipped } = splitByRelevance('supabase backup', names, (t) => t);
  assert.deepEqual(kept, [names[1]]);
  assert.deepEqual(skipped, [names[0]]);
});

test('splitByRelevance matches inside words and across doubled letters', () => {
  const { kept } = splitByRelevance('milk dairy hisab', ['Dudh Hisaab: Dairy Management', 'Startupnews.fyi'], (t) => t);
  assert.deepEqual(kept, ['Dudh Hisaab: Dairy Management']);
  const news = splitByRelevance('startup funding news', ['Startupnews.fyi', 'CNBC: Business & Stock News'], (t) => t);
  assert.deepEqual(news.kept, ['Startupnews.fyi']);
});

test('splitByRelevance keeps everything for a one-word term', () => {
  const { kept, skipped } = splitByRelevance('anything', ['One', 'Two'], (t) => t);
  assert.deepEqual(kept, ['One', 'Two']);
  assert.deepEqual(skipped, []);
});

test('skippedNote names up to five skipped hits and is null when nothing was skipped', () => {
  assert.equal(skippedNote([], 2, 'the title'), null);
  assert.equal(
    skippedNote(['CNBC'], 2, 'the title'),
    "Skipped 1 off-topic search result with fewer than 2 of the term's words in the title: CNBC",
  );
  const many = skippedNote(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 2, 'the name, keywords and description');
  assert.match(many, /^Skipped 7 off-topic search results with fewer than 2 of the term's words in the name, keywords and description: a, b, c, d, e and 2 more$/);
});
