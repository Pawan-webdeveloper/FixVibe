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
import { LogoBadge } from '@/components/brand/logo.tsx'
import { ConvexAuthNextjsServerProvider } from '@convex-dev/auth/nextjs/server'
import { ConvexAuthProvider } from '@/components/auth/convex-provider.tsx'
import { SignOutButton } from '@/components/auth/sign-out-button.tsx'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()

  return (
    <ConvexAuthNextjsServerProvider>
      <ConvexAuthProvider>
      <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-50 border-b border-line bg-canvas
                         supports-[backdrop-filter]:bg-canvas/80 supports-[backdrop-filter]:backdrop-blur-md">
        <nav aria-label="Main" className="mx-auto flex h-16 max-w-5xl items-center gap-6 px-6">
          <Link href="/dashboard" className="flex items-center gap-2.5" aria-label="ScanlyFix — projects">
            <LogoBadge size={40} />
            <span className="text-xl font-semibold uppercase tracking-tight">scanlyfix</span>
          </Link>
          <Link href="/dashboard" className="label text-muted transition-colors hover:text-ink">
            Projects
          </Link>
          <Link href="/settings/billing" className="label text-muted transition-colors hover:text-ink">
            Settings
          </Link>
          <div className="flex-1" />
          <span className="label hidden text-muted sm:inline">{user.email}</span>
          <SignOutButton className="label text-muted transition-colors hover:text-ink" />
        </nav>
      </header>
      <main className="flex-1">{children}</main>
      </div>
      </ConvexAuthProvider>
    </ConvexAuthNextjsServerProvider>
  )
}
