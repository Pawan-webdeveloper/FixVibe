/**
 * The rule this file exists to protect: `sentAt` is written ONLY after a
 * provider accepted the message.
 *
 * An alert row with a null sentAt is the only record that somebody was never
 * told about their own outage. Marking optimistically would erase exactly the
 * evidence you need when a customer asks why they heard nothing — so a failed
 * send must leave the row untouched, and a successful one must not be sent
 * twice.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const alertForDelivery = vi.fn()
const markAlertSent = vi.fn()
const sendEmail = vi.fn()

vi.mock('@scanlyfix/db', () => ({ alertForDelivery, markAlertSent }))
vi.mock('../lib/email.ts', () => ({ sendEmail, emailConfigured: () => true }))

const { deliverAlert } = await import('../lib/alert-email.ts')

const row = {
  id: 'alert-1',
  kind: 'downtime',
  payload: { streak: 3, statusCode: 503 },
  sentAt: null as Date | null,
  projectName: 'ScanlyFix',
  projectUrl: 'https://scanlyfix.test/',
  projectSlug: 'scanlyfix-test',
  recipientEmail: 'owner@example.test',
}

beforeEach(() => {
  alertForDelivery.mockReset()
  markAlertSent.mockReset()
  sendEmail.mockReset()
})

afterEach(() => vi.restoreAllMocks())

describe('deliverAlert', () => {
  it('sends to the project owner with a rendered subject and body', async () => {
    alertForDelivery.mockResolvedValue(row)
    sendEmail.mockResolvedValue({ sent: true, id: 'msg_1' })

    await deliverAlert('alert-1')

    const message = sendEmail.mock.calls[0]?.[0]
    expect(message.to).toBe('owner@example.test')
    expect(message.subject).toBe('scanlyfix.test is not responding')
    expect(message.text).toContain('failed 3 consecutive checks')
    // The HTML is a mirror of the text, so it must carry the same facts.
    expect(message.html).toContain('failed 3 consecutive checks')
  })

  it('marks the row sent once the provider accepted it', async () => {
    alertForDelivery.mockResolvedValue(row)
    sendEmail.mockResolvedValue({ sent: true, id: 'msg_1' })

    expect(await deliverAlert('alert-1')).toEqual({ sent: true, id: 'msg_1' })
    expect(markAlertSent).toHaveBeenCalledWith('alert-1')
  })

  it('does NOT mark the row when the send was refused', async () => {
    alertForDelivery.mockResolvedValue(row)
    sendEmail.mockResolvedValue({ sent: false, reason: 'RESEND_API_KEY is not configured' })

    const result = await deliverAlert('alert-1')

    expect(result).toEqual({ sent: false, reason: 'RESEND_API_KEY is not configured' })
    // The whole point: an undelivered alert stays findable.
    expect(markAlertSent).not.toHaveBeenCalled()
  })

  it('lets a thrown transport error propagate, so the queue retries it', async () => {
    alertForDelivery.mockResolvedValue(row)
    sendEmail.mockRejectedValue(new Error('mail provider returned 503'))

    await expect(deliverAlert('alert-1')).rejects.toThrow(/503/)
    expect(markAlertSent).not.toHaveBeenCalled()
  })

  it('refuses to send an alert that already went out', async () => {
    alertForDelivery.mockResolvedValue({ ...row, sentAt: new Date() })

    expect(await deliverAlert('alert-1')).toEqual({ sent: false, reason: 'already delivered' })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('handles an alert that no longer exists', async () => {
    alertForDelivery.mockResolvedValue(null)

    expect(await deliverAlert('gone')).toEqual({ sent: false, reason: 'alert no longer exists' })
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
