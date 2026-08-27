'use client'

import { useEffect } from 'react'

/**
 * The last resort: an error thrown by the ROOT layout itself, before any of the
 * product's shell exists.
 *
 * This one replaces `<html>` and `<body>`, so it cannot use the app's layout,
 * its fonts, or anything that would normally come from above it. That is also
 * why the styles here are inline rather than Tailwind classes — globals.css is
 * loaded by the root layout, and the case this file handles is the root layout
 * having failed. A stylesheet that may not have loaded is not a dependency this
 * screen can take.
 *
 * It should never be seen. If it is, the failure is a bad deploy or a missing
 * environment variable rather than anything a visitor did, so the copy says so
 * and offers a reload instead of pretending there is a fix on their side.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[global error boundary]', error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem',
          background: '#fff',
          color: '#111',
          // The product's typeface is loaded by the layout that just failed, so
          // this names the family and then falls back to whatever is there.
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
      >
        <main style={{ maxWidth: '38rem' }}>
          <p
            style={{
              margin: 0,
              fontSize: '11px',
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: '#666',
            }}
          >
            darvin — 500
          </p>

          <h1 style={{ margin: '1rem 0 0', fontSize: '1.5rem', letterSpacing: '-0.02em' }}>
            The application failed to start
          </h1>

          <p style={{ margin: '1rem 0 0', lineHeight: 1.6, color: '#555' }}>
            This is a fault in our deployment, not in anything you did. It has been logged. Reloading
            in a moment is worth trying; if it keeps happening, the problem is on our side and we are
            the ones who have to fix it.
          </p>

          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '2rem',
              height: '2.75rem',
              padding: '0 1.5rem',
              border: '1px solid #111',
              background: '#111',
              color: '#fff',
              font: 'inherit',
              fontSize: '11px',
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>

          {error.digest && (
            <p style={{ marginTop: '2.5rem', fontSize: '11px', letterSpacing: '0.16em', color: '#666' }}>
              REFERENCE <span style={{ color: '#111' }}>{error.digest}</span>
            </p>
          )}
        </main>
      </body>
    </html>
  )
}
