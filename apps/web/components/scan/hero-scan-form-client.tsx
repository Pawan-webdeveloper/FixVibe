/**
 * A client island that mounts the Convex Auth provider around the hero's scan
 * form so it can read signed-in state.
 *
 * Mounted by hero.tsx inside the (marketing) route group, which is otherwise a
 * static server component. This is the one place on the landing page that
 * needs to know who you are: the only action the page exists to collect is a
 * scan, and the rule for that is that a scan requires an account.
 *
 * SSR caveat: the Convex auth context only exists on the client, so the form
 * is gated behind a "mounted" state and rendered as a static placeholder on
 * the server. The placeholder is the same visual — same input, same button —
 * so the landing page does not flash an empty box on hydration. The auth gate
 * is the only behaviour that needs the client; everything else (validation,
 * the button label) is identical in both states.
 */
'use client'

import { useEffect, useState } from 'react'
import { ConvexClientAuthProvider } from '@/components/auth/convex-provider-client.tsx'
import { HeroScanForm } from '@/components/marketing/hero-scan-form.tsx'
import { HeroScanFormSkeleton } from '@/components/marketing/hero-scan-form-skeleton.tsx'

export function HeroScanFormClient() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    // Identical pixels to HeroScanForm, so the static landing page is not
    // smaller than the hydrated one and the layout does not shift.
    return <HeroScanFormSkeleton />
  }

  return (
    <ConvexClientAuthProvider>
      <HeroScanForm />
    </ConvexClientAuthProvider>
  )
}
