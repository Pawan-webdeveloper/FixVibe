/**
 * Supabase client for server components, route handlers and server actions.
 *
 * Supabase is the identity provider here and nothing else. It never reads
 * application data — that all goes through Drizzle — because two data paths
 * into the same tables means two places to get authorization wrong, and only
 * one of them would have been audited.
 */

import 'server-only'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { publicEnv } from '../public-env.ts'

export async function createSupabaseServerClient() {
  const cookieStore = await cookies()

  return createServerClient(publicEnv.supabaseUrl(), publicEnv.supabaseKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Server Components cannot write cookies. That is fine: proxy.ts
          // refreshes the session on every request, so the rotated token is
          // already set by the time this runs.
        }
      },
    },
  })
}
