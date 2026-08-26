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
import { BrandMark } from '@/components/marketing/brand-mark.tsx'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-50 border-b border-line bg-canvas
                         supports-[backdrop-filter]:bg-canvas/80 supports-[backdrop-filter]:backdrop-blur-md">
        <nav aria-label="Main" className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-6">
          <Link href="/dashboard" className="flex items-center gap-2" aria-label="Darvin — projects">
            <BrandMark size={16} track="var(--line)" arc="var(--ink)" />
            <span className="text-[15px] font-semibold tracking-tight">darvin</span>
          </Link>
          <Link href="/dashboard" className="label text-muted transition-colors hover:text-ink">
            Projects
          </Link>
          <div className="flex-1" />
          <span className="label hidden text-muted sm:inline">{user.email}</span>
          <form action="/signout" method="post">
            <button type="submit" className="label text-muted transition-colors hover:text-ink">
              Sign out
            </button>
          </form>
        </nav>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  )
}
