/**
 * The OAuth landing route, which is where a sign-in either becomes a session
 * or does not.
 *
 * The regression these lock down is specific and was live: the route used to
 * forward straight to `/callback` without redeeming the `?code=`. Because
 * `@supabase/ssr` pins both clients to PKCE, the provider hands back a code
 * and nothing else — no exchange, no cookie, no session — so every Google and
 * GitHub sign-in ended on `/login?error=sign-in-failed` while looking, from
 * the outside, like the provider had refused.
 *
 * So the first test asserts the exchange HAPPENS, not merely that the redirect
 * looks right. A route that forwards to the correct URL with no session is
 * exactly the bug that shipped.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const exchangeCodeForSession = vi.fn()

vi.mock('@/lib/supabase/server.ts', () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession } }),
}))

const { GET } = await import('../app/auth/callback/route.ts')

/** The Location header of the redirect this route returns. */
async function locationFor(url: string): Promise<string> {
  const response = await GET(new Request(url))
  return response.headers.get('location') ?? ''
}

beforeEach(() => {
  exchangeCodeForSession.mockReset()
  exchangeCodeForSession.mockResolvedValue({ error: null })
})

describe('/auth/callback', () => {
  it('redeems the PKCE code before forwarding — the whole point of the route', async () => {
    const location = await locationFor(
      'https://scanlyfix.com/auth/callback?code=abc123&next=%2Fdashboard',
    )

    expect(exchangeCodeForSession).toHaveBeenCalledTimes(1)
    expect(exchangeCodeForSession.mock.calls[0]?.[0]).toBe('abc123')
    expect(location).toBe('https://scanlyfix.com/callback?next=%2Fdashboard')
  })

  it('passes the flow id through, so a second sign-in cannot borrow the first verifier', async () => {
    await locationFor('https://scanlyfix.com/auth/callback?code=abc123&sb_flow_id=flow-9')

    expect(exchangeCodeForSession.mock.calls[0]?.[1]).toEqual({ flowId: 'flow-9' })
  })

  it('omits the flow id when the provider did not send one', async () => {
    await locationFor('https://scanlyfix.com/auth/callback?code=abc123')

    expect(exchangeCodeForSession.mock.calls[0]?.[1]).toBeUndefined()
  })

  it('sends a failed exchange to sign in again rather than on to the app', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: 'code already used' } })

    const location = await locationFor('https://scanlyfix.com/auth/callback?code=stale')

    expect(location).toBe('https://scanlyfix.com/login?error=sign-in-failed')
  })

  it('forwards the email-code flow, which arrives already signed in with no code', async () => {
    const location = await locationFor('https://scanlyfix.com/auth/callback?next=%2Fdashboard')

    expect(exchangeCodeForSession).not.toHaveBeenCalled()
    expect(location).toBe('https://scanlyfix.com/callback?next=%2Fdashboard')
  })

  it('refuses a provider error without repeating what the provider said', async () => {
    const location = await locationFor(
      'https://scanlyfix.com/auth/callback?error=access_denied&error_description=user%40example.com+denied',
    )

    expect(exchangeCodeForSession).not.toHaveBeenCalled()
    expect(location).toBe('https://scanlyfix.com/login?error=sign-in-failed')
    // The description can name a person or an internal reason; it is not ours
    // to put in a URL the browser will keep in history.
    expect(location).not.toContain('user%40example.com')
    expect(location).not.toContain('access_denied')
  })

  it('sanitises `next`, so the landing URL cannot be aimed off-origin', async () => {
    // Both the protocol-relative and the backslash form resolve off-origin if
    // they are ever handed to `new URL(next, origin)`.
    expect(await locationFor('https://scanlyfix.com/auth/callback?next=%2F%2Fevil.test')).toBe(
      'https://scanlyfix.com/callback?next=%2Fdashboard',
    )
    expect(await locationFor('https://scanlyfix.com/auth/callback?next=%2F%5Cevil.test')).toBe(
      'https://scanlyfix.com/callback?next=%2Fdashboard',
    )
    expect(await locationFor('https://scanlyfix.com/auth/callback?next=https%3A%2F%2Fevil.test')).toBe(
      'https://scanlyfix.com/callback?next=%2Fdashboard',
    )
  })
})
