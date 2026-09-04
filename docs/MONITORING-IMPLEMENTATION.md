# Monitoring & Uptime — Implementation Reference

> **Purpose:** every line of code that decides "is the site up, what should we tell the user, and how do we tell them" — explained end to end so this feature can be rebuilt, compared against another product, and audited.
> **Scope:** uptime probes, SSL/domain/DNS monitoring, web vitals (PSI), incidents, alerts (email / Slack / Discord / webhook), maintenance windows, snooze, the public status page, and the manual "Run check now" button.
> **Read alongside:** `MONITORING_UPTIME_FEATURES.md` (the feature spec) and `docs/monitoring-audit.md` (known P0/P1 bugs and their fixes).

---

## Table of Contents

1. [Architecture at a glance](#architecture-at-a-glance)
2. [Data model — the 9 tables that power it](#data-model)
3. [Cron + event pipeline — how a check reaches a row](#pipeline)
4. [The four probe kinds](#probe-kinds)
5. [Threshold evaluation — when does "up" become "down"?](#threshold)
6. [Incident lifecycle](#incident-lifecycle)
7. [Alert deduplication, channels, and delivery](#alerts)
8. [Snooze & maintenance windows — suppressing alerts without losing data](#suppression)
9. [Public status page (`/status/[slug]`)](#status-page)
10. [Subscriber email + double opt-in](#subscribers)
11. [Response-time chart, uptime %, and 90-day strip](#rollups)
12. [Configuration: `alertConfig` (custom headers, keyword check, status codes)](#config)
13. [Manual `Run check now` button](#manual-run)
14. [API surface (every route)](#api)
15. [The 6-step onboarding wizard](#onboarding)
16. [Test surface (875 unit tests)](#tests)
17. [Comparison with Statuspage / Better Stack / UptimeRobot](#comparison)
18. [Known gaps & extension points](#gaps)

---

<a id="architecture-at-a-glance"></a>

## 1. Architecture at a glance

```
┌──────────────────────────────────────────────────────────────────┐
│                          TRIGGERS                                 │
│   cron '* * * * *'      POST /api/monitors/:id/run              │
│   POST /api/monitors/deploy-hook   (CI webhook)                 │
│   6-step /onboarding wizard (new user)                           │
└────────────────┬─────────────────────────────┬──────────────────┘
                 │                             │
                 ▼                             ▼
       ┌──────────────────┐         ┌────────────────────────┐
       │  Inngest sweep   │         │  Manual probe trigger  │
       │ (sweep.ts, every │         │  → inngest.send(monitor│
       │   minute)         │         │     Due)                │
       └────────┬─────────┘         └────────────┬───────────┘
                │ claimDueMonitors()              │
                │ (atomic UPDATE…RETURNING)        │
                ▼                                 │
       one `scanlyfix/monitor.due` event per row   │
                │                                 │
   ┌────────────┼─────────────┬───────────────────┘
   ▼            ▼             ▼
┌────────┐ ┌────────┐ ┌────────────────┐
│ uptime │ │ domain │ │ web-vitals     │   Inngest functions (probes)
│probe   │ │ probe  │ │ probe          │
│        │ │ (+ DNS)│ │ (PSI, cached)  │
└───┬────┘ └───┬────┘ └───────┬────────┘
    │          │              │
    ▼          ▼              ▼
   recordMonitorRun() → monitor_events, monitors.lastStatus, lastRunAt
    │
    ▼
┌─────────────────────────────────────────────┐
│  State machine                              │
│  UP → FAILING(1) → DOWN(2=alert) →         │
│       [reminders every N min] → RECOVERED    │
└────────┬────────────────────────────────────┘
         │
         ▼
   recordAlertOnce() → alerts table
   (dedup: daily by (project,kind) OR dedupKey)
         │
         ▼
   deliverAlert(alertId)
     ├─ resolveNotifyChannels()      ← per-monitor allowlist
     ├─ sendEmail() + markAlertSent   ← PRIMARY: email is "what got told"
     ├─ sendSlackChannel()           ← SECONDARY: webhook URLs in DB
     ├─ sendDiscordChannel()
     ├─ sendGenericWebhookChannel()
     └─ notifyConfirmedSubscribersForMonitor()  ← public status-page fan-out
```

Three layers:

| Layer | What it owns | Key files |
|---|---|---|
| **Trigger** | When does a check fire? | `inngest/functions/sweep.ts`, `api/monitors/[id]/run/route.ts`, `api/monitors/deploy-hook/route.ts` |
| **Probe** | What does it measure, what threshold turns "up" into "down"? | `inngest/functions/{uptime,domain,web-vitals}-probe.ts`, `lib/alert-threshold.ts`, `packages/checks/src/{ssl,domain}-checker.ts`, `packages/checks/src/performance/web-vitals.ts` |
| **Record + alert** | Persist result, detect state transition, fan out to channels | `db/queries/{monitors,alerts,alert-channels,maintenance-windows}.ts`, `lib/{alert-email,alert-message,slack,discord,webhook,status-subscriber-email}.ts`, `inngest/functions/auto-resolve-stale-incidents.ts` |

Everything is a **job queue, not a request**. The HTTP request that fires the trigger (cron tick, "Run check now", deploy webhook, onboarding) returns within milliseconds having just emitted one Inngest event. The actual probe runs on the queue worker. This is the same shape Sentry / Linear use: trigger ≠ work.

---

<a id="data-model"></a>

## 2. Data model — the 9 tables

All in `packages/db/src/schema.ts`. Drizzle ORM, Postgres-native enums.

### `monitors`
One row per (project, monitor kind). Schema enforces uniqueness with `uniqueIndex('monitors_project_type_idx')` — duplicates would silently double the cron invocations and the bill.

| column | type | purpose |
|---|---|---|
| `id` | uuid PK | |
| `project_id` | uuid FK → projects | cascade delete |
| `type` | enum `monitor_type` | `uptime` \| `rescan` \| `domain` \| `web_vitals` |
| `interval_s` | int | seconds; uptime floor 60s, domain daily |
| `enabled` | bool | sweep skips disabled rows |
| `last_run_at` | timestamp | atomically advanced by `claimDueMonitors()` to lease |
| `last_status` | text `'up' \| 'down'` | probe's last verdict |
| `alert_config` | jsonb | full custom-config blob (see §12) |

Indexes: `(enabled, last_run_at)` for the sweep's hot query.

### `monitor_events`
Append-only probe log. Powers the public status page and the recent-checks table.

| column | type |
|---|---|
| `id` | uuid PK |
| `monitor_id` | uuid FK → monitors (cascade) |
| `ts` | timestamptz default `now()` |
| `ok` | bool |
| `status_code` | int? |
| `latency_ms` | int? |
| `detail` | text? |
| `diff` | jsonb (`MonitorEventDiff`) — on-the-fly in the read path, not stored |

Index: `(monitor_id, ts DESC)` for `recentEventsWithDiff()`.

### `web_vitals_snapshots`
LCP/INP/CLS/FCP/TTFB/SI rows. Inserted by `webVitalsProbe` after a PSI call (or cache hit).

### `psi_cache`
PSI result cache keyed by normalized URL. TTL: 6h. jsonb body — the schema evolves; ALTER TABLE avoided.

### `monitor_hourly_rollups` + `monitor_daily_rollups`
Pre-aggregated counts and latency stats. The `rollup-worker` Inngest function runs hourly and writes one row per (monitor_id, hour|day) using `INSERT … ON CONFLICT DO UPDATE` for idempotency. The 24h uptime uses hourly, 7d/30d uses daily, 90-day status-page strip uses daily.

### `alerts`
**Delivery log, not configuration.** One row per alert dispatched. The schema:

```sql
kind: text        -- 'downtime' | 'recovered' | 'certificate-expiry-30' | 'dns_drift' | ...
channel: enum     -- email | slack | webhook | discord
payload: jsonb
dedup_key: text   -- reminder alerts only; partial unique index
sent_at: timestamptz  -- NULL until the email provider accepted it
```

A null `sent_at` is the number worth watching in production. `markAlertSent()` is the single point that flips it.

### `alert_channels`
One row per (project, channel-type) with `{ webhookUrl | email | url }` jsonb. `getAlertChannels()` has two overloads: with `viewer` returns **masked** config (last 6 chars / host only) for the API; without returns full config for `deliverAlert`. The mask is the security boundary — a leaked webhook URL is an attacker-controlled alert sink.

### `incidents`
A row per downtime window.

```
started_at      -- the FIRST failure's timestamp
resolved_at     -- null while open
duration_ms     -- null while open
status_code     -- what kicked it off
detail          -- human reason
acknowledged_at, acknowledged_by, notes  -- on-call workflow
```

Indexes: `(monitor_id, started_at DESC)` for history; `(monitor_id, resolved_at)` to find the open one fast. One monitor → 0..1 open incident at a time (the probe enforces this via `getOpenIncident`).

### `incident_updates`
Statuspage-style timeline. Free-text `status` (investigating / identified / monitoring / resolved) — not an enum so new stages don't need a migration. Validation at the API.

### `status_subscribers`
Public status-page email subscribers. One row per `(project_id, lowercased email)`. Token drives both confirm and unsubscribe — one secret, one place to invalidate.

### `maintenance_windows`
Recurring weekly window, e.g. "Sundays 02:00–04:00 America/Los_Angeles". Stored with **local start time + IANA zone** (not epoch), so DST transitions are correct. Probe checks via pure `isInstantInWindow()` in `packages/db/src/maintenance-window.ts`.

### `snoozed_monitors`
One active snooze per monitor (enforced by unique index). `expires_at = null` means indefinite. Probe checks via `isMonitorSnoozed()`.

---

<a id="pipeline"></a>

## 3. Cron + event pipeline — how a check reaches a row

The single point that decides "what should fire right now" is `claimDueMonitors()` in `packages/db/src/queries/monitors.ts`:

```sql
UPDATE monitors
SET last_run_at = now()
WHERE id IN (
  SELECT m.id FROM monitors m
  JOIN projects p ON p.id = m.project_id
  WHERE m.enabled = true
    AND (m.last_run_at IS NULL
         OR m.last_run_at < now() - make_interval(secs => m.interval_s))
  ORDER BY coalesce(m.last_run_at, 'epoch')
  LIMIT 500
)
RETURNING id, type, project_id,
  (SELECT url FROM projects WHERE id = project_id) AS project_url,
  (SELECT slug FROM projects WHERE id = project_id) AS project_slug,
  (SELECT owner_id FROM projects WHERE id = project_id) AS owner_id
```

This is the **optimistic lease pattern** in one statement:

- Claim + fetch in one round trip (no race window between SELECT and UPDATE).
- Two concurrent sweeps cannot claim the same row — each row is leased by exactly one sweep.
- If the probe fails, the lease advances anyway; the next sweep will pick it up only after the interval elapses. A dead worker is self-healing within one cycle.

The sweep itself (`inngest/functions/sweep.ts`) is a cron at `'* * * * *'` with `concurrency: { limit: 1 }` — there is exactly one sweep running at any moment, so no contention to worry about. It loops in batches of 500, `inngest.send()`-ing one `scanlyfix/monitor.due` event per row.

The other two entry points reuse the same event shape:

- **Manual run** (`POST /api/monitors/[id]/run`) — emits one event with `triggeredBy: 'manual'`. The `TriggeredBy` type already includes `'manual'` (reserved since Phase 4). Probes ignore the value for behavior — it's a log breadcrumb.
- **Deploy hook** (`POST /api/monitors/deploy-hook?token=…`) — emits one event per enabled monitor on the project matched by URL. CI systems call this so a deploy is checked immediately, not at the next cron.

Then Inngest routes the event by `type`:

```
scanlyfix/monitor.due { type: 'uptime' }     → uptime-probe
scanlyfix/monitor.due { type: 'domain' }     → domain-probe
scanlyfix/monitor.due { type: 'web_vitals' } → web-vitals-probe
scanlyfix/monitor.due { type: 'rescan' }     → scheduled-rescan
```

Each function has its own concurrency ceiling:

| function | concurrency | retries | reason |
|---|---|---|---|
| `monitor-sweep` | 1 | 0 | never two of these at once |
| `monitor-uptime` | 20 | 0 | fast HTTP probe; high parallelism, no retries (the next sweep picks it up) |
| `monitor-domain` | 10 | 0 | TLS handshake + RDAP — moderate cost |
| `monitor-web-vitals` | 5 | 0 | PSI is 30–90s — high concurrency would rate-limit Google |
| `rollup-worker` | 1 | 0 | hourly aggregation |
| `auto-resolve-stale-incidents` | 1 | 0 | daily cleanup |

---

<a id="probe-kinds"></a>

## 4. The four probe kinds

### 4.1 Uptime — `inngest/functions/uptime-probe.ts`

The largest probe. Single Inngest step per concern, all with `retries: 0`:

```ts
const outcome = await step.run('probe', async () => { … safeFetch … evaluateOutcome() … })
const result  = await step.run('record-and-alert', async () => { … recordMonitorRun … })
if (result.alertId) await step.run('deliver', async () => { deliverAlert(alertId, routing) })
```

**Step 1 — probe**

```ts
const response = await safeFetch(url, {
  timeoutMs: 15_000,
  maxBodyBytes: needsBody ? 64_000 : 4_096,   // keyword check needs more
  followRedirects,
  headers: decryptedCustomHeaders,
})

const { ok, reason } = evaluateOutcome(
  { statusCode, latencyMs, body },
  alertConfig,
)
```

`safeFetch` is the SSRF guard — DNS resolution to private IPs is rejected at the network layer, not at app layer. `evaluateOutcome()` (in `lib/alert-threshold.ts`) applies three checks in order:

1. **Status code** — `expectedStatusCodes` if set, else `failStatusCodes` if set, else default `status >= 400 = down`.
2. **Latency** — `latencyMs > maxLatencyMs`.
3. **Keyword** — substring search in the first 64KB of the body.

**Step 2 — record + alert** (the state machine):

```
outcome.ok →  resolveIncident() if open → send RECOVERED alert (if not snoozed / in maintenance)
outcome.ok →  done

outcome.ok = false → recordMonitorRun() ALWAYS (advances lastRunAt)
                  → consecutiveFailures()  (defaults to "2 in a row = alert")
                  → snooze? maintenance? → skip alert
                  → getOpenIncident()
                  → no open incident?  → DOWN alert + createIncident + notify subscribers
                  → open incident + reminders? → REMINDER alert (dedupKey per slot)
```

The full code is in `apps/web/inngest/functions/uptime-probe.ts:226-451`. The two-fail-streak threshold is deliberate — a single 5xx is noise (deploy, blip); two in a row is a site that's actually down.

The reminder slot math (`getReminderSlot`) is `Math.floor((now - startedAt) / intervalMin)`. Slot 0 is the initial alert (already sent); slot N is the N-th reminder. The `dedupKey` for the N-th reminder is `downtime-{monitorId}-{incidentId}-reminder-{N}` — enforced unique by partial index on `alerts.dedup_key`.

**Step 3 — deliver**

```ts
const channels = await getAlertChannels(projectId)            // full config, server-side only
const routing = resolveNotifyChannels(result.alertConfig, channels.filter(c => c.enabled).map(c => c.id))
return deliverAlert(alertId, routing)
```

`deliverAlert` is in `lib/alert-email.ts`. Email is primary (`markAlertSent` flips the row only after the provider accepts); Slack/Discord/webhook are secondary and their failures don't affect `sentAt`.

### 4.2 Domain — `inngest/functions/domain-probe.ts`

One probe does SSL + domain-expiry + DNS drift in five steps:

```
Step 1 check-ssl       → checkSsl(hostname)             from @scanlyfix/checks
Step 2 check-domain    → checkDomain(hostname)
Step 3 record-and-alert → recordMonitorRun + threshold ladder
Step 4 check-dns        → checkDns(hostname)            from @scanlyfix/db
Step 5 record-dns-and-alert → diff vs last snapshot, alert on change
```

**Threshold ladder** for SSL/domain expiry:

```ts
const CERT_THRESHOLD_DAYS  = [30, 14, 7, 3, 1]
const DOMAIN_THRESHOLD_DAYS = [30, 14, 7, 3, 1]

// First match wins: 25 days → 30, 10 days → 30, 5 days → 30
const threshold = daysLeft < 0 ? 0 : THRESHOLD.find(d => daysLeft <= d)
```

The first match wins — `certificate-expiry-30` fires the day the cert is 30 days out, then `-14`, `-7`, `-3`, `-1` on their respective days. The schema enforces a unique partial index on `dedupKey` so each `-N` only sends once.

**DNS drift** uses `diffDnsRecords()` from `packages/db/src/dns-checker.ts`. First check just records a baseline (no alert). Subsequent checks diff against the latest snapshot; an empty diff records the new snapshot but no alert.

`checkSsl` opens a TLS socket to `hostname:443` with `tls.connect()`, reads `socket.getPeerCertificate()`, computes `daysUntilExpiry = floor((valid_to - now) / 86_400_000)`. Doesn't throw — every failure mode becomes `{ ok: false, detail }`.

`checkDomain` uses **RDAP, not WHOIS** — RFC 7483 JSON, every major registrar supports it. Hits `data.iana.org/rdap/dns.json` for the bootstrap registry, then `endpoint/domain/example.com`.

### 4.3 Web vitals — `inngest/functions/web-vitals-probe.ts`

```
Step 1 check-cache       → getCachedPsiResult(url)        cached? skip PSI
Step 2 fetch-web-vitals  → checkWebVitals(url)            30-90s, isolated
Step 3 record-and-alert  → cache + snapshot + thresholds + alert
Step 4 deliver
```

PSI is expensive — `concurrency: 5` because Google rate-limits around 5 concurrent. `retries: 0` because the next scheduled run catches the miss; retrying would duplicate snapshots.

`evaluateVitals` (in `lib/web-vitals-thresholds.ts`) maps each metric against Google's "good / needs-improvement / poor" bands:

| metric | good | poor |
|---|---|---|
| LCP | ≤ 2.5s | > 4s |
| INP | ≤ 200ms | > 500ms |
| CLS | ≤ 0.1 | > 0.25 |
| FCP | ≤ 1.8s | > 3s |
| TTFB | ≤ 800ms | > 1.8s |
| SI | ≤ 3.4s | > 5.8s |

If any metric is "poor", `hasCritical = true` and the alert subject gets a 🔴. Otherwise 🟡. The alert payload carries `violations[]` and `summary` so the email can render a one-liner.

### 4.4 Re-scan — `inngest/functions/scheduled-rescan.ts`

Triggers the deep site scan pipeline. Phase 7.1 territory — out of scope for this doc.

---

<a id="threshold"></a>

## 5. Threshold evaluation — when does "up" become "down"?

Pure, side-effect-free, in `apps/web/lib/alert-threshold.ts`. Used by `uptime-probe`; the same `evaluateOutcome` is called per-check. Configurable per monitor via `alertConfig`.

**Evaluation order** (first failure short-circuits):

1. Status code:
   - `expectedStatusCodes` set → "down if status not in list"
   - `failStatusCodes` set → "down if status in list"
   - else → "down if status >= 400"
2. Latency: `latencyMs > maxLatencyMs`
3. Keyword: substring search in first 64KB of body

**Presets** (drop-down in the UI):

| key | failStatusCodes | label |
|---|---|---|
| `5xx_only` | [500, 502, 503, 504, 507, 508, 510, 511] | "Alert on 5xx errors only" |
| `4xx_and_5xx` | 400..599 | "Alert on 4xx and 5xx errors" |
| `non_200` | 400..599 | "Alert on any error response" |
| `default` | undefined | "Alert on any error (default — status ≥ 400)" |

**Why all three knobs** (`expectedStatusCodes` vs `failStatusCodes` vs `>= 400`)? Different products have different meanings for "up":
- A REST API wants exactly 200 → `expectedStatusCodes: [200]`
- A web app wants any 2xx → `failStatusCodes: [500, 502, 503, 504]`
- A webhook health page wants anything but 5xx → custom

The schema is a Zod object validated server-side and re-validated on read (jsonb can drift).

---

<a id="incident-lifecycle"></a>

## 6. Incident lifecycle

```
            ┌─────────────┐
   UP ────► │   (none)    │
            └──────┬──────┘
                   │ 2nd consecutive fail
                   ▼
            ┌──────────────────────────┐
            │  incidents row opened    │
            │  startedAt = first fail  │
            │  resolvedAt = null       │
            │  statusCode / detail set │
            └──────┬───────────────────┘
                   │
        ┌──────────┼─────────────────────────────┐
        │          │                             │
   ack by user  reminder (every 15/30/60/120m)  more fails
        │          │                             │
        │          ▼                             │
        │   incidents.acknowledged_at, _by     │  (no extra row;
        │   optional notes                       │   single incident
        │          │                             │   is the truth)
        ▼          ▼                             │
            ┌──────────────────────────┐         │
            │  probes keep running     │◄────────┘
            │  alerts keep dedup'ing   │
            └──────┬───────────────────┘
                   │ probe ok
                   ▼
            ┌──────────────────────────┐
            │ resolvedAt = now         │
            │ durationMs = elapsed     │
            │ RECOVERED alert sent     │
            │ subscribers notified     │
            └──────────────────────────┘
```

The incident row is the single source of truth — the alert and the subscriber notification both reference `incidentId` so a retry of the alert step doesn't send twice. The `dedupKey` on `alerts` plus the `if (!openIncident)` gate in the probe together enforce the rule "one DOWN alert per incident".

**Auto-resolve stale incidents.** A site that genuinely went down, recovered, but the recovery probe never caught up leaves an open incident. The `auto-resolve-stale-incidents` Inngest function (daily cron) finds incidents older than 24h where `monitors.last_status = 'up'` and stamps them with detail `'Auto-resolved: monitor reporting healthy'`. Race-safe via `WHERE resolved_at IS NULL AND started_at <= cutoff` on the UPDATE.

**Ack + notes** is a separate path — `POST /api/incidents/:id/ack` and `PATCH /api/incidents/:id/notes`. Both auth-gated via `getProject()`. Ack is idempotent (re-acking updates the timestamp + user, so a hand-off shows in the audit trail). Notes are 4000-char max — long enough for a post-mortem summary, short enough that no row bloat.

**Public timeline updates.** `POST /api/incidents/:id/updates` appends a row to `incident_updates`. The route fans out to confirmed subscribers via `notifyConfirmedSubscribersForMonitor()` fire-and-forget — slow mail providers don't gate the API response.

---

<a id="alerts"></a>

## 7. Alert deduplication, channels, and delivery

### 7.1 Dedup — `recordAlertOnce()` in `packages/db/src/queries/alerts.ts`

```
no dedupKey, kind in {'downtime', 'recovered'} → always insert (state transitions)
no dedupKey, kind is anything else            → daily dedup by (project, kind)
dedupKey provided                              → unique by dedupKey (partial index)
```

The partial unique index `alerts_dedup_key_unique_idx WHERE dedup_key IS NOT NULL` enforces idempotency for reminders (which always carry a dedupKey) without affecting non-reminder rows (which are null and may repeat on the next day if a new threshold crosses).

A site that flaps every minute for 8 hours is 480 probes → 1 DOWN alert → 16 reminder emails (every 30 min) → 1 RECOVERED. Without dedup that'd be 480 emails.

### 7.2 Routing — `resolveNotifyChannels()` in `lib/alert-threshold.ts`

```
alertConfig.notifyChannels undefined / empty
  → send email AND fan out to every enabled channel

alertConfig.notifyChannels = ['uuid-a', 'uuid-b']
  → suppress email (the list is the user's "not email" intent)
  → fan out ONLY to channels whose id is in the list
    AND currently enabled (a stale id is silently skipped)
```

The email address is the project owner's — not stored as a row in `alert_channels`. So "no email" is encoded as "list is non-empty" rather than as a missing id.

### 7.3 Delivery — `lib/alert-email.ts`

```
deliverAlert(alertId, routing)
  │
  ├─ alertForDelivery(alertId)             one SELECT joining alerts + projects + users
  ├─ if (alert.sentAt) return "already delivered"     belt-and-braces against step re-run
  ├─ render(alert)                          → { subject, text }
  ├─ if (routing.sendEmail)
  │    sendEmail() → if sent: markAlertSent()
  │  else
  │    markAlertSent() (the routing IS the delivery)
  │
  └─ SECONDARY_CHANNELS.map(send):
       sendSlackChannel     ← webhook URL from alertChannels.config.webhookUrl
       sendDiscordChannel   ← webhook URL
       sendGenericWebhookChannel ← webhook URL with HMAC if secret set
       (never throws — failures logged, never block the step)
```

The `markAlertSent` call is the **only** way `sentAt` becomes non-null. A successful Slack + failed email still leaves `sent_at = null` because the customer was never told — exactly what it looks like.

### 7.4 Channel config — masking

`getAlertChannels(projectId)` (no viewer) returns full config; `getAlertChannels(projectId, viewer)` returns masked config. The mask:

| channel | what the API returns |
|---|---|
| `slack` | `https://hooks.slack.com/services/***XXXXXX` (last 6 chars only) |
| `discord` | `https://discord.com/api/webhooks/***/XXXXXX` |
| `webhook` | `https://<host>/***` — host visible for confirmation, path/secret hidden |
| `email` | not stored as a row; recipient is always project owner's email |

The masking is the security boundary — a leaked webhook URL is an attacker-controlled alert sink. The `alert-channels.test-route` allows the owner to fire a test alert to confirm the wiring.

### 7.5 The seven alert kinds the renderer knows

| kind | source | subject line shape | dedup |
|---|---|---|---|
| `downtime` | uptime-probe (2 consecutive fails) | `{host} is not responding` | none — state transition |
| `recovered` | uptime-probe (first ok after down) | `[RESOLVED] {host} is back up (was down {dur})` | none — state transition |
| `downtime-reminder` | uptime-probe (still down + interval slot) | `[STILL DOWN] {host} — down for {dur} (reminder #{n})` | by `downtime-{monitor}-{incident}-reminder-{slot}` |
| `certificate-expiry-{N}` | domain-probe | `{host} certificate expires in {N} days` | daily by kind |
| `domain-expiry-{N}` | domain-probe | `{host} — domain expires in {N} days` | daily by kind |
| `dns_drift` | domain-probe | `⚠️ DNS records changed — {host}` | daily by kind |
| `web_vitals` | web-vitals-probe | `🔴/🟡 Web Vitals alert — {url}` | daily by kind |
| `score-drop` | scheduled-rescan | `{host} dropped {n} points` | daily by kind |
| **unknown** | future | `{host}: {kind}` (fallback) | — |

`render()` in `lib/alert-message.ts` is pure (no DB, no mail provider). Unknown kinds return a generic message rather than null — less useful than tailored, infinitely more useful than silence.

---

<a id="suppression"></a>

## 8. Snooze & maintenance windows — suppressing alerts without losing data

Both mechanisms follow the same contract:

> Probe ALWAYS runs and writes to `monitor_events`. Suppression only blocks alert dispatch.

This is the busy-loop prevention: the sweep sees `last_run_at` advance and won't re-dispatch. A snoozed monitor keeps being probed, keeps being recorded, but doesn't wake the on-call.

### 8.1 Snooze — `snoozed_monitors` + `isMonitorSnoozed()`

```
snooze (POST /api/monitors/:id/snooze)
  body: { expiresAt: ISO|null, reason: string|null }
  expiresAt null → indefinite
  expiresAt past → 400
  one row per monitor (unique index enforces)
  re-snooze = delete + insert (audit trail)

unsnooze (DELETE /api/monitors/:id/snooze)

isMonitorSnoozed(monitorId) — pure SELECT
  returns true iff a row exists where expiresAt IS NULL OR expiresAt >= now()
```

The probe calls this twice — once before the initial DOWN alert, once before reminders.

### 8.2 Maintenance windows — `maintenance_windows` + `isInMaintenanceWindow()`

A row defines a recurring window — "Sundays 02:00–04:00 America/Los_Angeles". The probe checks `isInMaintenanceWindow(monitorId, now)` which:

1. Pulls all enabled rows for the monitor.
2. Projects `now` to the window's IANA timezone via `Intl.DateTimeFormat` (cached).
3. Checks `(hour, minute)` against `[startTime, startTime + durationMin)`.
4. Returns true on the first match.

```
intl.DateTimeFormat(timezone).formatToParts(now)
  → { weekday: 'Sun', hour: 2, minute: 13, day: 14 }
  → window.dayOfWeek matches? 2*60+13 in [start, start+duration)?
```

The window's `startTime` is **local time, not epoch**. DST is handled correctly by `Intl.DateTimeFormat`. The API caps `durationMin` to `1440 - startMinute` so a window can't extend past midnight in its own zone.

`getActiveMaintenanceWindow(monitorId)` returns the first matching window (or null) — used by the public status page to render the "Scheduled maintenance" banner.

**Both mechanisms are checked independently.** A monitor can be snoozed AND in maintenance — the alert is suppressed regardless of which is true.

---

<a id="status-page"></a>

## 9. Public status page (`/status/[slug]`)

No login. No email. No cookies. Read-only. Cached for 60 seconds (`export const revalidate = 60`).

**The slug is the URL.** A slug is generated once per project (`slugFor(input.url)` in `db/queries/projects.ts:97`) and is unique. It is the only thing the page needs — a project can change owners and the link still works.

### 9.1 Data — `getPublicStatus(slug)` in `db/queries/monitors.ts`

Returns:

```ts
{
  projectName, projectUrl,
  overallStatus: 'ok' | 'failed' | 'unknown',     // worst-of aggregation
  lastCheckedAt,                                 // max across components
  uptimePercent,                                 // weighted across uptime components only
  components: PublicComponent[],                 // one per enabled monitor
  branding: { logoUrl, brandColor, robotsIndexable }
}
```

Each `PublicComponent` carries:

```
type, name, currentStatus, lastCheckedAt,
uptimePercent,                                    // for uptime components
dailyBuckets: [{ date, ok, total }]               // 90-day strip
recentIncidents: PublicIncidentWithUpdates[]     // last 10 + their timeline
maintenance: PublicMaintenanceWindow | null
```

The aggregation is **worst-of**: any `failed` → `failed`; any `unknown` → `unknown`; all `ok` → `ok`. Uptime % is averaged across uptime components only (domain/web_vitals would skew it).

The page is **multi-component by design** — one `ComponentCard` per enabled monitor. A project that has only uptime shows one card; one that has all four shows four. The `componentLabel()` helper maps `type` → display label.

### 9.2 Components — `components/status/component-card.tsx`

Per-component card. Renders:
- Status icon + label
- For uptime: 90-day daily strip (`uptime-strip.tsx`)
- Last 10 incidents with the human timeline (`incident-updates-timeline.tsx`)
- Active maintenance window (if any)
- Last-updated timestamp

### 9.3 Header — `components/status/status-header.tsx`

Aggregated: project name, logo, brand color, overall status, uptime %, last-updated, manual Refresh button.

### 9.4 Polish — `components/status/last-updated-indicator.tsx`, `project-maintenance-banner.tsx`, `status-polish-helpers.ts`

- **Last updated indicator** — "Last updated Xs ago" + a Refresh button that calls `router.refresh()`.
- **Project maintenance banner** — aggregates all active windows into one banner so visitors see one "we're doing maintenance" message rather than N.
- **`robotsIndexable`** — owner-controlled. Default true; opt-out emits `noindex` meta.

---

<a id="subscribers"></a>

## 10. Subscriber email + double opt-in

Public status-page visitors can subscribe to email notifications. Two-phase confirmation prevents the form from being used as an email harvester.

### 10.1 Subscribe — `POST /api/status/subscribe`

```
body: { email, projectSlug }
  1. validate email (lowercase, trim, regex)
  2. rate-limit: 5/hour per IP-hash (salted SHA-256)
  3. resolve slug → project (must exist)
  4. upsert status_subscribers row, confirmed=false
  5. send confirmation email with token-link
```

The token is 32 random bytes hex-encoded. Same token drives both confirm and unsubscribe (one secret = one thing to invalidate when someone replies "stop emailing me").

### 10.2 Confirm — `GET /api/status/confirm?token=…`

```
  1. lookup by token
  2. set confirmed=true, confirmedAt=now()
  3. redirect to /status/[slug]?confirmed=1
```

The page reads `confirmed=1` from the URL and shows a one-line banner.

### 10.3 Unsubscribe — `GET /api/status/unsubscribe?token=…`

Soft delete (`unsubscribed_at = now()`). Re-subscribing with the same email on the same project is intentionally blocked — the existing row keeps its unsubscribe stamp.

### 10.4 Fan-out — `lib/status-subscriber-email.ts`

`notifyConfirmedSubscribersForMonitor({ monitorId, email: {...} })` resolves confirmed+active subscribers for the monitor's project, then loops `sendEmail()` in parallel. Failures are logged, never thrown — one bad address shouldn't block the rest.

`lib/status-subscriber-email.ts:240` is where the rate-limited `countSubscribeAttemptsByIpSince` lookup lives — used to throttle to 5/hour per IP.

---

<a id="rollups"></a>

## 11. Response-time chart, uptime %, and 90-day strip

### 11.1 The rollup flow

```
every minute:        sweep emits events
every probe:         recordMonitorRun writes monitor_events
every hour :05:      rollup-worker
                       → aggregateHourlyRollup(previousHour)
                          INSERT INTO monitor_hourly_rollups
                          SELECT monitor_id, COUNT, AVG, P95, MIN, MAX
                          FROM monitor_events WHERE ts IN [hour, hour+1h)
                          GROUP BY monitor_id
                          ON CONFLICT DO UPDATE

                       every hour at 05:05 also: aggregateDailyRollup
                       also: cleanupOldEvents(1000) until <1000 rows deleted
```

Two tables (`monitor_hourly_rollups`, `monitor_daily_rollups`) with primary key `(monitor_id, hour|day)`. The `ON CONFLICT DO UPDATE` is idempotent — re-running an aggregation just rewrites.

`cleanupOldEvents` deletes events older than 90 days in 1000-row batches to avoid long-running locks. The 90-day retention matches what the public status page displays — everything older is gone but the daily rollups persist forever.

### 11.2 Read paths

```
GET /api/monitors/:id/uptime?period=24h   → getUptimeFromHourlyRollups(monitor, 24h ago, now)
GET /api/monitors/:id/uptime?period=7d    → getUptimeFromDailyRollups(monitor, 7d ago, now)
GET /api/monitors/:id/uptime?period=30d   → getUptimeFromDailyRollups(monitor, 30d ago, now)

GET /api/monitors/:id/response-times?range=1h
  → raw SELECT date_trunc('minute'), AVG, P95, MAX, COUNT(*) FROM monitor_events …
GET /api/monitors/:id/response-times?range=24h
  → getResponseTimesFromHourlyRollups(monitor, 24h ago, now)
GET /api/monitors/:id/response-times?range=7d
  → getResponseTimesFromDailyRollups(monitor, 7d ago, now)

GET /status/[slug]  → getPublicStatus(slug)
  → getUptimeFromDailyRollups(monitor, 90d ago, now)         ← uptimePercent
  → getDailyBucketsFromRollups(monitor, 90)                    ← 90-day strip
```

The `1h` range uses raw events because hourly rollups are too coarse (one data point per hour = 60 points; raw = per-minute). The 24h and 7d ranges use rollups.

### 11.3 The `getUptimeFromDailyRollups` math

```sql
SELECT
  COALESCE(SUM(up_checks), 0)::float
  / NULLIF(SUM(total_checks), 0) AS uptime_percent
FROM monitor_daily_rollups
WHERE monitor_id = $1 AND day BETWEEN $2 AND $3
```

`NULLIF(SUM, 0)` means "no checks → null" rather than "no checks → div by zero". The route then renders `null` as a "No data" badge, never as "100% uptime" — that would be misleading.

### 11.4 The 90-day strip

`getDailyBucketsFromRollups(monitorId, 90)` returns 90 rows — one per day for the last 90 days — each with `{ date, ok, total }`. The component renders this as a Statuspage-style calendar strip (green/red squares). Days with zero checks are not returned; the strip pads them visually so the strip looks continuous.

---

<a id="config"></a>

## 12. Configuration: `alertConfig` (custom headers, keyword check, status codes)

Stored as jsonb on `monitors.alert_config`. Schema in `packages/db/src/alert-config.ts` (Zod), mirrored in `apps/web/lib/alert-threshold.ts`. The DB type lives in `packages/db/src/schema.ts:404-426`.

```ts
{
  failStatusCodes?: number[]              // e.g. [500, 502, 503]
  maxLatencyMs?: number | null            // e.g. 5000
  reminderIntervalMin?: 15|30|60|120     // reminders while down
  keywordCheck?: {
    type: 'should_contain' | 'should_not_contain'
    value: string                        // ≤500 chars
    caseSensitive?: boolean
  }
  expectedStatusCodes?: number[]         // e.g. [200]
  httpMethod?: 'GET' | 'HEAD'            // default GET
  customHeaders?: Array<{
    key: string                          // alphanumeric+hyphen, ≤100 chars
    valueEncrypted: string               // AES-256-GCM encrypted at rest
  }>                                    // ≤5 headers
  followRedirects?: boolean              // default true
  notifyChannels?: string[]              // alert_channels ids, ≤5
}
```

### 12.1 PATCH /api/monitors/:id/config

```
1. viewer auth (401)
2. UUID validation (400)
3. zod parse body (400)
4. parseAlertConfig → Zod + size validation (≤ 4KB)
5. encryptHeaders → encryptValue each header (no-op if already encrypted)
6. ownership check (403)
7. UPDATE monitors SET alert_config = $1 WHERE id = $2
8. response: { ok: true } (no echo of config — caller refetches)
```

`encryptValue()` in `apps/web/lib/header-encryption.ts` is AES-256-GCM with a key from env. Headers come in plain on first save; subsequent saves detect the colon-separated format and skip re-encryption.

### 12.2 GET /api/monitors/:id/config

Returns masked config — custom headers become `{ key, valueMasked: '***last4' }`. The UI shows the user what headers are set but never the values.

### 12.3 Custom headers — `prepareHeaders()` in `lib/header-encryption.ts`

At probe time, `uptime-probe` reads `monitor.alert_config`, parses with Zod, calls `prepareHeaders(alert_config.customHeaders)` to decrypt the values, and passes them to `safeFetch` as the `headers` option. The decrypted values never leave the worker.

### 12.4 Notification routing — `notifyChannels`

Per-monitor opt-out of the project owner's email. Empty list (the default) = send email + all enabled channels. Non-empty = suppress email, send to listed channels only. See `lib/alert-threshold.ts:412` (`resolveNotifyChannels`).

---

<a id="manual-run"></a>

## 13. Manual "Run check now" button (Phase 7.3)

A button on the monitor detail page that runs a single probe immediately, without waiting for the next cron tick. Three pieces:

### 13.1 API — `POST /api/monitors/[id]/run`

```ts
const viewer = await getViewer()
if (viewer.kind !== 'user') return 401

const monitor = await db.query.monitors.findFirst({
  where: eq(monitors.id, id),
  columns: { id: true, type: true, enabled: true, projectId: true },
})
if (!monitor) return 404

const project = await getProject(monitor.projectId, viewer)
if (!project) return 404                          // 404 covers "not yours"

await inngest.send({
  name: EVENTS.monitorDue,
  data: { monitorId, type, projectId: project.id, url: project.url, triggeredBy: 'manual' },
})

return { ok: true, monitorId }
```

The route does NOT perform the probe — it emits the same event the sweep does. The probes handle `'manual'` like any other trigger; the value is just a log breadcrumb.

Two clicks in quick succession = two events. The probes dedupe on the row update (`last_run_at` advances each time), so the user sees two log entries. They explicitly did not debounce at the route — "I clicked twice = two checks" is the right user model.

A disabled monitor can still be run by hand — the user explicitly asked. Disabling the cron should not also disable the escape hatch.

### 13.2 Client — `apps/web/components/monitors/run-check-button.tsx`

Four phases the user can see: `idle → running → finished → error`. Plus one they can't: `polling`.

```
[click]
  ↓
[POST /api/monitors/:id/run]
  ↓ on 200
[start polling /api/monitors/:id/logs?limit=1 every 600ms for up to 10s]
  ↓ on a row newer than baseline
[onChecked() → parent refetches → "Check complete" for 2s → idle]
```

The polling lives in `run-check-button-logic.ts` (pure, testable). The button takes a `baseline: { firstId, firstTs } | null` prop so polling can detect "new row" without scanning history.

### 13.3 Tests — `apps/web/test/{run-check-button-logic,monitor-run-route}.test.ts`

- `isLogRowNewer`: 5 cases (null baseline, id match, id diff, ts-only baseline).
- `runLogPoll`: 5 cases (onHit, onDeadline, cancel, network blip, idempotent cancel).
- POST route: 6 cases (401 anon, 400 bad UUID, 404 not found, 404 not yours, 200 emits, 200 disabled).

---

<a id="api"></a>

## 14. API surface

Every endpoint is `runtime = 'nodejs'` (not Edge) — Node-only crypto (TLS, HMAC) and Drizzle need it.

### Per-monitor

| method | path | purpose |
|---|---|---|
| `GET` | `/api/monitors/:id/uptime?period=24h\|7d\|30d` | uptime % + avg/p95 latency |
| `GET` | `/api/monitors/:id/response-times?range=1h\|24h\|7d` | chart data |
| `GET` | `/api/monitors/:id/logs?limit=N` | last N events with diff |
| `GET` | `/api/monitors/:id/incidents` | last N incidents with acknowledger |
| `GET` | `/api/monitors/:id/snooze` | active snooze (or null) |
| `POST` | `/api/monitors/:id/snooze` | `{ expiresAt, reason }` — snooze |
| `DELETE` | `/api/monitors/:id/snooze` | unsnooze immediately |
| `POST` | `/api/monitors/:id/run` | Phase 7.3 manual trigger |
| `GET` | `/api/monitors/:id/config` | masked alertConfig |
| `PATCH` | `/api/monitors/:id/config` | `{ alertConfig }` — update |
| `GET` | `/api/monitors/:id/monitoring` | fresh SSL + domain-expiry for a domain monitor |
| `GET/POST/DELETE/PATCH` | `/api/monitors/:id/maintenance-windows` | recurring windows |

### Per-incident

| method | path | purpose |
|---|---|---|
| `POST` | `/api/incidents/:id/ack` | acknowledge |
| `PATCH` | `/api/incidents/:id/notes` | `{ notes }` |
| `POST` | `/api/incidents/:id/updates` | `{ status, message }` — timeline post |

### Cross-cutting

| method | path | purpose |
|---|---|---|
| `POST` | `/api/monitors/deploy-hook?token=…` | CI webhook — emits one event per enabled monitor |
| `POST` | `/api/status/subscribe` | status-page double opt-in |
| `GET` | `/api/status/confirm?token=…` | confirm subscription |
| `GET` | `/api/status/unsubscribe?token=…` | unsubscribe |
| `GET` | `/api/inngest` | Inngest function registration |

All viewer-gated routes use the same `getViewer()` then `getProject()` pattern — the route never trusts the URL. A bad monitor id or a wrong project's row returns 404, not 403, so an attacker can't enumerate ids.

---

<a id="onboarding"></a>

## 15. The 6-step onboarding wizard

`/onboarding` is a 6-step state machine. New user only — anyone with a project redirects to `/dashboard`. The wizard runs the four parallel checks (uptime / SSL / domain / PSI) so the user sees what they're about to monitor before they commit.

```
Step 1: URL input              → normalizeScanTarget()    → validate + https-force
Step 2: parallel checks UI     → POST /api/onboarding/check → uptime/SSL/domain/PSI
Step 3: scorecard summary       → green / amber / red per check + overall verdict
Step 4: "We'll monitor this"   → createOnboardingProjectAction (Phase 7.1)
                                  → four default monitors in one tx
Step 5: alert setup             → Supabase email_confirmed_at check
                                  → "Verify email to get alerts" CTA + Slack link
Step 6: status page reveal      → /status/[slug] + copy button
```

Files:
- `apps/web/app/(app)/onboarding/page.tsx` — server shell
- `apps/web/components/onboarding/onboarding-wizard.tsx` — state machine
- `apps/web/components/onboarding/onboarding-step-{url,checks,monitors,alerts,status}.tsx`
- `apps/web/components/onboarding/onboarding-checks-logic.ts` — pure tone mappers
- `apps/web/app/api/onboarding/check/route.ts` — POST endpoint

---

<a id="tests"></a>

## 16. Test surface (875 unit tests)

```
apps/web/test/   858 passing + 1 skipped
packages/db/     ~14 (separate workspace)
```

Key test files for this doc:

| file | covers |
|---|---|
| `apps/web/test/monitoring-deploy-hook.test.ts` | token auth, URL validation, project resolution, event emission |
| `apps/web/test/monitoring-probes.test.ts` | the four probes' pure parts |
| `apps/web/test/monitoring-uptime-probe-deep.test.ts` | uptime state machine, dedupKey, ack/note paths |
| `apps/web/test/monitoring-dns-deep.test.ts` | DNS drift detection, snapshot persistence |
| `apps/web/test/monitoring-web-vitals-thresholds-deep.test.ts` | the good/poor bands per metric |
| `apps/web/test/monitoring-alert-message.test.ts` | the 8 alert renderers |
| `apps/web/test/monitoring-alert-threshold.test.ts` | `evaluateOutcome` 3-check order |
| `apps/web/test/monitoring-snooze-config-api.test.ts` | snooze CRUD |
| `apps/web/test/incidents-routes.test.ts` | ack + notes + updates |
| `apps/web/test/maintenance-windows-routes.test.ts` | window CRUD + DST math |
| `apps/web/test/uptime-chart.test.ts`, `uptime-days.test.ts`, `uptime-badge.test.ts` | UI rendering |
| `apps/web/test/response-time-chart.test.ts` | chart data shape |
| `apps/web/test/psi-cache.test.ts` | the 6h PSI cache |
| `apps/web/test/alert-channels-test-route.test.ts` | masking + test-send |
| `apps/web/test/ratelimit-status-subscribe.test.ts` | 5/hour/IP cap |
| `apps/web/test/run-check-button-logic.test.ts` | the Phase 7.3 polling logic |
| `apps/web/test/monitor-run-route.test.ts` | the Phase 7.3 manual trigger |

---

<a id="comparison"></a>

## 17. Comparison with Statuspage / Better Stack / UptimeRobot

| Concern | ScanlyFix | Statuspage | Better Stack | UptimeRobot |
|---|---|---|---|---|
| **Probe types** | uptime, SSL, domain expiry, DNS drift, web vitals (PSI) | uptime (their infra), integrations | uptime, SSL, domain, transactions, cron | uptime (HTTP/keyword/ping/port) |
| **Probe cadence** | per-monitor configurable; cron sweep every minute, lease pattern | per-check configurable | per-check configurable | per-check 1m–24h |
| **Thresholds** | per-monitor: status codes, latency, keyword, custom headers, HTTP method | basic (status only) | similar | basic |
| **Custom headers** | yes, AES-256-GCM encrypted at rest | no | yes | no |
| **HTTP method** | GET or HEAD | GET only | GET only | GET/HEAD/POST |
| **SSL probe** | own `tls.connect()`, returns days + subject + serial | third-party integrations | own probe | third-party |
| **Domain expiry** | own RDAP implementation, IANA bootstrap | third-party | own | third-party |
| **DNS drift** | yes — diff vs last snapshot | no | partial | no |
| **Web vitals (Lighthouse/PSI)** | own PSI integration, 6h cache | no | no | no |
| **State machine** | UP → FAILING(1) → DOWN(2) | UP/DOWN, no streak | configurable streak | configurable streak |
| **Reminders** | per-monitor, 15/30/60/120m slots | manual | manual | manual |
| **Dedup** | daily by (project,kind) + reminder slot | daily | daily | daily |
| **Channels** | email, Slack, Discord, webhook, per-monitor opt-out | email, SMS, Slack, Teams | email, Slack, MS Teams, webhook, OpsGenie, PagerDuty | email, SMS, Slack, Teams, webhooks |
| **Channel config storage** | per (project, channel) row, jsonb | global | per integration | per integration |
| **Webhook URL masking** | yes — last 6 chars or host only, never returned in API responses | n/a | partial | partial |
| **Incidents** | yes — opened/resolved/auto-resolved after 24h | yes | yes | yes |
| **Incident timeline** | yes — `incident_updates` with `investigating/identified/monitoring/resolved` | yes | yes | no |
| **Ack + notes** | yes — idempotent ack, 4000-char notes | yes | yes | partial |
| **Snooze** | yes — per-monitor, one-row unique constraint | yes | yes | yes |
| **Maintenance windows** | yes — recurring weekly, IANA zone, DST-correct | yes | yes | yes |
| **Public status page** | yes — multi-component, aggregate, 90-day strip, branded, robots | yes | yes | yes |
| **Subscriber email** | yes — double opt-in, 5/hr/IP rate limit, one-click unsubscribe | yes | yes | yes |
| **Onboarding wizard** | 6-step with parallel checks before commit | none (jump to dashboard) | none | minimal |
| **Manual "Run check now"** | yes — Phase 7.3 | yes | yes | yes |
| **Rollup tables** | hourly + daily, computed by `rollup-worker`, 90-day retention | proprietary | proprietary | proprietary |
| **Worker queue** | Inngest (cron + events + steps with memoization) | internal | internal | internal |
| **Storage of probes** | append-only `monitor_events` | proprietary | proprietary | proprietary |
| **Public-page caching** | `revalidate = 60` (1 min) | varies | varies | varies |

**What's the same as the leaders:** the core loop is identical — probe → record → threshold → state transition → dedup → dispatch → public page. The shape of `recordAlertOnce`, the two-failure streak, the threshold ladder, the double opt-in, the masked webhook URLs, the snooze-only-suppresses-dispatch contract — these are universal patterns.

**Where ScanlyFix goes deeper:**
- One probe does SSL + domain + DNS drift in 5 steps (most products integrate three vendors).
- PSI integration with 6h cache (none of the leaders have this).
- DST-correct maintenance windows using `Intl.DateTimeFormat` (most use stored epoch and get it wrong twice a year).
- Per-monitor opt-out of email via `notifyChannels` in the alertConfig.
- Manual run button uses the same event the sweep does — no parallel probe code path.

**Where ScanlyFix is thinner:**
- No SMS alerts.
- No team/multi-recipient alerting (one row → project owner's email).
- No transaction checks (multi-step flow validation).
- No Pingdom-style "real browser" checks (only HTTP probes).
- No synthetic transaction recording (Playwright) — out of scope; PSI is the closest analog.

---

<a id="gaps"></a>

## 18. Known gaps & extension points

### Known issues (see `docs/monitoring-audit.md` for the full list)

1. **Webhook delivery error masking** — if a Slack channel is misconfigured, the alert still says "sent" because email is primary. Users sometimes think Slack is wired when it isn't. Fix: surface secondary failures in the API response.
2. **Subscriber email rate limit** is per-IP, not per-address. A single IP (corporate NAT) hitting 6 subscribes in an hour triggers 429 even if they're all different valid emails.
3. **PSI cache is by URL only** — same URL behind two different projects shares a cache row. Harmless today (cache is read-only after the write), but a future per-project isolation would be a one-line key change.
4. **Rollup-worker is one-shot per hour** — if the worker is down at 5:05, no rollup until 6:05. Acceptable (rollup is a perf optimization, not a correctness gate).
5. **`cleanupOldEvents` deletes in 1000-row batches** — at a million events/day, that's 1000 batches per day. Fine, but not parallelized.

### Extension points (where to add a feature)

| want to add | file to touch | shape |
|---|---|---|
| new alert kind | `lib/alert-message.ts:render()` | new `if (alert.kind === 'X') { ... }` branch; payload shape goes in the probe that emits it |
| new channel (Teams, OpsGenie) | `lib/alert-email.ts:192 SECONDARY_CHANNELS` | add a `ChannelSender`, add to the array; schema in `packages/db/src/queries/alert-channels.ts` |
| new monitor kind | `packages/db/src/schema.ts:75 monitorTypeEnum` + new probe function | enum value, new probe in `inngest/functions/`, sweeper already handles any enabled row |
| new threshold rule | `lib/alert-threshold.ts:evaluateOutcome()` | add a 4th check after status/latency/keyword |
| per-recipient routing | `lib/alert-email.ts:deliverAlert()` | replace `getAlertChannels` + `recipientEmail` lookup with a per-recipient resolver |
| SMS alerts | new `lib/sms.ts` + new channel type | same pattern as Slack/Discord |
| 24h-on-the-hour rollup | `inngest/functions/rollup-worker.ts` | trigger `{ cron: '0 * * * *' }` and an idempotent UPSERT; the existing `ON CONFLICT DO UPDATE` makes a back-fill trivial |
| synthetic transactions | new `lib/transactions/` | follow the PSI integration shape: probe + cache + step in an Inngest function |
| mobile push | new `lib/push.ts` + Web Push | same shape as Slack/Discord |

The codebase is small and the seams are explicit. Adding a new alert kind, channel, or probe is one new branch in one file — the contracts (Viewer, alert.kind, payload jsonb, markAlertSent) are stable.

---

## Appendix A — file index (every file this doc references)

### DB layer (`packages/db/`)
```
src/schema.ts                                     monitors, monitor_events, web_vitals_snapshots,
                                                  psi_cache, monitor_hourly_rollups, monitor_daily_rollups,
                                                  alerts, alert_channels, incidents, incident_updates,
                                                  status_subscribers, maintenance_windows, snoozed_monitors

src/maintenance-window.ts                         projectToLocal, isInstantInWindow (DST math)

src/queries/projects.ts                           getProject, createProject, createProjectWithMonitors,
                                                  slugFor, newVerificationToken, getPublicProjectBySlug

src/queries/monitors.ts                           listMonitors, setMonitor, claimDueMonitors,
                                                  recordMonitorRun, recentEvents, consecutiveFailures,
                                                  createIncident, resolveIncident, getOpenIncident,
                                                  listMonitorsForUser, getUptime, listIncidents,
                                                  getIncident, acknowledgeIncident, setIncidentNotes,
                                                  findStaleOpenIncidents, autoResolveStaleIncident,
                                                  getDomainMonitor, ensureDomainMonitor,
                                                  getPublicStatus, getLatestDnsSnapshot,
                                                  recordDnsSnapshot, recentEventsWithDiff,
                                                  isMonitorSnoozed, getActiveSnooze, snoozeMonitor,
                                                  unsnoozeMonitor, cleanupOldMonitorData

src/queries/alerts.ts                              recordAlertOnce, alertForDelivery, markAlertSent, listAlerts

src/queries/alert-channels.ts                     getAlertChannels (overloaded), upsertAlertChannel,
                                                  setAlertChannelEnabled, deleteAlertChannel

src/queries/maintenance-windows.ts                createMaintenanceWindow, listMaintenanceWindows,
                                                  setMaintenanceWindowEnabled, deleteMaintenanceWindow,
                                                  isInMaintenanceWindow, getActiveMaintenanceWindow

src/queries/status-subscribers.ts                 createStatusSubscriber, confirmStatusSubscriber,
                                                  unsubscribeByToken, listConfirmedSubscribersForMonitor,
                                                  countSubscribeAttemptsByIpSince

src/queries/rollups.ts                            aggregateHourlyRollup, aggregateDailyRollup,
                                                  cleanupOldEvents, getResponseTimesFromHourlyRollups,
                                                  getResponseTimesFromDailyRollups,
                                                  getUptimeFromHourlyRollups, getUptimeFromDailyRollups,
                                                  getDailyBucketsFromRollups
```

### Checks package (`packages/checks/src/`)
```
ssl-checker.ts            checkSsl(hostname) → SslCheckResult (TLS handshake, daysUntilExpiry, subject)
domain-checker.ts         checkDomain(hostname) → DomainCheckResult (RDAP via IANA bootstrap)
performance/web-vitals.ts checkWebVitals(url) → WebVitalsResult (Google PSI)
context/safe-fetch.ts     safeFetch(url, opts) — SSRF guard + timeouts
context/tls.ts            getTlsInfo — used by older probe code
```

### Inngest functions (`apps/web/inngest/functions/`)
```
sweep.ts                          monitor-sweep   cron '* * * * *'
uptime-probe.ts                   monitor-uptime  trigger 'scanlyfix/monitor.due' if type='uptime'
domain-probe.ts                   monitor-domain  trigger … if type='domain'
web-vitals-probe.ts               monitor-web-vitals trigger … if type='web_vitals'
scheduled-rescan.ts               trigger … if type='rescan'
rollup-worker.ts                  cron '5 * * * *'
auto-resolve-stale-incidents.ts  cron '0 6 * * *'
types.ts                          MonitorDueEvent, MonitoringDueEvent, TriggeredBy
```

### Web app — alerts (`apps/web/lib/`)
```
lib/inngest.ts                    inngest client + EVENTS map
lib/alert-email.ts                deliverAlert — primary email + fan-out to Slack/Discord/webhook
lib/alert-message.ts              render + renderSlack (pure)
lib/alert-threshold.ts            AlertConfigSchema, evaluateOutcome, parseAlertConfig,
                                  ALERT_PRESETS, resolveNotifyChannels, validateConfigSize
lib/header-encryption.ts          encryptValue/decryptValue, maskHeaders, prepareHeaders
lib/slack.ts                      sendSlack
lib/discord.ts                    sendDiscord, renderDiscord
lib/webhook.ts                    sendWebhook, buildWebhookPayload
lib/email.ts                      sendEmail (Resend HTTP API)
lib/status-subscriber-email.ts    notifyConfirmedSubscribersForMonitor
lib/web-vitals-thresholds.ts      evaluateVitals, formatVitalValue
```

### Web app — API (`apps/web/app/api/`)
```
monitors/[id]/uptime/route.ts           GET   uptime % + p95 latency
monitors/[id]/response-times/route.ts   GET   response time chart data
monitors/[id]/logs/route.ts             GET   recent events with diff
monitors/[id]/incidents/route.ts        GET   incidents with acknowledger
monitors/[id]/snooze/route.ts           GET/POST/DELETE
monitors/[id]/run/route.ts              POST  Phase 7.3 manual trigger
monitors/[id]/config/route.ts           GET/PATCH  alertConfig
monitors/[id]/monitoring/route.ts       GET   live SSL + domain for a domain monitor
monitors/[id]/maintenance-windows/      GET/POST/DELETE/PATCH
monitors/deploy-hook/route.ts           POST  CI webhook
incidents/[id]/ack/route.ts             POST
incidents/[id]/notes/route.ts           PATCH
incidents/[id]/updates/route.ts         POST  public timeline post
status/subscribe/route.ts               POST
status/confirm/route.ts                 GET
status/unsubscribe/route.ts             GET
onboarding/check/route.ts               POST  four parallel checks
inngest/route.ts                        GET/POST  Inngest registration
```

### Web app — UI (`apps/web/components/` + `apps/web/app/`)
```
components/monitors/monitor-list.tsx       multi-row table
components/monitors/monitor-row.tsx        one row, switch, interval
components/monitors/monitor-detail.tsx     single monitor view — RunCheckButton, SnoozeButton,
                                            stats, charts, recent checks, incidents, settings
components/monitors/monitoring-detail.tsx  domain monitor view — SSL/domain/DNS detail
components/monitors/run-check-button.tsx   Phase 7.3 manual trigger (client)
components/monitors/run-check-button-logic.ts pure polling helpers
components/monitors/snooze-button.tsx       snooze UI
components/monitors/monitor-settings.tsx    alertConfig form
components/monitors/status-dot.tsx          coloured dot for up/down/stale
components/monitors/uptime-badge.tsx       pill for the percent
components/monitors/uptime-chart.tsx       time-series uptime
components/monitors/uptime-days.ts         90-day daily strip
components/monitors/response-time-chart.tsx line chart for latency
components/monitors/diff-badge.tsx         per-row diff arrow
components/monitors/incidents-list.tsx     recent incidents
components/monitors/monitoring-detail.tsx  SSL/domain detail
components/monitors/snooze-button.tsx       snooze form
components/status/component-card.tsx       one component card
components/status/status-header.tsx        aggregated header
components/status/status-subscribe-form.tsx subscribe form
components/status/status-polish-helpers.ts formatLastUpdated
components/status/last-updated-indicator.tsx freshness + Refresh
components/status/project-maintenance-banner.tsx maintenance banner
components/status/incident-updates-timeline.tsx vertical timeline
components/status/uptime-strip.tsx         90-day calendar strip

app/(app)/monitors/page.tsx                list page
app/(app)/monitors/[id]/page.tsx           detail page (route)
app/(app)/monitors/[id]/actions.ts         toggle action
app/(app)/monitors/[id]/verify/            domain verification flow
app/(app)/incidents/[id]/page.tsx          incident detail page
app/(app)/status/[slug]/page.tsx            public status page (revalidate=60)
app/(app)/status/[slug]/loading.tsx         skeleton
app/(app)/onboarding/page.tsx               Phase 7.2 wizard shell
app/(app)/onboarding/loading.tsx           wizard skeleton
```

---

**Last reviewed:** against `git log` up to `feat/monitoring-enhancements`. If a file path here disagrees with the repo, the repo wins — and a one-line fix to this doc closes the gap.
