/**
 * robots.txt fetch + parse, following the Google/RFC 9309 interpretation:
 *   - groups are formed by consecutive User-agent lines sharing the rules below them
 *   - the group whose agent token best (longest) matches the caller wins; '*' is the fallback
 *   - within a group the longest matching rule path wins; on a tie, Allow beats Disallow
 *   - '*' wildcards and a '$' end-anchor are supported in rule paths
 *
 * The parsed form is exposed only as `allows()` — checks should ask questions,
 * not re-parse the file.
 */

import type { CheckContext } from '../types.ts'
import { safeFetch } from './safe-fetch.ts'

type Robots = NonNullable<CheckContext['robots']>

interface RobotsRule {
  allow: boolean
  pattern: string
}

interface RobotsGroup {
  agents: string[]
  rules: RobotsRule[]
}

export function parseRobots(raw: string): Robots {
  const groups: RobotsGroup[] = []
  const sitemaps: string[] = []
  let current: RobotsGroup | null = null
  let previousWasAgent = false

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]!.trim()
    if (!line) continue

    const colon = line.indexOf(':')
    if (colon === -1) continue
    const field = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()

    if (field === 'user-agent') {
      // Consecutive User-agent lines share one group; a User-agent after rules starts a new one.
      if (!previousWasAgent || !current) {
        current = { agents: [], rules: [] }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      previousWasAgent = true
    } else if (field === 'allow' || field === 'disallow') {
      previousWasAgent = false
      // An empty pattern ("Disallow:") matches nothing — skip it entirely.
      if (current && value) {
        current.rules.push({ allow: field === 'allow', pattern: value })
      }
    } else {
      previousWasAgent = false // Sitemap:, Crawl-delay:, … end an agent run too
      // Sitemap is a group-independent directive and must be an absolute URL
      // (RFC 9309 §2.2.3); a relative value is meaningless to a crawler, so we
      // drop it rather than hand checks something they'd have to guess about.
      if (field === 'sitemap' && isAbsoluteHttpUrl(value)) sitemaps.push(value)
    }
  }

  return { raw, allows: (userAgent, path) => allows(groups, userAgent, path), sitemaps }
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function allows(groups: RobotsGroup[], userAgent: string, path: string): boolean {
  const ua = userAgent.toLowerCase()

  // Specificity of an agent token for this UA: longest matching token wins;
  // '*' matches everything at the lowest possible specificity.
  const specificity = (agent: string) => (agent === '*' ? 0 : ua.includes(agent) ? agent.length : -1)

  let bestLength = -1
  for (const group of groups) {
    for (const agent of group.agents) {
      bestLength = Math.max(bestLength, specificity(agent))
    }
  }
  if (bestLength === -1) return true // no applicable group → unrestricted

  // RFC 9309: a crawler's rules come from EVERY group matching at the chosen
  // specificity (files often repeat "User-agent: *" blocks) — merge them all,
  // not just the first winner.
  const rules = groups.flatMap((group) =>
    group.agents.some((agent) => specificity(agent) === bestLength) ? group.rules : [],
  )

  let verdict = true // no matching rule → allowed
  let matchedLength = -1
  for (const rule of rules) {
    if (!patternMatches(rule.pattern, path)) continue
    const length = rule.pattern.length
    // Longest match wins; on equal length Allow wins.
    if (length > matchedLength || (length === matchedLength && rule.allow && !verdict)) {
      matchedLength = length
      verdict = rule.allow
    }
  }
  return verdict
}

const regexCache = new Map<string, RegExp>()

function patternMatches(pattern: string, path: string): boolean {
  let regex = regexCache.get(pattern)
  if (!regex) {
    // Escape everything, then re-introduce robots semantics: '*' → '.*',
    // a trailing '$' → end anchor. Rules always match from the path start.
    let source = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')
    source = source.endsWith('\\$') ? `${source.slice(0, -2)}$` : source
    regex = new RegExp(`^${source}`)
    regexCache.set(pattern, regex)
  }
  return regex.test(path)
}

/** null when robots.txt is missing, errors out, or answers non-200 — all mean "no rules". */
export async function fetchRobots(origin: string): Promise<Robots | null> {
  try {
    const response = await safeFetch(`${origin}/robots.txt`, {
      timeoutMs: 8_000,
      maxBodyBytes: 512 * 1024,
    })
    if (response.status !== 200) return null
    return parseRobots(response.body)
  } catch {
    return null
  }
}
