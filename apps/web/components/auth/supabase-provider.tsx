/**
 * The Supabase Auth React provider, for the (auth) and (app) layouts.
 *
 * Mounted at the (auth) and (app) layouts rather than the root, because
 * the marketing landing page is a static server component and the Supabase
 * client does no work on the server. The (app) layout already reads the
 * session server-side via `lib/auth/supabase.ts`, so this provider's main
 * job is to give client components a typed client for `signOut`, the OAuth
 * flows, and `verifyOtp`.
 *
 * Both this provider and the marketing page's `SupabaseClientAuthProvider`
 * share the same `SupabaseContext`, so any descendant can call
 * `useSupabaseClient` / `useSession` regardless of which one is the closest
 * ancestor. The shared context lives in `supabase-context.ts`; this file
 * re-exports the hooks for callers that historically imported them from
 * here.
 */

'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/browser.ts'
import { SupabaseContext } from './supabase-context.ts'

export { useSupabaseClient, useSession } from './supabase-context.ts'

export function SupabaseAuthProvider({ children }: { children: ReactNode }) {
  // Built once per provider mount. The supabase-js client opens realtime
  // channels internally; rebuilding it on every render would force
  // reconnects on every render. Lazy state so the client is only built
  // on the client side.
  const [supabase] = useState(() => createClient())
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true

    // Read once on mount. getSession() is a client-side read; the cookie
    // is already in the browser so it does not need to verify with the
    // server. Authorization on the server uses getUser() (see
    // lib/auth/supabase.ts), which DOES verify.
    supabase.auth.getSession().then((result: { data: { session: Session | null } }) => {
      if (!active) return
      setSession(result.data.session ?? null)
      setIsLoading(false)
    })

    // Track subsequent changes (signIn, signOut, token refresh).
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event: string, next: Session | null) => {
        if (!active) return
        setSession(next)
        setIsLoading(false)
      },
    )

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [supabase])

  const value = useMemo(
    () => ({ supabase, session, isLoading }),
    [supabase, session, isLoading],
  )

  return <SupabaseContext.Provider value={value}>{children}</SupabaseContext.Provider>
}
