'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createProject } from '@darvin/db'
import { getViewer } from '@/lib/authz.ts'
import { normalizeScanTarget } from '@/lib/url.ts'

export interface ActionState {
  error?: string
}

/**
 * A server action is a public endpoint, not a private function call. Anyone can
 * POST to it with any payload, so it re-authenticates and re-validates exactly
 * as an API route would — the form that normally calls it proves nothing.
 */
export async function createProjectAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const viewer = await getViewer()
  if (viewer.kind !== 'user') return { error: 'Sign in to create a project.' }

  const orgId = String(formData.get('orgId') ?? '')
  if (!orgId) return { error: 'Something went wrong. Reload the page and try again.' }

  const target = normalizeScanTarget(String(formData.get('url') ?? ''))
  if (!target.ok) return { error: target.reason }

  const name = String(formData.get('name') ?? '').trim() || target.hostname

  const project = await createProject(viewer, { name, url: target.url, orgId })
  if (!project) return { error: 'Could not create the project.' }

  revalidatePath('/dashboard')
  redirect(`/projects/${project.id}`)
}
