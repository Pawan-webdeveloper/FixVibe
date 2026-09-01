/**
 * The scanner binaries this image ships with, pinned.
 *
 * The Dockerfile downloads gitleaks and osv-scanner at the exact versions below
 * and verifies each against its upstream SHA-256 checksum before the image can
 * build. These constants repeat the same pins so the running service can report
 * — and a test can assert — which toolchain it was built with.
 *
 * If you bump a version, bump BOTH places: the ARG + checksum in the Dockerfile
 * and the constant here. `detectToolVersions()` exists to catch the two drifting
 * apart: it asks each installed binary what it actually is and compares.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const pExecFile = promisify(execFile)

export const GITLEAKS_VERSION = '8.30.1'
export const OSV_SCANNER_VERSION = '2.5.1'

export interface ToolStatus {
  name: 'gitleaks' | 'osv-scanner'
  /** The version this build pins and reports as registered. */
  pinned: string
  /** The version the installed binary reports, or null if it would not run. */
  detected: string | null
  /** True when the binary ran at all. */
  present: boolean
  /** True when what is installed matches the pin exactly. */
  matchesPin: boolean
}

/**
 * The registered toolchain, as declared (not as detected). Used by /health so a
 * liveness probe never shells out to the binaries.
 */
export function registeredToolVersions(): { gitleaks: string; osvScanner: string } {
  return { gitleaks: GITLEAKS_VERSION, osvScanner: OSV_SCANNER_VERSION }
}

/**
 * Ask each installed binary what it is and compare it to the pin. This is how a
 * deploy proves the image really contains the pinned, checksum-verified tools —
 * a mismatch (or a missing binary) shows up here instead of as a silent no-op
 * scan.
 */
export async function detectToolVersions(): Promise<ToolStatus[]> {
  const [gitleaks, osv] = await Promise.all([
    detect('gitleaks', ['version'], GITLEAKS_VERSION),
    detect('osv-scanner', ['--version'], OSV_SCANNER_VERSION),
  ])
  return [gitleaks, osv]
}

async function detect(
  name: 'gitleaks' | 'osv-scanner',
  args: string[],
  pinned: string,
): Promise<ToolStatus> {
  let detected: string | null = null
  try {
    // Both CLIs print a version string; we pull the first semver out of it so
    // surrounding text ("gitleaks version 8.30.1", build metadata) does not
    // matter. A short timeout keeps a wedged binary from hanging /version.
    const { stdout, stderr } = await pExecFile(name, args, { timeout: 5_000 })
    detected = firstSemver(`${stdout}\n${stderr}`)
  } catch (error) {
    // Some CLIs exit non-zero for --version yet still print the version, so
    // scrape the output before giving up.
    const out = (error as { stdout?: string; stderr?: string }) ?? {}
    detected = firstSemver(`${out.stdout ?? ''}\n${out.stderr ?? ''}`)
  }
  return {
    name,
    pinned,
    detected,
    present: detected !== null,
    matchesPin: detected === pinned,
  }
}

const SEMVER = /(\d+\.\d+\.\d+)/

function firstSemver(text: string): string | null {
  return SEMVER.exec(text)?.[1] ?? null
}
