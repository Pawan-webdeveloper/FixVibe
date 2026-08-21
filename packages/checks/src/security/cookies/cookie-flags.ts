/**
 * Cookie security flags — Secure, HttpOnly and SameSite on the cookies the
 * scanned response actually set.
 *
 * Scope, stated up front because it bounds every claim below: ctx.cookies comes
 * from Set-Cookie on the final hop only. Cookies written by JavaScript, or set
 * after a login we never perform, are invisible here — so a clean result means
 * "nothing wrong in what we saw", never "this site's session handling is sound".
 * Values are dropped by the parser and never reappear: only names are reported.
 *
 * One finding per attribute, not per cookie. Twelve cookies missing Secure is
 * one server-side mistake with one fix, and charging the score twelve times for
 * it would say more about the check than about the site.
 *
 * How each attribute is judged, and why they are judged differently:
 *
 * - Secure has no legitimate exception on an HTTPS origin. Without it the
 *   browser attaches the cookie to any plain-HTTP request to the same host,
 *   where it travels in cleartext. Reported. (Skipped on http:// origins:
 *   browsers refuse to store Secure cookies from a non-secure origin anyway,
 *   and the https-redirect check owns that problem.)
 *
 * - HttpOnly cannot be judged the same way. Consent state, feature flags, a
 *   CSRF token the front end has to echo back — these are read by JavaScript by
 *   design, and nothing in a Set-Cookie header distinguishes them from a session
 *   token. So this check splits the difference honestly: names that are a known
 *   framework's default session cookie are reported at medium, because there the
 *   claim rests on what the name provably is; every other cookie without
 *   HttpOnly is reported at info as a plain observation with the uncertainty
 *   spelled out, costing the score nothing. Flagging all of them would fire on
 *   nearly every real site and teach users to skip this section.
 *
 * - SameSite absent is a weak signal now that Chrome, Edge and Firefox default
 *   to Lax, so it is a low hardening hint, grouped with values browsers do not
 *   recognise (same outcome: the default applies). SameSite=None without Secure
 *   is the opposite — a hard rule, where the browser drops the cookie outright.
 *   Those cookies are reported under that rule only, not a second time for the
 *   missing Secure flag, since it is one attribute pair and one fix.
 */

import type { Check, Finding, ParsedCookie } from '../../types.ts'

const ID = 'security.cookies.flags'

/**
 * Exact framework defaults for the *authentication* session cookie. Deliberately
 * a short list of names that are not plausibly used for anything else — a broad
 * "contains sess" rule would sweep up anonymous analytics session ids and turn a
 * defensible finding into a guess.
 */
const SESSION_COOKIE_NAMES = new Set([
  'phpsessid',
  'jsessionid',
  'asp.net_sessionid',
  'connect.sid',
  'sessionid',
  'session',
  'sessid',
  'next-auth.session-token',
  'authjs.session-token',
  'access_token',
  'refresh_token',
  'id_token',
])

/** The only tokens browsers act on; anything else falls back to the default. */
const KNOWN_SAME_SITE = new Set(['strict', 'lax', 'none'])

/**
 * The __Host-/__Secure- prefixes are enforcement markers, not part of the
 * cookie's identity, so strip them before matching names.
 */
function normaliseName(name: string): string {
  return name.toLowerCase().replace(/^__(host|secure)-/, '')
}

function isFrameworkSessionCookie(name: string): boolean {
  const normalised = normaliseName(name)
  return (
    SESSION_COOKIE_NAMES.has(normalised) ||
    // Rails (_appname_session), Laravel, CodeIgniter all end this way.
    normalised.endsWith('_session') ||
    // Classic ASP appends a random suffix to every session cookie name.
    normalised.startsWith('aspsessionid')
  )
}

/** One response can set the same name twice; report it once, in stable order. */
function namesOf(cookies: readonly ParsedCookie[]): string[] {
  return [...new Set(cookies.map((cookie) => cookie.name))].sort()
}

/** Descriptions read badly with a bare count. */
function plural(count: number): string {
  return count === 1 ? '1 cookie' : `${count} cookies`
}

export const cookieFlagsCheck: Check = {
  id: ID,
  category: 'security',
  title: 'Cookie security flags',

  run(ctx) {
    if (ctx.cookies.length === 0) return []

    const findings: Finding[] = []

    const noneWithoutSecure = ctx.cookies.filter(
      (cookie) => cookie.sameSite?.trim().toLowerCase() === 'none' && !cookie.secure,
    )
    const alreadyReported = new Set(noneWithoutSecure)

    if (noneWithoutSecure.length > 0) {
      const names = namesOf(noneWithoutSecure)
      findings.push({
        checkId: ID,
        category: 'security',
        severity: 'medium',
        title: 'SameSite=None cookies are missing Secure',
        description:
          `This response sets ${plural(names.length)} with SameSite=None but no Secure attribute. ` +
          'Chrome, Firefox and Safari reject that combination on arrival, so the cookie is never ' +
          'stored — whatever depends on it cross-site (an embed, an SSO return, a payment redirect) ' +
          'fails for every visitor, usually in a way that looks intermittent.',
        evidence: { cookies: names },
        remediation: 'Add Secure to every cookie that sets SameSite=None, and serve it over HTTPS.',
        fixPrompt:
          `These cookies on this site are set with SameSite=None but without Secure, so browsers ` +
          `discard them: ${names.join(', ')}. Find where each is set and add the Secure attribute ` +
          'alongside SameSite=None. If a cookie does not actually need to travel cross-site, set ' +
          'SameSite=Lax instead of None.',
      } satisfies Finding)
    }

    // Browsers refuse to store Secure cookies from a non-secure origin, so on
    // http:// the missing flag is a symptom of the scheme, not of the cookie.
    if (ctx.finalUrl.protocol === 'https:') {
      const insecure = ctx.cookies.filter((cookie) => !cookie.secure && !alreadyReported.has(cookie))

      if (insecure.length > 0) {
        const names = namesOf(insecure)
        findings.push({
          checkId: ID,
          category: 'security',
          severity: 'medium',
          title: 'Cookies set without the Secure attribute',
          description:
            `This response sets ${plural(names.length)} without Secure over HTTPS. The browser will ` +
            'attach them to any plain-HTTP request to this host — a typed address, an old bookmark, ' +
            'an http:// link in an email — and send them in cleartext, where anyone sharing the ' +
            'network path can read them.',
          evidence: { cookies: names },
          remediation:
            'Add the Secure attribute to every cookie this site sets; there is no case for omitting it ' +
            'on an HTTPS origin.',
          fixPrompt:
            `These cookies on this HTTPS site are set without the Secure attribute: ${names.join(', ')}. ` +
            'Add Secure wherever each is set — session middleware config, the framework cookie helper, ' +
            'or the raw Set-Cookie header. Set it once in shared cookie options rather than per call ' +
            'site if the framework allows it.',
        } satisfies Finding)
      }
    }

    const readableByScripts = ctx.cookies.filter((cookie) => !cookie.httpOnly)
    const sessionCookies = readableByScripts.filter((cookie) => isFrameworkSessionCookie(cookie.name))
    const otherCookies = readableByScripts.filter((cookie) => !isFrameworkSessionCookie(cookie.name))

    if (sessionCookies.length > 0) {
      const names = namesOf(sessionCookies)
      findings.push({
        checkId: ID,
        category: 'security',
        severity: 'medium',
        title: 'Session cookies are readable by JavaScript',
        description:
          `This response sets ${plural(names.length)} without HttpOnly whose name is a framework's ` +
          `default session cookie: ${names.join(', ')}. Any script running on this origin can read ` +
          'them through document.cookie, so one cross-site scripting flaw — or one compromised ' +
          'third-party tag — is enough to copy a live session and reuse it.',
        evidence: { cookies: names },
        remediation:
          'Set HttpOnly on the session cookie; no front-end code should need to read a session token.',
        fixPrompt:
          `These session cookies on this site are set without HttpOnly: ${names.join(', ')}. Enable ` +
          'HttpOnly in the session configuration (for example the cookie options of the session ' +
          'middleware). If some front-end code reads the value today, move that need to a separate ' +
          'non-sensitive cookie or an API response rather than dropping the flag.',
      } satisfies Finding)
    }

    if (otherCookies.length > 0) {
      const names = namesOf(otherCookies)
      findings.push({
        checkId: ID,
        category: 'security',
        severity: 'info',
        title: 'Cookies readable by JavaScript',
        description:
          `This response sets ${plural(names.length)} without HttpOnly, so any script on the page can ` +
          'read them via document.cookie. That is correct and intended for cookies the front end owns ' +
          '— consent state, feature flags, a CSRF token the client has to echo back — and a ' +
          'Set-Cookie header gives no way to tell those apart from an authentication token. Recorded ' +
          'as an observation to confirm against, not as a defect.',
        evidence: { cookies: names },
        remediation:
          'Confirm none of these carries a session or authentication token; add HttpOnly to any that does.',
        fixPrompt:
          `Review these cookies on this site, which are set without HttpOnly and are therefore ` +
          `readable by any script on the page: ${names.join(', ')}. For each, decide whether ` +
          'front-end code genuinely needs to read it. Add HttpOnly to the ones it does not, ' +
          'especially any that carries an authentication or session token.',
      } satisfies Finding)
    }

    // Absent and unrecognised land in the same bucket: browsers apply their
    // default in both cases, so the site gets the same behaviour either way.
    const withoutSameSite = ctx.cookies.filter(
      (cookie) => cookie.sameSite === null || !KNOWN_SAME_SITE.has(cookie.sameSite.trim().toLowerCase()),
    )

    if (withoutSameSite.length > 0) {
      const names = namesOf(withoutSameSite)
      const unrecognisedValues: Record<string, string> = {}
      for (const cookie of withoutSameSite) {
        if (cookie.sameSite !== null) unrecognisedValues[cookie.name] = cookie.sameSite
      }
      const hasUnrecognised = Object.keys(unrecognisedValues).length > 0

      findings.push({
        checkId: ID,
        category: 'security',
        severity: 'low',
        title: 'Cookies without an explicit SameSite',
        description:
          `This response sets ${plural(names.length)} with no SameSite attribute` +
          (hasUnrecognised ? ' or with a value browsers do not recognise' : '') +
          ', leaving the behaviour to the browser default. Chrome, Edge and Firefox default to Lax, ' +
          'which already blocks the cross-site requests that drive CSRF, but older browsers and some ' +
          'in-app webviews still send the cookie on every cross-site request. Declaring the attribute ' +
          'is the only way to know which rule applies.',
        evidence: hasUnrecognised ? { cookies: names, unrecognisedValues } : { cookies: names },
        remediation:
          'Set SameSite=Lax on these cookies (Strict for purely first-party ones, None plus Secure only ' +
          'where cross-site delivery is required).',
        fixPrompt:
          `These cookies on this site have no valid SameSite attribute: ${names.join(', ')}. Add ` +
          'SameSite=Lax wherever each is set. Use Strict for cookies that are never needed on a ' +
          'cross-site navigation, and SameSite=None with Secure only for cookies an embed or a ' +
          'third-party redirect flow genuinely depends on.',
      } satisfies Finding)
    }

    return findings
  },
}
