/**
 * Status-page polish — owner-controlled project settings (Phase 6.4).
 *
 * Three columns on `projects`:
 *   - logo_url         — image URL, https-only
 *   - brand_color      — #RRGGBB hex, applied as a dot accent + border tint
 *   - robots_indexable — default true; the public page emits noindex when false
 *
 * All three are nullable / default-off, so a project created before this
 * migration behaves exactly as it did until the owner opts in.
 *
 * ## Why this lives here, not in projects.ts
 *
 * `projects.ts` is the read/write surface for the rows every other query
 * joins against. Putting status-page polish next to `getProject` would
 * couple the brand colour to the dashboard's project lookup, and a
 * later dashboard re-design would either drag the brand fields along or
 * need a refactor to peel them back out. Splitting them keeps each
 * surface small.
 */

import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../client.ts'
import { projects } from '../schema.ts'
import { getProject } from './projects.ts'
import type { Viewer } from './viewer.ts'

/* -------------------------------------------------------------------------- */
/* Pure validators                                                             */
/* -------------------------------------------------------------------------- */

/**
 * #RRGGBB — case-insensitive, no alpha. Matches CSS color: # notation.
 * Validated at the API edge so a stray CSS keyword or named colour
 * cannot make it into the row and break inline-style rendering.
 */
const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/

export function isHexColor(value: string): boolean {
  return HEX_COLOR_REGEX.test(value)
}

/**
 * URL must be https — http:// in the public header would let an attacker
 * inject mixed-content blocks. We do not enforce a domain allowlist
 * here because the owner controls the project and would only hurt
 * themselves by pointing a logo at a hostile origin.
 *
 * Also accepts a data: URL for SVG logos — small, no third-party
 * request, no CORS concern. Image type sniffed in the renderer.
 */
const HTTPS_URL_REGEX = /^https:\/\//i
const DATA_URL_REGEX = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i

export function isValidLogoUrl(value: string): boolean {
  return HTTPS_URL_REGEX.test(value) || DATA_URL_REGEX.test(value)
}

/* -------------------------------------------------------------------------- */
/* zod schemas                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * What the settings form sends. Empty strings are normalised to null
 * BEFORE zod — the form uses empty for "clear this field", and an
 * optional<string>() with `.nullable()` would let through values the
 * row should not accept.
 */
export const ProjectBrandingInputSchema = z.object({
  logoUrl: z
    .string()
    .max(2048)
    .refine(isValidLogoUrl, 'Logo URL must be https:// or a base64 data: URL')
    .nullable(),
  brandColor: z
    .string()
    .max(7)
    .refine(isHexColor, 'Brand color must be a 6-digit hex like #1A73E8')
    .nullable(),
  robotsIndexable: z.boolean(),
})
export type ProjectBrandingInput = z.infer<typeof ProjectBrandingInputSchema>

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export interface ProjectBranding {
  logoUrl: string | null
  brandColor: string | null
  robotsIndexable: boolean
}

/**
 * Auth-gated. Owner-only — same rule as `getProject`.
 */
export async function getProjectBranding(
  projectId: string,
  viewer: Viewer,
): Promise<ProjectBranding | null> {
  const project = await getProject(projectId, viewer)
  if (!project) return null
  return {
    logoUrl: project.logoUrl ?? null,
    brandColor: project.brandColor ?? null,
    robotsIndexable: project.robotsIndexable ?? true,
  }
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Auth-gated update. Returns the updated row on success, null on auth
 * or validation failure (the route maps null → 404 / 400 as
 * appropriate — the form does not need to distinguish).
 *
 * Empty string for an optional field is treated as "clear it" — the
 * form lets the user wipe a setting by clearing the input. Caller is
 * expected to normalise empty → null BEFORE invoking.
 */
export async function updateProjectBranding(
  projectId: string,
  viewer: Viewer,
  input: ProjectBrandingInput,
): Promise<ProjectBranding | null> {
  const project = await getProject(projectId, viewer)
  if (!project) return null

  const [updated] = await db
    .update(projects)
    .set({
      logoUrl: input.logoUrl,
      brandColor: input.brandColor,
      robotsIndexable: input.robotsIndexable,
    })
    .where(eq(projects.id, projectId))
    .returning({
      logoUrl: projects.logoUrl,
      brandColor: projects.brandColor,
      robotsIndexable: projects.robotsIndexable,
    })

  if (!updated) return null

  return {
    logoUrl: updated.logoUrl ?? null,
    brandColor: updated.brandColor ?? null,
    robotsIndexable: updated.robotsIndexable ?? true,
  }
}
