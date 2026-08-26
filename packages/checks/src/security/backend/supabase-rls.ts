/**
 * Supabase Row Level Security — is the database actually protected, or is the
 * public API key enough to read it?
 *
 * The Supabase anon/publishable key is designed to ship in a browser bundle.
 * Finding it is not a finding, and reporting it as one would be wrong on every
 * Supabase site ever built. (A *service-role* key in a bundle is a different
 * matter entirely, and `security.secrets.js` already reports that.) The key is
 * safe precisely because Postgres row-level security is supposed to stand
 * behind it. When RLS is off, or a policy reads `USING (true)`, that same
 * public key reads the table — and the most common way a Supabase app leaks
 * its user table is a migration that created it without enabling RLS.
 *
 * Whether that is true cannot be inferred from the page. It has to be asked.
 * So this check runs ONLY when `ctx.activeProbe` exists, which the context
 * hands out only for a domain the requester has proved they control. On any
 * other scan the capability is absent and this check cannot run at all.
 *
 * ## No row is ever read
 *
 * Readability is determined with `?select=*&limit=0` plus `Prefer:
 * count=exact`: PostgREST runs the count under the caller's RLS policies and
 * reports it in `Content-Range`, while the body comes back empty. A non-zero
 * count means the anonymous key can see rows; zero means it cannot. We learn
 * the answer without receiving a single value.
 *
 * Column names come from the project's own OpenAPI document, not from data.
 * Nothing in this check's evidence originates in a table row — the report is
 * stored in our database and may be shared, and a scanner that copies its
 * customer's user records into a shareable page has become the breach.
 *
 * An empty table is indistinguishable from a protected one here, and that is
 * the right way round: this check under-reports rather than accuses.
 */

import type { Check, CheckContext, Finding } from '../../types.ts'
import { collect, sources } from './sources.ts'

const ID = 'security.backend.supabase-rls'

/** `https://<ref>.supabase.co` — the project ref is 20 lowercase letters. */
const PROJECT_URL = /https?:\/\/([a-z]{20})\.supabase\.co/g
/**
 * A project ref is exactly twenty lowercase letters, and this is enforced
 * before the value is ever interpolated into a URL.
 *
 * The ref can come from a JWT payload, which is base64 the page under scan
 * chose — it is NOT a trusted value just because it decoded. A ref of
 * `"attacker.example/"` turns `https://${ref}.supabase.co/rest/v1` into a URL
 * whose host is attacker.example, and the scanner would then send the key in
 * an Authorization header to a stranger and write whatever they answered into
 * a finding as though it were the customer's own database.
 */
const PROJECT_REF = /^[a-z]{20}$/
/** Modern publishable key format (`sb_publishable_…`), which carries no claims. */
const PUBLISHABLE_KEY = /(sb_publishable_[A-Za-z0-9_-]{16,})/g
/** Legacy anon key: a JWT whose payload claims role "anon". */
const JWT = /(eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g

/** Tables probed per scan. The active-probe budget is 12; the spec fetch takes one. */
const MAX_TABLES = 8

/**
 * Column names that make an exposed table a breach rather than a design
 * decision. A public `posts` table is a blog; a public table with `email` and
 * `stripe_customer_id` columns is an incident. Matched as substrings of the
 * lowercased column name, so `user_email` and `emailAddress` both count.
 */
const ALWAYS_SENSITIVE: ReadonlySet<string> = new Set([
  'email', 'password', 'passwd', 'ssn', 'passport', 'iban', 'salary',
  'dob', 'birthdate', 'phone', 'mobile', 'creditcard',
])

/**
 * Words that mean something sensitive on their own but are ordinary inside a
 * longer name. `token` is a credential; `token_count` is a usage metric.
 * `card` is a payment method; `cardinality` and `discarded_at` are not.
 * Matched only when the whole column name reduces to one of these.
 */
const SENSITIVE_ALONE: ReadonlySet<string> = new Set([
  'token', 'secret', 'apikey', 'address', 'zip', 'postcode',
  'card', 'cardnumber', 'nationalid', 'taxid', 'invoice',
])

/**
 * Words that only mean "sensitive" next to another one. `stripe` alone is on
 * every Supabase starter's public `products` and `prices` tables; paired with
 * `customer` it is a person.
 */
const SENSITIVE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['stripe', 'customer'],
  ['billing', 'address'],
  ['home', 'address'],
  ['credit', 'card'],
  ['card', 'number'],
  ['social', 'security'],
  ['date', 'birth'],
  ['api', 'key'],
  ['access', 'token'],
  ['refresh', 'token'],
  ['auth', 'token'],
  ['reset', 'token'],
  ['zip', 'code'],
  ['postal', 'code'],
]

interface Project {
  ref: string
  key: string
}

interface TableReport {
  table: string
  rows: number
  sensitiveColumns: string[]
}

export const supabaseRlsCheck: Check = {
  id: ID,
  category: 'security',
  title: 'Supabase row-level security',

  async run(ctx) {
    // The gate. Without proof of domain ownership there is no capability to
    // call, so an unauthorised scan cannot reach anyone's database from here.
    const activeProbe = ctx.activeProbe
    if (!activeProbe) return []

    const project = findProject(ctx)
    // Re-checked at the point of use, not only where it was parsed: this value
    // becomes the HOST of every request this check makes.
    if (!project || !isProjectRef(project.ref)) return []

    const base = `https://${project.ref}.supabase.co/rest/v1`
    const auth = { apikey: project.key, authorization: `Bearer ${project.key}` }

    const spec = await activeProbe(`${base}/`, {
      headers: { ...auth, accept: 'application/openapi+json' },
    })
    if (!spec || spec.status !== 200) return [] // project gone, key rejected, or network trouble

    const tables = parseTables(spec.body)
    if (tables.size === 0) return []

    const names = [...tables.keys()].sort()
    const tested = names.slice(0, MAX_TABLES)

    const probed = await Promise.all(
      tested.map(async (table): Promise<TableReport | null | 'unknown'> => {
        const rows = await countVisibleRows(activeProbe, base, auth, table)
        if (rows === null) return 'unknown' // timed out, refused, or unparseable
        if (rows === 0) return null
        return { table, rows, sensitiveColumns: sensitiveIn(tables.get(table) ?? []) }
      }),
    )

    const reports = probed.filter((report): report is TableReport => report !== null && report !== 'unknown')
    const unreadable = probed.filter((report) => report === 'unknown').length

    const coverage = {
      project: project.ref,
      tablesInSchema: names.length,
      tablesTested: tested,
      // Stated explicitly: a report that silently tested 8 of 40 tables reads
      // as "your database is fine" when it means "the 8 we looked at are".
      ...(names.length > tested.length ? { notTested: names.length - tested.length } : {}),
    }

    if (reports.length > 0) return [exposedDataFinding(ctx, coverage, reports)]

    // "Nothing was readable" is a claim about tables we actually managed to
    // ask about. If a request timed out or was refused we did not learn that
    // the table is protected, and saying "row-level security is doing its job"
    // off a failed request would be the exact inversion of this engine's rule.
    // Silence instead — and a scan that flapped between the two would also
    // move the score by 27 points and mail the customer about it.
    if (unreadable > 0) return []

    return [schemaOnlyFinding(coverage, names)]
  },
}

function exposedDataFinding(
  ctx: CheckContext,
  coverage: Record<string, unknown>,
  reports: readonly TableReport[],
): Finding {
  const sensitive = reports.filter((report) => report.sensitiveColumns.length > 0)
  const list = reports.map((report) => `${report.table} (${report.rows} row(s))`).join(', ')

  return {
    checkId: ID,
    category: 'security',
    // Any anonymously readable table is worth `high`: it may be intended, but
    // it is a decision someone must confirm. Personal-data columns make it an
    // incident, and that judgement rests on column names we read from the
    // project's own schema document, not on a guess.
    severity: sensitive.length > 0 ? 'critical' : 'high',
    title:
      sensitive.length > 0
        ? `Personal data readable by anyone: ${sensitive.map((report) => report.table).join(', ')}`
        : `${reports.length} Supabase table(s) readable by anyone`,
    description:
      `Using only the publishable key from this site's own JavaScript — which anybody can copy out ` +
      `of the bundle — the Supabase REST API returned row counts for ${list}. That means row-level ` +
      'security is disabled on those tables, or a policy grants the anon role access. ' +
      (sensitive.length > 0
        ? `Their columns include ${sensitive
            .flatMap((report) => report.sensitiveColumns)
            .slice(0, 8)
            .join(', ')}, so this is personal or financial data available to anyone who views the ` +
          'page source. Treat it as a live disclosure, not a hardening task.'
        : 'Some tables are meant to be public — a blog’s posts, a product catalogue. Confirm each of ' +
          'these is one of them.'),
    // Row counts and column names only. Nothing here came out of a table row.
    evidence: { ...coverage, readable: reports },
    remediation:
      'Enable row-level security on each table that is not deliberately public, then add policies ' +
      'granting only what each role needs. Rotate the key afterwards if data was exposed.',
    fixPrompt:
      `The Supabase project behind ${ctx.finalUrl.origin} returns data to the anonymous publishable ` +
      `key for: ${list}. Row-level security is off, or a policy allows the anon role.\n\n` +
      'This is a database change, not an application change. In a new SQL migration in this ' +
      'repository (do not edit an applied migration), for every table that is not deliberately ' +
      'public:\n\n' +
      '  ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;\n\n' +
      'Then add the policies the app actually needs, scoped to the authenticated user, e.g.:\n\n' +
      '  CREATE POLICY "<table>_select_own" ON public.<table>\n' +
      '    FOR SELECT TO authenticated USING (auth.uid() = user_id);\n\n' +
      'Enabling RLS with no policy denies everything, so add the policies in the same migration and ' +
      'check every read path in the client still works. Review any table you intend to leave ' +
      'public and write a comment in the migration saying why.' +
      (sensitive.length > 0
        ? '\n\nPersonal data was reachable, so also rotate the project API keys in the Supabase ' +
          'dashboard and check the project logs for who has been reading these tables.'
        : ''),
  }
}

function schemaOnlyFinding(coverage: Record<string, unknown>, names: readonly string[]): Finding {
  return {
    checkId: ID,
    category: 'security',
    // RLS is doing its job. What remains is that the shape of the database is
    // public, which is minor but real — and worth saying, because it is the
    // evidence that we looked and found nothing worse.
    severity: 'low',
    title: `Supabase schema is public (${names.length} tables), but no data was readable`,
    description:
      'The publishable key from this site returns the project’s full OpenAPI document, so every ' +
      'table, view and column name is public. No table we tested returned any rows to the anonymous ' +
      'key, which means row-level security is doing its job. The schema itself still tells an ' +
      'attacker exactly what to aim at, and names like "internal_notes" or "admin_users" narrow the ' +
      'search considerably.',
    evidence: { ...coverage, tables: names.slice(0, 40) },
    remediation:
      'Move tables that no browser needs into a schema that is not exposed by the API, leaving only ' +
      'the ones the client actually queries in the public schema.',
    fixPrompt:
      'The Supabase project behind this site exposes its full schema through the REST API to the ' +
      `anonymous key: ${names.slice(0, 25).join(', ')}. Row-level security is working — no rows were ` +
      'readable — so this is hardening, not an incident.\n\n' +
      'In a new SQL migration, move any table the browser never queries directly out of the "public" ' +
      'schema (for example into a "private" schema) and revoke access from the anon and authenticated ' +
      'roles:\n\n' +
      '  CREATE SCHEMA IF NOT EXISTS private;\n' +
      '  ALTER TABLE public.<table> SET SCHEMA private;\n' +
      '  REVOKE ALL ON ALL TABLES IN SCHEMA private FROM anon, authenticated;\n\n' +
      'Anything only server-side code touches (service-role key, edge functions, RPC) can move. ' +
      'Check each table against the client code in this repository before moving it — a table the ' +
      'browser selects from will break.',
  }
}

/**
 * The project this page talks to. When the bundle carries both a JWT anon key
 * and a project URL, the key's own `ref` claim decides which project it
 * belongs to rather than pairing whichever appeared first — a page may
 * reference more than one Supabase project.
 */
function findProject(ctx: CheckContext): Project | null {
  const texts = sources(ctx)
  const refs = collect(texts, PROJECT_URL)

  for (const token of collect(texts, JWT)) {
    const claims = decodeJwt(token)
    if (claims?.['role'] !== 'anon') continue // service-role keys are secrets.js's problem
    const claimed = claims['ref']
    // The claim is only believed when it looks like a project ref. Anything
    // else falls back to a ref parsed out of a supabase.co URL, which the
    // pattern already constrained.
    const ref = typeof claimed === 'string' && PROJECT_REF.test(claimed) ? claimed : refs[0]
    if (ref) return { ref, key: token }
  }

  // Publishable keys carry no claims, so they need a URL to pair with.
  const publishable = collect(texts, PUBLISHABLE_KEY)[0]
  const ref = refs[0]
  if (publishable && ref) return { ref, key: publishable }

  return null
}

/** Belt and braces: nothing reaches a request URL without passing this. */
function isProjectRef(ref: string): boolean {
  return PROJECT_REF.test(ref)
}

function decodeJwt(token: string): Record<string, unknown> | null {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Table → column names, from the project's Swagger/OpenAPI document. Supabase
 * serves Swagger 2.0 (`definitions`); the OpenAPI 3 shape is accepted too so a
 * PostgREST upgrade does not silently blind this check.
 */
function parseTables(body: string): Map<string, string[]> {
  const tables = new Map<string, string[]>()
  let document: unknown
  try {
    document = JSON.parse(body)
  } catch {
    return tables
  }

  const root = document as { definitions?: unknown; components?: { schemas?: unknown } }
  const schemas = (root.definitions ?? root.components?.schemas) as
    | Record<string, { properties?: Record<string, unknown> }>
    | undefined
  if (!schemas || typeof schemas !== 'object') return tables

  for (const [name, schema] of Object.entries(schemas)) {
    // PostgREST also emits RPC argument schemas; those are not tables.
    if (name.startsWith('(') || name.includes('.')) continue
    tables.set(name, Object.keys(schema?.properties ?? {}))
  }
  return tables
}

/**
 * Rows the anonymous key can see, or null when the API did not tell us.
 *
 * `limit=0` means no row is ever transferred; `Prefer: count=exact` makes
 * PostgREST run the count under the caller's RLS policies and report it in
 * the `Content-Range` response header, after the slash. A 401/403/404 answer,
 * or a header we cannot parse, is null — unknown, which this check treats as
 * nothing to report.
 */
async function countVisibleRows(
  activeProbe: NonNullable<CheckContext['activeProbe']>,
  base: string,
  auth: Record<string, string>,
  table: string,
): Promise<number | null> {
  const response = await activeProbe(`${base}/${encodeURIComponent(table)}?select=*&limit=0`, {
    headers: { ...auth, prefer: 'count=exact' },
  })
  if (!response || (response.status !== 200 && response.status !== 206)) return null

  // Values look like "0-0/1234", or end in "/*" when the server declined to count.
  const total = response.headers.get('content-range')?.split('/')[1]
  if (!total || total === '*') return null
  const count = Number(total)
  return Number.isFinite(count) ? count : null
}

/**
 * Columns that make an exposed table an incident rather than a design choice.
 *
 * Matched on WORD TOKENS in three tiers, never as substrings. Substring
 * matching was the first implementation and it is a false-positive engine:
 * `discarded_at` contains "card", `wildcard_domain` contains "card",
 * `token_count` contains "token", `zip_path` contains "zip", and a public
 * `prices` table with a `stripe_price_id` was escalated to a critical
 * "Personal data readable by anyone — rotate your API keys". Every one of
 * those tells a customer they have a breach when they have a pricing page.
 */
function sensitiveIn(columns: readonly string[]): string[] {
  return columns.filter((column) => {
    const words = tokenize(column)
    if (words.length === 0) return false

    // Tier 1: unambiguous wherever it appears — user_email, emailAddress, email.
    if (words.some((word) => ALWAYS_SENSITIVE.has(word))) return true
    // Tier 2: only when it IS the column — `token`, `card_number`, not `token_count`.
    if (SENSITIVE_ALONE.has(words.join(''))) return true
    // Tier 3: a pair that changes the meaning — stripe + customer.
    return SENSITIVE_PAIRS.some(([a, b]) => words.includes(a) && words.includes(b))
  })
}

/** `stripe_customer_id` / `stripeCustomerId` / `StripeCustomerID` → ['stripe','customer','id']. */
function tokenize(column: string): string[] {
  return column
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .map((word) => word.toLowerCase())
    .filter(Boolean)
}
