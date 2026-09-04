'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createProjectWithMonitors } from '@scanlyfix/db'
import { getViewer } from '@/lib/authz.ts'
import { normalizeScanTarget } from '@/lib/url.ts'
import { entitlementsFor } from '@/lib/entitlements.ts'

export interface CreateOnboardingProjectResult {
  ok: boolean
  projectId?: string
  slug?: string
  error?: string
}

/**
 * Phase 7.2 onboarding: the wizard's "Set up monitors" step calls this.
 * Same transaction as the dashboard create — project + four default
 * monitors in one write, plan ceiling enforced inside the transaction.
 *
 * The wizard passes the URL it already validated in step 1 — re-validating
 * here means the server never trusts a client string.
 *
 * Returns the project id + slug so the wizard can navigate to the
 * project page (step 4 onward) and the status page (step 6) without a
 * second round trip.
 */
export async function createOnboardingProjectAction(
  url: string,
  name: string | null,
): Promise<CreateOnboardingProjectResult> {
  const viewer = await getViewer()
  if (viewer.kind !== 'user') return { ok: false, error: 'Sign in to create a project.' }

  const target = normalizeScanTarget(url)
  if (!target.ok) return { ok: false, error: target.reason }

  const { plan } = await entitlementsFor(viewer)
  const result = await createProjectWithMonitors(
    viewer,
    {
      name: (name ?? '').trim() || target.hostname,
      url: target.url,
      orgId: '', // entitlementsFor ensures a default org; createProjectWithMonitors
                // is currently org-agnostic at the project row — the
                // monitor-bootstrap is the same regardless. Phase 7.3
                // will thread orgId through the wizard explicitly.
    },
    plan.projects,
  )

  if (!result.ok) {
    if (result.reason === 'limit-reached') {
      return {
        ok: false,
        error:
          `The ${plan.name} plan includes ${plan.projects} ` +
          `${plan.projects === 1 ? 'project' : 'projects'}. Upgrade to track more sites.`,
      }
    }
    return { ok: false, error: 'Could not create the project.' }
  }

  revalidatePath('/dashboard')
  return {
    ok: true,
    projectId: result.project.id,
    slug: result.project.slug,
  }
}

/**
 * Convenience: redirect-after-create variant for forms that want the
 * server to do the navigation. The wizard uses the explicit result
 * shape instead so the step machine can sequence the next step
 * without a redirect race.
 */
export async function createOnboardingProjectAndRedirect(
  url: string,
  name: string | null,
): Promise<void> {
  const result = await createOnboardingProjectAction(url, name)
  if (!result.ok || !result.projectId) return
  redirect(`/projects/${result.projectId}`)
}
