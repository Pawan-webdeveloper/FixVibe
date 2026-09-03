/*
 * Public status page — no authentication required.
 *
 * Route: /status/[slug]
 *
 * This sits OUTSIDE the (app) group deliberately:
 *   - (app) routes are behind auth middleware
 *   - /status/[slug] must be accessible to anyone — customers,
 *     external monitors, status checkers — with no login wall
 *
 * Security:
 *   - Returns only public data (name, url, uptime %, incidents)
 *   - No user ids, emails, or internal ids exposed
 *   - Slug is not a secret — it appears in shared URLs by design
 *   - notFound() on unknown slugs — no enumeration risk beyond
 *     the slug itself, which the project owner controls
 *
 * Performance:
 *   - Server component — no client JS bundle
 *   - revalidate = 60: fresh enough, cached enough
 *   - All data in one DB round-trip set (getPublicStatus)
 */

import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getPublicStatus } from '@scanlyfix/db'
import { StatusHeader } from '@/components/status/status-header'
import { UptimeStrip } from '@/components/status/uptime-strip'
import { IncidentsTable } from '@/components/status/incidents-table'

/** Revalidate every 60 seconds — matches the uptime check interval. */
export const revalidate = 60

interface Props {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const data = await getPublicStatus(slug)
  if (!data) return { title: 'Status — ScanlyFix' }

  return {
    title: `${data.projectName} Status`,
    description: `Live uptime and incident history for ${data.projectUrl}`,
    // No index — status pages are for customers, not search engines.
    robots: { index: false },
  }
}

export default async function StatusPage({ params }: Props) {
  const { slug } = await params

  // Validate slug — only lowercase letters, numbers, hyphens.
  // Rejects path traversal and injection attempts before hitting the DB.
  if (!/^[a-z0-9-]+$/.test(slug)) notFound()

  const data = await getPublicStatus(slug)
  if (!data) notFound()

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-2xl px-4 py-12">

        {/* Header — current status + uptime % */}
        <StatusHeader
          projectName={data.projectName}
          projectUrl={data.projectUrl}
          currentStatus={data.currentStatus}
          lastCheckedAt={data.lastCheckedAt}
          uptimePercent={data.uptimePercent}
        />

        {/* 90-day uptime strip */}
        <div className="mt-8">
          <h2 className="mb-4 text-sm font-medium text-gray-700">
            Uptime — last 90 days
          </h2>
          <UptimeStrip buckets={data.dailyBuckets} />
        </div>

        {/* Recent incidents */}
        <div className="mt-10">
          <h2 className="mb-4 text-sm font-medium text-gray-700">
            Recent incidents
          </h2>
          <IncidentsTable incidents={data.recentIncidents} />
        </div>

        {/* Footer */}
        <div className="mt-12 border-t border-gray-100 pt-6 text-center">
          <p className="text-xs text-gray-400">
            Monitored by{' '}
            <a
              href="https://scanlyfix.com"
              className="underline underline-offset-2 hover:text-gray-600"
            >
              ScanlyFix
            </a>
          </p>
        </div>

      </div>
    </div>
  )
}