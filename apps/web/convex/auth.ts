/**
 * Three ways in, none of them a password.
 *
 *   Google, GitHub — one click, and no credential of ours to store or leak.
 *   A six-digit code — for everyone whose email is not at either.
 *
 * There is no password field anywhere in this product, which removes an entire
 * category of breach: no hashing to get wrong, no reset flow to phish, and
 * nothing in a database dump that is worth cracking.
 *
 * Each provider's secret comes from this deployment's own environment, set with
 * `npx convex env set`, NOT from the Next.js .env. Convex functions run on
 * Convex, so a secret in the app's .env is a secret this file cannot read.
 */

import GitHub from '@auth/core/providers/github'
import Google from '@auth/core/providers/google'
import { convexAuth } from '@convex-dev/auth/server'
import { ResendOTP } from './ResendOTP.ts'

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Google, GitHub, ResendOTP],
})
