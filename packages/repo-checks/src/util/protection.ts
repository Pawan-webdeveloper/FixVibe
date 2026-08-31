/**
 * Narrow typed reads over the open-shape branch-protection payload.
 *
 * GitHub's protection payload is large, nested and versioned, and the checks
 * read five fields off it. A full typed mirror would drift with every API
 * change; instead each read is a guarded descent that returns null when the
 * shape is not what it expected — and a null here is the finding ("no required
 * reviews configured"), never an error. The open Record<string, unknown> shape
 * is what keeps this stable while GitHub adds keys we never look at.
 */

import type { BranchProtection } from '../types.ts'

/** null protection IS the finding for ci-cd.no-branch-protection. */
export function isProtected(p: BranchProtection): p is Record<string, unknown> {
  return p !== null && typeof p === 'object'
}

export function hasRequiredStatusChecks(p: BranchProtection): boolean {
  if (!isProtected(p)) return false
  const rsc = p['required_status_checks']
  if (!rsc || typeof rsc !== 'object') return false
  const contexts = (rsc as Record<string, unknown>)['contexts']
  return Array.isArray(contexts) && contexts.length > 0
}

export function hasRequiredReviews(p: BranchProtection): boolean {
  if (!isProtected(p)) return false
  const reviews = p['required_pull_request_reviews']
  if (!reviews || typeof reviews !== 'object') return false
  const count = (reviews as Record<string, unknown>)['required_approving_review_count']
  return typeof count === 'number' && count > 0
}

export function forcePushesAllowed(p: BranchProtection): boolean {
  if (!isProtected(p)) return false
  const allow = p['allow_force_pushes']
  if (!allow || typeof allow !== 'object') return false
  return (allow as Record<string, unknown>)['enabled'] === true
}
