/**
 * Firebase security rules — is the Realtime Database or Storage bucket behind
 * this site readable by the whole internet?
 *
 * Firebase's web config, `apiKey` included, is meant to be public: it
 * identifies the project, it is not a credential, and Google documents it as
 * safe to ship. What protects the data is the project's security rules. The
 * classic Firebase breach is `{".read": true}` — left over from the tutorial,
 * or from the "test mode" the console offers when a database is created, which
 * grants world read access and prints a warning nobody reads.
 *
 * That question cannot be answered from the page, so this check runs ONLY when
 * `ctx.activeProbe` exists — which the context provides only for a domain the
 * requester has proved they control.
 *
 * ## What it asks, and what it refuses to
 *
 * Realtime Database is queried with `.json?shallow=true`, which returns the
 * top-level keys with their values replaced by `true`. It answers "can anyone
 * read this?" while transferring no records. Storage is queried with a
 * one-item object listing.
 *
 * Nothing is ever written. A write probe would be the only way to test
 * `.write` rules, and creating a node in someone's production database to
 * prove a point is not something a scanner gets to do, authorised or not. An
 * open `.write` rule therefore goes unreported here — a real gap, and the
 * right trade.
 *
 * Firestore is not tested either, for a duller reason: its REST API needs a
 * collection name and offers no way to list collections without credentials.
 * Guessing names would turn this check into a dictionary attack on the
 * customer's own database.
 */

import type { Check, CheckContext, Finding } from '../../types.ts'
import { collect, sources } from './sources.ts'

const ID = 'security.backend.firebase-rules'

/** Legacy `<project>.firebaseio.com` and regional `<project>.<region>.firebasedatabase.app`. */
const RTDB_URL = /(https?:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)?\.(?:firebaseio\.com|firebasedatabase\.app))/g
/** `storageBucket: "<project>.appspot.com"` / `.firebasestorage.app`. */
const BUCKET = /["']([a-z0-9][a-z0-9._-]*\.(?:appspot\.com|firebasestorage\.app))["']/g

/** Keys shown as evidence. Structure, not records — and capped so a report stays readable. */
const MAX_KEYS_SHOWN = 8

export const firebaseRulesCheck: Check = {
  id: ID,
  category: 'security',
  title: 'Firebase security rules',

  async run(ctx) {
    // The gate: no proof of ownership, no capability, no probe.
    const activeProbe = ctx.activeProbe
    if (!activeProbe) return []

    const texts = sources(ctx)
    const [database] = collect(texts, RTDB_URL)
    const [bucket] = collect(texts, BUCKET)
    if (!database && !bucket) return []

    const [databaseFinding, bucketFinding] = await Promise.all([
      database ? checkDatabase(ctx, activeProbe, database) : Promise.resolve(null),
      bucket ? checkBucket(ctx, activeProbe, bucket) : Promise.resolve(null),
    ])

    return [databaseFinding, bucketFinding].filter((finding): finding is Finding => finding !== null)
  },
}

async function checkDatabase(
  ctx: CheckContext,
  activeProbe: NonNullable<CheckContext['activeProbe']>,
  database: string,
): Promise<Finding | null> {
  const url = `${database.replace(/\/$/, '')}/.json?shallow=true`
  const response = await activeProbe(url)
  // 401 is the healthy answer: the rules denied an unauthenticated read.
  if (!response || response.status !== 200) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(response.body)
  } catch {
    return null
  }
  // `null` is an empty database. Readable, but there is nothing to disclose,
  // and calling that a breach would fire on every freshly created project.
  if (parsed === null || typeof parsed !== 'object') return null

  const keys = Object.keys(parsed as Record<string, unknown>)
  if (keys.length === 0) return null

  return {
    checkId: ID,
    category: 'security',
    severity: 'critical',
    title: `Firebase Realtime Database is readable by anyone (${keys.length} top-level node(s))`,
    description:
      `An unauthenticated request to ${database} returned the database's contents. The security ` +
      'rules allow public reads, so anyone who views this page\'s source can find the database URL ' +
      'and download everything in it — no account, no key, no exploit. This is almost always a ' +
      '"test mode" rule (`{".read": true}`) that was never replaced before launch. Note that only ' +
      'reads were tested: if the rules also allow writes, the data can be altered or deleted too.',
    // Node names only, capped. Structure is enough to prove the finding.
    evidence: {
      database,
      topLevelNodes: keys.slice(0, MAX_KEYS_SHOWN),
      ...(keys.length > MAX_KEYS_SHOWN ? { additionalNodes: keys.length - MAX_KEYS_SHOWN } : {}),
    },
    remediation:
      'Replace the public read rule with rules that grant access per path and per authenticated ' +
      'user, then check the database logs for what has already been read.',
    fixPrompt:
      `The Firebase Realtime Database at ${database}, used by ${ctx.finalUrl.origin}, returns its ` +
      'contents to an unauthenticated request. The security rules allow public reads.\n\n' +
      'Fix this in the rules file in this repository (usually `database.rules.json`, referenced from ' +
      '`firebase.json`), not in application code. Replace any `{".read": true}` with rules scoped to ' +
      'the signed-in user, for example:\n\n' +
      '  {\n' +
      '    "rules": {\n' +
      '      "users": {\n' +
      '        "$uid": {\n' +
      '          ".read": "auth != null && auth.uid === $uid",\n' +
      '          ".write": "auth != null && auth.uid === $uid"\n' +
      '        }\n' +
      '      }\n' +
      '    }\n' +
      '  }\n\n' +
      'Write a rule for every top-level node the app uses — a node with no matching rule is denied, ' +
      'so read the client code first and make sure each path it touches is covered. Deploy with ' +
      '`firebase deploy --only database`, then verify an unauthenticated read is refused.\n\n' +
      'Because the data was publicly readable, also treat it as disclosed: review what is in there ' +
      'and follow whatever notification obligations apply.',
  }
}

async function checkBucket(
  ctx: CheckContext,
  activeProbe: NonNullable<CheckContext['activeProbe']>,
  bucket: string,
): Promise<Finding | null> {
  const url = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o?maxResults=1`
  const response = await activeProbe(url)
  if (!response || response.status !== 200) return null

  let parsed: { items?: unknown[] } | null
  try {
    parsed = JSON.parse(response.body) as { items?: unknown[] }
  } catch {
    return null
  }
  // A 200 with no items is an empty bucket: readable, nothing disclosed.
  if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) return null

  return {
    checkId: ID,
    category: 'security',
    severity: 'high',
    title: 'Firebase Storage bucket is listable by anyone',
    description:
      `An unauthenticated request listed objects in the storage bucket ${bucket}. Anyone can ` +
      'enumerate every file in it, which turns an unguessable download URL into a browsable index — ' +
      'uploaded documents, user avatars, anything the app has ever stored. As with the database, ' +
      'this is the default "test mode" rule left in place.',
    evidence: { bucket, listable: true },
    remediation:
      'Restrict list and read access in the Storage rules to the authenticated owner of each path, ' +
      'keeping only genuinely public prefixes open.',
    fixPrompt:
      `The Firebase Storage bucket "${bucket}", used by ${ctx.finalUrl.origin}, lets an ` +
      'unauthenticated caller list its objects.\n\n' +
      'Fix this in the Storage rules file in this repository (usually `storage.rules`, referenced ' +
      'from `firebase.json`). Replace any `allow read: if true;` with per-user rules, for example:\n\n' +
      '  rules_version = "2";\n' +
      '  service firebase.storage {\n' +
      '    match /b/{bucket}/o {\n' +
      '      match /users/{userId}/{allPaths=**} {\n' +
      '        allow read, write: if request.auth != null && request.auth.uid == userId;\n' +
      '      }\n' +
      '    }\n' +
      '  }\n\n' +
      'Keep a narrow public prefix (e.g. `/public/{allPaths=**}` with `allow read: if true;`) if the ' +
      'app serves public assets from this bucket — check the client code before locking a path the ' +
      'site depends on. Deploy with `firebase deploy --only storage` and confirm the listing is ' +
      'refused afterwards.',
  }
}
