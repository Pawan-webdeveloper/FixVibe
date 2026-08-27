'use client'

import { ConvexAuthNextjsProvider } from '@convex-dev/auth/nextjs'
import { ConvexReactClient } from 'convex/react'
import { publicEnv } from '@/lib/public-env.ts'

/**
 * The client half of Convex Auth, mounted only where sign-in actually happens.
 *
 * Deliberately NOT at the root. Wrapping the whole app would ship the Convex
 * client to the landing page and the shared report — two pages that are
 * statically prerendered, read no identity, and are the ones a stranger sees
 * first. The server half (ConvexAuthNextjsServerProvider, in the root layout)
 * is a Server Component and costs no JavaScript, so it can live there and keep
 * the cookie handling in one place.
 *
 * One client per module load, not one per render: a ConvexReactClient opens a
 * WebSocket, and rebuilding it on every render would reconnect on every render.
 */
const convex = new ConvexReactClient(publicEnv.convexUrl())

export function ConvexAuthProvider({ children }: { children: React.ReactNode }) {
  return <ConvexAuthNextjsProvider client={convex}>{children}</ConvexAuthNextjsProvider>
}
