/**
 * Deciding what a failed sign-in is allowed to say on screen.
 *
 * The rule is a whitelist, not a filter. An error reaching the sign-in form can
 * come from our own code, from Convex, from Auth.js, or from whatever service
 * the provider called — and only the first of those was written with a stranger
 * as the reader. Rendering `error.message` blindly is how Resend's 403 put the
 * ACCOUNT OWNER's personal email address on the sign-in page of a public site:
 *
 *   Uncaught Error: Could not send the sign-in code (HTTP 403).
 *   {"statusCode":403,"name":"validation_error","message":"You can only send
 *   testing emails to your own email address (someone@example.com) ..."}
 *
 * A filter that strips known-bad patterns would have to predict every provider's
 * phrasing. A whitelist cannot: a message is shown only when we wrote it and
 * marked it, and everything else becomes one fixed sentence. The real text
 * still reaches the Convex logs, where it is useful and private.
 *
 * Convex also wraps server errors before they arrive, so the marked sentence
 * turns up inside a larger string rather than as the whole message — hence
 * searching for the marker rather than testing the start.
 */

/** Written for the person signing in. Kept in sync with convex/ResendOTP.ts. */
const SAFE_PREFIX = 'scanlyfix:'

/** What anything unrecognised becomes. Says what to do, blames nobody. */
const FALLBACK = 'That did not work. Try again in a moment.'

/**
 * The sentence to show for a failed sign-in.
 *
 * Anything we did not explicitly mark as safe collapses to FALLBACK, including
 * errors that are not Errors at all.
 */
export function describeSignInError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : ''
  const marker = raw.indexOf(SAFE_PREFIX)
  if (marker === -1) return FALLBACK

  const message = raw.slice(marker + SAFE_PREFIX.length).trim()
  /*
   * Convex appends its own trailing frames to a server error's message, so the
   * marked sentence is followed by a stack. Keep the first paragraph — our
   * sentences are one — and drop whatever came after it.
   */
  const [first] = message.split('\n')
  const trimmed = first?.trim() ?? ''
  return trimmed === '' ? FALLBACK : trimmed
}
