/**
 * Authenticating a machine.
 *
 * lib/authz.ts turns a BROWSER into a Viewer by resolving the identity provider's
 * session cookie. This turns a `Authorization: Bearer sf_…` header into the same
 * Viewer union, so everything downstream — quota, rate limits, every query in
 * @scanlyfix/db — is the identical code path whether a person or a CI job asked.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: fall back to the session cookie.
 *
 * It would be one line, and it would make every /api/v1 route a CSRF target.
 * A browser attaches cookies to cross-origin requests it was tricked into
 * making; it does not attach an Authorization header. Requiring the header —
 * and ONLY the header — means a form on someone else's site cannot spend a
 * logged-in visitor's scan quota, and means this API needs no CSRF token,
 * no Origin allowlist and no SameSite reasoning to stay safe. Machines send
 * headers. That is the whole design.
 *
 * The plan gate is checked on every request rather than only at key creation,
 * because a subscription can lapse after a key is minted and the key would
 * otherwise outlive the entitlement that justified it.
 */

import 'server-only'
import { resolveApiKey, type Viewer } from '@scanlyfix/db'
import { entitlementsFor } from './entitlements.ts'
import type { Plan } from './plans.ts'

export interface ApiPrincipal {
  viewer: Viewer & { kind: 'user' }
  /** Which key was presented — for logging and for "last used" attribution. */
  keyId: string
  plan: Plan
}

export type ApiAuth =
  | { readonly ok: true; readonly principal: ApiPrincipal }
  | { readonly ok: false; readonly status: 401 | 403; readonly error: string }

const SCHEME = /^Bearer\s+(\S+)$/i

/**
 * Pulled out so the header shape has one definition. `Bearer` is matched
 * case-insensitively because RFC 6750 says the scheme is, and a caller whose
 * HTTP client title-cases it differently should not get a 401 with no clue why.
 */
export function bearerToken(headers: Headers): string | null {
  const raw = headers.get('authorization')
  if (!raw) return null
  return SCHEME.exec(raw.trim())?.[1] ?? null
}

export async function authenticateApiRequest(request: Request): Promise<ApiAuth> {
  const token = bearerToken(request.headers)
  if (!token) {
    return {
      ok: false,
      status: 401,
      error: 'Send your key as: Authorization: Bearer sf_…',
    }
  }

  const resolved = await resolveApiKey(token)
  if (!resolved) {
    // One message for "malformed", "unknown" and "revoked". Distinguishing
    // them tells someone probing keys which guesses were closer, and tells a
    // legitimate caller nothing they can act on that this does not.
    return { ok: false, status: 401, error: 'That key is not valid. Check it, or issue a new one.' }
  }

  const viewer = { kind: 'user', userId: resolved.userId } as const
  const { plan } = await entitlementsFor(viewer)

  if (!plan.apiAccess) {
    return {
      ok: false,
      status: 403,
      // 403 rather than 401: the credential is genuine and re-sending it will
      // not help. What is missing is a plan, and the message says so.
      error: `The ${plan.name} plan does not include API access. Upgrade to Pro to use /api/v1.`,
    }
  }

  return { ok: true, principal: { viewer, keyId: resolved.keyId, plan } }
}
