/**
 * Every function the serve handler exposes.
 *
 * A function missing from this list is registered nowhere and runs never —
 * silently, with no error and nothing in a log to notice. One file, so the
 * question "is this job live?" has one place to answer it.
 */

export { sweepMonitors } from './functions/sweep.ts'
export { uptimeProbe } from './functions/uptime-probe.ts'
export { rescanProject } from './functions/scheduled-rescan.ts'
export { domainHealth } from './functions/domain-health.ts'
export { runScanQueued } from './functions/run-scan.ts'

import { sweepMonitors } from './functions/sweep.ts'
import { uptimeProbe } from './functions/uptime-probe.ts'
import { rescanProject } from './functions/scheduled-rescan.ts'
import { domainHealth } from './functions/domain-health.ts'
import { runScanQueued } from './functions/run-scan.ts'

export const functions = [sweepMonitors, uptimeProbe, rescanProject, domainHealth, runScanQueued]
