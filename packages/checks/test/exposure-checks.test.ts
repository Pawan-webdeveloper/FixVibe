/**
 * Unit tests for the exposure and supply-chain checks.
 *
 * These make the most damaging claims in the product — "your database
 * credentials are public", "your Stripe key is in the bundle" — so most of what
 * follows is about the conditions under which they must say NOTHING. A false
 * positive here does not cost a finding; it costs the reader's belief in every
 * other one, and it arrives with an alarming headline attached.
 */

import { describe, expect, it } from 'vitest'
import type { Check, CheckContext, Finding } from '../src/types.ts'
import { directoryListingCheck } from '../src/security/exposure/directory-listing.ts'
import { sensitivePathsCheck } from '../src/security/exposure/sensitive-paths.ts'
import { sourceMapsCheck } from '../src/security/exposure/source-maps.ts'
import { findSecrets } from '../src/security/secrets/patterns.ts'
import { secretsInJsCheck } from '../src/security/secrets/secrets-in-js.ts'
import { sriCheck } from '../src/security/sri.ts'
import { makeContext, probeStub, type ContextOverrides } from './helpers.ts'

const run = async (check: Check, overrides: ContextOverrides = {}): Promise<Finding[]> =>
  check.run(makeContext(overrides))

const only = (findings: Finding[]): Finding => {
  expect(findings).toHaveLength(1)
  return findings[0]!
}

const page = (body: string): string =>
  `<!doctype html><html lang="en"><head><title>t</title></head><body>${body}</body></html>`

const APP_SHELL = '<!doctype html><html><body><div id="root"></div></body></html>'

/** A context whose scripts already carry content, as buildContext supplies them. */
const withScripts = (scripts: Array<{ url: string; content: string }>, overrides: ContextOverrides = {}) => {
  const ctx: CheckContext = makeContext(overrides)
  ctx.scripts.push(...scripts)
  return ctx
}

// ---------------------------------------------------------------------------

describe('security.exposure.sensitive-paths', () => {
  it('says nothing when every path is closed', async () => {
    const probe = probeStub({ '/.env': { status: 404 }, '/.git/HEAD': { status: 403 } })
    expect(await run(sensitivePathsCheck, { probe })).toEqual([])
  })

  it('says nothing when the probe could not reach anything', async () => {
    expect(await run(sensitivePathsCheck, { probe: probeStub({}) })).toEqual([])
  })

  it('IGNORES a 200 that is the app shell, not the file', async () => {
    // The failure that would otherwise report a leaked .env on every SPA on the
    // internet: a catch-all route answering 200 for any unknown path.
    const probe = probeStub({
      '/.env': { status: 200, body: APP_SHELL },
      '/.git/HEAD': { status: 200, body: APP_SHELL },
      '/backup.sql': { status: 200, body: APP_SHELL },
    })
    expect(await run(sensitivePathsCheck, { probe })).toEqual([])
  })

  it('flags a real .env as critical', async () => {
    const probe = probeStub({
      '/.env': { status: 200, body: 'DATABASE_URL=postgres://u:p@db/x\nSTRIPE_SECRET_KEY=sk_live_abc\n' },
    })
    const finding = only(await run(sensitivePathsCheck, { probe }))
    expect(finding.severity).toBe('critical')
    expect(finding.title).toContain('.env')
  })

  it('never puts the contents of an exposed file into evidence', async () => {
    // Recording a leaked credential in our own database would turn one
    // exposure into two, and this evidence is rendered on a shareable page.
    const probe = probeStub({ '/.env': { status: 200, body: 'STRIPE_SECRET_KEY=sk_live_supersecret\n' } })
    const finding = only(await run(sensitivePathsCheck, { probe }))
    expect(JSON.stringify(finding.evidence)).not.toContain('sk_live_supersecret')
  })

  it('recognises a real .git/HEAD in both of its forms', async () => {
    const ref = probeStub({ '/.git/HEAD': { status: 200, body: 'ref: refs/heads/main\n' } })
    expect(await run(sensitivePathsCheck, { probe: ref })).toHaveLength(1)

    const detached = probeStub({ '/.git/HEAD': { status: 200, body: `${'a'.repeat(40)}\n` } })
    expect(await run(sensitivePathsCheck, { probe: detached })).toHaveLength(1)
  })

  it('collapses several exposed files into one finding at the worst severity', async () => {
    // One cause — the server hands out whatever is in the directory — and one
    // fix. Three criticals would take ninety points off for a single mistake.
    const probe = probeStub({
      '/.env': { status: 200, body: 'SECRET=1\n' },
      '/.git/config': { status: 200, body: '[core]\n\trepositoryformatversion = 0\n' },
      '/backup.sql': { status: 200, body: 'CREATE TABLE users (id int);' },
    })
    const finding = only(await run(sensitivePathsCheck, { probe }))
    expect(finding.severity).toBe('critical')
    expect((finding.evidence?.exposed as string[]).length).toBe(3)
  })

  it('does not accept prose that merely mentions SQL as a database dump', async () => {
    const probe = probeStub({ '/backup.sql': { status: 200, body: 'This page explains our SQL style guide.' } })
    expect(await run(sensitivePathsCheck, { probe })).toEqual([])
  })
})

describe('secrets/patterns', () => {
  it('finds issuer-defined key shapes', () => {
    const kinds = findSecrets(
      `const a = "AKIA${'A'.repeat(16)}"; const b = "sk_live_${'x'.repeat(24)}";` +
        ` const c = "ghp_${'y'.repeat(36)}";`,
    ).map((m) => m.kind)
    expect(kinds).toContain('AWS access key id')
    expect(kinds).toContain('Stripe secret key')
    expect(kinds).toContain('GitHub personal access token')
  })

  it('leaves PUBLISHABLE keys alone — they are meant to be in the bundle', () => {
    // Reporting a pk_live_ as a leak is confidently wrong in the most visible
    // way: the reader knows it is fine and stops trusting the report.
    const source = `pk_live_${'x'.repeat(30)} pk_test_${'y'.repeat(30)} NEXT_PUBLIC_API_URL="https://x.test"`
    expect(findSecrets(source)).toEqual([])
  })

  it('does not guess from entropy — a build hash is not a credential', () => {
    const source = 'const chunk = "index-a3f9c2e1b8d47f60.js"; const hash = "9f86d081884c7d659a2feaa0";'
    expect(findSecrets(source)).toEqual([])
  })

  it('redacts what it finds, and never returns the key itself', () => {
    const key = `sk_live_${'z'.repeat(30)}`
    const [match] = findSecrets(`const k = "${key}"`)
    expect(match?.sample).not.toContain(key)
    expect(match?.sample).toContain('…')
  })

  it('deduplicates a key that appears in several places', () => {
    const key = `AKIA${'B'.repeat(16)}`
    expect(findSecrets(`${key} ... ${key} ... ${key}`)).toHaveLength(1)
  })

  describe('Supabase JWTs', () => {
    const jwt = (payload: Record<string, unknown>) =>
      `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${'s'.repeat(43)}`

    it('flags a service-role key, which bypasses every RLS policy', () => {
      const [match] = findSecrets(`const k = "${jwt({ role: 'service_role', iss: 'supabase' })}"`)
      expect(match?.kind).toBe('Supabase service-role key')
      expect(match?.severity).toBe('critical')
    })

    it('leaves the anon key alone — it belongs in a browser', () => {
      // The two are indistinguishable to a regex and opposite in effect, so the
      // role claim is decoded rather than guessed at.
      expect(findSecrets(`const k = "${jwt({ role: 'anon', iss: 'supabase' })}"`)).toEqual([])
    })

    it('ignores a token whose payload does not decode', () => {
      expect(findSecrets(`eyJhbGciOiJIUzI1NiJ9.eyJub3QtdmFsaWQtanNvbg.${'s'.repeat(20)}`)).toEqual([])
    })
  })
})

describe('security.secrets.secrets-in-js', () => {
  it('says nothing when no script body was readable', async () => {
    expect(await run(secretsInJsCheck)).toEqual([])
  })

  it('flags a live key compiled into a bundle', async () => {
    const ctx = withScripts([{ url: 'https://site.test/app.js', content: `const k="sk_live_${'x'.repeat(24)}"` }])
    const finding = only(await secretsInJsCheck.run(ctx))
    expect(finding.severity).toBe('critical')
    expect(finding.evidence).toMatchObject({ secrets: [{ foundIn: 'https://site.test/app.js' }] })
  })

  it('scans inline scripts too', async () => {
    const ctx = withScripts([{ url: '', content: `window.KEY="AKIA${'C'.repeat(16)}"` }])
    expect((only(await secretsInJsCheck.run(ctx)).evidence?.secrets as Array<{ foundIn: string }>)[0]?.foundIn).toBe(
      'inline script',
    )
  })

  it('reports one key once even when several chunks contain it', async () => {
    const key = `ghp_${'d'.repeat(36)}`
    const ctx = withScripts([
      { url: 'https://site.test/a.js', content: `x="${key}"` },
      { url: 'https://site.test/b.js', content: `y="${key}"` },
    ])
    expect((only(await secretsInJsCheck.run(ctx)).evidence?.secrets as unknown[]).length).toBe(1)
  })

  it('never echoes the secret into evidence or prose', async () => {
    const key = `sk-ant-${'e'.repeat(30)}`
    const ctx = withScripts([{ url: 'https://site.test/a.js', content: `k="${key}"` }])
    const finding = only(await secretsInJsCheck.run(ctx))
    expect(JSON.stringify(finding)).not.toContain(key)
  })

  it('stays silent on a bundle carrying only publishable configuration', async () => {
    const ctx = withScripts([
      { url: 'https://site.test/a.js', content: `const cfg={key:"pk_live_${'x'.repeat(30)}",url:"https://x.test"}` },
    ])
    expect(await secretsInJsCheck.run(ctx)).toEqual([])
  })
})

describe('security.exposure.source-maps', () => {
  const bundle = (comment: string) => [{ url: 'https://site.test/app.js', content: `console.log(1)\n${comment}` }]
  const MAP_BODY = JSON.stringify({ version: 3, sources: ['src/index.ts'], mappings: '' })

  it('says nothing without a sourceMappingURL', async () => {
    expect(await sourceMapsCheck.run(withScripts([{ url: 'https://site.test/app.js', content: 'x=1' }]))).toEqual([])
  })

  it('does NOT report a reference whose map is not actually served', async () => {
    // A dangling reference is what a correctly configured production build
    // looks like; reporting it would flag builds that got this right.
    const ctx = withScripts(bundle('//# sourceMappingURL=app.js.map'), {
      probe: probeStub({ '/app.js.map': { status: 404 } }),
    })
    expect(await sourceMapsCheck.run(ctx)).toEqual([])
  })

  it('reports a map that is genuinely served', async () => {
    const ctx = withScripts(bundle('//# sourceMappingURL=app.js.map'), {
      probe: probeStub({ '/app.js.map': { status: 200, body: MAP_BODY } }),
    })
    expect(only(await sourceMapsCheck.run(ctx)).severity).toBe('low')
  })

  it('does not accept an app shell at the map URL', async () => {
    const ctx = withScripts(bundle('//# sourceMappingURL=app.js.map'), {
      probe: probeStub({ '/app.js.map': { status: 200, body: APP_SHELL } }),
    })
    expect(await sourceMapsCheck.run(ctx)).toEqual([])
  })

  it('reports an inlined data: map without needing to fetch anything', async () => {
    const ctx = withScripts(bundle('//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozfQ=='))
    expect(only(await sourceMapsCheck.run(ctx)).evidence).toMatchObject({ inlined: ['https://site.test/app.js'] })
  })
})

describe('security.sri', () => {
  it('says nothing when every subresource is same-origin', async () => {
    const html = page('<script src="/app.js"></script><link rel="stylesheet" href="/app.css">')
    expect(await run(sriCheck, { html })).toEqual([])
  })

  it('flags a third-party script with no integrity attribute', async () => {
    const html = page('<script src="https://cdn.other.test/lib.js"></script>')
    const finding = only(await run(sriCheck, { html }))
    expect(finding.severity).toBe('low')
    expect(finding.evidence).toMatchObject({ sample: [{ kind: 'script' }] })
  })

  it('counts HOSTS, not files — one CDN is one decision, not eighty problems', async () => {
    // stripe.com loads 79 files from its own CDN. Reporting that as 79
    // findings reads as an emergency; reporting one host reads as the
    // configuration preference it usually is.
    const scripts = Array.from({ length: 30 }, (_, i) => `<script src="https://cdn.other.test/${i}.js"></script>`)
    const finding = only(await run(sriCheck, { html: page(scripts.join('')) }))
    expect(finding.title).toContain('1 other origin')
    expect(finding.evidence).toMatchObject({ hosts: [{ host: 'cdn.other.test', files: 30 }] })
  })

  it('accepts a third-party script that carries one', async () => {
    const html = page('<script src="https://cdn.other.test/lib.js" integrity="sha384-abc"></script>')
    expect(await run(sriCheck, { html })).toEqual([])
  })

  it('covers stylesheets, including a multi-token rel', async () => {
    const html = page('<link rel="Alternate StyleSheet" href="https://cdn.other.test/a.css">')
    expect(only(await run(sriCheck, { html })).evidence).toMatchObject({ sample: [{ kind: 'stylesheet' }] })
  })

  it('ignores link elements that are not stylesheets', async () => {
    const html = page('<link rel="preconnect" href="https://cdn.other.test"><link rel="icon" href="https://cdn.other.test/f.ico">')
    expect(await run(sriCheck, { html })).toEqual([])
  })
})

describe('security.exposure.directory-listing', () => {
  const LISTING = '<html><head><title>Index of /assets/</title></head><body><h1>Index of /assets/</h1><a href="../">../</a><a href="app.js">app.js</a><a href="backup.zip">backup.zip</a></body></html>'

  it('says nothing when the asset directory serves a normal page', async () => {
    const html = page('<script src="/assets/app.js"></script>')
    const probe = probeStub({ '/assets/': { status: 200, body: '<html><body>Hello</body></html>' } })
    expect(await run(directoryListingCheck, { html, probe })).toEqual([])
  })

  it('says nothing when the directory is closed', async () => {
    const html = page('<script src="/assets/app.js"></script>')
    expect(await run(directoryListingCheck, { html, probe: probeStub({ '/assets/': { status: 403 } }) })).toEqual([])
  })

  it('flags an autoindex and samples what it exposed', async () => {
    const html = page('<script src="/assets/app.js"></script>')
    const probe = probeStub({ '/assets/': { status: 200, body: LISTING } })
    const finding = only(await run(directoryListingCheck, { html, probe }))
    expect(finding.severity).toBe('medium')
    expect(finding.evidence?.sampleEntries).toContain('backup.zip')
  })

  it('does not probe the site root', async () => {
    // Every page's root "directory" is the site itself, which is not a listing.
    const html = page('<script src="/app.js"></script>')
    expect(await run(directoryListingCheck, { html, probe: probeStub({ '/': { status: 200, body: LISTING } }) })).toEqual([])
  })

  it('ignores assets on another origin, which probe() cannot reach anyway', async () => {
    const html = page('<script src="https://cdn.other.test/assets/app.js"></script>')
    expect(await run(directoryListingCheck, { html, probe: probeStub({}) })).toEqual([])
  })
})
