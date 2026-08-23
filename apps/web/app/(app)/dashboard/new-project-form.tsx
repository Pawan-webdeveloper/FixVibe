'use client'

import { useActionState } from 'react'
import { createProjectAction, type ActionState } from './actions.ts'

/**
 * The orgId is passed through the form for convenience, and re-derived from the
 * session inside the action — a value that arrives in a POST body is a claim,
 * not a fact.
 */
export function NewProjectForm({ orgId }: { orgId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createProjectAction, {})

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <input type="hidden" name="orgId" value={orgId} />
        <label htmlFor="new-project-url" className="sr-only">
          Site address
        </label>
        <input
          id="new-project-url"
          name="url"
          type="text"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          required
          placeholder="example.com"
          disabled={pending}
          aria-invalid={Boolean(state.error)}
          className="rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-60"
        >
          {pending ? 'Adding…' : 'Add project'}
        </button>
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
    </form>
  )
}
