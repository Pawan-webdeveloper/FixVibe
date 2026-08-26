import { allChecks, type Category } from '@darvin/checks'

/**
 * Everything the landing page says about coverage, derived from the registry.
 *
 * The page must never be able to advertise a check the engine does not run, so
 * no count and no check name on it is typed by hand. Adding a check to
 * registry.ts updates the marketing copy in the same commit, and removing one
 * cannot leave a claim behind.
 */

export const TOTAL_CHECKS = allChecks.length

const LABEL: Record<Category, string> = {
  security: 'Security',
  seo: 'SEO',
  aeo: 'AI answer engines',
  performance: 'Performance',
  accessibility: 'Accessibility',
  compliance: 'Compliance',
}

/**
 * The question each pillar answers. Editorial — it is the one thing here that
 * cannot be derived, because the registry knows what a check does and not why
 * a reader should care.
 */
const QUESTION: Record<Category, string> = {
  security: 'Can a stranger read, hijack or impersonate this site?',
  seo: 'Can a search engine crawl, understand and rank these pages?',
  aeo: 'Can an answer engine read, resolve and cite this page?',
  performance: 'How long does this take on a real phone, on a real network?',
  accessibility: 'Can someone using a keyboard or a screen reader get through it?',
  compliance: 'Does anything run before the visitor agreed to it?',
}

export interface PillarSummary {
  category: Category
  label: string
  question: string
  count: number
  /** Check titles in registry order, which puts the load-bearing ones first. */
  examples: readonly string[]
}

/** Pillars that actually have checks, largest first — the order every surface uses. */
export function pillarSummaries(examplesPerPillar = 4): PillarSummary[] {
  const grouped = new Map<Category, string[]>()
  for (const check of allChecks) {
    const titles = grouped.get(check.category) ?? []
    titles.push(check.title)
    grouped.set(check.category, titles)
  }

  return [...grouped.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([category, titles]) => ({
      category,
      label: LABEL[category],
      question: QUESTION[category],
      count: titles.length,
      examples: titles.slice(0, examplesPerPillar),
    }))
}

/** Every check in one pillar, for the sections that list a pillar in full. */
export function checkTitlesIn(category: Category): string[] {
  return allChecks.filter((check) => check.category === category).map((check) => check.title)
}
