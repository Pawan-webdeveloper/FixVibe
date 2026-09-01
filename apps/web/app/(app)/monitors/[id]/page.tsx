import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getViewer } from '@/lib/authz.ts'
import { listMonitorsForUser } from '@scanlyfix/db'
import { MonitorDetail } from '@/components/monitors/monitor-detail'
import { MonitoringDetail } from '@/components/monitors/monitoring-detail.tsx'

interface Props {
  params: Promise<{ id: string }>
}

export default async function MonitorDetailPage({ params }: Props) {
  const { id } = await params

  const viewer = await getViewer()
  if (viewer.kind !== 'user') notFound()

  const monitors = await listMonitorsForUser(viewer)
  const monitor = monitors.find((m) => m.id === id)
  if (!monitor) notFound()

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {monitor.type === 'domain' ? (
        <div>
          <div className="mb-6 flex items-center justify-between">
            <div>
              <Link href="/monitoring" className="text-xs text-gray-500 hover:text-gray-900">
                ← Back to Monitoring
              </Link>
              <h1 className="mt-1 text-xl font-semibold text-gray-900">{monitor.projectName}</h1>
              <p className="font-mono text-xs text-gray-400">{monitor.projectUrl}</p>
            </div>
          </div>
          <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-xs">
            <MonitoringDetail monitorId={monitor.id} />
          </div>
        </div>
      ) : (
        <div>
          <div className="mb-4">
            <Link href="/monitors" className="text-xs text-gray-500 hover:text-gray-900">
              ← Back to Monitors
            </Link>
          </div>
          <MonitorDetail
            monitor={{
              id: monitor.id,
              projectName: monitor.projectName,
              projectUrl: monitor.projectUrl,
              lastStatus: monitor.lastStatus as 'up' | 'down' | null, /* uptime error — match DB status values */
              lastRunAt: monitor.lastRunAt?.toISOString() ?? null,
              intervalS: monitor.intervalS,
              enabled: monitor.enabled,
            }}
          />
        </div>
      )}
    </div>
  )
}