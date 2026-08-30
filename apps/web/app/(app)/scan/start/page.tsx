/**
 * Post-signin entry point for a scan the visitor started before authenticating.
 *
 * The URL the visitor typed is in sessionStorage (stashed by useScanSubmit
 * on the way to /login). The client component reads it, asks /api/scan to
 * run the scan, and follows the redirect to /scan/<id> — the report page,
 * which itself bounces an unprioritised reader to /welcome?next=/scan/<id>
 * for the one priority question.
 *
 * The full happy path is therefore: home page → press Scan → sign in with
 * Google → /scan/<id> running → /welcome (if priorities are unset) → back
 * to /scan/<id>. The two-step detour through /welcome is what the user
 * asked for, and it is also what app/scan/[scanId]/page.tsx already does for
 * a signed-in reader whose priorities have not been answered.
 */

import { StartScanClient } from './start-scan-client.tsx'

export const metadata = { title: 'Starting your scan' }

export default function StartScanPage() {
  return <StartScanClient />
}
