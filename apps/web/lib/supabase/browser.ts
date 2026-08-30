/**
 * The browser-side Supabase client.
 *
 * One client per module load, not one per render: the Supabase client opens a
 * WebSocket and the auth state lives in it. Building a new one on every render
 * would lose the session on every render.
 *
 * Cookie writes happen in the browser via `document.cookie`; @supabase/ssr
 * handles that through the same `getAll`/`setAll` adapter shape it uses on the
 * server, with `document` as the store.
 *
 * The publishable key is the right key for the browser: it is rate-limited at
 * the Supabase gateway and tied to RLS, so a leaked key is a session token,
 * not a database credential. The service_role key is never shipped to clients.
 */

import { createBrowserClient } from '@supabase/ssr'
import { publicEnv } from '@/lib/public-env.ts'

let cached: ReturnType<typeof createBrowserClient> | null = null

export function createClient() {
  if (cached) return cached
  cached = createBrowserClient(publicEnv.supabaseUrl(), publicEnv.supabaseAnonKey())
  return cached
}
