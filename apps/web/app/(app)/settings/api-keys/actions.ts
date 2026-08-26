'use server'

import { revalidatePath } from 'next/cache'
import { createApiKey, revokeApiKey } from '@darvin/db'
import { getViewer } from '@/lib/authz.ts'
import { entitlementsFor } from '@/lib/entitlements.ts'

export interface CreateKeyState {
  error?: string
  /**
   * The plaintext, returned to the browser exactly once.
   *
   * It lives in React state on the client and nowhere else — not in a cookie,
   * not in a revalidated server render, not in the database. A reload loses it
   * permanently, which is the intended behaviour and what the UI says.
   */
  plaintext?: string
  prefix?: string
}

export interface RevokeKeyState {
  error?: string
}

/**
 * Every action here re-reads the viewer and re-resolves the plan. A server
 * action is a public endpoint: the page that renders the button is not the
 * only thing that can call it, and the ceiling is not enforced by whether a
 * form was displayed.
 */
export async function createApiKeyAction(
  _prev: CreateKeyState,
  formData: FormData,
): Promise<CreateKeyState> {
  const viewer = await getViewer()
  if (viewer.kind !== 'user') return { error: 'Sign in to create a key.' }

  const { plan } = await entitlementsFor(viewer)

  // A name is optional in the column and required here. Two keys called
  // nothing are two keys nobody can tell apart, and the moment that matters is
  // the moment one of them has leaked.
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return { error: 'Give the key a name — you cannot rename it later.' }
  if (name.length > 60) return { error: 'Keep the name under 60 characters.' }

  const result = await createApiKey(viewer, name, plan.apiKeys)
  if (!result.ok) {
    if (result.reason === 'limit-reached') {
      return {
        error: plan.apiKeys === 0
          ? `The ${plan.name} plan does not include API access. Upgrade to Pro to issue keys.`
          : `The ${plan.name} plan allows ${plan.apiKeys} keys. Revoke one to issue another.`,
      }
    }
    return { error: 'Could not create the key.' }
  }

  revalidatePath('/settings/api-keys')
  return { plaintext: result.created.plaintext, prefix: result.created.key.prefix ?? '' }
}

export async function revokeApiKeyAction(
  _prev: RevokeKeyState,
  formData: FormData,
): Promise<RevokeKeyState> {
  const viewer = await getViewer()
  if (viewer.kind !== 'user') return { error: 'Sign in to revoke a key.' }

  const keyId = String(formData.get('keyId') ?? '')
  if (!(await revokeApiKey(keyId, viewer))) return { error: 'Could not find that key.' }

  revalidatePath('/settings/api-keys')
  return {}
}
