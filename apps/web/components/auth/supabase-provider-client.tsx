/**
 * The client-only Supabase Auth provider, for the marketing landing page.
 *
 * The (auth) and (app) layouts read the session server-side and pass the
 * resulting state to a client provider, so the page never has to wait for a
 * client-side auth bootstrap. The marketing page is a static server
 * component — by design, because that is the one surface this product is
 * judged on by its own engine — so the auth context has to be set up by
 * the client alone. This provider does that, identical to the layout
 * version, and exposes the Supabase client to `useScanSubmit` via the
 * session context.
 *
 * This module is structurally identical to `supabase-provider.tsx`, but
 * with a SEPARATE context and SEPARATE hooks so a scan form on the landing
 * page cannot accidentally read the (app) layout's context — they live in
 * different subtrees and the only difference that matters is the test
 * against useContext returning null.
 */

'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/browser.ts'

export interface ClientSupabaseContextValue {
  supabase: SupabaseClient
  session: Session | null
  isLoading: boolean
}

const Ctx = createContext<ClientSupabaseContextValue | null>(null)

export function useClientSupabase(): SupabaseClient {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useClientSupabase must be used inside <SupabaseClientAuthProvider>')
  return ctx.supabase
}

export function useClientSession(): { data: { session: Session | null } | null; isLoading: boolean } {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useClientSession must be used inside <SupabaseClientAuthProvider>')
  return { data: { session: ctx.session }, isLoading: ctx.isLoading }
}

export function SupabaseClientAuthProvider({ children }: { children: ReactNode }) {
  const [supabase] = useState(() => createClient())
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then((result: { data: { session: Session | null } }) => {
      if (!active) return
      setSession(result.data.session ?? null)
      setIsLoading(false)
    })
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

  const value = useMemo<ClientSupabaseContextValue>(
    () => ({ supabase, session, isLoading }),
    [supabase, session, isLoading],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
