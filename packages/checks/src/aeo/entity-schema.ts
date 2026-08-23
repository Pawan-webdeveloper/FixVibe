/**
 * Does the site say what entity it IS, in a form a model can resolve?
 *
 * An assistant asked "who makes X" has to connect a page to a thing it already
 * knows about. An Organization node with `sameAs` links — Wikipedia, LinkedIn,
 * Crunchbase, GitHub — is what performs that connection; without it the site is
 * a string rather than an entity, and the model falls back to guessing from
 * whatever else mentions the name.
 *
 * Scoped to the home page. An Organization node belongs on the site's root, and
 * telling every blog post it lacks one is noise for the sake of coverage.
 *
 * `seo.structured-data` already reports JSON-LD that is missing or broken; this
 * asks a different question about JSON-LD that parses fine.
 */

import type { Check, Finding } from '../types.ts'
import { jsonLdNodes, typesOf } from './content.ts'

const ID = 'aeo.entity-schema'

const ENTITY_TYPES = new Set(['organization', 'person', 'localbusiness', 'corporation', 'ngo', 'brand'])

export const entitySchemaCheck: Check = {
  id: ID,
  category: 'aeo',
  title: 'Entity schema',

  run(ctx) {
    if (ctx.finalUrl.pathname !== '/') return []

    const nodes = jsonLdNodes(ctx)
    const entities = nodes.filter((node) => typesOf(node).some((t) => ENTITY_TYPES.has(t)))

    if (entities.length === 0) {
      return [
        {
          checkId: ID,
          category: 'aeo',
          severity: 'info',
          title: 'No Organization or Person schema on the home page',
          description:
            'Nothing on this page states, in machine-readable form, what entity the site belongs to. ' +
            'An assistant asked about this company has to infer the answer from prose and from what ' +
            'other sites say — which is exactly where it confuses one similarly-named company for ' +
            'another.',
          evidence: { jsonLdTypesFound: nodes.flatMap(typesOf).slice(0, 10) },
          remediation:
            'Add an Organization (or Person) JSON-LD block with name, url, description and sameAs links.',
          fixPrompt:
            'Add a schema.org Organization block to this site\'s home page, inside ' +
            '<script type="application/ld+json">, with: "@context": "https://schema.org", ' +
            '"@type": "Organization", name, url, logo, description, and a "sameAs" array linking the ' +
            'official LinkedIn, GitHub, X and Crunchbase profiles. sameAs is the part that matters — ' +
            'it is what ties the name to an entity that is already known.',
        } satisfies Finding,
      ]
    }

    const withSameAs = entities.filter((node) => {
      const sameAs = node['sameAs']
      return typeof sameAs === 'string' ? sameAs.length > 0 : Array.isArray(sameAs) && sameAs.length > 0
    })

    if (withSameAs.length === 0) {
      const names = entities
        .map((node) => (typeof node['name'] === 'string' ? node['name'] : null))
        .filter((n): n is string => n !== null)

      return [
        {
          checkId: ID,
          category: 'aeo',
          severity: 'info',
          title: 'Entity schema has no sameAs links',
          description:
            'The page declares an entity but links it to nothing else. sameAs is the part that does ' +
            'the disambiguating: it points at profiles a model has already seen, which is how a name ' +
            'becomes a specific company rather than a string that several companies share.',
          evidence: { entities: names.length > 0 ? names : entities.map(typesOf).flat() },
          remediation: 'Add a sameAs array pointing at the official LinkedIn, GitHub, X and Wikipedia pages.',
          fixPrompt:
            'This site\'s Organization/Person JSON-LD has no "sameAs". Add it as an array of the ' +
            'official profile URLs — LinkedIn company page, GitHub org, X account, Crunchbase, ' +
            'Wikipedia if one exists. Only list profiles genuinely controlled by this entity; a wrong ' +
            'link there ties the site to somebody else.',
        } satisfies Finding,
      ]
    }

    return []
  },
}
