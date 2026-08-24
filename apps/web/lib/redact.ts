/**
 * Removing paid content before it can be serialized.
 *
 * The tempting version of a paywall renders every finding and blurs three with
 * CSS. That is not a paywall, it is a blurred copy of the answer sitting in the
 * page source — and the first reader who opens dev tools learns that the
 * product bluffs.
 *
 * So redaction happens here, above the serializer, and the shape does the
 * enforcing: `LockedFinding` has no `description`, `evidence`, `remediation` or
 * `fixPrompt` FIELDS. Reaching for one on a PublicFinding without narrowing the
 * union is a compile error, which is a stronger guarantee than a code review.
 *
 * ONE IMPLEMENTATION RULE, and it is the whole file: a locked finding is
 * CONSTRUCTED field by field, never spread from the full one. TypeScript's
 * excess-property checking does not survive a spread — `{ ...finding, locked:
 * true }` types as LockedFinding while still carrying fixPrompt at runtime, and
 * JSON.stringify does not read types. The test suite asserts on the serialized
 * output for exactly that reason.
 */

import 'server-only'
import type { Category, Severity } from '@darvin/checks'
import type { Entitlements } from './entitlements.ts'

/** What every reader sees, at every tier: enough to know what they are missing. */
interface FindingIdentity {
  checkId: string
  category: Category
  severity: Severity
  title: string
}

export interface OpenFinding extends FindingIdentity {
  locked: false
  description: string
  evidence: Record<string, unknown> | null
  remediation: string
  fixPrompt: string
}

export interface LockedFinding extends FindingIdentity {
  locked: true
}

export type PublicFinding = OpenFinding | LockedFinding

/** Structural, so a database row and an engine Finding both satisfy it. */
export interface RedactableFinding extends FindingIdentity {
  description: string
  evidence?: Record<string, unknown> | null
  remediation: string
  fixPrompt: string
}

export interface RedactedReport {
  findings: PublicFinding[]
  /** How many were withheld — the number the upgrade prompt is built from. */
  lockedCount: number
  /** Severities among the withheld, so the reader knows what they are worth. */
  lockedSeverities: Severity[]
}

/**
 * Findings arrive worst-first from the engine, and that order is preserved, so
 * the ones a free reader gets in full are always the ones that matter most —
 * not whichever happened to come cheap.
 */
export function redactFindings(
  findings: readonly RedactableFinding[],
  entitlements: Entitlements,
): RedactedReport {
  const limit = entitlements.plan.fullFindings ? Number.POSITIVE_INFINITY : entitlements.plan.findingsShownInFull

  const publicFindings: PublicFinding[] = []
  const lockedSeverities: Severity[] = []

  findings.forEach((finding, index) => {
    if (index < limit) {
      publicFindings.push({
        locked: false,
        checkId: finding.checkId,
        category: finding.category,
        severity: finding.severity,
        title: finding.title,
        description: finding.description,
        evidence: finding.evidence ?? null,
        remediation: finding.remediation,
        fixPrompt: finding.fixPrompt,
      })
      return
    }

    // Constructed, not spread. See the file header — this is the line the
    // whole paywall rests on.
    publicFindings.push({
      locked: true,
      checkId: finding.checkId,
      category: finding.category,
      severity: finding.severity,
      title: finding.title,
    })
    lockedSeverities.push(finding.severity)
  })

  return { findings: publicFindings, lockedCount: lockedSeverities.length, lockedSeverities }
}

/**
 * The aggregate prompt is the reason to pay, so it is withheld whole rather
 * than truncated. A partial work order is worse than none: an agent handed half
 * of it makes half the changes and reports success.
 */
export function canSeeFixPrompt(entitlements: Entitlements): boolean {
  return entitlements.plan.fixPrompts
}
