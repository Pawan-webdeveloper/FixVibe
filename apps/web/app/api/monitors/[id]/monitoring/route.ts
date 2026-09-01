/*
 * Returns live SSL + domain expiry data for a domain monitor.
 *
 * Runs the checks fresh on each request — they are fast (TLS handshake
 * + one RDAP fetch), and the data is not worth caching separately given
 * the monitor only runs once a day. The response tells the frontend
 * exactly how many days are left, right now.
 */

/* uptime error — replaced deep relative paths with package imports,
 * added ownership check to prevent IDOR vulnerability */
 
import { NextResponse } from 'next/server'
import { getViewer } from '@/lib/authz.ts'
import { checkSsl, checkDomain } from '@scanlyfix/checks'
import { db, getProject, monitors, projects } from '@scanlyfix/db'
import { eq } from 'drizzle-orm'
 
export const runtime = 'nodejs'
 
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const viewer = await getViewer()
  if (viewer.kind !== 'user') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
 
  const { id } = await params
 
  // Resolve monitor → project → URL
  const row = await db
    .select({ url: projects.url, projectId: monitors.projectId, type: monitors.type })
    .from(monitors)
    .innerJoin(projects, eq(projects.id, monitors.projectId))
    .where(eq(monitors.id, id))
    .limit(1)
    .then((r) => r[0] ?? null)
 
  if (!row || row.type !== 'domain') {
    return NextResponse.json({ error: 'Monitor not found' }, { status: 404 })
  }
 
  // uptime error — verify the viewer owns this project (IDOR fix)
  if (!(await getProject(row.projectId, viewer))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }
 
  const hostname = new URL(row.url).hostname
 
  // Run both checks in parallel
  const [ssl, domain] = await Promise.all([
    checkSsl(hostname),
    checkDomain(hostname),
  ])
 
  return NextResponse.json({ hostname, ssl, domain })
}
 