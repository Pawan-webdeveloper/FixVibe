/**
 * The engine's measurement identity.
 *
 * Two scores are only comparable when the thing that produced them was the
 * same. Every scan records this string, and any feature that subtracts one
 * scan from another — history charts, re-scan diffs, monitoring alerts, a CI
 * gate — must refuse to compare across a change in it.
 *
 * Without that, the first time you ship new checks every monitored customer
 * gets an email saying their site got worse on the day you deployed. The site
 * did not change; the ruler did.
 *
 * When to change it:
 *   MINOR — a check was added to or removed from the registry. Coverage moved,
 *           so the same site legitimately scores differently.
 *   PATCH — an existing check's severity or logic changed what it reports for
 *           unchanged input. A wording fix is not a patch bump; a threshold is.
 *   MAJOR — the shape of ScanScores or Finding changed, i.e. stored scans can
 *           no longer be read by the current code without a migration.
 *
 * Adding a check and forgetting to bump this is the failure mode. The registry
 * count test in test/registry.test.ts is the tripwire: it fails on every
 * registry change, which is the moment to come back here.
 */
export const ENGINE_VERSION = '1.3.0'
