'use client'

import { useActionState } from 'react'
import type { ApiKeySummary } from '@scanlyfix/db'
import { CopyButton } from '@/components/scan/copy-button.tsx'
import {
  createApiKeyAction,
  revokeApiKeyAction,
  type CreateKeyState,
  type RevokeKeyState,
} from './actions.ts'

/**
 * The interactive half of the API keys screen.
 *
 * The plaintext key is held in this component's action state and nowhere else.
 * It is not written to a cookie, not re-rendered from the server, and not
 * recoverable by reloading — because the only way to guarantee a database dump
 * cannot be replayed is for the database never to have held it. The UI says so
 * plainly rather than letting someone discover it by refreshing.
 *
 * Revoke gets its own component per row so each button has its own pending
 * state. One shared action state would disable every row while any one of them
 * was in flight, which reads as a hung page.
 */

const BUTTON = 'label inline-flex h-11 items-center px-6 transition-colors duration-150'
const PRIMARY = `${BUTTON} border border-ink bg-ink text-canvas hover:bg-transparent hover:text-ink`

export function KeysPanel({ keys, remaining }: { keys: ApiKeySummary[]; remaining: number }) {
  const [state, action, pending] = useActionState<CreateKeyState, FormData>(createApiKeyAction, {})

  return (
    <>
      {state.plaintext && <RevealedKey plaintext={state.plaintext} />}

      <form action={action} className="mt-8 flex flex-col gap-3 sm:flex-row">
        <label className="sr-only" htmlFor="key-name">
          Key name
        </label>
        <input
          id="key-name"
          name="name"
          required
          maxLength={60}
          placeholder="CI, staging, laptop…"
          className="h-11 min-w-0 flex-1 border border-line bg-canvas px-4 text-sm
                     placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2
                     focus-visible:outline-ink"
        />
        <button
          type="submit"
          disabled={pending || remaining <= 0}
          className={`${PRIMARY} shrink-0 disabled:opacity-60`}
        >
          {pending ? 'Creating…' : 'Create key'}
        </button>
      </form>

      <p className="mt-3 text-sm text-muted">
        {remaining > 0
          ? `${remaining} more ${remaining === 1 ? 'key' : 'keys'} available on your plan.`
          : 'You have used every key your plan allows. Revoke one to issue another.'}
      </p>

      {state.error && (
        <p role="alert" className="mt-4 border border-line bg-surface px-4 py-3 text-sm">
          ▲ {state.error}
        </p>
      )}

      <KeyList keys={keys} />
    </>
  )
}

/**
 * The one time the secret is on screen. Loud, because a reload destroys it and
 * the person reading this has no way to know that unless they are told.
 */
function RevealedKey({ plaintext }: { plaintext: string }) {
  return (
    <div className="mt-8 border border-ink p-5">
      <p className="label text-ink">Copy this now</p>
      <p className="mt-2 max-w-[62ch] text-sm text-muted text-pretty">
        This is the only time it is shown. We store a hash, not the key, so it cannot be recovered
        — if you lose it, revoke it and issue another.
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <code className="min-w-0 flex-1 break-all border border-line bg-surface px-4 py-3 text-xs">
          {plaintext}
        </code>
        <CopyButton text={plaintext} label="Copy key" />
      </div>
    </div>
  )
}

function KeyList({ keys }: { keys: ApiKeySummary[] }) {
  if (keys.length === 0) {
    return (
      <p className="mt-8 border border-line px-5 py-8 text-center text-sm text-muted">
        No keys yet.
      </p>
    )
  }

  return (
    <ul className="mt-8 border border-line">
      {keys.map((key) => (
        <li
          key={key.id}
          className="flex flex-col gap-3 border-b border-line px-5 py-4 last:border-0
                     sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="truncate font-medium">{key.name ?? 'Unnamed key'}</p>
            <p className="mt-1 text-xs text-muted">
              <span className="break-all">{key.prefix ? `${key.prefix}…` : 'created before prefixes'}</span>
              {' · '}
              added {stamp(key.createdAt)}
              {' · '}
              {key.lastUsedAt ? `last used ${stamp(key.lastUsedAt)}` : 'never used'}
            </p>
          </div>
          <RevokeButton keyId={key.id} name={key.name ?? 'this key'} />
        </li>
      ))}
    </ul>
  )
}

function RevokeButton({ keyId, name }: { keyId: string; name: string }) {
  const [state, action, pending] = useActionState<RevokeKeyState, FormData>(revokeApiKeyAction, {})

  return (
    <form action={action} className="shrink-0">
      <input type="hidden" name="keyId" value={keyId} />
      <button
        type="submit"
        disabled={pending}
        className="border border-line px-3 py-1.5 text-xs font-medium hover:bg-surface disabled:opacity-60"
      >
        {pending ? 'Revoking…' : 'Revoke'}
      </button>
      {/* Announced rather than shown in a corner: the row is about to vanish. */}
      <span role="alert" className="sr-only">
        {state.error ? `${name}: ${state.error}` : ''}
      </span>
    </form>
  )
}

/** UTC, like every other timestamp the product shows. */
function stamp(date: Date | string): string {
  return new Date(date).toISOString().slice(0, 10)
}
