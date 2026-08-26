/**
 * The three file formats.
 *
 * These are pure, so they can be pinned exhaustively — and two of the things
 * pinned here are the only real security properties in the export path:
 *
 *   CSV INJECTION. A cell beginning =, +, - or @ is executed as a formula by
 *   Excel and Sheets. The values in this file are a scanned site's own headers
 *   and markup quoted back as evidence, so they are attacker-influenced by
 *   definition, and a report opened in a spreadsheet is the normal case.
 *
 *   HTML ESCAPING. The same strings are rendered in a browser to make the PDF.
 *   One unescaped interpolation is script execution inside the renderer.
 *
 * The third property is not about attackers: a LOCKED finding must appear in
 * the file as withheld rather than be dropped, so a downloaded report is never
 * silently shorter than the one on screen.
 */

import { describe, expect, it } from 'vitest'
import type { ScanScores } from '@darvin/checks'
import { buildCsv, buildHtml, buildMarkdown, filename, type ReportInput, type ReportScan } from '../lib/report/build.ts'
import type { PublicFinding } from '../lib/redact.ts'

const SCORES: ScanScores = {
  security: 39, seo: 85, aeo: 100, performance: 100,
  accessibility: 97, compliance: 100, overall: 87, degraded: [],
}

const scan = (overrides: Partial<ReportScan> = {}): ReportScan => ({
  id: '11111111-2222-4333-8444-555555555555',
  url: 'https://example.com/',
  profile: 'fast',
  status: 'done',
  createdAt: new Date('2026-08-27T09:30:00.000Z'),
  finishedAt: new Date('2026-08-27T09:30:02.000Z'),
  durationMs: 2000,
  engineVersion: '1.8.0',
  checksRun: 63,
  checkErrors: [],
  scores: SCORES,
  contextMeta: { finalUrl: 'https://example.com/', framework: 'nextjs', platform: 'vercel' },
  ...overrides,
})

const open = (overrides: Partial<PublicFinding> = {}): PublicFinding => ({
  locked: false,
  checkId: 'security.headers.csp',
  category: 'security',
  severity: 'high',
  title: 'Missing Content-Security-Policy',
  description: 'No CSP header is set.',
  evidence: { header: null },
  remediation: 'Add a Content-Security-Policy header.',
  fixPrompt: 'Add a CSP.',
  ...overrides,
} as PublicFinding)

const locked: PublicFinding = {
  locked: true,
  checkId: 'security.tls.hsts',
  category: 'security',
  severity: 'medium',
  title: 'Missing Strict-Transport-Security',
}

const input = (findings: PublicFinding[], overrides: Partial<ReportInput> = {}): ReportInput => ({
  scan: scan(),
  findings,
  lockedCount: findings.filter((f) => f.locked).length,
  ...overrides,
})

describe('filename', () => {
  it('is sortable and names the host', () => {
    expect(filename(scan(), 'csv')).toBe('darvin-example.com-2026-08-27.csv')
  })

  it('cannot escape the downloads folder', () => {
    // It lands in a Content-Disposition header and in a filesystem. A host
    // with a slash or a quote in it must not reach either intact.
    const nasty = filename(scan({ url: 'https://a/../../etc/passwd' }), 'pdf')
    expect(nasty).not.toContain('/')
    expect(nasty).not.toContain('"')
  })
})

describe('buildCsv', () => {
  it('writes a stable header row and one row per finding', () => {
    const rows = buildCsv(input([open(), locked])).trim().split('\r\n')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toBe('"checkId","category","severity","title","description","remediation","evidence","locked"')
  })

  it('neutralises a cell a spreadsheet would run as a formula', () => {
    // The classic: a finding title lifted from the site that starts with an
    // equals sign. Excel and Sheets execute it on open.
    const csv = buildCsv(input([open({ title: '=HYPERLINK("http://evil.test","click")' })]))
    expect(csv).toContain(`"'=HYPERLINK`)
    expect(csv).not.toContain('"=HYPERLINK')
  })

  it('neutralises every dangerous leading character, not just =', () => {
    for (const prefix of ['=', '+', '-', '@']) {
      const csv = buildCsv(input([open({ title: `${prefix}cmd|' /c calc'!A1` })]))
      expect(csv).toContain(`"'${prefix}cmd`)
    }
  })

  it('quotes every field so a comma cannot shift the columns', () => {
    // Unquoted, this silently moves every later column — and a spreadsheet
    // shows the wrong data under the right heading rather than complaining.
    const csv = buildCsv(input([open({ remediation: 'Add a header, then test it, then ship.' })]))
    const row = csv.trim().split('\r\n')[1]!
    expect(row.split('","')).toHaveLength(8)
  })

  it('doubles embedded quotes rather than breaking the row', () => {
    const csv = buildCsv(input([open({ title: 'He said "no"' })]))
    expect(csv).toContain('"He said ""no"""')
  })

  it('writes a locked finding as locked, with its detail blank', () => {
    const row = buildCsv(input([locked])).trim().split('\r\n')[1]!
    expect(row).toContain('"true"')
    expect(row).toContain('Missing Strict-Transport-Security')
    // Its identity is public; its contents are not.
    expect(row).not.toContain('Add a')
  })

  it('survives a scan with no findings', () => {
    expect(buildCsv(input([])).trim().split('\r\n')).toHaveLength(1)
  })
})

describe('buildMarkdown', () => {
  it('leads with the facts that make a reading comparable', () => {
    const md = buildMarkdown(input([open()]))
    // Engine version and depth decide whether two reports can be compared at
    // all; a file without them is a number with no ruler.
    expect(md).toContain('**Engine** 1.8.0 · 63 checks')
    expect(md).toContain('**Depth** fast')
    expect(md).toContain('2026-08-27 09:30 UTC')
  })

  it('warns when the scan never finished', () => {
    const md = buildMarkdown(input([open()], { scan: scan({ status: 'running' }) }))
    expect(md).toContain('the results below are incomplete')
  })

  it('caveats a partly-measured pillar', () => {
    const degraded: ScanScores = { ...SCORES, degraded: ['performance'] }
    const md = buildMarkdown(input([open()], { scan: scan({ scores: degraded }) }))
    // Without this a reader treats a gap as a pass.
    expect(md).toContain('Only partly measured')
    expect(md).toContain('performance')
  })

  it('says a locked finding is withheld instead of dropping it', () => {
    const md = buildMarkdown(input([locked]))
    expect(md).toContain('Missing Strict-Transport-Security')
    expect(md).toContain('Not opened on this plan')
  })

  it('marks failed checks as ours, not the site’s', () => {
    const errors = [{ checkId: 'security.tls', message: 'handshake timeout' }]
    const md = buildMarkdown(input([open()], { scan: scan({ checkErrors: errors }) }))
    expect(md).toContain('Darvin-side failures, not issues with the site')
    expect(md).toContain('security.tls')
  })
})

describe('buildHtml', () => {
  it('escapes a script tag smuggled through a finding title', () => {
    // This document is rendered in a browser to make the PDF. An unescaped
    // interpolation here is script execution inside the renderer.
    const html = buildHtml(input([open({ title: '<script>fetch("http://evil.test")</script>' })]))
    expect(html).not.toContain('<script>fetch')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes evidence, which is raw site output by definition', () => {
    const html = buildHtml(input([open({ evidence: { header: '"><img src=x onerror=alert(1)>' } })]))
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img')
  })

  it('escapes the URL, which the caller chose', () => {
    const html = buildHtml(input([open()], { scan: scan({ url: 'https://a.test/"><script>x</script>' }) }))
    expect(html).not.toContain('<script>x</script>')
  })

  it('is self-contained, because the renderer blocks every request', () => {
    const html = buildHtml(input([open()]))
    // A linked stylesheet or web font would simply never arrive, and the PDF
    // would silently print in a fallback face.
    expect(html).not.toMatch(/<link[^>]+href/i)
    expect(html).not.toMatch(/<script[^>]+src/i)
    expect(html).toContain('<style>')
  })

  it('sets the paper size and keeps a finding on one page', () => {
    const html = buildHtml(input([open()]))
    expect(html).toContain('@page')
    // A title on one page and its fix on the next is the commonest way a
    // printed report becomes unreadable.
    expect(html).toContain('break-inside: avoid')
  })

  it('renders a locked finding as withheld, with no remediation block', () => {
    const html = buildHtml(input([open({ remediation: 'SECRET-REMEDIATION' }), locked]))

    expect(html).toContain('Not opened on this plan')
    // The open one keeps its fix; the locked one has no fix block at all.
    expect(html.match(/<strong>Fix\.<\/strong>/g)).toHaveLength(1)
    expect(html).toContain('SECRET-REMEDIATION')
  })
})
