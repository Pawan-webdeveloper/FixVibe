'use server'

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { findRecentScanForUser } from '@scanlyfix/db'
import { getViewer } from '@/lib/authz.ts'
import { normalizeScanTarget } from '@/lib/url.ts'
import { clientIpHash } from '@/lib/request.ts'
import { checkApiScanAllowed, DEDUP_WINDOW_MS } from '@/lib/ratelimit.ts'
import { checkScanQuota } from '@/lib/quota.ts'
import { runScanJob } from '@/lib/scan/run-scan-job.ts'

/**
 * Starting a scan from a plain HTML form submission.
 *
 * ## Why this exists next to /api/scan
 *
 * The landing page's scan button was rendered `disabled` until React hydrated.
 * On a fast laptop that is invisible; on a mid-range phone over a slow
 * connection it is a second or more during which the one thing this page exists
 * to collect cannot be given. Somebody clicks, nothing happens, and they leave —
 * and the page it happens on is the one a stranger sees first.
 *
 * A React `onSubmit` handler cannot fix that, because there is no handler until
 * hydration. What fixes it is the form being a real form: with `action` set to
 * a Server Action, the browser submits natively before any JavaScript has run,
 * and React takes the same action over once it has. The submit path is
 * identical either way, so the two cannot drift.
 *
 * ## Why it does not just call /api/scan
 *
 * That route answers JSON to a caller that will read it. A form post has no
 * reader — the only thing it can do with an outcome is follow a redirect. So
 * this runs the same five steps in the same order and ends in `redirect()`
 * rather than a response body.
 *
 * `deep` is deliberately absent. The no-JavaScript path is the fallback, and a
 * deep scan is the one that needs a client polling for progress.
 */

/** Where a rejected submission goes, with a sentence the page can render. */
function backToHero(reason: string): never {
  redirect(`/?scan_error=${encodeURIComponent(reason)}#scan`)
}

export async function startScanAction(formData: FormData): Promise<void> {
  const raw = formData.get('url')
  if (typeof raw !== 'string') backToHero('Enter a website address to scan.')

  // The same normalisation the client and the API route run. Three callers,
  // one definition of what a scannable address is.
  const target = normalizeScanTarget(raw)
  if (!target.ok) backToHero(target.reason)

  /*
   * The product rule the hero is built on: scanning is free, an account opens
   * the findings. A signed-out visitor is sent to sign in and comes back here.
   *
   * The URL they typed is NOT carried in this redirect. The enhanced path keeps
   * it in sessionStorage, which no server redirect can write; carrying it as a
   * query parameter instead would make this statically prerendered page read
   * searchParams, and turn the landing page dynamic for every visitor to serve
   * the few who arrive without JavaScript. Retyping an address is a smaller
   * cost than that.
   */
  const viewer = await getViewer()
  // Sign in, then land in the app — the dashboard, whose scan form is waiting —
  // not back on the marketing page. (%2Fdashboard is "/dashboard" encoded.)
  if (viewer.kind !== 'user') redirect('/login?next=%2Fdashboard')

  // Already answered recently by this account: reuse it rather than fetch the
  // target twice. Keyed on the user, because scanning needs an account now and
  // the scan we are looking for carries their id, not a null one.
  const cached = await findRecentScanForUser(
    target.url,
    'fast',
    viewer.userId,
    new Date(Date.now() - DEDUP_WINDOW_MS),
  )
  if (cached) redirect(`/scan/${cached.id}`)

  const quota = await checkScanQuota(viewer)
  if (!quota.ok) backToHero(quota.reason)

  // By account, not by IP — see the note in app/api/scan/route.ts.
  const anonIpHash = clientIpHash(await headers())
  const verdict = await checkApiScanAllowed({ userId: viewer.userId, targetHost: target.hostname })
  if (!verdict.ok) backToHero(verdict.reason)

  let scanId: string
  try {
    scanId = await runScanJob({
      url: target.url,
      profile: 'fast',
      anonIpHash,
      requestedBy: viewer.userId,
    })
  } catch (error) {
    // runScanJob records a failed scan itself and still returns an id, so
    // reaching here means something below it broke.
    console.error('[scan-action] could not record the scan', error)
    backToHero('Could not start the scan. Please try again in a moment.')
  }

  redirect(`/scan/${scanId}`)
}
