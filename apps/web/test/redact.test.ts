/**
 * The paywall.
 *
 * Nearly every test here asserts on the SERIALIZED output rather than on the
 * object, because that is the only thing that proves the guarantee. A locked
 * finding built by spreading the full one satisfies the LockedFinding type and
 * still carries fixPrompt over the wire — types are erased and
 * JSON.stringify does not read them.
 */

import { describe, expect, it } from 'vitest'
import { canSeeFixPrompt, redactFindings, type RedactableFinding } from '../lib/redact.ts'
import { planFor } from '../lib/plans.ts'
import type { Entitlements } from '../lib/entitlements.ts'

const anonymous: Entitlements = {
  plan: planFor('free'),
  signedIn: false,
  findingsInFull: 0,
  priorities: null,
}
const free: Entitlements = {
  plan: planFor('free'),
  signedIn: true,
  findingsInFull: planFor('free').findingsShownInFull,
  priorities: null,
}
const pro: Entitlements = {
  plan: planFor('pro'),
  signedIn: true,
  findingsInFull: Number.POSITIVE_INFINITY,
  priorities: ['security'],
}

const finding = (n: number): RedactableFinding => ({
  checkId: `check.${n}`,
  category: 'security',
  severity: 'high',
  title: `title ${n}`,
  description: `SECRET-DESCRIPTION-${n}`,
  evidence: { header: `SECRET-EVIDENCE-${n}` },
  remediation: `SECRET-REMEDIATION-${n}`,
  fixPrompt: `SECRET-FIXPROMPT-${n}`,
})

const many = (count: number) => Array.from({ length: count }, (_, i) => finding(i))

describe('redactFindings', () => {
  it('gives a paying reader everything', () => {
    const report = redactFindings(many(10), pro)
    expect(report.lockedCount).toBe(0)
    expect(report.findings.every((f) => f.locked === false)).toBe(true)
  })

  it('opens nothing for a signed-out reader, and still names everything', () => {
    const report = redactFindings(many(10), anonymous)

    expect(report.lockedCount).toBe(10)
    expect(report.findings.every((f) => f.locked === true)).toBe(true)
    // The shape of the report is the whole offer: a stranger must be able to
    // see that there are ten problems and how bad they are.
    expect(report.findings.map((f) => f.title)).toEqual(many(10).map((f) => f.title))
    expect(report.lockedSeverities).toHaveLength(10)
  })

  it('sends no withheld text to a signed-out reader', () => {
    const wire = JSON.stringify(redactFindings(many(10), anonymous))

    expect(wire).not.toContain('SECRET-DESCRIPTION')
    expect(wire).not.toContain('SECRET-EVIDENCE')
    expect(wire).not.toContain('SECRET-REMEDIATION')
    expect(wire).not.toContain('SECRET-FIXPROMPT')
  })

  it('gives a signed-in free reader the worst three in full', () => {
    const report = redactFindings(many(10), free)
    expect(report.findings.filter((f) => !f.locked)).toHaveLength(3)
    expect(report.lockedCount).toBe(7)
  })

  it('keeps the engine ordering, so the three shown are the three worst', () => {
    const report = redactFindings(many(10), free)
    expect(report.findings.slice(0, 3).map((f) => f.checkId)).toEqual(['check.0', 'check.1', 'check.2'])
  })

  it('NEVER serializes withheld content', () => {
    // The test the whole file exists for. If a locked finding is ever built by
    // spreading the full one, the type still checks and this fails.
    const serialized = JSON.stringify(redactFindings(many(10), free))
    for (const marker of ['SECRET-DESCRIPTION-5', 'SECRET-EVIDENCE-5', 'SECRET-REMEDIATION-5', 'SECRET-FIXPROMPT-5']) {
      expect(serialized).not.toContain(marker)
    }
  })

  it('still serializes the content a free reader IS entitled to', () => {
    const serialized = JSON.stringify(redactFindings(many(10), free))
    expect(serialized).toContain('SECRET-FIXPROMPT-0')
  })

  it('tells the reader what they are missing, not just how much', () => {
    // "7 more findings, 2 of them high" converts; a blurred rectangle does not.
    const mixed: RedactableFinding[] = [
      { ...finding(0), severity: 'critical' },
      { ...finding(1), severity: 'high' },
      { ...finding(2), severity: 'high' },
      { ...finding(3), severity: 'medium' },
      { ...finding(4), severity: 'low' },
    ]
    const report = redactFindings(mixed, free)
    expect(report.lockedSeverities).toEqual(['medium', 'low'])
  })

  it('locks nothing when there is less than the free allowance', () => {
    expect(redactFindings(many(2), free).lockedCount).toBe(0)
  })

  it('handles a report with no findings', () => {
    expect(redactFindings([], free)).toEqual({ findings: [], lockedCount: 0, lockedSeverities: [] })
  })

  it('normalises absent evidence to null rather than dropping the field', () => {
    const [first] = redactFindings([{ ...finding(0), evidence: undefined }], pro).findings
    expect(first?.locked === false && first.evidence).toBeNull()
  })
})

describe('canSeeFixPrompt', () => {
  it('withholds the aggregate prompt from free', () => {
    expect(canSeeFixPrompt(free)).toBe(false)
  })

  it('gives it to a paying reader', () => {
    expect(canSeeFixPrompt(pro)).toBe(true)
  })
})
