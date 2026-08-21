/**
 * Mixed content — http:// subresources referenced by an https:// page.
 *
 * The two halves behave differently in the browser, so they are two findings:
 * ACTIVE references (script, stylesheet, iframe, object, embed) are blocked
 * outright by every current browser, which means the page is already missing
 * behaviour in production and would be rewritable by anyone on the network
 * path if they were not blocked; PASSIVE ones (images, media) are auto-upgraded
 * or loaded unauthenticated, so the outcome is a missing or swapped asset
 * rather than code execution.
 *
 * Only attributes the browser actually fetches are read, which is why several
 * tempting things are deliberately ignored: <a href="http://…"> is a
 * navigation, not a subresource; an http:// string in text, comments, JSON-LD
 * or an xmlns attribute is never requested; protocol-relative "//host/path"
 * inherits the page's https scheme. srcset candidate lists and CSS url()
 * references are not parsed either — splitting srcset on commas is ambiguous
 * for URLs that contain them, and we never fetched the stylesheets. Both would
 * mean guessing, and a guess here is a false positive.
 *
 * <form action="http://…"> is not a subresource and browsers do not block it,
 * but it is the one case on the page where user data leaves the browser in
 * cleartext, so it gets its own finding, raised when the form holds a password
 * field. Overrides via formaction on a submit button are not inspected.
 *
 * Loopback targets (localhost, 127.0.0.0/8, ::1) are exempt from mixed-content
 * blocking because the spec treats them as trustworthy, so nothing about them
 * is a transport risk. They are still development leftovers, so they are
 * reported once at info instead of being counted with the rest.
 */

import type { Check, CheckContext, Finding } from '../types.ts'

const ID = 'security.mixed-content'

/** Enough URLs to act on without turning a page of 200 broken images into a 200-entry payload. */
const EVIDENCE_SAMPLE_LIMIT = 10

interface Source {
  selector: string
  attr: string
  /** Element plus attribute, as shown back to the user in evidence. */
  label: string
}

/** Blocked by browsers on an HTTPS page, and able to rewrite the page had they loaded. */
const ACTIVE_SOURCES: readonly Source[] = [
  { selector: 'script[src]', attr: 'src', label: 'script[src]' },
  { selector: 'iframe[src]', attr: 'src', label: 'iframe[src]' },
  { selector: 'object[data]', attr: 'data', label: 'object[data]' },
  { selector: 'embed[src]', attr: 'src', label: 'embed[src]' },
]

/** Upgraded or loaded unauthenticated — tampering and broken assets, not takeover. */
const PASSIVE_SOURCES: readonly Source[] = [
  { selector: 'img[src]', attr: 'src', label: 'img[src]' },
  { selector: 'video[src]', attr: 'src', label: 'video[src]' },
  { selector: 'video[poster]', attr: 'poster', label: 'video[poster]' },
  { selector: 'audio[src]', attr: 'src', label: 'audio[src]' },
  { selector: 'source[src]', attr: 'src', label: 'source[src]' },
]

interface Ref {
  label: string
  /** The attribute value exactly as written in the markup. */
  url: string
  /** Loopback destination — exempt from mixed-content rules, so scored separately. */
  local: boolean
}

interface FormRef extends Ref {
  method: string
  hasPasswordField: boolean
}

/**
 * The URL only counts when the scheme is written out as http:. Relative and
 * protocol-relative references inherit https from the page, and a value the
 * URL parser rejects is one the browser could not resolve either — unknown,
 * so silent.
 */
function plainHttpUrl(raw: string | undefined): URL | null {
  if (!raw || !/^\s*http:\/\//i.test(raw)) return null
  try {
    return new URL(raw.trim())
  } catch {
    return null
  }
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '[::1]' || // URL.hostname keeps the brackets on IPv6 literals
    host === '0.0.0.0' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  )
}

function gather(ctx: CheckContext, sources: readonly Source[]): Ref[] {
  const refs: Ref[] = []
  for (const { selector, attr, label } of sources) {
    ctx.$(selector).each((_, el) => {
      const raw = ctx.$(el).attr(attr)?.trim()
      const parsed = plainHttpUrl(raw)
      if (raw && parsed) refs.push({ label, url: raw, local: isLoopback(parsed.hostname) })
    })
  }
  return refs
}

/**
 * Stylesheets are matched on the rel token list rather than a `[rel~=]`
 * selector so that `rel="Stylesheet"` and `rel="alternate stylesheet"` are
 * both recognised — browsers treat rel as a case-insensitive token set.
 */
function gatherStylesheets(ctx: CheckContext): Ref[] {
  const refs: Ref[] = []
  ctx.$('link[href]').each((_, el) => {
    const rel = (ctx.$(el).attr('rel') ?? '').toLowerCase().split(/\s+/)
    if (!rel.includes('stylesheet')) return
    const raw = ctx.$(el).attr('href')?.trim()
    const parsed = plainHttpUrl(raw)
    if (raw && parsed) refs.push({ label: 'link[rel=stylesheet]', url: raw, local: isLoopback(parsed.hostname) })
  })
  return refs
}

function gatherForms(ctx: CheckContext): FormRef[] {
  const refs: FormRef[] = []
  ctx.$('form[action]').each((_, el) => {
    const raw = ctx.$(el).attr('action')?.trim()
    const parsed = plainHttpUrl(raw)
    if (!raw || !parsed) return
    const hasPasswordField = ctx
      .$(el)
      .find('input')
      .toArray()
      .some((input) => (ctx.$(input).attr('type') ?? '').trim().toLowerCase() === 'password')
    refs.push({
      label: 'form[action]',
      url: raw,
      local: isLoopback(parsed.hostname),
      method: (ctx.$(el).attr('method') ?? 'get').trim().toLowerCase(),
      hasPasswordField,
    })
  })
  return refs
}

/** The same asset referenced ten times is one thing to fix, and one line of evidence. */
function dedupe<T extends Ref>(refs: readonly T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const ref of refs) {
    if (seen.has(ref.url)) continue
    seen.add(ref.url)
    out.push(ref)
  }
  return out
}

function sampleOf(refs: readonly Ref[]): Array<{ element: string; url: string }> {
  return refs.slice(0, EVIDENCE_SAMPLE_LIMIT).map(({ label, url }) => ({ element: label, url }))
}

/** URLs inline in a fix prompt, capped the same way as the evidence. */
function urlList(refs: readonly Ref[]): string {
  const shown = refs.slice(0, EVIDENCE_SAMPLE_LIMIT).map((r) => r.url)
  const hidden = refs.length - shown.length
  return hidden > 0 ? `${shown.join(', ')}, and ${hidden} more` : shown.join(', ')
}

const plural = (n: number) => (n === 1 ? '' : 's')

export const mixedContentCheck: Check = {
  id: ID,
  category: 'security',
  title: 'Mixed content',

  run(ctx) {
    // Mixed content is defined against a secure page; on http:// every
    // reference is equally plain, and the https-redirect check owns that.
    if (ctx.finalUrl.protocol !== 'https:') return []

    const active = dedupe([...gather(ctx, ACTIVE_SOURCES), ...gatherStylesheets(ctx)])
    const passive = dedupe(gather(ctx, PASSIVE_SOURCES))
    const forms = dedupe(gatherForms(ctx))

    const findings: Finding[] = []

    const blockedActive = active.filter((r) => !r.local)
    if (blockedActive.length > 0) {
      const n = blockedActive.length
      findings.push({
        checkId: ID,
        category: 'security',
        severity: 'high',
        title: `Active mixed content: ${n} http:// subresource${plural(n)}`,
        description:
          'The page is served over HTTPS but ' +
          (n === 1
            ? 'one script, stylesheet or embedded frame is referenced'
            : `${n} scripts, stylesheets or embedded frames are referenced`) +
          ' over plain http://. Browsers block these requests, so whatever they provide is missing for every ' +
          'visitor; were they loaded, anyone on the network path could replace their contents and run code ' +
          'in the page.',
        evidence: { total: n, sample: sampleOf(blockedActive) },
        remediation:
          'Change each reference to https://, or to a root-relative path when the asset is on this site.',
        fixPrompt:
          `This HTTPS page references ${n} active subresource${plural(n)} over plain http://, which browsers ` +
          `block: ${urlList(blockedActive)}. Find where each URL is emitted (template, component, CMS field ` +
          'or config) and change the scheme to https://, using a root-relative path for same-site assets. ' +
          'If a host offers no HTTPS endpoint, self-host the asset or replace the dependency — do not paper ' +
          'over it with a protocol-relative "//" URL.',
      } satisfies Finding)
    }

    const insecureForms = forms.filter((f) => !f.local)
    if (insecureForms.length > 0) {
      const n = insecureForms.length
      const credentials = insecureForms.some((f) => f.hasPasswordField)
      const subject =
        n === 1
          ? 'A form on this page posts to a plain http:// URL'
          : `${n} forms on this page post to plain http:// URLs`
      findings.push({
        checkId: ID,
        category: 'security',
        severity: credentials ? 'high' : 'medium',
        title: credentials
          ? 'Form with a password field submits over http://'
          : `Form action${plural(n)} use${n === 1 ? 's' : ''} http://`,
        description:
          `${subject}. Everything entered is sent across the network in cleartext on ` +
          'that first request, so a redirect to HTTPS at the other end arrives too late to protect it' +
          (credentials ? ', and one of these forms collects a password' : '') +
          '. Browsers interrupt the submission with a warning, so the form also loses conversions.',
        evidence: {
          total: n,
          sample: insecureForms.slice(0, EVIDENCE_SAMPLE_LIMIT).map(({ url, method, hasPasswordField }) => ({
            action: url,
            method,
            passwordField: hasPasswordField,
          })),
        },
        remediation: 'Point the form action at the https:// endpoint (or a relative path on this site).',
        fixPrompt:
          `${n === 1 ? 'A form' : `${n} forms`} on this HTTPS page submit${n === 1 ? 's' : ''} to plain ` +
          `http:// URL${plural(n)}: ${urlList(insecureForms)}. Change each action to the https:// endpoint, ` +
          'or to a relative path when the handler is on this site, and confirm the endpoint answers over ' +
          'HTTPS directly rather than redirecting from HTTP.',
      } satisfies Finding)
    }

    const insecurePassive = passive.filter((r) => !r.local)
    if (insecurePassive.length > 0) {
      const n = insecurePassive.length
      findings.push({
        checkId: ID,
        category: 'security',
        severity: 'low',
        title: `Passive mixed content: ${n} http:// image or media reference${plural(n)}`,
        description:
          `The page is served over HTTPS but references ${n} image or media file${plural(n)} over plain ` +
          'http://. Current browsers retry these over https:// and drop them when that fails, so the assets ' +
          'may simply not render; where they are still loaded, the bytes are unauthenticated and can be ' +
          'swapped in transit.',
        evidence: { total: n, sample: sampleOf(insecurePassive) },
        remediation: 'Change each reference to https://, or to a root-relative path for same-site assets.',
        fixPrompt:
          `This HTTPS page references ${n} image or media file${plural(n)} over plain http://: ` +
          `${urlList(insecurePassive)}. Update each reference to https:// (root-relative for same-site ` +
          'assets) wherever it is emitted, including any hardcoded URLs in CMS content or seed data.',
      } satisfies Finding)
    }

    const loopback = [...active, ...passive, ...forms].filter((r) => r.local)
    if (loopback.length > 0) {
      const n = loopback.length
      findings.push({
        checkId: ID,
        category: 'security',
        severity: 'info',
        title: `${n} reference${plural(n)} to a localhost URL`,
        description:
          `The page references ${n} URL${plural(n)} on localhost or a loopback address. This is not mixed ` +
          'content — browsers treat loopback as trustworthy and do not block it — but the address means the ' +
          "visitor's own machine, so the reference resolves to whatever they happen to be running, or to " +
          'nothing at all. It is normally a development URL that reached production.',
        evidence: { total: n, sample: sampleOf(loopback) },
        remediation: 'Replace the localhost URLs with the deployed https:// origin, or remove them.',
        fixPrompt:
          `This production page references localhost URLs: ${urlList(loopback)}. Replace them with the ` +
          'deployed origin, taking the value from an environment variable rather than a hardcoded string, ' +
          'so development and production builds no longer diverge here.',
      } satisfies Finding)
    }

    return findings
  },
}
