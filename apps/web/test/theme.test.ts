/**
 * The theme resolution, locked down.
 *
 * Two layers are tested here. The pure rule (resolveTheme) covers every
 * combination of preference and OS setting, because a wrong priority there
 * means a user's explicit choice silently loses to their operating system.
 * The inline init script is EXECUTED against a stubbed browser, because it
 * duplicates that rule in plain JS (an inline script cannot import a module) —
 * running it is the only way to prove the copy has not drifted, the classes
 * land on <html>, and a stale class from a previous choice is removed rather
 * than left to fight the new one.
 */

import { describe, expect, it } from 'vitest'
import {
  THEME_KEY,
  applyTheme,
  isThemePreference,
  readStoredPreference,
  resolveTheme,
  storePreference,
  themeInitScript,
} from '../lib/theme.ts'

/* -------------------------------------------------------------------------- */
/* The stubbed browser                                                        */
/* -------------------------------------------------------------------------- */

interface BrowserConfig {
  /** What localStorage holds under THEME_KEY: a value, or absent. */
  stored?: string
  systemDark: boolean
  /** Classes already on <html> before the script runs. */
  initialClasses?: string[]
}

/**
 * Installs just enough browser on globalThis for lib/theme.ts and the init
 * script to run under the node test environment, and restores whatever was
 * there afterwards — the node process may have its own globals under these
 * names, and vitest workers share them across test files.
 */
function withBrowser<T>(config: BrowserConfig, run: () => T): T {
  const classes = new Set(config.initialClasses)
  const store = new Map<string, string>(config.stored === undefined ? [] : [[THEME_KEY, config.stored]])

  const document = { documentElement: { classList: {
    add: (...names: string[]) => names.forEach((n) => classes.add(n)),
    remove: (...names: string[]) => names.forEach((n) => classes.delete(n)),
    contains: (name: string) => classes.has(name),
  } } }
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  }
  const matchMedia = () => ({ matches: config.systemDark })
  const window = { localStorage, matchMedia }

  const originals = {
    document: globalThis.document,
    localStorage: (globalThis as Record<string, unknown>).localStorage,
    window: (globalThis as Record<string, unknown>).window,
    matchMedia: (globalThis as Record<string, unknown>).matchMedia,
  }
  Object.assign(globalThis, { document, localStorage, window, matchMedia })

  try {
    return run()
  } finally {
    Object.assign(globalThis, originals)
  }
}

/* Read <html>'s classes back through the stub. */
function hasClass(name: string): boolean {
  const doc = globalThis.document as unknown as { documentElement: { classList: { contains(n: string): boolean } } }
  return doc.documentElement.classList.contains(name)
}

function runInitScript(): void {
  // The script is authored as a string for inlining; new Function is the
  // smallest way to execute exactly those bytes in the test process.
  new Function(themeInitScript)()
}

/* -------------------------------------------------------------------------- */
/* The preference type                                                        */
/* -------------------------------------------------------------------------- */

describe('theme preference type', () => {
  it('accepts exactly the three states the toggle offers', () => {
    expect(isThemePreference('light')).toBe(true)
    expect(isThemePreference('system')).toBe(true)
    expect(isThemePreference('dark')).toBe(true)
  })

  it('rejects everything else, so a corrupt storage value degrades to system', () => {
    for (const bad of ['LIGHT', 'auto', '', 'dark ', 'null', 0, true, null, undefined]) {
      expect(isThemePreference(bad), String(bad)).toBe(false)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* The resolution rule                                                        */
/* -------------------------------------------------------------------------- */

describe('resolveTheme', () => {
  it('an explicit choice wins over the OS in both directions', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('light', false)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('dark', true)).toBe('dark')
  })

  it('system and no-choice follow the OS', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme(null, true)).toBe('dark')
    expect(resolveTheme(null, false)).toBe('light')
  })
})

/* -------------------------------------------------------------------------- */
/* The stored preference                                                      */
/* -------------------------------------------------------------------------- */

describe('readStoredPreference', () => {
  it('reads a valid stored choice', () => {
    withBrowser({ stored: 'dark', systemDark: false }, () => {
      expect(readStoredPreference()).toBe('dark')
    })
  })

  it('degrades to system when nothing is stored or the value is corrupt', () => {
    withBrowser({ systemDark: false }, () => {
      expect(readStoredPreference()).toBe('system')
    })
    withBrowser({ stored: 'purple', systemDark: false }, () => {
      expect(readStoredPreference()).toBe('system')
    })
  })
})

describe('storePreference', () => {
  it('writes the choice under the one key the init script reads', () => {
    withBrowser({ systemDark: false }, () => {
      storePreference('dark')
      expect(globalThis.localStorage.getItem(THEME_KEY)).toBe('dark')
    })
  })
})

/* -------------------------------------------------------------------------- */
/* Applying to <html>                                                         */
/* -------------------------------------------------------------------------- */

describe('applyTheme', () => {
  it('puts exactly one theme class on <html>, never both', () => {
    withBrowser({ systemDark: false, initialClasses: ['dark'] }, () => {
      applyTheme('light')
      expect(hasClass('light')).toBe(true)
      expect(hasClass('dark')).toBe(false)
    })
  })

  it('resolves system against the OS at the moment it is applied', () => {
    withBrowser({ systemDark: true }, () => {
      applyTheme('system')
      expect(hasClass('dark')).toBe(true)
      expect(hasClass('light')).toBe(false)
    })
    withBrowser({ systemDark: false }, () => {
      applyTheme('system')
      expect(hasClass('light')).toBe(true)
    })
  })

  it('an explicit dark beats a light OS', () => {
    withBrowser({ systemDark: false }, () => {
      applyTheme('dark')
      expect(hasClass('dark')).toBe(true)
    })
  })
})

/* -------------------------------------------------------------------------- */
/* The inline init script                                                     */
/* -------------------------------------------------------------------------- */

describe('themeInitScript', () => {
  it('reads the same key the app writes, so the two cannot drift', () => {
    expect(themeInitScript).toContain(THEME_KEY)
    expect(themeInitScript).toContain('prefers-color-scheme: dark')
  })

  it('dark stored choice is on <html> before paint, even on a light OS', () => {
    withBrowser({ stored: 'dark', systemDark: false }, () => {
      runInitScript()
      expect(hasClass('dark')).toBe(true)
      expect(hasClass('light')).toBe(false)
    })
  })

  it('light stored choice survives a dark OS', () => {
    withBrowser({ stored: 'light', systemDark: true }, () => {
      runInitScript()
      expect(hasClass('light')).toBe(true)
      expect(hasClass('dark')).toBe(false)
    })
  })

  it('system mode follows the OS at first paint', () => {
    withBrowser({ stored: 'system', systemDark: true }, () => {
      runInitScript()
      expect(hasClass('dark')).toBe(true)
    })
    withBrowser({ stored: 'system', systemDark: false }, () => {
      runInitScript()
      expect(hasClass('light')).toBe(true)
    })
  })

  it('no stored value behaves as system', () => {
    withBrowser({ systemDark: true }, () => {
      runInitScript()
      expect(hasClass('dark')).toBe(true)
    })
  })

  it('a corrupt stored value behaves as system, not as a crash', () => {
    withBrowser({ stored: 'shiny', systemDark: false }, () => {
      runInitScript()
      expect(hasClass('light')).toBe(true)
    })
  })

  it('removes a stale class instead of leaving both on <html>', () => {
    withBrowser({ stored: 'dark', systemDark: false, initialClasses: ['light'] }, () => {
      runInitScript()
      expect(hasClass('dark')).toBe(true)
      expect(hasClass('light')).toBe(false)
    })
  })

  it('a throwing localStorage leaves the page on its current theme', () => {
    withBrowser({ systemDark: true }, () => {
      // A storage that refuses to read: private mode, blocked partition.
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        get() {
          throw new Error('blocked')
        },
      })
      expect(() => runInitScript()).not.toThrow()
      expect(hasClass('light')).toBe(false)
      expect(hasClass('dark')).toBe(false)
    })
  })
})
