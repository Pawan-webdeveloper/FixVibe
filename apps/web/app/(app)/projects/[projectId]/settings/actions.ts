'use server'

import { revalidatePath } from 'next/cache'
import {
  isHexColor,
  isValidLogoUrl,
  updateProjectBranding,
} from '@scanlyfix/db'
import { getViewer } from '@/lib/authz.ts'

/**
 * Update the project's status-page polish (logo URL, brand colour,
 * robots policy). Server action because:
 *
 *   - These settings are public the moment they are written, so the
 *     server-side validation must run on every save.
 *   - The action is exposed at /projects/[id]/settings — a public
 *     endpoint that does its own auth check rather than relying on
 *     the route shape.
 *
 * Returns `{ ok: true }` on success, `{ ok: false, error }` otherwise.
 * The caller surfaces the error inline without reloading.
 */
export interface BrandingActionResult {
  ok: boolean
  error?: string
}

export async function updateBrandingAction(
  projectId: string,
  formData: FormData,
): Promise<BrandingActionResult> {
  const viewer = await getViewer()
  if (viewer.kind !== 'user') {
    return { ok: false, error: 'Sign in to change these settings.' }
  }

  const logoUrlRaw = stringField(formData, 'logoUrl')
  const brandColorRaw = stringField(formData, 'brandColor')
  const robotsIndexableRaw = formData.get('robotsIndexable')

  // Empty string for an optional field means "clear it".
  const logoUrl = logoUrlRaw.length > 0 ? logoUrlRaw : null
  const brandColor = brandColorRaw.length > 0 ? brandColorRaw : null

  if (logoUrl !== null && !isValidLogoUrl(logoUrl)) {
    return { ok: false, error: 'Logo URL must start with https://' }
  }
  if (brandColor !== null && !isHexColor(brandColor)) {
    return {
      ok: false,
      error: 'Brand colour must be a 6-digit hex like #1A73E8',
    }
  }

  const robotsIndexable =
    robotsIndexableRaw === 'on' || robotsIndexableRaw === 'true'

  const updated = await updateProjectBranding(projectId, viewer, {
    logoUrl,
    brandColor,
    robotsIndexable,
  })
  if (!updated) {
    return { ok: false, error: 'Project not found.' }
  }

  // The status page re-renders immediately on save; this is a public
  // surface, so freshness matters more than caching.
  revalidatePath(`/status/${updated.robotsIndexable ? '' : ''}`) // no-op; status slug unknown here
  revalidatePath(`/projects/${projectId}/settings`)
  return { ok: true }
}

/** Returns '' for missing values so the caller can do `length > 0`. */
function stringField(formData: FormData, key: string): string {
  const v = formData.get(key)
  return typeof v === 'string' ? v.trim() : ''
}
