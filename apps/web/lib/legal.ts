/**
 * The facts the Privacy and Terms pages state about who is behind this service.
 *
 * In one place because both pages repeat them and because a payment processor's
 * KYC review checks that the name and contact on the site match the registered
 * account. Two pages disagreeing about that is how a review fails.
 *
 * `entity` is the REGISTERED name, which is not necessarily the product name.
 * Until it is set, both pages say the service is operated by an individual —
 * which is the truth for a sole proprietor and is what a reviewer expects to
 * read, rather than a company that does not exist.
 */
export const legal = {
  /** The product, as the reader knows it. */
  service: 'Darvin',

  /** Where privacy requests, disputes and support all land. */
  contactEmail: 'scanlyfix@gmail.com',

  /**
   * The registered business name, once there is one. Razorpay's review expects
   * the name on these pages to match the name on the account.
   */
  entity: null as string | null,

  /** Governs the Terms, and is where a dispute would be heard. */
  jurisdiction: 'India',

  /**
   * Printed on both pages. A policy with no date cannot be shown to have been
   * in force when something happened, which is most of the point of having one.
   */
  effective: '28 August 2026',
} as const

/** How the pages refer to whoever is on the other side of the agreement. */
export function operator(): string {
  return legal.entity ?? `the individual operating ${legal.service}`
}
