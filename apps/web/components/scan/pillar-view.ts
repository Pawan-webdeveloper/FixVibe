/**
 * Which pillars a report opens with, and what it says about the rest.
 *
 * Split out of findings-list.tsx for the same reason uptime-days.ts sits
 * beside uptime-chart.tsx: this is the rule, the component is the markup, and
 * a rule with a sharp edge should be testable without a renderer.
 *
 * The edge: an answer given once, months ago, decides what a reader sees
 * FIRST. It must never decide what they can see at all.
 */

import type { Category } from '@darvin/checks'
import { coveredCategories } from '@/lib/pillars.ts'

export const PILLAR_LABEL: Record<Category, string> = {
  security: 'Security',
  seo: 'SEO',
  aeo: 'AI answer engines',
  performance: 'Performance',
  accessibility: 'Accessibility',
  compliance: 'Compliance',
}

/** Enough of a finding to sort and count. The card owns the rest. */
export interface PillarFinding {
  category: Category
  severity: string
}

/**
 * What the reader asked for, and what is left over.
 *
 * The chosen pillars are the report. The rest are not dropped — they are
 * folded into a disclosure that says how many findings are inside and how bad
 * the worst one is, so the decision to skip them is the READER'S and is made
 * with the number in front of them.
 *
 * That distinction is the whole design. Someone who picked SEO at onboarding
 * and later grows a critical security hole must not have it disappear because
 * of an answer they gave once — but they also asked for a report about SEO,
 * and burying it under five pillars they did not ask about is how a preference
 * becomes decoration. Announced-and-collapsed satisfies both.
 *
 * A reader with no answer, including every signed-out one, sees everything.
 */
export function splitPillars(priorities: readonly Category[] | null): {
  chosen: Category[]
  rest: Category[]
} {
  const covered = coveredCategories()
  if (!priorities?.length) return { chosen: covered, rest: [] }

  const wanted = new Set(priorities)
  // Filtered from `covered`, never from `priorities`, so the tick order in a
  // form is not a ranking: two readers who picked the same pillars get the
  // same report.
  const chosen = covered.filter((c) => wanted.has(c))

  // A stored answer naming nothing we cover — an old category, a hand-edited
  // row. An empty report is the one output that is always wrong.
  if (chosen.length === 0) return { chosen: covered, rest: [] }

  return { chosen, rest: covered.filter((c) => !wanted.has(c)) }
}

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const

/** The worst severity present, or null when there is nothing to rank. */
export function worstOf(findings: readonly PillarFinding[]): string | null {
  for (const severity of SEVERITY_ORDER) {
    if (findings.some((f) => f.severity === severity)) return severity
  }
  return null
}

/**
 * The sentence on the closed disclosure.
 *
 * It names the worst severity inside, because that is the one fact that
 * decides whether opening it matters. "5 other pillars" alone invites the
 * reader to leave a critical finding folded away.
 */
export function describeRest(
  rest: readonly Category[],
  setAside: readonly PillarFinding[],
): string {
  const pillars = `${rest.length} ${rest.length === 1 ? 'pillar' : 'pillars'} you did not pick`
  if (setAside.length === 0) return `${pillars} — every check passed.`

  const found = `${setAside.length} ${setAside.length === 1 ? 'finding' : 'findings'}`
  return `${pillars} — ${found}, worst is ${worstOf(setAside)}. Still scanned, still yours.`
}
