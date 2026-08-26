/**
 * Current plan, usage against it, and a way out.
 *
 * Deliberately thin. Everything a customer might want to change — card,
 * cancellation, invoices, tax details — lives in Stripe's portal, which handles
 * dunning and receipts correctly and is not a differentiator worth rebuilding.
 */

import Link from 'next/link'
import { getSubscription } from '@darvin/db'
import { requireUser } from '@/lib/authz.ts'
import { planFor } from '@/lib/plans.ts'
import { serverEnv } from '@/lib/env.ts'
import { BillingButton } from '@/components/billing/billing-button.tsx'

export const metadata = { title: 'Billing' }

function stamp(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export default async function BillingPage() {
  const user = await requireUser('/settings/billing')
  const subscription = await getSubscription(user.id)
  const plan = planFor(subscription?.plan)

  // Stripe's vocabulary is wider than active/cancelled — past_due and
  // incomplete both mean "paid plan, something needs attention", and hiding
  // that behind a green tick is how a customer finds out by losing access.
  const needsAttention =
    subscription && !['active', 'trialing', 'canceled'].includes(subscription.status)

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Billing</h1>

      <section className="mt-8 rounded-lg border border-line p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="text-sm text-muted">Current plan</p>
            <p className="text-xl font-semibold">{plan.name}</p>
          </div>
          {plan.priceMonthlyUsd > 0 && (
            <p className="text-sm text-muted tabular-nums">${plan.priceMonthlyUsd} / month</p>
          )}
        </div>

        {needsAttention && (
          <p className="mt-4 rounded-md border border-line bg-surface px-3 py-2 text-sm">
            Stripe reports this subscription as <span className="font-mono">{subscription.status}</span>.
            Open the billing portal to resolve it before access changes.
          </p>
        )}

        {subscription?.periodEnd && (
          <p className="mt-3 text-sm text-muted">
            {subscription.status === 'canceled' ? 'Access ends' : 'Renews'} on{' '}
            {stamp(subscription.periodEnd)}.
          </p>
        )}

        <dl className="mt-6 grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-muted">Scans a month</dt>
          <dd className="tabular-nums">{plan.scansPerMonth}</dd>
          <dt className="text-muted">Projects</dt>
          <dd className="tabular-nums">{plan.projects}</dd>
          <dt className="text-muted">Full findings</dt>
          <dd>{plan.fullFindings ? 'Yes' : `The ${plan.findingsShownInFull} worst`}</dd>
          <dt className="text-muted">Fix prompt</dt>
          <dd>{plan.fixPrompts ? 'Yes' : 'Per finding only'}</dd>
        </dl>

        <div className="mt-6 flex flex-wrap gap-3">
          {plan.id === 'free' ? (
            <BillingButton endpoint="/api/billing/checkout" label="Upgrade to Pro" />
          ) : (
            <BillingButton endpoint="/api/billing/portal" label="Manage billing" variant="secondary" />
          )}
          <Link href="/pricing" className="self-center text-sm text-accent">
            Compare plans
          </Link>
        </div>

        {!serverEnv.billingConfigured && (
          <p className="mt-4 text-sm text-muted">
            Billing is not configured on this deployment, so upgrading is unavailable.
          </p>
        )}
      </section>
    </div>
  )
}
