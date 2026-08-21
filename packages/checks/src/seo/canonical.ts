/**
 * <link rel="canonical"> — tells crawlers which URL is the real one when the
 * same content is reachable several ways (trailing slash, query strings,
 * www/apex, http/https).
 *
 * Deliberately conservative about "wrong" canonicals: pointing at a different
 * path or at the apex domain is exactly what the tag is FOR, and a scanner that
 * flags intentional canonicalisation teaches users to ignore it. Only three
 * things are reported: a missing tag, a tag that cannot work (empty/unparseable/
 * duplicated with conflicting values), and a target on an unrelated site.
 */

import type { Check, Finding } from '../types.ts'

const ID = 'seo.canonical'

export const canonicalCheck: Check = {
  id: ID,
  category: 'seo',
  title: 'Canonical URL',

  run(ctx) {
    const hrefs = ctx
      .$('link')
      .toArray()
      .filter((el) => (ctx.$(el).attr('rel') ?? '').trim().toLowerCase() === 'canonical')
      .map((el) => (ctx.$(el).attr('href') ?? '').trim())

    if (hrefs.length === 0) {
      return [
        {
          checkId: ID,
          category: 'seo',
          severity: 'low',
          title: 'Missing canonical link',
          description:
            'No <link rel="canonical"> was found. Every URL variant that serves this page — with a ' +
            'trailing slash, with tracking parameters, on www and apex — can then be indexed separately, ' +
            'splitting the ranking signals between them.',
          remediation: 'Add <link rel="canonical" href="…"> pointing at this page\'s preferred absolute URL.',
          fixPrompt:
            'Add a <link rel="canonical"> tag to this site, emitting each page\'s own preferred absolute ' +
            'URL (https, canonical host, no tracking parameters). Generate it per route rather than ' +
            'hardcoding one URL in the layout.',
        } satisfies Finding,
      ]
    }

    const findings: Finding[] = []
    const href = hrefs[0]!

    if (hrefs.length > 1) {
      const distinct = [...new Set(hrefs)]
      if (distinct.length > 1) {
        findings.push({
          checkId: ID,
          category: 'seo',
          severity: 'medium',
          title: `Conflicting canonical links (${distinct.length} different URLs)`,
          description:
            'The page declares more than one canonical URL. Google discards conflicting canonical ' +
            'signals entirely, so the tag stops working rather than picking a winner.',
          evidence: { hrefs: distinct.slice(0, 5) },
          remediation: 'Emit exactly one canonical link per page; remove the competing one.',
          fixPrompt:
            `This page emits conflicting canonical URLs: ${JSON.stringify(distinct.slice(0, 5))}. ` +
            'Find the layout and page templates both setting rel="canonical" and keep only one.',
        })
      }
    }

    if (!href) {
      findings.push({
        checkId: ID,
        category: 'seo',
        severity: 'low',
        title: 'Canonical link has an empty href',
        description:
          'A canonical link is present but its href is empty, which crawlers ignore — the same outcome ' +
          'as having no canonical, with none of the visibility.',
        remediation: 'Set href to this page\'s absolute URL, or drop the tag.',
        fixPrompt:
          'This page has <link rel="canonical"> with an empty href. Set it to the page\'s absolute URL ' +
          '(or remove the tag if the value cannot be computed server-side).',
      })
      return findings
    }

    let canonical: URL
    try {
      canonical = new URL(href, ctx.finalUrl)
    } catch {
      findings.push({
        checkId: ID,
        category: 'seo',
        severity: 'low',
        title: 'Canonical href is not a valid URL',
        description:
          `The canonical href "${href}" cannot be parsed as a URL, so crawlers drop the signal.`,
        evidence: { href },
        remediation: 'Use a full absolute URL, e.g. https://example.com/page.',
        fixPrompt:
          `This page's canonical href is "${href}", which is not a valid URL. Emit an absolute URL ` +
          `such as "${ctx.finalUrl.href}".`,
      })
      return findings
    }

    if (canonical.protocol === 'http:' && ctx.finalUrl.protocol === 'https:') {
      findings.push({
        checkId: ID,
        category: 'seo',
        severity: 'medium',
        title: 'Canonical points to the insecure http:// variant',
        description:
          `The page is served over HTTPS but its canonical is "${canonical.href}". That nominates the ` +
          'plain-HTTP copy as the indexable one, which is both a downgrade signal and a redirect loop ' +
          'risk if HTTP redirects back to HTTPS.',
        evidence: { href, finalUrl: ctx.finalUrl.href },
        remediation: 'Emit the canonical with the https:// scheme.',
        fixPrompt:
          `This HTTPS page's canonical URL is "${canonical.href}". Build canonical URLs from the request's ` +
          'scheme (or hardcode https) so they never point at the http:// variant.',
      })
    }

    if (!isSameSite(canonical.hostname, ctx.finalUrl.hostname)) {
      findings.push({
        checkId: ID,
        category: 'seo',
        severity: 'medium',
        title: 'Canonical points to a different site',
        description:
          `The canonical is "${canonical.href}" while the page is served from ${ctx.finalUrl.hostname}. ` +
          'This tells Google the content belongs to that other site and this copy should not be indexed. ' +
          'Correct for deliberately syndicated content; otherwise it removes the page from search.',
        evidence: { href, canonicalHost: canonical.hostname, pageHost: ctx.finalUrl.hostname },
        remediation:
          'Confirm the cross-site canonical is intentional; if not, point it at this page on this domain.',
        fixPrompt:
          `This page (${ctx.finalUrl.href}) declares a canonical on another domain: "${canonical.href}". ` +
          'Unless the content is deliberately syndicated from that site, fix the canonical generation to ' +
          'use this site\'s own host.',
      })
    }

    return findings
  },
}

/**
 * Same registrable site, approximately: identical after dropping a leading
 * "www.", or one hostname is a sub-domain of the other. Erring toward "same"
 * is deliberate — a missed cross-domain canonical is a quiet gap, while
 * flagging a legitimate www→apex canonical trains users to distrust the report.
 */
function isSameSite(a: string, b: string): boolean {
  const strip = (host: string) => host.toLowerCase().replace(/^www\./, '')
  const left = strip(a)
  const right = strip(b)
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`)
}
