// Dependency-free so the Tool page's report form can read a dispute link cheaply.
export const AGENT_READINESS_SIGNAL_IDS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'] as const
export type AgentReadinessSignalId = (typeof AGENT_READINESS_SIGNAL_IDS)[number]
/** What each signal claims, in the words a person disputing it would use. */
export const AGENT_READINESS_SIGNAL_LABELS = {
  S1: 'MCP Registry remote server',
  S2: 'ready setup recipe',
  S3: 'llms.txt response',
  S4: 'Markdown documentation discovery',
  S5: 'documented authentication method',
  S6: 'pinned install command',
  S7: 'structured pricing with a checked pricing page',
  S8: 'documented non-interactive use',
} as const satisfies Record<AgentReadinessSignalId, string>

/**
 * Disputes go to the Tool page's correction report, which stores a private
 * report for editors. The query names the signal so the form opens with it
 * filled in; the fragment scrolls to the form. Query-string URLs are page
 * state, not separate pages, so crawlers never follow them.
 */
export const AGENT_READINESS_DISPUTE_PARAMETER = 'dispute'
/** Element id of the Tool page's report form; the page opens the form when the URL names it. */
export const TOOL_CORRECTION_REPORT_FRAGMENT = 'tool-correction-report-form'
const DISPUTE_VALUE_PREFIX = 'agent-readiness-'
const DEFAULT_DISPUTE_SITE_URL = 'https://slothhub.dev'

export const buildAgentReadinessDisputeUrl = (slug: string, id: AgentReadinessSignalId, siteUrl = DEFAULT_DISPUTE_SITE_URL): string => {
  const url = new URL(`/tool/${encodeURIComponent(slug)}`, siteUrl)
  url.searchParams.set(AGENT_READINESS_DISPUTE_PARAMETER, `${DISPUTE_VALUE_PREFIX}${id}`)
  url.hash = TOOL_CORRECTION_REPORT_FRAGMENT
  return url.href
}

/** The disputed signal named by a Tool page query string, or null for anything else. */
export const parseAgentReadinessDispute = (search: string): AgentReadinessSignalId | null => {
  const value = new URLSearchParams(search).get(AGENT_READINESS_DISPUTE_PARAMETER)
  const id = value?.startsWith(DISPUTE_VALUE_PREFIX) ? value.slice(DISPUTE_VALUE_PREFIX.length) : undefined
  return AGENT_READINESS_SIGNAL_IDS.find((candidate) => candidate === id) ?? null
}

/** Opening text for a correction report about one signal; the reporter adds the evidence. */
export const buildAgentReadinessDisputeDescription = (id: AgentReadinessSignalId): string =>
  `Agent readiness signal ${id} (${AGENT_READINESS_SIGNAL_LABELS[id]}) looks wrong. Evidence and expected correction: `

/** How an agent disputes a signal without a browser: the feedback tool and command, with this field. */
export const formatAgentReadinessFeedbackHint = (code: (text: string) => string = (text) => text): string =>
  `To dispute a signal without a browser, send ${code('slothhub_submit_feedback')} (MCP) or ${code('slothhub feedback wrong-fact')} (CLI) with the Tool slug and the field ${code('agentReadiness.<signal id>')}.`
