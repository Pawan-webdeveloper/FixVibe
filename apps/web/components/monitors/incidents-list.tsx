'use client'

import { useState, useTransition } from 'react'

interface Incident {
  id: string
  startedAt: string
  resolvedAt: string | null
  durationMs: number | null
  statusCode: number | null
  detail: string | null
  acknowledgedAt: string | null
  acknowledgedBy: string | null
  acknowledgerEmail: string | null
  notes: string | null
}

interface IncidentsListProps {
  incidents: Incident[]
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function shortName(email: string | null): string {
  if (!email) return 'Unknown user'
  // Strip the domain — what the user actually typed is the part they recognise.
  const at = email.indexOf('@')
  return at > 0 ? email.slice(0, at) : email
}

export function IncidentsList({ incidents }: IncidentsListProps) {
  if (incidents.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-gray-400">
        No incidents recorded — all good.
      </p>
    )
  }

  return (
    <div className="divide-y divide-gray-100">
      {incidents.map((incident) => (
        <IncidentRow key={incident.id} incident={incident} />
      ))}
    </div>
  )
}

// ─── Per-row component ────────────────────────────────────────────────────────
// Owns its own state so the ack/notes interactions do not re-render the whole
// list on every keystroke. The list is bounded (default 50 rows), but the
// textarea would be the slow part without this split.
function IncidentRow({ incident: initial }: { incident: Incident }) {
  const [incident, setIncident] = useState<Incident>(initial)
  const [expanded, setExpanded] = useState(false)
  const [draft, setDraft] = useState<string>(initial.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const isOpen = incident.resolvedAt === null
  const isAcked = incident.acknowledgedAt !== null
  // Note: only open incidents can be re-acked. A resolved incident already
  // has its full audit trail; a re-ack would lie about who handled it.
  const canAck = isOpen

  function ack() {
    setError(null)
    startTransition(async () => {
      const res = await fetch(`/api/incidents/${incident.id}/ack`, {
        method: 'POST',
      })
      const data = (await res.json()) as { incident?: Incident; error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Failed to acknowledge')
        return
      }
      if (data.incident) setIncident(data.incident)
    })
  }

  function saveNotes() {
    setError(null)
    startTransition(async () => {
      const res = await fetch(`/api/incidents/${incident.id}/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: draft.length > 0 ? draft : null }),
      })
      const data = (await res.json()) as { incident?: Incident; error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Failed to save notes')
        return
      }
      if (data.incident) {
        setIncident(data.incident)
        setDraft(data.incident.notes ?? '')
      }
    })
  }

  return (
    <div className="py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                isOpen
                  ? 'bg-red-50 text-red-600'
                  : 'bg-gray-100 text-gray-500'
              }`}
            >
              {isOpen && (
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
              )}
              {isOpen ? 'Ongoing' : 'Resolved'}
            </span>
            {incident.statusCode && (
              <span className="text-xs text-gray-400">
                HTTP {incident.statusCode}
              </span>
            )}
            {isAcked && (
              <span
                data-testid="acknowledged-badge"
                className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
                title={`Acknowledged at ${formatDate(incident.acknowledgedAt)}`}
              >
                ✓ Acknowledged by {shortName(incident.acknowledgerEmail)}{' '}
                <span className="font-normal text-emerald-600/70">
                  · {formatDate(incident.acknowledgedAt)}
                </span>
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-gray-600">
            {formatDate(incident.startedAt)}
            {incident.resolvedAt && ` — ${formatDate(incident.resolvedAt)}`}
          </p>
          {incident.detail && (
            <p className="mt-0.5 truncate text-xs text-gray-400">
              {incident.detail}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className="text-sm text-gray-500">
            {isOpen ? (
              <span className="font-medium text-red-500">ongoing</span>
            ) : incident.durationMs != null ? (
              formatDuration(incident.durationMs)
            ) : null}
          </span>
          <div className="flex gap-1.5">
            <a
              href={`/incidents/${incident.id}`}
              className="rounded-md border border-c-line bg-c-soft px-2.5 py-1 text-xs font-medium text-c-muted transition-colors hover:border-c-accent/50 hover:text-c-ink"
            >
              Timeline
            </a>
            {canAck && !isAcked && (
              <button
                type="button"
                onClick={ack}
                disabled={isPending}
                className="rounded-md border border-c-line bg-c-soft px-2.5 py-1 text-xs font-medium text-c-muted transition-colors hover:border-c-accent/50 hover:text-c-ink disabled:opacity-50"
              >
                {isPending ? 'Acking…' : 'Ack'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="rounded-md border border-c-line bg-c-soft px-2.5 py-1 text-xs font-medium text-c-muted transition-colors hover:border-c-accent/50 hover:text-c-ink"
            >
              {expanded ? 'Hide notes' : incident.notes ? 'Edit notes' : 'Add notes'}
            </button>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 rounded-md border border-c-line bg-c-soft/40 p-3">
          <label
            htmlFor={`notes-${incident.id}`}
            className="mb-1 block text-xs font-medium text-c-muted"
          >
            On-call notes
          </label>
          <textarea
            id={`notes-${incident.id}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={4000}
            rows={4}
            placeholder="What did you check? What is the suspected cause?"
            className="w-full rounded-md border border-c-line bg-c-base px-3 py-2 text-sm text-c-ink placeholder-c-muted focus:border-c-accent focus:outline-none"
          />
          {error && (
            <p role="alert" className="mt-1 text-xs text-red-500">
              {error}
            </p>
          )}
          <div className="mt-2 flex items-center justify-between">
            <p className="text-xs text-c-muted">{draft.length}/4000</p>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setDraft(incident.notes ?? '')
                  setError(null)
                }}
                disabled={isPending}
                className="rounded-md border border-c-line px-2.5 py-1 text-xs text-c-muted hover:text-c-ink disabled:opacity-50"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={saveNotes}
                disabled={isPending || draft === (incident.notes ?? '')}
                className="rounded-md bg-c-accent px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50 hover:opacity-90"
              >
                {isPending ? 'Saving…' : 'Save notes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
