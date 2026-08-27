/**
 * A client-only Convex Auth provider for places that are NOT inside a
 * ConvexAuthNextjsServerProvider — i.e., the marketing landing page, which is
 * otherwise a static server component.
 *
 * The (auth) and (app) layouts have both halves: the server provider reads
 * the cookie on the server and passes the resulting state to a client
 * provider, so the page never has to wait for a client-side auth bootstrap.
 * The marketing page does not have that luxury — the layout is static, by
 * design — so the auth context has to be set up by the client alone. This
 * provider does that: it reads from localStorage on mount and exposes the
 * Convex auth state to useConvexAuth.
 */
'use client'

import { useState } from 'react'
import { ConvexAuthProvider } from '@convex-dev/auth/react'
import { ConvexReactClient } from 'convex/react'
import { publicEnv } from '@/lib/public-env.ts'
import { repairTokenStorage } from './repair-token-storage.ts'
import { landingAuthStorage } from './landing-auth-storage.ts'

// This provider is the one on the LANDING page, so it is where an unusable
// stored token does the most damage — a stranger's first visit throwing before
// anything renders. See repair-token-storage.ts.
repairTokenStorage()

const convex = new ConvexReactClient(publicEnv.convexUrl())

export function ConvexClientAuthProvider({ children }: { children: React.ReactNode }) {
  /*
   * One storage instance for the life of the provider. The refresh token is
   * hidden from it so this client-only provider cannot try to refresh the
   * cookie flow's "dummy" sentinel against Convex and crash — see
   * landing-auth-storage.ts. Built lazily in state so it is only touched on the
   * client, never during SSR.
   */
  const [storage] = useState(landingAuthStorage)

  return (
    <ConvexAuthProvider client={convex} storage={storage}>
      {children}
    </ConvexAuthProvider>
  )
}
