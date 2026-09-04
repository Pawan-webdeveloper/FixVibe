/**
 * apps/web/components/monitors/run-check-button-logic.ts
 *
 * The pure helpers behind RunCheckButton.
 *
 * The component itself depends on browser APIs (fetch, setTimeout,
 * useState) so it cannot run under vitest's `environment: 'node'`.
 * Splitting the comparison and the polling loop out keeps the
 * decision "is this log row newer than the baseline?" testable
 * without React.
 *
 * Two pieces:
 *   - `isLogRowNewer`: pure, one row in, boolean out.
 *   - `runLogPoll`: the orchestrator. Synchronous caller; returns
 *     a Promise that resolves when the loop exits. The Promise is
 *     stored in a closure so the cancel function can settle it.
 *
 * `runLogPoll` returns an `AbortController`-style handle — `done`
 * is the Promise the caller can await, `cancel` is the function
 * that aborts the loop and settles `done` with `stop: 'cancelled'`.
 */

export interface LogRow {
  id: string
  ts: string
}

export interface LogBaseline {
  firstId: string | null
  firstTs: string | null
}

export interface PollResult {
  stop: 'hit' | 'deadline' | 'cancelled'
}

export interface PollOptions {
  monitorId: string
  baseline: LogBaseline | null
  intervalMs: number
  timeoutMs: number
  fetcher: (url: string) => Promise<{ logs?: LogRow[] } | null>
  sleep: (ms: number) => Promise<void>
  now: () => number
  onHit: () => void
  onDeadline: () => void
}

export interface PollHandle {
  cancel: () => void
  done: Promise<PollResult>
}

/**
 * Pure comparator: a fetched row counts as "newer" when either its
 * id differs from the cached one OR its timestamp is later. The two
 * checks are belt-and-braces — a different id already proves it,
 * but the timestamp lets the caller pass a partial baseline.
 */
export function isLogRowNewer(row: LogRow, baseline: LogBaseline | null): boolean {
  if (baseline === null) return true
  if (baseline.firstId !== null && row.id !== baseline.firstId) return true
  if (baseline.firstTs !== null && row.ts > baseline.firstTs) return true
  return false
}

/**
 * Polling orchestrator. Loops until either:
 *   - the fetcher returns a row that `isLogRowNewer` says is new
 *     → onHit, stop
 *   - `timeoutMs` elapses without a new row
 *     → onDeadline, stop
 *   - `cancel()` is called
 *     → no callback, stop
 *
 * Returns a `PollHandle` whose `done` Promise resolves with the
 * reason the loop exited. The Promise is settled exactly once.
 *
 * Implementation note: the loop runs in a setImmediate chain rather
 * than as a single `async` function so `cancel()` can synchronously
 * short-circuit the next iteration without leaving the previous
 * frame's microtasks unresolved. This avoids the "unhandled promise
 * on vitest worker shutdown" failure mode that bit us earlier.
 */
export function runLogPoll(opts: PollOptions): PollHandle {
  let stopped = false
  type Stop = PollResult['stop']
  let resolveDone: ((r: PollResult) => void) | null = null

  const done = new Promise<PollResult>((resolve) => {
    resolveDone = resolve
  })

  const settle = (stop: Stop): void => {
    if (stopped) return
    stopped = true
    const r = resolveDone
    resolveDone = null
    if (r !== null) r({ stop })
  }

  const startedAt = opts.now()

  const step = async (): Promise<void> => {
    if (stopped) return
    if (opts.now() - startedAt >= opts.timeoutMs) {
      opts.onDeadline()
      settle('deadline')
      return
    }

    await opts.sleep(opts.intervalMs)
    if (stopped) return

    try {
      const body = await opts.fetcher(`/api/monitors/${opts.monitorId}/logs?limit=1`)
      if (stopped) return
      const newest = body?.logs?.[0]
      if (newest && isLogRowNewer(newest, opts.baseline)) {
        opts.onHit()
        settle('hit')
        return
      }
    } catch {
      // network blip — try again on the next step
    }

    if (stopped) return
    // Schedule the next step on the macrotask queue so cancellation
    // gets a chance to fire between steps. `setTimeout(..., 0)` is supported
    // in both browsers and Node.js environments.
    setTimeout(() => {
      void step()
    }, 0)
  }

  setTimeout(() => {
    void step()
  }, 0)

  return {
    cancel: () => settle('cancelled'),
    done,
  }
}
