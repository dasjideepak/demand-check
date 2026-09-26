// Shared data shapes for demand-check. Every source module returns these so the
// analyzer and the report never need to know which store the data came from.
// Plain JSDoc: no build step, works in Node >= 18.17.

/**
 * One app from an app store search.
 * @typedef {object} AppRecord
 * @property {'play'|'ios'} store
 * @property {string} id           Play: package name. iOS: numeric track id as a string.
 * @property {string} title
 * @property {string} url
 * @property {string} developer
 * @property {string|null} installs      Play: "1,000,000+". iOS: null (Apple doesn't publish installs).
 * @property {number|null} minInstalls   Play: 1000000. iOS: null.
 * @property {number|null} rating        Average score 0–5, or null if unrated.
 * @property {number|null} ratings       Number of ratings, or null.
 * @property {boolean|null} ads          Contains ads. null = the store doesn't expose it (iOS).
 * @property {boolean|null} iap          Offers in-app purchases. null = unknown.
 * @property {number} price              0 when free.
 * @property {string|null} released      ISO date (YYYY-MM-DD) or null.
 * @property {string|null} updated       ISO date (YYYY-MM-DD) or null.
 */

/**
 * One user review.
 * @typedef {object} ReviewRecord
 * @property {'play'|'ios'} store
 * @property {string} appId
 * @property {string} appTitle
 * @property {number} score        1–5
 * @property {string} text
 * @property {string|null} date    ISO date or null.
 */

/**
 * One npm package from a registry search.
 * @typedef {object} PackageRecord
 * @property {'npm'} registry
 * @property {string} name
 * @property {string} description
 * @property {string} version
 * @property {number|null} weeklyDownloads
 * @property {string|null} lastPublish   ISO date or null.
 * @property {string} url
 */

/**
 * What every app-store source returns.
 * @typedef {object} StoreResult
 * @property {'play'|'ios'} store
 * @property {string} term
 * @property {string} country
 * @property {AppRecord[]} apps        Sorted by search rank, at most `limit`.
 * @property {ReviewRecord[]} reviews  Newest 1–2 star reviews from the top `reviewsPer` apps.
 * @property {number} reviewsFetched   Reviews read before the 1–2 star filter, so the low-star share can be computed.
 * @property {string[]} errors         Human-readable, non-fatal problems (e.g. "reviews unavailable for X").
 */

/**
 * What the npm source returns.
 * @typedef {object} RegistryResult
 * @property {'npm'} registry
 * @property {string} term
 * @property {PackageRecord[]} packages
 * @property {string[]} errors
 */

/**
 * Complaint tags counted over low-star reviews.
 * @typedef {object} ComplaintTags
 * @property {number} ads
 * @property {number} paywall     Subscription, limits, "pay to use", trial issues.
 * @property {number} crash       Crashes, freezes, won't open.
 * @property {number} dataLoss    Lost photos/data, deleted the wrong thing.
 * @property {number} offline     Needs internet for an offline job.
 * @property {number} login       Sign-in problems.
 * @property {number} support     Nobody answers, no help.
 * @property {number} bugs        "Doesn't work", "not working", generic breakage.
 */

/**
 * @typedef {object} Verdict
 * @property {'owned'|'crowded'|'gap'|'served'|'no-demand'|'unknown'} level
 *   owned: a giant holds the category. crowded: many strong players. gap: demand exists,
 *   few strong players, users complain. served: demand exists, few players, users are
 *   happy (hard to beat on pain alone). no-demand: nobody big enough. unknown: no data.
 * @property {string} summary       A few words explaining the level, for the report heading.
 * @property {string[]} reasons     Short sentences, each backed by a number from the data.
 * @property {object} signals
 * @property {number|null} signals.leaderInstalls     Largest minInstalls among Play apps.
 * @property {number} signals.appsOver100k            Play apps with minInstalls >= 100k.
 * @property {number} signals.appsOver1m              Play apps with minInstalls >= 1M.
 * @property {number} signals.newcomersOver10k        Play apps released in the last 18 months with >= 10k installs.
 * @property {number} signals.lowStarShare            Fraction (0–1) of fetched reviews that are 1–2 stars, or 0.
 * @property {number} signals.topWeeklyDownloads      Largest npm weeklyDownloads, or 0.
 */

/**
 * Everything the report renders.
 * @typedef {object} CheckResult
 * @property {string} term
 * @property {string} country
 * @property {string} checkedAt      ISO date-time.
 * @property {StoreResult|null} play
 * @property {StoreResult|null} ios
 * @property {RegistryResult|null} npm
 * @property {ComplaintTags} tags
 * @property {ReviewRecord[]} complaintSamples   Up to 12 representative low-star reviews.
 * @property {Verdict} verdict
 * @property {string[]} errors       Sources that failed entirely (e.g. "Google Play: search failed"); that source is null.
 */

export {};
