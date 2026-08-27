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

import { ConvexAuthProvider } from '@convex-dev/auth/react'
import { ConvexReactClient } from 'convex/react'
import { publicEnv } from '@/lib/public-env.ts'

const convex = new ConvexReactClient(publicEnv.convexUrl())

export function ConvexClientAuthProvider({ children }: { children: React.ReactNode }) {
  return <ConvexAuthProvider client={convex}>{children}</ConvexAuthProvider>
}
