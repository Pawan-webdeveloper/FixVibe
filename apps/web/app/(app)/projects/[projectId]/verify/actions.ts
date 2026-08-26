'use server'

import { revalidatePath } from 'next/cache'
import {
  ensureVerificationToken,
  markDomainVerified,
  revokeDomainVerification,
  verificationState,
} from '@darvin/db'
import { getViewer } from '@/lib/authz.ts'
import { checkDnsProof } from '@/lib/domain-verification.ts'

export interface VerifyState {
  error?: string
  /** TXT values actually found, so a mismatch can be seen rather than guessed at. */
  found?: string[]
  ok?: boolean
}

/**
 * A server action is a public endpoint. Every one of these re-reads the viewer
 * and re-checks ownership through verificationState, which goes through
 * getProject — the projectId in the payload is a claim until the query agrees
 * with it.
 */

/** Mint a token for a project that predates them. New projects arrive with one. */
export async function startVerificationAction(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  const viewer = await getViewer()
  if (viewer.kind !== 'user') return { error: 'Sign in to verify a domain.' }

  const projectId = String(formData.get('projectId') ?? '')
  const token = await ensureVerificationToken(projectId, viewer)
  if (!token) return { error: 'Could not start verification for this project.' }

  revalidatePath(`/projects/${projectId}/verify`)
  return {}
}

/**
 * The only path that can set verifiedDomain.
 *
 * The DNS lookup happens HERE and its result decides everything;
 * markDomainVerified does no checking of its own. Nothing the browser sends is
 * consulted beyond which project is being asked about.
 */
export async function confirmVerificationAction(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  const viewer = await getViewer()
  if (viewer.kind !== 'user') return { error: 'Sign in to verify a domain.' }

  const projectId = String(formData.get('projectId') ?? '')
  const state = await verificationState(projectId, viewer)
  if (!state) return { error: 'Could not find that project.' }
  if (!state.token) return { error: 'This project has no verification record yet.' }

  const outcome = await checkDnsProof(state.host, state.token)
  if (!outcome.ok) return { error: outcome.reason, found: [...outcome.found] }

  await markDomainVerified(projectId, viewer)
  revalidatePath(`/projects/${projectId}/verify`)
  revalidatePath(`/projects/${projectId}`)
  return { ok: true }
}

export async function revokeVerificationAction(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  const viewer = await getViewer()
  if (viewer.kind !== 'user') return { error: 'Sign in to change this.' }

  const projectId = String(formData.get('projectId') ?? '')
  if (!(await revokeDomainVerification(projectId, viewer))) {
    return { error: 'Could not find that project.' }
  }

  revalidatePath(`/projects/${projectId}/verify`)
  revalidatePath(`/projects/${projectId}`)
  return {}
}
