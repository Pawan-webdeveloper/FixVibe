import { ENGINE_VERSION } from '@darvin/checks'
import { ScoreRing } from '@/components/scan/score-ring.tsx'
import { PillarScores } from '@/components/scan/pillar-scores.tsx'
import { FindingCard } from '@/components/scan/finding-card.tsx'
import { Section, SectionHeading } from './section.tsx'
import { SAMPLE, SAMPLE_FINDINGS, SAMPLE_SCORES } from './sample-report.ts'
import { TOTAL_CHECKS } from '@/lib/pillars.ts'

/**
 * The hero image, which is not an image.
 *
 * It is the report's own components — ScoreRing, PillarScores, FindingCard —
 * rendered from a recorded real scan. A screenshot would go stale the first
 * time the report changed and a mockup would be a drawing of a product rather
 * than the product; this cannot drift from what a visitor gets, because it IS
 * what a visitor gets.
 *
 * Nothing here ships JavaScript: none of those three components has state, and
 * the sample findings carry no fix prompt, which is what would pull in the
 * copy button.
 */
export function ReportPreview() {
  const facts: Array<[string, string]> = [
    ['HTTP', String(SAMPLE.status)],
    ['Checks', String(TOTAL_CHECKS)],
    ['Duration', `${SAMPLE.durationMs} ms`],
    ['Engine', ENGINE_VERSION],
  ]

  return (
    <Section id="report">
      <SectionHeading
        index={1}
        eyebrow="The report"
        title="This is what comes back"
        lead="Not a mockup — the components below are the report's own, rendered from a recorded scan of example.com. A screenshot would go stale; this cannot drift from what a visitor gets, because it is what a visitor gets."
      />

      <figure className="relative mt-12">
      {/* The pool of light under the score, and the reason the card reads as
          lit rather than merely bordered. Decorative. */}
      <div
        aria-hidden="true"
        className="glow pointer-events-none absolute -top-16 left-1/2 h-72 w-full max-w-[36rem] -translate-x-1/2"
      />

      <div className="scan-sweep relative overflow-hidden border border-line bg-elevated shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-line px-5 py-3">
          <p className="font-mono text-sm font-medium">{SAMPLE.host}</p>
          <dl className="flex flex-wrap items-center gap-x-5 gap-y-1">
            {facts.map(([key, value]) => (
              <div key={key} className="flex items-baseline gap-1.5">
                <dt className="font-mono text-[10px] uppercase tracking-wider text-muted">{key}</dt>
                <dd className="font-mono text-xs tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </header>

        <div className="flex flex-col items-center gap-8 px-5 py-8 sm:flex-row sm:px-8">
          <ScoreRing score={SAMPLE_SCORES.overall} size={148} />
          <div className="w-full flex-1">
            <PillarScores scores={SAMPLE_SCORES} />
          </div>
        </div>

        <div className="border-t border-line px-5 py-6 sm:px-8">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted">
            Worst findings first
          </p>
          <div className="flex flex-col gap-3">
            {SAMPLE_FINDINGS.map((finding) => (
              <FindingCard key={finding.checkId} finding={finding} />
            ))}
          </div>
          <p className="mt-4 text-sm text-muted">
            …and {SAMPLE.findingCount - SAMPLE_FINDINGS.length} more, grouped by pillar.
          </p>
        </div>
      </div>

      {/* Said plainly, because the entire argument of this page is that the
          engine reports what it observed. An unlabelled mockup here would be
          the one dishonest thing on the site. */}
      <figcaption className="mt-4 text-sm text-muted">
        A real scan of{' '}
        <span className="font-mono">{SAMPLE.host}</span>, recorded {SAMPLE.scannedAt}. Overall 87
        looks healthy; the security pillar underneath it is 39.
      </figcaption>
      </figure>
    </Section>
  )
}
