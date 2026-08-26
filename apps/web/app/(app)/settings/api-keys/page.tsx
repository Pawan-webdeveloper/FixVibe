import Link from 'next/link'
import { listApiKeys } from '@darvin/db'
import { requireUser } from '@/lib/authz.ts'
import { planFor } from '@/lib/plans.ts'
import { KeysPanel } from './keys-panel.tsx'

export const metadata = { title: 'API keys' }

/**
 * Issue, list and revoke the credentials that reach /api/v1.
 *
 * Renders state only; every write is a server action in actions.ts. The plan
 * gate is resolved here for what to SHOW, and again inside the action for what
 * to ALLOW — a hidden button is a design decision, never an access control.
 */
export default async function ApiKeysPage() {
  const user = await requireUser('/settings/api-keys')
  const plan = planFor(user.plan)

  if (!plan.apiAccess) return <Upgrade planName={plan.name} />

  const keys = await listApiKeys({ kind: 'user', userId: user.id })

  return (
    <>
      <h1 className="mt-8 text-2xl font-semibold tracking-[-0.02em]">API keys</h1>
      <p className="mt-4 max-w-[64ch] text-[15px] leading-relaxed text-muted text-pretty">
        A key scans on your behalf: same monthly allowance, same project history, same reports.
        Treat it like a password — anyone holding it can spend your scans.
      </p>

      <KeysPanel keys={keys} remaining={Math.max(0, plan.apiKeys - keys.length)} />

      <Usage />
    </>
  )
}

function Upgrade({ planName }: { planName: string }) {
  return (
    <>
      <h1 className="mt-8 text-2xl font-semibold tracking-[-0.02em]">API keys</h1>
      <p className="mt-4 max-w-[64ch] text-[15px] leading-relaxed text-muted text-pretty">
        The {planName} plan does not include API access. Pro adds keys for running scans from CI,
        so a deploy can fail on a new critical finding instead of on a screenshot somebody
        remembered to take.
      </p>
      <Link
        href="/settings/billing"
        className="label mt-8 inline-flex h-11 items-center border border-ink bg-ink px-6
                   text-canvas transition-colors duration-150 hover:bg-transparent hover:text-ink"
      >
        See Pro
      </Link>
    </>
  )
}

/**
 * Two requests, in full, because an API whose documentation is elsewhere is an
 * API people give up on at the first 401. The deep example is the one worth
 * spelling out: it returns 202 and an id, and the reader needs to see that
 * before they write code expecting a report.
 */
function Usage() {
  const examples: ReadonlyArray<[string, string]> = [
    [
      'Start a scan',
      `curl -X POST https://darvin.dev/api/v1/scan \\
  -H "Authorization: Bearer dv_…" \\
  -H "content-type: application/json" \\
  -d '{"url":"https://example.com","profile":"deep"}'`,
    ],
    [
      'Read it back',
      `curl https://darvin.dev/api/v1/scan/<id> \\
  -H "Authorization: Bearer dv_…"`,
    ],
  ]

  return (
    <section className="mt-12">
      <h2 className="label text-ink">Using a key</h2>
      <dl className="mt-4 border border-line">
        {examples.map(([title, snippet]) => (
          <div key={title} className="border-b border-line px-5 py-4 last:border-0">
            <dt className="text-sm font-medium">{title}</dt>
            <dd className="mt-2">
              <pre
                tabIndex={0}
                role="region"
                aria-label={title}
                className="overflow-x-auto bg-surface p-3 text-xs leading-relaxed
                           focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              >
                {snippet}
              </pre>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 max-w-[64ch] text-sm text-muted text-pretty">
        A fast scan answers 201 with a finished report. A deep one answers 202 and an id — poll the
        second request until <code className="text-ink">status</code> is{' '}
        <code className="text-ink">done</code> or <code className="text-ink">failed</code>. Errors
        carry a <code className="text-ink">code</code> alongside the message, so a pipeline can tell{' '}
        <code className="text-ink">quota_exceeded</code> from{' '}
        <code className="text-ink">rate_limited</code> without matching on prose.
      </p>
    </section>
  )
}
