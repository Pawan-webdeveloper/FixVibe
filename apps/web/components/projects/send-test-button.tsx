'use client'

/**
 * apps/web/components/projects/send-test-button.tsx
 *
 * "Send test" button for an alert channel row.
 *
 * Why a dedicated component (not inline in the channel list):
 *   - Loading + success + error states are non-trivial — three states, three
 *     UI surfaces, and the parent has better things to render.
 *   - The fetch URL depends on the project id AND the channel id; the parent
 *     passes those in, the component handles the rest.
 *
 * Props:
 *   projectId — the project the channel belongs to
 *   channelId — the alert channel to test
 *   onResult  — called with the final { sent, reason? } so the parent can
 *               surface a toast or scroll the row into view
 */

import { useState } from 'react'

interface TestResult {
  sent: boolean
  reason?: string
}

interface SendTestButtonProps {
  projectId: string
  channelId: string
  onResult?: (result: TestResult) => void
}

type Status = 'idle' | 'sending' | 'success' | 'error'

export function SendTestButton({ projectId, channelId, onResult }: SendTestButtonProps) {
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState<string | null>(null)

  async function send() {
    setStatus('sending')
    setMessage(null)
    try {
      const res = await fetch(
        `/api/projects/${projectId}/alert-channels/test`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channelId }),
        },
      )
      const data = (await res.json()) as { error?: string } & TestResult

      if (!res.ok) {
        const reason = data.error ?? `Request failed (${res.status})`
        setStatus('error')
        setMessage(reason)
        onResult?.({ sent: false, reason })
        return
      }

      if (data.sent) {
        setStatus('success')
        setMessage('Test alert sent — check the channel')
        onResult?.({ sent: true })
      } else {
        setStatus('error')
        setMessage(data.reason ?? 'The channel refused the test')
        onResult?.({ sent: false, reason: data.reason })
      }
    } catch {
      setStatus('error')
      setMessage('Network error — try again')
      onResult?.({ sent: false, reason: 'Network error' })
    }
  }

  // Auto-clear the success state after a short delay so the row doesn't
  // carry a green check forever — that would obscure the next state.
  if (status === 'success' && message) {
    setTimeout(() => {
      setStatus('idle')
      setMessage(null)
    }, 3000)
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={send}
        disabled={status === 'sending'}
        className="rounded-md border border-c-line bg-c-soft px-3 py-1.5 text-xs font-medium text-c-muted transition-colors hover:border-c-accent/50 hover:text-c-ink disabled:opacity-50"
      >
        {status === 'sending' ? 'Sending…' : 'Send test'}
      </button>
      {message && (
        <p
          role={status === 'error' ? 'alert' : 'status'}
          className={`max-w-xs text-right text-xs ${
            status === 'error' ? 'text-red-500' : 'text-emerald-500'
          }`}
        >
          {message}
        </p>
      )}
    </div>
  )
}
