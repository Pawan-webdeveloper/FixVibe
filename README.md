# ScanlyFix

ScanlyFix is an application scanner — paste a URL, get 100+ read-only checks across security, SEO, AEO, performance, accessibility, and compliance, each with severity, evidence, remediation, and a copy-paste fix prompt.

Monorepo (Turborepo + pnpm, Node ≥22).

## Quick Start

```sh
pnpm install
pnpm scan https://example.com          # human-readable report
pnpm scan example.com --json           # machine-readable output
```

## Development

```sh
pnpm typecheck                          # strict tsc across packages
pnpm test                               # network-free unit tests (vitest)
cd packages/checks && SCANLYFIX_LIVE=1 pnpm test   # + live end-to-end smoke
```

### Web App

```sh
cd apps/web
pnpm dev                                # Next.js dev server
pnpm build                              # production build
pnpm test                               # vitest tests
```

## Project Structure

```
FixVibe/
├── .env
├── .env.example
├── .gitignore
├── DEPLOY.md
├── README.md
├── SUPABASE_SETUP.md
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── turbo.json
│
├── .github/
│   └── workflows/
│       └── ci.yml
│
├── scripts/
│   └── razorpay-preflight.mjs
│
├── apps/
│   ├── cli/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       └── index.ts
│   │
│   ├── scanner/
│   │   ├── Dockerfile
│   │   ├── .dockerignore
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   ├── src/
│   │   │   ├── browser.ts
│   │   │   ├── guard.ts
│   │   │   ├── index.ts
│   │   │   └── jobs/
│   │   │       ├── axe-audit.ts
│   │   │       ├── pdf.ts
│   │   │       ├── rendered-content.ts
│   │   │       └── screenshot.ts
│   │   └── test/
│   │       ├── guard.test.ts
│   │       └── server.test.ts
│   │
│   └── web/
│       ├── .env
│       ├── .env.example
│       ├── .gitignore
│       ├── AGENTS.md
│       ├── CLAUDE.md
│       ├── DESIGN.md
│       ├── next.config.ts
│       ├── postcss.config.mjs
│       ├── proxy.ts
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       │
│       ├── app/
│       │   ├── error.tsx
│       │   ├── global-error.tsx
│       │   ├── globals.css
│       │   ├── layout.tsx
│       │   ├── not-found.tsx
│       │   ├── robots.ts
│       │   ├── sitemap.ts
│       │   │
│       │   ├── (app)/
│       │   │   ├── layout.tsx
│       │   │   ├── dashboard/
│       │   │   │   ├── actions.ts
│       │   │   │   ├── loading.tsx
│       │   │   │   ├── new-project-form.tsx
│       │   │   │   └── page.tsx
│       │   │   ├── projects/
│       │   │   │   └── [projectId]/
│       │   │   │       ├── actions.ts
│       │   │   │       ├── loading.tsx
│       │   │   │       ├── page.tsx
│       │   │   │       ├── monitors/
│       │   │   │       │   ├── actions.ts
│       │   │   │       │   └── page.tsx
│       │   │   │       └── verify/
│       │   │   │           ├── actions.ts
│       │   │   │           ├── page.tsx
│       │   │   │           └── verify-form.tsx
│       │   │   ├── scan/
│       │   │   │   └── start/
│       │   │   │       ├── page.tsx
│       │   │   │       └── start-scan-client.tsx
│       │   │   ├── settings/
│       │   │   │   ├── layout.tsx
│       │   │   │   ├── loading.tsx
│       │   │   │   ├── settings-tabs.tsx
│       │   │   │   ├── api-keys/
│       │   │   │   │   ├── actions.ts
│       │   │   │   │   ├── keys-panel.tsx
│       │   │   │   │   └── page.tsx
│       │   │   │   └── billing/
│       │   │   │       └── page.tsx
│       │   │   └── welcome/
│       │   │       ├── actions.ts
│       │   │       ├── loading.tsx
│       │   │       └── page.tsx
│       │   │
│       │   ├── (auth)/
│       │   │   ├── layout.tsx
│       │   │   ├── callback/
│       │   │   │   └── route.ts
│       │   │   └── login/
│       │   │       ├── layout.tsx
│       │   │       ├── login-form-client.tsx
│       │   │       └── page.tsx
│       │   │
│       │   ├── (marketing)/
│       │   │   ├── layout.tsx
│       │   │   ├── page.tsx
│       │   │   └── (chrome)/
│       │   │       ├── layout.tsx
│       │   │       ├── pricing/
│       │   │       │   └── page.tsx
│       │   │       ├── privacy/
│       │   │       │   └── page.tsx
│       │   │       └── terms/
│       │   │           └── page.tsx
│       │   │
│       │   ├── api/
│       │   │   ├── billing/
│       │   │   │   ├── cancel/route.ts
│       │   │   │   ├── checkout/route.ts
│       │   │   │   └── verify/route.ts
│       │   │   ├── health/route.ts
│       │   │   ├── inngest/route.ts
│       │   │   ├── reports/[scanId]/route.ts
│       │   │   ├── repos/scan/route.ts
│       │   │   ├── scan/
│       │   │   │   ├── route.ts
│       │   │   │   └── [scanId]/status/route.ts
│       │   │   ├── v1/
│       │   │   │   ├── projects/route.ts
│       │   │   │   └── scan/
│       │   │   │       ├── route.ts
│       │   │   │       └── [scanId]/
│       │   │   │           ├── route.ts
│       │   │   │           └── fix-prompt/route.ts
│       │   │   └── webhooks/razorpay/route.ts
│       │   │
│       │   ├── auth/callback/route.ts
│       │   │
│       │   ├── scan/[scanId]/
│       │   │   ├── actions.ts
│       │   │   ├── loading.tsx
│       │   │   ├── not-found.tsx
│       │   │   └── page.tsx
│       │   │
│       │   └── status/[slug]/
│       │       ├── loading.tsx
│       │       └── page.tsx
│       │
│       ├── components/
│       │   ├── auth/
│       │   │   ├── provider-marks.tsx
│       │   │   ├── sign-in-error.ts
│       │   │   ├── sign-out-button.tsx
│       │   │   ├── supabase-context.ts
│       │   │   ├── supabase-provider-client.tsx
│       │   │   └── supabase-provider.tsx
│       │   ├── billing/
│       │   │   └── billing-button.tsx
│       │   ├── brand/
│       │   │   └── logo.tsx
│       │   ├── console/
│       │   │   ├── icons.tsx
│       │   │   ├── nav.ts
│       │   │   └── sidebar.tsx
│       │   ├── marketing/
│       │   │   ├── answer-engines.tsx
│       │   │   ├── evidence.tsx
│       │   │   ├── faq.tsx
│       │   │   ├── final-cta.tsx
│       │   │   ├── fix-prompt.tsx
│       │   │   ├── hero-matrix.tsx
│       │   │   ├── hero-scan-form-skeleton.tsx
│       │   │   ├── hero-scan-form.tsx
│       │   │   ├── hero.tsx
│       │   │   ├── icons.tsx
│       │   │   ├── legal-page.tsx
│       │   │   ├── monitoring.tsx
│       │   │   ├── pillars.tsx
│       │   │   ├── plans-preview.tsx
│       │   │   ├── safety.tsx
│       │   │   ├── sample-report.ts
│       │   │   ├── section.tsx
│       │   │   ├── site-footer.tsx
│       │   │   └── site-header.tsx
│       │   ├── monitors/
│       │   │   ├── monitor-row.tsx
│       │   │   ├── uptime-chart.tsx
│       │   │   └── uptime-days.ts
│       │   ├── scan/
│       │   │   ├── copy-button.tsx
│       │   │   ├── export-links.tsx
│       │   │   ├── finding-card.tsx
│       │   │   ├── findings-list.tsx
│       │   │   ├── fix-prompt-dialog.tsx
│       │   │   ├── hero-scan-form-client.tsx
│       │   │   ├── pending-scan-url.ts
│       │   │   ├── pillar-scores.tsx
│       │   │   ├── pillar-view.ts
│       │   │   ├── report-gate.tsx
│       │   │   ├── scan-action.ts
│       │   │   ├── scan-form-client.tsx
│       │   │   ├── scan-form-skeleton.tsx
│       │   │   ├── scan-form.tsx
│       │   │   ├── scan-progress.tsx
│       │   │   ├── score-ring.tsx
│       │   │   └── use-scan-submit.ts
│       │   └── ui/
│       │       ├── labeled-rule.tsx
│       │       └── skeleton.tsx
│       │
│       ├── inngest/
│       │   ├── index.ts
│       │   └── functions/
│       │       ├── domain-health.ts
│       │       ├── generate-report.ts
│       │       ├── run-repo-scan.ts
│       │       ├── run-scan.ts
│       │       ├── scheduled-rescan.ts
│       │       ├── sweep.ts
│       │       ├── types.ts
│       │       └── uptime-probe.ts
│       │
│       ├── lib/
│       │   ├── alert-email.ts
│       │   ├── alert-message.ts
│       │   ├── api-auth.ts
│       │   ├── api-response.ts
│       │   ├── authz.ts
│       │   ├── billing-period.ts
│       │   ├── domain-verification.ts
│       │   ├── email.ts
│       │   ├── entitlements.ts
│       │   ├── env.ts
│       │   ├── inngest.ts
│       │   ├── legal.ts
│       │   ├── next-path.ts
│       │   ├── pillars.ts
│       │   ├── plans.ts
│       │   ├── public-env.ts
│       │   ├── quota.ts
│       │   ├── ratelimit.ts
│       │   ├── razorpay.ts
│       │   ├── redact.ts
│       │   ├── repo-scanner.ts
│       │   ├── request.ts
│       │   ├── url.ts
│       │   ├── auth/supabase.ts
│       │   ├── report/
│       │   │   ├── build.ts
│       │   │   └── pdf.ts
│       │   ├── scan/
│       │   │   ├── run-repo-scan-job.ts
│       │   │   └── run-scan-job.ts
│       │   └── supabase/
│       │       ├── browser.ts
│       │       └── server.ts
│       │
│       ├── public/
│       │   └── logo-skull.png
│       │
│       └── test/
│           ├── alert-email.test.ts
│           ├── alert-message.test.ts
│           ├── api-auth.test.ts
│           ├── auth-callback-route.test.ts
│           ├── auth-recovery.test.ts
│           ├── billing-period.test.ts
│           ├── console-nav.test.ts
│           ├── domain-verification.test.ts
│           ├── email.test.ts
│           ├── findings-split.test.ts
│           ├── pending-scan-url.test.ts
│           ├── razorpay.test.ts
│           ├── redact.test.ts
│           ├── redirect-allowlist.test.ts
│           ├── report-build.test.ts
│           ├── safe-next-path.test.ts
│           ├── uptime-chart.test.ts
│           ├── url.test.ts
│           └── stubs/server-only.ts
│
└── packages/
    ├── config/
    │   └── .gitkeep
    │
    ├── types/
    │   └── .gitkeep
    │
    ├── checks/
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── vitest.config.ts
    │   ├── fixtures/
    │   │   ├── example-com.json
    │   │   ├── github-com.json
    │   │   ├── google-com.json
    │   │   ├── leaky-app.json
    │   │   ├── legacy-example.json
    │   │   ├── staging-leak.json
    │   │   └── stripe-com.json
    │   ├── src/
    │   │   ├── fix-prompt.ts
    │   │   ├── index.ts
    │   │   ├── registry.ts
    │   │   ├── scoring.ts
    │   │   ├── types.ts
    │   │   ├── version.ts
    │   │   ├── accessibility/
    │   │   │   ├── axe.ts
    │   │   │   └── static/
    │   │   │       ├── form-labels.ts
    │   │   │       ├── img-alt.ts
    │   │   │       └── link-text.ts
    │   │   ├── aeo/
    │   │   │   ├── ai-bots-allowed.ts
    │   │   │   ├── answer-structure.ts
    │   │   │   ├── author-date.ts
    │   │   │   ├── content.ts
    │   │   │   ├── entity-schema.ts
    │   │   │   ├── faq-howto-schema.ts
    │   │   │   ├── llms-txt.ts
    │   │   │   ├── outbound-citations.ts
    │   │   │   └── ssr-content.ts
    │   │   ├── compliance/
    │   │   │   ├── cookie-banner.ts
    │   │   │   ├── privacy-policy-link.ts
    │   │   │   └── trackers-before-consent.ts
    │   │   ├── context/
    │   │   │   ├── build-context.ts
    │   │   │   ├── cookies.ts
    │   │   │   ├── crawl.ts
    │   │   │   ├── dns.ts
    │   │   │   ├── fetch-scripts.ts
    │   │   │   ├── parse-html.ts
    │   │   │   ├── psi.ts
    │   │   │   ├── public-suffix.ts
    │   │   │   ├── rendered.ts
    │   │   │   ├── robots.ts
    │   │   │   ├── safe-fetch.ts
    │   │   │   ├── ssrf-guard.ts
    │   │   │   └── tls.ts
    │   │   ├── domain/
    │   │   │   ├── caa.ts
    │   │   │   └── expiry.ts
    │   │   ├── email/
    │   │   │   ├── dkim.ts
    │   │   │   ├── dmarc.ts
    │   │   │   └── spf.ts
    │   │   ├── performance/
    │   │   │   ├── caching-headers.ts
    │   │   │   ├── compression.ts
    │   │   │   ├── image-formats.ts
    │   │   │   └── psi.ts
    │   │   ├── security/
    │   │   │   ├── mixed-content.ts
    │   │   │   ├── security-txt.ts
    │   │   │   ├── sri.ts
    │   │   │   ├── backend/
    │   │   │   │   ├── firebase-rules.ts
    │   │   │   │   ├── sources.ts
    │   │   │   │   └── supabase-rls.ts
    │   │   │   ├── cookies/
    │   │   │   │   └── cookie-flags.ts
    │   │   │   ├── cors/
    │   │   │   │   └── cors-wildcard.ts
    │   │   │   ├── exposure/
    │   │   │   │   ├── directory-listing.ts
    │   │   │   │   ├── paths.ts
    │   │   │   │   ├── sensitive-paths.ts
    │   │   │   │   └── source-maps.ts
    │   │   │   ├── headers/
    │   │   │   │   ├── csp.ts
    │   │   │   │   ├── hsts.ts
    │   │   │   │   ├── permissions-policy.ts
    │   │   │   │   ├── referrer-policy.ts
    │   │   │   │   ├── x-content-type-options.ts
    │   │   │   │   └── x-frame-options.ts
    │   │   │   ├── info-leak/
    │   │   │   │   ├── server-header.ts
    │   │   │   │   └── x-powered-by.ts
    │   │   │   ├── secrets/
    │   │   │   │   ├── patterns.ts
    │   │   │   │   └── secrets-in-js.ts
    │   │   │   └── tls/
    │   │   │       ├── cert-expiry.ts
    │   │   │       ├── https-redirect.ts
    │   │   │       └── protocol-version.ts
    │   │   └── seo/
    │   │       ├── broken-links.ts
    │   │       ├── canonical.ts
    │   │       ├── duplicate-metadata.ts
    │   │       ├── favicon.ts
    │   │       ├── h1.ts
    │   │       ├── heading-order.ts
    │   │       ├── hreflang.ts
    │   │       ├── lang.ts
    │   │       ├── meta-description.ts
    │   │       ├── meta-tags.ts
    │   │       ├── open-graph.ts
    │   │       ├── robots-meta.ts
    │   │       ├── robots-txt.ts
    │   │       ├── sitemap.ts
    │   │       ├── structured-data.ts
    │   │       ├── title.ts
    │   │       ├── twitter-card.ts
    │   │       └── viewport.ts
    │   └── test/
    │       ├── active-testing-gate.test.ts
    │       ├── aeo-checks.test.ts
    │       ├── axe-check.test.ts
    │       ├── backend-checks.test.ts
    │       ├── cookies.test.ts
    │       ├── crawl-checks.test.ts
    │       ├── domain-checks.test.ts
    │       ├── exposure-checks.test.ts
    │       ├── fetch-scripts.test.ts
    │       ├── fix-prompt.test.ts
    │       ├── fixtures.test.ts
    │       ├── header-checks.test.ts
    │       ├── helpers.ts
    │       ├── live-smoke.test.ts
    │       ├── pillar-checks.test.ts
    │       ├── psi-checks.test.ts
    │       ├── public-suffix.test.ts
    │       ├── registry.test.ts
    │       ├── robots.test.ts
    │       ├── scoring.test.ts
    │       ├── security-checks.test.ts
    │       ├── seo-checks.test.ts
    │       ├── source-hygiene.test.ts
    │       ├── ssrf-guard.test.ts
    │       └── tls-checks.test.ts
    │
    ├── db/
    │   ├── drizzle.config.ts
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── vitest.config.ts
    │   ├── drizzle/
    │   │   ├── 0000_faithful_blonde_phantom.sql
    │   │   ├── 0001_charming_roxanne_simpson.sql
    │   │   ├── 0002_razorpay_billing_columns.sql
    │   │   ├── 0003_user_priorities.sql
    │   │   ├── 0004_domain_verification.sql
    │   │   ├── 0005_api_key_prefix.sql
    │   │   ├── 0006_auth_subject.sql
    │   │   ├── 0007_late_shocker.sql
    │   │   └── meta/
    │   │       ├── _journal.json
    │   │       └── 0000-0007_snapshot.json
    │   ├── scripts/
    │   │   └── migrate.mjs
    │   ├── src/
    │   │   ├── client.ts
    │   │   ├── index.ts
    │   │   ├── schema.ts
    │   │   └── queries/
    │   │       ├── alerts.ts
    │   │       ├── api-keys.ts
    │   │       ├── dashboard.ts
    │   │       ├── github-installations.ts
    │   │       ├── monitors.ts
    │   │       ├── projects.ts
    │   │       ├── repo-scans.ts
    │   │       ├── scans.ts
    │   │       ├── subscriptions.ts
    │   │       ├── users.ts
    │   │       └── viewer.ts
    │   └── test/
    │       ├── accounts.test.ts
    │       ├── active-probe-chain.test.ts
    │       ├── alert-delivery.test.ts
    │       ├── api-keys.test.ts
    │       ├── domain-ownership.test.ts
    │       ├── limits.test.ts
    │       ├── monitors.test.ts
    │       ├── priorities.test.ts
    │       ├── scans.test.ts
    │       └── setup-env.ts
    │
    ├── mcp-server/
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── vitest.config.ts
    │   ├── src/
    │   │   ├── client.ts
    │   │   ├── index.ts
    │   │   └── tools/
    │   │       ├── get-fix-prompt.ts
    │   │       ├── get-scan.ts
    │   │       ├── list-findings.ts
    │   │       ├── list-projects.ts
    │   │       ├── run-scan.ts
    │   │       └── types.ts
    │   └── test/
    │       ├── protocol.test.ts
    │       └── tools.test.ts
    │
    └── repo-checks/
        ├── package.json
        ├── tsconfig.json
        ├── vitest.config.ts
        ├── src/
        │   ├── fix-prompt.ts
        │   ├── index.ts
        │   ├── registry.ts
        │   ├── scoring.ts
        │   ├── types.ts
        │   ├── version.ts
        │   ├── checks/
        │   │   ├── ci-cd/
        │   │   │   ├── branch-protection.ts
        │   │   │   ├── commit-signing.ts
        │   │   │   ├── push-protection.ts
        │   │   │   └── workflow-hygiene.ts
        │   │   ├── governance/
        │   │   │   ├── codeowners.ts
        │   │   │   ├── gitignore.ts
        │   │   │   └── repo-files.ts
        │   │   └── supply-chain/
        │   │       ├── action-pinning.ts
        │   │       ├── dependabot.ts
        │   │       ├── pr-target-injection.ts
        │   │       └── workflow-permissions.ts
        │   └── util/
        │       ├── protection.ts
        │       └── workflow.ts
        └── test/
            ├── helpers.ts
            ├── registry.test.ts
            ├── scoring.test.ts
            └── shallow-checks.test.ts
```

## Packages

| Package | Description |
|---|---|
| `packages/checks` | Website health-check engine — 9 categories (accessibility, AEO, compliance, context, domain, email, performance, security, SEO) with 80+ individual checks |
| `packages/db` | Drizzle ORM schema, migrations, and query modules |
| `packages/mcp-server` | MCP tool server exposing scan/project tools |
| `packages/repo-checks` | GitHub repo checks — CI/CD, governance, and supply-chain auditing |
| `packages/config` | Shared config (placeholder) |
| `packages/types` | Shared types (placeholder) |

## Apps

| App | Description |
|---|---|
| `apps/web` | Next.js 16 web app — dashboard, scan reports, marketing site, API routes |
| `apps/cli` | CLI runner — `buildContext → runChecks → computeScores → print` |
| `apps/scanner` | Headless browser scanner (Dockerized) — screenshots, PDF, rendered content, axe audit |

## Key Files

- `packages/checks/src/types.ts` — `Check` / `CheckContext` / `Finding` contract
- `packages/checks/src/context/ssrf-guard.ts` — SSRF protection; every socket resolves through it
- `packages/checks/src/registry.ts` — register new checks here
- `apps/web/lib/` — shared utilities (auth, billing, email, rate limiting, env validation)
- `apps/web/inngest/functions/` — background job definitions (scans, reports, monitoring)

## Docs

- [Deployment](./DEPLOY.md)
- [Supabase Setup](./SUPABASE_SETUP.md)
- [Progress](./progress.md)
- [Requirements](./requirement.md)
