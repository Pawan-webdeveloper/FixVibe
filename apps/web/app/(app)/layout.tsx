/**
 * Shell for signed-in pages.
 *
 * requireUser() runs once here rather than in every page, and it returns the
 * account context so the nav can show it without a second query. Note what
 * this is NOT doing: it is not the access control for the data below it. Each
 * query still takes a Viewer, because a layout only guards the pages it wraps
 * and a query can be reached from anywhere.
 *
 * ## What this layout does and does not restyle
 *
 * It supplies the rail, and nothing else. The `.console` class that switches
 * the product from its monospace terminal identity to a sans console face is
 * applied by the sidebar and by the dashboard page themselves — deliberately
 * NOT here, because every other page under this layout (the project view,
 * settings, verify) was designed in the terminal face and is not part of this
 * change. They gain the rail as navigation and keep their own typography.
 *
 * The two counts are read here rather than in the sidebar because the sidebar
 * is a client component; it displays what it is handed and queries nothing.
 */

import { listProjectSummaries, listRecentScansForUser } from '@scanlyfix/db'
import { getViewer, requireUser } from '@/lib/authz.ts'
import { SupabaseAuthProvider } from '@/components/auth/supabase-provider.tsx'
import { Sidebar } from '@/components/console/sidebar.tsx'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  const viewer = await getViewer()
  const [summaries, recentScans] = await Promise.all([
    listProjectSummaries(viewer),
    listRecentScansForUser(viewer),
  ])

  return (
    <SupabaseAuthProvider>
      <div className="flex min-h-dvh">
        <Sidebar
          email={user.email}
          plan={user.plan}
          sites={summaries.length}
          scans={recentScans.length}
        />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </SupabaseAuthProvider>
  )
}
