import { Section, SectionHeading } from './section.tsx'
import { SAMPLE_FIX_PROMPT } from './sample-report.ts'

/**
 * The wedge.
 *
 * Every other scanner ends at a list of problems and leaves the translation
 * into work to the reader. This one ends at a work order, and the excerpt is
 * shown rather than described because the interesting part is not that it
 * exists — it is what it knows. The DNS section in the excerpt is deliberate:
 * an agent told to "fix SPF" will otherwise edit a file and report success.
 */
export function FixPrompt() {
  return (
    <Section>
      <SectionHeading
        index={4}
        eyebrow="Output"
        title="It ends in a fix, not a PDF."
        lead="One prompt for the whole report, grouped by where the change is actually made — response headers in one edit, DNS records marked as not-code, page markup in the shared template. Paste it into Claude Code, Cursor, or your own agent."
      />

      <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-12">
        <figure className="min-w-0">
          <div className="overflow-hidden border border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted">
                fix-prompt.md
              </p>
              <p className="font-mono text-[10px] text-muted">excerpt</p>
            </div>
            <pre
              // The block scrolls, so it has to be focusable: keyboard-only
              // readers cannot scroll a region they cannot reach.
              tabIndex={0}
              role="region"
              aria-label="Excerpt of the generated fix prompt"
              className="max-h-[26rem] overflow-y-auto px-4 py-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words"
            >
              {SAMPLE_FIX_PROMPT}
            </pre>
          </div>
          <figcaption className="mt-3 text-sm text-muted">
            Generated for the example.com scan above. Truncated here; the real one covers all 15
            actionable findings.
          </figcaption>
        </figure>

        <div className="flex flex-col gap-8">
          <Point title="It knows where, not just what">
            “Add a Content-Security-Policy header” is not actionable until you know whether that
            means <code className="font-mono text-xs">next.config.ts</code>, a{' '}
            <code className="font-mono text-xs">_headers</code> file or an nginx block. Fourteen
            findings that land in the same file become one edit.
          </Point>

          <Point title="It knows the order">
            A leaked credential is rotated first, because every later change is wasted if the key is
            already in someone’s hands.
          </Point>

          <Point title="Or skip the paste entirely">
            Darvin is also an MCP server. Point your editor at it and the agent runs the scan,
            reads the findings and applies the fixes without a report ever being opened.
          </Point>
        </div>
      </div>
    </Section>
  )
}

function Point({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-l-2 border-accent pl-4">
      <h3 className="font-medium">{title}</h3>
      <p className="mt-2 max-w-[46ch] text-sm text-muted text-pretty">{children}</p>
    </div>
  )
}
