/**
 * The rendered accessibility audit, and the deferral it triggers.
 *
 * Two things are being pinned here.
 *
 * First, silence without data. The browser tier is a separate process on a
 * separate host and it is the most failure-prone component in the system:
 * browsers crash, pages hang, containers get OOM-killed. None of that may
 * become a finding about the customer's site, so `rendered` absent, `rendered`
 * null and `rendered.axe` null all produce nothing.
 *
 * Second, that exactly one source reports a given defect. When axe has audited
 * the real accessibility tree, the three static checks stand down — they parse
 * the served HTML and are blind to computed roles, cross-document label
 * associations and anything the framework built at runtime. Two sources
 * reporting one missing alt would charge the site twice, and the less accurate
 * one would be setting the severity.
 */

import { describe, expect, it } from 'vitest'
import { axeCheck } from '../src/accessibility/axe.ts'
import { formLabelsCheck } from '../src/accessibility/static/form-labels.ts'
import { imgAltCheck } from '../src/accessibility/static/img-alt.ts'
import { linkTextCheck } from '../src/accessibility/static/link-text.ts'
import type { CheckContext, RenderedPage } from '../src/types.ts'
import { makeContext } from './helpers.ts'

type Violation = NonNullable<RenderedPage['axe']>['violations'][number]

const violation = (overrides: Partial<Violation> = {}): Violation => ({
  id: 'color-contrast',
  impact: 'serious',
  help: 'Elements must meet minimum color contrast ratio thresholds',
  helpUrl: 'https://dequeuniversity.com/rules/axe/4.11/color-contrast',
  description: 'Ensures the contrast between foreground and background colors meets WCAG thresholds.',
  tags: ['cat.color', 'wcag2aa', 'wcag143'],
  nodeCount: 2,
  samples: [{ target: 'a.footer-link', html: '<a class="footer-link">Terms</a>' }],
  ...overrides,
})

const rendered = (violations: Violation[], passCount = 30): RenderedPage => ({
  html: '<html><body>rendered</body></html>',
  finalUrl: 'https://site.test/',
  axe: { violations, passCount },
})

const withRendered = (value: RenderedPage | null): CheckContext => ({ ...makeContext(), rendered: value })

describe('accessibility.axe', () => {
  it('says nothing when the browser tier was not used or did not answer', async () => {
    expect(await axeCheck.run(makeContext())).toEqual([])
    expect(await axeCheck.run(withRendered(null))).toEqual([])
    // A page whose CSP defeated the audit still returns its DOM. Half an
    // answer is used for the half that arrived and silent about the rest.
    expect(await axeCheck.run(withRendered({ html: '<html></html>', finalUrl: '', axe: null }))).toEqual([])
  })

  it('stays silent on a page axe found nothing wrong with', async () => {
    expect(await axeCheck.run(withRendered(rendered([])))).toEqual([])
  })

  it('maps axe impact one step down our scale', async () => {
    // Deliberate: `critical` here costs 30 points and is reserved for "a
    // stranger can read your database". Letting one axe rule take a third of
    // a site's score off would make the pillar unreadable on any real page.
    const severityFor = async (impact: Violation['impact']) =>
      (await axeCheck.run(withRendered(rendered([violation({ impact })]))))[0]?.severity

    expect(await severityFor('critical')).toBe('high')
    expect(await severityFor('serious')).toBe('medium')
    expect(await severityFor('moderate')).toBe('low')
    expect(await severityFor('minor')).toBe('info')
    // An impact axe did not set is reported, but never allowed to dominate.
    expect(await severityFor(null)).toBe('info')
  })

  it('reports one finding per rule, carrying the scale in the title', async () => {
    // A page with 200 unlabelled icons has ONE problem to fix, in one place.
    const findings = await axeCheck.run(
      withRendered(rendered([violation({ id: 'button-name', nodeCount: 200, help: 'Buttons must have discernible text' })])),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.title).toBe('Buttons must have discernible text (200 elements)')
    expect(findings[0]?.evidence).toMatchObject({ rule: 'button-name', elementsAffected: 200 })
    // ...and the prompt says so, rather than implying 200 separate edits.
    expect(findings[0]?.fixPrompt).toContain('one change, not 200 changes')
  })

  it('says "1 element" rather than "1 elements"', async () => {
    const findings = await axeCheck.run(withRendered(rendered([violation({ nodeCount: 1 })])))
    expect(findings[0]?.title).toContain('(1 element)')
  })

  it('decodes the WCAG criteria axe encodes in its tags', async () => {
    const findings = await axeCheck.run(
      withRendered(rendered([violation({ tags: ['cat.color', 'wcag2aa', 'wcag143', 'wcag1411'] })])),
    )
    // wcag143 is 1.4.3. wcag1411 is not the three-digit form, so it is dropped
    // rather than guessed at — a wrong criterion number is worse than none.
    expect(findings[0]?.evidence).toMatchObject({ wcag: '1.4.3' })
    expect(findings[0]?.description).toContain('WCAG 1.4.3')
  })

  it('omits the WCAG sentence entirely when no tag decodes', async () => {
    const findings = await axeCheck.run(withRendered(rendered([violation({ tags: ['cat.color', 'best-practice'] })])))
    // axe's own description mentions WCAG, so assert on OUR sentence.
    expect(findings[0]?.description).not.toContain('Maps to WCAG')
    expect(findings[0]?.evidence).not.toHaveProperty('wcag')
  })

  it('warns against satisfying the rule with an aria-label that lies', async () => {
    // The most common way an agent "fixes" these, and it makes things worse:
    // a wrong label silences the heuristics the browser would have applied.
    const findings = await axeCheck.run(withRendered(rendered([violation()])))
    expect(findings[0]?.fixPrompt).toContain('an ARIA attribute that lies')
    expect(findings[0]?.fixPrompt).toContain('worse for a screen-reader user')
  })
})

describe('static accessibility checks defer to axe', () => {
  const brokenHtml =
    '<!doctype html><html lang="en"><head><title>t</title></head><body>' +
    '<img src="/a.png">' +
    '<form><input type="text" name="q"></form>' +
    '<a href="/x">click here</a>' +
    '</body></html>'

  it('all three fire when no browser audited the page', async () => {
    const ctx = makeContext({ html: brokenHtml })
    for (const check of [imgAltCheck, formLabelsCheck, linkTextCheck]) {
      expect(await check.run(ctx), `${check.id} should fire without axe`).not.toEqual([])
    }
  })

  it('all three stand down once axe has audited the rendered tree', async () => {
    const ctx: CheckContext = { ...makeContext({ html: brokenHtml }), rendered: rendered([]) }
    for (const check of [imgAltCheck, formLabelsCheck, linkTextCheck]) {
      expect(await check.run(ctx), `${check.id} should defer to axe`).toEqual([])
    }
  })

  it('keep working when the render succeeded but the audit did not', async () => {
    // CSP blocked the audit, say. The static parse is all we have, so it is
    // better than nothing — deferring here would lose coverage for free.
    const ctx: CheckContext = {
      ...makeContext({ html: brokenHtml }),
      rendered: { html: '<html></html>', finalUrl: '', axe: null },
    }
    for (const check of [imgAltCheck, formLabelsCheck, linkTextCheck]) {
      expect(await check.run(ctx), `${check.id} should still fire`).not.toEqual([])
    }
  })
})
