import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getViewer } from '@/lib/authz.ts'
import { listMonitorsForUser, listProjectSummaries } from '@scanlyfix/db'
import { MonitoringDetail } from '@/components/monitors/monitoring-detail.tsx'

export const metadata = { title: 'SSL & Domain Monitoring — ScanlyFix' }

export default async function MonitoringPage() {
  const viewer = await getViewer()
  if (viewer.kind !== 'user') notFound()

  const [allMonitors, projects] = await Promise.all([
    listMonitorsForUser(viewer),
    listProjectSummaries(viewer),
  ])
  const domainMonitors = allMonitors.filter((m) => m.type === 'domain')

  return (
    <div className="console min-h-dvh bg-c-bg text-c-ink">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-c-ink">SSL &amp; Domain Monitoring</h1>
            <p className="mt-1 text-sm text-c-muted">
              Real-time TLS certificate and domain registration expiry tracking.
            </p>
          </div>
          {projects.length > 0 && (
            <Link
              href={`/projects/${projects[0]?.project.id}/monitors`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-c-brand px-3.5 py-2 text-xs font-semibold text-c-brand-ink transition-opacity hover:opacity-90"
            >
              + Configure Monitors
            </Link>
          )}
        </div>

        {domainMonitors.length === 0 ? (
          <div className="rounded-xl border border-dashed border-c-line bg-c-card p-10 text-center shadow-xs">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-c-soft text-xl">
              🔒
            </div>
            <h2 className="mt-3 text-sm font-semibold text-c-ink">No SSL &amp; Domain monitors active yet</h2>
            <p className="mx-auto mt-1 max-w-sm text-xs text-c-muted">
              Track SSL certificate expiration (14d/7d alerts) and domain expiry (30d/7d alerts) automatically.
            </p>

            {projects.length > 0 ? (
              <div className="mt-6 border-t border-c-line/60 pt-6">
                <p className="text-xs font-medium uppercase tracking-wider text-c-muted">
                  Your Domains ({projects.length})
                </p>
                <div className="mt-3 flex flex-col gap-2">
                  {projects.map((p) => (
                    <Link
                      key={p.project.id}
                      href={`/projects/${p.project.id}/monitors`}
                      className="flex items-center justify-between rounded-lg border border-c-line bg-c-soft/50 px-4 py-3 transition-colors hover:border-c-brand/50 hover:bg-c-soft"
                    >
                      <div className="text-left">
                        <p className="text-sm font-medium text-c-ink">{p.project.name}</p>
                        <p className="font-mono text-xs text-c-muted">{p.project.url}</p>
                      </div>
                      <span className="text-xs font-semibold text-c-brand">
                        Enable Certificate Check →
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-5">
                <Link
                  href="/dashboard"
                  className="inline-flex items-center rounded-lg bg-c-brand px-4 py-2 text-xs font-semibold text-c-brand-ink"
                >
                  Add a Domain on Dashboard
                </Link>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {domainMonitors.map((m) => (
              <div key={m.id} className="rounded-xl border border-c-line bg-c-card p-5 shadow-xs">
                <div className="mb-4 flex items-center justify-between border-b border-c-line pb-3">
                  <div>
                    <h2 className="text-sm font-semibold text-c-ink">{m.projectName}</h2>
                    <p className="font-mono text-xs text-c-muted">{m.projectUrl}</p>
                  </div>
                  <Link
                    href={`/monitors/${m.id}`}
                    className="rounded-md border border-c-line px-2.5 py-1 text-xs font-medium text-c-ink transition-colors hover:bg-c-soft"
                  >
                    View Details →
                  </Link>
                </div>
                <MonitoringDetail monitorId={m.id} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
