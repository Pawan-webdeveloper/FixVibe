import Link from 'next/link'

/**
 * Shell for the pages a logged-out visitor sees. Deliberately thin: the landing
 * page has one job, and chrome that competes with the URL field works against
 * it. Navigation arrives when there is a second page worth going to.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <div className="mx-auto max-w-5xl px-6 py-4">
          <Link href="/" className="font-mono text-sm font-semibold tracking-tight">
            darvin
          </Link>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-5xl px-6 py-6 text-sm text-muted">
          Darvin reads only what a browser would read. It never logs in, submits forms, or attempts
          anything a site owner has not already made public.
        </div>
      </footer>
    </div>
  )
}
