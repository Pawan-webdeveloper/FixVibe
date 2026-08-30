/**
 * The Supabase Auth React context, for the (auth) and (app) layouts.
 *
 * Wraps the children in a small `SupabaseContext` so descendants can call
 * `useSupabaseClient` and `useSession` to read the auth state. The context
 * owns the WebSocket connection to Supabase's realtime auth events; mounting
 * it once at the layout, rather than at every consumer, gives the whole
 * subtree a single live client.
 *
 * Mounted at the (auth) and (app) layouts rather than the root, because
 * the marketing landing page is a static server component and the Supabase
 * client does no work on the server. The (app) layout already reads the
 * session server-side via `lib/auth/supabase.ts`, so this provider's main
 * job is to give client components a typed client for `signOut`, the OAuth
 * flows, and `verifyOtp`.
 *
 * The auth-helpers packages (`@supabase/auth-helpers-react`) are deprecated;
 * @supabase/ssr is the supported path forward. The SSR package does not
 * ship React hooks, so this module provides the small context they used to
 * and the hooks above it consume.
 */

'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/browser.ts'

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

const SupabaseContext = createContext<SupabaseContextValue | null>(null)

export function useSupabaseClient(): SupabaseClient {
  const ctx = useContext(SupabaseContext)
  if (!ctx) throw new Error('useSupabaseClient must be used inside <SupabaseAuthProvider>')
  return ctx.supabase
}

export function useSession(): { data: { session: Session | null } | null; isLoading: boolean } {
  const ctx = useContext(SupabaseContext)
  if (!ctx) throw new Error('useSession must be used inside <SupabaseAuthProvider>')
  return { data: { session: ctx.session }, isLoading: ctx.isLoading }
}

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

  const value = useMemo<SupabaseContextValue>(
    () => ({ supabase, session, isLoading }),
    [supabase, session, isLoading],
  )

  return <SupabaseContext.Provider value={value}>{children}</SupabaseContext.Provider>
}
