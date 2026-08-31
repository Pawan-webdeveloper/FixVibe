/**
 * Narrow typed reads over a GitHub Actions workflow file.
 *
 * A workflow is YAML, and YAML is a format where `- name:` and `name:` are
 * different keys and a `permissions:` line at the top means something
 * different from one indented under a job. A regex against the raw text would
 * misread both, and a misread here is a false positive a paying customer sees.
 * So the file is parsed once with a real parser and the checks read narrow,
 * typed fields off the result.
 *
 * `null` is the failure signal: a workflow that does not parse stays silent
 * rather than reporting a defect off a structure nobody could read. Same rule
 * as the site checks' `crawl`/`rendered`: absence of evidence is not evidence.
 */

import { parseDocument } from 'yaml'
import type { WorkflowFile } from '../types.ts'

export interface ParsedStep {
  /** Present for an action step (`uses:`). Includes the @ref, e.g. "actions/checkout@v4". */
  uses?: string
  /** Present for a run step. */
  run?: string
  with?: Record<string, unknown>
  name?: string
}

export interface ParsedJob {
  /** The job's key in the `jobs:` map — stable across the file. */
  id: string
  name?: string
  /** Job-level concurrency, or undefined. Workflow-level is read separately. */
  concurrency?: unknown
  timeoutMinutes?: number
  steps: ParsedStep[]
}

export interface ParsedWorkflow {
  /** Event names under `on:`, flattened (`on: push` and `on: [push, pull_request]` both yield an array). */
  on: string[]
  /** 'write-all' | a permissions object | undefined (absent). */
  permissions: 'write-all' | Record<string, string> | undefined
  /** Workflow-level concurrency, or undefined. */
  concurrency?: unknown
  jobs: ParsedJob[]
}

/**
 * Parse a workflow's YAML. Returns null on any parse error or non-object root
 * so callers stay silent instead of reasoning about a half-read structure.
 */
export function parseWorkflow(file: WorkflowFile): ParsedWorkflow | null {
  const doc = parseDocument(file.yaml)
  const root = doc.toJS({ maxAliasCount: 1 }) as unknown
  if (!root || typeof root !== 'object' || Array.isArray(root)) return null

  const r = root as Record<string, unknown>
  const on = readOn(r['on'])
  const permissions = readPermissions(r['permissions'])
  const jobsRaw = r['jobs']
  const jobs = readJobs(jobsRaw)

  return { on, permissions, concurrency: r['concurrency'], jobs }
}

function readOn(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  if (value && typeof value === 'object') return Object.keys(value as Record<string, unknown>)
  return []
}

function readPermissions(value: unknown): ParsedWorkflow['permissions'] {
  if (typeof value === 'string') return value === 'write-all' ? 'write-all' : {}
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, string>
  }
  return undefined
}

function readJobs(value: unknown): ParsedJob[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const entries = Object.entries(value as Record<string, unknown>)
  const jobs: ParsedJob[] = []
  for (const [id, jobRaw] of entries) {
    if (!jobRaw || typeof jobRaw !== 'object') continue
    const job = jobRaw as Record<string, unknown>
    const timeout = job['timeout-minutes']
    jobs.push({
      id,
      name: typeof job['name'] === 'string' ? job['name'] : undefined,
      concurrency: job['concurrency'],
      timeoutMinutes: typeof timeout === 'number' ? timeout : undefined,
      steps: readSteps(job['steps']),
    })
  }
  return jobs
}

function readSteps(value: unknown): ParsedStep[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
    .map((s) => ({
      uses: typeof s['uses'] === 'string' ? s['uses'] : undefined,
      run: typeof s['run'] === 'string' ? s['run'] : undefined,
      with:
        s['with'] && typeof s['with'] === 'object' && !Array.isArray(s['with'])
          ? (s['with'] as Record<string, unknown>)
          : undefined,
      name: typeof s['name'] === 'string' ? s['name'] : undefined,
    }))
}

/** Is this `uses` ref a commit SHA (40 hex, or the 7+ hex short form)? */
export function isCommitSha(ref: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(ref)
}

/** Is this `uses` a local action (`./path`) rather than a repo reference? */
export function isLocalAction(uses: string): boolean {
  return uses.startsWith('./')
}

/**
 * First-party actions maintained by GitHub. Lower supply-chain risk than a
 * third-party `uses:` and deliberately not flagged for pinning — the signal
 * would be noise against a real third-party action drifting to a new tag.
 */
const FIRST_PARTY = ['actions/', 'github/']

export function isFirstPartyAction(uses: string): boolean {
  const name = uses.split('@')[0]!
  return FIRST_PARTY.some((prefix) => name.startsWith(prefix))
}
