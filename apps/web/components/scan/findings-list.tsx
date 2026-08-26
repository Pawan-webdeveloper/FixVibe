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

import { allChecks, type Category } from '@darvin/checks'
import { LabeledRule } from '@/components/ui/labeled-rule.tsx'
import { FindingCard, type FindingView } from './finding-card.tsx'

const LABEL: Record<Category, string> = {
  security: 'Security',
  seo: 'SEO',
  aeo: 'AI answer engines',
  performance: 'Performance',
  accessibility: 'Accessibility',
  compliance: 'Compliance',
}

function coveredPillars(): Category[] {
  const counts = new Map<Category, number>()
  for (const check of allChecks) counts.set(check.category, (counts.get(check.category) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([category]) => category)
}

export function FindingsList({ findings }: { findings: readonly FindingView[] }) {
  return (
    <div className="flex flex-col gap-12">
      {coveredPillars().map((pillar, index) => {
        const inPillar = findings.filter((f) => f.category === pillar)

        return (
          <section key={pillar} aria-labelledby={`pillar-${pillar}`}>
            <LabeledRule
              as="h2"
              id={`pillar-${pillar}`}
              index={index + 1}
              label={LABEL[pillar]}
              trailing={inPillar.length === 0 ? 'clean' : `${inPillar.length} found`}
            />

            {inPillar.length === 0 ? (
              <p className="mt-4 border border-line bg-surface px-4 py-3 text-sm text-muted">
                Every {LABEL[pillar].toLowerCase()} check passed.
              </p>
            ) : (
              <div className="mt-4 flex flex-col gap-3">
                {inPillar.map((finding, i) => (
                  <FindingCard key={`${finding.checkId}-${i}`} finding={finding} />
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
