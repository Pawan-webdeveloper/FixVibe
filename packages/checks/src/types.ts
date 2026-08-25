import type { CheerioAPI } from 'cheerio'

/** Ranked worst-first; scoring and CLI output both rely on this ordering. */
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export const SEVERITY_ORDER: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info']

/** The six score pillars. Every check belongs to exactly one. */
export type Category = 'security' | 'seo' | 'aeo' | 'performance' | 'accessibility' | 'compliance'

export interface ParsedCookie {
  name: string
  secure: boolean
  httpOnly: boolean
  /** Raw SameSite value as sent by the server ("Lax", "strict", …), null when absent. */
  sameSite: string | null
}

/**
 * Everything a check is allowed to know about the target, gathered in ONE pass
 * by buildContext(). Checks are pure functions over this object: they must not
 * fetch anything themselves — the single escape hatch is `probe()`, which is
 * rate-capped and SSRF-guarded by the context. This is what keeps a full scan
 * fast (one page fetch, N checks) and keeps every check trivially testable.
 */
export interface CheckContext {
  /** URL the user asked us to scan. */
  url: URL
  /** Where we actually landed after following redirects. */
  finalUrl: URL
  /** Every pre-final hop that answered with a redirect (empty when direct). */
  redirectChain: string[]
  status: number
  /** Response headers of the final hop (Fetch Headers, so lookups are case-insensitive). */
  headers: Headers
  html: string
  /** The parsed document — cheerio, loaded once, shared by every check. */
  $: CheerioAPI
  /**
   * Scripts found in the document. Inline scripts carry their `content`.
   * External ones carry their absolute `url`, and their `content` too when the
   * script belongs to the scanned site and was readable — a bundle on an
   * unrelated CDN, or one that failed to fetch, keeps an empty `content`.
   */
  scripts: Array<{ url: string; content: string }>
  cookies: ParsedCookie[]
  /** Peer-certificate summary; null for plain-HTTP targets or when the handshake failed. */
  tls: { validTo: Date; protocol: string; issuer: string } | null
  dns: {
    /** TXT records of the scanned hostname exactly as given. */
    txt: string[]
    /**
     * The CAA record set that actually governs certificate issuance for this
     * host, found by RFC 8659 §3's tree climb: the hostname first, then each
     * parent up to the registrable domain, stopping at the first name that
     * publishes any. `name` is the name that answered.
     *
     *   null                  — we could not determine it (resolver failure).
     *   { records: [] }       — we asked all the way up; there is genuinely none.
     *   { records: [...] }    — the governing set.
     *
     * A plain `string[]` here would be a false-positive machine: querying only
     * `www.example.com` and finding nothing says nothing at all, because the
     * policy that binds every CA lives one label up.
     */
    caa: { name: string; records: string[] } | null
    /**
     * Mail exchangers, best priority first. A NULL MX (RFC 7505's `MX 0 .`,
     * "this domain accepts no mail") is filtered out rather than reported as a
     * host, so an empty list means "no mail exchanger" either way.
     */
    mx: string[]
    /**
     * The domain SPF/DMARC records belong on — the hostname minus a "www."
     * prefix. null when it cannot be derived without a full Public Suffix
     * List, which is the email checks' signal to stay silent instead of
     * reporting on a name they never queried.
     */
    emailDomain: string | null
    /** TXT records at `emailDomain` — where SPF lives. Empty when it is null. */
    spfTxt: string[]
    /** TXT records at `_dmarc.<emailDomain>`. Empty when it is null. */
    dmarcTxt: string[]
    dkim: {
      /**
       * TXT records at `<selector>._domainkey.<emailDomain>`, keyed by
       * selector. Only well-known provider selectors are tried — a selector is
       * chosen by whoever signs the mail and cannot be enumerated from outside
       * — so an EMPTY map means "no selector we know of", never "no DKIM".
       */
      selectors: Record<string, string[]>
      /**
       * The record served by a wildcard `*._domainkey.<emailDomain>`, when one
       * exists. `selectors` is then empty by construction: under a wildcard
       * every name answers, so a "hit" on any selector proves nothing about a
       * key actually being in use. Usually `v=DKIM1; p=` — RFC 6376 §3.6.1's
       * way of saying "this domain signs nothing", which is a deliberate
       * configuration and not a defect.
       */
      wildcard: string[] | null
    }
    /**
     * Domain registration, from RDAP. null when the registry did not answer or
     * has no RDAP endpoint, which is common enough that its absence says
     * nothing about the domain.
     */
    registration: { expiresAt: string | null; registrar: string | null } | null
  }
  robots: {
    raw: string
    allows: (userAgent: string, path: string) => boolean
    /** Absolute URLs from `Sitemap:` lines, in file order (unparseable ones dropped). */
    sitemaps: string[]
  } | null
  /**
   * First response of `http://<host>/`, captured only when the scan itself never
   * observed plain HTTP (i.e. the user gave us an https URL). Lets the
   * https-redirect check verify the upgrade without guessing. null when port 80
   * did not answer.
   */
  httpProbe?: { status: number; location: string | null } | null
  /**
   * What a bounded same-origin crawl found, present only on a `deep` scan.
   *
   * Absent means the crawl never ran — NOT that the site has one page. Every
   * check reading this must stay silent when it is undefined, or a fast scan
   * would start reporting the absence of evidence it never went looking for.
   */
  crawl?: CrawlSummary
  /**
   * Fetch a same-origin path (e.g. "/.env", "/security.txt"). Memoised per path
   * and capped per scan so a misbehaving check cannot hammer the target.
   * Resolves to null on any network failure or when the cap is exhausted.
   */
  probe: (path: string) => Promise<{ status: number; body: string; headers: Headers } | null>
  /**
   * Fetch an ARBITRARY url, including a backend on someone else's
   * infrastructure — a Supabase project, a Firebase database.
   *
   * **Present only when the scan was authorised to test actively**, i.e. the
   * requester proved they control this domain (projects.verified_domain).
   * Its absence IS the gate, and that is the whole point of shaping it as a
   * capability instead of a `verifiedDomain: boolean`. A boolean has to be
   * consulted, and the check that forgets to consult it fails silently by
   * probing a stranger's database. A missing function cannot be forgotten:
   * the check that skips the guard does not compile.
   *
   * Probing an endpoint you do not own is unauthorised testing regardless of
   * how gentle the request is, so no check may reach for the network any other
   * way. SSRF-guarded and capped exactly like probe(); resolves to null on any
   * failure or once the budget is spent.
   */
  activeProbe?: (
    url: string,
    init?: { headers?: Record<string, string> },
  ) => Promise<{ status: number; body: string; headers: Headers } | null>
}

/**
 * The crawl's findings, as the checks see them. Mirrors CrawlResult in
 * context/crawl.ts; declared here so a check never has to import from the
 * context layer to read its own input.
 */
export interface CrawlSummary {
  /** Sub-pages whose HTML was kept, deduplicated by final url. Root excluded. */
  pages: Array<{ url: string; finalUrl: string; status: number; html: string }>
  /**
   * Requested url → the status it answered with, redirects followed. A url
   * ABSENT from this map is one we failed to reach, which means unknown — a
   * check must never read absence as a defect.
   */
  linkStatus: Record<string, number>
  /** Same-origin links on the root page, before any budget was applied. */
  linksFound: number
  /** Of those, how many the budget never let us request. */
  linksSkipped: number
  /** How many robots.txt told us not to fetch. Coverage we lack, never a defect. */
  linksDisallowed: number
}

/** One concrete problem found on the target. A check may emit zero or many. */
export interface Finding {
  checkId: string
  category: Category
  severity: Severity
  title: string
  description: string
  /** Raw observed values backing the claim — shown to the user, never guessed. */
  evidence?: Record<string, unknown>
  /** Human instructions: what to change and where. */
  remediation: string
  /** Copy-paste prompt for an AI coding agent to apply the fix. */
  fixPrompt: string
}

/**
 * A check that crashed or timed out — a bug in US (or a hostile page), never a
 * finding about the site. Lives here rather than in the registry because
 * scoring consumes it: a check that produced no findings because it died must
 * not be mistaken for a check that passed.
 */
export interface CheckError {
  checkId: string
  message: string
}

export interface Check {
  /** Stable, dot-namespaced id, e.g. "security.headers.csp". Never rename — it's a DB key. */
  id: string
  category: Category
  title: string
  run(ctx: CheckContext): Promise<Finding[]> | Finding[]
}

/** 0–100 per pillar plus the overall aggregate. */
export interface ScanScores {
  security: number
  seo: number
  aeo: number
  performance: number
  accessibility: number
  compliance: number
  overall: number
  /**
   * Pillars whose score is provisional because a check in them failed to
   * complete. The number is still the best available reading, but it was
   * measured with an instrument that was partly broken, so every surface that
   * displays it — and every feature that compares it — must say so.
   *
   * Stored with the scan rather than recomputed on read: which pillar a check
   * belonged to is a fact about the registry at scan time, and that registry
   * will have changed by the time anyone looks.
   */
  degraded: Category[]
}
