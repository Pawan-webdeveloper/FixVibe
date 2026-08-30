/**
 * Deciding what a failed sign-in is allowed to say on screen.
 *
 * The rule is a whitelist, not a filter. An error reaching the sign-in form can
 * come from our own code, from Supabase Auth, or from the OAuth / SMTP provider
 * Supabase delegated to — and only the first of those was written with a
 * stranger as the reader. Rendering `error.message` blindly is how the
 * provider's 403 put the ACCOUNT OWNER's personal email address on the sign-in
 * page of a public site.
 *
 * A filter that strips known-bad patterns would have to predict every
 * provider's phrasing. A whitelist cannot: a message is shown only when we
 * wrote it and marked it, and everything else becomes one fixed sentence. The
 * real text still reaches the server logs, where it is useful and private.
 */

/** Written for the person signing in. */
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
  // Keep the first paragraph — our sentences are one — and drop whatever came
  // after it (SDK wrappers, stacks, request ids).
  const [first] = message.split('\n')
  const trimmed = first?.trim() ?? ''
  return trimmed === '' ? FALLBACK : trimmed
}
