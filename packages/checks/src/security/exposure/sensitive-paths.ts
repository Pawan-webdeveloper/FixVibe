/**
 * Files that are in the web root and should not be.
 *
 * All of these come from one cause — the server hands out whatever is in the
 * directory, including things the deploy was never meant to include — and one
 * fix. So they are reported as a single finding listing what was found, rather
 * than one critical per file, which would take a hundred points off a score for
 * a single mistake and say less about it.
 *
 * A path is only reported when its body is genuinely that file. See paths.ts:
 * an app shell answering 200 for every unknown route is the normal case, not
 * the interesting one.
 */

import { SEVERITY_ORDER, type Check, type Finding, type Severity } from '../../types.ts'
import { SENSITIVE_PATHS, type SensitivePath } from './paths.ts'

const ID = 'security.exposure.sensitive-paths'

function worst(found: SensitivePath[]): Severity {
  return found
    .map((f) => f.severity)
    .sort((a, b) => SEVERITY_ORDER.indexOf(a) - SEVERITY_ORDER.indexOf(b))[0] as Severity
}

export const sensitivePathsCheck: Check = {
  id: ID,
  category: 'security',
  title: 'Exposed sensitive files',

  async run(ctx) {
    // Probed together, not in sequence. Five round trips one after another added
    // seconds to every scan while none of them depends on the last.
    const results = await Promise.all(
      SENSITIVE_PATHS.map(async (candidate) => {
        const response = await ctx.probe(candidate.path)
        // null is "we could not ask"; a non-200 is a correctly closed door.
        if (response?.status !== 200) return null
        return candidate.looksReal(response.body) ? candidate : null
      }),
    )
    // Filtered back into catalogue order so two scans of one site agree.
    const found = results.filter((c): c is SensitivePath => c !== null)

    if (found.length === 0) return []

    const labels = found.map((f) => f.label)
    const detail = found.map((f) => `${f.label} — ${f.impact}`)

    return [
      {
        checkId: ID,
        category: 'security',
        severity: worst(found),
        title:
          found.length === 1
            ? `${labels[0]} is publicly readable`
            : `${found.length} sensitive files are publicly readable`,
        description:
          `These files answer to anyone who asks for them by name: ${detail.join('; ')}. ` +
          'They are found by automated scanners within hours of a deploy, so exposure and discovery ' +
          'are close to the same event — treat anything they contain as already public.',
        evidence: {
          // The paths, never the contents. Recording a leaked credential in our
          // own database would turn one exposure into two.
          exposed: labels.map((label) => new URL(label.startsWith('/') ? label : `/${label}`, ctx.finalUrl).href),
        },
        remediation:
          'Stop serving these paths, then rotate every credential they contained — removal does not ' +
          'un-leak what was already fetched.',
        fixPrompt:
          `This site serves these files publicly: ${labels.join(', ')}.\n\n` +
          'Do both, in this order:\n' +
          '1. ROTATE every secret in them. They must be assumed compromised; automated scanners find ' +
          'these paths within hours, and removing the file does not recall what was already read.\n' +
          '2. Stop serving them. Move the deploy to publishing a build directory rather than the ' +
          'project root, and deny dotfiles and .git at the web server or CDN. Add the files to ' +
          '.gitignore and to the deploy ignore list so they cannot come back.\n\n' +
          'Then check how they got there — a deploy that copies the project root is the usual cause, ' +
          'and it will re-introduce them on the next release.',
      } satisfies Finding,
    ]
  },
}
