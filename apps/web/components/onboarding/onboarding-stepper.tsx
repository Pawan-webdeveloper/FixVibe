/**
 * apps/web/components/onboarding/onboarding-stepper.tsx
 *
 * The progress strip that sits above every step.
 *
 * Five labelled dots, with the active one filled and the past ones
 * shown in the terminal-mint accent. The copy ("Set up", "Probe",
 * "Score", "Monitor", "Alert", "Share") is the same vocabulary the
 * wizard's headlines use, so the strip reads as a table of contents
 * rather than a meter.
 *
 * The active step is not just visually distinguished: its label is
 * the headline of the current step's `<h1>`. Two announcements of
 * the same fact would be noise; one label and one filled dot is the
 * minimum that says "you are here".
 *
 * Why a flat list and not a real progress bar:
 *   - The wizard is six linear steps with no skip path; a 0–100 bar
 *     would convey the same information more slowly (the eye has to
 *     measure) and would suggest the user can click a future step to
 *     jump there, which they cannot.
 *   - Each step's progress within itself (e.g. "checking… 2 of 4") is
 *     shown inline in that step's body — a single source of truth
 *     for "how far along".
 */

const STEPS = [
  { key: 'url', label: 'Set up' },
  { key: 'checks', label: 'Probe' },
  { key: 'score', label: 'Score' },
  { key: 'monitors', label: 'Monitor' },
  { key: 'alerts', label: 'Alert' },
  { key: 'status', label: 'Share' },
] as const

export type OnboardingStepKey = (typeof STEPS)[number]['key']

export const ONBOARDING_STEP_KEYS = STEPS.map((s) => s.key)

export function OnboardingStepper({ active }: { active: OnboardingStepKey }) {
  const activeIndex = STEPS.findIndex((s) => s.key === active)

  return (
    <ol aria-label="Onboarding progress" className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {STEPS.map((step, index) => {
        const isPast = index < activeIndex
        const isActive = index === activeIndex
        return (
          <li key={step.key} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-semibold tabular-nums transition-colors ${
                isActive
                  ? 'bg-c-ink text-c-brand-ink'
                  : isPast
                    ? 'border border-c-ink text-c-ink'
                    : 'border border-c-line text-c-muted'
              }`}
            >
              {index + 1}
            </span>
            <span
              className={`label transition-colors ${
                isActive ? 'text-c-ink' : isPast ? 'text-c-body' : 'text-c-muted'
              }`}
            >
              {step.label}
            </span>
            {index < STEPS.length - 1 && (
              <span aria-hidden="true" className="ml-1 h-px w-4 bg-c-line" />
            )}
          </li>
        )
      })}
    </ol>
  )
}
