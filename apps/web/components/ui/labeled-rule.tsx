/**
 * `[ 02 ] COVERAGE ───────────────── 27 CHECKS`
 *
 * The one structural device this design has. With no accent colour left, every
 * boundary in the product is a hairline and every heading is announced by a
 * label that reads like a field name — so that pattern is defined once and
 * used by the landing page's sections, the report's pillars and every app
 * screen's header. Three copies of it would drift within a week.
 *
 * `as` exists because the same visual has to be an <h2> where it heads a
 * region and a <p> where it is only a caption; a heading level is a fact about
 * the document, not about the styling.
 */

export function LabeledRule({
  index,
  label,
  trailing,
  as: Tag = 'p',
  id,
}: {
  /** Position in a numbered run, rendered as `[ 03 ]`. Omit when unnumbered. */
  index?: number
  label: string
  /** Optional right-hand value, after the rule. */
  trailing?: React.ReactNode
  as?: 'h1' | 'h2' | 'h3' | 'p'
  id?: string
}) {
  return (
    <div className="flex items-center gap-4">
      <Tag {...(id ? { id } : {})} className="label shrink-0 text-ink">
        {index !== undefined && `[ ${String(index).padStart(2, '0')} ] `}
        {label}
      </Tag>
      <span aria-hidden="true" className="h-px flex-1 bg-line" />
      {trailing !== undefined && <span className="label shrink-0 text-muted">{trailing}</span>}
    </div>
  )
}
