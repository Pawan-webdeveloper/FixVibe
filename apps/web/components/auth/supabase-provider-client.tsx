/**
 * The client-only Supabase Auth provider, for the marketing landing page.
 *
 * The (auth) and (app) layouts read the session server-side and pass the
 * resulting state to a client provider, so the page never has to wait for a
 * client-side auth bootstrap. The marketing page is a static server
 * component — by design, because that is the one surface this product is
 * judged on by its own engine — so the auth context has to be set up by
 * the client alone. This provider does that, identical to the layout
 * version.
 *
 * Both this provider and the (app) layout's `SupabaseAuthProvider` share
 * the same `SupabaseContext`, so a component rendered on the landing page
 * (under this provider) and a component rendered on the dashboard (under
 * the layout provider) can call the same `useSupabaseClient` / `useSession`
 * hooks without caring which one is the closest ancestor.
 */

'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/browser.ts'
import { SupabaseContext } from './supabase-context.ts'

export { useSupabaseClient, useSession } from './supabase-context.ts'

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

  const value = useMemo(
    () => ({ supabase, session, isLoading }),
    [supabase, session, isLoading],
  )

  return <SupabaseContext.Provider value={value}>{children}</SupabaseContext.Provider>
}
