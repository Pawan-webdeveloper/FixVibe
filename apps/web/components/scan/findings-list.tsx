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
import { FindingCard, type FindingView } from './finding-card.tsx'
import { describeRest, PILLAR_LABEL as LABEL, splitPillars } from './pillar-view.ts'

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
  const { chosen, rest } = splitPillars(priorities)
  const setAside = findings.filter((f) => rest.includes(f.category))

  const pillarSection = (pillar: Category, index: number) => {
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
  }

  return (
    <div className="flex flex-col gap-12">
      {chosen.map(pillarSection)}

      {rest.length > 0 && (
        /*
         * <details> rather than a client component: it is one open/close with
         * no state to share, and the browser gives keyboard support, the right
         * ARIA and search-in-page for free. This whole report otherwise ships
         * no JavaScript.
         */
        <details className="border border-line">
          <summary className="cursor-pointer px-5 py-4 hover:bg-surface">
            <span className="label text-ink">The rest of the scan</span>
            <span className="mt-1 block text-sm text-muted text-pretty">
              {describeRest(rest, setAside)}
            </span>
          </summary>

          <div className="flex flex-col gap-12 border-t border-line px-5 py-8">
            {rest.map((pillar, index) => pillarSection(pillar, chosen.length + index))}
          </div>
        </details>
      )}
    </div>
  )
}

