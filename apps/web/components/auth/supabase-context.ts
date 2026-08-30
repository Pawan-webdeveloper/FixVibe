/**
 * The single Supabase React context, shared by every provider in the app.
 *
 * Both the `(auth)`/`(app)` layout provider and the marketing landing page's
 * client-only provider wrap this same context, so a component that calls
 * `useSupabaseClient()` or `useSession()` works under either of them without
 * caring which one happens to be the closest ancestor.
 *
 * Two providers and one context, deliberately. The two providers exist
 * because the marketing landing page is a static server component and the
 * Supabase client does no work on the server — the landing page mounts its
 * provider as a client island. The (app) layout, which has server work to
 * do alongside the client provider, mounts the other. Splitting the
 * *context* between them would force every consumer to know which tree it
 * lives in, which a `ScanForm` rendered on both cannot.
 */

'use client'

import { createContext, useContext } from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'

/**
 * The shape exposed through `useSupabaseClient` / `useSession`. The session
 * field is `null` on first render and after `signOut`; the loading flag is
 * `true` while the SDK is resolving the cookie on the client.
 */
export interface SupabaseContextValue {
  supabase: SupabaseClient
  session: Session | null
  isLoading: boolean
}

export const SupabaseContext = createContext<SupabaseContextValue | null>(null)

export function useSupabaseClient(): SupabaseClient {
  const ctx = useContext(SupabaseContext)
  if (!ctx) throw new Error('useSupabaseClient must be used inside a Supabase provider')
  return ctx.supabase
}

export function useSession(): { data: { session: Session | null } | null; isLoading: boolean } {
  const ctx = useContext(SupabaseContext)
  if (!ctx) throw new Error('useSession must be used inside a Supabase provider')
  return { data: { session: ctx.session }, isLoading: ctx.isLoading }
}
