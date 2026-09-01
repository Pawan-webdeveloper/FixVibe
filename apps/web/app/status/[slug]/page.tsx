/**
 * A public uptime page.
 *
 * Readable without an account, because that is the point: it is the link a team
 * posts during an incident, to customers who have no login and are not going to
 * make one. Keyed by slug rather than id — the schema generates one so a
 * shareable URL never carries a UUID.
 *
 * It is also the cheapest acquisition surface in the product. This page sits on
 * somebody else's incident, under our name, in front of their users.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { cache } from 'react'
import { getPublicProjectBySlug, publicUptimeEvents } from '@scanlyfix/db'
import { UptimeChart } from '@/components/monitors/uptime-chart.tsx'
import { LabeledRule } from '@/components/ui/labeled-rule.tsx'

/**
 * Cached for a minute. It is public, it is linked during exactly the moments
 * traffic spikes, and the underlying data changes once a minute at most — so
 * rendering it per request would be paying for nothing at the worst time.
 */
export const revalidate = 60

const load = cache(async (slug: string) => {
  const project = await getPublicProjectBySlug(slug)
  if (!project) return null
  return { project, uptime: await publicUptimeEvents(project.id) }
})

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const data = await load(slug)
  if (!data) return { title: 'Status page not found' }
  return { title: `${data.project.name} status`, description: `Uptime for ${data.project.name}.` }
}

export default async function StatusPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const data = await load(slug)
  // A project with uptime monitoring switched off has no status to publish, and
  // an empty page under someone's name is worse than a 404.
  if (!data?.uptime) notFound()

  const { project, uptime } = data
  const up = uptime.lastStatus === 'up' /* uptime error — match DB status value */

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <LabeledRule label="Status" trailing="checked every minute" />
      <h1 className="mt-6 text-2xl font-semibold tracking-[-0.02em]">{project.name}</h1>
      <p className="mt-1 truncate text-xs text-muted">{project.url}</p>

      <section className="mt-8 border border-line p-6">
        <p className="flex items-center gap-2 text-lg font-medium">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5"
            style={{ backgroundColor: up ? 'var(--good)' : 'var(--critical)' }}
          />
          {up ? 'All systems operational' : 'Currently unreachable'}
        </p>

        <div className="mt-6">
          <UptimeChart events={uptime.events} />
        </div>
      </section>

      <p className="mt-8 text-sm text-muted">
        Checked every minute by{' '}
        <Link href="/" className="link">
          ScanlyFix
        </Link>
        .
      </p>
    </div>
  )
}
