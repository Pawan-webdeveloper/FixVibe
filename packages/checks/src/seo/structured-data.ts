/**
 * JSON-LD structured data — what earns rich results (ratings, FAQs,
 * breadcrumbs, product prices) instead of a plain blue link.
 *
 * Having none is an opportunity, not a defect, so it is `info`. Having some
 * that does not parse is worse than having none: the site pays the maintenance
 * cost and Google discards the block, so a broken block is a real finding.
 *
 * Only the two structural invariants every schema.org document must satisfy are
 * validated (@context and a type). Validating vocabularies belongs to Google's
 * Rich Results Test, not to a scanner that would guess and be confidently wrong.
 */

import type { Check, Finding } from '../types.ts'

const ID = 'seo.structured-data'

export const structuredDataCheck: Check = {
  id: ID,
  category: 'seo',
  title: 'Structured data (JSON-LD)',

  run(ctx) {
    const blocks = ctx
      .$('script')
      .toArray()
      .filter((el) => (ctx.$(el).attr('type') ?? '').toLowerCase().includes('ld+json'))
      .map((el) => (ctx.$(el).text() ?? '').trim())

    if (blocks.length === 0) {
      return [
        {
          checkId: ID,
          category: 'seo',
          severity: 'info',
          title: 'No JSON-LD structured data',
          description:
            'The page ships no schema.org JSON-LD. Rich results — star ratings, FAQ accordions, ' +
            'breadcrumbs, product prices, sitelinks search — are only generated from structured data, ' +
            'so the listing stays a plain blue link.',
          remediation:
            'Add a JSON-LD block describing the page (Organization or WebSite on the home page; ' +
            'Article, Product or FAQPage on content pages).',
          fixPrompt:
            'Add schema.org JSON-LD to this site. Start with an Organization or WebSite block in the ' +
            'root layout, then add a per-page type where it applies (Article for posts, Product for ' +
            'product pages, FAQPage where there is a real FAQ). Emit it server-side inside ' +
            '<script type="application/ld+json"> and verify with Google\'s Rich Results Test.',
        } satisfies Finding,
      ]
    }

    const findings: Finding[] = []

    blocks.forEach((raw, index) => {
      const label = blocks.length > 1 ? ` #${index + 1}` : ''

      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch (error) {
        findings.push({
          checkId: ID,
          category: 'seo',
          severity: 'low',
          title: `JSON-LD block${label} is not valid JSON`,
          description:
            `The block cannot be parsed (${error instanceof Error ? error.message : String(error)}), so ` +
            'Google discards it entirely — the markup is maintained but does nothing.',
          evidence: { snippet: raw.slice(0, 200), error: String(error) },
          remediation: 'Fix the JSON syntax — usually a trailing comma or an unescaped quote in interpolated text.',
          fixPrompt:
            `This page has an invalid JSON-LD block${label}. Parse error: ` +
            `${error instanceof Error ? error.message : String(error)}. Snippet: ${raw.slice(0, 200)}. ` +
            'Fix it — and if the block is built by string concatenation, switch to JSON.stringify of a ' +
            'real object so user content is escaped automatically.',
        })
        return
      }

      // A block may be a single node, an array of nodes, or a @graph container.
      const nodes = (Array.isArray(parsed) ? parsed : [parsed]).filter(isRecord)

      if (nodes.length === 0) {
        findings.push({
          checkId: ID,
          category: 'seo',
          severity: 'low',
          title: `JSON-LD block${label} contains no schema.org object`,
          description:
            'The block parses as JSON but holds no object — typically a stray string, number or empty ' +
            'array left behind by a template.',
          evidence: { snippet: raw.slice(0, 200) },
          remediation: 'Emit a schema.org object with @context and @type, or remove the block.',
          fixPrompt:
            `This page's JSON-LD block${label} contains no schema.org object (found: ` +
            `${raw.slice(0, 120)}). Either emit a proper object with "@context" and "@type", or remove it.`,
        })
        return
      }

      const missingContext = nodes.filter((node) => !hasSchemaContext(node))
      if (missingContext.length > 0) {
        findings.push({
          checkId: ID,
          category: 'seo',
          severity: 'info',
          title: `JSON-LD block${label} is missing @context`,
          description:
            'Without "@context": "https://schema.org" a consumer has no vocabulary to resolve the types ' +
            'against, so the block is ignored.',
          evidence: { context: missingContext.map((node) => node['@context'] ?? null).slice(0, 3) },
          remediation: 'Add "@context": "https://schema.org" to the top-level object.',
          fixPrompt:
            `Add "@context": "https://schema.org" to the top-level object of JSON-LD block${label} on ` +
            'this page.',
        })
      }

      const missingType = nodes.filter((node) => !node['@type'] && !node['@graph'])
      if (missingType.length > 0) {
        findings.push({
          checkId: ID,
          category: 'seo',
          severity: 'info',
          title: `JSON-LD block${label} is missing @type`,
          description:
            'Every schema.org node must declare what it is. Without @type (or a @graph of typed nodes) ' +
            'the data describes nothing Google can act on.',
          evidence: { keys: missingType.flatMap((node) => Object.keys(node)).slice(0, 10) },
          remediation: 'Add "@type" — e.g. Organization, WebSite, Article, Product, FAQPage.',
          fixPrompt:
            `Add a "@type" to the object(s) in JSON-LD block${label} on this page, matching what the ` +
            'page actually is (Organization, WebSite, Article, Product, FAQPage, BreadcrumbList).',
        })
      }
    })

    return findings
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** @context may be a string, an array, or an object with a @vocab — accept any that names schema.org. */
function hasSchemaContext(node: Record<string, unknown>): boolean {
  const context = node['@context']
  if (context === undefined) return false
  return JSON.stringify(context).includes('schema.org')
}
