/**
 * Which answer-engine crawlers robots.txt lets in.
 *
 * The important calibration here: blocking them is a LEGITIMATE CHOICE. Plenty
 * of publishers deliberately keep their content out of model training and AI
 * summaries, and telling them they have made a mistake would be this scanner
 * substituting its opinion for theirs. So the blocked list is reported as an
 * observation at `info`, worded so an intentional decision reads as confirmed
 * rather than criticised.
 *
 * One case is genuinely a defect and gets its own finding: a site that
 * publishes /llms.txt — a file whose only audience is AI crawlers — while
 * robots.txt forbids those same crawlers. That is not a policy, it is two
 * policies, and one of them is not doing what its author thought.
 */

import type { Check, CheckContext, Finding } from '../types.ts'

const ID = 'aeo.ai-bots-allowed'

/**
 * The crawlers behind the assistants people actually ask. Each is a distinct
 * product decision — OpenAI alone separates training (GPTBot) from live
 * retrieval (OAI-SearchBot, ChatGPT-User), and a site can reasonably allow one
 * and refuse the other, so they are listed and judged individually.
 */
const AI_CRAWLERS: ReadonlyArray<{ agent: string; operator: string }> = [
  { agent: 'GPTBot', operator: 'OpenAI — model training' },
  { agent: 'OAI-SearchBot', operator: 'OpenAI — ChatGPT search results' },
  { agent: 'ChatGPT-User', operator: 'OpenAI — pages a user asks about' },
  { agent: 'ClaudeBot', operator: 'Anthropic' },
  { agent: 'anthropic-ai', operator: 'Anthropic — legacy agent string' },
  { agent: 'PerplexityBot', operator: 'Perplexity' },
  { agent: 'Google-Extended', operator: 'Google — Gemini and AI Overviews' },
  { agent: 'Applebot-Extended', operator: 'Apple Intelligence' },
  { agent: 'CCBot', operator: 'Common Crawl — feeds many models' },
  { agent: 'meta-externalagent', operator: 'Meta AI' },
]

async function hasLlmsTxt(ctx: CheckContext): Promise<boolean> {
  // probe() is memoised per path, so asking here costs nothing beyond what the
  // llms-txt check already spent.
  const response = await ctx.probe('/llms.txt')
  return response?.status === 200 && !/^\s*<(!doctype|html)\b/i.test(response.body)
}

export const aiBotsAllowedCheck: Check = {
  id: ID,
  category: 'aeo',
  title: 'AI crawler access',

  async run(ctx) {
    // No robots.txt means no restrictions; there is nothing to observe.
    if (!ctx.robots) return []

    const blocked = AI_CRAWLERS.filter(({ agent }) => !ctx.robots!.allows(agent, '/'))
    if (blocked.length === 0) return []

    const names = blocked.map((b) => b.agent)

    if (await hasLlmsTxt(ctx)) {
      return [
        {
          checkId: ID,
          category: 'aeo',
          severity: 'low',
          title: 'llms.txt invites AI crawlers that robots.txt turns away',
          description:
            `This site publishes /llms.txt — a file written for answer engines — while robots.txt ` +
            `blocks ${names.join(', ')} from the whole site. A crawler reads robots.txt first and ` +
            'never reaches the file, so whichever of the two reflects the real intention, the other ' +
            'one is not doing anything.',
          evidence: { blocked: names },
          remediation:
            'Decide which is intended: allow these agents in robots.txt, or remove /llms.txt.',
          fixPrompt:
            `This site's robots.txt blocks ${names.join(', ')} while also publishing /llms.txt. ` +
            'Pick one: if AI answer engines should read the site, allow those user-agents in ' +
            'robots.txt; if they should not, delete /llms.txt so the site states one policy.',
        } satisfies Finding,
      ]
    }

    return [
      {
        checkId: ID,
        category: 'aeo',
        severity: 'info',
        title: `${blocked.length} AI crawler${blocked.length === 1 ? '' : 's'} blocked by robots.txt`,
        description:
          `robots.txt disallows ${names.join(', ')} from this site. Content behind those agents ` +
          'cannot be quoted or summarised by the assistants they belong to. Recorded because it is ' +
          'often a deliberate choice about training and attribution — if it was deliberate, this row ' +
          'is confirmation rather than a problem.',
        evidence: { blocked: blocked.map((b) => `${b.agent} (${b.operator})`) },
        remediation:
          'Leave as-is if intentional. To be quotable by these assistants, allow their user-agents in robots.txt.',
        fixPrompt:
          `This site's robots.txt blocks these AI crawlers: ${names.join(', ')}. If the site should ` +
          'appear in AI answers, remove those Disallow rules or add explicit Allow rules for each ' +
          'user-agent. If the block is deliberate, change nothing — this is a policy decision, not a ' +
          'misconfiguration.',
      } satisfies Finding,
    ]
  },
}
