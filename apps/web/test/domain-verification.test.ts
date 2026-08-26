/**
 * The gate on the two checks that touch somebody else's backend.
 *
 * Two things are being protected here and they pull in opposite directions.
 * A correct record must not be rejected over formatting — DNS splits long
 * values into 255-byte chunks, and provider UIs add quotes and whitespace, so
 * a flow that fails on any of that sends people to support instead of to
 * their zone file. And a WRONG record must never pass, because what it unlocks
 * is permission to probe a stranger's database.
 */

import { describe, expect, it } from 'vitest'
import { checkDnsProof, recordName, RECORD_PREFIX, type TxtResolver } from '../lib/domain-verification.ts'

const TOKEN = 'darvin-verify-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

const answers = (records: string[][]): TxtResolver => async () => records
const fails = (code: string): TxtResolver => async () => {
  throw Object.assign(new Error(code), { code })
}

describe('recordName', () => {
  it('namespaces the record so it is self-describing in a zone file', () => {
    expect(recordName('example.com')).toBe(`${RECORD_PREFIX}.example.com`)
  })
})

describe('a correct record', () => {
  it('passes', async () => {
    expect(await checkDnsProof('example.com', TOKEN, answers([[TOKEN]]))).toEqual({ ok: true })
  })

  it('passes when DNS split it into chunks, which it will at this length', async () => {
    const chunks = [TOKEN.slice(0, 40), TOKEN.slice(40)]
    expect(chunks.join('')).toBe(TOKEN)

    expect(await checkDnsProof('example.com', TOKEN, answers([chunks]))).toEqual({ ok: true })
  })

  it('passes despite whitespace a provider UI or a paste added', async () => {
    expect(await checkDnsProof('example.com', TOKEN, answers([[`  ${TOKEN}\n`]]))).toEqual({ ok: true })
  })

  it('passes when it sits alongside unrelated TXT records', async () => {
    const other = [['v=spf1 include:_spf.google.com ~all'], ['google-site-verification=abc']]
    expect(await checkDnsProof('example.com', TOKEN, answers([...other, [TOKEN]]))).toEqual({ ok: true })
  })
})

describe('a wrong record never passes', () => {
  it('rejects a token that is one character off', async () => {
    const almost = `${TOKEN.slice(0, -1)}0`
    const result = await checkDnsProof('example.com', TOKEN, answers([[almost]]))
    expect(result.ok).toBe(false)
  })

  it('rejects a token that merely contains the right one', async () => {
    const result = await checkDnsProof('example.com', TOKEN, answers([[`prefix-${TOKEN}-suffix`]]))
    expect(result.ok).toBe(false)
  })

  it('rejects somebody else’s darvin token', async () => {
    const theirs = 'darvin-verify-ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    const result = await checkDnsProof('example.com', TOKEN, answers([[theirs]]))
    expect(result.ok).toBe(false)
  })
})

describe('what a failure tells the reader', () => {
  it('shows what was actually there, so a mismatch can be seen', async () => {
    const result = await checkDnsProof('example.com', TOKEN, answers([['v=spf1 ~all'], ['other']]))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.found).toEqual(['v=spf1 ~all', 'other'])
    expect(result.reason).toContain('2 TXT records')
    expect(result.reason).toContain('_darvin.example.com')
  })

  it('blames propagation, not the reader, when the name does not resolve', async () => {
    for (const code of ['ENOTFOUND', 'ENODATA']) {
      const result = await checkDnsProof('example.com', TOKEN, fails(code))
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.reason).toContain('propagate')
    }
  })

  it('says a timeout is ours, because it is', async () => {
    const result = await checkDnsProof('example.com', TOKEN, fails('ETIMEOUT'))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('our resolver')
  })

  it('names an unfamiliar resolver error rather than guessing at it', async () => {
    const result = await checkDnsProof('example.com', TOKEN, fails('ESERVFAIL'))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('ESERVFAIL')
  })

  it('treats an empty answer as not-yet-propagated', async () => {
    const result = await checkDnsProof('example.com', TOKEN, answers([]))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.found).toEqual([])
    expect(result.reason).toContain('No TXT record found')
  })

  it('ignores empty chunks rather than reporting them as findings', async () => {
    const result = await checkDnsProof('example.com', TOKEN, answers([[''], ['   ']]))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.found).toEqual([])
  })
})
