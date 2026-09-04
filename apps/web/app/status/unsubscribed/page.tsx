/**
 * apps/web/app/status/unsubscribed/page.tsx
 *
 * Landing page the unsubscribe-link bounces to.
 *
 * It carries no project context on purpose: the unsubscribe endpoint
 * redirects here regardless of whether the token matched. Showing
 * which project's status page you were removed from would leak the
 * answer to "is this token valid" to anybody who finds the URL.
 *
 * The user clicked an unsubscribe link in their inbox — they already
 * know which project it was. One line of confirmation is enough.
 */

import Link from 'next/link'

export const metadata = {
  title: 'Unsubscribed — ScanlyFix',
  robots: { index: false },
}

export default function UnsubscribedPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-[-0.02em] text-gray-900">
        You've been unsubscribed
      </h1>
      <p className="mt-3 text-sm text-gray-500">
        You will not receive any more status-update emails from us. If this
        was a mistake, subscribe again from the project's status page.
      </p>

      <Link
        href="/"
        className="mt-8 inline-block text-sm text-blue-600 hover:text-blue-800"
      >
        ← Back to ScanlyFix
      </Link>
    </div>
  )
}
