/**
 * The tools, against a stub client.
 *
 * Two things are worth pinning here and neither needs a network.
 *
 * ARGUMENTS come from a model, which is the least trustworthy input in the
 * system — not malicious, but confidently wrong. Every rejection below is a
 * mistake a model actually makes: a URL where a scanId belongs, a severity
 * that does not exist, a profile invented on the spot.
 *
 * OUTPUT is read by a model that has to decide what to do next, so the
 * distinctions the text draws are load-bearing. "No findings matched your
 * filter" and "the site is clean" are opposite conclusions; a locked finding
 * and a finding with no detail are different facts; a check that could not run
 * is our failure, not the site's passing.
 */

import { describe, expect, it } from 'vitest'
import type { ApiResult, DarvinClient, ScanReport } from '../src/client.ts'
import { configFromEnv } from '../src/client.ts'
import { BadArgument, isFailure, type ToolOutput } from '../src/tools/types.ts'
import { runScan } from '../src/tools/run-scan.ts'
import { getScan } from '../src/tools/get-scan.ts'
import { listFindings } from '../src/tools/list-findings.ts'
import { listProjects } from '../src/tools/list-projects.ts'
import { getFixPrompt } from '../src/tools/get-fix-prompt.ts'

const SCAN_ID = '11111111-2222-4333-8444-555555555555'

/** The text either shape carries. Tests that care about which one assert on isFailure. */
const read = (output: ToolOutput): string => (isFailure(output) ? output.text : output)

function report(overrides: Partial<ScanReport['scan']> = {}, findings: ScanReport['findings'] = []): ScanReport {
  return {
    scan: {
      id: SCAN_ID,
      url: 'https://example.test/',
      profile: 'fast',
      status: 'done',
      projectId: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      startedAt: '2026-08-01T00:00:01.000Z',
      finishedAt: '2026-08-01T00:00:03.000Z',
      durationMs: 2000,
      engineVersion: '1.8.0',
      checksRun: 63,
      checkErrors: [],
      error: null,
      ...overrides,
    },
    scores: { overall: 87, security: 39, seo: 85, degraded: [] },
    context: null,
    findings,
    locked: { count: 0, severities: [] },
    fixPromptAvailable: true,
  }
}

function stub(overrides: Partial<DarvinClient> = {}): DarvinClient {
  const notCalled = () => {
    throw new Error('unexpected client call')
  }
  return {
    startScan: notCalled,
    getScan: notCalled,
    getFixPrompt: notCalled,
    listProjects: notCalled,
    ...overrides,
  } as DarvinClient
}

const finding = (severity: string, category: string, checkId: string) => ({
  checkId,
  category,
  severity,
  title: `${checkId} title`,
  locked: false,
  description: 'what it is',
  remediation: 'how to fix it',
  evidence: null,
})

describe('configFromEnv', () => {
  it('needs a key and nothing else', () => {
    expect(configFromEnv({})).toBeNull()
    expect(configFromEnv({ DARVIN_API_KEY: '   ' })).toBeNull()
    expect(configFromEnv({ DARVIN_API_KEY: 'dv_x' })?.baseUrl).toBe('https://darvin.dev')
  })

  it('strips trailing slashes from the base url', () => {
    // `${base}/api/v1/...` with a doubled slash is a redirect on some hosts
    // and a 404 on others, and neither failure names its cause.
    const config = configFromEnv({ DARVIN_API_KEY: 'dv_x', DARVIN_API_URL: 'http://localhost:3000///' })
    expect(config?.baseUrl).toBe('http://localhost:3000')
  })
})

describe('argument validation', () => {
  const ctx = { client: stub() }

  it('rejects a scanId that is not a UUID', async () => {
    // Checked before the request, so a mistyped id costs no round trip and
    // the model is told what was wrong instead of getting a bare 404.
    for (const bad of ['', 'https://example.com', 'scan-1', SCAN_ID.slice(0, -1)]) {
      await expect(getScan.run({ scanId: bad }, ctx)).rejects.toBeInstanceOf(BadArgument)
    }
  })

  it('rejects an invented profile rather than coercing it', async () => {
    // Silently downgrading "ultra" to "fast" returns a report missing the
    // checks that were asked for, with nothing to say it happened.
    await expect(runScan.run({ url: 'https://example.test', profile: 'ultra' }, ctx)).rejects.toBeInstanceOf(BadArgument)
  })

  it('rejects a projectId that is not a UUID', async () => {
    await expect(runScan.run({ url: 'https://example.test', projectId: 'example' }, ctx)).rejects.toBeInstanceOf(BadArgument)
  })

  it('requires a url', async () => {
    await expect(runScan.run({}, ctx)).rejects.toBeInstanceOf(BadArgument)
    await expect(runScan.run({ url: '   ' }, ctx)).rejects.toBeInstanceOf(BadArgument)
  })

  it('rejects an invented severity', async () => {
    await expect(listFindings.run({ scanId: SCAN_ID, minSeverity: 'catastrophic' }, ctx)).rejects.toBeInstanceOf(BadArgument)
  })

  it('clamps an out-of-range limit instead of refusing it', async () => {
    // A number outside the range is a guess, not an error — and refusing it
    // costs a round trip to teach the model something the clamp already did.
    const findings = Array.from({ length: 40 }, (_, i) => finding('low', 'seo', `seo.check-${i}`))
    const client = stub({ getScan: async () => ({ ok: true, ...report({}, findings) }) as ApiResult<ScanReport> })

    const text = read(await listFindings.run({ scanId: SCAN_ID, limit: 9999 }, { client }))
    expect(text).toContain('showing 40')
  })
})

describe('failures reach the model as readable text', () => {
  it('carries the API error code and message, flagged as a failure', async () => {
    const client = stub({
      getScan: async () => ({ ok: false, code: 'quota_exceeded', status: 429, message: 'You have used all 500 scans.' }),
    })

    const output = await getScan.run({ scanId: SCAN_ID }, { client })

    // The flag matters as much as the text: without it the host renders a 429
    // as a successful call whose text happens to mention a failure, and a
    // model is markedly less likely to act on it.
    expect(isFailure(output)).toBe(true)
    // The code is what lets a model tell "out of scans this month" apart from
    // "slow down for an hour" without matching on prose.
    expect(read(output)).toContain('quota_exceeded')
    expect(read(output)).toContain('You have used all 500 scans.')
  })

  it('flags a mid-poll read failure while keeping the scan id', async () => {
    const client = stub({
      startScan: async () => ({ ok: true, scan: { id: SCAN_ID, url: 'https://a.test/', profile: 'deep', status: 'queued' } }),
      getScan: async () => ({ ok: false, code: 'server_error', status: 500, message: 'boom' }),
    })

    const output = await runScan.run({ url: 'https://a.test', profile: 'deep', waitSeconds: 1 }, { client })
    expect(isFailure(output)).toBe(true)
  })

  it('does not flag a scan that simply has not finished', async () => {
    // "Still queued" is a result, not a failure. Flagging it would tell the
    // model its call went wrong when the correct next step is to poll.
    const client = stub({
      startScan: async () => ({ ok: true, scan: { id: SCAN_ID, url: 'https://a.test/', profile: 'deep', status: 'queued' } }),
      getScan: async () => ({ ok: true, ...report({ status: 'queued' }) }),
    })

    const output = await runScan.run({ url: 'https://a.test', profile: 'deep', waitSeconds: 0 }, { client })
    expect(isFailure(output)).toBe(false)
  })
})

describe('get_scan output', () => {
  it('reports a failed scan as a result, not as an error to retry', async () => {
    const client = stub({
      getScan: async () => ({ ok: true, ...report({ status: 'failed', error: 'Could not resolve hostname' }) }),
    })

    const text = read(await getScan.run({ scanId: SCAN_ID }, { client }))
    expect(text).toContain('failed: Could not resolve hostname')
    expect(text).not.toContain('overall')
  })

  it('tells the caller to poll a scan that has not finished', async () => {
    const client = stub({ getScan: async () => ({ ok: true, ...report({ status: 'running' }) }) })

    const text = read(await getScan.run({ scanId: SCAN_ID }, { client }))
    expect(text).toContain('Not finished yet')
    expect(text).toContain(SCAN_ID)
  })

  it('flags a partly-measured pillar so a gap is not read as a pass', async () => {
    const base = report({}, [finding('high', 'security', 'security.headers.csp')])
    const client = stub({
      getScan: async () => ({ ok: true, ...base, scores: { ...base.scores, degraded: ['performance'] } }),
    })

    const text = read(await getScan.run({ scanId: SCAN_ID }, { client }))
    expect(text).toContain('partly measured')
    expect(text).toContain('performance')
  })

  it('names checks that could not run as our failure, not the site’s', async () => {
    const client = stub({
      getScan: async () => ({
        ok: true,
        ...report({ checkErrors: [{ checkId: 'security.tls', message: 'handshake timeout' }] }),
      }),
    })

    const text = read(await getScan.run({ scanId: SCAN_ID }, { client }))
    expect(text).toContain('not a site issue')
    expect(text).toContain('security.tls')
  })
})

describe('list_findings', () => {
  const findings = [
    finding('critical', 'security', 'security.a'),
    finding('high', 'security', 'security.b'),
    finding('medium', 'seo', 'seo.c'),
    finding('low', 'seo', 'seo.d'),
    finding('info', 'aeo', 'aeo.e'),
  ]
  const client = stub({ getScan: async () => ({ ok: true, ...report({}, findings) }) })

  it('treats minSeverity as a floor, not an exact match', async () => {
    // "high" must mean high AND critical. An exact match would hide the worst
    // finding in the report from the query most likely to be asked.
    const text = read(await listFindings.run({ scanId: SCAN_ID, minSeverity: 'high' }, { client }))
    expect(text).toContain('security.a')
    expect(text).toContain('security.b')
    expect(text).not.toContain('seo.c')
  })

  it('filters by pillar', async () => {
    const text = read(await listFindings.run({ scanId: SCAN_ID, category: 'seo' }, { client }))
    expect(text).toContain('seo.c')
    expect(text).not.toContain('security.a')
  })

  it('distinguishes "nothing matched" from "the site is clean"', async () => {
    // Opposite conclusions. A model told "no findings" about a filtered query
    // will report a clean site that has four open issues.
    const text = read(await listFindings.run({ scanId: SCAN_ID, category: 'compliance' }, { client }))
    expect(text).toContain('No findings match')
    expect(text).toContain('5 findings in total')
  })

  it('says a locked finding is withheld rather than empty', async () => {
    const locked = [{ checkId: 'security.a', category: 'security', severity: 'high', title: 'Locked', locked: true }]
    const gated = stub({ getScan: async () => ({ ok: true, ...report({}, locked) }) })

    const text = read(await listFindings.run({ scanId: SCAN_ID }, { client: gated }))
    expect(text).toContain('not opened on this plan')
  })
})

describe('list_projects', () => {
  it('states verification, because it decides what a scan can measure', async () => {
    const client = stub({
      listProjects: async () => ({
        ok: true,
        projects: [
          { id: 'p1', name: 'a', url: 'https://a.test/', slug: 'a', verifiedDomain: true, latestScan: null, overallDelta: null },
          { id: 'p2', name: 'b', url: 'https://b.test/', slug: 'b', verifiedDomain: false, latestScan: null, overallDelta: null },
        ],
      }),
    })

    const text = read(await listProjects.run({}, { client }))
    expect(text).toContain('domain verified')
    expect(text).toContain('the two backend checks will be skipped')
  })

  it('omits a delta that was never comparable instead of printing 0', async () => {
    // null means the engine version or scan depth changed — the ruler moved,
    // not the site. "+0" would claim a comparison that was never made.
    const client = stub({
      listProjects: async () => ({
        ok: true,
        projects: [
          {
            id: 'p1', name: 'a', url: 'https://a.test/', slug: 'a', verifiedDomain: false,
            latestScan: { id: SCAN_ID, status: 'done', profile: 'fast', overall: 90, createdAt: '2026-08-01T00:00:00.000Z' },
            overallDelta: null,
          },
        ],
      }),
    })

    const text = read(await listProjects.run({}, { client }))
    expect(text).toContain('overall 90/100')
    expect(text).not.toContain('since the previous scan')
  })

  it('says an empty account can still scan', async () => {
    const client = stub({ listProjects: async () => ({ ok: true, projects: [] }) })
    expect(await listProjects.run({}, { client })).toContain('run_scan works without one')
  })
})

describe('get_fix_prompt', () => {
  it('returns the work order verbatim', async () => {
    const prompt = '## 1. Response headers\n\nAdd a CSP.'
    const client = stub({ getFixPrompt: async () => ({ ok: true, prompt, issueCount: 1, url: 'https://a.test/' }) })

    const text = read(await getFixPrompt.run({ scanId: SCAN_ID }, { client }))
    // Never summarised: an agent handed half a work order makes half the
    // changes and reports success.
    expect(text).toContain(prompt)
    expect(text).toContain('1 issue.')
  })

  it('explains an empty prompt rather than returning a blank block', async () => {
    const client = stub({ getFixPrompt: async () => ({ ok: true, prompt: '', issueCount: 0, url: 'https://a.test/' }) })

    const text = read(await getFixPrompt.run({ scanId: SCAN_ID }, { client }))
    expect(text).toContain('nothing actionable')
  })
})

describe('run_scan', () => {
  it('returns the report without polling when a fast scan is already done', async () => {
    let polls = 0
    const client = stub({
      startScan: async () => ({ ok: true, scan: { id: SCAN_ID, url: 'https://a.test/', profile: 'fast', status: 'done' } }),
      getScan: async () => {
        polls++
        return { ok: true, ...report() }
      },
    })

    const text = read(await runScan.run({ url: 'https://a.test' }, { client }))
    expect(text).toContain('overall 87/100')
    expect(polls).toBe(1) // the final read, not a poll loop
  })

  it('hands back the id instead of hanging when the wait runs out', async () => {
    /*
     * A tool call that never returns is worse than one that says "not yet":
     * the host times it out, the model learns nothing, and the scan it started
     * is still running with nobody holding its id.
     */
    const client = stub({
      startScan: async () => ({ ok: true, scan: { id: SCAN_ID, url: 'https://a.test/', profile: 'deep', status: 'queued' } }),
      getScan: async () => ({ ok: true, ...report({ status: 'queued' }) }),
    })

    const text = read(await runScan.run({ url: 'https://a.test', profile: 'deep', waitSeconds: 0 }, { client }))
    expect(text).toContain('still queued')
    expect(text).toContain(SCAN_ID)
  })

  it('keeps the scan id when a poll fails mid-flight', async () => {
    // The id has no other copy. Losing it to a transient read error strands a
    // scan that is still running and still being paid for.
    const client = stub({
      startScan: async () => ({ ok: true, scan: { id: SCAN_ID, url: 'https://a.test/', profile: 'deep', status: 'queued' } }),
      getScan: async () => ({ ok: false, code: 'server_error', status: 500, message: 'boom' }),
    })

    const text = read(await runScan.run({ url: 'https://a.test', profile: 'deep', waitSeconds: 1 }, { client }))
    expect(text).toContain(SCAN_ID)
    expect(text).toContain('server_error')
  })
})
