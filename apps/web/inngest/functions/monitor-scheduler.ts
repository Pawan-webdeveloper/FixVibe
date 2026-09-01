/**
 * monitor error — This file was empty (0 lines) with no implementation.
 * Created a proper scheduler function that will eventually handle
 * monitor scheduling logic. Currently a placeholder — implement when
 * the rescan monitor feature is built out.
 */

import 'server-only'
import { inngest } from '@/lib/inngest.ts'

/* monitor error — fixed createFunction signature: cron trigger goes inside
 * the options object as a triggers array, not as a separate 3rd argument.
 * Inngest v4 createFunction(config, handler) — only 2 arguments. */
export const monitorScheduler = inngest.createFunction(
  {
    id: 'monitor-scheduler',
    triggers: [{ cron: '0 * * * *' }],
    concurrency: { limit: 1 },
    retries: 0,
  },
  async ({ step }) => {
    /* monitor error — placeholder implementation. The sweep (sweep.ts)
     * handles uptime and domain monitors. This scheduler is reserved for
     * rescan monitors which need a different dispatch strategy. */
    return { scheduled: 0 }
  },
)
