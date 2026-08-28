'use client'

import { useEffect, useRef, useState } from 'react'
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
 *
 * ## The confirmation
 *
 * Signing out is a one-click way to lose your place, and it lands you back on
 * the home page where scanning needs an account again — so it asks first. A
 * small dialog, not the browser's native confirm(), so it matches the product
 * and can be dismissed by Escape, by the Cancel button, or by clicking away.
 */
export function SignOutButton({ className }: { className?: string }) {
  const { signOut } = useAuthActions()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)

  // Close on Escape and move focus to the safe choice when the dialog opens.
  useEffect(() => {
    if (!open) return
    cancelRef.current?.focus()
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !pending) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, pending])

  async function confirmSignOut() {
    setPending(true)
    try {
      await signOut()
      router.push('/')
      router.refresh()
    } finally {
      // The route change unmounts this, but if it somehow does not, do not
      // leave the button stuck mid-action.
      setPending(false)
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        Sign out
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="signout-title"
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
        >
          {/* Backdrop — clicking it cancels, a mouse convenience. Keyboard and
              assistive-tech users cancel with Escape or the Cancel button, so
              this is hidden from the accessibility tree rather than a second
              "Cancel" control competing with the real one. */}
          <div
            aria-hidden="true"
            onClick={() => { if (!pending) setOpen(false) }}
            className="absolute inset-0 bg-ink/40"
          />

          <div className="relative w-full max-w-sm border border-line bg-canvas p-6 shadow-lg">
            <h2 id="signout-title" className="text-lg font-semibold tracking-tight">
              Sign out?
            </h2>
            <p className="mt-2 text-[15px] leading-relaxed text-muted text-pretty">
              You’ll go back to the home page. Scanning there needs an account, so you’ll sign in
              again to keep your reports.
            </p>

            <div className="mt-6 flex justify-end gap-3">
              <button
                ref={cancelRef}
                type="button"
                disabled={pending}
                onClick={() => setOpen(false)}
                className="label inline-flex h-10 items-center border border-line px-4 text-ink
                           transition-colors hover:bg-surface disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={confirmSignOut}
                className="label inline-flex h-10 items-center border border-ink bg-ink px-4 text-canvas
                           transition-colors hover:bg-transparent hover:text-ink disabled:opacity-60"
              >
                {pending ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
