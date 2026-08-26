/**
 * A scan, as a file.
 *
 * Three formats, three audiences, and the split is not cosmetic:
 *
 *   csv — a spreadsheet. One row per finding, flat, no nesting. This is what
 *         gets pasted into a tracker or pivoted by severity, so every column
 *         is a scalar and the header row never moves.
 *   md  — a pull request description, a ticket, a paste into a chat. Readable
 *         as plain text with no renderer.
 *   html — the print document, and the only input the PDF path takes.
 *
 * All three are PURE. They take a scan and return a string, touch no database
 * and no network, and are therefore the one part of the export path that can
 * be tested exhaustively. The route and the queue job both call these; neither
 * formats anything itself.
 *
 * Redaction happens BEFORE this, in the route. Nothing here decides what a
 * reader may see — it renders what it is handed, which is why it takes
 * PublicFinding and can be given a locked one without leaking it.
 */

import 'server-only'
import type { ScanScores } from '@darvin/checks'
import type { PublicFinding } from '../redact.ts'

export interface ReportScan {
  id: string
  url: string
  profile: string
  status: string
  createdAt: Date
  finishedAt: Date | null
  durationMs: number | null
  engineVersion: string
  checksRun: number
  checkErrors: ReadonlyArray<{ checkId: string; message: string }>
  scores: ScanScores | null
  contextMeta: { finalUrl?: string; framework?: string | null; platform?: string | null } | null
}

export interface ReportInput {
  scan: ReportScan
  findings: readonly PublicFinding[]
  /** Withheld on this plan. Named so a file is never silently short. */
  lockedCount: number
}

const PILLARS = ['security', 'seo', 'aeo', 'performance', 'accessibility', 'compliance'] as const

/** UTC, like every other timestamp the product shows. */
function stamp(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 16)
}

function host(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/** `darvin-example.com-2026-08-27.csv` — sortable, and obvious in a downloads folder. */
export function filename(scan: ReportScan, extension: string): string {
  const safeHost = host(scan.url).replace(/[^a-z0-9.-]/gi, '-')
  return `darvin-${safeHost}-${scan.createdAt.toISOString().slice(0, 10)}.${extension}`
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * RFC 4180 quoting, and it matters more than it looks.
 *
 * Every field is quoted unconditionally rather than only when it contains a
 * comma. A remediation sentence with a comma in it, unquoted, silently shifts
 * every column after it — and a spreadsheet does not complain, it just shows
 * the wrong data under the right heading.
 */
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  // A leading =, +, - or @ makes Excel and Sheets treat the cell as a formula.
  // The values here are attacker-influenced — they quote the scanned site's own
  // headers and HTML — so a cell starting with one is prefixed with a quote.
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return `"${guarded.replace(/"/g, '""')}"`
}

const CSV_COLUMNS = [
  'checkId',
  'category',
  'severity',
  'title',
  'description',
  'remediation',
  'evidence',
  'locked',
] as const

export function buildCsv(input: ReportInput): string {
  const rows = [CSV_COLUMNS.map(csvCell).join(',')]

  for (const finding of input.findings) {
    rows.push(
      [
        csvCell(finding.checkId),
        csvCell(finding.category),
        csvCell(finding.severity),
        csvCell(finding.title),
        csvCell(finding.locked ? '' : finding.description),
        csvCell(finding.locked ? '' : finding.remediation),
        csvCell(finding.locked || !finding.evidence ? '' : JSON.stringify(finding.evidence)),
        csvCell(finding.locked ? 'true' : 'false'),
      ].join(','),
    )
  }

  // CRLF, because that is what RFC 4180 specifies and what Excel on Windows
  // expects; every other reader accepts it.
  return `${rows.join('\r\n')}\r\n`
}

/* -------------------------------------------------------------------------- */
/* Markdown                                                                   */
/* -------------------------------------------------------------------------- */

export function buildMarkdown(input: ReportInput): string {
  const { scan, findings } = input
  const out: string[] = []

  out.push(`# Darvin report — ${host(scan.url)}`)
  out.push('')
  out.push(`- **URL** ${scan.url}`)
  out.push(`- **Scanned** ${stamp(scan.createdAt)} UTC`)
  out.push(`- **Depth** ${scan.profile}`)
  out.push(`- **Engine** ${scan.engineVersion} · ${scan.checksRun} checks`)
  if (scan.contextMeta?.framework) out.push(`- **Framework** ${scan.contextMeta.framework}`)
  if (scan.contextMeta?.platform) out.push(`- **Served by** ${scan.contextMeta.platform}`)

  if (scan.status !== 'done') {
    out.push('')
    out.push(`> This scan is **${scan.status}** — the results below are incomplete.`)
  }

  if (scan.scores) {
    out.push('')
    out.push('## Scores')
    out.push('')
    out.push('| Pillar | Score |')
    out.push('| --- | ---: |')
    out.push(`| **Overall** | **${scan.scores.overall}** |`)
    for (const pillar of PILLARS) {
      if (scan.scores[pillar] !== undefined) out.push(`| ${pillar} | ${scan.scores[pillar]} |`)
    }

    const degraded = scan.scores.degraded
    if (degraded.length > 0) {
      out.push('')
      // A partly-measured pillar reported without its caveat invites a reader
      // to treat a gap as a pass.
      out.push(`> Only partly measured, treat as incomplete: ${degraded.join(', ')}.`)
    }
  }

  out.push('')
  out.push(`## Findings (${findings.length})`)

  if (findings.length === 0) {
    out.push('')
    out.push('No findings.')
  }

  for (const finding of findings) {
    out.push('')
    out.push(`### ${finding.title}`)
    out.push('')
    out.push(`\`${finding.checkId}\` · **${finding.severity}** · ${finding.category}`)
    if (finding.locked) {
      out.push('')
      out.push('_Not opened on this plan._')
      continue
    }
    out.push('')
    out.push(finding.description)
    out.push('')
    out.push(`**Fix.** ${finding.remediation}`)
    if (finding.evidence && Object.keys(finding.evidence).length > 0) {
      out.push('')
      out.push('```json')
      out.push(JSON.stringify(finding.evidence, null, 2))
      out.push('```')
    }
  }

  if (input.lockedCount > 0) {
    out.push('')
    out.push(`_${input.lockedCount} findings are listed but not opened on this plan._`)
  }

  if (scan.checkErrors.length > 0) {
    out.push('')
    out.push(`## Checks that could not run (${scan.checkErrors.length})`)
    out.push('')
    // Ours, not the site's. A reader who does not know that reads a gap as a pass.
    out.push('These are Darvin-side failures, not issues with the site.')
    out.push('')
    for (const error of scan.checkErrors) out.push(`- \`${error.checkId}\` — ${error.message}`)
  }

  out.push('')
  out.push('---')
  out.push('')
  out.push(`Generated by Darvin · scan \`${scan.id}\``)

  return `${out.join('\n')}\n`
}

/* -------------------------------------------------------------------------- */
/* HTML (the print document)                                                  */
/* -------------------------------------------------------------------------- */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/**
 * Every interpolation below goes through this, without exception.
 *
 * The strings here are a scanned site's own headers, titles and HTML
 * fragments, quoted back as evidence — the single most attacker-influenced
 * data in the product. This document is then rendered in a browser, so an
 * unescaped one is script execution inside the PDF renderer.
 */
function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char)
}

/**
 * Self-contained by requirement, not by preference: the renderer blocks every
 * outbound request, so a linked stylesheet or a web font would simply not
 * arrive. Everything is inline, and the fallback stack is a real one.
 */
export function buildHtml(input: ReportInput): string {
  const { scan, findings } = input
  const scores = scan.scores

  const pillarRows = scores
    ? PILLARS.filter((p) => scores[p] !== undefined)
        .map((p) => `<tr><td>${esc(p)}</td><td class="num">${esc(scores[p])}</td></tr>`)
        .join('')
    : ''

  const degradedNote =
    scores && scores.degraded.length > 0
      ? `<p class="note">Only partly measured, treat as incomplete: ${esc(scores.degraded.join(', '))}.</p>`
      : ''

  const findingBlocks = findings
    .map((finding) => {
      const head =
        `<h3>${esc(finding.title)}</h3>` +
        `<p class="meta"><code>${esc(finding.checkId)}</code> · ` +
        `<span class="sev sev-${esc(finding.severity)}">${esc(finding.severity)}</span> · ${esc(finding.category)}</p>`

      if (finding.locked) return `<section class="finding">${head}<p class="note">Not opened on this plan.</p></section>`

      const evidence =
        finding.evidence && Object.keys(finding.evidence).length > 0
          ? `<pre>${esc(JSON.stringify(finding.evidence, null, 2))}</pre>`
          : ''

      return (
        `<section class="finding">${head}` +
        `<p>${esc(finding.description)}</p>` +
        `<p class="fix"><strong>Fix.</strong> ${esc(finding.remediation)}</p>${evidence}</section>`
      )
    })
    .join('')

  const errorList =
    scan.checkErrors.length > 0
      ? `<h2>Checks that could not run (${scan.checkErrors.length})</h2>` +
        '<p class="note">These are Darvin-side failures, not issues with the site.</p><ul>' +
        scan.checkErrors.map((e) => `<li><code>${esc(e.checkId)}</code> — ${esc(e.message)}</li>`).join('') +
        '</ul>'
      : ''

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Darvin report — ${esc(host(scan.url))}</title>
<style>
  /* @page is the only place a PDF's paper size and margins can be set from CSS. */
  @page { size: A4; margin: 14mm 12mm 16mm; }
  * { box-sizing: border-box; }
  body { font: 11pt/1.55 ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
         color: #0b0d10; margin: 0; }
  h1 { font-size: 20pt; margin: 0 0 4pt; letter-spacing: -0.02em; }
  h2 { font-size: 13pt; margin: 22pt 0 8pt; border-bottom: 1px solid #d8dce1; padding-bottom: 4pt; }
  h3 { font-size: 11pt; margin: 0 0 3pt; }
  p { margin: 0 0 6pt; }
  code { font-size: 9.5pt; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 2pt 12pt; margin: 10pt 0 0; font-size: 9.5pt; }
  dt { color: #5a626b; }
  dd { margin: 0; }
  table { border-collapse: collapse; width: 100%; font-size: 10pt; }
  td { border-bottom: 1px solid #e6e9ed; padding: 4pt 0; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .overall td { font-weight: 700; border-bottom: 2px solid #0b0d10; }
  .meta { font-size: 9pt; color: #5a626b; margin-bottom: 5pt; }
  .note { font-size: 9pt; color: #5a626b; }
  .fix { border-left: 2px solid #0b0d10; padding-left: 8pt; }
  pre { background: #f4f6f8; padding: 6pt 8pt; font-size: 8.5pt; white-space: pre-wrap;
        word-break: break-word; margin: 6pt 0 0; }
  /* A finding split across a page break is the commonest way a printed report
     becomes unreadable: a title on one page, its fix on the next. */
  .finding { break-inside: avoid; page-break-inside: avoid; padding: 8pt 0; border-bottom: 1px solid #e6e9ed; }
  .sev { text-transform: uppercase; font-weight: 700; }
  .sev-critical, .sev-high { color: #8a1010; }
  .sev-medium { color: #8a5a10; }
  .sev-low, .sev-info { color: #5a626b; }
</style></head>
<body>
  <h1>${esc(host(scan.url))}</h1>
  <p class="meta">${esc(scan.url)}</p>
  <dl>
    <dt>Scanned</dt><dd>${esc(stamp(scan.createdAt))} UTC</dd>
    <dt>Depth</dt><dd>${esc(scan.profile)}</dd>
    <dt>Engine</dt><dd>${esc(scan.engineVersion)} · ${esc(scan.checksRun)} checks</dd>
    ${scan.contextMeta?.framework ? `<dt>Framework</dt><dd>${esc(scan.contextMeta.framework)}</dd>` : ''}
    ${scan.contextMeta?.platform ? `<dt>Served by</dt><dd>${esc(scan.contextMeta.platform)}</dd>` : ''}
  </dl>
  ${scan.status !== 'done' ? `<p class="note">This scan is ${esc(scan.status)} — the results below are incomplete.</p>` : ''}
  ${scores ? `<h2>Scores</h2><table><tr class="overall"><td>Overall</td><td class="num">${esc(scores.overall)}</td></tr>${pillarRows}</table>${degradedNote}` : ''}
  <h2>Findings (${findings.length})</h2>
  ${findings.length === 0 ? '<p>No findings.</p>' : findingBlocks}
  ${input.lockedCount > 0 ? `<p class="note">${input.lockedCount} findings are listed but not opened on this plan.</p>` : ''}
  ${errorList}
  <p class="note" style="margin-top:16pt">Generated by Darvin · scan ${esc(scan.id)}</p>
</body></html>`
}
