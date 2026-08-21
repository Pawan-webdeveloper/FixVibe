/**
 * Organizational-domain derivation, without a Public Suffix List dependency.
 *
 * SPF lives on the sending domain and DMARC on `_dmarc.<organizational
 * domain>`, so the email checks need to know which name to ask about. Getting
 * that right in general requires the full PSL (10k+ rules, a moving target);
 * pulling it in for two checks is not a trade this package wants to make.
 *
 * Instead we answer only where the answer is certain, and return null
 * otherwise. A null is not a gap in the report — it is the email checks
 * staying silent rather than announcing "no DMARC record" for a domain whose
 * record they were never going to look at. Under-reporting is recoverable;
 * a confident false positive is not.
 *
 * Certain means: a two-label domain (example.com), a "www." prefix on one
 * (www.example.com), or a three-label domain whose last two labels are one of
 * the well-known registry suffixes below (example.co.uk). Anything deeper —
 * blog.example.com, app.example.co.uk — is null, because its records may
 * legitimately be inherited from a parent we cannot identify.
 */

/**
 * Registry-operated two-label suffixes, i.e. ones where the registrable name
 * is the THIRD label from the right. Curated rather than complete: every entry
 * adds coverage, and a missing entry only costs silence.
 */
const TWO_LABEL_SUFFIXES: ReadonlySet<string> = new Set([
  // United Kingdom
  'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk', 'ac.uk', 'gov.uk', 'nhs.uk',
  // Ireland, continental Europe
  'co.at', 'or.at', 'com.pt', 'com.gr', 'edu.gr', 'net.gr', 'org.gr', 'gov.gr', 'com.cy', 'com.mt',
  'com.pl', 'net.pl', 'org.pl', 'gov.pl', 'edu.pl', 'com.ua', 'net.ua', 'org.ua', 'com.ru', 'org.ru',
  // Australia / New Zealand
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'id.au', 'asn.au',
  'co.nz', 'net.nz', 'org.nz', 'ac.nz', 'govt.nz', 'school.nz',
  // India / South & South-East Asia
  'co.in', 'net.in', 'org.in', 'firm.in', 'gen.in', 'ind.in', 'ac.in', 'edu.in', 'res.in', 'gov.in',
  'com.pk', 'com.bd', 'com.np', 'com.lk',
  'co.id', 'or.id', 'ac.id', 'go.id', 'web.id', 'my.id',
  'com.my', 'net.my', 'org.my', 'edu.my', 'gov.my',
  'com.sg', 'net.sg', 'org.sg', 'edu.sg', 'gov.sg',
  'com.ph', 'net.ph', 'org.ph', 'com.vn', 'net.vn', 'org.vn',
  'co.th', 'in.th', 'ac.th', 'go.th',
  // East Asia
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'ad.jp', 'ed.jp', 'gr.jp', 'lg.jp',
  'co.kr', 'or.kr', 'ne.kr', 're.kr', 'pe.kr', 'go.kr', 'ac.kr',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn',
  'com.hk', 'net.hk', 'org.hk', 'edu.hk', 'gov.hk', 'idv.hk',
  'com.tw', 'net.tw', 'org.tw', 'edu.tw', 'gov.tw',
  // Middle East / Africa
  'co.il', 'org.il', 'net.il', 'ac.il', 'gov.il', 'com.tr', 'net.tr', 'org.tr', 'gov.tr', 'edu.tr',
  'com.sa', 'com.eg', 'com.ng', 'com.gh', 'co.ke', 'co.tz', 'co.ug', 'co.za', 'org.za', 'net.za', 'web.za',
  // Americas
  'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br',
  'com.mx', 'org.mx', 'net.mx', 'edu.mx', 'gob.mx',
  'com.ar', 'net.ar', 'org.ar', 'gob.ar', 'edu.ar',
  'com.co', 'net.co', 'org.co', 'com.pe', 'com.ve', 'com.ec', 'com.uy', 'com.py', 'com.bo', 'com.cl',
  'co.cr', 'com.gt', 'com.do', 'com.pa',
])

/**
 * The domain SPF and DMARC records should be published on, or null when it
 * cannot be determined with certainty. Input may be any hostname; IP literals
 * and bracketed IPv6 are the caller's job to exclude beforehand.
 */
export function organizationalDomain(hostname: string): string | null {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '')
  if (!host || host.includes(':') || host.includes('/')) return null

  const labels = host.split('.').filter(Boolean)
  if (labels.length !== host.split('.').length) return null // empty label, e.g. "a..com"

  // A leading "www." is a presentation prefix, never a mail boundary.
  const trimmed = labels[0] === 'www' ? labels.slice(1) : labels
  if (trimmed.length < 2) return null

  const lastTwo = trimmed.slice(-2).join('.')

  if (trimmed.length === 2) {
    // "co.uk" on its own is a registry suffix, not somebody's domain.
    return TWO_LABEL_SUFFIXES.has(lastTwo) ? null : trimmed.join('.')
  }

  if (trimmed.length === 3 && TWO_LABEL_SUFFIXES.has(lastTwo)) return trimmed.join('.')

  // Deeper than one label under the registrable domain: records may be
  // inherited from a parent we cannot identify without the full PSL.
  return null
}
