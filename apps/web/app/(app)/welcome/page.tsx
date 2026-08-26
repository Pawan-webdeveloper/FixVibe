import Link from 'next/link'
import { requireUser, safeNextPath } from '@/lib/authz.ts'
import { LabeledRule } from '@/components/ui/labeled-rule.tsx'
import { pillarSummaries, TOTAL_CHECKS } from '@/lib/pillars.ts'
import { savePrioritiesAction } from './actions.ts'

export const metadata = { title: 'What should we lead with' }

/**
 * The one question asked after a first sign-in.
 *
 * It is deliberately not a wizard. A person who has just handed over an email
 * to read a report they already ran is not in the mood for four screens, and
 * every additional step is a place to abandon.
 *
 * It is also honest about what the answer does. Coverage does NOT change —
 * every scan runs every check on every plan, which is the promise the pricing
 * page makes — so this decides ORDER and EMPHASIS, and the copy says exactly
 * that. Selling a preference as a scope would be the same lie as a blurred
 * paywall.
 *
 * Reachable again later, with the current answer pre-ticked, so it doubles as
 * the settings screen for this rather than needing a second one.
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const user = await requireUser('/welcome')
  const { next } = await searchParams
  const returnTo = safeNextPath(next ?? null)

  const pillars = pillarSummaries(0)
  const already = new Set(user.priorities ?? [])
  const returning = user.priorities !== null

  return (
    <div className="mx-auto max-w-2xl px-6 py-12 sm:py-16">
      <LabeledRule label={returning ? 'Priorities' : 'Welcome'} trailing="one question" />

      <h1 className="mt-6 text-2xl font-semibold tracking-[-0.02em] text-balance sm:text-3xl">
        What should your reports lead with?
      </h1>

      <p className="mt-5 max-w-[64ch] text-[15px] leading-relaxed text-muted text-pretty">
        Every scan runs all {TOTAL_CHECKS} checks regardless of what you pick — this does not
        narrow what we look at. It decides what the report puts first, and what an alert wakes you
        up for when a monitored site changes.
      </p>

      <form action={savePrioritiesAction} className="mt-10">
        <input type="hidden" name="next" value={returnTo} />

        <fieldset>
          <legend className="label text-muted">Pick as many as you like</legend>

          <ul className="mt-3 border border-line">
            {pillars.map((pillar) => (
              <li key={pillar.category} className="border-b border-line last:border-0">
                <label className="flex cursor-pointer items-start gap-4 px-5 py-4 hover:bg-surface">
                  <input
                    type="checkbox"
                    name="priority"
                    value={pillar.category}
                    defaultChecked={already.has(pillar.category)}
                    className="mt-1 size-4 shrink-0 accent-[var(--ink)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="font-medium">{pillar.label}</span>
                      <span className="label shrink-0 text-muted tabular-nums">
                        {pillar.count} checks
                      </span>
                    </span>
                    <span className="mt-1 block text-sm text-muted text-pretty">
                      {pillar.question}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        {/*
          Two submits, one action. This is the select-all, and it is a button
          rather than a checkbox that ticks the others because that would need
          client JavaScript to do what a second submit value does for free.
        */}
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            name="mode"
            value="selected"
            className="label inline-flex h-11 items-center border border-ink bg-ink px-6 text-canvas
                       transition-colors duration-150 hover:bg-transparent hover:text-ink"
          >
            Continue →
          </button>

          <button
            type="submit"
            name="mode"
            value="all"
            className="label inline-flex h-11 items-center border border-line px-6
                       transition-colors duration-150 hover:bg-surface"
          >
            All of it
          </button>

          {!returning && (
            <Link href={returnTo} className="label link ml-auto text-muted hover:text-ink">
              Skip for now
            </Link>
          )}
        </div>
      </form>
    </div>
  )
}
