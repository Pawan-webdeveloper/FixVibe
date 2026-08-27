/**
 * A client island that mounts the Convex Auth provider around the standard
 * ScanForm so it can read signed-in state.
 *
 * Used by final-cta.tsx on the marketing landing page, where the rest of the
 * page is a static server component. The same skeleton-on-server pattern as
 * hero-scan-form-client.tsx — the form renders identically pre and post
 * hydration, with the auth gate being the only behaviour the client adds.
 */
'use client'

import { useEffect, useState } from 'react'
import { ConvexClientAuthProvider } from '@/components/auth/convex-provider-client.tsx'
import { ScanForm } from './scan-form.tsx'
import { ScanFormSkeleton } from './scan-form-skeleton.tsx'

export function ScanFormClient() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    // Identical pixels to ScanForm, so the static landing page is not
    // smaller than the hydrated one and the layout does not shift.
    return <ScanFormSkeleton />
  }

  return (
    <ConvexClientAuthProvider>
      <ScanForm />
    </ConvexClientAuthProvider>
  )
}
