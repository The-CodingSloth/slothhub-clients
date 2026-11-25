import {z} from 'zod'
import {PACKAGE_REGISTRY_VALUES} from './registryHandoffs.js'

import {AGENT_INTERFACE_KIND_VALUES} from './agentInterface.js'
import {AGENT_SEARCH_INTEGRATION_CONNECTION_VALUES} from './agentSearch.js'
import {AGENT_SETUP_RECIPE_CONFIG_HOST_VALUES} from './mcpRegistry.js'
import {SECURITY_CAPABILITY_VALUES} from './securityCapability.js'
import type {JsonValue} from './jsonValue.js'

/** Shared wording for feed producers and recommendation explanations. */
export const AGENT_SEARCH_TOKEN_RULE = 'CLI and MCP ignore common stopwords and generic app, library, and tool words; remaining tokens match whole words or word prefixes with light plural and -ing/-ed folding. Auth matches authentication and authorization, not author or OAuth. Partial matches rank by matched-token count, then by field (name/slug, taxonomy, description, remaining public search text) weighted by how rare each token is in the catalog, so a specific word such as postgres outweighs a common one such as hosting. Explicit identifiers still require every meaningful token. Stopword-only queries return no matches. Prefixes such as figm match Figma; misspellings such as figam are not corrected. Browser search additionally uses fuzzy matching and may return different results and ordering.'

const stringArray = z.array(z.string()).readonly()

/** Public Search Index query vocabulary consumed by deterministic agent clients. */
export const agentSearchQueryContractSchema = z.strictObject({
  textQuery: z.strictObject({
    parameter: z.literal('q'),
    tokenRule: z.string(),
    ranking: stringArray,
  }).optional(),
  filters: z.strictObject({
    pricing: z.strictObject({parameter: z.literal('pricing'), values: stringArray}).optional(),
    platform: z.strictObject({parameter: z.literal('platform'), values: stringArray}).optional(),
    category: z.strictObject({
      parameter: z.literal('category'),
      valuesFrom: z.literal('filters.categories[].value'),
    }).optional(),
    tag: z.strictObject({
      parameter: z.literal('tag'),
      valuesFrom: z.literal('filters.tags[].value'),
    }).optional(),
    useCase: z.strictObject({
      parameter: z.literal('useCase'),
      valuesFrom: z.literal('filters.useCases[].value'),
    }).optional(),
    integration: z.strictObject({
      parameter: z.literal('integration'),
      valuesFrom: z.literal('filters.integrations[].value'),
      matchRule: z.string(),
    }).optional(),
    integrationConnection: z.strictObject({
      parameter: z.literal('integrationConnection'),
      values: z.array(z.enum(AGENT_SEARCH_INTEGRATION_CONNECTION_VALUES)).readonly(),
      matchRule: z.string(),
    }).optional(),
    resourceKind: z.strictObject({
      parameter: z.literal('resourceKind'),
      values: stringArray,
    }).optional(),
    packageRegistry: z.strictObject({
      parameter: z.literal('packageRegistry'),
      values: z.array(z.enum(PACKAGE_REGISTRY_VALUES)).readonly(),
    }).optional(),
    securityCapability: z.strictObject({
      parameter: z.literal('securityCapability'),
      values: z.array(z.enum(SECURITY_CAPABILITY_VALUES)).readonly(),
    }).optional(),
    agentInterfaceKind: z.strictObject({
      parameter: z.literal('agentInterfaceKind'),
      values: z.array(z.enum(AGENT_INTERFACE_KIND_VALUES)).readonly(),
    }).optional(),
    languages: z.strictObject({parameter: z.literal('language'), valuesFrom: z.literal('filters.supportedLanguages[].value'), matchRule: z.string()}).optional(),
    agentHost: z.strictObject({
      parameter: z.literal('agentHost'),
      values: z.array(z.enum(AGENT_SETUP_RECIPE_CONFIG_HOST_VALUES)).readonly(),
      matchRule: z.string(),
    }).optional(),
    destinationHealth: z.strictObject({
      parameter: z.literal('destinationHealth'),
      values: stringArray,
      matchRule: z.string(),
    }).optional(),
    verified: z.strictObject({
      parameter: z.literal('verified'),
      values: z.tuple([z.literal('true')]).readonly(),
      matchRule: z.string(),
    }).optional(),
    lastCheckedAfter: z.strictObject({
      parameter: z.literal('lastCheckedAfter'),
      format: z.literal('YYYY-MM-DD'),
      matchRule: z.string(),
    }).optional(),
  }).optional(),
  pagination: z.strictObject({
    parameter: z.literal('page'),
    defaultPage: z.number(),
    pageSize: z.number(),
  }).optional(),
})

export type AgentSearchQueryContract = z.infer<typeof agentSearchQueryContractSchema>

export const parseAgentSearchQueryContract = (
  value: JsonValue,
): AgentSearchQueryContract => agentSearchQueryContractSchema.parse(value)
