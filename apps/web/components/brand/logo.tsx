/**
 * The product's mark: the skull, on the dark chip it was drawn to sit on.
 *
 * The logo art is a single-colour white skull on transparency — it only reads
 * on a dark ground, exactly as the original (white-on-black) artwork intended.
 * So the chip carries its OWN fixed dark background rather than a theme token:
 * `--ink` flips to a light colour in dark mode, and the hero surface flips the
 * other way, and either flip would leave a white skull invisible. A constant
 * dark chip shows the mark identically on the light app, a dark app, and the
 * hero's coloured panel alike.
 *
 * Replaces the old arc BrandMark. It appears in the header, the hero, the app
 * nav, the sign-in card and the error screens, so it is one component; copies
 * would drift.
 */

/** The chip's background. Fixed, not a token — see the note above. */
const CHIP_BG = '#0b0d10'

export function LogoBadge({ size = 28, className = '' }: { size?: number; className?: string }) {
  // The skull sits inside the chip with a little air, the way the favicon does.
  const inner = Math.round(size * 0.7)
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden ${className}`}
      style={{ width: size, height: size, background: CHIP_BG, borderRadius: Math.round(size * 0.26) }}
    >
      {/* Decorative: the surrounding link/heading names the product. A plain
          img, not next/image — a fixed-size local mark needs no optimisation. */}
      <img
        src="/logo-skull.png"
        alt=""
        aria-hidden="true"
        width={inner}
        height={inner}
        style={{ width: inner, height: inner, objectFit: 'contain' }}
      />
    </span>
  )
}

/**
 * The badge with the wordmark beside it — the usual header/nav lockup.
 *
 * `tone` picks the wordmark colour: 'ink' for the app's own surfaces, 'hero'
 * for the hero panel whose text colour is its own token. The badge does not
 * change either way; only the text does.
 */
export function LogoLockup({
  size = 26,
  word = 'scanlyfix',
  tone = 'ink',
  className = '',
}: {
  size?: number
  word?: string
  tone?: 'ink' | 'hero'
  className?: string
}) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <LogoBadge size={size} />
      <span
        className={`font-semibold tracking-tight ${tone === 'hero' ? 'font-mono text-hero-ink' : ''}`}
        style={{ fontSize: Math.round(size * 0.58) }}
      >
        {word}
      </span>
    </span>
  )
}
