import Link from 'next/link'
import { notFound } from 'next/navigation'
import { verificationState } from '@scanlyfix/db'
import { getViewer } from '@/lib/authz.ts'
import { LabeledRule } from '@/components/ui/labeled-rule.tsx'
import { recordName } from '@/lib/domain-verification.ts'
import { VerifyForm } from './verify-form.tsx'

export const metadata = { title: 'Verify domain' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Proving ownership, and saying plainly what it buys.
 *
 * The page leads with what unlocks rather than with the mechanics, because
 * "add a TXT record" is a chore and nobody does a chore without knowing why.
 * What it unlocks is the only two checks in the engine that send a request to
 * somebody else's backend — which is also exactly why the gate exists.
 *
 * Renders state and nothing else; every write is a server action in
 * verify-form.tsx. A page that mutated during render would run its mutation
 * twice on a refresh.
 */
export default async function VerifyPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  if (!UUID.test(projectId)) notFound()

  const viewer = await getViewer()
  const state = await verificationState(projectId, viewer)
  if (!state) notFound()

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <Link href={`/projects/${projectId}`} className="label link text-muted hover:text-ink">
        ← Back to project
      </Link>

      <div className="mt-8">
        <LabeledRule
          label="Domain ownership"
          trailing={state.verified ? 'verified' : 'not verified'}
        />
      </div>

      <h1 className="mt-6 text-2xl font-semibold tracking-[-0.02em]">
        {state.verified ? `${state.host} is verified` : `Prove you control ${state.host}`}
      </h1>

      {state.verified ? (
        <p className="mt-5 max-w-[64ch] text-[15px] leading-relaxed text-muted text-pretty">
          Verified {state.verifiedAt ? stamp(state.verifiedAt) : 'previously'}. Scans of this
          project now run the two backend checks below.
        </p>
      ) : (
        <>
          <p className="mt-5 max-w-[64ch] text-[15px] leading-relaxed text-muted text-pretty">
            Two checks in the engine send a request to your own backend rather than reading your
            page. Probing a backend you do not own is unauthorised testing however gentle the
            request, so they run only for a domain whose operator has proved it is theirs.
          </p>

          <Unlocks />

          <p className="mt-8 max-w-[64ch] text-[15px] leading-relaxed text-muted text-pretty">
            Add this TXT record at your DNS provider, then press Check now. Nothing your browser
            sends decides this — we read the record ourselves.
          </p>
        </>
      )}

      <VerifyForm
        projectId={state.projectId}
        host={state.host}
        token={state.token}
        recordName={recordName(state.host)}
        verified={state.verified}
      />
    </div>
  )
}

/** Named, so the chore has a stated price and a stated reward. */
function Unlocks() {
  const checks: Array<[string, string]> = [
    [
      'Supabase row-level security',
      'Reads the anon key from your own JavaScript and asks your project whether it will hand a stranger the contents of your tables.',
    ],
    [
      'Firebase security rules',
      'Asks your Realtime Database and Firestore the same question, from outside, with no credentials.',
    ],
  ]

  return (
    <dl className="mt-8 border border-line">
      {checks.map(([name, what]) => (
        <div key={name} className="border-b border-line px-5 py-4 last:border-0">
          <dt className="font-medium">{name}</dt>
          <dd className="mt-1 max-w-[62ch] text-sm text-muted text-pretty">{what}</dd>
        </div>
      ))}
    </dl>
  )
}

/** UTC, like every other timestamp the product shows. */
function stamp(date: Date): string {
  return `on ${date.toISOString().slice(0, 10)}`
}
