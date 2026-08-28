import { describe, expect, it } from 'vitest'
import { SsrfError } from '@scanlyfix/checks'
import { assertRenderable, makeRequestGuard } from '../src/guard.ts'

/**
 * The SSRF guard, tested against IP literals only, so nothing here touches DNS.
 *
 * That is not a shortcut — it is the exact surface that matters. A literal
 * address never goes through the socket's lookup hook, so this guard is the
 * only wall in front of `http://127.0.0.1` and every redirect that lands on
 * one. The deny paths are the security-critical ones and they are all
 * synchronous, so they run the same in CI as on a laptop with no network.
 */

describe('assertRenderable', () => {
  it('accepts a public http(s) address', async () => {
    const url = await assertRenderable('http://8.8.8.8/')
    expect(url.href).toBe('http://8.8.8.8/')
    expect((await assertRenderable('https://8.8.8.8/path')).protocol).toBe('https:')
  })

  it('refuses loopback', async () => {
    await expect(assertRenderable('http://127.0.0.1/')).rejects.toBeInstanceOf(SsrfError)
    await expect(assertRenderable('http://[::1]/')).rejects.toBeInstanceOf(SsrfError)
  })

  it('refuses the cloud metadata address', async () => {
    // 169.254.169.254 is the single most valuable target for an SSRF against a
    // cloud host — it hands out credentials. It must never render.
    await expect(assertRenderable('http://169.254.169.254/latest/meta-data/')).rejects.toBeInstanceOf(
      SsrfError,
    )
  })

  it('refuses private ranges', async () => {
    for (const raw of ['http://10.0.0.1/', 'http://192.168.1.1/', 'http://172.16.5.4/']) {
      await expect(assertRenderable(raw)).rejects.toBeInstanceOf(SsrfError)
    }
  })

  it('refuses shorthand that canonicalises to a private address', async () => {
    // WHATWG URL turns "127.1" and octal/hex into dotted decimal, so the range
    // check sees the real address rather than the disguise.
    await expect(assertRenderable('http://127.1/')).rejects.toBeInstanceOf(SsrfError)
    await expect(assertRenderable('http://0x7f000001/')).rejects.toBeInstanceOf(SsrfError)
  })

  it('refuses non-http(s) schemes a browser would otherwise follow', async () => {
    for (const raw of ['file:///etc/passwd', 'ftp://8.8.8.8/', 'gopher://8.8.8.8/']) {
      await expect(assertRenderable(raw)).rejects.toBeInstanceOf(SsrfError)
    }
  })

  it('refuses a string that is not a URL', async () => {
    await expect(assertRenderable('not a url')).rejects.toBeInstanceOf(SsrfError)
  })
})

describe('makeRequestGuard', () => {
  it('allows a public address and blocks private ones', async () => {
    const guard = makeRequestGuard()
    expect(await guard('https://8.8.8.8/img.png')).toBe(true)
    expect(await guard('http://127.0.0.1/x')).toBe(false)
    expect(await guard('http://169.254.169.254/latest/')).toBe(false)
    expect(await guard('http://10.0.0.1/')).toBe(false)
  })

  it('allows in-browser schemes that never leave it', async () => {
    const guard = makeRequestGuard()
    expect(await guard('data:text/html,<p>hi</p>')).toBe(true)
    expect(await guard('blob:https://x/abc')).toBe(true)
    expect(await guard('about:blank')).toBe(true)
  })

  it('blocks schemes that are not http(s)', async () => {
    const guard = makeRequestGuard()
    expect(await guard('file:///etc/passwd')).toBe(false)
    expect(await guard('ftp://8.8.8.8/')).toBe(false)
  })

  it('fails closed on a value that is not a URL', async () => {
    const guard = makeRequestGuard()
    expect(await guard(')(*&^')).toBe(false)
  })

  it('memoises a verdict per host, so one render resolves each name once', async () => {
    const guard = makeRequestGuard()
    // Same host twice returns the very same promise instance — the second call
    // is served from the cache rather than resolved again.
    const first = guard('https://8.8.8.8/a')
    const second = guard('https://8.8.8.8/b')
    expect(first).toBe(second)
    expect(await first).toBe(true)
  })
})
