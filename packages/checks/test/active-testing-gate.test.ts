/**
 * The gate on active backend testing.
 *
 * `ctx.activeProbe` lets a check send authenticated requests to a Supabase
 * project or a Firebase database. Granting it against the wrong host means
 * this scanner performs unauthorised testing on infrastructure belonging to
 * somebody who never asked to be scanned — a legal problem before it is an
 * engineering one — and writes that third party's schema into a report stored
 * in the requester's account.
 *
 * The rule used to be evaluated in the web app against the URL a caller
 * SUBMITTED, before any network I/O. That was wrong in a way no test caught:
 * buildContext follows up to five redirects and builds the entire context —
 * html, scripts, the backend keys these checks read — out of wherever it
 * landed. Verify evil.test, point it at `302 https://victim.test/`, and the
 * check passed on evil.test while the probing happened against victim.
 *
 * So the decision now lives here, against `finalUrl`, and every case below is
 * a refusal except the two that should not be.
 */

import { describe, expect, it } from 'vitest'
import { mayTestActively } from '../src/context/build-context.ts'

const landedOn = (href: string) => new URL(href)

describe('mayTestActively', () => {
  it('allows the host the requester proved they own', () => {
    expect(mayTestActively(landedOn('https://owned.test/pricing'), { verifiedHost: 'owned.test' })).toBe(true)
  })

  it('forgives a "www." prefix on either side, and casing', () => {
    // A presentation prefix, not a different site.
    expect(mayTestActively(landedOn('https://www.owned.test/'), { verifiedHost: 'owned.test' })).toBe(true)
    expect(mayTestActively(landedOn('https://owned.test/'), { verifiedHost: 'www.owned.test' })).toBe(true)
    expect(mayTestActively(landedOn('https://OWNED.test/'), { verifiedHost: 'owned.TEST' })).toBe(true)
  })

  it('refuses a scan with no verified host at all', () => {
    expect(mayTestActively(landedOn('https://owned.test/'), undefined)).toBe(false)
    expect(mayTestActively(landedOn('https://owned.test/'), { verifiedHost: '' })).toBe(false)
  })

  it('refuses the host a redirect landed on when it is not the verified one', () => {
    // The attack this exists to stop: own evil.test, verify it, redirect to
    // a victim. Everything in the context is now the victim's document.
    expect(mayTestActively(landedOn('https://victim.test/'), { verifiedHost: 'evil.test' })).toBe(false)
  })

  it('refuses every near miss', () => {
    const verified = { verifiedHost: 'owned.test' }
    // A subdomain is a different host, and strict is the safe direction.
    expect(mayTestActively(landedOn('https://app.owned.test/'), verified)).toBe(false)
    // A name that merely starts the same way.
    expect(mayTestActively(landedOn('https://owned.test.evil.test/'), verified)).toBe(false)
    // ...or merely ends the same way.
    expect(mayTestActively(landedOn('https://notowned.test/'), verified)).toBe(false)
    // A parent domain is not the verified one either.
    expect(mayTestActively(landedOn('https://test/'), verified)).toBe(false)
  })

  it('ignores everything about the URL except its host', () => {
    // Path, port and scheme are not identity. A verified owner running on a
    // non-default port is still the verified owner.
    expect(mayTestActively(landedOn('https://owned.test:8443/deep/path?q=1'), { verifiedHost: 'owned.test' })).toBe(true)
  })
})
