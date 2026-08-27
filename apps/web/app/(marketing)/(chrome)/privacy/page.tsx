import type { Metadata } from 'next'
import { Clause, FactTable, LegalPage } from '@/components/marketing/legal-page.tsx'
import { legal, operator } from '@/lib/legal.ts'

export const metadata: Metadata = {
  title: 'Privacy',
  description:
    'What ScanlyFix stores, what it does not, who else sees it, and how to have it deleted.',
}

/**
 * Written against the schema rather than from a template.
 *
 * Every row below names a column that exists in packages/db/src/schema.ts. A
 * policy that claims less than the database holds is a lie; one that claims
 * more invites questions with no answer. Both are worse than the short, true
 * list — which in this product's case is genuinely short, because it collects
 * almost nothing about people and a great deal about websites.
 */
export default function PrivacyPage() {
  return (
    <LegalPage
      label="Privacy"
      title="What we store, and what we do not"
      effective={legal.effective}
      intro={`${legal.service} is a website scanner. Almost everything it records is about a
        website; very little of it is about a person. This page lists both, names every other
        company that receives any of it, and says how to have yours removed.`}
    >
      <Clause index={1} heading="What we hold about you">
        <p>
          If you have an account, that is an email address and the categories of check you said
          you cared about. Nothing else.
        </p>

        <FactTable
          caption="Your account record, in full"
          rows={[
            ['email', 'Your address. Used to identify the account and to send alerts you turn on.'],
            [
              'auth_subject',
              'An opaque identifier from Google, GitHub or the email-code flow. It is how we recognise you on your next sign-in.',
            ],
            [
              'priorities',
              'The pillars you chose after signing up, so a report leads with what you asked for.',
            ],
            ['created_at', 'When the account was opened.'],
          ]}
        />

        <p>
          There is no password field anywhere in this product, so there is no password of yours to
          store, leak or reset. We do not ask for your name, your company, your phone number, or
          your address, and we do not collect them from anywhere else.
        </p>
      </Clause>

      <Clause index={2} heading="What we hold about the sites you scan">
        <p>
          The URL, the host, the scores, and each finding — its title, the evidence observed, the
          remediation and the suggested fix prompt. Also when the scan ran, how long it took, and
          which version of the engine produced it, so an old report stays reproducible.
        </p>
        <p>
          The evidence is what a browser could already see: response headers, HTML, and what a page
          renders. {legal.service} never signs in, never submits a form, and never attempts anything
          a site owner has not already made public.
        </p>
      </Clause>

      <Clause index={3} heading="Scanning without an account">
        <p>
          You can scan without signing in. Those scans are stored too, and to make rate limiting
          possible we keep a <span className="font-mono text-xs">salted SHA-256 hash</span> of the
          visitor&rsquo;s IP address — not the address itself.
        </p>
        <p>
          The salt is what makes that meaningful. There are only about four billion IPv4 addresses,
          so an unsalted hash of one is reversed by brute force in minutes; with a secret salt it is
          not. We cannot recover an address from what we store, which also means we cannot connect
          an anonymous scan back to you on request.
        </p>
      </Clause>

      <Clause index={4} heading="Payment details">
        <p>
          We never see your card. Razorpay collects and holds payment details; what reaches us is
          the state of your subscription — its plan, its status, and when the current period ends.
        </p>
      </Clause>

      <Clause index={5} heading="API keys">
        <p>
          An API key is shown once, at creation, and is never stored. What we keep is a SHA-256 hash
          of it plus its first few characters, so you can tell your keys apart in a list. A copy of
          our database does not contain a usable key.
        </p>
      </Clause>

      <Clause index={6} heading="Who else receives any of this">
        <p>
          These are the only companies involved, and each receives only what its job needs.
        </p>

        <FactTable
          caption="Processors"
          rows={[
            ['Convex', 'Proves who you are at sign-in. Receives your email address.'],
            ['Supabase (PostgreSQL)', 'Stores everything described above.'],
            ['Razorpay', 'Takes payment. Receives your billing details directly from you.'],
            ['Resend', 'Delivers sign-in codes and the alerts you enable. Receives your address.'],
            ['Inngest', 'Runs scans and monitors on a queue. Receives scan identifiers.'],
            [
              'Google PageSpeed Insights',
              'Used only by deep scans, and only when configured. Receives the URL being scanned — never anything about you.',
            ],
          ]}
        />

        <p>
          We do not sell anything to anyone, and there is no advertising network, analytics script
          or third-party tracker on this site. The typeface is served from our own domain rather
          than Google&rsquo;s, because a page that phones a third party before you consent is
          something this product&rsquo;s own compliance checks would flag.
        </p>
      </Clause>

      <Clause index={7} heading="How long it is kept">
        <p>
          Account data lasts as long as the account. Scans and their findings are kept so your
          history stays comparable over time — that comparison is most of what a paid plan is for.
          Deleting a project deletes its scans, findings, monitors and alerts with it.
        </p>
      </Clause>

      <Clause index={8} heading="Deleting your data">
        <p>
          Email <a className="link" href={`mailto:${legal.contactEmail}`}>{legal.contactEmail}</a>{' '}
          from the address on the account and we will delete it, and everything attached to it,
          within 30 days. You can also ask for a copy of what we hold.
        </p>
        <p>
          Anonymous scans are the one exception, for the reason given in section 3: there is nothing
          in them that identifies you, and no way for us to find them on your behalf.
        </p>
      </Clause>

      <Clause index={9} heading="Cookies">
        <p>
          One, and only when you sign in: the session cookie that keeps you signed in. There is no
          cookie banner because there is nothing to consent to — no advertising, analytics or
          tracking cookie is set at any point.
        </p>
      </Clause>

      <Clause index={10} heading="Changes, and how to reach us">
        <p>
          If this policy changes in a way that affects what we collect or who receives it, the date
          at the top changes and account holders are told by email before it takes effect.
        </p>
        <p>
          {legal.service} is operated by {operator()}. Write to{' '}
          <a className="link" href={`mailto:${legal.contactEmail}`}>{legal.contactEmail}</a> with any
          question about this page.
        </p>
      </Clause>
    </LegalPage>
  )
}
