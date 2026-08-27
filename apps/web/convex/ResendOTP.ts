/**
 * The six-digit code that goes to a self-entered email address.
 *
 * A CODE rather than a magic link, and the difference is practical. A link has
 * to survive being rewritten by a corporate mail scanner, opened in whichever
 * browser the mail client prefers, and clicked in the same session it was
 * requested from — three ways to fail that have nothing to do with the person.
 * A code is read with the eyes and typed into the tab that is already open.
 *
 * Entropy: six digits is a million possibilities, which is only safe because
 * the code expires in fifteen minutes and Convex Auth invalidates it after the
 * attempts it allows. It is deliberately generated from crypto.getRandomValues
 * with rejection sampling rather than `Math.random()` or a modulo — a modulo of
 * 2^32 by 1,000,000 makes the low codes measurably likelier, and a guessing
 * attack only has to be pointed at the likelier half.
 */

import { Email } from '@convex-dev/auth/providers/Email'

/**
 * Resend over plain fetch, no SDK — the same choice apps/web/lib/email.ts
 * makes, for the same reason. Their API is one POST with a JSON body, and a
 * package for that is more dependency than code. It also keeps this function
 * on Convex's default V8 runtime instead of forcing "use node".
 */
const RESEND_ENDPOINT = 'https://api.resend.com/emails'

/** Long enough to find the mail, short enough that a leaked code is stale. */
const EXPIRY_SECONDS = 15 * 60

const DIGITS = 6
const CEILING = 10 ** DIGITS

/**
 * Uniform over 000000–999999.
 *
 * Web Crypto rather than node:crypto: Convex functions run on a V8 isolate,
 * not on Node, and `crypto.getRandomValues` is what exists there.
 */
function generateCode(): string {
  // The largest multiple of CEILING that fits in 2^32. Values at or above it
  // are discarded, which is what removes the modulo bias.
  const limit = Math.floor(0x1_0000_0000 / CEILING) * CEILING
  const buffer = new Uint32Array(1)

  for (;;) {
    crypto.getRandomValues(buffer)
    const value = buffer[0]!
    if (value < limit) return String(value % CEILING).padStart(DIGITS, '0')
  }
}

export const ResendOTP = Email({
  id: 'resend-otp',
  apiKey: process.env.AUTH_RESEND_KEY,
  maxAge: EXPIRY_SECONDS,
  generateVerificationToken: async () => generateCode(),

  async sendVerificationRequest({ identifier: email, provider, token }) {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${provider.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: process.env.AUTH_EMAIL_FROM ?? 'Darvin <onboarding@resend.dev>',
        to: [email],
        subject: `${token} is your Darvin sign-in code`,
        text: signInText(token),
        html: signInHtml(token),
      }),
    })

    // Thrown so the caller learns the code was never sent. Swallowing it shows
    // "check your inbox" for a message that does not exist, and the person
    // waits, retries, and blames their spam filter.
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`Could not send the sign-in code (HTTP ${response.status}). ${detail}`.trim())
    }
  },
})

/**
 * The code leads, in the subject line and in the first sentence, because on a
 * phone the notification preview is often the only place it needs to be read.
 */
function signInText(token: string): string {
  return [
    `${token} is your Darvin sign-in code.`,
    '',
    'It expires in 15 minutes and works once.',
    '',
    'If you did not ask to sign in, nothing has happened and you can ignore this.',
  ].join('\n')
}

function signInHtml(token: string): string {
  return `<div style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#0b0d10;line-height:1.6">
  <p style="margin:0 0 20px">Your Darvin sign-in code:</p>
  <p style="margin:0 0 20px;font-size:30px;letter-spacing:0.22em;font-weight:700">${token}</p>
  <p style="margin:0 0 8px;color:#5a626b;font-size:14px">It expires in 15 minutes and works once.</p>
  <p style="margin:0;color:#5a626b;font-size:14px">If you did not ask to sign in, nothing has happened and you can ignore this.</p>
</div>`
}
