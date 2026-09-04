/**
 * Project settings — status-page polish (Phase 6.4).
 *
 * Three owner-controlled settings on the public status page:
 *   - Logo URL
 *   - Brand colour
 *   - robots_indexable (default true; owner can opt out)
 *
 * The page is intentionally minimal: there are no other settings here
 * yet, and adding them later should not require a redesign.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getProject, getProjectBranding } from '@scanlyfix/db'
import { getViewer, requireUser } from '@/lib/authz.ts'
import { BrandingForm } from './branding-form.tsx'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const metadata = { title: 'Project settings' }

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  if (!UUID.test(projectId)) notFound()

  await requireUser(`/projects/${projectId}/settings`)
  const viewer = await getViewer()
  const project = await getProject(projectId, viewer)
  if (!project) notFound()

  const branding = await getProjectBranding(projectId, viewer)
  if (!branding) notFound()

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <header className="border-b border-gray-100 pb-5">
        <Link
          href={`/projects/${projectId}`}
          className="text-sm text-muted hover:text-ink"
        >
          ← {project.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Status page</h1>
        <p className="mt-1 truncate font-mono text-xs text-muted">{project.url}</p>
      </header>

      <section className="mt-8">
        <h2 className="mb-1 text-sm font-medium text-gray-700">Branding</h2>
        <p className="mb-5 text-xs text-gray-500">
          Customise how your public status page looks. All three are
          optional — the page keeps its clean default look when nothing
          is set.
        </p>
        <BrandingForm
          projectId={projectId}
          initial={branding}
          statusSlug={project.slug}
        />
      </section>
    </div>
  )
}
