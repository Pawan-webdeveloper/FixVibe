/**
 * Darvin CLI — Phase 0 surface of the scan engine.
 *
 *   pnpm scan <url> [--json]
 *
 * Deliberately thin: URL in → buildContext → runChecks → computeScores → print.
 * All scanning logic lives in @darvin/checks; if something here grows beyond
 * argument parsing and formatting, it belongs in the engine instead.
 */

import {
  allChecks,
  buildContext,
  computeScores,
  ENGINE_VERSION,
  runChecks,
  SafeFetchError,
  SsrfError,
  type Category,
  type CheckContext,
  type Severity,
} from '@darvin/checks'

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

const args = process.argv.slice(2)
const json = args.includes('--json')
const positional = args.filter((a) => !a.startsWith('--'))
const unknownFlags = args.filter((a) => a.startsWith('--') && a !== '--json')

if (unknownFlags.length > 0) fail(`Unknown flag: ${unknownFlags[0]}\nUsage: pnpm scan <url> [--json]`)
if (positional.length !== 1) fail('Usage: pnpm scan <url> [--json]')

// Accept bare domains the way people type them; buildContext enforces http(s).
const input = positional[0]!.trim()
const target = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`

// ---------------------------------------------------------------------------
// Output helpers (zero-dependency ANSI; silent when piped or NO_COLOR is set)
// ---------------------------------------------------------------------------

const useColor = process.stdout.isTTY === true && process.env.NO_COLOR === undefined
const style = (code: string) => (text: string) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text)
const bold = style('1')
const dim = style('2')
const red = style('31')
const green = style('32')
const yellow = style('33')
const cyan = style('36')

const SEVERITY_BADGE: Record<Severity, string> = {
  critical: bold(red('CRITICAL')),
  high: red('HIGH    '),
  medium: yellow('MEDIUM  '),
  low: cyan('LOW     '),
  info: dim('INFO    '),
}

const paintScore = (score: number) => (score >= 90 ? green : score >= 70 ? yellow : red)(String(score).padStart(3))

/** Wrap prose at `width`, indenting continuation lines — keeps the report scannable. */
function wrap(text: string, indent: string, width = 88): string {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) lines.push(line)
  return lines.map((l) => indent + l).join('\n')
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

const startedAt = performance.now()

let ctx: CheckContext
try {
  ctx = await buildContext(target)
} catch (error) {
  if (error instanceof SsrfError || error instanceof SafeFetchError) fail(`Scan failed: ${error.message}`)
  if (error instanceof TypeError) fail(`Invalid URL: ${input}`)
  throw error
}

const fetchedMs = Math.round(performance.now() - startedAt)
const { findings, errors } = await runChecks(ctx)
const scores = computeScores(findings, allChecks, errors)
const totalMs = Math.round(performance.now() - startedAt)

if (json) {
  // Machine surface: everything the human report shows, plus raw evidence.
  console.log(
    JSON.stringify(
      {
        url: target,
        finalUrl: ctx.finalUrl.href,
        status: ctx.status,
        redirectChain: ctx.redirectChain,
        durationMs: totalMs,
        engineVersion: ENGINE_VERSION,
        checksRun: allChecks.length,
        scores,
        findings,
        checkErrors: errors,
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Human report
// ---------------------------------------------------------------------------

console.log('')
console.log(`${bold('Darvin')} — ${ctx.finalUrl.href}`)
const redirectNote = ctx.redirectChain.length > 0 ? `, ${ctx.redirectChain.length} redirect(s)` : ''
console.log(
  dim(
    `  HTTP ${ctx.status}${redirectNote} · fetched in ${fetchedMs}ms · ` +
      `${allChecks.length} checks in ${totalMs - fetchedMs}ms · engine ${ENGINE_VERSION}`,
  ),
)
console.log('')

// Scores — only pillars that actually have checks; the rest would be noise.
const covered = new Set<Category>(allChecks.map((c) => c.category))
const degraded = new Set<Category>(scores.degraded)
for (const category of covered) {
  // A degraded pillar is marked at the number itself. Printing it bare would
  // present a partial measurement as a measured one, which is the whole reason
  // scoring tracks this.
  const note = degraded.has(category) ? yellow('  provisional — a check did not complete') : ''
  console.log(`  ${category.padEnd(15)} ${paintScore(scores[category])} / 100${note}`)
}
console.log(`  ${bold('overall'.padEnd(15))} ${paintScore(scores.overall)} / 100`)
console.log('')

if (findings.length === 0) {
  console.log(green('  No findings — every check passed.'))
} else {
  for (const finding of findings) {
    console.log(`  ${SEVERITY_BADGE[finding.severity]} ${bold(finding.title)} ${dim(finding.checkId)}`)
    console.log(dim(wrap(finding.remediation, '           ')))
    console.log('')
  }
  const counts = findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1
    return acc
  }, {})
  const summary = Object.entries(counts)
    .map(([severity, count]) => `${count} ${severity}`)
    .join(' · ')
  console.log(dim(`  ${findings.length} finding(s): ${summary}`))
}

// Engine problems are OUR bugs — always surface them, never hide behind a clean score.
for (const failure of errors) {
  console.log(yellow(`  ⚠ check ${failure.checkId} failed: ${failure.message}`))
}

console.log('')
