/**
 * The guard on `?next=` redirect targets, kept as a pure function on its own.
 *
 * It lives apart from authz.ts on purpose: authz.ts is `server-only` and pulls
 * in the whole identity stack, so anything importing it drags that along. This
 * is a string check with no dependencies and one security job, and separating
 * it lets it be unit-tested in isolation — which for an open-redirect guard is
 * the difference between a covered invariant and a comment.
 */

/**
 * `next` comes from a query string, so it is attacker-controlled. Only a
 * same-site path is ever followed; anything else — an absolute URL, a
 * protocol-relative "//evil.test" — would make this an open redirect that
 * borrows our domain's credibility for a phishing page.
 *
 * The second character is checked, not just the "//" prefix: the URL parser
 * folds a backslash into a slash, so `new URL("/\\evil.test", origin)` (and
 * "/\\/evil.test") resolve to //evil.test and escape the origin exactly as
 * "//" does. Rejecting a leading slash followed by either slash or backslash
 * closes both. A lone "/" is fine — it is the origin root.
 */
export function safeNextPath(value: string | null): string {
  if (!value || value[0] !== '/' || value[1] === '/' || value[1] === '\\') return '/dashboard'
  return value
}
