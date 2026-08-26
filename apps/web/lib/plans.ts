/**
 * Every tier, in one table.
 *
 * Nothing else in the codebase decides what a plan includes. A limit enforced
 * in one file and advertised from another is how a pricing page ends up
 * promising something the code refuses to do — which arrives as a refund
 * request rather than a bug report.
 *
 * The free tier is deliberately generous about the SCAN and strict about the
 * REPORT. A free report has to be genuinely useful or nobody shares it, and
 * visibly incomplete or nobody upgrades. Showing every finding's severity and
 * title, and the three worst in full, does both: the reader knows exactly what
 * they are missing rather than being shown a blurred rectangle and asked to
 * guess.
 */

export type PlanId = 'free' | 'pro'

export interface Plan {
  id: PlanId
  name: string
  /**
   * DISPLAY ONLY. The amount actually charged is the one on the Razorpay Plan
   * named by `planIdEnv`, and this must be kept equal to it by hand — a
   * pricing page that disagrees with the checkout modal is a refund request,
   * not a bug report.
   */
  priceMonthly: number
  /** ISO 4217. Razorpay accounts are INR unless international payments are enabled. */
  currency: 'INR' | 'USD'
  /** null on free: nobody reaches the payment processor until they choose to. */
  planIdEnv: string | null

  scansPerMonth: number
  projects: number
  monitors: number

  /** Every finding in full, rather than the worst few. */
  fullFindings: boolean
  /** The aggregate fix prompt — the reason to pay. */
  fixPrompts: boolean
  history: boolean
  exports: boolean
  apiAccess: boolean

  /**
   * How many findings a plan without `fullFindings` sees in full. They are the
   * worst ones: the engine sorts worst-first, so a free reader always gets the
   * findings that matter most rather than whichever happened to be cheap.
   */
  findingsShownInFull: number
}

export const PLANS: Readonly<Record<PlanId, Plan>> = {
  free: {
    id: 'free',
    name: 'Free',
    priceMonthly: 0,
    currency: 'INR',
    planIdEnv: null,
    scansPerMonth: 30,
    projects: 1,
    monitors: 0,
    fullFindings: false,
    fixPrompts: false,
    history: false,
    exports: false,
    apiAccess: false,
    findingsShownInFull: 3,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceMonthly: 1499,
    currency: 'INR',
    planIdEnv: 'RAZORPAY_PLAN_PRO_MONTHLY',
    scansPerMonth: 500,
    projects: 25,
    monitors: 25,
    fullFindings: true,
    fixPrompts: true,
    history: true,
    exports: true,
    apiAccess: true,
    findingsShownInFull: Number.POSITIVE_INFINITY,
  },
}

/**
 * `subscriptions.plan` is free text — a processor's vocabulary changes and an
 * enum there would mean a migration every time pricing does. So an unrecognised
 * value resolves to free rather than throwing: a billing record we cannot read
 * must not take the product away from someone mid-session.
 */
export function planFor(plan: string | null | undefined): Plan {
  return plan === 'pro' ? PLANS.pro : PLANS.free
}

export const ORDERED_PLANS: readonly Plan[] = [PLANS.free, PLANS.pro]

/** "₹1,499" / "$19" — grouped, and never showing a trailing ".00". */
export function formatPrice(plan: Plan): string {
  return new Intl.NumberFormat(plan.currency === 'INR' ? 'en-IN' : 'en-US', {
    style: 'currency',
    currency: plan.currency,
    maximumFractionDigits: 0,
  }).format(plan.priceMonthly)
}
