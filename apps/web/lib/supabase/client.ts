'use client'

import { createBrowserClient } from '@supabase/ssr'
import { publicEnv } from '../public-env.ts'

/**
 * Browser client, used only to START a sign-in. It never reads application
 * data — every read goes through a server component and Drizzle.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(publicEnv.supabaseUrl(), publicEnv.supabaseKey())
}
