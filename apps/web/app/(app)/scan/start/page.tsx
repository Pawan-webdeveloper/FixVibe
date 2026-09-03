/**
 * Post-signin confirmation for a scan the visitor started before authenticating.
 *
 * The URL the visitor typed is in sessionStorage (stashed by useScanSubmit on
 * the way to /login). This page shows the address back, warns that the report
 * is locked to it, and starts the scan only once the visitor confirms — then
 * follows the redirect to /scan/<id>, which bounces an unprioritised reader to
 * /welcome?next=/scan/<id> for the one priority question.
 *
 * The full happy path is therefore: home page → type URL → press Scan →
 * sign in → /scan/start (confirm the address) → /scan/<id> running →
 * /welcome (if priorities are unset) → back to /scan/<id>. A visitor with
 * nothing pending is sent to the dashboard, where the scan form is the first
 * section on the page.
 */

import { StartScanClient } from './start-scan-client.tsx'

export const metadata = { title: 'Starting your scan' }

export default function StartScanPage() {
  return <StartScanClient />
}
