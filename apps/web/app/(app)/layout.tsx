/**
 * Shell for signed-in pages.
 *
 * requireUser() runs once here rather than in every page, and it returns the
 * account context so the nav can show it without a second query. Note what
 * this is NOT doing: it is not the access control for the data below it. Each
 * query still takes a Viewer, because a layout only guards the pages it wraps
 * and a query can be reached from anywhere.
 */

import Link from 'next/link'
import { requireUser } from '@/lib/authz.ts'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <nav aria-label="Main" className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-4">
          <Link href="/dashboard" className="font-mono text-sm font-semibold tracking-tight">
            darvin
          </Link>
          <Link href="/dashboard" className="text-sm text-muted hover:text-ink">
            Projects
          </Link>
          <div className="flex-1" />
          <span className="hidden text-sm text-muted sm:inline">{user.email}</span>
          <form action="/signout" method="post">
            <button type="submit" className="text-sm text-muted hover:text-ink">
              Sign out
            </button>
          </form>
        </nav>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  )
}
