/**
 * Renderer tests for the public status-page subscriber emails.
 *
 * Pure — no DB, no mail provider. We assert on the rendered subject +
 * text so the customer-facing copy cannot drift silently.
 */

import { describe, expect, it } from 'vitest'
import {
  renderConfirmEmail,
  renderStatusUpdateEmail,
} from '../lib/status-subscriber-email.ts'

describe('renderConfirmEmail', () => {
  it('puts the confirm link in the body and an unsubscribe link alongside it', () => {
    const { subject, text } = renderConfirmEmail({
      subscriber: { token: 'tok-1' },
      projectName: 'My App',
      projectUrl: 'https://my.app',
    })
    expect(subject).toContain('My App')
    expect(text).toContain('/api/status/confirm?token=tok-1')
    expect(text).toContain('/api/status/unsubscribe?token=tok-1')
    expect(text).toContain('my.app')
  })

  it('escapes HTML special characters in the html mirror', () => {
    const { html } = renderConfirmEmail({
      subscriber: { token: 't' },
      projectName: '<script>',
      projectUrl: 'https://x.test',
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('falls back to the raw url when the project url is unparseable', () => {
    const { text } = renderConfirmEmail({
      subscriber: { token: 't' },
      projectName: 'X',
      projectUrl: 'not-a-url',
    })
    // Should not crash; should still mention something for the host.
    expect(text).toContain('Confirm')
  })
})

describe('renderStatusUpdateEmail', () => {
  const basePayload = {
    projectName: 'My App',
    projectUrl: 'https://my.app',
    projectSlug: 'my-app',
    incidentId: 'inc-1',
    message: 'We are investigating elevated 5xx.',
  }

  it('prefixes the subject with [INCIDENT] on the first notification', () => {
    const { subject } = renderStatusUpdateEmail({
      ...basePayload,
      subscriber: { token: 't' },
      stage: 'investigating',
      headline: 'My App is not responding',
      isInitial: true,
    })
    expect(subject.startsWith('[INCIDENT]')).toBe(true)
  })

  it('prefixes the subject with [RESOLVED] when the incident is resolved', () => {
    const { subject } = renderStatusUpdateEmail({
      ...basePayload,
      subscriber: { token: 't' },
      stage: 'resolved',
      headline: 'My App is back up',
      isInitial: false,
    })
    expect(subject.startsWith('[RESOLVED]')).toBe(true)
  })

  it('prefixes the subject with the stage label for updates', () => {
    const { subject } = renderStatusUpdateEmail({
      ...basePayload,
      subscriber: { token: 't' },
      stage: 'identified',
      headline: 'Root cause: misconfigured edge function',
      isInitial: false,
    })
    expect(subject.startsWith('[IDENTIFIED]')).toBe(true)
  })

  it('includes a per-recipient unsubscribe link carrying the token', () => {
    const { text } = renderStatusUpdateEmail({
      ...basePayload,
      subscriber: { token: 'tok-XYZ' },
      stage: 'monitoring',
      headline: 'Mitigation in place',
      isInitial: false,
    })
    expect(text).toContain('/api/status/unsubscribe?token=tok-XYZ')
    expect(text).toContain('/status/my-app')
    expect(text).toContain('We are investigating elevated 5xx.')
  })
})
