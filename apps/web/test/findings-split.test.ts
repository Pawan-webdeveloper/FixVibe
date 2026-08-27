/**
 * Which pillars a report opens with.
 *
 * This is a product rule with a sharp edge, so every branch is pinned: an
 * answer given once, months ago, decides what a reader sees FIRST — and must
 * never decide what they can see at all. A critical security finding on a site
 * whose owner ticked "SEO" has to stay reachable, and the closed disclosure has
 * to say it is in there.
 */

import { describe, expect, it } from 'vitest'
import type { Category } from '@darvin/checks'
import { describeRest, splitPillars, type PillarFinding } from '../components/scan/pillar-view.ts'

const finding = (category: Category, severity: string): PillarFinding => ({ category, severity })

describe('splitPillars', () => {
  it('shows every pillar to a reader who never answered', () => {
    // Signed out is this case, and it is the most common one on the site.
    const { chosen, rest } = splitPillars(null)
    expect(chosen.length).toBeGreaterThan(1)
    expect(rest).toEqual([])
  })

  it('shows every pillar when the answer was "nothing in particular"', () => {
    // [] means asked and answered, not unasked — but an empty pick is not a
    // request for an empty report.
    expect(splitPillars([]).rest).toEqual([])
  })

  it('leads with the picked pillars and sets the others aside', () => {
    const { chosen, rest } = splitPillars(['seo', 'aeo'])
    expect(chosen).toEqual(['seo', 'aeo'])
    expect(rest).toContain('security')
    expect(rest).not.toContain('seo')
  })

  it('keeps the engine’s pillar order inside each group', () => {
    // Two readers picking the same pillars in a different order must get the
    // same report; the tick order in a form is not a ranking.
    expect(splitPillars(['aeo', 'seo']).chosen).toEqual(splitPillars(['seo', 'aeo']).chosen)
  })

  it('falls back to everything rather than rendering an empty report', () => {
    // A stored answer naming nothing we cover — an old category, a hand-edited
    // row. An empty report is the one output that is always wrong.
    const { chosen, rest } = splitPillars(['nonsense' as Category])
    expect(chosen.length).toBeGreaterThan(1)
    expect(rest).toEqual([])
  })

  it('sets nothing aside when every pillar was picked', () => {
    const all = splitPillars(null).chosen
    expect(splitPillars(all).rest).toEqual([])
  })
})

describe('describeRest', () => {
  it('names the worst severity, because that decides whether to open it', () => {
    const text = describeRest(['security', 'compliance'], [
      finding('security', 'critical'),
      finding('compliance', 'low'),
    ])
    // "2 pillars" on its own invites a reader to leave a critical finding folded.
    expect(text).toContain('critical')
    expect(text).toContain('2 findings')
    expect(text).toContain('2 pillars')
  })

  it('says so plainly when the set-aside pillars are clean', () => {
    const text = describeRest(['compliance'], [])
    expect(text).toContain('every check passed')
    expect(text).not.toContain('worst')
  })

  it('reads correctly for a single pillar and a single finding', () => {
    const text = describeRest(['seo'], [finding('seo', 'high')])
    expect(text).toContain('1 pillar you did not pick')
    expect(text).toContain('1 finding,')
  })
})
