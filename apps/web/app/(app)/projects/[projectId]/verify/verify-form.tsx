'use client'

import { useActionState } from 'react'
import { CopyButton } from '@/components/scan/copy-button.tsx'
import {
  confirmVerificationAction,
  revokeVerificationAction,
  startVerificationAction,
  type VerifyState,
} from './actions.ts'

/**
 * The interactive half of the verification page.
 *
 * Three separate forms rather than one with three submits: each posts to a
 * different action and each has its own pending state, and a single form would
 * make "Check now" and "Remove verification" share a disabled flag they have
 * no reason to share.
 *
 * The record is shown as three copyable fields rather than one line, because
 * that is the shape of every DNS provider's form and retyping a 64-character
 * value by hand is where this flow fails.
 */

const BUTTON = 'label inline-flex h-11 items-center px-6 transition-colors duration-150'
const PRIMARY = `${BUTTON} border border-ink bg-ink text-canvas hover:bg-transparent hover:text-ink`
const SECONDARY = `${BUTTON} border border-line hover:bg-surface`

export function VerifyForm({
  projectId,
  host,
  token,
  recordName,
  verified,
}: {
  projectId: string
  host: string
  token: string | null
  recordName: string
  verified: boolean
}) {
  if (verified) return <RevokeForm projectId={projectId} host={host} />
  if (!token) return <StartForm projectId={projectId} />

  return <ConfirmForm projectId={projectId} recordName={recordName} token={token} />
}

function StartForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState<VerifyState, FormData>(startVerificationAction, {})

  return (
    <form action={action}>
      <input type="hidden" name="projectId" value={projectId} />
      <p className="max-w-[64ch] text-[15px] leading-relaxed text-muted text-pretty">
        This project predates domain verification and has no record yet.
      </p>
      <button type="submit" disabled={pending} className={`${PRIMARY} mt-6 disabled:opacity-60`}>
        {pending ? 'Generating…' : 'Generate the record'}
      </button>
      <Problem state={state} />
    </form>
  )
}

function ConfirmForm({
  projectId,
  recordName,
  token,
}: {
  projectId: string
  recordName: string
  token: string
}) {
  const [state, action, pending] = useActionState<VerifyState, FormData>(confirmVerificationAction, {})

  const fields: Array<[string, string]> = [
    ['Type', 'TXT'],
    ['Name', recordName],
    ['Value', token],
  ]

  return (
    <>
      <dl className="mt-8 border border-line">
        {fields.map(([label, value]) => (
          <div
            key={label}
            className="flex flex-col gap-2 border-b border-line px-5 py-4 last:border-0 sm:flex-row sm:items-center"
          >
            <dt className="label w-16 shrink-0 text-muted">{label}</dt>
            <dd className="min-w-0 flex-1 break-all text-sm">{value}</dd>
            <CopyButton text={value} label={`Copy ${label.toLowerCase()}`} />
          </div>
        ))}
      </dl>

      <form action={action} className="mt-8">
        <input type="hidden" name="projectId" value={projectId} />
        <button type="submit" disabled={pending} className={`${PRIMARY} disabled:opacity-60`}>
          {pending ? 'Checking DNS…' : 'Check now'}
        </button>
        <Problem state={state} />
      </form>
    </>
  )
}

function RevokeForm({ projectId, host }: { projectId: string; host: string }) {
  const [state, action, pending] = useActionState<VerifyState, FormData>(revokeVerificationAction, {})

  return (
    <form action={action} className="mt-8">
      <input type="hidden" name="projectId" value={projectId} />
      <p className="max-w-[64ch] text-[15px] leading-relaxed text-muted text-pretty">
        Removing this stops the backend checks running against {host}. The record can stay in DNS —
        the same value will work if you verify again.
      </p>
      <button type="submit" disabled={pending} className={`${SECONDARY} mt-6 disabled:opacity-60`}>
        {pending ? 'Removing…' : 'Remove verification'}
      </button>
      <Problem state={state} />
    </form>
  )
}

/**
 * A failure shows what was actually at the name, not just that it did not
 * match. "None matched" with nothing to compare against is the least
 * actionable sentence a verification flow can produce.
 */
function Problem({ state }: { state: VerifyState }) {
  if (!state.error) return null

  return (
    <div role="alert" className="mt-4 border border-line bg-surface px-4 py-3">
      <p className="text-sm">▲ {state.error}</p>
      {state.found && state.found.length > 0 && (
        <>
          <p className="label mt-3 text-muted">Found at that name</p>
          <ul className="mt-1 flex flex-col gap-1">
            {state.found.map((value) => (
              <li key={value} className="break-all text-xs text-muted">
                {value}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
