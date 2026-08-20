# Darvin

Darvin Application scanner — paste a URL, get 100+ read-only checks across security, SEO, AEO, performance, accessibility, and compliance, each with severity, evidence, remediation, and a copy-paste fix prompt.

Monorepo (Turborepo + pnpm, Node ≥22). **Phase 0 (engine + CLI) is implemented**; the web app, DB and MCP server are scaffolds for the next phases.

## Scan a site

```sh
pnpm install
pnpm scan https://example.com          # human report
pnpm scan example.com --json           # machine-readable
```

A scan fetches the page once, builds a `CheckContext` (headers, HTML, cookies, TLS, DNS, robots.txt), runs every registered check as a pure function over it, and scores the result 0–100 per pillar. Currently: 9 security checks (6 header checks, certificate expiry, TLS protocol version, HTTPS enforcement).

## Development

```sh
pnpm typecheck                          # strict tsc across packages
pnpm test                               # network-free unit tests (vitest)
cd packages/checks && DARVIN_LIVE=1 pnpm test   # + live end-to-end smoke
```

Key layout:

- `packages/checks/src/types.ts` — the `Check` / `CheckContext` / `Finding` contract
- `packages/checks/src/context/` — one-pass data gathering; `ssrf-guard.ts` is load-bearing: every socket resolves through it, private/reserved targets are refused
- `packages/checks/src/security/…` — one file per check; add a check by importing it in `registry.ts`
- `apps/cli` — thin runner: `buildContext → runChecks → computeScores → print`
