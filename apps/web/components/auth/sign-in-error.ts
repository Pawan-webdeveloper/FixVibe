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
 * Supabase SDK error codes that the operator can act on, mapped to a sentence
 * safe to show on the public sign-in page. The codes are the values the SDK
 * sets on `AuthApiError` / `AuthError` — matching them, not the message,
 * because a third party (Google, the Supabase project owner) does not
 * control the code and so cannot leak sensitive data through it.
 */
const SDK_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  redirect_uri_not_in_whitelist:
    'scanlyfix:This sign-in is misconfigured: the app URL is not on the Supabase redirect allowlist. Update NEXT_PUBLIC_APP_URL and SUPABASE_REDIRECT_ALLOWLIST to match.',
  validation_failed:
    'scanlyfix:That sign-in did not complete. Check the address and try again.',
  email_provider_disabled:
    'scanlyfix:Email sign-in is not available right now. Please use Google or GitHub.',
  provider_disabled:
    'scanlyfix:That sign-in provider is not enabled. Try one of the other options.',
  signup_disabled:
    'scanlyfix:New sign-ups are closed right now. Please use an existing account.',
}

/**
 * Extracts the Supabase SDK error code from a thrown value. The SDK puts the
 * code on `error.code` for `AuthError` subclasses; falls back to a regex on
 * the message for SDK versions that embed it in text.
 */
function sdkErrorCode(cause: unknown): string | null {
  if (cause && typeof cause === 'object' && 'code' in cause) {
    const code = (cause as { code?: unknown }).code
    if (typeof code === 'string' && code.length > 0) return code
  }
  if (cause instanceof Error) {
    const match = /"code"\s*:\s*"([a-z_]+)"/.exec(cause.message)
    if (match) return match[1] ?? null
  }
  return null
}

/**
 * The sentence to show for a failed sign-in.
 *
 * Anything we did not explicitly mark as safe collapses to FALLBACK, including
 * errors that are not Errors at all.
 */
export function describeSignInError(cause: unknown): string {
  const code = sdkErrorCode(cause)
  if (code) {
    const mapped = SDK_ERROR_MESSAGES[code]
    if (mapped) return mapped
  }

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
