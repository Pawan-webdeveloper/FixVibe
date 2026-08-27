import type { Metadata } from 'next'
import Link from 'next/link'
import { Clause, LegalPage } from '@/components/marketing/legal-page.tsx'
import { legal, operator } from '@/lib/legal.ts'

export const metadata: Metadata = {
  title: 'Terms',
  description:
    'The rules for using Darvin: what you may scan, what the findings are worth, and how billing works.',
}

/**
 * The clause that actually matters here is section 2.
 *
 * This product points a scanner at whatever URL it is given. Read-only or not,
 * the person typing the URL has to be entitled to do it, and saying so plainly
 * — rather than burying it — is what separates a security tool from a service
 * that helps somebody probe a stranger's site.
 */
export default function TermsPage() {
  return (
    <LegalPage
      label="Terms"
      title="The agreement for using Darvin"
      effective={legal.effective}
      intro={`Short, because the service is narrow: you give ${legal.service} a URL and it reports
        what a browser can already see. These are the rules that go with that.`}
    >
      <Clause index={1} heading="What this service does">
        <p>
          You submit a URL. {legal.service} fetches it the way a browser would, runs a fixed set of
          read-only checks across security, SEO, AI answer engines, performance, accessibility and
          compliance, and reports what it found along with a suggested fix.
        </p>
        <p>
          It never signs in, never submits a form, never modifies anything, and never attempts to
          exploit what it finds. It is a reader, not a penetration test.
        </p>
      </Clause>

      <Clause index={2} heading="What you may scan">
        <p>
          <strong className="font-semibold">
            Only sites you own, or have the owner&rsquo;s permission to scan.
          </strong>{' '}
          Scanning is a request to somebody else&rsquo;s server, and whether you were entitled to
          make it is your responsibility, not ours.
        </p>
        <p>
          You may not use this service to probe infrastructure you have no relationship with, to
          scan at a volume intended to burden a target, or to work around a rate limit — ours or
          anybody else&rsquo;s. Accounts doing any of this are closed without refund.
        </p>
      </Clause>

      <Clause index={3} heading="What a report is worth">
        <p>
          A finding is an observation, not a certification. The checks are real and the evidence is
          shown so you can verify each one yourself — but no scanner sees everything, and a clean
          report is not a statement that a site is secure, compliant or accessible.
        </p>
        <p>
          Fix prompts are suggestions written for an AI coding agent. Read what they propose before
          you apply it. You remain responsible for every change you make to your own systems.
        </p>
      </Clause>

      <Clause index={4} heading="Your account">
        <p>
          One person, one account. Keep your sign-in address and your API keys to yourself — an API
          key acts with your account&rsquo;s full permissions, and anything done with it counts as
          done by you. If a key is exposed, revoke it in settings; revocation takes effect
          immediately.
        </p>
      </Clause>

      <Clause index={5} heading="Limits">
        <p>
          Each plan carries a monthly scan allowance and a rate limit. The rate limit exists to
          protect the sites being scanned rather than us, so it applies to every account including
          paid ones. The current allowances are on the{' '}
          <Link href="/pricing" className="link">
            pricing page
          </Link>
          .
        </p>
      </Clause>

      <Clause index={6} heading="Payment">
        <p>
          Paid plans are billed monthly in advance through Razorpay. The price charged is the one
          shown at checkout.
        </p>
        <p>
          You can cancel at any time from settings. Cancelling stops the next renewal and leaves
          your plan active until the end of the period you have already paid for. We do not
          pro-rate part-months.
        </p>
        <p>
          If a charge is wrong, write to{' '}
          <a className="link" href={`mailto:${legal.contactEmail}`}>{legal.contactEmail}</a> within
          30 days and we will put it right.
        </p>
      </Clause>

      <Clause index={7} heading="Availability">
        <p>
          This service is provided as it is, with no guarantee of uptime. Scans depend on the target
          site responding, and on services we do not control; a scan can fail for reasons that have
          nothing to do with either of us.
        </p>
        <p>
          We may change or withdraw features. If a change removes something a paid plan was sold
          on, account holders are told by email first.
        </p>
      </Clause>

      <Clause index={8} heading="Liability">
        <p>
          To the extent the law allows, our total liability for any claim arising from this service
          is limited to what you paid us in the three months before it arose. We are not liable for
          lost profit, lost data, or any indirect loss.
        </p>
        <p>
          Nothing here limits liability for fraud, or for anything else that cannot lawfully be
          limited.
        </p>
      </Clause>

      <Clause index={9} heading="Ending it">
        <p>
          You can stop using the service and ask for your data to be deleted at any time — see the{' '}
          <Link href="/privacy" className="link">
            privacy page
          </Link>
          . We may close an account that breaks section 2, with notice unless the breach is causing
          harm to someone else.
        </p>
      </Clause>

      <Clause index={10} heading="Governing law">
        <p>
          These terms are governed by the laws of {legal.jurisdiction}, and disputes are subject to
          the courts of {legal.jurisdiction}.
        </p>
        <p>
          {legal.service} is operated by {operator()}. Questions about this page go to{' '}
          <a className="link" href={`mailto:${legal.contactEmail}`}>{legal.contactEmail}</a>.
        </p>
      </Clause>
    </LegalPage>
  )
}
