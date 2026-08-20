/**
 * robots.txt matcher tests — RFC 9309 semantics the Phase 1 SEO checks and the
 * Phase 2 crawler will lean on: group selection by longest agent token,
 * longest-path-match precedence with Allow winning ties, and the '*' / '$'
 * rule metacharacters.
 */

import { describe, expect, it } from 'vitest'
import { parseRobots } from '../src/context/robots.ts'

describe('parseRobots', () => {
  it('applies a basic disallow to the wildcard group', () => {
    const robots = parseRobots('User-agent: *\nDisallow: /admin')
    expect(robots.allows('DarvinScanner', '/admin')).toBe(false)
    expect(robots.allows('DarvinScanner', '/admin/users')).toBe(false)
    expect(robots.allows('DarvinScanner', '/public')).toBe(true)
  })

  it('merges rules from repeated groups for the same agent (RFC 9309)', () => {
    // Real-world files often repeat "User-agent: *" blocks; every block's rules apply.
    const robots = parseRobots(
      ['User-agent: *', 'Disallow: /admin', '', 'User-agent: *', 'Disallow: /private'].join('\n'),
    )
    expect(robots.allows('DarvinScanner', '/admin')).toBe(false)
    expect(robots.allows('DarvinScanner', '/private')).toBe(false)
    expect(robots.allows('DarvinScanner', '/public')).toBe(true)
  })

  it('prefers the most specific agent group over *', () => {
    const robots = parseRobots(
      ['User-agent: *', 'Disallow: /', '', 'User-agent: darvin', 'Disallow: /private'].join('\n'),
    )
    // Our group allows everything except /private; the * group's total ban must not apply.
    expect(robots.allows('DarvinScanner/0.1', '/anything')).toBe(true)
    expect(robots.allows('DarvinScanner/0.1', '/private')).toBe(false)
    expect(robots.allows('SomeOtherBot', '/anything')).toBe(false)
  })

  it('matches agent tokens case-insensitively as substrings', () => {
    const robots = parseRobots('User-agent: DARVIN\nDisallow: /x')
    expect(robots.allows('mozilla-compatible darvinscanner', '/x')).toBe(false)
  })

  it('lets consecutive User-agent lines share one rule group', () => {
    const robots = parseRobots('User-agent: a\nUser-agent: b\nDisallow: /shared')
    expect(robots.allows('bot-a', '/shared')).toBe(false)
    expect(robots.allows('bot-b', '/shared')).toBe(false)
  })

  it('longest matching rule wins', () => {
    const robots = parseRobots('User-agent: *\nDisallow: /dir\nAllow: /dir/public')
    expect(robots.allows('x', '/dir/private')).toBe(false)
    expect(robots.allows('x', '/dir/public/page')).toBe(true)
  })

  it('Allow wins a same-length tie', () => {
    const robots = parseRobots('User-agent: *\nDisallow: /tie\nAllow: /tie')
    expect(robots.allows('x', '/tie')).toBe(true)
  })

  it("supports '*' wildcards and the '$' end anchor", () => {
    const robots = parseRobots('User-agent: *\nDisallow: /*.pdf$')
    expect(robots.allows('x', '/report.pdf')).toBe(false)
    expect(robots.allows('x', '/a/b/report.pdf')).toBe(false)
    expect(robots.allows('x', '/report.pdfx')).toBe(true) // $ anchors the match
    expect(robots.allows('x', '/report.html')).toBe(true)
  })

  it('treats an empty Disallow as "allow everything"', () => {
    const robots = parseRobots('User-agent: *\nDisallow:')
    expect(robots.allows('x', '/anything')).toBe(true)
  })

  it('ignores comments and unknown fields', () => {
    const robots = parseRobots(
      ['# welcome robots', 'User-agent: * # everyone', 'Crawl-delay: 10', 'Disallow: /secret # keep out'].join('\n'),
    )
    expect(robots.allows('x', '/secret')).toBe(false)
    expect(robots.allows('x', '/open')).toBe(true)
  })

  it('allows everything when the file has no applicable rules', () => {
    expect(parseRobots('').allows('x', '/anywhere')).toBe(true)
    expect(parseRobots('Sitemap: https://s.test/sitemap.xml').allows('x', '/page')).toBe(true)
  })
})
