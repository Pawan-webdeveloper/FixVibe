'use client'

import { useState } from 'react'
import { CopyButton } from './copy-button.tsx'

/**
 * The whole report as one instruction for a coding agent.
 *
 * Collapsed by default. Expanded it is several hundred lines, and the reader
 * arrived here to understand their site — not to read a work order they are
 * about to paste somewhere else without looking at it.
 *
 * A <details> rather than a modal: it is server-rendered content, it needs no
 * focus trapping, and it survives with JavaScript disabled.
 */
export function FixPromptDialog({ prompt, issueCount }: { prompt: string; issueCount: number }) {
  const [open, setOpen] = useState(false)

  return (
    <section className="mt-6 rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="text-sm font-medium">Fix all of this in one prompt</h2>
          <p className="text-sm text-muted">
            {issueCount} issues, grouped by where the change is made, written for a coding agent.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen((was) => !was)}
            aria-expanded={open}
            className="rounded-md border border-line px-3 py-1.5 text-xs font-medium hover:bg-canvas"
          >
            {open ? 'Hide' : 'Show'}
          </button>
          <CopyButton text={prompt} label="Copy prompt" />
        </div>
      </div>

      {open && (
        <pre className="max-h-[28rem] overflow-auto border-t border-line px-5 py-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
          {prompt}
        </pre>
      )}
    </section>
  )
}
