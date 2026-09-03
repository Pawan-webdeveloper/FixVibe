/**
 * Utility functions for class name merging.
 *
 * WHY simple implementation: avoiding extra dependencies (clsx, tailwind-merge)
 * for a small utility. This handles the common case of conditional class names.
 */

type ClassValue = string | number | boolean | undefined | null | ClassValue[]

/**
 * Merge class names into a single string.
 * Filters out falsy values and joins with spaces.
 */
export function cn(...inputs: ClassValue[]): string {
  const classes: string[] = []

  for (const input of inputs) {
    if (!input) continue

    if (typeof input === 'string') {
      classes.push(input)
    } else if (Array.isArray(input)) {
      const merged = cn(...input)
      if (merged) classes.push(merged)
    } else if (typeof input === 'number') {
      classes.push(String(input))
    }
  }

  return classes.join(' ')
}
