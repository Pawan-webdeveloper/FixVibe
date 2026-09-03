/**
 * Every function the serve handler exposes.
 *
 * A function missing from this list is registered nowhere and runs never —
 * silently, with no error and nothing in a log to notice. One file, so the
 * question "is this job live?" has one place to answer it.
 */

/* monitor error — removed duplicate uptimeProbe entry (was listed twice),
 * removed duplicate monitorSweep (sweep.ts already handles this),
 * added monitoringProbe for SSL/domain checks */

import { sweepMonitors } from './functions/sweep.ts'
import { uptimeProbe } from './functions/uptime-probe.ts'
import { rescanProject } from './functions/scheduled-rescan.ts'
import { domainHealth } from './functions/domain-health.ts'
import { runScanQueued } from './functions/run-scan.ts'
import { generateReport } from './functions/generate-report.ts'
import { runRepoScanQueued } from './functions/run-repo-scan.ts'
import { monitoringProbe } from './functions/monitoring-probe.ts'
import { webVitalsProbe } from './functions/web-vitals-probe.ts'

export const functions = [
  sweepMonitors,
  uptimeProbe,
  rescanProject,
  domainHealth,
  runScanQueued,
  runRepoScanQueued,
  generateReport,
  monitoringProbe,
  webVitalsProbe,
]
