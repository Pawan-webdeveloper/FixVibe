/**
 * One finding.
 *
 * The evidence block is the point of this component. It is the difference
 * between "trust me" and "here is the header your server sent" — every claim
 * the engine makes is backed by a value it actually observed, and showing that
 * value is what makes the rest of the report believable.
 *
 * The `locked` variant exists before anything locks it (Phase 4). Retrofitting
 * a lock state into a card that assumes full data means touching every branch;
 * accepting it now costs one conditional.
 */

import type { Category, Severity } from '@scanlyfix/checks'
import { CopyButton } from './copy-button.tsx'

export interface FindingView {
  checkId: string
  category: Category
  severity: Severity
  title: string
  description?: string | null
  evidence?: Record<string, unknown> | null
  remediation?: string | null
  fixPrompt?: string | null
  /** Free-tier placeholder: the server never sent the body of this finding. */
  locked?: boolean
}

const SEVERITY_STYLE: Record<Severity, string> = {
  critical: 'text-critical border-critical',
  high: 'text-high border-high',
  medium: 'text-medium border-medium',
  low: 'text-low border-low',
  info: 'text-info border-info',
}

/** Long enough to be evidence, short enough not to become the page. */
const MAX_VALUE_CHARS = 400

function renderValue(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  if (text === undefined) return 'undefined'
  return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}…` : text
}

function Evidence({ evidence }: { evidence: Record<string, unknown> }) {
  const entries = Object.entries(evidence)
  if (entries.length === 0) return null

  return (
    <div className="mt-3">
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted">Observed</p>
      <dl className="overflow-x-auto border border-line bg-surface p-3 font-mono text-xs">
        {entries.map(([key, value]) => (
          <div key={key} className="flex flex-col gap-0.5 py-1 sm:flex-row sm:gap-3">
            <dt className="shrink-0 text-muted sm:w-40">{key}</dt>
            <dd className="min-w-0 whitespace-pre-wrap break-words">{renderValue(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function FindingCard({
  finding,
  lockedNote = 'The detail and the fix for this finding are withheld.',
}: {
  finding: FindingView
  /** Why this one is closed. The card cannot know; the page can. */
  lockedNote?: string
}) {
  return (
    <article className="border border-line p-4">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className={` border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${SEVERITY_STYLE[finding.severity]}`}
        >
          {finding.severity}
        </span>
        <h3 className="flex-1 text-base font-medium text-balance">{finding.title}</h3>
        <code className="font-mono text-xs text-muted">{finding.checkId}</code>
      </header>

      {finding.locked ? (
        <p className="mt-3 text-sm text-muted">{lockedNote}</p>
      ) : (
        <>
          {finding.description && (
            <p className="mt-2 max-w-[75ch] text-sm text-muted text-pretty">{finding.description}</p>
          )}

          {finding.evidence && <Evidence evidence={finding.evidence} />}

          {finding.remediation && (
            <p className="mt-3 max-w-[75ch] text-sm">
              <span className="font-medium">Fix: </span>
              {finding.remediation}
            </p>
          )}

          {finding.fixPrompt && (
            <div className="mt-3">
              <CopyButton text={finding.fixPrompt} />
            </div>
          )}
        </>
      )}
    </article>
  )
}
