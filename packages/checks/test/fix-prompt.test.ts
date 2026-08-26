/**
 * The aggregate fix prompt.
 *
 * Its value is not concatenation — every finding already carries its own
 * instruction. It is the two things a per-finding prompt cannot know: WHERE the
 * change lands for this particular stack, and in what ORDER. So most of these
 * tests are about grouping, routing and the two orderings that matter:
 * rotation before anything else, and DNS never being treated as code.
 */

import { describe, expect, it } from 'vitest'
import type { Finding, Severity } from '../src/types.ts'
import { buildFixPrompt, detectStack, type StackHint } from '../src/fix-prompt.ts'
import { makeContext } from './helpers.ts'

const finding = (checkId: string, severity: Severity = 'medium'): Finding => ({
  checkId,
  category: 'security',
  severity,
  title: `title for ${checkId}`,
  description: 'd',
  remediation: 'r',
  fixPrompt: `instruction for ${checkId}`,
})

const build = (findings: Finding[], stack: StackHint = { framework: null, platform: null }) =>
  buildFixPrompt(findings, { url: 'https://site.test/', stack })

describe('detectStack', () => {
  it('identifies Next.js from its data blob', () => {
    const html = '<html><body><script id="__NEXT_DATA__">{}</script></body></html>'
    expect(detectStack(makeContext({ html })).framework).toBe('nextjs')
  })

  it('identifies Next.js from its asset paths', () => {
    const ctx = makeContext()
    ctx.scripts.push({ url: 'https://site.test/_next/static/chunks/main.js', content: '' })
    expect(detectStack(ctx).framework).toBe('nextjs')
  })

  it('identifies WordPress from its content paths', () => {
    const html = '<html><body><img src="/wp-content/uploads/a.png"></body></html>'
    expect(detectStack(makeContext({ html })).framework).toBe('wordpress')
  })

  it('identifies the platform from its response header', () => {
    expect(detectStack(makeContext({ headers: { 'x-vercel-id': 'abc' } })).platform).toBe('vercel')
    expect(detectStack(makeContext({ headers: { 'cf-ray': 'abc' } })).platform).toBe('cloudflare')
    expect(detectStack(makeContext({ headers: { server: 'nginx/1.25.3' } })).platform).toBe('nginx')
  })

  it('identifies framework and platform independently', () => {
    const ctx = makeContext({
      html: '<html><body><script id="__NEXT_DATA__">{}</script></body></html>',
      headers: { 'x-vercel-id': 'abc' },
    })
    expect(detectStack(ctx)).toEqual({ framework: 'nextjs', platform: 'vercel' })
  })

  it('returns null rather than guessing', () => {
    // A confidently wrong framework produces confidently wrong instructions,
    // which is worse than admitting the stack is unknown.
    expect(detectStack(makeContext())).toEqual({ framework: null, platform: null })
  })
})

describe('buildFixPrompt', () => {
  it('returns nothing when there is nothing to fix', () => {
    expect(build([])).toBe('')
  })

  it('leaves informational rows out of a work order', () => {
    // They describe rather than ask; an agent cannot act on them.
    expect(build([finding('seo.title', 'info')])).toBe('')
  })

  it('names the stack it detected', () => {
    const prompt = build([finding('security.headers.csp')], { framework: 'nextjs', platform: 'vercel' })
    expect(prompt).toContain('Next.js site served through Vercel')
  })

  it('says the stack is unknown instead of inventing one', () => {
    expect(build([finding('security.headers.csp')])).toContain('could not be identified')
  })

  it('routes header fixes to the right file for the framework', () => {
    const prompt = build([finding('security.headers.csp')], { framework: 'nextjs', platform: null })
    expect(prompt).toContain('next.config.ts')
  })

  it('lets the platform win over the framework for headers', () => {
    // A Next.js app behind Netlify can set headers in either place, but the
    // edge is where they apply to every response including static files.
    const prompt = build([finding('security.headers.csp')], { framework: 'nextjs', platform: 'netlify' })
    expect(prompt).toContain('_headers')
    expect(prompt).not.toContain('next.config.ts')
  })

  it('groups every header finding under one instruction', () => {
    const prompt = build(
      [
        finding('security.headers.csp'),
        finding('security.headers.hsts'),
        finding('security.headers.x-frame-options'),
        finding('performance.compression'),
      ],
      { framework: 'nextjs', platform: null },
    )
    // One section heading, not four.
    expect(prompt.match(/## \d+\. Response headers/g)).toHaveLength(1)
    expect(prompt).toContain('instruction for security.headers.csp')
    expect(prompt).toContain('instruction for performance.compression')
  })

  it('puts credential rotation before everything else', () => {
    const prompt = build([finding('security.headers.csp'), finding('security.secrets.secrets-in-js', 'critical')])
    expect(prompt.indexOf('Rotate exposed credentials')).toBeLessThan(prompt.indexOf('Response headers'))
  })

  it('tells the agent that DNS is not code', () => {
    // Without this an agent handed "fix SPF" edits a file, commits it, and
    // reports the problem solved.
    const prompt = build([finding('security.email.spf')])
    expect(prompt).toContain('NOT code')
    expect(prompt).toContain('Do NOT edit any file')
  })

  it('separates <head> markup from page markup, which are different files', () => {
    const prompt = build([finding('seo.title'), finding('accessibility.img-alt')], {
      framework: 'nextjs',
      platform: null,
    })
    expect(prompt).toContain('app/layout.tsx')
    expect(prompt).toContain('Page markup')
  })

  it('sorts findings worst-first inside a section', () => {
    const prompt = build([finding('security.headers.csp', 'low'), finding('security.headers.hsts', 'critical')])
    expect(prompt.indexOf('security.headers.hsts')).toBeLessThan(prompt.indexOf('security.headers.csp'))
  })

  it('files an unrecognised check under page markup rather than dropping it', () => {
    const prompt = build([finding('brand.new.check')])
    expect(prompt).toContain('instruction for brand.new.check')
  })

  it('ends by telling the agent to verify from outside', () => {
    // Several of these are only observable over HTTP: a header set in the wrong
    // layer looks correct in the repository and unchanged to a visitor.
    expect(build([finding('security.headers.csp')])).toContain('re-scan')
  })
})
