/**
 * Darvin database schema (Drizzle / Postgres).
 *
 * Design rule: this schema is a *projection of the engine's types*, not an
 * independent model. Every field `@darvin/checks` produces — each `Finding`
 * property, each `ScanScores` pillar — has a column or a typed jsonb slot here.
 * If the two drift, a scan silently loses data between "computed" and "stored",
 * so the severity/category enums below are compile-time locked to the unions in
 * `packages/checks/src/types.ts`.
 *
 * Identity: `users` mirrors Supabase `auth.users`. Supabase Auth owns
 * credentials; this table only carries the app-level row everything else
 * foreign-keys to.
 */

import type { Category, ScanScores, Severity } from '@darvin/checks'
import { desc, relations } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/* -------------------------------------------------------------------------- */
/* Enums                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Fails to compile if a Postgres enum and its engine union stop matching in
 * *either* direction — a new `Severity` with no column value, or a column value
 * the engine can never emit. Both corrupt scoring, so catch it at build time.
 */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never

const SEVERITY_VALUES = ['critical', 'high', 'medium', 'low', 'info'] as const
const CATEGORY_VALUES = ['security', 'seo', 'aeo', 'performance', 'accessibility', 'compliance'] as const

export const _severityLocked: Exact<Severity, (typeof SEVERITY_VALUES)[number]> = true
export const _categoryLocked: Exact<Category, (typeof CATEGORY_VALUES)[number]> = true

export const severityEnum = pgEnum('severity', SEVERITY_VALUES)
export const categoryEnum = pgEnum('category', CATEGORY_VALUES)

/** Scan lifecycle. Mirrors the Inngest step sequence, so 'queued' — not 'pending'. */
export const scanStatusEnum = pgEnum('scan_status', ['queued', 'running', 'done', 'failed'])

/**
 * How deep a scan went. `fast` is HTTP-only and runs inline; `deep` adds the
 * headless browser, PageSpeed and a crawl, and runs on the queue.
 *
 * This is a comparability key, not a label. A deep scan surfaces findings a
 * fast scan cannot see, so its score is legitimately lower for an unchanged
 * site — charting the two on one line would show a drop that never happened.
 */
export const scanProfileEnum = pgEnum('scan_profile', ['fast', 'deep'])

/** User-controlled triage state; drives the "3 fixed, 1 new" re-scan diff. */
export const findingStatusEnum = pgEnum('finding_status', ['open', 'fixed', 'ignored'])

/** The three cron kinds that share the `monitors` table. */
export const monitorTypeEnum = pgEnum('monitor_type', ['uptime', 'rescan', 'domain'])

export const memberRoleEnum = pgEnum('member_role', ['owner', 'admin', 'member'])
export const alertChannelEnum = pgEnum('alert_channel', ['email', 'webhook'])
export const reportFormatEnum = pgEnum('report_format', ['pdf', 'md'])

/* -------------------------------------------------------------------------- */
/* jsonb payload shapes                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Storable summary of the `CheckContext` a scan ran against. jsonb rather than
 * columns because it is display/debug metadata, never a query predicate.
 * `framework` is the one field the product leans on: stack-aware fix prompts
 * are selected from it.
 */
export interface ScanContextMeta {
  finalUrl: string
  redirectChain: string[]
  status: number
  framework: string | null
  /**
   * Where the site is served from — Vercel, Netlify, Cloudflare, nginx.
   * Stored alongside `framework` because it is the field that decides where
   * response headers are configured, and for a header fix that matters more
   * than which framework rendered the page.
   */
  platform: string | null
  /** ISO-8601 — jsonb has no Date type, so it round-trips as a string. */
  tlsExpiry: string | null
}

/* -------------------------------------------------------------------------- */
/* Identity                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * App-level user row.
 *
 * `id` is the APPLICATION's own identifier and is generated here. It used to be
 * copied from Supabase `auth.users.id`, which made the primary key of six
 * tables a foreign vendor's identifier — and moving to Convex would then have
 * meant migrating every one of them. `authSubject` carries the provider's id
 * instead, so the next swap is one column rather than a schema rewrite.
 *
 * No password or name columns. The identity provider owns credentials, and a
 * duplicated credential is a liability with no upside.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /**
   * The identity provider's stable id for this person — a Convex user id today.
   *
   * Unique, so two app rows can never claim one identity. Nullable only so the
   * column could be added to an existing table; every row written since carries
   * one, and getViewer refuses anyone it cannot match.
   *
   * Deliberately NOT the email. An email changes, and an account keyed on one
   * silently becomes a different account the day it does.
   */
  authSubject: text('auth_subject').unique(),
  email: text('email').notNull().unique(),
  /**
   * The pillars this person said they care about, asked once after their first
   * sign-in. Typed as the engine's own Category enum rather than free text, so
   * a pillar cannot be stored that no check will ever report on.
   *
   * NULL and [] mean different things and both are load-bearing:
   *   null  — never asked. This is what sends someone to /welcome.
   *   [...] — asked and answered. "All of it" stores every category, so the
   *           report logic stays one rule instead of a special case.
   */
  priorities: categoryEnum('priorities').array(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Team container for the top tier. Present from day one so adding teams later is not a migration of every FK. */
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const memberships = pgTable(
  'memberships',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: memberRoleEnum('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Composite PK: a user belongs to an org at most once, enforced by the DB
  // rather than by application code a concurrent insert can slip past.
  (t) => [primaryKey({ columns: [t.orgId, t.userId] }), index('memberships_user_idx').on(t.userId)],
)

/* -------------------------------------------------------------------------- */
/* Projects                                                                   */
/* -------------------------------------------------------------------------- */

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Null for personal projects; set once the project moves into a team. */
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    url: text('url').notNull(),
    /** Public handle for /status/[slug] — never put the UUID in a shareable URL. */
    slug: text('slug').notNull().unique(),
    /** "nextjs" | "vite" | … — cached detection that picks the fix-prompt template variant. */
    frameworkHint: text('framework_hint'),
    /**
     * Ownership proof (DNS TXT / meta tag / file). This flag is the gate for
     * anything active: passive checks run against any URL, intrusive ones only
     * here. Scanning a site you do not own with active payloads is unauthorised
     * testing, so the gate is data, not a code path.
     */
    verifiedDomain: boolean('verified_domain').notNull().default(false),
    /**
     * The secret half of the DNS proof: the value the owner publishes at
     * `_darvin.<host>`. Generated once per project and kept afterwards — a
     * token that rotated on every visit would invalidate a record somebody had
     * already added and was waiting to propagate.
     *
     * Unguessable on purpose. Anyone who can predict it can claim a domain
     * they do not control, and what that unlocks is permission to probe
     * somebody's Supabase and Firebase.
     */
    verificationToken: text('verification_token'),
    /**
     * When the proof was last confirmed. Domains change hands, and a flag with
     * no date behind it says "verified" forever — so the moment is recorded,
     * and a re-verification sweep has something to read.
     */
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('projects_owner_idx').on(t.ownerId), index('projects_org_idx').on(t.orgId)],
)

/* -------------------------------------------------------------------------- */
/* Scans                                                                      */
/* -------------------------------------------------------------------------- */

export const scans = pgTable(
  'scans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Null for anonymous landing-page scans, which belong to no project. */
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    /** Null when anonymous. `set null` keeps the scan's audit trail if the user is deleted. */
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
    /** Hashed, never raw — anonymous abuse forensics without storing a PII address. */
    anonIpHash: text('anon_ip_hash'),
    /**
     * The scanned URL lives on the scan, not only on the project: an anonymous
     * scan has no project, and a project's URL can change without rewriting
     * history.
     */
    url: text('url').notNull(),
    /**
     * Hostname of `url`, denormalised because the per-target rate limit counts
     * scans of a SITE, not of a URL. Limiting on the full URL is no limit at
     * all: /1, /2, /3 are three different strings pointing at one server.
     */
    targetHost: text('target_host').notNull(),
    profile: scanProfileEnum('profile').notNull().default('fast'),
    status: scanStatusEnum('status').notNull().default('queued'),
    /** Set when the worker picks the job up — distinct from `createdAt` (enqueued). */
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** Denormalised wall-clock so the sub-45 s target stays measurable without a join. */
    durationMs: integer('duration_ms'),
    /** Written once at the scoring step; avoids re-aggregating findings on every page view. */
    scores: jsonb('scores').$type<ScanScores>(),
    contextMeta: jsonb('context_meta').$type<ScanContextMeta>(),
    /**
     * Which engine produced this reading. Every feature that subtracts one scan
     * from another must refuse to compare across a change in it — otherwise the
     * day you ship new checks, every monitored customer is told their site got
     * worse. Not nullable and not backfillable: a row without it can never be
     * compared to anything, so there is no useful default to invent later.
     */
    engineVersion: text('engine_version').notNull(),
    /** Denominator for "17 of 29 checks could run" and a second comparability signal. */
    checksRun: integer('checks_run').notNull(),
    /**
     * Checks that crashed or timed out. Our bugs, not the site's — kept so a
     * support question about a moved score has an answer, and so the scan can
     * show which pillars were only partly measured.
     */
    checkErrors: jsonb('check_errors')
      .$type<Array<{ checkId: string; message: string }>>()
      .notNull()
      .default([]),
    /** Failure reason (SsrfError, SafeFetchError, timeout…). Meaningful only when status = 'failed'. */
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Project scan history, newest first — the dashboard's hot query.
    index('scans_project_created_idx').on(t.projectId, desc(t.createdAt)),
    // The queue sweep: everything still 'queued' or stuck in 'running'.
    index('scans_status_idx').on(t.status),
    // Two hot reads share this shape: the short-TTL dedup lookup ("has this URL
    // been scanned at this depth recently?") and the diff's "previous scan of
    // the same URL at the same depth".
    index('scans_url_profile_created_idx').on(t.url, t.profile, desc(t.createdAt)),
    // The two rate-limit counters, both of which run on every scan request:
    // "how much has this visitor asked for lately" and "how much has this site
    // been asked about lately, by anyone".
    index('scans_anon_ip_created_idx').on(t.anonIpHash, desc(t.createdAt)),
    index('scans_target_host_created_idx').on(t.targetHost, desc(t.createdAt)),
  ],
)

/**
 * One row per `Finding` the engine emits — same field names, same semantics.
 * `remediation` and `fixPrompt` are not extras: they are the paid product, so
 * they persist with the finding instead of being regenerated on read.
 */
export const findings = pgTable(
  'findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scanId: uuid('scan_id')
      .notNull()
      .references(() => scans.id, { onDelete: 'cascade' }),
    /** Stable dot-namespaced id, e.g. "security.headers.hsts". Join key for scan-to-scan diffs — never rename. */
    checkId: text('check_id').notNull(),
    category: categoryEnum('category').notNull(),
    severity: severityEnum('severity').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    /** Raw observed values backing the claim. Shape varies per check, hence jsonb. */
    evidence: jsonb('evidence').$type<Record<string, unknown>>(),
    remediation: text('remediation').notNull(),
    fixPrompt: text('fix_prompt').notNull(),
    status: findingStatusEnum('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The results page reads exactly this: one scan's findings, worst-first.
    index('findings_scan_severity_idx').on(t.scanId, t.severity),
    // Score diffing joins the previous scan on check_id.
    index('findings_scan_check_idx').on(t.scanId, t.checkId),
  ],
)

/* -------------------------------------------------------------------------- */
/* Monitoring                                                                 */
/* -------------------------------------------------------------------------- */

export const monitors = pgTable(
  'monitors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    type: monitorTypeEnum('type').notNull(),
    /**
     * Seconds, not minutes — uptime's floor is 60 s and domain expiry runs
     * daily, so minutes cannot express both ends of the range.
     */
    intervalS: integer('interval_s').notNull().default(3600),
    enabled: boolean('enabled').notNull().default(true),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastStatus: text('last_status'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One monitor per kind per project: duplicates would silently double the
    // cron invocations (and the bill) for zero extra signal.
    uniqueIndex('monitors_project_type_idx').on(t.projectId, t.type),
    // The cron sweep's query: enabled monitors, least-recently-run first.
    index('monitors_due_idx').on(t.enabled, t.lastRunAt),
  ],
)

/** Append-only probe log. Powers the public status page and latency history. */
export const monitorEvents = pgTable(
  'monitor_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    monitorId: uuid('monitor_id')
      .notNull()
      .references(() => monitors.id, { onDelete: 'cascade' }),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
    ok: boolean('ok').notNull(),
    statusCode: integer('status_code'),
    latencyMs: integer('latency_ms'),
    detail: text('detail'),
  },
  (t) => [index('monitor_events_monitor_ts_idx').on(t.monitorId, desc(t.ts))],
)

/**
 * Delivery log, not configuration — one row per alert dispatched. A null
 * `sentAt` means queued or failed, which is what lets a retry be idempotent.
 */
export const alerts = pgTable(
  'alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** "uptime_down" | "score_drop" | "domain_expiring" | "tls_expiring" — open-ended, so text. */
    kind: text('kind').notNull(),
    channel: alertChannelEnum('channel').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('alerts_project_created_idx').on(t.projectId, desc(t.createdAt))],
)

/* -------------------------------------------------------------------------- */
/* Access & billing                                                           */
/* -------------------------------------------------------------------------- */

/**
 * API keys are credentials: only the hash is stored. The plaintext is shown
 * once at creation and never again, so a database dump cannot be replayed
 * against the API.
 *
 * SHA-256, deliberately, where a password would get bcrypt. A password is
 * short and human-chosen, so a fast hash is brute-forceable and a slow one is
 * the whole defence. A key here is 256 bits from a CSPRNG — unreachable by
 * brute force at any hash speed — and it arrives on EVERY API request, where a
 * 100 ms KDF would be a self-inflicted rate limit.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** User-facing label ("CI", "laptop") — the only way to identify a key after creation. */
    name: text('name'),
    /**
     * The first few characters of the plaintext, kept in the clear so a key
     * found in a CI log can be matched to a row and revoked. Without it the
     * list is names and dates, and an account with two keys called "CI" has no
     * way to tell which one leaked — so it revokes both, or neither.
     *
     * Safe to store: it exposes a known-length slice of a 256-bit secret and
     * leaves the rest unguessable. It is not a lookup key — `keyHash` is.
     */
    prefix: text('prefix'),
    keyHash: text('key_hash').notNull().unique(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('api_keys_user_idx').on(t.userId)],
)

/**
 * Stripe mirror, keyed by user because a user has exactly one subscription.
 * `plan` and `status` stay `text`: Stripe's status vocabulary (trialing,
 * past_due, incomplete_expired, …) grows and tier names get rebranded — an enum
 * there means an ALTER TYPE every time pricing changes.
 */
export const subscriptions = pgTable('subscriptions', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /**
   * Provider-neutral on purpose. These held `stripe_` names until billing
   * moved to Razorpay, and renaming a column across a live table to follow a
   * vendor is a migration nobody wants to run twice. What the product needs to
   * know is "which customer at whichever processor we use", and that does not
   * change when the processor does.
   *
   * Null until the first payment — a free account never reaches the processor.
   */
  billingCustomerId: text('billing_customer_id').unique(),
  /** Webhooks arrive keyed by this; needed to map an event back to a user. */
  billingSubscriptionId: text('billing_subscription_id').unique(),
  plan: text('plan').notNull().default('free'),
  status: text('status').notNull().default('active'),
  periodEnd: timestamp('period_end', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Generated PDF/Markdown exports; the file itself lives in Supabase Storage. */
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scanId: uuid('scan_id')
      .notNull()
      .references(() => scans.id, { onDelete: 'cascade' }),
    format: reportFormatEnum('format').notNull(),
    storagePath: text('storage_path').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('reports_scan_idx').on(t.scanId)],
)

/* -------------------------------------------------------------------------- */
/* Relations — required for the `db.query.*` API. `.references()` alone only   */
/* emits the SQL constraint; it does not teach Drizzle how to join.           */
/* -------------------------------------------------------------------------- */

export const usersRelations = relations(users, ({ one, many }) => ({
  projects: many(projects),
  memberships: many(memberships),
  apiKeys: many(apiKeys),
  ownedOrganizations: many(organizations),
  subscription: one(subscriptions),
}))

export const organizationsRelations = relations(organizations, ({ one, many }) => ({
  owner: one(users, { fields: [organizations.ownerId], references: [users.id] }),
  memberships: many(memberships),
  projects: many(projects),
}))

export const membershipsRelations = relations(memberships, ({ one }) => ({
  organization: one(organizations, { fields: [memberships.orgId], references: [organizations.id] }),
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
}))

export const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(users, { fields: [projects.ownerId], references: [users.id] }),
  organization: one(organizations, { fields: [projects.orgId], references: [organizations.id] }),
  scans: many(scans),
  monitors: many(monitors),
  alerts: many(alerts),
}))

export const scansRelations = relations(scans, ({ one, many }) => ({
  project: one(projects, { fields: [scans.projectId], references: [projects.id] }),
  requester: one(users, { fields: [scans.requestedBy], references: [users.id] }),
  findings: many(findings),
  reports: many(reports),
}))

export const findingsRelations = relations(findings, ({ one }) => ({
  scan: one(scans, { fields: [findings.scanId], references: [scans.id] }),
}))

export const monitorsRelations = relations(monitors, ({ one, many }) => ({
  project: one(projects, { fields: [monitors.projectId], references: [projects.id] }),
  events: many(monitorEvents),
}))

export const monitorEventsRelations = relations(monitorEvents, ({ one }) => ({
  monitor: one(monitors, { fields: [monitorEvents.monitorId], references: [monitors.id] }),
}))

export const alertsRelations = relations(alerts, ({ one }) => ({
  project: one(projects, { fields: [alerts.projectId], references: [projects.id] }),
}))

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, { fields: [apiKeys.userId], references: [users.id] }),
}))

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  user: one(users, { fields: [subscriptions.userId], references: [users.id] }),
}))

export const reportsRelations = relations(reports, ({ one }) => ({
  scan: one(scans, { fields: [reports.scanId], references: [scans.id] }),
}))

/* -------------------------------------------------------------------------- */
/* Inferred row types — import these instead of hand-writing DTOs.            */
/* -------------------------------------------------------------------------- */

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Organization = typeof organizations.$inferSelect
export type NewOrganization = typeof organizations.$inferInsert
export type Membership = typeof memberships.$inferSelect
export type NewMembership = typeof memberships.$inferInsert
export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
/** 'fast' | 'deep' — the enum's values, so callers never retype the union. */
export type ScanProfile = (typeof scanProfileEnum.enumValues)[number]

export type Scan = typeof scans.$inferSelect
export type NewScan = typeof scans.$inferInsert
/** Persisted finding row. Distinct from `@darvin/checks`'s in-memory `Finding`. */
export type FindingRow = typeof findings.$inferSelect
export type NewFindingRow = typeof findings.$inferInsert
export type Monitor = typeof monitors.$inferSelect
export type NewMonitor = typeof monitors.$inferInsert
export type MonitorEvent = typeof monitorEvents.$inferSelect
export type NewMonitorEvent = typeof monitorEvents.$inferInsert
export type Alert = typeof alerts.$inferSelect
export type NewAlert = typeof alerts.$inferInsert
export type ApiKey = typeof apiKeys.$inferSelect
export type NewApiKey = typeof apiKeys.$inferInsert
export type Subscription = typeof subscriptions.$inferSelect
export type NewSubscription = typeof subscriptions.$inferInsert
export type Report = typeof reports.$inferSelect
export type NewReport = typeof reports.$inferInsert
