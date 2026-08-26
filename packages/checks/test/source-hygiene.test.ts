/**
 * A static guard against one specific bug that has shipped twice.
 *
 * Every check builds its user-facing prose by concatenating string literals.
 * The pattern is
 *
 *     `interpolated ${value} text ` +
 *     'more text ' +
 *     'and more.'
 *
 * and the failure is opening a segment with a backtick and closing it with an
 * apostrophe. TypeScript accepts it — the rest of the expression simply
 * becomes part of one long template literal — so the compiler is silent, the
 * tests pass, and the customer reads:
 *
 *     ...busy with JavaScript ' +\n        'during load.
 *
 * printed verbatim in their report. It got into source-maps.ts once and into
 * psi.ts once. Nothing else catches it: it is not a type error, not a lint
 * error, and only visible if a human reads that exact finding's text.
 *
 * So this test parses every source file for template literals and asserts none
 * of them contains a concatenation operator, which inside a template literal
 * can only ever be the artefact above.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const srcDir = fileURLToPath(new URL('../src', import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return path.endsWith('.ts') ? [path] : []
  })
}

/**
 * Template literal contents, skipping `${...}` substitutions so an expression
 * legitimately containing `' + '` inside one is not mistaken for the bug.
 * Deliberately a small scanner rather than a regex: backticks nest through
 * substitutions and a regex cannot follow that.
 */
function templateLiterals(source: string): string[] {
  const found: string[] = []
  let index = 0

  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2
      continue
    }
    // Skip over ordinary strings and comments so their contents cannot be
    // mistaken for the start of a template literal.
    const skipped = skipNonTemplate(source, index)
    if (skipped !== index) {
      index = skipped
      continue
    }
    if (source[index] !== '`') {
      index += 1
      continue
    }

    index += 1
    let text = ''
    let depth = 0
    while (index < source.length) {
      const char = source[index]
      if (char === '\\') {
        index += 2
        continue
      }
      if (depth === 0 && char === '`') break
      if (char === '$' && source[index + 1] === '{') {
        depth += 1
        index += 2
        continue
      }
      if (depth > 0) {
        if (char === '{') depth += 1
        else if (char === '}') depth -= 1
        index += 1
        continue
      }
      text += char
      index += 1
    }
    index += 1
    found.push(text)
  }

  return found
}

/** Returns the index past a string literal or comment starting at `index`, else `index`. */
function skipNonTemplate(source: string, index: number): number {
  const char = source[index]

  if (char === '/' && source[index + 1] === '/') {
    const end = source.indexOf('\n', index)
    return end === -1 ? source.length : end
  }
  if (char === '/' && source[index + 1] === '*') {
    const end = source.indexOf('*/', index + 2)
    return end === -1 ? source.length : end + 2
  }
  if (char === "'" || char === '"') {
    let cursor = index + 1
    while (cursor < source.length) {
      if (source[cursor] === '\\') {
        cursor += 2
        continue
      }
      if (source[cursor] === char) return cursor + 1
      if (source[cursor] === '\n') return index + 1 // unterminated; not our problem
      cursor += 1
    }
    return source.length
  }
  return index
}

describe('source hygiene', () => {
  const files = sourceFiles(srcDir)

  it('finds the source files to check', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it.each(files.map((file) => [file.slice(srcDir.length + 1), file] as const))(
    '%s has no template literal that swallowed a concatenation',
    (_, file) => {
      for (const literal of templateLiterals(readFileSync(file, 'utf8'))) {
        expect(literal, `template literal in this file contains "' +", which means a segment was opened with a backtick and closed with a quote:\n---\n${literal.slice(0, 300)}\n---`).not.toMatch(
          /['"]\s*\+\s*$/m,
        )
      }
    },
  )

  it('detects the bug it exists to catch', () => {
    // The exact shape that shipped twice: backtick in, apostrophe out.
    const broken = "const x = `first ${a} part ' +\n  'second part'"
    expect(templateLiterals(broken).some((literal) => /['"]\s*\+\s*$/m.test(literal))).toBe(true)

    // ...and does not fire on the correct form, nor on a quote used as prose.
    const fine = "const x = `first ${a} part ` +\n  'second part'\nconst y = `it's fine`"
    expect(templateLiterals(fine).some((literal) => /['"]\s*\+\s*$/m.test(literal))).toBe(false)
  })
})
