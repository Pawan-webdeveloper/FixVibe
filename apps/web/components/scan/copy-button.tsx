'use client'

import { useState } from 'react'

/**
 * The only interactive part of a report. Kept as its own client component so
 * the finding card around it stays server-rendered and ships no JavaScript.
 */
export function CopyButton({ text, label = 'Copy fix prompt' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access is denied in some contexts (insecure origin, denied
      // permission). Saying so beats a button that silently does nothing.
      setCopied(false)
      alert('Your browser blocked clipboard access. Select the text and copy it manually.')
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-live="polite"
      className="border border-line px-3 py-1.5 text-xs font-medium hover:bg-surface"
    >
      {copied ? 'Copied' : label}
    </button>
  )
}
