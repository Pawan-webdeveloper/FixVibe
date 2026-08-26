/**
 * axe-core's verdict on the rendered page.
 *
 * The three static accessibility checks in this engine read the served HTML
 * with a parser. That catches the obvious cases and is blind to everything
 * that depends on what the browser computed: an implicit ARIA role, a label
 * associated across the document by `aria-labelledby`, a contrast ratio, an
 * element that only exists after hydration. axe answers those, because it runs
 * inside the page against a real accessibility tree.
 *
 * So when this check has data, the static three stand down — see
 * accessibility/static/*.ts. Two sources reporting the same missing alt text
 * would charge the site twice for one defect, and the less accurate of the two
 * would be the one setting the severity.
 *
 * ## Severity, and why nothing here is `critical`
 *
 * axe's own `impact` scale is mapped down one step: critical → high, serious →
 * medium, moderate → low, minor → info. That is a deliberate choice about this
 * engine's scale rather than a judgement about accessibility. `critical` here
 * costs 30 points and is reserved for "a stranger can read your database"; an
 * unlabelled button is a serious defect that a person can work around, and
 * letting one axe rule take a third of a site's score off would make the
 * pillar unreadable on any real page.
 *
 * One finding per RULE, never per element. A page with 200 unlabelled icons
 * has one problem to fix, in one place, and `nodeCount` carries the scale.
 */

import type { Check, CheckContext, Finding, Severity } from '../types.ts'

const ID = 'accessibility.axe'

/** axe impact → our scale, one step down. See the note above. */
const SEVERITY_BY_IMPACT: Record<string, Severity> = {
  critical: 'high',
  serious: 'medium',
  moderate: 'low',
  minor: 'info',
}

/** An impact axe did not set. Reported, but never allowed to dominate a score. */
const UNRATED_SEVERITY: Severity = 'info'

export const axeCheck: Check = {
  id: ID,
  category: 'accessibility',
  title: 'Accessibility audit (axe-core)',

  run(ctx) {
    // No browser tier, or the audit failed. Either way we did not look.
    const axe = ctx.rendered?.axe
    if (!axe) return []

    return axe.violations.map((violation) => {
      const severity = violation.impact ? (SEVERITY_BY_IMPACT[violation.impact] ?? UNRATED_SEVERITY) : UNRATED_SEVERITY
      const criteria = wcagCriteria(violation.tags)
      const scale = violation.nodeCount === 1 ? '1 element' : `${violation.nodeCount} elements`

      return {
        checkId: ID,
        category: 'accessibility',
        severity,
        title: `${violation.help} (${scale})`,
        description:
          `${violation.description} axe-core found ${scale} failing the "${violation.id}" rule on the ` +
          'rendered page — that is the DOM after JavaScript ran, so this includes anything the ' +
          `framework built at runtime.${criteria ? ` Maps to WCAG ${criteria}.` : ''} ` +
          (violation.impact
            ? `axe rates the impact "${violation.impact}".`
            : 'axe did not rate the impact of this rule.'),
        evidence: {
          rule: violation.id,
          impact: violation.impact,
          elementsAffected: violation.nodeCount,
          // Markup from a public page, so nothing to redact — but capped
          // upstream, because a finding containing 200 DOM fragments is not a
          // finding anyone reads.
          examples: violation.samples,
          reference: violation.helpUrl,
          ...(criteria ? { wcag: criteria } : {}),
        },
        remediation: `${violation.help}. Full rule and remediation guidance: ${violation.helpUrl}`,
        fixPrompt:
          `The rendered page at ${ctx.rendered?.finalUrl || ctx.finalUrl.href} fails the axe-core rule ` +
          `"${violation.id}" on ${scale}: ${violation.help}.\n\n` +
          (violation.samples.length > 0
            ? `Failing elements:\n${violation.samples
                .map((sample) => `  ${sample.target}\n    ${sample.html}`)
                .join('\n')}\n\n`
            : '') +
          `Read ${violation.helpUrl} for what this rule requires, then fix it in this repository at ` +
          'the source — these elements are almost always produced by one component or one template, ' +
          `so ${violation.nodeCount > 1 ? 'the fix is one change, not ' + String(violation.nodeCount) + ' changes' : 'find where it is rendered'}. ` +
          'Do NOT satisfy the rule by adding an ARIA attribute that lies: an aria-label that does not ' +
          'describe what the control does is worse for a screen-reader user than no label, because it ' +
          'silences the heuristics the browser would otherwise apply.\n\n' +
          'Verify with axe DevTools or `@axe-core/playwright` against the running app, not by reading ' +
          'the source — this rule was evaluated on the rendered DOM and some of it depends on ' +
          'computed styles and roles.',
      } satisfies Finding
    })
  },
}

/**
 * The WCAG success criteria an axe rule maps to, as "1.4.3, 1.4.11".
 *
 * axe encodes them as tags like `wcag143`, which is 1.4.3 — digits after the
 * prefix, one per level. Only the three-digit form is decoded; anything else
 * is dropped rather than guessed at, since a wrong criterion number in a
 * report is worse than none.
 */
function wcagCriteria(tags: readonly string[]): string {
  const criteria = tags
    .map((tag) => /^wcag(\d)(\d)(\d)$/.exec(tag))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => `${match[1]}.${match[2]}.${match[3]}`)

  return [...new Set(criteria)].sort().join(', ')
}
