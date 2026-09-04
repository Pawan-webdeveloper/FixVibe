/**
 * apps/web/app/(app)/onboarding/page.tsx
 *
 * Phase 7.2 onboarding analysis wizard.
 *
 * The page is intentionally thin: it asks two questions of the database
 * (does this user already have a project? has their email been verified?)
 * and hands the answers to the client component, which owns the 6-step
 * state machine. The page itself does no work because every answer to
 * "show me a step" is held in the wizard's state — re-rendering the
 * server tree on every step transition would be paying for nothing.
 *
 * Why the email-verified flag is fetched here and not by the client:
 *   - Supabase exposes `email_confirmed_at` on the auth user, which the
 *     browser SDK will not share with an arbitrary page render. Reading
 *     it server-side via the Supabase client is one round trip and lives
 *     in this file rather than in the API route because the page is
 *     already authenticated.
 *   - The flag is not security-sensitive: the wizard hides the CTA
 *     based on it but never enforces it. A user who edits the response
 *     to skip verification still cannot get alerts sent — the alert
 *     path checks the same flag before sending.
 *
 * Already-tracked branch: a user with one or more projects skips the
 * wizard entirely and lands on the dashboard. The acceptance test
 * ("new user end-to-end < 2 min") is for first-run only; rerunning
 * the wizard after a project exists would only re-create the same
 * project, and silently dropping the user on the dashboard keeps the
 * flow honest about who it is for.
 */

import { redirect } from 'next/navigation'
import { getViewer, requireUser } from '@/lib/authz.ts'
import { listProjects } from '@scanlyfix/db'
import { createClient } from '@/lib/supabase/server.ts'
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard.tsx'

export const metadata = { title: 'Set up monitoring' }

/**
 * Supabase reports verification as `email_confirmed_at: ISO string | null`.
 * We treat non-null as verified; null means the user has not yet clicked
 * the link. The auth provider also stamps this when an admin confirms
 * an email from the dashboard, so a confirmed-by-admin user also reads
 * as verified.
 *
 * One round trip to Supabase. The page is authenticated and the
 * cookie has already been read by the time we get here, so a single
 * `getUser()` call returns both the identity we need for the rest
 * of the page (via `requireUser`/`getViewer`) and this one field.
 */
async function readEmailVerified(): Promise<boolean> {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  return Boolean(data.user?.email_confirmed_at)
}

export default async function OnboardingPage() {
  const user = await requireUser('/onboarding')

  const viewer = await getViewer()
  const [projects, emailVerified] = await Promise.all([listProjects(viewer), readEmailVerified()])

  // A user with an existing project is not "new" — the wizard exists to
  // set up a first project, and rerunning it would re-prompt the four
  // checks against a domain they have already chosen. Send them to the
  // dashboard where the existing flow takes over.
  if (projects.length > 0) redirect('/dashboard')

  return (
    <div className="console flex min-h-dvh flex-col bg-c-bg text-c-ink">
      <OnboardingWizard email={user.email} emailVerified={emailVerified} />
    </div>
  )
}
