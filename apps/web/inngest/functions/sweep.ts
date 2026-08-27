/**
 * The scheduler: one cron, fanning out to one event per due monitor.
 *
 * Fan-out rather than a loop that does the work inline, for two reasons that
 * both bite at scale. A single long function processing five hundred monitors
 * has one retry, one timeout and one failure — so one unreachable site can stall
 * every monitor behind it. And Inngest can only apply concurrency limits, retry
 * policies and observability per function, which means the uptime probe and the
 * full re-scan need to be separate functions to have separate limits at all.
 *
 * The sweep itself does almost nothing, which is the point: it should never be
 * the thing that fails.
 */

import { dueMonitorsForScheduler } from '@scanlyfix/db'
import { inngest, EVENTS } from '@/lib/inngest.ts'

/**
 * Every minute. The minimum useful uptime resolution, and each monitor's own
 * intervalS decides whether it is actually due — so a daily certificate check
 * costs one row in a query, not a run.
 */
export const sweepMonitors = inngest.createFunction(
  { id: 'monitor-sweep', triggers: [{ cron: '* * * * *' }], concurrency: { limit: 1 } },
  async ({ step }) => {
    const due = await step.run('find-due', () => dueMonitorsForScheduler())
    if (due.length === 0) return { dispatched: 0 }

    await step.sendEvent(
      'dispatch',
      due.map((monitor) => ({
        name: EVENTS.monitorDue,
        data: {
          monitorId: monitor.id,
          type: monitor.type,
          projectId: monitor.projectId,
          url: monitor.projectUrl,
          ownerId: monitor.ownerId,
        },
      })),
    )

    return { dispatched: due.length }
  },
)
