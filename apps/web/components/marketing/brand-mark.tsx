/**
 * The product's mark: the same partial arc the report's ScoreRing draws.
 *
 * Reusing that geometry rather than inventing a logo means the mark in the
 * corner and the number people screenshot are recognisably the same object.
 * Defined once because it appears in three places — the site header, the hero
 * nav and the hero wordmark — and three copies would drift.
 *
 * Decorative in every current use: the element wrapping it carries the
 * accessible name, so it is hidden rather than announced twice.
 */

const RADIUS = 10.5
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
/** Matches ScoreRing's mid-band arc. */
const SWEEP = 0.72

export function BrandMark({
  size = 18,
  track = 'var(--line)',
  arc = 'var(--accent)',
}: {
  size?: number
  /** The unfilled ring. */
  track?: string
  /** The filled sweep. */
  arc?: string
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <g transform="rotate(-90 12 12)">
        <circle cx="12" cy="12" r={RADIUS} fill="none" stroke={track} strokeWidth="3" />
        <circle
          cx="12"
          cy="12"
          r={RADIUS}
          fill="none"
          stroke={arc}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${CIRCUMFERENCE * SWEEP} ${CIRCUMFERENCE}`}
        />
      </g>
    </svg>
  )
}
