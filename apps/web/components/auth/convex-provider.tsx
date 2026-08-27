/**
 * The client half of Convex Auth.
 *
 * Mounted at the (auth) layout for sign-in pages and at the hero so the scan
 * form can read signed-in state on the client. Deliberately NOT at the root:
 * the server half (ConvexAuthNextjsServerProvider) calls cookies() and opts
 * every page below it out of static prerender. The landing page is the one
 * surface this product is judged on by its own engine, so it stays static,
 * and the price of one extra client island on the hero is paid only by
 * people who actually try to scan.
 *
 * One client per module load, not one per render: a ConvexReactClient opens a
 * WebSocket, and rebuilding it on every render would reconnect on every render.
 */
'use client'

import { ConvexAuthNextjsProvider } from '@convex-dev/auth/nextjs'
import { ConvexReactClient } from 'convex/react'
import { publicEnv } from '@/lib/public-env.ts'
import { repairTokenStorage } from './repair-token-storage.ts'

// Before the client is built, not after: a stored refresh token the server
// cannot parse makes the auth client throw an unhandled rejection on every
// page load, with no recovery of its own. See repair-token-storage.ts.
repairTokenStorage()

const convex = new ConvexReactClient(publicEnv.convexUrl())

export function ConvexAuthProvider({ children }: { children: React.ReactNode }) {
  return <ConvexAuthNextjsProvider client={convex}>{children}</ConvexAuthNextjsProvider>
}
