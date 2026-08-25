# Requirements — [ProductName]
### A website security / SEO / AEO scanner built to be 10x better and cheaper than CheckVibe

---

## 1. Vision

CheckVibe wins on breadth (one dashboard, six pillars) but is shallow on depth: mostly static/config
checks, generic rulesets, a "Beta" active-testing feature, and pricing built for agencies ($24–99/mo).

**Our bet:** most of their checks are commodity (open-source tools glued together). The moat is in
**depth** (real active testing, stack-aware context, evidence not just flags) and **AEO** (genuinely
new territory). We ship that depth at a fraction of the price because our infra is usage-metered, not
always-on.

**Definition of "10x":** fewer false positives, evidence-backed findings a user can't get elsewhere,
stack-specific checks CheckVibe's generic ruleset misses, and a real (not heuristic) AEO test —
not just "more checkboxes than them."

**Definition of "cheaper":** full findings free (not just a severity count), and every paid tier priced
below CheckVibe's equivalent tier while including more.

---

## 2. Success Criteria

- [ ] A scan on a real vibe-coded app surfaces at least one finding a generic scanner (CheckVibe,
      Mozilla Observatory, PageSpeed) would miss, with evidence attached
- [ ] False-positive rate on repeat scans of the same unchanged site is near zero (suppression works)
- [ ] Full scan (all pillars) completes in under 45 seconds for a typical marketing/SaaS site
- [ ] Entry paid tier costs less than half of CheckVibe's Starter ($24/mo)
- [ ] Free tier shows full findings, not just a severity count

---

## 3. Feature Checklist

### 3.1 Core Scanning Engine

#### Security — Static Layer (cheap, fast, table stakes)
- [ ] HTTP header ruleset: CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy,
      Permissions-Policy
- [ ] CORS misconfiguration checks (wildcard origin on sensitive routes)
- [ ] Cookie flag checks: Secure, HttpOnly, SameSite
- [ ] TLS/certificate validity, expiry window, weak cipher detection
- [ ] robots.txt / sitemap.xml parsing and validation
- [ ] Open redirect detection (pattern-based)
- [ ] Exposed `.env`, `.git`, admin panels, common debug endpoints (path probing, read-only)
- [ ] Mixed-content detection (HTTP resources on HTTPS pages)

#### Security — Dynamic/Active Layer (the differentiator — CheckVibe has this as "Beta" only)
- [ ] Safe, non-destructive auth-boundary testing: can protected routes be hit without a token?
- [ ] IDOR pattern testing: does incrementing/changing an ID in a request expose another user's data?
- [ ] Rate-limit verification: does a login/signup endpoint actually throttle repeated requests,
      not just claim to via headers?
- [ ] Injection probing on obvious input points (read-only payloads, no data mutation)
- [ ] Session fixation / token leakage in URLs or client-side bundles
- [ ] **Every active test has an explicit "safe mode" toggle and a clear consent step before running**
      (legal/ethical guardrail — see §3.8)

#### Stack-Aware / Context Detection (CheckVibe uses a flat generic ruleset — this is our edge)
- [ ] Auto-detect frontend framework (Next.js, Vite/React, plain HTML, WordPress, etc.)
- [ ] Auto-detect backend/BaaS (Supabase, Firebase, Convex) from client-side fingerprints
- [ ] Supabase: verify Row Level Security is actually enabled per table, not just "is connected"
- [ ] Firebase: detect `allow read, write: if true` default-open rules
- [ ] Next.js: detect server secrets/env vars leaking into the client bundle (very common
      vibe-coding mistake)
- [ ] Stack-specific fix prompts (different remediation for Supabase vs Firebase vs custom backend)

#### Dependency & Secrets Scanning (GitHub-connected)
- [ ] Secrets-in-git-history scan (gitleaks or equivalent)
- [ ] Known-vulnerable dependency scan (osv-scanner / npm audit equivalent)
- [ ] Outdated/unmaintained package flagging with upgrade path suggestion

#### SEO
- [ ] Title/meta description presence, length, uniqueness across pages
- [ ] Canonical tag correctness
- [ ] Heading hierarchy validation (single H1, logical nesting)
- [ ] Image alt-text coverage
- [ ] Sitemap/robots validity and crawlability
- [ ] Structured data (schema.org JSON-LD) presence and validity
- [ ] Internal link crawl (a few levels deep), broken link detection
- [ ] Raw-HTML vs browser-rendered content diff (catches JS-only content invisible to crawlers)

#### AEO — Answer Engine Optimization (our biggest edge — build this deepest)
- [ ] Fetch the page using real bot user-agents (GPTBot, ClaudeBot, PerplexityBot, Google-Extended)
      and diff what they see vs. what a browser sees — concrete proof, not a heuristic guess
- [ ] robots.txt AI-crawler-specific disallow rule detection
- [ ] llms.txt detection and validity check
- [ ] FAQ/structured-data schema presence for answer extraction
- [ ] **Real citability test**: feed the page's actual extracted content to an LLM and ask
      "could you answer a relevant question using only this content?" — pass/fail with reasoning,
      not a proxy score
- [ ] Content freshness signals (dated content, last-modified headers)
- [ ] (V2) Citation tracking — has this page actually been cited by Perplexity/ChatGPT search over time

#### Performance
- [ ] Wrap Google PageSpeed Insights API (free) rather than running Lighthouse ourselves
- [ ] Re-rank/re-weight their output into our unified severity scale

#### Accessibility
- [ ] axe-core run inside the same browser session used for SEO (share the page load — don't
      spin up Playwright three times per scan)
- [ ] WCAG violation list with severity, grouped by page

#### Compliance
- [ ] Cookie banner presence and functional check (does "reject" actually block trackers?)
- [ ] Privacy policy / terms link presence
- [ ] Basic GDPR/CCPA signal checks (not legal advice — flagged as such)

#### Monitoring / Uptime
- [ ] Scheduled lightweight HTTP checks (configurable interval, 60s minimum on paid tiers)
- [ ] Down/recovery alerting (email at minimum; webhook/Slack on higher tiers)
- [ ] Public status page per project
- [ ] Score-drop alerts: notify when a scheduled rescan finds a regression, not just uptime

---

### 3.2 Differentiators (features CheckVibe does not have — this is what makes it 10x, not just cheaper)

- [ ] **Evidence-backed findings**: every finding includes a redacted proof snippet or concrete
      demonstration, not just "CSP header missing"
- [ ] **False-positive suppression with memory**: user marks a finding as accepted-risk once,
      it stays suppressed across future scans and similar findings on the same project
- [ ] **Deploy-triggered rescans**: webhook from GitHub/Vercel/Netlify auto-triggers a scan on
      every deploy, diffed against the previous scan, alerting only on *new* regressions
- [ ] **Multi-model reconciliation** on fuzzy checks (AEO citability, content quality, a11y edge
      cases): run through two models, reconcile disagreement, higher-confidence severity rating
- [ ] **Stack-specific rulesets** (see §3.1) instead of one generic ruleset for every site
- [ ] Confidence score per finding (how certain is this, not just severity)

---

### 3.3 Reporting & UX

- [ ] Unified dashboard: one score per pillar, one overall score, ranked-by-impact finding list
- [ ] Every finding: severity, evidence, plain-English explanation, fix prompt, confidence score
- [ ] One-click "Generate Fix Prompt" — copy-paste ready for Cursor/Claude/Copilot
- [ ] PDF and Markdown export
- [ ] Scan history with visual score-over-time chart and diff view between any two scans
- [ ] Shareable public report link (for agencies handing off to clients — free on our mid tier,
      not gated to the top tier like CheckVibe's white-label)

---

### 3.4 Integrations

- [ ] GitHub repo connection (secrets/dependency scanning, deploy-triggered rescans)
- [ ] Supabase connection (RLS verification)
- [ ] Firebase connection (rules verification)
- [ ] MCP server exposing scan/report tools to Claude, Cursor, Windsurf, etc.
- [ ] REST API with API keys (available from the entry paid tier, not gated to top tier)
- [ ] Slack/Discord webhook alerts

---

### 3.5 Platform / Accounts

- [ ] Auth (email + OAuth)
- [ ] Multi-project support at every paid tier (not single-project-locked like CheckVibe's Starter)
- [ ] Team seats with role-based access (viewer/editor/admin)
- [ ] Client workspaces / white-label reports (mid tier, not top tier only)
- [ ] Usage dashboard (scans used, API calls, monitoring checks)

---

### 3.6 Pricing & Billing

**Principle: full findings free, unlimited scans cheap, undercut every CheckVibe tier while including more.**

| Tier | Price/mo | vs. CheckVibe equivalent | Includes |
|---|---|---|---|
| Free | $0 | Their free tier shows severity count only | Full findings (not just counts), 3 full scans/mo, 1 project |
| Starter | $9 | Their Starter is $24 | Unlimited scans, 1 project, all pillars, fix prompts, PDF export |
| Pro | $19 | Their Pro is $49 | 5 projects, daily monitoring, live threat alerts, API access |
| Team | $39 | Their Max is $99 | 25 projects, white-label, 5 seats, client portal, deploy-triggered rescans |
| Pay-per-scan | $2/scan | Not offered by CheckVibe | No subscription, one-off report |

- [ ] Stripe billing (monthly + annual, ~30% annual discount matching market norm)
- [ ] Free tier shows real findings, not a teaser count
- [ ] Pay-per-scan option for non-recurring users
- [ ] Transparent usage metering visible in-app (no surprise overages)

---

### 3.7 Non-Functional Requirements

- [ ] Full scan (all pillars) completes in under 45 seconds for a typical site
- [ ] Scanner infra is usage-metered (serverless functions, pay-per-use browser rendering) —
      no idle always-on cost driving prices up
- [ ] Shared browser session across SEO/Accessibility/AEO checks per page load
- [ ] Caching: identical URL rescanned within a short TTL reuses raw fetch, not full re-run
- [ ] All scans are read-only by default; active testing requires explicit opt-in and consent
- [ ] Rate-limit our own scanner's outbound requests to avoid looking like an attack on the
      target site
- [ ] 99.9% uptime for the scanning service itself
- [ ] Data retention/deletion controls (user can delete a project and all associated scan data)

---

### 3.8 Trust & Safety / Legal

- [ ] Explicit terms of use: user must confirm they own or are authorized to scan the target site
- [ ] Active/dynamic tests are strictly non-destructive and clearly labeled before running
- [ ] Clear consent screen before any active testing (auth-boundary probing, rate-limit testing) runs
- [ ] Abuse prevention: block scanning of domains not under the user's control where feasible
      (e.g. require a verification step — DNS TXT record or meta tag — before active tests unlock)
- [ ] Privacy policy covering what scan data is stored and for how long

---

## 4. Explicit Non-Goals for V1 (to ship fast — don't scope-creep the MVP)

- [ ] Do NOT build a custom Lighthouse/performance runner — wrap PageSpeed Insights API
- [ ] Do NOT build custom uptime probe infrastructure from scratch — simple cron/webhook is enough
      at launch
- [ ] Do NOT build the MCP server before the core scan pipeline and dashboard are solid
- [ ] Do NOT build citation-tracking-over-time (AEO) until the core citability test is validated
- [ ] Do NOT build white-label/client-portal until Team tier has paying demand

---

## 5. Phased Roadmap

### Phase 1 — MVP (prove the core loop)
- [ ] Security static checks + SEO + Accessibility + PageSpeed wrapper
- [ ] Basic AEO check (bot user-agent diff + robots.txt/llms.txt)
- [ ] Unified dashboard, scoring, PDF/Markdown export
- [ ] Free tier + Starter tier + Stripe billing
- [ ] Fix-prompt generation via LLM

### Phase 2 — Differentiate
- [ ] Active/dynamic security testing (opt-in, consent-gated)
- [ ] Stack-aware detection (Supabase RLS, Firebase rules, Next.js env leaks)
- [ ] False-positive suppression with memory
- [ ] Deploy-triggered rescans (GitHub/Vercel webhooks)
- [ ] Real AEO citability test (LLM-judged, not heuristic)

### Phase 3 — Scale
- [ ] MCP server
- [ ] Monitoring/uptime + alerting
- [ ] Team/white-label tier
- [ ] Multi-model reconciliation for fuzzy checks
- [ ] Citation tracking over time

---

## 6. Reference Tech Stack

Next.js + Tailwind (frontend) → Hono/Node API on Cloudflare Workers → Playwright (shared browser
session) + cheerio + gitleaks/osv-scanner + PageSpeed Insights API + axe-core (scanners) → Upstash
QStash (job queue) → Supabase/Postgres (DB + auth) → Claude API (fix prompts & AEO judgment) →
Stripe (billing) — deployed on Vercel/Cloudflare free tiers to keep costs usage-based, not fixed.