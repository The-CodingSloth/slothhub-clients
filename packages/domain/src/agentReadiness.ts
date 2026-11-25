import {z} from 'zod'
import type {PublicAgentInterface} from './agentInterface.js'
import {resolvePublicAgentSetupRecipeEntries, MCP_REGISTRY_API_ORIGIN} from './mcpRegistry.js'
import {isCatalogTimestampAtOrBefore} from './catalogFreshnessSearch.js'
import type {PublicSourceReference} from './sourceReference.js'
import {buildSafeMarkdownLink, toMarkdownInlineCode} from './markdownSafety.js'
import {AGENT_READINESS_SIGNAL_IDS, formatAgentReadinessFeedbackHint, buildAgentReadinessDisputeUrl} from './agentReadinessDispute.js'

// Editorial policy requested in upstream #1882, not a claim about upstream activity.
export const AGENT_READINESS_MAX_AGE_DAYS = 30
// upstream #616 has no successful scheduled recovery evidence. Enable rechecks only
// after that gate and the S3/S4 fetch adapters have been verified.
export const AGENT_READINESS_RECHECKS_PAUSED = true
export {
  AGENT_READINESS_SIGNAL_IDS, AGENT_READINESS_SIGNAL_LABELS, AGENT_READINESS_DISPUTE_PARAMETER, TOOL_CORRECTION_REPORT_FRAGMENT,
  formatAgentReadinessFeedbackHint, buildAgentReadinessDisputeUrl, parseAgentReadinessDispute, buildAgentReadinessDisputeDescription,
  type AgentReadinessSignalId,
} from './agentReadinessDispute.js'
export const agentReadinessSignalSchema = z.object({
  id: z.enum(AGENT_READINESS_SIGNAL_IDS), result: z.enum(['pass', 'fail', 'unknown']),
  evidenceUrl: z.string().nullable(), checkedAt: z.string().nullable(),
  reason: z.enum(['recheck_paused', 'stale', 'not_recorded']).optional(),
  disputeUrl: z.string(),
})
export const agentReadinessSchema = z.object({signals: z.array(agentReadinessSignalSchema)})
export type AgentReadiness = z.infer<typeof agentReadinessSchema>
export const formatAgentReadiness = ({signals}: AgentReadiness): string[] => [...signals.map((signal) =>
  `${signal.id}: ${signal.result}${signal.reason ? ` (${signal.reason})` : ''}; source: ${signal.evidenceUrl ?? 'not recorded'}; checked: ${signal.checkedAt ?? 'unknown'}; dispute: ${signal.disputeUrl}`,
), formatAgentReadinessFeedbackHint()]
export const renderAgentReadinessMarkdown = ({signals}: AgentReadiness): string => [formatAgentReadinessFeedbackHint(toMarkdownInlineCode), ...signals.map((signal) => {
  const fact = `${signal.id}: ${signal.result}${signal.reason ? ` (${signal.reason})` : ''}; checked: ${signal.checkedAt ?? 'unknown'}`
  const source = signal.evidenceUrl ? buildSafeMarkdownLink('Source', signal.evidenceUrl) : 'Source not recorded'
  return `- ${toMarkdownInlineCode(fact)} — ${source}; ${buildSafeMarkdownLink('Dispute this signal', signal.disputeUrl)}`
})].join('\n')
type Signal = AgentReadiness['signals'][number]
export interface AgentReadinessInput {
  slug: string
  interfaces: readonly PublicAgentInterface[]
  pricingSources?: readonly PublicSourceReference[]
  hasStructuredPricing?: boolean
  /** Origin of the Tool page that takes disputes; defaults to https://slothhub.dev. */
  siteUrl?: string
  now?: Date
}

/** Pure projection of stored, cited facts. It never fetches or runs a command. */
export const buildAgentReadiness = (input: AgentReadinessInput): AgentReadiness => {
  const now = input.now ?? new Date()
  const isCurrent = (checkedAt: string) => isCatalogTimestampAtOrBefore(checkedAt, now) && now.getTime() - Date.parse(checkedAt) <= AGENT_READINESS_MAX_AGE_DAYS * 86_400_000
  const active = input.interfaces.filter(({status}) => status !== 'deprecated')
  const facts = active.flatMap(({setupFacts}) => setupFacts ? [setupFacts] : [])
  const signals = AGENT_READINESS_SIGNAL_IDS.map((id): Signal => {
    const disputeUrl = buildAgentReadinessDisputeUrl(input.slug, id, input.siteUrl)
    const signal: Signal = {id, result: 'unknown', evidenceUrl: null, checkedAt: null, reason: 'not_recorded', disputeUrl}
    const set = (result: Signal['result'], sourceUrl: string, checkedAt: string) => {
      signal.result = result; signal.evidenceUrl = sourceUrl; signal.checkedAt = checkedAt; delete signal.reason
    }
    if (id === 'S2') {
      const ready = active.flatMap(resolvePublicAgentSetupRecipeEntries).filter((recipe) => recipe.state === 'ready').sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))
      const recipe = ready.find(({observedAt}) => isCurrent(observedAt)) ?? ready[0]
      if (recipe?.state === 'ready') set('pass', `${MCP_REGISTRY_API_ORIGIN}/servers/${encodeURIComponent(recipe.registryName)}`, recipe.observedAt)
      // Unknown hosts mean missing evidence, never a failed setup.
    }
    if (id === 'S5' || id === 'S6') {
      const field = id === 'S5' ? 'authMethod' : 'pinState'
      const candidates = facts.flatMap((fact) => {
        const evidence = fact.evidence.find((entry) => entry.field === field)
        return fact[field] !== 'unknown' && evidence ? [{fact, evidence}] : []
      }).sort((a, b) => Date.parse(b.evidence.checkedAt) - Date.parse(a.evidence.checkedAt))
      const current = candidates.filter(({evidence}) => isCurrent(evidence.checkedAt))
      const selected = current.find(({fact}) => id === 'S5' || fact.pinState === 'pinned') ?? current[0] ?? candidates[0]
      if (selected) {
        const {fact, evidence} = selected
        set(id === 'S5' || fact.pinState === 'pinned' ? 'pass' : fact.pinState === 'unpinned' ? 'fail' : 'unknown', evidence.sourceUrl, evidence.checkedAt)
      }
    }
    if (id === 'S7' && input.hasStructuredPricing) {
      const evidence = input.pricingSources?.filter(({sourceType, checkedAt}) => sourceType === 'pricing_page' && isCatalogTimestampAtOrBefore(checkedAt, now)).sort((a, b) => Date.parse(b.checkedAt!) - Date.parse(a.checkedAt!))[0]
      if (evidence?.checkedAt) set('pass', evidence.url, evidence.checkedAt)
    }
    if (id === 'S8') {
      const documented = active.flatMap(({automation}) => automation?.evidenceBasis === 'documented' && (automation.nonInteractive === 'yes' || automation.nonInteractive === 'no') ? [automation] : []).sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt))
      const current = documented.filter(({checkedAt}) => isCurrent(checkedAt))
      const automation = current.find(({nonInteractive}) => nonInteractive === 'yes') ?? current[0] ?? documented[0]
      const evidence = automation?.evidenceReferences[0]
      if (automation && evidence) set(automation.nonInteractive === 'yes' ? 'pass' : 'fail', evidence.url, automation.checkedAt)
    }
    if (signal.checkedAt && (!isCatalogTimestampAtOrBefore(signal.checkedAt, now) || now.getTime() - Date.parse(signal.checkedAt) > AGENT_READINESS_MAX_AGE_DAYS * 86_400_000)) {
      signal.result = 'unknown'; signal.reason = 'stale'
    }
    if (AGENT_READINESS_RECHECKS_PAUSED && (id === 'S1' || id === 'S3' || id === 'S4')) {
      signal.result = 'unknown'; signal.reason = 'recheck_paused'
    }
    return signal
  })
  return {signals}
}
