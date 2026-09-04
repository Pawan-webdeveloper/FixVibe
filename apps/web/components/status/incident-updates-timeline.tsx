/*
 * Public incident updates timeline.
 *
 * Vertical list — newest at the top so the first thing a customer
 * reading the page sees is the latest message, not the original
 * "investigating" post from half an hour ago.
 *
 * Pure server component — no client JS.
 */

import { incidentUpdateStatusLabel } from '@scanlyfix/db'

export interface IncidentUpdateView {
  status: 'investigating' | 'identified' | 'monitoring' | 'resolved'
  message: string
  createdAt: Date
}

interface IncidentUpdatesTimelineProps {
  updates: ReadonlyArray<IncidentUpdateView>
}

function formatDateTime(date: Date): string {
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Stage → badge colour classes. The four stages have visually
 * distinct hues so the eye reads progression without parsing the
 * text. Resolved is the only "good" colour; the others progress
 * from urgent (investigating) → identified → monitoring.
 */
function badgeClass(status: IncidentUpdateView['status']): string {
  switch (status) {
    case 'investigating':
      return 'bg-red-50 text-red-700'
    case 'identified':
      return 'bg-amber-50 text-amber-700'
    case 'monitoring':
      return 'bg-blue-50 text-blue-700'
    case 'resolved':
      return 'bg-emerald-50 text-emerald-700'
  }
}

export function IncidentUpdatesTimeline({ updates }: IncidentUpdatesTimelineProps) {
  // Newest first — that's how the public reads it during an incident.
  // Updates arrive ASC from the DB; reverse for the page.
  const ordered = [...updates].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )

  return (
    <ol
      data-testid="incident-updates-timeline"
      className="relative space-y-5 border-l border-gray-200 pl-5"
    >
      {ordered.map((update, i) => (
        <li
          key={i}
          data-testid={`incident-update-${update.status}`}
          className="relative"
        >
          {/* Dot on the timeline — small, centred on the line */}
          <span
            aria-hidden="true"
            className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full bg-gray-300 ring-4 ring-white"
          />
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass(update.status)}`}
            >
              {incidentUpdateStatusLabel(update.status)}
            </span>
            <span className="text-xs text-gray-400">
              {formatDateTime(update.createdAt)}
            </span>
          </div>
          <p className="mt-1 whitespace-pre-line text-sm text-gray-700">
            {update.message}
          </p>
        </li>
      ))}
    </ol>
  )
}
