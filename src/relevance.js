// Off-topic guard shared by the sources. Store searches happily return one
// generic giant for a niche term (CNBC for "startup funding news", a storage
// cleaner for "swipe photo cleaner", the Supabase SDK for "supabase backup"),
// and a single giant decides the verdict. A hit stays only when its name shares
// enough of the term's words.

const MIN_WORD_LENGTH = 3;
const STOPWORDS = new Set(['app', 'apps', 'the', 'and', 'for', 'with', 'tool', 'tools', 'free', 'best', 'online']);

/**
 * Words of the term that a hit is expected to share: lower-cased, at least
 * three letters, common filler dropped.
 * @param {string} term
 * @returns {string[]}
 */
export function termWords(term) {
  const words = normalize(term).split(' ').filter((word) => word.length >= MIN_WORD_LENGTH && !STOPWORDS.has(word));
  return [...new Set(words)];
}

/**
 * How many term words a hit must share. A single-word term is already what the
 * store searched for, so the guard is off (0). Two or more words need at least
 * half of them, and never fewer than two.
 * @param {string[]} words  Output of termWords.
 * @returns {number}
 */
export function requiredMatches(words) {
  if (words.length < 2) return 0;
  return Math.max(2, Math.ceil(words.length / 2));
}

/**
 * Whether the guard does anything for this term (false for one-word terms).
 * Sources use it to decide whether to over-fetch search hits.
 * @param {string} term
 * @returns {boolean}
 */
export function guardActive(term) {
  return requiredMatches(termWords(term)) > 0;
}

/**
 * Split search hits into the ones that share enough term words and the rest.
 * `textOf` returns the text to match for one hit (title, or title plus a short
 * description). Order is kept.
 * @template T
 * @param {string} term
 * @param {T[]} hits
 * @param {(hit: T) => string} textOf
 * @returns {{ kept: T[], skipped: T[], required: number }}
 */
export function splitByRelevance(term, hits, textOf) {
  const words = termWords(term);
  const required = requiredMatches(words);
  const kept = [];
  const skipped = [];
  for (const hit of hits) {
    (countMatches(words, textOf(hit)) >= required ? kept : skipped).push(hit);
  }
  return { kept, skipped, required };
}

/**
 * One Notes line describing what the guard skipped, or null when it skipped nothing.
 * @param {string[]} names
 * @param {number} required
 * @param {string} where  For example "the title" or "the name, keywords and description".
 * @returns {string|null}
 */
export function skippedNote(names, required, where) {
  if (names.length === 0) return null;
  const shown = names.slice(0, 5).join(', ');
  const more = names.length > 5 ? ` and ${names.length - 5} more` : '';
  const results = names.length === 1 ? 'result' : 'results';
  return `Skipped ${names.length} off-topic search ${results} with fewer than ${required} of the term's words in ${where}: ${shown}${more}`;
}

function countMatches(words, text) {
  const haystack = normalize(text);
  return words.filter((word) => haystack.includes(word)).length;
}

// Lower-case, letters and digits only, and repeated letters collapsed so
// transliterations such as "hisaab" and "hisab" or "doodh" and "dodh" agree.
function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/(\p{L})\1+/gu, '$1')
    .trim();
}
