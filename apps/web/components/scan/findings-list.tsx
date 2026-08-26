/**
 * Findings, grouped by pillar.
 *
 * Within a pillar the engine's order is preserved exactly — it already sorts
 * worst-first and then by check id, and re-sorting here would let the web
 * report and the CLI disagree about the same scan.
 *
 * A pillar that was checked and came back clean gets a row saying so. Silence
 * would read as "not checked", which is the opposite of the truth and throws
 * away the most reassuring thing the report can say.
 *
 * The pillar headings are the same numbered rule the landing page uses for its
 * sections, so a reader who arrived from that page is reading the same grammar.
 */

import type { Category } from '@darvin/checks'
import { LabeledRule } from '@/components/ui/labeled-rule.tsx'
import { coveredCategories } from '@/lib/pillars.ts'
import { FindingCard, type FindingView } from './finding-card.tsx'

const LABEL: Record<Category, string> = {
  security: 'Security',
  seo: 'SEO',
  aeo: 'AI answer engines',
  performance: 'Performance',
  accessibility: 'Accessibility',
  compliance: 'Compliance',
}

/**
 * Pillars the reader asked us to lead with come first; the rest keep the
 * engine's own order behind them. Nothing is hidden — a priority moves a
 * section up the page, it never removes one, because the scan measured all of
 * it and a report that quietly dropped a pillar would be lying by omission.
 */
function orderedPillars(priorities: readonly Category[] | null): Category[] {
  const covered = coveredCategories()
  if (!priorities?.length) return covered

  const wanted = new Set(priorities)
  return [...covered.filter((c) => wanted.has(c)), ...covered.filter((c) => !wanted.has(c))]
}

export function FindingsList({
  findings,
  priorities = null,
  lockedNote,
}: {
  findings: readonly FindingView[]
  /** Pillars this reader chose at onboarding; null when they never answered. */
  priorities?: readonly Category[] | null
  /** Passed straight through: only the page knows which gate applies. */
  lockedNote?: string
}) {
  const leading = new Set(priorities ?? [])

  return (
    <div className="flex flex-col gap-12">
      {orderedPillars(priorities).map((pillar, index) => {
        const inPillar = findings.filter((f) => f.category === pillar)

        return (
          <section key={pillar} aria-labelledby={`pillar-${pillar}`}>
            <LabeledRule
              as="h2"
              id={`pillar-${pillar}`}
              index={index + 1}
              label={leading.has(pillar) ? `${LABEL[pillar]} ★` : LABEL[pillar]}
              trailing={inPillar.length === 0 ? 'clean' : `${inPillar.length} found`}
            />

            {inPillar.length === 0 ? (
              <p className="mt-4 border border-line bg-surface px-4 py-3 text-sm text-muted">
                Every {LABEL[pillar].toLowerCase()} check passed.
              </p>
            ) : (
              <div className="mt-4 flex flex-col gap-3">
                {inPillar.map((finding, i) => (
                  <FindingCard
                    key={`${finding.checkId}-${i}`}
                    finding={finding}
                    {...(lockedNote ? { lockedNote } : {})}
                  />
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
