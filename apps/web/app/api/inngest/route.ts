/**
 * Where Inngest reaches the application.
 *
 * It calls this endpoint to discover the registered functions and again to run
 * each step, so every job in the product executes through here. The serve
 * handler verifies request signatures itself using INNGEST_SIGNING_KEY —
 * without one set it refuses in production and runs open in development, which
 * is the behaviour the dev server needs.
 */

import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest.ts'
import { functions } from '@/inngest/index.ts'

export const runtime = 'nodejs'

/** A full re-scan is a real scan; the sweep and the probes finish in moments. */
export const maxDuration = 300

export const { GET, POST, PUT } = serve({ client: inngest, functions })
