# Monitoring System Audit — P0 Bugs

**Date:** 2026-09-03
**Scope:** Uptime monitoring, DNS monitoring, alerting, incident management, public status page

---

## Executive Summary

The monitoring system has **6 P0 bugs** and **4 P1 bugs** that need immediate attention. The most critical issues are:

1. **Snooze bypass** — Alerts continue for snoozed monitors
2. **Incident data corruption** — Stale open incidents accumulate forever
3. **Storage bomb** — DNS snapshots grow without bound
4. **False positives** — `non_200` preset alerts on normal API responses
5. **Silent monitor death** — Malformed URLs permanently kill monitors
6. **Feature gap** — Public status page uses simple query, rich version is dead code

---

## P0 Bugs (Critical — Fix Immediately)

### Bug 1: Snooze Check Missing in `monitoring-probe.ts`

**File:** `apps/web/inngest/functions/monitoring-probe.ts:25-27`
**Impact:** False alerts for snoozed monitors

**Description:**
`monitoring-probe.ts` does NOT call `isMonitorSnoozed()` before processing. The snooze guard was added to `uptime-probe.ts` (lines 58-61), but `monitoring-probe.ts` was never updated. Same gap exists in:
- `web-vitals-probe.ts:40`
- `scheduled-rescan.ts:83`
- `domain-health.ts:36`

When a user snoozes a domain monitor, SSL expiry, domain expiry, and DNS drift alerts continue to fire.

**Impact:**
- User explicitly silences a monitor expecting no alerts
- Monitoring-probe, web-vitals-probe, scheduled-rescan, and domain-health probes all ignore snooze state
- Undermines user trust in the snooze feature

**Suggested Fix:**
```typescript
// Add to top of every probe function:
import { isMonitorSnoozed } from '@scanlyfix/db'

const snoozed = await isMonitorSnoozed(monitorId)
if (snoozed) return { ok: true, skipped: 'snoozed' }
```

---

### Bug 2: `resolveIncident` Only Resolves Latest — Stale Incidents Accumulate

**File:** `packages/db/src/queries/monitors.ts:227-244`
**Impact:** Data corruption — stale open incidents appear forever

**Description:**
`resolveIncident` resolves only the **most recent** open incident. If two concurrent workers create incidents at a day boundary (see Bug 9), the older incident is never resolved. It stays with `resolvedAt = null` indefinitely.

**Impact:**
- Stale open incidents appear on public status page
- Uptime statistics become incorrect
- Over months, orphaned incidents accumulate and skew reporting

**Suggested Fix:**
```typescript
// Change resolveIncident to resolve ALL open incidents:
await db.update(incidents)
  .set({ resolvedAt: new Date(), durationMs: /* compute */ })
  .where(and(
    eq(incidents.monitorId, monitorId),
    isNull(incidents.resolvedAt)
  ))
```

Better yet, add a unique partial index:
```sql
CREATE UNIQUE INDEX idx_incidents_one_open
  ON incidents(monitor_id)
  WHERE resolved_at IS NULL;
```

---

### Bug 3: DNS Snapshot Table Grows Without Bound

**File:** `packages/db/src/queries/monitors.ts:573-581`
**Impact:** Performance degradation at scale

**Description:**
`recordDnsSnapshot` inserts a new row on every check with no cleanup. Comment says "Old snapshots delete nahi hote — audit trail ke liye useful hai." But `getLatestDnsSnapshot` only reads the single most recent snapshot.

At 10K domain monitors, this produces ~3.65M rows/year. Same issue applies to `monitorEvents` and `webVitalsSnapshots`.

**Impact:**
- Table bloat causes vacuum pressure
- Increased backup times
- Eventually query plan degradation
- No retention policy or cleanup job exists

**Suggested Fix:**
Add a retention cleanup query or periodic job:
```typescript
// In sweep.ts or as a cron job:
await db.delete(dnsSnapshots)
  .where(sql`created_at < now() - interval '90 days'`)
```

---

### Bug 4: `non_200` Alert Preset Fires False Positives

**File:** `apps/web/lib/alert-threshold.ts:57-64`
**Impact:** False alerts on normal API responses

**Description:**
The `non_200` preset is labeled "Alert on any non-200 response" but includes every 2xx code from 201-299:
```typescript
failStatusCodes: [
  ...Array.from({ length: 99 }, (_, i) => 201 + i),  // 201-299
  ...Array.from({ length: 200 }, (_, i) => 300 + i),  // 300-499
  ...Array.from({ length: 100 }, (_, i) => 500 + i),  // 500-599
],
```

HTTP 201 (Created), 202 (Accepted), 204 (No Content) are valid success responses. Any API returning 201 on POST triggers false alerts.

**Impact:**
- Users selecting this preset receive dozens of false alerts per day
- Alert fatigue → churn
- Most dangerous: user thinks they're monitoring errors, but they're monitoring successes

**Suggested Fix:**
```typescript
non_200: {
  label: 'Alert on any error response (4xx + 5xx)',
  failStatusCodes: Array.from({ length: 200 }, (_, i) => 400 + i),
},
```

---

### Bug 5: Status Page Uses Simple Query, Rich Version is Dead Code

**File:** `apps/web/app/status/[slug]/page.tsx:17,28-32`
**File:** `packages/db/src/queries/monitors.ts:449-546`
**Impact:** Feature gap — status page missing critical incident data

**Description:**
The status page imports `getPublicProjectBySlug` + `publicUptimeEvents` from `projects.ts`. Meanwhile, a complete `getPublicStatus()` function exists in `monitors.ts` that returns:
- Incident history
- 90-day uptime percentage
- Daily status buckets
- Structured status data

But `getPublicStatus` is **never called**. The status page only shows last 90 raw events.

**Impact:**
- Status page lacks incident details (start time, duration, status code)
- No 90-day uptime percentage
- No daily status strip
- This is the page customers share during incidents — it's missing the most important info

**Suggested Fix:**
Refactor status page to use `getPublicStatus(slug)` instead of the two-function approach. Remove dead `publicUptimeEvents` function.

---

### Bug 6: `monitoring-probe.ts` Crashes on Malformed URL

**File:** `apps/web/inngest/functions/monitoring-probe.ts:27`
**Impact:** Silent monitor death — no alert, no error

**Description:**
```typescript
const hostname = new URL(url).hostname
```
This executes **outside** any `try/catch` and **before** any Inngest step. If `url` is malformed, `new URL()` throws a `TypeError`, crashing the function. With `retries: 0` (line 23), this failure is permanent.

Compare with `domain-health.ts:41-44` which wraps the same call in try/catch.

**Impact:**
- Single malformed URL permanently disables all SSL, domain, and DNS monitoring for that project
- No alert raised, no error logged to user
- Monitor simply stops working forever

**Suggested Fix:**
```typescript
let hostname: string
try {
  hostname = new URL(url).hostname
} catch {
  return { ok: false, error: 'unparseable project URL' }
}
```

---

## P1 Bugs (High Priority — Fix Soon)

### Bug 7: `getPublicStatus` Has N+1 Query Pattern

**File:** `packages/db/src/queries/monitors.ts:449-546`
**Impact:** Slow under incident traffic

**Description:**
`getPublicStatus` makes 5 sequential DB queries:
1. Project lookup
2. Uptime monitor lookup
3. Uptime percentage aggregation
4. Daily bucket aggregation
5. Incident list

During an outage (when status page gets most traffic), 5 round-trips add ~25-50ms per cache miss.

**Suggested Fix:**
- Combine queries 3+4 into a single grouped query
- Use `Promise.all` for independent queries
- Consider materialized view for uptime stats

---

### Bug 8: `alertForDelivery` Silently Drops Alerts if Owner Deleted

**File:** `packages/db/src/queries/alerts.ts:88-108`
**Impact:** Latent data loss path

**Description:**
`alertForDelivery` uses `innerJoin` on `projects` and `users`. If `projects.ownerId` ever becomes nullable (for team ownership transfer), alerts for projects without an owner silently fail to deliver.

**Suggested Fix:**
Change `innerJoin` on `users` to `leftJoin` and handle null case explicitly (log error, queue for admin review).

---

### Bug 9: `recordAlertOnce` Race Condition Allows Duplicate Emails

**File:** `packages/db/src/queries/alerts.ts:32-62`
**Impact:** Duplicate alert emails under high concurrency

**Description:**
Read-then-write without transaction or unique constraint. With 20 concurrent Inngest workers, two monitors failing simultaneously can both succeed in inserting an alert.

Code comments acknowledge this race but call it "rare." With 20 concurrent workers during a widespread outage, it's not that rare.

**Suggested Fix:**
Add partial unique index:
```sql
CREATE UNIQUE INDEX alerts_once_per_day
  ON alerts(project_id, kind, (date_trunc('day', created_at)));
```

Use `ON CONFLICT DO NOTHING` in the insert.

---

### Bug 10: Expired Snooze Rows Never Cleaned Up

**File:** `packages/db/src/queries/monitors.ts:708-719`
**Impact:** Slow degradation over months

**Description:**
`isMonitorSnoozed` correctly filters expired snoozes, but expired rows are never deleted. Over months, the `snoozedMonitors` table accumulates expired rows.

**Suggested Fix:**
Add cleanup in sweep cron:
```typescript
await db.delete(snoozedMonitors)
  .where(sql`expires_at IS NOT NULL AND expires_at < now()`)
```

---

## Priority Matrix

| # | Bug | Severity | Effort | Impact |
|---|-----|----------|--------|--------|
| 1 | Snooze bypass | P0 | Low | False alerts |
| 2 | Incident corruption | P0 | Low | Data integrity |
| 3 | DNS snapshot growth | P0 | Medium | Performance |
| 4 | `non_200` false positives | P0 | Low | False alerts |
| 5 | Status page dead code | P0 | Medium | Feature gap |
| 6 | Malformed URL crash | P0 | Low | Silent failure |
| 7 | N+1 queries | P1 | Medium | Performance |
| 8 | Deleted owner alerts | P1 | Low | Latent loss |
| 9 | Duplicate alerts | P1 | Medium | Duplicate emails |
| 10 | Snooze row cleanup | P1 | Low | Slow degradation |

---

## Recommended Fix Order

1. **Bug 6** (malformed URL) — 5 min fix, prevents silent monitor death
2. **Bug 4** (`non_200` preset) — 5 min fix, prevents false positives
3. **Bug 1** (snooze bypass) — 15 min fix, prevents false alerts
4. **Bug 2** (incident corruption) — 30 min fix, prevents data corruption
5. **Bug 9** (duplicate alerts) — 1 hour fix, prevents duplicate emails
6. **Bug 3** (DNS snapshot growth) — 1 hour fix, prevents storage bomb
7. **Bug 5** (status page) — 2 hours, restores feature parity
8. **Bug 7** (N+1 queries) — 2 hours, improves performance
9. **Bug 10** (snooze cleanup) — 15 min, prevents slow degradation
10. **Bug 8** (deleted owner) — 30 min, defense in depth

---

## Testing Strategy

For each fix, write:
1. **Unit test** — Capture the bug scenario
2. **Regression test** — Ensure the fix doesn't break existing behavior
3. **Integration test** — Verify end-to-end behavior

Use the test infrastructure set up in Phase 0:
```bash
pnpm test:unit          # Pure logic tests
pnpm test:integration   # DB + HTTP mocking tests
pnpm test:e2e           # Full system tests
```
