/**
 * The transport's contract is its failure taxonomy, so that is what is pinned.
 *
 * A monitoring product that loses its own alerts is worse than one with no
 * alerts. Which failures are retried and which are recorded is therefore not a
 * detail — it is the difference between "the mail server blipped" and "nobody
 * was ever told", and only one of those is fixed by trying again.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emailConfigured, sendEmail } from '../lib/email.ts'

const message = { to: 'someone@example.test', subject: 'subject', text: 'body' }

const originalKey = process.env['RESEND_API_KEY']
const originalFetch = globalThis.fetch

/** Typed like fetch so the assertions below can read what was actually sent. */
function respondWith(status: number, body: unknown) {
  const spy = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status }),
  )
  globalThis.fetch = spy as unknown as typeof fetch
  return spy
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalKey === undefined) delete process.env['RESEND_API_KEY']
  else process.env['RESEND_API_KEY'] = originalKey
  vi.restoreAllMocks()
})

describe('with no API key', () => {
  beforeEach(() => {
    delete process.env['RESEND_API_KEY']
  })

  it('reports itself as unconfigured', () => {
    expect(emailConfigured()).toBe(false)
  })

  it('refuses without throwing — retrying cannot conjure a key', async () => {
    const spy = respondWith(200, { id: 'never' })
    const result = await sendEmail(message)

    expect(result).toEqual({ sent: false, reason: 'RESEND_API_KEY is not configured' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('logs loudly, because this is the setting that silently disables alerting', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await sendEmail(message)

    expect(spy).toHaveBeenCalled()
    expect(String(spy.mock.calls[0]?.[0])).toContain('RESEND_API_KEY')
  })
})

describe('with an API key', () => {
  beforeEach(() => {
    process.env['RESEND_API_KEY'] = 're_test_key'
  })

  it('reports itself as configured', () => {
    expect(emailConfigured()).toBe(true)
  })

  it('returns the provider id on success', async () => {
    respondWith(200, { id: 'msg_123' })
    expect(await sendEmail(message)).toEqual({ sent: true, id: 'msg_123' })
  })

  it('sends the address, subject and body the caller gave it', async () => {
    const spy = respondWith(200, { id: 'msg_123' })
    await sendEmail({ ...message, html: '<pre>body</pre>' })

    const body = JSON.parse(String(spy.mock.calls[0]?.[1]?.body))
    expect(body.to).toEqual(['someone@example.test'])
    expect(body.subject).toBe('subject')
    expect(body.text).toBe('body')
    expect(body.html).toBe('<pre>body</pre>')
  })

  it('THROWS on 5xx, so the queue retries a transient provider failure', async () => {
    respondWith(503, { message: 'service unavailable' })
    await expect(sendEmail(message)).rejects.toThrow(/503/)
  })

  it('THROWS on a network failure, for the same reason', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNRESET')
    }) as unknown as typeof fetch

    await expect(sendEmail(message)).rejects.toThrow(/ECONNRESET/)
  })

  it('RETURNS on 4xx — a rejected address is not fixed by sending it again', async () => {
    respondWith(422, { message: 'Invalid `to` field' })
    expect(await sendEmail(message)).toEqual({ sent: false, reason: 'Invalid `to` field' })
  })

  it('falls back to the status when the provider explains nothing', async () => {
    respondWith(400, {})
    expect(await sendEmail(message)).toEqual({ sent: false, reason: 'HTTP 400' })
  })
})
