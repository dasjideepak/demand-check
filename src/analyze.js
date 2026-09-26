// Complaint tagging and the verdict. Pure functions: no network, no I/O.
// Data shapes are described in ./types.js.

const TAG_NAMES = ['ads', 'paywall', 'crash', 'dataLoss', 'offline', 'login', 'support', 'bugs'];

const MAX_SAMPLES = 12;
const SAMPLE_KEY_CHARS = 60;
const NEWCOMER_MONTHS = 18;
const NEWCOMER_MIN_INSTALLS = 10_000;

// Verdict thresholds. Play installs are floors ("100,000+"), so every
// comparison is against minInstalls.
const OWNED_INSTALLS = 10_000_000;
const OWNED_INSTALLS_WITH_RATINGS = 5_000_000;
const OWNED_RATINGS = 50_000;
const OWNED_IOS_RATINGS = 100_000;
const OWNED_NPM_WEEKLY = 1_000_000;
const CROWDED_APPS_OVER_1M = 2;
const CROWDED_APPS_OVER_100K = 4;
const CROWDED_NPM_PACKAGES = 3;
const CROWDED_NPM_WEEKLY = 10_000;
const NO_DEMAND_INSTALLS = 10_000;
const NO_DEMAND_NPM_WEEKLY = 500;
const DEMAND_INSTALLS = 100_000;
const DEMAND_NPM_WEEKLY = 10_000;
const COMPLAINT_TAG_SUM = 10;
const COMPLAINT_LOW_STAR_SHARE = 0.15;
// Small niches never reach 10 tagged complaints, so one complaint that runs
// through at least half of a handful of low-star reviews also counts.
const COMPLAINT_TOP_TAG_MIN = 4;
const COMPLAINT_TOP_TAG_SHARE = 0.5;

// iOS publishes ratings but not installs. Roughly 1 rating per 100 installs,
// so ratings map onto the same install tiers the Play rules use.
const IOS_RATING_TIERS = [
  [100_000, 10_000_000],
  [10_000, 1_000_000],
  [1_000, 100_000],
  [100, 10_000],
];

// Matched against lower-cased review text. Indian store reviews mix Hindi and
// English, so each tag carries a few Hinglish words too.
const TAG_PATTERNS = {
  ads: [
    /\bads?\b/,
    /\badvert/,
    /\bcommercials?\b/,
    /\bpop[- ]?ups?\b/,
    /\b(too many|so many|full of|lots of|more) adds?\b/,
  ],
  paywall: [
    /\bsubscri/,
    /\bpremium\b/,
    /\bpay(s|ing|ments?|walls?)?\b/,
    /\bpaid\b/,
    /\bper (day|week|month|year)\b/,
    /\b(weekly|monthly|yearly|annual)\b/,
    /\btrial\b/,
    /\blimit/,
    /\bonly \d+\b/,
    /\bswipes\b/,
    /\b(expensive|costly|pricey|overpriced)\b/,
    /\bgreedy?\b/,
    /\bmoney\b/,
    /\bcash grab\b/,
    /\brip[- ]?off\b/,
    /\bfree (version|tier|plan)\b/,
    /\bpais[ae]\b/,
    /\bmeh?e?nga\b/,
  ],
  crash: [
    /\bcrash/,
    /\bfreez/,
    /\bfroze/,
    /\bhang(s|ing|ed)?\b/,
    /\bstuck\b/,
    /\b(won't|wont|will not|doesn't|does not|doesnt|not|never|cannot|can't|cant) (even )?open/,
    /\bkeeps? (closing|crashing|stopping|shutting)/,
    /\bforce[- ]?clos/,
    /\blag(s|gy|ging|ged)?\b/,
    /\bslow\b/,
    /\b(black|white|blank) screen\b/,
    /\batak/,
    /\bband ho/,
    /\bkhul(ta|ti)? (hi )?nahi/,
    /\bnahi khul/,
  ],
  dataLoss: [
    /\blost\b/,
    /\blos(e|es|ing)\b/,
    /\bdelet(ed|es) (my|all|the wrong|everything|every)\b/,
    /\bdisappear/,
    /\bgone\b/,
    /\bdata loss\b/,
    /\b(wiped|eras(e|ed|es|ing))\b/,
    // "data automatic deleting", "customer details deleat", "records got wiped"
    /\b(data|details|records|entries|customers?|backup)\b.{0,30}\b(delet|deleat|eras|wip|clear|vanish)/,
    /\b(automatic(ally)?|auto|itself|apne aap|khud) .{0,20}?(delet|deleat|eras)/,
    /\bwasted my time\b/,
    /\bgayab\b/,
    /\bud+ gay/,
    /\bkho gay/,
    /\bdelete ho gay/,
  ],
  offline: [
    /\boffline\b/,
    /\binternet\b/,
    /\bwi-?fi\b/,
    /\bconnection\b/,
    /\bno (network|signal)\b/,
    /\bnetwork (error|issue|problem)/,
    /\bwithout (internet|net|data|network)\b/,
    /\bmobile data\b/,
    /\bnet (nahi|ke bina)\b/,
    /\bbina net\b/,
  ],
  login: [
    /\blog ?in\b/,
    /\blogg?(ed|ing) (in|out)\b/,
    /\bsign ?in\b/,
    /\bsign ?up\b/,
    /\bpassword\b/,
    /\botp\b/,
    /\baccount\b/,
    /\bverification (code|link|mail|email)\b/,
  ],
  support: [
    /\bsupport\b/,
    /\bno (response|reply|answer|help)\b/,
    /\b(nobody|no one|noone) (answers|replies|responds|answered|replied|responded)\b/,
    /\bnever (replied|responded|answered)\b/,
    /\bphone uthate\b/,
    /\bhelpline\b/,
    /\bcustomer (care|service)\b/,
    /\bhelp ?desk\b/,
    /\bjawab nahi\b/,
    /\bresponse nahi\b/,
  ],
  bugs: [
    /\bnot (\w+ )?work(ing|s)?\b/,
    /\b(doesn't|does not|doesnt|didn't|did not|didnt|don't|dont|do not|isn't|isnt|is not|wasn't|won't|wont|never|stopped|stops) work(ing|s)?\b/,
    /\bbug(s|gy)?\b/,
    /\bbroken\b/,
    /\buseless\b/,
    /\bwaste of (time|money)\b/,
    /\bglitch/,
    /\berrors?\b/,
    /\bbakwas\b/,
    /\bbeka+r\b/,
    /\bfaltu\b/,
    /\bkaam nahi\b/,
  ],
};

// What a competitor would have to get right to win on each complaint.
const EDGE_HINTS = {
  ads: 'no ads',
  paywall: 'one-time price or unlimited free tier',
  crash: 'reliability',
  bugs: 'reliability',
  dataLoss: 'safe delete with undo',
  offline: 'offline-first',
  support: 'responsive support',
  login: 'no forced sign-in',
};

/**
 * Tag every low-star review and pick representative samples.
 * @param {import('./types.js').ReviewRecord[]} reviews
 * @returns {{ tags: import('./types.js').ComplaintTags, samples: import('./types.js').ReviewRecord[] }}
 */
export function tagComplaints(reviews) {
  const tags = emptyTags();
  const hits = new Map();
  for (const review of reviews ?? []) {
    if (!review || !isLowStar(review)) continue;
    const found = tagReview(review.text);
    hits.set(review, found);
    for (const tag of found) tags[tag] += 1;
  }
  return { tags, samples: pickSamples([...hits.keys()], hits) };
}

/**
 * Decide how contested the category is.
 * @param {object} input
 * @param {import('./types.js').StoreResult|null} input.play
 * @param {import('./types.js').StoreResult|null} input.ios
 * @param {import('./types.js').RegistryResult|null} input.npm
 * @param {import('./types.js').ComplaintTags} input.tags
 * @param {number} input.reviewCount  Reviews fetched before filtering to low stars; 0 if unknown.
 * @param {Date|string} [input.now]   Reference date for the newcomer window; defaults to today.
 * @returns {import('./types.js').Verdict}
 */
export function verdict({ play = null, ios = null, npm = null, tags, reviewCount = 0, now } = {}) {
  const ctx = buildContext({ play, ios, npm, tags, reviewCount, now });
  const { level, summary, reason } = decide(ctx);
  return { level, summary, reasons: [reason, ...contextReasons(ctx)], signals: ctx.signals };
}

// ---- tagging -------------------------------------------------------------

function tagReview(text) {
  const normalized = String(text ?? '').toLowerCase().replace(/[\u2018\u2019]/g, "'");
  return TAG_NAMES.filter((tag) => TAG_PATTERNS[tag].some((pattern) => pattern.test(normalized)));
}

function isLowStar(review) {
  // Sources already filter to 1-2 stars; unknown scores are kept, higher ones dropped.
  return !Number.isFinite(review.score) || review.score <= 2;
}

function pickSamples(reviews, hits) {
  const queues = groupByApp(reviews).map((list) => list.sort(compareSamples(hits)));
  const seen = new Set();
  const out = [];
  while (out.length < MAX_SAMPLES && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      const next = takeUnseen(queue, seen);
      if (next) out.push(next);
      if (out.length >= MAX_SAMPLES) break;
    }
  }
  return out;
}

function groupByApp(reviews) {
  const groups = new Map();
  for (const review of reviews) {
    if (!String(review.text ?? '').trim()) continue;
    const key = `${review.store}:${review.appId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(review);
  }
  return [...groups.values()];
}

function compareSamples(hits) {
  return (a, b) => {
    const taggedA = hits.get(a).length > 0 ? 1 : 0;
    const taggedB = hits.get(b).length > 0 ? 1 : 0;
    if (taggedA !== taggedB) return taggedB - taggedA;
    return b.text.length - a.text.length;
  };
}

function takeUnseen(queue, seen) {
  while (queue.length > 0) {
    const review = queue.shift();
    const key = review.text.trim().slice(0, SAMPLE_KEY_CHARS).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    return review;
  }
  return null;
}

// ---- verdict -------------------------------------------------------------

function buildContext({ play, ios, npm, tags, reviewCount, now }) {
  const playApps = play?.apps ?? [];
  const iosApps = ios?.apps ?? [];
  const packages = npm?.packages ?? [];
  const lowStarReviews = (play?.reviews?.length ?? 0) + (ios?.reviews?.length ?? 0);
  const safeCount = Number.isFinite(reviewCount) && reviewCount > 0 ? reviewCount : 0;
  const ctx = {
    playApps,
    iosApps,
    packages,
    tags: normalizeTags(tags),
    reviewCount: safeCount,
    lowStarReviews,
    playLeader: maxBy(playApps, (app) => app.minInstalls),
    iosLeader: maxBy(iosApps, (app) => app.ratings),
    topPackage: maxBy(packages, (pkg) => pkg.weeklyDownloads),
  };
  ctx.signals = computeSignals(ctx, now);
  ctx.leaderEquivalent = Math.max(ctx.signals.leaderInstalls ?? 0, iosInstallEquivalent(ctx.iosLeader?.ratings));
  return ctx;
}

function computeSignals(ctx, now) {
  const installs = ctx.playApps.map((app) => app.minInstalls).filter(isNum);
  const cutoff = isoDate(monthsBefore(now, NEWCOMER_MONTHS));
  return {
    leaderInstalls: installs.length ? Math.max(...installs) : null,
    appsOver100k: installs.filter((n) => n >= 100_000).length,
    appsOver1m: installs.filter((n) => n >= 1_000_000).length,
    newcomersOver10k: ctx.playApps.filter((app) => isNewcomer(app, cutoff)).length,
    lowStarShare: ctx.reviewCount > 0 ? round3(Math.min(1, ctx.lowStarReviews / ctx.reviewCount)) : 0,
    topWeeklyDownloads: isNum(ctx.topPackage?.weeklyDownloads) ? ctx.topPackage.weeklyDownloads : 0,
  };
}

function isNewcomer(app, cutoff) {
  return typeof app.released === 'string' && app.released >= cutoff && (app.minInstalls ?? 0) >= NEWCOMER_MIN_INSTALLS;
}

function decide(ctx) {
  return unknownRule(ctx) || ownedRule(ctx) || crowdedRule(ctx) || noDemandRule(ctx) || demandRule(ctx);
}

function unknownRule(ctx) {
  if (ctx.playApps.length > 0 || ctx.iosApps.length > 0 || ctx.packages.length > 0) return null;
  return {
    level: 'unknown',
    summary: 'not enough data',
    reason: 'No data: 0 Play apps, 0 iOS apps and 0 npm packages were found for this term.',
  };
}

function ownedRule(ctx) {
  const owned = (why) => ({ level: 'owned', summary: 'a giant holds the category', reason: `A giant holds this category: ${why}.` });
  const leader = ctx.playLeader;
  if (leader) {
    const n = leader.minInstalls;
    if (n >= OWNED_INSTALLS) {
      return owned(`Play leader "${leader.title}" has ${fmt(n)}+ installs`);
    }
    if (n >= OWNED_INSTALLS_WITH_RATINGS && isNum(leader.ratings) && leader.ratings >= OWNED_RATINGS) {
      return owned(`Play leader "${leader.title}" has ${fmt(n)}+ installs and ${fmt(leader.ratings)} ratings`);
    }
    if (n >= OWNED_INSTALLS_WITH_RATINGS && ctx.signals.appsOver1m === 1) {
      return owned(`Play leader "${leader.title}" has ${fmt(n)}+ installs and no other Play app has reached 1,000,000`);
    }
  }
  const iosTop = ctx.iosLeader;
  if (iosTop && iosTop.ratings >= OWNED_IOS_RATINGS) {
    return owned(`iOS app "${iosTop.title}" has ${fmt(iosTop.ratings)} ratings, the size of a 10,000,000-install app`);
  }
  const pkg = ctx.topPackage;
  const npmOnly = ctx.playApps.length === 0 && ctx.iosApps.length === 0;
  if (pkg && npmOnly && pkg.weeklyDownloads >= OWNED_NPM_WEEKLY) {
    return owned(`npm package "${pkg.name}" has ${fmt(pkg.weeklyDownloads)} weekly downloads and no app results compete with it`);
  }
  return null;
}

function crowdedRule(ctx) {
  const crowded = (why) => ({ level: 'crowded', summary: 'many strong players', reason: `Many strong players: ${why}.` });
  const { appsOver1m, appsOver100k } = ctx.signals;
  const iosOver1m = ctx.iosApps.filter((app) => isNum(app.ratings) && app.ratings >= 10_000).length;
  const iosOver100k = ctx.iosApps.filter((app) => isNum(app.ratings) && app.ratings >= 1_000).length;
  const bigPackages = ctx.packages.filter((pkg) => isNum(pkg.weeklyDownloads) && pkg.weeklyDownloads >= CROWDED_NPM_WEEKLY).length;
  if (appsOver1m >= CROWDED_APPS_OVER_1M) {
    return crowded(`${appsOver1m} Play apps have 1,000,000+ installs`);
  }
  if (iosOver1m >= CROWDED_APPS_OVER_1M) {
    return crowded(`${iosOver1m} iOS apps have 10,000+ ratings, the size of 1,000,000-install apps`);
  }
  if (appsOver100k >= CROWDED_APPS_OVER_100K) {
    return crowded(`${appsOver100k} Play apps have 100,000+ installs`);
  }
  if (iosOver100k >= CROWDED_APPS_OVER_100K) {
    return crowded(`${iosOver100k} iOS apps have 1,000+ ratings, the size of 100,000-install apps`);
  }
  if (bigPackages >= CROWDED_NPM_PACKAGES) {
    return crowded(`${bigPackages} npm packages have ${fmt(CROWDED_NPM_WEEKLY)}+ weekly downloads`);
  }
  return null;
}

function noDemandRule(ctx) {
  if (ctx.leaderEquivalent >= NO_DEMAND_INSTALLS || ctx.signals.topWeeklyDownloads >= NO_DEMAND_NPM_WEEKLY) return null;
  return {
    level: 'no-demand',
    summary: 'nobody big enough to prove demand',
    reason: `Nobody is big enough to prove demand: ${sizeSummary(ctx)}.`,
  };
}

// Gap needs both demand and complaints. Everything else here is "served", with
// a summary that says what the data actually showed.
function demandRule(ctx) {
  const hasDemand = ctx.leaderEquivalent >= DEMAND_INSTALLS || ctx.signals.topWeeklyDownloads >= DEMAND_NPM_WEEKLY;
  const size = hasDemand ? 'Demand exists' : 'Demand is modest';
  const demand = `${size} (${sizeSummary(ctx)})`;
  const served = (summary, reason) => ({ level: 'served', summary: `${size.toLowerCase()}, ${summary}`, reason });
  if (ctx.lowStarReviews === 0) {
    return served('complaints not measured', `${demand} but no low-star reviews were fetched, so pain is unmeasured.`);
  }
  const complaints = complaintSummary(ctx);
  if (!complaints.real) {
    return served('few complaints', `${demand} but complaints are low: ${complaints.text}.`);
  }
  if (!hasDemand) {
    return served('users complain', `${demand} and complaints are real: ${complaints.text}, but demand is too small to call a gap.`);
  }
  return {
    level: 'gap',
    summary: 'demand exists, few strong players, users complain',
    reason: `${demand} and complaints are real: ${complaints.text}.`,
  };
}

function complaintSummary(ctx) {
  const tagSum = sumTags(ctx.tags);
  const n = ctx.lowStarReviews;
  const [top] = topTags(ctx.tags);
  const topCovers = top && n >= COMPLAINT_TOP_TAG_MIN && top[1] / n >= COMPLAINT_TOP_TAG_SHARE;
  const real = tagSum >= COMPLAINT_TAG_SUM || ctx.signals.lowStarShare >= COMPLAINT_LOW_STAR_SHARE || Boolean(topCovers);
  let text = `${tagSum} tagged complaints in ${n} low-star reviews, ${lowStarSummary(ctx)}`;
  if (topCovers && tagSum < COMPLAINT_TAG_SUM) text += `, and ${top[0]} alone covers ${top[1]} of the ${n}`;
  return { real, text };
}

function sizeSummary(ctx) {
  const parts = [];
  if (ctx.playLeader) parts.push(`the biggest Play app has ${fmt(ctx.playLeader.minInstalls ?? 0)}+ installs`);
  if (ctx.iosLeader) parts.push(`the biggest iOS app has ${fmt(ctx.iosLeader.ratings ?? 0)} ratings`);
  if (ctx.topPackage) parts.push(`the top npm package has ${fmt(ctx.signals.topWeeklyDownloads)} weekly downloads`);
  return parts.join(', ');
}

function lowStarSummary(ctx) {
  if (ctx.reviewCount === 0) return 'low-star share unknown';
  return `${Math.round(ctx.signals.lowStarShare * 100)}% of ${ctx.reviewCount} fetched reviews are 1-2 stars`;
}

function contextReasons(ctx) {
  return [newcomerReason(ctx), ...complaintReasons(ctx)].filter(Boolean);
}

function newcomerReason(ctx) {
  if (ctx.playApps.length === 0) return null;
  const n = ctx.signals.newcomersOver10k;
  if (n > 0) {
    const apps = n === 1 ? '1 app launched in the last 18 months already has' : `${n} apps launched in the last 18 months already have`;
    return `${apps} ${fmt(NEWCOMER_MIN_INSTALLS)}+ installs, so newcomers still get traction.`;
  }
  if (!ctx.playApps.some((app) => typeof app.released === 'string')) {
    return 'Release dates are missing for every Play app, so newcomer traction is unknown.';
  }
  return `No app launched in the last 18 months has reached ${fmt(NEWCOMER_MIN_INSTALLS)} installs, so newcomers struggle to get traction.`;
}

function complaintReasons(ctx) {
  const top = topTags(ctx.tags);
  if (top.length === 0) {
    if (ctx.lowStarReviews === 0) {
      return ['No low-star reviews were fetched (0), so the complaint signal is missing.'];
    }
    return [`No tagged complaints in ${ctx.lowStarReviews} low-star reviews, so there is no complaint pattern to build an edge on.`];
  }
  const listed = top.map(([tag, count]) => `${tag} (${count})`).join(', ');
  const hints = [...new Set(top.map(([tag]) => EDGE_HINTS[tag]))].join(', ');
  return [`Top complaints: ${listed}.`, `An edge would need: ${hints}.`];
}

function topTags(tags) {
  return TAG_NAMES.map((tag) => [tag, tags[tag]])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
}

// ---- helpers -------------------------------------------------------------

function emptyTags() {
  return Object.fromEntries(TAG_NAMES.map((tag) => [tag, 0]));
}

function normalizeTags(tags) {
  const out = emptyTags();
  for (const tag of TAG_NAMES) {
    const n = Number(tags?.[tag]);
    out[tag] = Number.isFinite(n) && n > 0 ? n : 0;
  }
  return out;
}

function sumTags(tags) {
  return TAG_NAMES.reduce((sum, tag) => sum + tags[tag], 0);
}

function iosInstallEquivalent(ratings) {
  if (!isNum(ratings)) return 0;
  for (const [minRatings, installs] of IOS_RATING_TIERS) {
    if (ratings >= minRatings) return installs;
  }
  return 0;
}

function maxBy(items, pick) {
  let best = null;
  for (const item of items) {
    const value = pick(item);
    if (!isNum(value)) continue;
    if (best === null || value > pick(best)) best = item;
  }
  return best;
}

// Same day of the month `months` earlier, clamped to that month's last day so
// the 31st does not roll over into the following month.
function monthsBefore(now, months) {
  const date = now === undefined ? new Date() : new Date(now);
  if (Number.isNaN(date.getTime())) throw new TypeError('verdict: now must be a Date or an ISO date string');
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function isNum(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

// Reasons are prose, so numbers inside them get thousands separators. Signals stay raw.
function fmt(n) {
  return Number(n).toLocaleString('en-US');
}
