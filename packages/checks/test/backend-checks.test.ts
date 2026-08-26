/**
 * Backend authorization checks — Supabase RLS and Firebase rules.
 *
 * These are the only two checks in the engine that touch infrastructure
 * belonging to the site under test, so the first thing every one of these
 * tests establishes is that they DO NOT RUN without `ctx.activeProbe`. That
 * capability is handed out only for a domain the requester proved they own.
 * If these tests ever stop failing when the gate is removed, the engine has
 * started performing unauthorised testing on strangers, which is a legal
 * problem long before it is an engineering one.
 *
 * The second theme is that neither check may put customer data in a finding.
 * Reports are stored and can be shared; a scanner that copies its customer's
 * user table into a shareable page has become the breach it was hired to find.
 */

import { describe, expect, it } from 'vitest'
import { firebaseRulesCheck } from '../src/security/backend/firebase-rules.ts'
import { supabaseRlsCheck } from '../src/security/backend/supabase-rls.ts'
import { activeProbeStub, makeContext } from './helpers.ts'

const REF = 'abcdefghijklmnopqrst'
const BASE = `https://${REF}.supabase.co/rest/v1`

/** A real-shaped anon key: the payload claims role "anon" and names the project. */
const anonKey = (() => {
  const payload = Buffer.from(JSON.stringify({ iss: 'supabase', ref: REF, role: 'anon', exp: 2000000000 })).toString(
    'base64url',
  )
  return `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${payload}.c2lnbmF0dXJlLXBsYWNlaG9sZGVy`
})()

const serviceKey = (() => {
  const payload = Buffer.from(
    JSON.stringify({ iss: 'supabase', ref: REF, role: 'service_role', exp: 2000000000 }),
  ).toString('base64url')
  return `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${payload}.c2lnbmF0dXJlLXBsYWNlaG9sZGVy`
})()

const supabaseBundle = (key: string) =>
  `const client = createClient("https://${REF}.supabase.co", "${key}");`

const spec = (tables: Record<string, string[]>) =>
  JSON.stringify({
    swagger: '2.0',
    definitions: Object.fromEntries(
      Object.entries(tables).map(([name, columns]) => [
        name,
        { properties: Object.fromEntries(columns.map((column) => [column, { type: 'string' }])) },
      ]),
    ),
  })

/** PostgREST answers a `limit=0` count in Content-Range; no rows are returned. */
const count = (rows: number) => ({
  status: 200,
  body: '[]',
  headers: { 'content-range': rows === 0 ? '*/0' : `0-0/${rows}` },
})

const tableUrl = (table: string) => `${BASE}/${table}?select=*&limit=0`

describe('security.backend.supabase-rls', () => {
  it('does nothing at all without the active-testing capability', async () => {
    // The gate. This context has a Supabase key sitting in its bundle and no
    // proof that the requester owns the domain, so nothing may be probed.
    const ctx = makeContext({ scripts: [{ url: 'https://site.test/app.js', content: supabaseBundle(anonKey) }] })
    expect(ctx.activeProbe).toBeUndefined()
    expect(await supabaseRlsCheck.run(ctx)).toEqual([])
  })

  it('stays silent on a site with no Supabase configuration', async () => {
    const ctx = makeContext({ activeProbe: activeProbeStub({}) })
    expect(await supabaseRlsCheck.run(ctx)).toEqual([])
  })

  it('stays silent when the project rejects the key', async () => {
    const ctx = makeContext({
      scripts: [{ url: 'https://site.test/app.js', content: supabaseBundle(anonKey) }],
      activeProbe: activeProbeStub({ [`${BASE}/`]: { status: 401, body: '{}' } }),
    })
    expect(await supabaseRlsCheck.run(ctx)).toEqual([])
  })

  it('ignores a service-role key — that is the secrets check’s finding, not this one', async () => {
    // Pairing a service-role key with the API would test the database as an
    // admin, which is both a different finding and a far more invasive probe.
    const ctx = makeContext({
      scripts: [{ url: 'https://site.test/app.js', content: supabaseBundle(serviceKey) }],
      activeProbe: activeProbeStub({ [`${BASE}/`]: { status: 200, body: spec({ users: ['id'] }) } }),
    })
    expect(await supabaseRlsCheck.run(ctx)).toEqual([])
  })

  it('reports schema exposure only, at low, when RLS is holding', async () => {
    const ctx = makeContext({
      scripts: [{ url: 'https://site.test/app.js', content: supabaseBundle(anonKey) }],
      activeProbe: activeProbeStub({
        [`${BASE}/`]: { status: 200, body: spec({ users: ['id', 'email'], posts: ['id', 'title'] }) },
        [tableUrl('users')]: count(0),
        [tableUrl('posts')]: count(0),
      }),
    })
    const findings = await supabaseRlsCheck.run(ctx)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('low')
    expect(findings[0]?.title).toContain('no data was readable')
  })

  it('flags readable tables at high, and personal data at critical', async () => {
    const probe = (tables: Record<string, string[]>, counts: Record<string, number>) =>
      activeProbeStub({
        [`${BASE}/`]: { status: 200, body: spec(tables) },
        ...Object.fromEntries(Object.entries(counts).map(([table, rows]) => [tableUrl(table), count(rows)])),
      })

    const ordinary = await supabaseRlsCheck.run(
      makeContext({
        scripts: [{ url: 'https://site.test/app.js', content: supabaseBundle(anonKey) }],
        activeProbe: probe({ posts: ['id', 'title', 'body'] }, { posts: 42 }),
      }),
    )
    expect(ordinary[0]?.severity).toBe('high')
    // A public posts table may well be deliberate; the wording has to say so.
    expect(ordinary[0]?.description).toContain('meant to be public')

    const personal = await supabaseRlsCheck.run(
      makeContext({
        scripts: [{ url: 'https://site.test/app.js', content: supabaseBundle(anonKey) }],
        activeProbe: probe({ profiles: ['id', 'email', 'stripe_customer_id'] }, { profiles: 1337 }),
      }),
    )
    expect(personal[0]?.severity).toBe('critical')
    expect(personal[0]?.fixPrompt).toContain('rotate the project API keys')
  })

  it('keeps every row value out of the evidence', async () => {
    // The stub returns no rows because the real probe asks for none. This
    // asserts the shape of what we store: counts and column names, nothing more.
    const ctx = makeContext({
      scripts: [{ url: 'https://site.test/app.js', content: supabaseBundle(anonKey) }],
      activeProbe: activeProbeStub({
        [`${BASE}/`]: { status: 200, body: spec({ profiles: ['id', 'email'] }) },
        [tableUrl('profiles')]: count(9),
      }),
    })
    const evidence = (await supabaseRlsCheck.run(ctx))[0]?.evidence
    expect(evidence).toMatchObject({ project: REF, readable: [{ table: 'profiles', rows: 9 }] })
    expect(JSON.stringify(evidence)).not.toContain('@')
  })

  it('says how many tables it did not test rather than implying it tested all', async () => {
    const tables = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [`t${String(index).padStart(2, '0')}`, ['id']]),
    )
    const ctx = makeContext({
      scripts: [{ url: 'https://site.test/app.js', content: supabaseBundle(anonKey) }],
      activeProbe: activeProbeStub({
        [`${BASE}/`]: { status: 200, body: spec(tables) },
        ...Object.fromEntries(Object.keys(tables).map((table) => [tableUrl(table), count(0)])),
      }),
    })
    const evidence = (await supabaseRlsCheck.run(ctx))[0]?.evidence as Record<string, unknown>
    expect(evidence['tablesInSchema']).toBe(12)
    expect((evidence['tablesTested'] as string[]).length).toBe(8)
    expect(evidence['notTested']).toBe(4)
  })

  it('ignores backend config found in a third-party bundle', async () => {
    // A vendor widget carries the VENDOR's Supabase URL and key, as every
    // Supabase-backed widget must. Probing it on a scan of the customer's
    // site would be unauthorised testing against a company that never
    // consented, and would write the vendor's schema into the customer's
    // shareable report. No attacker required — an ordinary embed does it.
    const ctx = makeContext({
      scripts: [{ url: 'https://widget.somevendor.io/embed.js', content: supabaseBundle(anonKey) }],
      activeProbe: activeProbeStub({
        [`${BASE}/`]: { status: 200, body: spec({ subscribers: ['id', 'email'] }) },
        [tableUrl('subscribers')]: count(900),
      }),
    })
    expect(await supabaseRlsCheck.run(ctx)).toEqual([])
  })

  it('still reads the site\'s own CDN subdomain', async () => {
    const ctx = makeContext({
      url: 'https://site.test/',
      scripts: [{ url: 'https://assets.site.test/app.js', content: supabaseBundle(anonKey) }],
      activeProbe: activeProbeStub({
        [`${BASE}/`]: { status: 200, body: spec({ posts: ['id'] }) },
        [tableUrl('posts')]: count(3),
      }),
    })
    expect((await supabaseRlsCheck.run(ctx))[0]?.severity).toBe('high')
  })

  it('refuses a project ref that is not twenty lowercase letters', async () => {
    // The ref can come from a JWT payload, which is base64 the page chose. A
    // ref of "attacker.test/" turns https://${ref}.supabase.co/... into a URL
    // whose HOST is attacker.test, and the key would be sent there in an
    // Authorization header.
    const payload = Buffer.from(
      JSON.stringify({ iss: 'supabase', ref: 'attacker.test/', role: 'anon' }),
    ).toString('base64url')
    const forged = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${payload}.c2ln`
    const ctx = makeContext({
      html: `<script>const k="${forged}"</script>`,
      activeProbe: activeProbeStub({
        'https://attacker.test/.supabase.co/rest/v1/': { status: 200, body: spec({ x: ['id'] }) },
      }),
    })
    expect(await supabaseRlsCheck.run(ctx)).toEqual([])
  })

  it('does not call a soft-delete timestamp personal data', async () => {
    // Substring matching made 'discarded_at' contain "card" and escalated a
    // public blog table to a critical "rotate your API keys". Column names are
    // matched on whole words.
    const innocuous = ['id', 'title', 'discarded_at', 'wildcard_domain', 'token_count', 'cardinality', 'stripe_price_id']
    const ctx = makeContext({
      scripts: [{ url: 'https://site.test/app.js', content: supabaseBundle(anonKey) }],
      activeProbe: activeProbeStub({
        [`${BASE}/`]: { status: 200, body: spec({ posts: innocuous }) },
        [tableUrl('posts')]: count(12),
      }),
    })
    const findings = await supabaseRlsCheck.run(ctx)
    expect(findings[0]?.severity).toBe('high') // readable, yes — but not an incident
    expect(findings[0]?.title).toBe('1 Supabase table(s) readable by anyone')
  })

  it('still recognises personal data by whole words and by pairs', async () => {
    const ctx = makeContext({
      scripts: [{ url: 'https://site.test/app.js', content: supabaseBundle(anonKey) }],
      activeProbe: activeProbeStub({
        [`${BASE}/`]: { status: 200, body: spec({ profiles: ['id', 'emailAddress', 'stripe_customer_id'] }) },
        [tableUrl('profiles')]: count(4),
      }),
    })
    const findings = await supabaseRlsCheck.run(ctx)
    expect(findings[0]?.severity).toBe('critical')
    expect(findings[0]?.title).toContain('profiles')
  })

  it('stays silent rather than claiming RLS holds when a probe failed', async () => {
    // A timed-out request did not teach us the table is protected. Reporting
    // "row-level security is doing its job" off a failed request inverts this
    // engine's central rule — and the flap between critical and low would move
    // the score 27 points and mail the customer about a site that never changed.
    const ctx = makeContext({
      scripts: [{ url: 'https://site.test/app.js', content: supabaseBundle(anonKey) }],
      activeProbe: activeProbeStub({
        [`${BASE}/`]: { status: 200, body: spec({ users: ['id', 'email'] }) },
        // users is absent from the stub, i.e. the request failed.
      }),
    })
    expect(await supabaseRlsCheck.run(ctx)).toEqual([])
  })

  it('finds a project referenced only from inline HTML', async () => {
    const ctx = makeContext({
      html: `<!doctype html><html><head><script>window.ENV={url:"https://${REF}.supabase.co",key:"${anonKey}"}</script></head><body></body></html>`,
      activeProbe: activeProbeStub({
        [`${BASE}/`]: { status: 200, body: spec({ posts: ['id'] }) },
        [tableUrl('posts')]: count(3),
      }),
    })
    expect((await supabaseRlsCheck.run(ctx))[0]?.severity).toBe('high')
  })
})

const RTDB = 'https://demo-app.firebaseio.com'
const RTDB_URL = `${RTDB}/.json?shallow=true`
const BUCKET = 'demo-app.appspot.com'
const BUCKET_URL = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o?maxResults=1`

const firebaseBundle = `const app = initializeApp({ apiKey: "AIzaSyDEMO", databaseURL: "${RTDB}", storageBucket: "${BUCKET}", projectId: "demo-app" });`

describe('security.backend.firebase-rules', () => {
  it('does nothing at all without the active-testing capability', async () => {
    const ctx = makeContext({ scripts: [{ url: 'https://site.test/app.js', content: firebaseBundle }] })
    expect(ctx.activeProbe).toBeUndefined()
    expect(await firebaseRulesCheck.run(ctx)).toEqual([])
  })

  it('stays silent when the rules deny an unauthenticated read', async () => {
    // 401 from the Realtime Database and 403 from Storage are the HEALTHY
    // answers. This is the case that must never produce a finding.
    const ctx = makeContext({
      scripts: [{ url: 'https://site.test/app.js', content: firebaseBundle }],
      activeProbe: activeProbeStub({
        [RTDB_URL]: { status: 401, body: '{"error":"Permission denied"}' },
        [BUCKET_URL]: { status: 403, body: '{}' },
      }),
    })
    expect(await firebaseRulesCheck.run(ctx)).toEqual([])
  })

  it('stays silent on an empty database rather than calling it a breach', async () => {
    // A brand-new project reads as `null`. Readable, but nothing disclosed.
    const ctx = makeContext({
      scripts: [{ url: 'https://site.test/app.js', content: firebaseBundle }],
      activeProbe: activeProbeStub({ [RTDB_URL]: { status: 200, body: 'null' } }),
    })
    expect(await firebaseRulesCheck.run(ctx)).toEqual([])
  })

  it('flags a world-readable Realtime Database, showing node names only', async () => {
    const ctx = makeContext({
      scripts: [{ url: 'https://site.test/app.js', content: firebaseBundle }],
      activeProbe: activeProbeStub({
        [RTDB_URL]: { status: 200, body: JSON.stringify({ users: true, orders: true, messages: true }) },
      }),
    })
    const findings = await firebaseRulesCheck.run(ctx)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('critical')
    expect(findings[0]?.evidence).toMatchObject({ database: RTDB, topLevelNodes: ['users', 'orders', 'messages'] })
    // shallow=true is what keeps records out of the response in the first place.
    expect(findings[0]?.description).toContain('security rules allow public reads')
  })

  it('caps the node names it lists and says how many it left out', async () => {
    const nodes = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`node${index}`, true]))
    const ctx = makeContext({
      scripts: [{ url: 'https://site.test/app.js', content: firebaseBundle }],
      activeProbe: activeProbeStub({ [RTDB_URL]: { status: 200, body: JSON.stringify(nodes) } }),
    })
    const evidence = (await firebaseRulesCheck.run(ctx))[0]?.evidence as Record<string, unknown>
    expect((evidence['topLevelNodes'] as string[]).length).toBe(8)
    expect(evidence['additionalNodes']).toBe(12)
  })

  it('flags a listable Storage bucket at high', async () => {
    const ctx = makeContext({
      scripts: [{ url: 'https://site.test/app.js', content: firebaseBundle }],
      activeProbe: activeProbeStub({
        [BUCKET_URL]: { status: 200, body: JSON.stringify({ items: [{ name: 'uploads/a.pdf' }] }) },
      }),
    })
    const findings = await firebaseRulesCheck.run(ctx)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('high')
    expect(findings[0]?.evidence).toMatchObject({ bucket: BUCKET })
  })

  it('stays silent on an empty but readable bucket', async () => {
    const ctx = makeContext({
      scripts: [{ url: 'https://site.test/app.js', content: firebaseBundle }],
      activeProbe: activeProbeStub({ [BUCKET_URL]: { status: 200, body: JSON.stringify({}) } }),
    })
    expect(await firebaseRulesCheck.run(ctx)).toEqual([])
  })

  it('reports the database and the bucket independently', async () => {
    const ctx = makeContext({
      scripts: [{ url: 'https://site.test/app.js', content: firebaseBundle }],
      activeProbe: activeProbeStub({
        [RTDB_URL]: { status: 200, body: JSON.stringify({ users: true }) },
        [BUCKET_URL]: { status: 200, body: JSON.stringify({ items: [{ name: 'a.png' }] }) },
      }),
    })
    const findings = await firebaseRulesCheck.run(ctx)
    expect(findings.map((finding) => finding.severity)).toEqual(['critical', 'high'])
  })

  it('recognises a regional firebasedatabase.app url', async () => {
    const regional = 'https://demo-app-default-rtdb.europe-west1.firebasedatabase.app'
    const ctx = makeContext({
      scripts: [{ url: 'https://site.test/app.js', content: `initializeApp({databaseURL:"${regional}"})` }],
      activeProbe: activeProbeStub({
        [`${regional}/.json?shallow=true`]: { status: 200, body: JSON.stringify({ chats: true }) },
      }),
    })
    expect((await firebaseRulesCheck.run(ctx))[0]?.severity).toBe('critical')
  })
})
