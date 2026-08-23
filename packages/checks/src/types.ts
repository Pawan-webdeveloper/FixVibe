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
    caa: string[]
    mx: string[]
    dnssec: boolean
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
  /** Crawled sub-pages (Phase 2 — absent in single-page scans). */
  pages?: Array<{ url: string; status: number; html: string }>
  /** PageSpeed Insights payload (Phase 2). */
  psi?: unknown
  /**
   * Fetch a same-origin path (e.g. "/.env", "/security.txt"). Memoised per path
   * and capped per scan so a misbehaving check cannot hammer the target.
   * Resolves to null on any network failure or when the cap is exhausted.
   */
  probe: (path: string) => Promise<{ status: number; body: string; headers: Headers } | null>
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
