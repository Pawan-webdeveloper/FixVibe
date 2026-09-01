/**
 * The Feed page: connected GitHub repositories and their scan status.
 *
 * Shows all repos across the user's GitHub App installations, with the
 * ability to trigger shallow or deep scans. When no GitHub App is connected,
 * a prominent CTA redirects to the GitHub App installation page.
 */

import Link from 'next/link'
import {
  listInstallationsForViewer,
  listReposForInstallation,
  listRepoScansForRepo,
  type GithubRepo,
  type RepoScan,
} from '@scanlyfix/db'
import { getViewer, requireUser } from '@/lib/authz.ts'
import { serverEnv } from '@/lib/env.ts'
import { Icon } from '@/components/console/icons.tsx'
import { ScanRepoButton } from './scan-repo-button.tsx'

export const metadata = { title: 'Feed' }

function stamp(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

function scoreTone(score: number | null): string {
  if (score === null) return 'text-c-muted'
  if (score >= 90) return 'text-emerald-600'
  if (score >= 70) return 'text-amber-600'
  return 'text-sev-high'
}

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
}

export default async function FeedPage() {
  const user = await requireUser('/feed')
  const viewer = await getViewer()
  const installations = await listInstallationsForViewer(viewer)

  // Fetch repos per installation to avoid the broken cross-table join
  const repoLists = await Promise.all(
    installations.map((inst) => listReposForInstallation(inst.id)),
  )
  const repos = repoLists.flat()

  const hasInstallations = installations.length > 0
  const githubUrl = serverEnv.githubConfigured
    ? `https://github.com/apps/${serverEnv.githubAppSlug}/installations/new`
    : null

  // Fetch the latest scan for each repo (small N, acceptable latency)
  const reposWithScans: { repo: GithubRepo; latestScan: RepoScan | null }[] = []
  for (const repo of repos) {
    const scans = await listRepoScansForRepo(repo.id, 1)
    reposWithScans.push({ repo, latestScan: scans[0] ?? null })
  }

  return (
    <div className="console flex min-h-dvh flex-col bg-c-bg text-c-ink">
      <TopBar />

      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-12 px-6 py-10 sm:px-10 sm:py-14">
        {/* Connect GitHub CTA — shown when no installations exist */}
        {!hasInstallations && githubUrl && (
          <section className="relative overflow-hidden rounded-2xl border border-c-line/60 bg-c-card shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-c-gradient-sky/30 blur-3xl" />
            <div className="pointer-events-none absolute -left-16 bottom-0 h-48 w-48 rounded-full bg-c-gradient-lavender/25 blur-3xl" />
            <div className="relative px-8 py-12 text-center sm:px-12">
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-c-soft text-c-muted">
                <Icon name="repo" size={26} />
              </span>
              <h2 className="mt-5 text-[28px] font-light leading-tight tracking-[-0.02em] text-c-ink">
                Connect your GitHub
              </h2>
              <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-c-body">
                Install the ScanlyFix GitHub App to scan your repositories for
                secrets, vulnerable dependencies, and workflow misconfigurations.
              </p>
              <a
                href={githubUrl}
                className="mt-8 inline-flex items-center gap-2.5 rounded-full bg-c-ink px-7 py-3 text-[14px] font-medium text-c-brand-ink transition-opacity hover:opacity-90"
              >
                <Icon name="repo" size={16} className="text-c-brand-ink" />
                Install GitHub App
              </a>
            </div>
          </section>
        )}

        {/* Repositories */}
        <section id="repositories">
          <div className="mb-4 flex items-end justify-between gap-4">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-c-muted">
              Repositories
            </h2>
            {hasInstallations && githubUrl && (
              <a
                href={githubUrl}
                className="rounded-full bg-c-soft px-4 py-1.5 text-[12px] font-medium text-c-muted transition-colors hover:bg-c-line hover:text-c-ink"
              >
                + Connect another
              </a>
            )}
          </div>

          {repos.length === 0 ? (
            <div className="rounded-xl border border-c-line/60 bg-c-card p-12 text-center shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              <p className="text-[16px] font-medium text-c-ink">No repositories connected</p>
              <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-c-muted text-pretty">
                {githubUrl
                  ? 'Install the GitHub App above to start scanning your repositories.'
                  : 'Ask your admin to configure the GitHub App to enable repository scanning.'}
              </p>
            </div>
          ) : (
            <ul className="rounded-xl border border-c-line/60 bg-c-card shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              {reposWithScans.map(({ repo, latestScan }, index) => (
                <li key={repo.id} className={index === 0 ? '' : 'border-t border-c-line/60'}>
                  <div className="flex items-center gap-4 px-6 py-5">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-c-soft text-c-muted">
                      <Icon name="repo" size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium text-c-ink">
                        {repo.fullName}
                      </p>
                      <p className="truncate text-[13px] text-c-muted">
                        {repo.private ? 'Private' : 'Public'} · {repo.defaultBranch}
                      </p>
                    </div>

                    {/* Latest scan status */}
                    <div className="hidden shrink-0 text-right sm:block">
                      {latestScan ? (
                        <>
                          <p className={`console-num text-[20px] font-light tracking-tight ${scoreTone(latestScan.scores?.overall ?? null)}`}>
                            {latestScan.scores?.overall ?? '—'}
                          </p>
                          <p className="text-[12px] text-c-muted">
                            {STATUS_LABEL[latestScan.status] ?? latestScan.status}
                          </p>
                        </>
                      ) : (
                        <p className="text-[13px] text-c-muted">Not scanned</p>
                      )}
                    </div>

                    {/* Scan buttons */}
                    <ScanRepoButton repoId={repo.id} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Installation list — when multiple installations exist */}
        {installations.length > 1 && (
          <section>
            <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-c-muted">
              Connected accounts
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {installations.map((inst) => (
                <div
                  key={inst.id}
                  className="rounded-xl border border-c-line/60 bg-c-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
                >
                  <div className="flex items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-c-soft text-[13px] font-medium text-c-ink">
                      {inst.accountLogin.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-medium text-c-ink">
                        {inst.accountLogin}
                      </p>
                      <p className="text-[12px] text-c-muted">{inst.accountType}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function TopBar() {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-c-line/60 bg-c-bg/80 backdrop-blur-md px-6 sm:px-10">
      <div className="min-w-0 pl-12 lg:pl-0">
        <p className="truncate text-[15px] font-medium text-c-ink">Feed</p>
      </div>
    </header>
  )
}
