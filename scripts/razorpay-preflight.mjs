/**
 * Razorpay preflight: what works, what does not, and fix what can be fixed.
 *
 *   pnpm razorpay:check
 *
 * Written because "Unauthorized" from Razorpay means two completely different
 * things and the message does not say which. Bad credentials return exactly
 * the same body as good credentials against a product the account has not
 * enabled — which cost us two pointless key regenerations before someone
 * thought to try a second endpoint.
 *
 * So this probes several products and reports them separately. If /payments
 * answers 200 and /subscriptions answers 401, the keys are fine and the
 * SUBSCRIPTIONS PRODUCT is not enabled on the account, which is a dashboard
 * and activation matter rather than anything in this repository.
 *
 * Safe to run repeatedly. It only writes what is missing: the Pro plan is
 * reused when one already matches, since Razorpay plans cannot be deleted, and
 * an existing webhook secret is never replaced.
 *
 * Secrets are never printed. Values go straight into .env and only a short
 * hash appears on screen, so a terminal recording or a pasted log does not
 * become a credential leak.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'

const ENV_PATH = new URL('../.env', import.meta.url).pathname

/** Must equal `priceMonthly` in apps/web/lib/plans.ts, in the smallest unit. */
const AMOUNT_PAISE = 1499 * 100
const CURRENCY = 'INR'
const PLAN_NAME = 'ScanlyFix Pro'

const raw = readFileSync(ENV_PATH, 'utf8')
const env = Object.fromEntries(
  raw
    .split('\n')
    .filter((line) => line.includes('=') && !line.trimStart().startsWith('#'))
    .map((line) => [
      line.slice(0, line.indexOf('=')).trim(),
      line
        .slice(line.indexOf('=') + 1)
        .trim()
        .replace(/^["']|["']$/g, ''),
    ]),
)

const fingerprint = (value) => (value ? createHash('sha256').update(value).digest('hex').slice(0, 8) : 'unset')

const keyId = env.RAZORPAY_KEY_ID ?? ''
const keySecret = env.RAZORPAY_KEY_SECRET ?? ''
if (!keyId || !keySecret) {
  console.error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set in .env first.')
  process.exit(1)
}

const authorization = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`
const mode = keyId.startsWith('rzp_live_') ? 'LIVE' : keyId.startsWith('rzp_test_') ? 'test' : 'unrecognised'

async function api(path, init) {
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: { authorization, 'content-type': 'application/json', accept: 'application/json' },
  })
  const body = await response.text()
  return { status: response.status, ok: response.ok, body }
}

console.log(`mode: ${mode}   key: ${fingerprint(keyId)}   secret: ${fingerprint(keySecret)}\n`)

// Two groups on purpose. The first tells us whether the credentials work at
// all; the second whether Subscriptions is provisioned. Only comparing them
// distinguishes the two causes of a 401.
const CORE = ['/payments?count=1', '/orders?count=1', '/customers?count=1']
const SUBSCRIPTIONS = ['/plans?count=1', '/subscriptions?count=1']

const results = {}
for (const path of [...CORE, ...SUBSCRIPTIONS]) {
  const { status } = await api(path)
  results[path] = status
  console.log(`  ${status === 200 ? '✓' : '✗'} ${String(status).padEnd(4)} ${path}`)
}

const coreOk = CORE.every((path) => results[path] === 200)
const subscriptionsOk = SUBSCRIPTIONS.every((path) => results[path] === 200)

if (!coreOk) {
  console.error(
    '\n✗ The credentials themselves are rejected.\n' +
      '  Regenerate the key pair in the Razorpay dashboard (Account & Settings →\n' +
      '  Website and app settings → API Keys) and copy BOTH values from the\n' +
      '  "Download Key Details" file — the secret is shown only once, so taking\n' +
      '  the id off the page and the secret from an older download gives a pair\n' +
      '  that looks right and authenticates as nothing.',
  )
  process.exit(1)
}

console.log('\n✓ Credentials are valid — core payment APIs answer.')

if (!subscriptionsOk) {
  console.error(
    '\n✗ Subscriptions is not enabled on this account.\n' +
      '  The keys are fine; this product is provisioned separately and usually\n' +
      '  needs the account activated first. Nothing in this repository can fix\n' +
      '  it: enable Subscriptions in the dashboard, or ask Razorpay support to.\n' +
      '  Re-run this script afterwards and it will create the plan.',
  )
  process.exit(2)
}

// ---------------------------------------------------------------------------
// Subscriptions is available, so finish the setup.
// ---------------------------------------------------------------------------

/** Rewrites KEY=value in place, appending when the key is absent. */
function withEnv(contents, key, value) {
  const pattern = new RegExp(`^${key}=.*$`, 'm')
  const line = `${key}=${value}`
  return pattern.test(contents) ? contents.replace(pattern, line) : `${contents.replace(/\n*$/, '\n')}${line}\n`
}

const listed = await api('/plans?count=100')
const plans = JSON.parse(listed.body).items ?? []
let plan = plans.find(
  (candidate) =>
    candidate.period === 'monthly' &&
    candidate.interval === 1 &&
    candidate.item?.amount === AMOUNT_PAISE &&
    candidate.item?.currency === CURRENCY,
)

if (plan) {
  console.log(`\n✓ Reusing plan ${plan.id} (Razorpay plans cannot be deleted, so no duplicate is made)`)
} else {
  const created = await api('/plans', {
    method: 'POST',
    body: JSON.stringify({
      period: 'monthly',
      interval: 1,
      item: { name: PLAN_NAME, amount: AMOUNT_PAISE, currency: CURRENCY, description: `${PLAN_NAME} — monthly` },
    }),
  })
  if (!created.ok) {
    console.error('\n✗ Could not create the plan:', created.status, created.body.slice(0, 300))
    process.exit(1)
  }
  plan = JSON.parse(created.body)
  console.log(`\n✓ Created plan ${plan.id} — ${AMOUNT_PAISE / 100} ${CURRENCY} / month`)
}

let contents = withEnv(raw, 'RAZORPAY_PLAN_PRO_MONTHLY', plan.id)

if (env.RAZORPAY_WEBHOOK_SECRET) {
  console.log(`✓ Webhook secret already set (${fingerprint(env.RAZORPAY_WEBHOOK_SECRET)}) — left alone`)
} else {
  const secret = randomBytes(32).toString('hex')
  contents = withEnv(contents, 'RAZORPAY_WEBHOOK_SECRET', secret)
  console.log(`✓ Generated a webhook secret (${fingerprint(secret)}) — written to .env, not printed`)
}

writeFileSync(ENV_PATH, contents)

console.log(
  `\n.env updated. RAZORPAY_PLAN_PRO_MONTHLY=${plan.id}\n\n` +
    'Remaining, in the Razorpay dashboard:\n' +
    '  Account & Settings → Webhooks → Add New Webhook\n' +
    '    URL     <public https url>/api/webhooks/razorpay\n' +
    '    Secret  the RAZORPAY_WEBHOOK_SECRET now in .env\n' +
    '    Events  every subscription.* event\n' +
    "  Razorpay cannot reach localhost, so a tunnel is needed in development\n" +
    '  (e.g. `cloudflared tunnel --url http://localhost:3000`).',
)
