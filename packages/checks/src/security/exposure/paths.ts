/**
 * The catalogue of paths that should never be reachable, and how to tell a real
 * one from a catch-all route pretending.
 *
 * The `looksReal` predicate is the whole point of this file. A single-page app
 * answers 200 with its shell for every unknown path, so status alone would
 * report a leaked .env on a large share of the internet — the exact failure the
 * sitemap check already taught this codebase about, and a far more damaging one
 * to get wrong. Nothing is reported unless the body is actually the file.
 *
 * The list is short on purpose. Every entry costs one request to somebody
 * else's server on every scan, and the per-scan probe budget is shared with the
 * rest of the registry.
 */

import type { Severity } from '../../types.ts'

export interface SensitivePath {
  path: string
  label: string
  severity: Severity
  /** A 200 counts only when the body is genuinely this file. */
  looksReal: (body: string) => boolean
  /** What an attacker gets from it, in one clause. */
  impact: string
}

export const SENSITIVE_PATHS: readonly SensitivePath[] = [
  {
    path: '/.env',
    label: '.env',
    severity: 'critical',
    // At least one KEY=VALUE line in the shape dotenv actually writes.
    looksReal: (body) => /^[A-Z][A-Z0-9_]*=/m.test(body) && !/^\s*</.test(body),
    impact: 'every credential the application runs on — database, payment keys, mail, third-party APIs',
  },
  {
    path: '/.env.local',
    label: '.env.local',
    severity: 'critical',
    looksReal: (body) => /^[A-Z][A-Z0-9_]*=/m.test(body) && !/^\s*</.test(body),
    impact: 'the developer-local credential set, which usually points at real services',
  },
  {
    path: '/.git/config',
    label: '.git/config',
    severity: 'high',
    looksReal: (body) => /\[core\]/.test(body),
    // Worth its own entry rather than folding into .git/HEAD: a remote line can
    // literally read https://user:token@github.com/org/repo.
    impact: 'the repository remote, and any access token embedded in that URL',
  },
  {
    path: '/.git/HEAD',
    label: '.git/HEAD',
    severity: 'high',
    looksReal: (body) => /^ref:\s+refs\//.test(body) || /^[0-9a-f]{40}\s*$/.test(body.trim()),
    impact: 'the whole repository, including deleted files and every past commit',
  },
  {
    path: '/backup.sql',
    label: 'backup.sql',
    severity: 'critical',
    looksReal: (body) => /\b(CREATE TABLE|INSERT INTO|DROP TABLE IF EXISTS|PostgreSQL database dump)\b/i.test(body),
    impact: 'a copy of the database, users and all',
  },
]
