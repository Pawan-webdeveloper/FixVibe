import type { Metadata } from 'next'

/**
 * Metadata for the sign-in page, which cannot declare its own.
 *
 * page.tsx is a client component — it needs useSearchParams for the ?next and
 * ?error params, and useAuthActions for the providers — and Next only reads a
 * `metadata` export from a server component. A layout is the server half that
 * wraps it, so the title lives here.
 *
 * `robots: noindex` because this page has nothing for a search result: it is
 * reached from a link inside the product or from a redirect, never from a
 * query, and an indexed sign-in page competes with the landing page for the
 * brand name it should be sending people to.
 */
export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to Darvin with Google, GitHub, or a code sent to your email.',
  robots: { index: false, follow: true },
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children
}
