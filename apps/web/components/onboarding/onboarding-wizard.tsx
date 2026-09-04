'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LabeledRule } from '@/components/ui/labeled-rule.tsx'
import { OnboardingStepper, type OnboardingStepKey } from './onboarding-stepper.tsx'
import { OnboardingStepUrl } from './onboarding-step-url.tsx'
import { OnboardingStepChecks } from './onboarding-step-checks.tsx'
import { OnboardingStepMonitors } from './onboarding-step-monitors.tsx'
import { OnboardingStepAlerts } from './onboarding-step-alerts.tsx'
import { OnboardingStepStatus } from './onboarding-step-status.tsx'

/**
 * The 6-step onboarding state machine.
 *
 * State is held at the top here, not in each step, because the steps
 * share two things: the URL the user picked, and the project id +
 * slug that step 4 produces. Lifting state down into each step would
 * either thread props through every transition or stash them in a
 * ref, neither of which reads as well as a `useState` here.
 *
 * The transitions are deliberately one-way:
 *   url → checks → monitors → alerts → status
 * with two allowed backward steps:
 *   checks → url        (the "Pick a different site" button)
 *   monitors → checks   (only if the user wants to revisit the probe)
 *
 * Why no forward-skip on checks → monitors (skipping the scorecard
 * summary): the scorecard is the proof the wizard is doing
 * something useful. Skipping it would make step 4 feel like a
 * non-sequitur. If the user has seen enough, the "Monitor this
 * site" button at the bottom of step 2 is the skip; everything past
 * it is "yes, do it".
 *
 * What this component does NOT own:
 *   - Validation (in normalizeScanTarget — shared with the rest of the app)
 *   - Project creation (in createOnboardingProjectAction — shared)
 *   - The four checks (in /api/onboarding/check — a server fan-out)
 *   - Email verification (in Supabase — invoked by step 5)
 *
 * Keeping that off the wizard is what makes the wizard a presentation
 * layer over already-existing pieces: each step is a few lines of
 * composition, not a self-contained subsystem.
 */

export interface OnboardingWizardProps {
  email: string
  emailVerified: boolean
}

interface WizardState {
  step: OnboardingStepKey
  url: string | null
  hostname: string | null
  project: { id: string; slug: string; name: string } | null
}

const INITIAL_STATE: WizardState = {
  step: 'url',
  url: null,
  hostname: null,
  project: null,
}

export function OnboardingWizard({ email, emailVerified }: OnboardingWizardProps) {
  const router = useRouter()
  const [state, setState] = useState<WizardState>(INITIAL_STATE)

  const setStep = useCallback((step: OnboardingStepKey) => {
    setState((current) => ({ ...current, step }))
  }, [])

  const handleUrlSubmit = useCallback((normalizedUrl: string, hostname: string) => {
    setState({ step: 'checks', url: normalizedUrl, hostname, project: null })
  }, [])

  const handleChecksContinue = useCallback(() => {
    setState((current) => ({ ...current, step: 'monitors' }))
  }, [])

  const handleRetarget = useCallback(() => {
    setState((current) => ({ ...current, step: 'url' }))
  }, [])

  const handleMonitorsCreated = useCallback((created: { projectId: string; slug: string }) => {
    setState((current) => ({
      step: 'alerts',
      url: current.url,
      hostname: current.hostname,
      project: {
        id: created.projectId,
        slug: created.slug,
        name: current.hostname ?? created.slug,
      },
    }))
  }, [])

  const handleMonitorsSkip = useCallback(() => {
    router.push('/dashboard')
  }, [router])

  const handleAlertsContinue = useCallback(() => {
    setState((current) => ({ ...current, step: 'status' }))
  }, [])

  const handleOpenProject = useCallback(() => {
    if (state.project) router.push(`/projects/${state.project.id}`)
  }, [router, state.project])

  const handleDashboard = useCallback(() => {
    router.push('/dashboard')
  }, [router])

  const headline = useMemo(() => STEP_HEADLINES[state.step], [state.step])

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10 sm:px-10 sm:py-14">
      <LabeledRule label="Set up monitoring" trailing={`step ${STEP_INDEX[state.step] + 1} of ${STEP_TOTAL}`} />

      <OnboardingStepper active={state.step} />

      <header className="mt-4">
        <h1 className="text-[28px] font-light leading-tight tracking-[-0.02em] text-c-ink sm:text-[32px]">
          {headline}
        </h1>
        <p className="mt-2 max-w-[60ch] text-[14px] leading-relaxed text-c-body text-pretty">
          {STEP_SUBTITLES[state.step]}
        </p>
      </header>

      {state.step === 'url' && (
        <OnboardingStepUrl onSubmit={handleUrlSubmit} initialValue={state.url ?? ''} />
      )}

      {state.step === 'checks' && state.url !== null && state.hostname !== null && (
        <OnboardingStepChecks
          url={state.url}
          hostname={state.hostname}
          onContinue={handleChecksContinue}
          onRetarget={handleRetarget}
          onStepChange={setStep}
        />
      )}

      {state.step === 'monitors' && state.url !== null && state.hostname !== null && (
        <OnboardingStepMonitors
          url={state.url}
          hostname={state.hostname}
          onCreated={handleMonitorsCreated}
          onSkip={handleMonitorsSkip}
        />
      )}

      {state.step === 'alerts' && (
        <OnboardingStepAlerts
          email={email}
          emailVerified={emailVerified}
          onContinue={handleAlertsContinue}
        />
      )}

      {state.step === 'status' && state.project !== null && (
        <OnboardingStepStatus
          slug={state.project.slug}
          projectName={state.project.name}
          projectUrl={state.url ?? ''}
          projectId={state.project.id}
          onOpenProject={handleOpenProject}
          onDashboard={handleDashboard}
        />
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Copy                                                                       */
/* -------------------------------------------------------------------------- */

const STEP_INDEX: Record<OnboardingStepKey, number> = {
  url: 0,
  checks: 1,
  score: 2,
  monitors: 3,
  alerts: 4,
  status: 5,
}
const STEP_TOTAL = Object.keys(STEP_INDEX).length

const STEP_HEADLINES: Record<OnboardingStepKey, string> = {
  url: 'What site should we watch?',
  checks: 'Probing your site.',
  score: 'Here is what we found.',
  monitors: 'We can monitor this every minute.',
  alerts: 'How should we tell you when something breaks?',
  status: 'Your status page is live.',
}

const STEP_SUBTITLES: Record<OnboardingStepKey, string> = {
  url: 'Paste the URL of the site you want us to keep an eye on. We will run a quick probe so you can see what we are about to monitor.',
  checks: 'Four quick checks in parallel — uptime, SSL, domain expiry, and web vitals. Results animate in as they land.',
  score: 'A green row is healthy, amber is worth watching, red needs attention now. You decide what to do next.',
  monitors: 'We start four default monitors on a one-minute cadence. Edit cadence, types, or alert thresholds from the project page any time.',
  alerts: 'Without alerts, the first incident is the one you hear about from a customer. The fix is one click — but only if we can reach you.',
  status: 'Share this link with your team or your customers. It updates every minute and never asks for a login.',
}
