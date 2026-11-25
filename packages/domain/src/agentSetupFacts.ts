import {z} from 'zod'
import {valid, validRange} from 'semver'
import type {AgentInterfaceInput, PublicAgentInterface} from './agentInterface.js'
import {normalizeMcpRegistryObservation, isPublicMcpRemoteUrl, MCP_REGISTRY_API_ORIGIN} from './mcpRegistry.js'
import {normalizePublicMetadataUrl} from './publicMetadata.js'
import {isCatalogTimestampAtOrBefore} from './catalogFreshnessSearch.js'

export const AGENT_AUTH_METHOD_VALUES = ['oauth', 'api_key', 'none', 'other', 'unknown'] as const
export const AGENT_EXECUTION_COST_VALUES = ['local_free', 'local_paid_api', 'remote_metered', 'remote_free_tier', 'unknown'] as const
const evidenceFieldValues = ['mcpUrl', 'transport', 'registryName', 'identifier', 'installCommand', 'pinState', 'authMethod', 'envVarNames', 'llmsTxt', 'executionCost'] as const
export const agentSetupFactsSchema = z.object({
  mcpUrl: z.string().nullable(),
  transport: z.enum(['streamable-http', 'stdio', 'unknown']),
  registryName: z.string().nullable(),
  identifier: z.string().nullable(),
  installCommand: z.string().nullable(),
  pinState: z.enum(['pinned', 'range', 'unpinned', 'unknown']),
  authMethod: z.enum(AGENT_AUTH_METHOD_VALUES),
  envVarNames: z.array(z.string()),
  llmsTxt: z.string().nullable(),
  executionCost: z.enum(AGENT_EXECUTION_COST_VALUES),
  securityNotes: z.array(z.string()),
  sourceUrls: z.array(z.string()),
  checkedAt: z.string().nullable(),
  evidence: z.array(z.object({field: z.enum(evidenceFieldValues), sourceUrl: z.string(), checkedAt: z.string()})),
})
export type AgentSetupFacts = z.infer<typeof agentSetupFactsSchema>
export type AgentAuthMethod = typeof AGENT_AUTH_METHOD_VALUES[number]
export type AgentExecutionCost = typeof AGENT_EXECUTION_COST_VALUES[number]

export const formatAgentSetupFacts = (facts: AgentSetupFacts): string[] => [
  `Authentication method: ${facts.authMethod}; execution cost: ${facts.executionCost}; install pin: ${facts.pinState}.`,
  ...(facts.mcpUrl ? [`MCP endpoint: ${facts.mcpUrl} (${facts.transport}).`] : []),
  ...(facts.llmsTxt ? [`llms.txt: ${facts.llmsTxt}.`] : []),
  ...(facts.envVarNames.length ? [`Environment variable names: ${facts.envVarNames.join(', ')}. Configure values locally.`] : []),
  ...facts.securityNotes,
  ...facts.evidence.map(({field, sourceUrl, checkedAt}) => `${field} source: ${sourceUrl}; checked ${checkedAt}.`),
]

/** Only recognize a single package-manager invocation. No shell evaluation. */
const commandPinState = (command: string): AgentSetupFacts['pinState'] => {
  const match = /^(?:npx|pnpm dlx|yarn dlx)\s+(?:-y\s+|--yes\s+)?((?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)(?:@([^\s]+))?$/.exec(command)
  if (!match) return 'unknown'
  const version = match[2]
  return !version || ['latest', 'next', 'canary'].includes(version)
    ? 'unpinned' : valid(version) ? 'pinned' : validRange(version) ? 'range' : 'unknown'
}

export const deriveAgentSetupFacts = (input: AgentInterfaceInput, entry: PublicAgentInterface): AgentSetupFacts => {
  const facts: AgentSetupFacts = {
    mcpUrl: null, transport: 'unknown', registryName: null, identifier: null,
    installCommand: null, pinState: 'unknown', authMethod: 'unknown', envVarNames: [],
    llmsTxt: null, executionCost: 'unknown', securityNotes: [], sourceUrls: [], checkedAt: null, evidence: [],
  }
  const cite = (field: AgentSetupFacts['evidence'][number]['field'], sourceUrl: string, checkedAt: string) => {
    facts.evidence.push({field, sourceUrl, checkedAt})
    if (!facts.sourceUrls.includes(sourceUrl)) facts.sourceUrls.push(sourceUrl)
  }
  const docsUrl = normalizePublicMetadataUrl(input.docsUrl)
  const checkedAt = isCatalogTimestampAtOrBefore(input.checkedAt) ? input.checkedAt : undefined
  if (docsUrl && checkedAt && entry.status !== 'deprecated') {
    facts.checkedAt = checkedAt
    if (entry.identifier) {facts.identifier = entry.identifier; cite('identifier', docsUrl, checkedAt)}
    const auth = z.enum(AGENT_AUTH_METHOD_VALUES).safeParse(input.authMethod)
    if (auth.success) {facts.authMethod = auth.data; cite('authMethod', docsUrl, checkedAt)}
    if (entry.kind === 'llms_txt') {facts.llmsTxt = docsUrl; cite('llmsTxt', docsUrl, checkedAt)}
    const commandSource = input.installCommandSourceUrl ? normalizePublicMetadataUrl(input.installCommandSourceUrl) : docsUrl
    if (entry.installCommand && commandSource) {
      facts.installCommand = entry.installCommand
      facts.pinState = commandPinState(entry.installCommand)
      cite('installCommand', commandSource, checkedAt)
      if (facts.pinState !== 'unknown') cite('pinState', commandSource, checkedAt)
    }
  }
  const cost = z.enum(AGENT_EXECUTION_COST_VALUES).safeParse(input.executionCost)
  const costSource = normalizePublicMetadataUrl(input.executionCostSourceUrl)
  if (entry.status !== 'deprecated' && cost.success && costSource && checkedAt) {
    facts.executionCost = cost.data
    facts.checkedAt = checkedAt
    cite('executionCost', costSource, checkedAt)
  }
  const observation = normalizeMcpRegistryObservation(input.mcpRegistryObservation)
  if (entry.status !== 'deprecated' && observation?.status === 'active' && isCatalogTimestampAtOrBefore(observation.observedAt)) {
    const source = `${MCP_REGISTRY_API_ORIGIN}/servers/${encodeURIComponent(observation.registryName)}`
    facts.registryName = observation.registryName
    cite('registryName', source, observation.observedAt)
    const remote = observation.remotes.find(({type, url}) => type === 'streamable-http' && isPublicMcpRemoteUrl(url))
    if (remote) {
      facts.mcpUrl = remote.url; facts.transport = 'streamable-http'
      cite('mcpUrl', source, observation.observedAt); cite('transport', source, observation.observedAt)
    }
    const stdioPackages = (observation.packages ?? []).filter((pkg) => 'transport' in pkg)
    if (!remote && stdioPackages.length) {facts.transport = 'stdio'; cite('transport', source, observation.observedAt)}
    if (stdioPackages.length && !entry.installCommand) {
      facts.pinState = 'pinned'; cite('pinState', source, observation.observedAt)
    }
    facts.envVarNames = [...new Set(stdioPackages.flatMap((pkg) => 'environmentVariables' in pkg ? pkg.environmentVariables.map(({name}) => name) : []))]
    if (facts.envVarNames.length) cite('envVarNames', source, observation.observedAt)
    if (facts.authMethod === 'none' && stdioPackages.length) {
      facts.securityNotes.push('Runs a local process with your user permissions; review the exact command before approving', 'Hosts that load project .mcp.json may start configured processes automatically; review project configuration before trusting it.')
    }
    facts.checkedAt ??= observation.observedAt
  }
  if (facts.pinState === 'unpinned') facts.securityNotes.push('Install version is unpinned; review and pin a verified version before approving.')
  return facts
}

export interface AgentSetupEvidenceInput {
  status?: string | null
  docsUrl?: string | null
  checkedAt?: string | null
  installCommand?: string | null
  installCommandSourceUrl?: string | null
  authMethod?: string | null
  executionCost?: string | null
  executionCostSourceUrl?: string | null
}
export const validateAgentSetupEvidence = (entry: AgentSetupEvidenceInput): string | null => {
  const hasEvidence = normalizePublicMetadataUrl(entry.docsUrl) && isCatalogTimestampAtOrBefore(entry.checkedAt)
  if (entry.status === 'official' && entry.installCommand?.trim() && !hasEvidence) return 'Official install commands require a public docs URL and a valid Checked at date.'
  if (entry.authMethod && entry.authMethod !== 'unknown' && !hasEvidence) return 'Documented authentication requires a public docs URL and a valid Checked at date.'
  if (entry.executionCost && entry.executionCost !== 'unknown' && (!normalizePublicMetadataUrl(entry.executionCostSourceUrl) || !isCatalogTimestampAtOrBefore(entry.checkedAt))) return 'Execution cost requires a public source URL and a valid Checked at date.'
  if (entry.installCommandSourceUrl && !normalizePublicMetadataUrl(entry.installCommandSourceUrl)) return 'Install command source must be a public HTTP or HTTPS URL without credentials.'
  return null
}
