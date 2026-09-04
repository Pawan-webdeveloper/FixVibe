'use client'

/*
 * Form to post one incident update.
 *
 * Posts to /api/incidents/[id]/updates. On success, calls onPosted with
 * the new row so the parent can re-render the timeline without a full
 * page reload. The page's server-rendered timeline is the source of
 * truth; this form is just a thin client wrapper around the POST.
 */

import { useState, useTransition } from 'react'

const STATUSES = [
  { value: 'investigating', label: 'Investigating' },
  { value: 'identified', label: 'Identified' },
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'resolved', label: 'Resolved' },
] as const

interface IncidentUpdateRow {
  id: string
  incidentId: string
  status: 'investigating' | 'identified' | 'monitoring' | 'resolved'
  message: string
  createdBy: string | null
  createdAt: string
  creatorEmail: string | null
}

interface IncidentUpdateFormProps {
  incidentId: string
  onPosted?: (update: IncidentUpdateRow) => void
}

export function IncidentUpdateForm({ incidentId, onPosted }: IncidentUpdateFormProps) {
  const [status, setStatus] = useState<typeof STATUSES[number]['value']>('investigating')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    if (message.trim().length === 0) {
      setError('Message cannot be empty')
      return
    }

    startTransition(async () => {
      const res = await fetch(`/api/incidents/${incidentId}/updates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, message }),
      })
      const data = (await res.json()) as {
        update?: IncidentUpdateRow
        error?: string
      }
      if (!res.ok) {
        setError(data.error ?? 'Failed to post update')
        return
      }
      if (data.update) {
        setMessage('')
        onPosted?.(data.update)
      }
    })
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor={`status-${incidentId}`}
          className="text-xs font-medium text-gray-600"
        >
          Stage
        </label>
        <select
          id={`status-${incidentId}`}
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          disabled={isPending}
          className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 focus:border-blue-500 focus:outline-none"
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor={`message-${incidentId}`}
          className="mb-1 block text-xs font-medium text-gray-600"
        >
          Message
        </label>
        <textarea
          id={`message-${incidentId}`}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={4000}
          rows={4}
          disabled={isPending}
          placeholder="What is the current status? What did you check?"
          className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none disabled:opacity-50"
        />
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">{message.length}/4000</p>
        <button
          type="submit"
          disabled={isPending || message.trim().length === 0}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? 'Posting…' : 'Post update'}
        </button>
      </div>
    </form>
  )
}
