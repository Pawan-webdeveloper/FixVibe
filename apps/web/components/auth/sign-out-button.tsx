'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthActions } from '@convex-dev/auth/react'

/**
 * Signing out is a client action now, not a POST to a route.
 *
 * Convex Auth holds the session in a cookie it manages from the client, and
 * `signOut()` is what clears it along with the refresh token on the server. A
 * route handler could delete the cookie but not the session behind it, which
 * would leave a token that still works if it were ever recovered.
 *
 * `router.refresh()` after it, because every signed-in page is server-rendered
 * against the old cookie until something re-fetches them.
 */
export function SignOutButton({ className }: { className?: string }) {
  const { signOut } = useAuthActions()
  const router = useRouter()
  const [pending, setPending] = useState(false)

  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true)
        try {
          await signOut()
          router.push('/')
          router.refresh()
        } finally {
          setPending(false)
        }
      }}
      className={className}
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
