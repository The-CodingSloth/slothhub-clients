import {matchesSupportedLanguages, programmingLanguageIdSchema, type SupportedLanguage} from './supportedLanguage.js'
import {isRuntimeString} from './runtimeValidation.js'
import {
  matchesCatalogFreshnessFilters,
  parseCatalogFreshnessFilters,
  type CatalogSearchFreshnessProjection,
} from './catalogFreshnessSearch.js'
import {AGENT_INTERFACE_KIND_VALUES} from './agentInterface.js'
import {isPositiveIntegrationStatus} from './integrationStatus.js'
import {AGENT_SETUP_RECIPE_CONFIG_HOST_VALUES, matchesAgentSetupRecipeHost, type AgentSetupRecipeHost} from './mcpRegistry.js'
import {RESOURCE_KIND_VALUES} from './resourceKind.js'
import {expandCategoryFilterSlugs} from './categoryHierarchy.js'
import {matchesSourceAvailability, normalizeSourceAvailabilityFilter, SOURCE_AVAILABILITY_FILTER_VALUES} from './sourceAvailabilityFilter.js'
import {SECURITY_CAPABILITY_VALUES} from './securityCapability.js'
import {parseToolSearchIdentifier, resolveToolSearchIdentifier, type ToolLookupResolver} from './toolLookup.js'
import type {JsonValue} from './jsonValue.js'
import {getRegistryHandoffs, getPackageRegistry, PACKAGE_REGISTRY_VALUES, REGISTRY_HANDOFF_QUERY_MAX_LENGTH, type RegistryHandoff} from './registryHandoffs.js'

export const AGENT_SEARCH_PRICING_VALUES = ['free', 'paid', 'freemium'] as const
export const AGENT_SEARCH_INTEGRATION_CONNECTION_VALUES = ['native'] as const

export const AGENT_SEARCH_PLATFORM_VALUES = [
  'web',
  'desktop',
  'mobile',
  'extension',
  'cli',
] as const
// Receipt (2026-08-12): the packaged public evaluation has 17 Tools and 40 cases;
// its longest query is 33 code points. These tripwires leave roughly 6x query
// and 3x full-result headroom while bounding terminal/MCP work.
export const AGENT_SEARCH_MAX_QUERY_CHARACTERS = 200
// Rechecked unchanged on 500/1,000 Tools: upstream docs/measurements/search-contracts-2026-09-26.md.
export const AGENT_SEARCH_MAX_RESULT_LIMIT = 50
export const AGENT_SEARCH_PAYLOAD_RECOVERY =
  'Use a smaller public feed or narrow the requested catalog surface.'

export class AgentSearchPayloadLimitError extends Error {
  readonly name = 'AgentSearchPayloadLimitError'
  readonly code = 'feed_payload_too_large'
  readonly recovery = AGENT_SEARCH_PAYLOAD_RECOVERY

  constructor(
    readonly configuredLimitBytes: number,
    readonly observedBytes: number,
  ) {
    super(
      `feed_payload_too_large: configured_limit_bytes=${configuredLimitBytes} observed_bytes=${observedBytes} recovery=${AGENT_SEARCH_PAYLOAD_RECOVERY}`,
    )
  }
}

export type AgentSearchErrorCode =
  | 'capability_unavailable'
  | 'agent_search_unsupported_filter_value'
  | 'agent_search_invalid_filter_value'
  | 'agent_search_catalog_projection_invalid'
  | 'agent_search_query_too_long'
  | 'agent_search_query_normalized_empty'
  | 'agent_search_result_limit_out_of_range'

export class AgentSearchContractError extends Error {
  readonly name = 'AgentSearchContractError'

  constructor(
    readonly code: AgentSearchErrorCode,
    message: string,
    readonly recovery: string,
    readonly observedValue: JsonValue,
    readonly filter?: keyof PublicAgentSearchFilters,
    readonly configuredLimit?: number,
    readonly field?: string,
  ) {
    super(message)
  }
}

export interface AgentSearchErrorPayload {
  code: AgentSearchErrorCode
  message: string
  recovery: string
  observedValue: JsonValue
  filter?: keyof PublicAgentSearchFilters
  configuredLimit?: number
  field?: string
}

export const serializeAgentSearchContractError = (
  error: AgentSearchContractError,
): AgentSearchErrorPayload => ({
  code: error.code, message: error.message, recovery: error.recovery, observedValue: error.observedValue,
  ...(error.filter ? { filter: error.filter } : undefined),
  ...(error.configuredLimit !== undefined ? { configuredLimit: error.configuredLimit } : undefined),
  ...(error.field ? { field: error.field } : undefined)
})

export interface PublicAgentSearchReference {
  name?: string
  slug?: string
}

export interface PublicAgentSearchIntegration extends PublicAgentSearchReference {
  status?: string
}

export interface PublicAgentSearchTool {
  name?: string
  slug: string
  description?: string
  pricing?: string
  platforms?: readonly string[]
  categories?: readonly PublicAgentSearchReference[]
  tags?: readonly PublicAgentSearchReference[]
  useCases?: readonly PublicAgentSearchReference[]
  resourceKind?: {value?: string}
  resourceIdentity?: {kind?: string}
  resourceKindIsFallback?: true
  securityCapabilities?: readonly string[]
  agentInterfaceKinds?: readonly string[]
  integrations?: readonly PublicAgentSearchIntegration[]
  supportedLanguages?: readonly SupportedLanguage[]
  setupRecipeHosts?: readonly AgentSetupRecipeHost[]
  freshness?: CatalogSearchFreshnessProjection
  deployment?: {sourceAvailability?: string}
  search?: {text?: string}
}

export interface PublicAgentSearchFilters {
  query?: string
  limit?: number
  pricing?: string
  platform?: string
  category?: string
  tag?: string
  useCase?: string
  resourceKind?: string
  packageRegistry?: string
  securityCapability?: string
  agentInterfaceKind?: string
  integration?: string
  integrationConnection?: string
  agentHost?: string
  /** Reviewed source availability: open_source, source_available or closed_source. */
  sourceAvailability?: string
  languages?: readonly string[]
  destinationHealth?: JsonValue
  verified?: JsonValue
  lastCheckedAfter?: JsonValue
}

export interface PublicAgentSearchFilterOption {
  value: string
  label?: string
  /** Category options only: the parent hub's slug, so a hub filter includes its subcategories. */
  parent?: string
}

export interface PublicAgentSearchAvailableFilters {
  categories?: readonly PublicAgentSearchFilterOption[]
  tags?: readonly PublicAgentSearchFilterOption[]
  useCases?: readonly PublicAgentSearchFilterOption[]
  integrations?: readonly PublicAgentSearchFilterOption[]
}

export interface PublicAgentSearchOptions {
  availableFilters?: PublicAgentSearchAvailableFilters
  /**
   * Optional Tool lookup resolver. When the raw query parses as an explicit
   * namespace:value reference or ASCII GitHub owner/repo shorthand and resolves
   * to exactly one Tool, that Tool is pinned first; every other query ranks
   * normally. Ambiguous or unknown identifiers never pin.
   */
  lookupResolver?: ToolLookupResolver
}

export interface PublicAgentSearchCatalogCapabilities extends PublicAgentSearchOptions {
  agentInterfaceKindsAvailable: boolean
  securityCapabilitiesAvailable: boolean
  integrationsAvailable?: boolean
  supportedLanguagesAvailable?: boolean
  /** Search Index 17.2+ publishes source-availability counts; older feeds cannot answer the filter. */
  sourceAvailabilityAvailable?: boolean
  setupRecipeHosts?: readonly string[]
}

export interface PublicAgentSearchResult<TTool extends PublicAgentSearchTool> {
  tool: TTool
  score: number
}

export interface PublicAgentSearchArticle {
  title: string
  slug: string
  excerpt?: string
  url: string
}

export interface PublicAgentSearchArticleResult extends PublicAgentSearchArticle {
  kind: 'article'
  score: number
}

export const normalizePublicAgentSearchText = (value: string | undefined): string =>
  (value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/\p{Cf}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{Extended_Pictographic}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export const tokenizePublicAgentSearchText = (value: string | undefined): string[] =>
  [...new Set(normalizePublicAgentSearchText(value).split(/\s+/).filter(Boolean))]

const matchesValue = (actual: string | undefined, expected: string | undefined): boolean =>
  !expected ||
  normalizePublicAgentSearchText(actual) === normalizePublicAgentSearchText(expected)

const matchesReference = (
  references: readonly PublicAgentSearchReference[] | undefined,
  expected: string | undefined,
): boolean =>
  !expected ||
  (references ?? []).some(
    (reference) =>
      matchesValue(reference.slug, expected) || matchesValue(reference.name, expected),
  )

const matchesIntegrations = (
  integrations: readonly PublicAgentSearchIntegration[] | undefined,
  integration: string | undefined,
  connection: string | undefined,
): boolean => {
  if (!integration && !connection) return true
  return (integrations ?? []).some(
    (fact) =>
      (!integration ||
        matchesValue(fact.slug, integration) ||
        matchesValue(fact.name, integration)) &&
      (normalizePublicAgentSearchText(connection) === 'native'
        ? fact.status === 'native'
        : isPositiveIntegrationStatus(fact.status)),
  )
}

/**
 * A Category filter matches the named Category and, when the feed's Category
 * options name parent hubs, every direct subcategory of that hub.
 */
const categoryFilterMatcher = (
  category: string | undefined,
  options: readonly PublicAgentSearchFilterOption[] | undefined,
): ((references: readonly PublicAgentSearchReference[] | undefined) => boolean) => {
  if (!category) return () => true
  const selected = (options ?? []).find((option) => matchesValue(option.value, category) || matchesValue(option.label, category))
  if (!selected || !(options ?? []).some((option) => option.parent === selected.value)) {
    return (references) => matchesReference(references, category)
  }
  const slugs = expandCategoryFilterSlugs(selected.value, (options ?? []).map((option) => ({slug: option.value, parent: option.parent})))
  return (references) => (references ?? []).some((reference) => reference.slug !== undefined && slugs.has(reference.slug))
}

const requireSupportedFilter = (
  filter: keyof PublicAgentSearchFilters,
  value: string | undefined,
  supportedValues: readonly string[],
): void => {
  if (value === undefined) return
  const normalizedValue = normalizePublicAgentSearchText(value)
  if (!normalizedValue) {
    throw new AgentSearchContractError(
      'agent_search_invalid_filter_value',
      `The ${filter} filter contains no searchable value after normalization.`,
      `Provide a non-empty ${filter} value containing a letter, number, or emoji.`,
      value,
      filter,
    )
  }
  if (supportedValues.some((supported) => normalizePublicAgentSearchText(supported) === normalizedValue)) {
    return
  }

  const recovery = `Use a supported ${filter} value: ${supportedValues.join(', ')}.`
  throw new AgentSearchContractError(
    'agent_search_unsupported_filter_value',
    `Unsupported ${filter} filter value '${value}'.`,
    recovery,
    value,
    filter,
  )
}

const validateStaticFilters = (filters: PublicAgentSearchFilters): void => {
  requireSupportedFilter('pricing', filters.pricing, AGENT_SEARCH_PRICING_VALUES)
  requireSupportedFilter('platform', filters.platform, AGENT_SEARCH_PLATFORM_VALUES)
  requireSupportedFilter('resourceKind', filters.resourceKind, RESOURCE_KIND_VALUES)
  requireSupportedFilter('packageRegistry', filters.packageRegistry, PACKAGE_REGISTRY_VALUES)
  requireSupportedFilter('agentHost', filters.agentHost, AGENT_SETUP_RECIPE_CONFIG_HOST_VALUES)
  requireSupportedFilter('sourceAvailability', filters.sourceAvailability, SOURCE_AVAILABILITY_FILTER_VALUES)
  requireSupportedFilter(
    'securityCapability',
    filters.securityCapability,
    SECURITY_CAPABILITY_VALUES,
  )
  requireSupportedFilter(
    'agentInterfaceKind',
    filters.agentInterfaceKind,
    AGENT_INTERFACE_KIND_VALUES,
  )
  requireSupportedFilter(
    'integrationConnection',
    filters.integrationConnection,
    AGENT_SEARCH_INTEGRATION_CONNECTION_VALUES,
  )
}

// SAFETY: The source is a closed or validated string collection; widening only enables collection operations.
const referenceFilterValues = (
  tools: readonly PublicAgentSearchTool[],
  key: 'categories' | 'tags' | 'useCases',
): string[] =>
  tools.flatMap((tool) =>
    (tool[key] ?? []).flatMap((reference) => [reference.slug, reference.name].filter(Boolean) as string[]),
  )

// SAFETY: The source is a closed or validated string collection; widening only enables collection operations.
const integrationFilterValues = (tools: readonly PublicAgentSearchTool[]): string[] =>
  tools.flatMap((tool) =>
    (tool.integrations ?? []).flatMap((fact) =>
      // Only positive evidence advertises a supported filter value.
      isPositiveIntegrationStatus(fact.status)
        ? [fact.slug, fact.name].filter(Boolean) as string[]
        : [],
    ),
  )

const availableFilterValues = (
  tools: readonly PublicAgentSearchTool[],
  key: 'categories' | 'tags' | 'useCases' | 'integrations',
  options: PublicAgentSearchOptions,
): string[] => {
  const configured = options.availableFilters?.[key]
  if (!configured) {
    return key === 'integrations'
      ? integrationFilterValues(tools)
      : referenceFilterValues(tools, key)
  }
  // SAFETY: The source is a closed or validated string collection; widening only enables collection operations.
  return configured.flatMap((option) => [option.value, option.label].filter(Boolean) as string[])
}

const validateDynamicFilters = (
  tools: readonly PublicAgentSearchTool[],
  filters: PublicAgentSearchFilters,
  options: PublicAgentSearchOptions,
): void => {
  if (filters.category !== undefined) {
    requireSupportedFilter(
      'category',
      filters.category,
      availableFilterValues(tools, 'categories', options),
    )
  }
  if (filters.tag !== undefined) {
    requireSupportedFilter('tag', filters.tag, availableFilterValues(tools, 'tags', options))
  }
  if (filters.useCase !== undefined) {
    requireSupportedFilter(
      'useCase',
      filters.useCase,
      availableFilterValues(tools, 'useCases', options),
    )
  }
  if (filters.integration !== undefined) {
    requireSupportedFilter(
      'integration',
      filters.integration,
      availableFilterValues(tools, 'integrations', options),
    )
  }
}

const validateDynamicFilterSyntax = (filters: PublicAgentSearchFilters): void => {
  for (const filter of ['category', 'tag', 'useCase', 'integration'] as const) {
    const value = filters[filter]
    if (value === undefined || normalizePublicAgentSearchText(value)) continue
    throw new AgentSearchContractError(
      'agent_search_invalid_filter_value',
      `The ${filter} filter contains no searchable value after normalization.`,
      `Provide a non-empty ${filter} value containing a letter, number, or emoji.`,
      value,
      filter,
    )
  }
}

const validateFreshnessFilters = (filters: PublicAgentSearchFilters): void => {
  const checks: Array<{
    filter: 'destinationHealth' | 'verified' | 'lastCheckedAfter'
    recovery: string
  }> = [
    {
      filter: 'destinationHealth',
      recovery: "Use destinationHealth='healthy' or omit the filter.",
    },
    {filter: 'verified', recovery: "Use verified='true' or omit the filter."},
    {
      filter: 'lastCheckedAfter',
      recovery: 'Use an exact valid UTC date in YYYY-MM-DD format.',
    },
  ]
  for (const {filter, recovery} of checks) {
    if (filters[filter] === undefined) continue
    if (filters[filter] === null) {
      throw new AgentSearchContractError(
        'agent_search_invalid_filter_value',
        `The ${filter} filter cannot be null when supplied.`,
        recovery,
        filters[filter],
        filter,
      )
    }
    const parsed = parseCatalogFreshnessFilters({[filter]: filters[filter]})
    if (parsed.ok) continue
    throw new AgentSearchContractError(
      'agent_search_invalid_filter_value',
      parsed.errors.join('; '),
      recovery,
      filters[filter],
      filter,
    )
  }
}

const validateQuery = (query: string | undefined): void => {
  if (query === undefined) return
  const observedCharacters = Array.from(query).length
  if (observedCharacters > AGENT_SEARCH_MAX_QUERY_CHARACTERS) {
    const recovery = `Shorten the query to at most ${AGENT_SEARCH_MAX_QUERY_CHARACTERS} characters.`
    throw new AgentSearchContractError(
      'agent_search_query_too_long',
      `Search query exceeds the ${AGENT_SEARCH_MAX_QUERY_CHARACTERS}-character limit (observed ${observedCharacters}).`,
      recovery,
      observedCharacters,
      'query',
      AGENT_SEARCH_MAX_QUERY_CHARACTERS,
    )
  }

  if (query.trim() && !normalizePublicAgentSearchText(query)) {
    throw new AgentSearchContractError(
      'agent_search_query_normalized_empty',
      'Search query contains no searchable text after normalization.',
      'Include at least one letter, number, or emoji in the query.',
      query,
      'query',
    )
  }
}

const validateResultLimit = (limit: number | undefined): void => {
  if (limit === undefined) return
  if (Number.isInteger(limit) && limit >= 1 && limit <= AGENT_SEARCH_MAX_RESULT_LIMIT) return

  const recovery = `Use a whole-number result limit between 1 and ${AGENT_SEARCH_MAX_RESULT_LIMIT}.`
  const observedValue = Number.isFinite(limit) ? limit : String(limit)
  throw new AgentSearchContractError(
    'agent_search_result_limit_out_of_range',
    `Search result limit must be between 1 and ${AGENT_SEARCH_MAX_RESULT_LIMIT} (observed ${String(limit)}).`,
    recovery,
    observedValue,
    'limit',
    AGENT_SEARCH_MAX_RESULT_LIMIT,
  )
}

export const validatePublicAgentSearchRequest = (
  filters: PublicAgentSearchFilters = {},
): void => {
  for (const language of filters.languages ?? []) {
    if (programmingLanguageIdSchema.safeParse(language).success) continue
    throw new AgentSearchContractError(
      'agent_search_invalid_filter_value', 'Invalid programming language identifier.',
      'Use stable language IDs from filters.supportedLanguages, such as python or typescript.', language, 'languages',
    )
  }
  validateStaticFilters(filters)
  validateDynamicFilterSyntax(filters)
  validateFreshnessFilters(filters)
  validateQuery(filters.query)
  validateResultLimit(filters.limit)
}

// Ranking policy and vocabulary receipt: upstream docs/measurements/agent-search-natural-queries-2026-11-10.md.
const queryStopwords = new Set([
  'a', 'an', 'the', 'for', 'to', 'of', 'and', 'with', 'in', 'on',
  'app', 'apps', 'library', 'libraries', 'tool', 'tools',
])

const foldSearchToken = (token: string): string => {
  // A literal auth prefix would also retrieve author/authoring. Keep this
  // common intent explicit; OAuth remains a distinct protocol token.
  if (/^(?:auth|authentication|authorization|authenticate|authorize|authn|authz)$/.test(token)) return 'auth'
  if (token.length > 5 && token.endsWith('ing') && /[aeiou]/.test(token.slice(0, -3))) return token.slice(0, -3)
  if (token.length > 4 && token.endsWith('ed') && /[aeiou]/.test(token.slice(0, -2))) return token.slice(0, -2)
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`
  if (token.endsWith('s') && token.length > 3 && !/(?:ss|us|is)$/.test(token)) return token.slice(0, -1)
  return token
}

const searchWords = (value: string | undefined): string[] =>
  tokenizePublicAgentSearchText(value).map(foldSearchToken)

const matchesSearchToken = (words: readonly string[], token: string): boolean =>
  words.some((word) => word === token || (token !== 'auth' && word.startsWith(token)))

interface ToolSearchText {
  source: string
  text: string[]
  identity: string[]
  taxonomy: string[]
  description: string[]
  name: string
  slug: string
}

// Weak keys release prepared words with the feed. The source comparison also
// invalidates cached fields after in-place editorial changes, including facets.
const toolSearchText = new WeakMap<PublicAgentSearchTool, ToolSearchText>()
const getToolSearchText = (tool: PublicAgentSearchTool): ToolSearchText => {
  const taxonomy = [...(tool.tags ?? []), ...(tool.categories ?? []), ...(tool.useCases ?? [])]
    .flatMap((reference) => [reference.slug, reference.name]).join(' ')
  const source = JSON.stringify([tool.search?.text, tool.name, tool.slug, taxonomy, tool.description])
  const existing = toolSearchText.get(tool)
  if (existing?.source === source) return existing
  const prepared: ToolSearchText = {
    source,
    text: searchWords(tool.search?.text),
    identity: searchWords(`${tool.name ?? ''} ${tool.slug}`),
    taxonomy: searchWords(taxonomy),
    description: searchWords(tool.description),
    name: searchWords(tool.name).join(' '),
    slug: searchWords(tool.slug).join(' '),
  }
  toolSearchText.set(tool, prepared)
  return prepared
}

/**
 * Inverse document frequency of each query token in the searched catalog.
 * A rare token such as postgres says more about intent than a common token
 * such as hosting, so it carries more weight among Tools with equal coverage.
 */
const queryTokenWeights = (tools: readonly PublicAgentSearchTool[], queryTokens: readonly string[]): Map<string, number> => {
  const documentFrequency = new Map(queryTokens.map((token) => [token, 0]))
  for (const tool of tools) {
    const {text} = getToolSearchText(tool)
    for (const token of queryTokens) {
      if (matchesSearchToken(text, token)) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1)
    }
  }
  // BM25's non-negative form: ln(1 + (N - df + 0.5) / (df + 0.5)).
  return new Map(queryTokens.map((token) => {
    const frequency = documentFrequency.get(token) ?? 0
    return [token, Math.log(1 + (tools.length - frequency + 0.5) / (frequency + 0.5))]
  }))
}

const scoreTool = (
  tool: PublicAgentSearchTool,
  queryTokens: string[],
  tokenWeights: ReadonlyMap<string, number>,
  maxTokenWeight: number,
  hasQuery: boolean,
  requireAllTokens: boolean,
): number => {
  if (!hasQuery) return 1
  if (queryTokens.length === 0) return 0

  const prepared = getToolSearchText(tool)
  let matched = 0
  let fieldScore = 0
  for (const token of queryTokens) {
    if (!matchesSearchToken(prepared.text, token)) continue
    matched += 1
    const fieldWeight = matchesSearchToken(prepared.identity, token) ? 8
      : matchesSearchToken(prepared.taxonomy, token) ? 4
        : matchesSearchToken(prepared.description, token) ? 2
          : 1
    fieldScore += fieldWeight * (tokenWeights.get(token) ?? 0)
  }
  if (matched === 0 || (requireAllTokens && matched !== queryTokens.length)) return 0
  const query = queryTokens.join(' ')
  const identityBonus = prepared.name === query || prepared.slug === query ? 2
    : prepared.name.startsWith(`${query} `) || prepared.slug.startsWith(`${query} `) ? 1 : 0
  // One additional matched token outweighs every possible field, rarity and identity bonus.
  const coverageWeight = 8 * maxTokenWeight * queryTokens.length + 3
  // Rounding keeps scores readable and identical across serializations.
  return Math.round((matched * coverageWeight + fieldScore + identityBonus) * 1000) / 1000
}

interface CatalogSearchMatches<TTool extends PublicAgentSearchTool> {
  results: PublicAgentSearchResult<TTool>[]
  hasMatchesBeforeFilters: boolean
}

const searchCatalog = <TTool extends PublicAgentSearchTool>(
  tools: readonly TTool[],
  filters: PublicAgentSearchFilters = {},
  options: PublicAgentSearchOptions = {},
): CatalogSearchMatches<TTool> => {
  validatePublicAgentSearchRequest(filters)
  validateDynamicFilters(tools, filters, options)
  const hasQuery = Boolean(filters.query?.trim())
  const queryTokens = [...new Set(tokenizePublicAgentSearchText(filters.query)
    .filter((token) => !queryStopwords.has(token)).map(foldSearchToken))]
  if (hasQuery) {
    const invalidTool = tools.find(
      (tool) => !isRuntimeString(tool.search?.text) || !tool.search.text.trim(),
    )
    if (invalidTool) {
      throw new AgentSearchContractError(
        'agent_search_catalog_projection_invalid',
        `Tool '${invalidTool.slug}' is missing required search.text for a non-empty query.`,
        'Regenerate the public search-index projection before retrying the search.',
        invalidTool.slug,
        undefined,
        undefined,
        'search.text',
      )
    }
  }
  const freshnessFilters = parseCatalogFreshnessFilters(filters)
  const packageRegistry = PACKAGE_REGISTRY_VALUES.find((value) => filters.packageRegistry && matchesValue(value, filters.packageRegistry))
  const agentHost = filters.agentHost === undefined
    ? undefined
    : AGENT_SETUP_RECIPE_CONFIG_HOST_VALUES.find((host) => matchesValue(host, filters.agentHost))

  const sourceAvailability = filters.sourceAvailability === undefined
    ? undefined
    : normalizeSourceAvailabilityFilter(filters.sourceAvailability) ?? filters.sourceAvailability
  const categoryMatches = categoryFilterMatcher(filters.category, options.availableFilters?.categories)

  const requireAllTokens = parseToolSearchIdentifier(filters.query ?? '').kind !== 'not_explicit'
  const pinnedSlug = resolveSearchPinSlug(filters.query, options.lookupResolver)
  let pinned: {tool: TTool; score: number} | undefined

  const matchesFilters = (tool: TTool): boolean => {
    if (!matchesValue(tool.pricing, filters.pricing)) return false
    if (
      filters.platform &&
      !(tool.platforms ?? []).some((platform) => matchesValue(platform, filters.platform))
    ) return false
    if (!categoryMatches(tool.categories)) return false
    if (!matchesSourceAvailability(tool.deployment?.sourceAvailability, sourceAvailability)) return false
    if (!matchesReference(tool.tags, filters.tag)) return false
    if (!matchesReference(tool.useCases, filters.useCase)) return false
    if (!matchesValue(tool.resourceKindIsFallback ? undefined : tool.resourceKind?.value, filters.resourceKind)) return false
    if (!matchesSupportedLanguages(tool.supportedLanguages, filters.languages)) return false
    if (!matchesAgentSetupRecipeHost(tool.setupRecipeHosts, agentHost)) return false
    if (packageRegistry && getPackageRegistry(tool.resourceIdentity?.kind) !== packageRegistry) return false
    if (
      filters.securityCapability &&
      !(tool.securityCapabilities ?? []).some((capability) =>
        matchesValue(capability, filters.securityCapability),
      )
    ) return false
    if (
      filters.agentInterfaceKind &&
      !(tool.agentInterfaceKinds ?? []).some((kind) =>
        matchesValue(kind, filters.agentInterfaceKind),
      )
    ) return false
    if (
      !matchesIntegrations(
        tool.integrations,
        filters.integration,
        filters.integrationConnection,
      )
    ) return false
    return matchesCatalogFreshnessFilters(tool.freshness, freshnessFilters)
  }

  const tokenWeights = hasQuery ? queryTokenWeights(tools, queryTokens) : new Map<string, number>()
  const maxTokenWeight = Math.max(0, ...tokenWeights.values())
  let hasMatchesBeforeFilters = false
  const ranked: Array<PublicAgentSearchResult<TTool> & {index: number}> = []
  tools.forEach((tool, index) => {
    const included = matchesFilters(tool)
    // Once a query match is known, excluded Tools need no text scoring.
    if (!included && hasMatchesBeforeFilters) return
    const score = scoreTool(tool, queryTokens, tokenWeights, maxTokenWeight, hasQuery, requireAllTokens)
    if (score > 0 || tool.slug === pinnedSlug) hasMatchesBeforeFilters = true
    if (!included) return
    if (tool.slug === pinnedSlug) pinned = {tool, score}
    if (score > 0) ranked.push({tool, score, index})
  })

  const results = ranked
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({tool, score}) => ({tool, score}))

  const ordered = pinned
    ? [pinned, ...results.filter(({tool}) => tool.slug !== pinnedSlug)]
    : results

  return {results: filters.limit === undefined ? ordered : ordered.slice(0, filters.limit), hasMatchesBeforeFilters}
}

/** Existing array interface retained for catalog and recommendation consumers. */
export const searchPublicAgentCatalog = <TTool extends PublicAgentSearchTool>(
  tools: readonly TTool[],
  filters: PublicAgentSearchFilters = {},
  options: PublicAgentSearchOptions = {},
): PublicAgentSearchResult<TTool>[] => searchCatalog(tools, filters, options).results

/** Rank existing index Articles with the Tool token matcher, without Tool-only facets. */
export const searchPublicAgentArticles = (
  articles: readonly PublicAgentSearchArticle[],
  query?: string,
): PublicAgentSearchArticleResult[] => {
  validatePublicAgentSearchRequest({query})
  if (!query?.trim()) return []

  return searchPublicAgentCatalog(articles.map((article) => ({
    article,
    name: article.title,
    slug: article.slug,
    description: article.excerpt,
    search: {text: [article.title, article.excerpt, article.slug].filter(Boolean).join(' ')},
  })), {query}).map(({tool, score}) => {
    const result: PublicAgentSearchArticleResult = {
      kind: 'article',
      title: tool.article.title,
      slug: tool.article.slug,
      url: tool.article.url,
      score,
    }
    if (tool.article.excerpt !== undefined) result.excerpt = tool.article.excerpt
    return result
  })
}

const resolveSearchPinSlug = (
  query: string | undefined,
  resolver: ToolLookupResolver | undefined,
): string | undefined => {
  if (!resolver || !query) return undefined
  const outcome = resolveToolSearchIdentifier(resolver, query)
  return outcome.kind === 'resolved' || outcome.kind === 'aliased'
    ? outcome.tool.slug
    : undefined
}

const FILTER_CAPABILITY_LABELS = {
  agentInterfaceKind: 'Agent Interface',
  securityCapability: 'security capability',
  integration: 'Integration',
  integrationConnection: 'Integration',
  agentHost: 'Agent Host Setup Recipe',
  languages: 'supported programming language',
  sourceAvailability: 'source availability',
}

const requireCatalogCapability = (
  filter: keyof typeof FILTER_CAPABILITY_LABELS,
  value: string | string[] | undefined,
  available: boolean,
): void => {
  if (value === undefined || available) return
  const capability = FILTER_CAPABILITY_LABELS[filter]
  throw new AgentSearchContractError(
    'capability_unavailable',
    `This Search Index does not expose ${capability} data.`,
    `Use a newer Search Index or omit the ${filter} filter.`,
    value,
    filter,
  )
}

/** Executes catalog-aware search after validating feed-dependent capabilities and facets once. */
const searchCatalogWithCapabilities = <TTool extends PublicAgentSearchTool>(
  tools: readonly TTool[],
  filters: PublicAgentSearchFilters,
  capabilities: PublicAgentSearchCatalogCapabilities,
  options?: Pick<PublicAgentSearchOptions, 'lookupResolver'>,
): CatalogSearchMatches<TTool> => {
  requireCatalogCapability('languages', filters.languages?.length ? [...filters.languages] : undefined, capabilities.supportedLanguagesAvailable === true)
  requireCatalogCapability(
    'securityCapability',
    filters.securityCapability,
    capabilities.securityCapabilitiesAvailable,
  )
  requireCatalogCapability(
    'agentInterfaceKind',
    filters.agentInterfaceKind,
    capabilities.agentInterfaceKindsAvailable,
  )
  requireCatalogCapability(
    'integration',
    filters.integration,
    capabilities.integrationsAvailable === true,
  )
  requireCatalogCapability(
    'integrationConnection',
    filters.integrationConnection,
    capabilities.integrationsAvailable === true,
  )
  requireCatalogCapability(
    'sourceAvailability',
    filters.sourceAvailability,
    capabilities.sourceAvailabilityAvailable === true,
  )
  requireCatalogCapability(
    'agentHost',
    filters.agentHost,
    capabilities.setupRecipeHosts?.some((host) => matchesValue(host, filters.agentHost)) ?? false,
  )
  return searchCatalog(tools, filters, {...capabilities, ...options})
}

export const searchPublicAgentCatalogWithCapabilities = <TTool extends PublicAgentSearchTool>(
  tools: readonly TTool[],
  filters: PublicAgentSearchFilters,
  capabilities: PublicAgentSearchCatalogCapabilities,
  options?: Pick<PublicAgentSearchOptions, 'lookupResolver'>,
): PublicAgentSearchResult<TTool>[] => searchCatalogWithCapabilities(tools, filters, capabilities, options).results

export interface AgentSearchRecovery {
  code: 'no_catalog_matches' | 'filters_excluded_matches'
  message: string
  handoffQueryLimit?: {limitCharacters: number; observedCharacters: number}
}

export interface PublicAgentSearchOutcome<TTool extends PublicAgentSearchTool> {
  results: PublicAgentSearchResult<TTool>[]
  recovery?: AgentSearchRecovery
  handoffs?: RegistryHandoff[]
}

/** Ranking and before-facet match detection share one scan. No registry is fetched. */
export const searchPublicAgentCatalogWithRecovery = <TTool extends PublicAgentSearchTool>(
  tools: readonly TTool[],
  filters: PublicAgentSearchFilters,
  capabilities: PublicAgentSearchCatalogCapabilities,
  options?: Pick<PublicAgentSearchOptions, 'lookupResolver'>,
): PublicAgentSearchOutcome<TTool> => {
  const {results, hasMatchesBeforeFilters} = searchCatalogWithCapabilities(tools, filters, capabilities, options)
  if (results.length > 0 || !filters.query?.trim()) return {results}
  if (hasMatchesBeforeFilters) {
    return {results, recovery: {
      code: 'filters_excluded_matches',
      message: 'No SlothHub matches for these filters. Omit or change filters to see catalog matches.',
    }}
  }
  const handoffs = getRegistryHandoffs(filters.query ?? '', {
    resourceKind: RESOURCE_KIND_VALUES.find((value) => filters.resourceKind && matchesValue(value, filters.resourceKind)),
    agentInterfaceKind: AGENT_INTERFACE_KIND_VALUES.find((value) => filters.agentInterfaceKind && matchesValue(value, filters.agentInterfaceKind)),
    packageRegistry: PACKAGE_REGISTRY_VALUES.find((value) => filters.packageRegistry && matchesValue(value, filters.packageRegistry)),
  })
  const observedCharacters = Array.from((filters.query ?? '').normalize('NFC').trim().replace(/\s+/gu, ' ')).length
  const truncated = handoffs.some(({href}) => new URL(href).searchParams.has('q')) && observedCharacters > REGISTRY_HANDOFF_QUERY_MAX_LENGTH
  return {results, handoffs, recovery: {
    code: 'no_catalog_matches',
    message: 'No SlothHub catalog matches.' + (handoffs.length > 0
      ? ' Official registry links are unreviewed external destinations.' : ' Try changing the search query.') + (truncated
      ? ` Registry links use the first ${REGISTRY_HANDOFF_QUERY_MAX_LENGTH} Unicode characters (observed ${observedCharacters}); shorten the query to search it in full.` : ''),
    ...(truncated ? {handoffQueryLimit: {limitCharacters: REGISTRY_HANDOFF_QUERY_MAX_LENGTH, observedCharacters}} : undefined),
  }}
}
