/**
 * The repo scan engine's types.
 *
 * This is a parallel to @scanlyfix/checks' types — same SHAPE, different
 * subject. That engine scans a LIVE SITE over HTTP (its CheckContext is built
 * from a fetched page: HTML, headers, scripts, DNS, TLS, crawl, rendered DOM).
 * This engine scans a CODE REPOSITORY (its RepoCheckContext is built from a
 * shallow GitHub-API payload and, for deep scans, an ephemeral clone).
 *
 * The two share `Severity` deliberately. Severity is a five-step ladder
 * (critical → info) that means the same thing whether a leaked key is in a
 * bundle or in a commit, and a drift between the two engines on it would mean a
 * repo `critical` and a site `critical` are reported differently. So this
 * module IMPORTS Severity from @scanlyfix/checks rather than redeclaring it,
 * and the build fails the day one diverges.
 *
 * It does NOT share Category. A site's pillars are security/seo/aeo/perf/a11y/
 * compliance — notions that do not exist for a repo. A repo's pillars are
 * secrets/supply-chain/ci-cd/code-quality/dependencies/governance, and forcing
 * repo findings into site pillars would make "seo" carry a branch-protection
 * finding. So RepoCategory is its own union, compile-locked to its own DB enum
 * in packages/db exactly the way Category is.
 *
 * The same purity contract applies: a RepoCheck is a pure function over
 * RepoCheckContext. It fetches nothing itself — the shallow API data and the
 * cloned tree are pre-assembled by buildContext() in apps/github-scanner. This
 * is what keeps a repo scan fast (one assembly pass, N checks) and keeps every
 * check trivially testable against a fixture context.
 */

import type { Severity } from '@scanlyfix/checks'

/** Re-exported so every repo-checks consumer reaches for the same ladder. */
export type { Severity } from '@scanlyfix/checks'
export { SEVERITY_ORDER } from '@scanlyfix/checks'

/**
 * The six repo pillars. Every repo check belongs to exactly one. Ranked
 * worst-first where scoring cares; order here also fixes the order of
 * RepoScanScores' degraded list, so two scans of the same repo produce a
 * byte-identical scores object — which is what makes a stored diff meaningful.
 */
export type RepoCategory = 'secrets' | 'supply-chain' | 'ci-cd' | 'code-quality' | 'dependencies' | 'governance'

export const REPO_CATEGORY_ORDER: readonly RepoCategory[] = [
  'secrets',
  'supply-chain',
  'ci-cd',
  'code-quality',
  'dependencies',
  'governance',
]

/* -------------------------------------------------------------------------- */
/* Shallow payload (GitHub API)                                               */
/* -------------------------------------------------------------------------- */

export interface CommitSummary {
  sha: string
  author: string
  date: string
  message: string
  /** true when GitHub marked the commit signature verified. */
  verified: boolean
}

export interface PullSummary {
  number: number
  state: 'open' | 'closed'
  mergedAt: string | null
  reviews: number
  approved: boolean
}

/** A workflow file fetched from .github/workflows/. `yaml` is the raw file. */
export interface WorkflowFile {
  path: string
  name: string
  yaml: string
}

export interface WorkflowRunSummary {
  name: string
  conclusion: string
  createdAt: string
}

/**
 * Branch-protection is an open shape on purpose: GitHub's protection payload is
 * large and versioned, and the checks read a handful of fields off it. A typed
 * mirror would drift with every API change; the reads are narrow and guarded.
 */
export type BranchProtection = Record<string, unknown> | null

export interface DependabotAlert {
  severity: string
  package: string
  vulnerableVersion: string
  state: string
}

export interface CodeScanningAlert {
  rule: string
  severity: string
  state: string
}

export interface SecurityAndAnalysis {
  secretScanning: boolean
  pushProtection: boolean
  /** Dependabot security updates: off → the supply-chain finding. */
  dependabotSecurityUpdates: boolean
}

export interface TreeEntry {
  path: string
  type: 'blob' | 'tree'
  size: number
}

/**
 * Everything a shallow scan learns from the GitHub API, gathered in ONE pass
 * by the worker before any check runs. Present on every scan regardless of
 * profile; a deep scan adds the `clone` half below.
 *
 * A field that is `null` means "we asked and the answer was no" (no CODEOWNERS,
 * no branch protection). A field ABSENT from a sub-object is "we did not look",
 * which a check must never read as a defect — see `crawl`/`rendered` in the
 * site CheckContext for the same rule.
 */
export interface RepoApiContext {
  commits: CommitSummary[]
  pulls: PullSummary[]
  workflows: WorkflowFile[]
  workflowRuns: WorkflowRunSummary[]
  /** null when the default branch is unprotected — itself the ci-cd finding. */
  branchProtection: BranchProtection
  /** Contents of .github/CODEOWNERS, or null when the file is absent. */
  codeowners: string | null
  dependabotAlerts: DependabotAlert[]
  codeScanningAlerts: CodeScanningAlert[]
  securityAndAnalysis: SecurityAndAnalysis
  /** git/trees?recursive=1 — the file index, for "does SECURITY.md exist" etc. */
  tree: TreeEntry[]
  /** The repo's license SPDX id (e.g. "mit"), or null. */
  license: string | null
  /** Contents of .gitignore, or null when the file is absent. */
  gitignore: string | null
}

/* -------------------------------------------------------------------------- */
/* Deep payload (cloned tree)                                                 */
/* -------------------------------------------------------------------------- */

export interface GitleaksFinding {
  rule: string
  file: string
  line: number
  /** A redacted sample only — issuer-kind + truncated fingerprint, never live. */
  sample: string
}

export interface OsvFinding {
  package: string
  version: string
  vulnId: string
  severity: string
  fixed: string | null
}

/**
 * Present only when a scan cloned the repo. Absent means the clone never ran —
 * NOT that the repo has no code. Every check reading it MUST stay silent when
 * it is undefined, or a shallow scan would start reporting the absence of
 * evidence it never went looking for. The engine does not enforce this; the
 * check's own `run` does, the same way the site checks guard on `crawl`.
 */
export interface RepoCloneContext {
  /** Ephemeral path; deleted by the worker the moment the scan finishes. */
  rootDir: string
  fileIndex: { path: string; size: number; lang: string }[]
  /** Read a tracked file's text by repo-relative path, or null if missing. */
  readFile: (rel: string) => string | null
  gitLog: CommitSummary[]
  gitleaks: GitleaksFinding[]
  osv: OsvFinding[]
}

/* -------------------------------------------------------------------------- */
/* The assembled context                                                       */
/* -------------------------------------------------------------------------- */

export interface RepoCheckContext {
  owner: string
  name: string
  defaultBranch: string
  api: RepoApiContext
  /** Present only on a `deep` scan. Checks reading it stay silent otherwise. */
  clone?: RepoCloneContext
}

/* -------------------------------------------------------------------------- */
/* Findings, checks, scores                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One concrete problem found in a repo. Same fields as the site Finding so the
 * two report surfaces and fix-prompt machinery can share a shape — but
 * `category` is a RepoCategory, so a repo finding can never be misfiled under a
 * site pillar by a query that types it correctly.
 */
export interface RepoFinding {
  checkId: string
  category: RepoCategory
  severity: Severity
  title: string
  description: string
  /** Raw observed values backing the claim — shown to the user, never guessed. */
  evidence?: Record<string, unknown>
  /** Human instructions: what to change and where. */
  remediation: string
  /** Copy-paste prompt for an AI coding agent to apply the fix. */
  fixPrompt: string
}

/** A check that crashed or timed out — a bug in US, never a finding about the repo. */
export interface RepoCheckError {
  checkId: string
  message: string
}

export interface RepoCheck {
  /** Stable, dot-namespaced id, e.g. "ci-cd.no-branch-protection". Never rename — DB key. */
  id: string
  category: RepoCategory
  title: string
  run(ctx: RepoCheckContext): Promise<RepoFinding[]> | RepoFinding[]
}

/** 0–100 per pillar plus the overall aggregate. Mirrors ScanScores in shape. */
export interface RepoScanScores {
  secrets: number
  'supply-chain': number
  'ci-cd': number
  'code-quality': number
  dependencies: number
  governance: number
  overall: number
  /** Pillars whose score is provisional because a check in them failed to complete. */
  degraded: RepoCategory[]
}
