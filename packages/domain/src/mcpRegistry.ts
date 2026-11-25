import {formatAgentSetupRecipeConfig} from './agentSetupRecipeConfig.js'
import {
  AGENT_SETUP_RECIPE_HOSTS,
  AGENT_SETUP_RECIPE_HOST_VALUES,
  getAgentSetupRecipeHostLabel,
  getAgentSetupRecipeHostConfigFormat,
  type AgentSetupRecipeConfigHost,
  type AgentSetupRecipeHost,
} from './agentSetupRecipeHosts.js'
export {
  AGENT_SETUP_RECIPE_CONFIG_HOST_VALUES,
  AGENT_SETUP_RECIPE_HOST_VALUES,
  getAgentSetupRecipeHostLabel,
  getAgentSetupRecipeHostConfigFileName,
  getAgentSetupRecipeCopyHint,
  getAgentSetupRecipeHostConfigTargetKind,
  getAgentSetupRecipeHostConfigHint,
  getAgentSetupRecipeHostConfigFormat,
  getAgentSetupRecipeHostRootKey,
  isAgentSetupRecipeConfigHost,
  isAgentSetupRecipeHost,
  matchesAgentSetupRecipeHost,
  type AgentSetupRecipeConfigHost,
  type AgentSetupRecipeHost,
} from './agentSetupRecipeHosts.js'
import type {JsonObject, JsonValue} from './jsonValue.js'
import type {
  RegistryEnrichmentFacts,
  RegistryEnrichmentRequest,
  RegistryEnrichmentSnapshot,
} from './registryEnrichment.js'
import {
  hasRuntimeObjectType,
  isRuntimeString,
} from './runtimeValidation.js'
import {isBlockedPublicHostname, normalizePublicHostname} from './urlSafety.js'
import {isValidCatalogTimestamp} from './catalogFreshnessSearch.js'
import {REPOSITORY_OBSERVATION_NOT_FOUND_THRESHOLD} from './repositoryObservation.js'
import {readMcpRegistryPackages, type McpRegistryPackage} from './mcpRegistryPackages.js'
import {buildMcpRegistryStdioCommand, type McpRegistryEnvironmentName} from './mcpRegistryStdio.js'

/**
 * Official MCP Registry consumption. The sweep fetches
 * `GET https://registry.modelcontextprotocol.io/v0.1/servers/{name}/versions/latest`
 * on a slow cadence and persists only the selected facts a public recipe needs —
 * never the full `server.json`, `_meta` blob, icons, or env scaffolding.
 * Public surfaces derive the Cursor recipe from the stored observation; nothing
 * live-fetches the registry on a request path.
 */
export const MCP_REGISTRY_API_ORIGIN = 'https://registry.modelcontextprotocol.io'
export const MCP_REGISTRY_OFFICIAL_META_KEY =
  'io.modelcontextprotocol.registry/official'

export const MCP_REGISTRY_SERVER_STATUS_VALUES = [
  'active',
  'deprecated',
  'deleted',
] as const
export type McpRegistryServerStatus =
  (typeof MCP_REGISTRY_SERVER_STATUS_VALUES)[number]

export const MCP_REGISTRY_REMOTE_TRANSPORT = 'streamable-http'

/**
 * A header the registry says a remote expects — name and flags only. Header
 * `value` templates, `default`, `choices`, free-text `description`, and
 * `variables` are dropped at parse time so no registry-carried secret or
 * prose reaches `JSON.stringify(snapshot.facts)` (ADR 0004). `isSecret`
 * folds in templated variables marked secret so a `Bearer {api_key}` header
 * still reads as secret-bearing.
 */
export interface McpRegistryRemoteHeader {
  name: string
  isRequired: boolean
  isSecret: boolean
}

/**
 * A registry-published remote transport pointer. The URL is stored verbatim —
 * safety screening happens when a recipe is derived, not at persistence time.
 */
export interface McpRegistryRemote {
  type: typeof MCP_REGISTRY_REMOTE_TRANSPORT | 'sse'
  url: string
  headers?: McpRegistryRemoteHeader[]
}

/**
 * Bounded public-safe facts persisted on the Agent Interface. This is the
 * "own store" the MCP Registry docs ask aggregators to keep; the Cursor recipe
 * is derived from it at read time so every surface agrees.
 */
export interface McpRegistryObservation {
  registryName: string
  status: McpRegistryServerStatus
  version?: string
  remotes: McpRegistryRemote[]
  packages?: McpRegistryPackage[]
  /** Last successful registry fetch — mirrors the snapshot's `fetchedAt`. */
  observedAt: string
}

/**
 * The host's copy-only CLI alternative to editing the config file — e.g.
 * Codex's `codex mcp add <name> --url <url>`. Rendered for review only;
 * SlothHub never executes it. Undefined when the host has none.
 */
export const getAgentSetupRecipeCliCommand = (
  recipe: Pick<ReadyAgentSetupRecipe, 'host' | 'serverKey' | 'url'>,
): string | undefined => {
  const meta = AGENT_SETUP_RECIPE_HOSTS[recipe.host]
  const url = recipe.url
  if (!url || !meta.cliCommand) return undefined
  // The command is shell text — only bare-identifier keys are safe to
  // interpolate unquoted; anything else falls back to the config snippet.
  if (!/^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(recipe.serverKey)) return undefined
  if (!isPublicMcpRemoteUrl(url)) return undefined
  if (/[\p{Cc}\p{Cf}]|\$\{/u.test(url)) return undefined
  if (recipe.host === 'claude_code' &&
    ['workspace', 'claude-in-chrome', 'computer-use'].includes(recipe.serverKey)) return undefined
  return meta.cliCommand
    .replace('{serverKey}', recipe.serverKey)
    .replace('{url}', () => /^[A-Za-z0-9_/:.@%+=,-]+$/.test(url)
      ? url
      : `'${url.replaceAll("'", "'\"'\"'")}'`)
}

interface ReadyRemoteAgentSetupRecipe {
  state: 'ready'
  host: AgentSetupRecipeConfigHost
  /** `mcpServers` object key — the Tool slug. */
  serverKey: string
  url: string
  registryName: string
  version: string
  observedAt: string
  /**
   * Header names the remote declares where at least one is required or
   * secret-bearing. The snippet carries `${NAME}` placeholders for each —
   * names only, never a registry-shipped value.
   */
  headers?: McpRegistryRemoteHeader[]
  /**
   * The other screened remote URLs the registry published for this server,
   * in stored order, deduplicated against `url` and each other. Disclosed so
   * users can see the registry listed more than the one remote the recipe
   * selected — never copied into a snippet.
   */
  alternateUrls?: string[]
  /** The complete copyable config fragment — a whole file for first-time setup. */
  snippet: string
  /** Screened URL-only editor confirmation link; absent for other hosts. */
  installLink?: string
  /**
   * The mergeable entry to paste under the host's root key — the default
   * copy target so existing config entries are never replaced by a
   * whole-file paste. JSON hosts emit `{serverKey: {...}}`; for TOML hosts
   * this is the same `[root.<key>]` table as `snippet`, which is inherently
   * additive. Continue emits a YAML list entry; its full snippet includes
   * the standalone name/version/schema metadata.
   */
  entrySnippet: string
}

export interface ReadyStdioAgentSetupRecipe extends Omit<ReadyRemoteAgentSetupRecipe, 'host' | 'url' | 'headers' | 'alternateUrls' | 'installLink'> {
  host: 'cursor'
  transport: 'stdio'
  command: 'npx' | 'uvx'
  args: string[]
  environmentVariables: McpRegistryEnvironmentName[]
  url?: never
  headers?: never
  alternateUrls?: never
}

type ReadyAgentSetupRecipe = ReadyRemoteAgentSetupRecipe | ReadyStdioAgentSetupRecipe

export type SetupRecipeSnippetInput =
  | Pick<ReadyRemoteAgentSetupRecipe, 'host' | 'serverKey' | 'url' | 'headers'>
  | Pick<ReadyStdioAgentSetupRecipe, 'host' | 'serverKey' | 'transport' | 'command' | 'args'>

/**
 * The legacy singular `setupRecipe` contract. Its `unknown` state stays hostless
 * so already-deployed strict parsers keep accepting the field; consumers should
 * prefer `setupRecipes`.
 */
export type PublicAgentSetupRecipe =
  | ReadyRemoteAgentSetupRecipe
  | {state: 'unknown'}

export const AGENT_SETUP_RECIPE_UNKNOWN_REASON_VALUES = [
  'missing_remotes',
  'deprecated_registry',
  'no_recipe',
] as const
export type AgentSetupRecipeUnknownReason =
  (typeof AGENT_SETUP_RECIPE_UNKNOWN_REASON_VALUES)[number] | 'sse_only'

/**
 * One entry of the per-host `setupRecipes` array. `unknown` names its host so
 * entries stay distinguishable when a Tool supports several Agent Hosts.
 */
export type PublicRemoteAgentSetupRecipeEntry =
  | ReadyRemoteAgentSetupRecipe
  | {state: 'unknown'; host: AgentSetupRecipeHost; reason?: AgentSetupRecipeUnknownReason; registryUrl?: string}

/** Resolved presentation entry: remote first, then the additive stdio fallback. */
export type PublicAgentSetupRecipeEntry = PublicRemoteAgentSetupRecipeEntry | ReadyStdioAgentSetupRecipe

/**
 * Observed `remotes` lists are one or two entries (see the live registry
 * payload captured for upstream issue #521); four leaves headroom without letting an
 * oversized record bloat the public Tool document.
 */
export const MAX_MCP_REGISTRY_OBSERVED_REMOTES = 4
/**
 * Live-registry receipt (2026-09-16, first 800 server records, 722 remotes):
 * every header-bearing remote declared exactly one header — 458
 * `Authorization`, 2 `x-api-key`. Eight gives 8x headroom while bounding the
 * stored observation and the snippet against a malformed record.
 */
export const MAX_MCP_REGISTRY_REMOTE_HEADERS = 8
const MAX_REGISTRY_NAME_LENGTH = 200
const MAX_REGISTRY_VERSION_LENGTH = 64
const MAX_REMOTE_URL_LENGTH = 2048
const MAX_REMOTE_HEADER_NAME_LENGTH = 64
/** RFC 7230 field-name (token) grammar. */
const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

const MCP_REGISTRY_STATUS_SET = new Set<string>(MCP_REGISTRY_SERVER_STATUS_VALUES)

const isJsonObject = (value: JsonValue): value is JsonObject =>
  hasRuntimeObjectType(value) && value !== null && !Array.isArray(value)

const trimText = (value: JsonValue, maxLength: number): string | undefined => {
  if (!isRuntimeString(value)) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : undefined
}

const invalidResponse = (message: string): Error =>
  Object.assign(new Error(message), {code: 'REGISTRY_INVALID_RESPONSE'})

const readRemoteHeader = (value: JsonValue): McpRegistryRemoteHeader | null => {
  if (!isJsonObject(value)) return null
  const name = trimText(value.name, MAX_REMOTE_HEADER_NAME_LENGTH)
  if (!name || !HTTP_HEADER_NAME_PATTERN.test(name)) return null
  const variables = isJsonObject(value.variables) ? value.variables : undefined
  const hasSecretVariable =
    variables !== undefined &&
    Object.values(variables).some(
      (variable) => isJsonObject(variable) && variable.isSecret === true,
    )
  return {
    name,
    isRequired: value.isRequired === true,
    isSecret: value.isSecret === true || hasSecretVariable,
  }
}

const readRemoteHeaders = (
  value: JsonValue,
): McpRegistryRemoteHeader[] | undefined => {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return undefined
  if (value.length > MAX_MCP_REGISTRY_REMOTE_HEADERS) {
    throw invalidResponse(
      `MCP Registry remote declared ${value.length} headers, over the limit of ${MAX_MCP_REGISTRY_REMOTE_HEADERS}`,
    )
  }
  const headers = value
    .map(readRemoteHeader)
    .filter((header): header is McpRegistryRemoteHeader => header !== null)
  return headers.length > 0 ? headers : undefined
}

const readRemote = (value: JsonValue): McpRegistryRemote | null => {
  if (!isJsonObject(value)) return null
  if (value.type !== MCP_REGISTRY_REMOTE_TRANSPORT && value.type !== 'sse') return null
  const url = trimText(value.url, MAX_REMOTE_URL_LENGTH)
  if (!url) return null
  const headers = value.type === MCP_REGISTRY_REMOTE_TRANSPORT ? readRemoteHeaders(value.headers) : undefined
  return {
    type: value.type,
    url,
    ...(headers ? {headers} : undefined),
  }
}

const readRemotes = (value: JsonValue): McpRegistryRemote[] => {
  if (!Array.isArray(value)) return []
  return value
    .map(readRemote)
    .filter((remote): remote is McpRegistryRemote => remote !== null)
    // Preserve current HTTP recipes even when SSE entries precede the stored cap.
    .sort((left, right) => Number(right.type === MCP_REGISTRY_REMOTE_TRANSPORT) - Number(left.type === MCP_REGISTRY_REMOTE_TRANSPORT))
    .slice(0, MAX_MCP_REGISTRY_OBSERVED_REMOTES)
}

/** Registry timestamps arrive with 6-digit fractions — normalize to ISO ms. */
const readRegistryTimestamp = (value: JsonValue): string | undefined => {
  const text = trimText(value, 64)
  if (!text || !Number.isFinite(Date.parse(text))) return undefined
  return new Date(text).toISOString()
}

/**
 * Parse the registry's `{server, _meta}` envelope into a snapshot. Fails closed
 * on any envelope that does not carry the registry-managed status — a missing
 * `_meta` block or an unrecognized status is invalid data, not "unknown".
 */
export const normalizeMcpRegistryEnrichment = (
  payload: JsonValue,
  request: RegistryEnrichmentRequest,
  fetchedAt: string,
): RegistryEnrichmentSnapshot => {
  if (!isJsonObject(payload) || !isJsonObject(payload.server)) {
    throw invalidResponse('MCP Registry response omitted the server record')
  }

  const meta = isJsonObject(payload._meta)
    ? payload._meta[MCP_REGISTRY_OFFICIAL_META_KEY]
    : undefined
  if (!isJsonObject(meta) || !isRuntimeString(meta.status)) {
    throw invalidResponse('MCP Registry response omitted the official status')
  }
  const status = meta.status.trim().toLowerCase()
  if (!MCP_REGISTRY_STATUS_SET.has(status)) {
    throw invalidResponse(`MCP Registry returned an unrecognized status "${status}"`)
  }

  const server = payload.server
  const name = trimText(server.name, MAX_REGISTRY_NAME_LENGTH)
  if (!name) {
    throw invalidResponse('MCP Registry response omitted the server name')
  }
  const version = trimText(server.version, MAX_REGISTRY_VERSION_LENGTH)
  const remotes = readRemotes(server.remotes)
  const publishedAt = readRegistryTimestamp(meta.publishedAt)
  const updatedAt = readRegistryTimestamp(meta.updatedAt)

  const facts: RegistryEnrichmentFacts = {
    name,
    ...(version ? {latestVersion: version} : undefined),
    mcpRegistryStatus: status as McpRegistryServerStatus,
    mcpRemotes: remotes,
    ...(Array.isArray(server.packages)
      ? {mcpPackages: readMcpRegistryPackages(server.packages)}
      : undefined),
    ...(publishedAt ? {publishedAt} : undefined),
    ...(updatedAt ? {updatedAt} : undefined),
  }

  return {
    ...request,
    status: 'ok',
    fetchedAt,
    facts,
  }
}

const IPV4_LITERAL_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/

/**
 * The remote-URL screen applied before a URL is quoted into a recipe:
 * parsed HTTPS only, no userinfo, no fragments, no IP literals, and no
 * localhost/private/link-local destinations.
 */
export const isPublicMcpRemoteUrl = (value: string): boolean => {
  // Host applications expand variables in config values; recipes require a
  // concrete published URL, not an interactive input or environment template.
  if (value.includes('{') || value.includes('}')) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }

  if (url.protocol !== 'https:') return false
  if (url.username || url.password || url.hash) return false
  const hostname = normalizePublicHostname(url.hostname)
  if (!hostname.includes('.') || IPV4_LITERAL_PATTERN.test(hostname) || hostname.includes(':')) {
    return false
  }
  return !isBlockedPublicHostname(hostname)
}

/**
 * Fold a fresh snapshot into the persisted public observation. `stale`
 * snapshots carry last-known facts — public surfaces may keep showing them —
 * while failures without facts clear the pointer so no recipe is advertised.
 */
export const buildMcpRegistryObservation = (
  snapshot: RegistryEnrichmentSnapshot | null | undefined,
): McpRegistryObservation | null => {
  if (
    !snapshot ||
    snapshot.source !== 'mcp_registry' ||
    (snapshot.status !== 'ok' && snapshot.status !== 'stale') ||
    !snapshot.facts?.mcpRegistryStatus
  ) {
    return null
  }

  // A stale snapshot still carrying last-known facts clears them once the
  // registry has missed the record on enough consecutive checks — the same
  // confirmed-missing gate the review comparer applies.
  if (
    snapshot.failureKind === 'not_found' &&
    (snapshot.failureCount ?? 1) >= REPOSITORY_OBSERVATION_NOT_FOUND_THRESHOLD
  ) {
    return null
  }

  return {
    registryName: snapshot.facts.name ?? snapshot.registryId,
    status: snapshot.facts.mcpRegistryStatus,
    ...(snapshot.facts.latestVersion
      ? {version: snapshot.facts.latestVersion}
      : undefined),
    remotes: (snapshot.facts.mcpRemotes ?? []).slice(
      0,
      MAX_MCP_REGISTRY_OBSERVED_REMOTES,
    ),
    observedAt: snapshot.fetchedAt,
    ...(snapshot.facts.mcpPackages ? {packages: snapshot.facts.mcpPackages} : undefined),
  }
}

/** Parse the stored Agent Interface field at the public read boundary. */
export const normalizeMcpRegistryObservation = (
  value: JsonValue,
): McpRegistryObservation | null => {
  if (!isJsonObject(value)) return null
  const registryName = trimText(value.registryName, MAX_REGISTRY_NAME_LENGTH)
  const status = isRuntimeString(value.status)
    ? value.status.trim().toLowerCase()
    : ''
  if (!registryName || !MCP_REGISTRY_STATUS_SET.has(status)) return null
  const observedAt = trimText(value.observedAt, 64)
  if (!observedAt || !isValidCatalogTimestamp(observedAt)) return null
  const version = trimText(value.version, MAX_REGISTRY_VERSION_LENGTH)

  // Stored data over the header or package limits is corrupt. Treat the
  // observation as unusable rather than presenting incomplete setup guidance.
  let remotes: McpRegistryRemote[]
  let packages: McpRegistryPackage[] | undefined
  try {
    remotes = readRemotes(value.remotes)
    packages = value.packages === undefined ? undefined : readMcpRegistryPackages(value.packages)
  } catch {
    return null
  }

  return {
    registryName,
    status: status as McpRegistryServerStatus,
    ...(version ? {version} : undefined),
    remotes,
    observedAt,
    ...(packages ? {packages} : undefined),
  }
}

/**
 * Derive remote setup, with a Cursor-only stdio fallback. Requires the registry-managed status
 * to be exactly `active` — deprecated and deleted records have no current
 * recipe — plus an exact version and a screened remote or complete package.
 */
export const deriveAgentSetupRecipe = (input: {
  host: AgentSetupRecipeHost
  serverKey: string
  observation: McpRegistryObservation | null | undefined
}): ReadyAgentSetupRecipe | null => {
  if (input.host === 'claude_desktop') return null
  const {observation} = input
  const serverKey = input.serverKey.trim()
  if (
    !observation ||
    observation.status !== 'active' ||
    !observation.version ||
    !serverKey
  ) {
    return null
  }

  // The registry may publish several remotes; the recipe keeps the first
  // screened one as the copyable target and discloses the rest, deduplicated,
  // so the choice stays deterministic and nothing safe is silently dropped.
  const safeRemotes = observation.remotes.filter((entry) =>
    entry.type === MCP_REGISTRY_REMOTE_TRANSPORT && isPublicMcpRemoteUrl(entry.url),
  )
  const remote = safeRemotes[0]
  if (!remote) {
    if (input.host !== 'cursor') return null
    const local = observation.packages?.find((entry) => 'transport' in entry)
    if (!local || !('transport' in local)) return null
    const recipe: ReadyStdioAgentSetupRecipe = {
      state: 'ready', host: 'cursor', transport: 'stdio', serverKey,
      ...buildMcpRegistryStdioCommand(local),
      environmentVariables: local.environmentVariables,
      registryName: observation.registryName, version: observation.version,
      observedAt: observation.observedAt, snippet: '', entrySnippet: '',
    }
    return {...recipe, snippet: buildAgentSetupRecipeSnippet(recipe), entrySnippet: buildAgentSetupRecipeEntrySnippet(recipe)}
  }
  if (getAgentSetupRecipeHostConfigFormat(input.host) === 'shell' &&
      !getAgentSetupRecipeCliCommand({host: input.host, serverKey, url: remote.url})) return null
  // A URL-only host recipe cannot satisfy declared authentication requirements.
  if (AGENT_SETUP_RECIPE_HOSTS[input.host].headerMode === 'omit' &&
      remote.headers?.some((header) => header.isRequired || header.isSecret)) return null
  const alternateUrls = [
    ...new Set(safeRemotes.map((entry) => entry.url)),
  ].slice(1)

  // Placeholders appear only when at least one declared header is required or
  // secret-bearing — an all-optional header list needs nothing filled in.
  const headers =
    AGENT_SETUP_RECIPE_HOSTS[input.host].headerMode !== 'omit' &&
    remote.headers?.some((header) => header.isRequired || header.isSecret)
      ? remote.headers
      : undefined

  const recipe: ReadyAgentSetupRecipe = {
    state: 'ready',
    host: input.host,
    serverKey,
    url: remote.url,
    registryName: observation.registryName,
    version: observation.version,
    observedAt: observation.observedAt,
    ...(headers ? {headers} : undefined),
    ...(alternateUrls.length ? {alternateUrls} : undefined),
    snippet: '',
    entrySnippet: '',
  }
  const installLink = buildAgentHostInstallLink(recipe);
  if ('url' in installLink) recipe.installLink = installLink.url;
  return {
    ...recipe,
    snippet: buildAgentSetupRecipeSnippet(recipe),
    entrySnippet: buildAgentSetupRecipeEntrySnippet(recipe),
  }
}

export type AgentHostInstallLinkResult =
  | {url: string}
  | {unavailableReason: 'no_remote_recipe' | 'unsupported_host' | 'invalid_name' | 'unsafe_url' | 'authentication_required'};

/** Encode only screened URL fields, never publisher snippets or command arguments. */
export const buildAgentHostInstallLink = (recipe: PublicAgentSetupRecipeEntry): AgentHostInstallLinkResult => {
  if (recipe.state !== 'ready' || 'transport' in recipe) return {unavailableReason: 'no_remote_recipe'};
  if (recipe.host !== 'cursor' && recipe.host !== 'vscode') return {unavailableReason: 'unsupported_host'};
  // Conservative editor-name envelope; see upstream docs/measurements/agent-workflows-install-links-2026-10-16.md.
  if (!/^[a-z0-9-]{1,64}$/.test(recipe.serverKey)) return {unavailableReason: 'invalid_name'};
  if (!isPublicMcpRemoteUrl(recipe.url)) return {unavailableReason: 'unsafe_url'};
  if (recipe.headers?.some((header) => header.isRequired || header.isSecret)) return {unavailableReason: 'authentication_required'};
  const config = recipe.host === 'cursor'
    ? btoa(Array.from(new TextEncoder().encode(JSON.stringify({url: recipe.url})), (byte) => String.fromCharCode(byte)).join(''))
    : JSON.stringify({type: 'http', url: recipe.url});
  const origin = recipe.host === 'cursor'
    ? 'cursor://anysphere.cursor-deeplink/mcp/install'
    : 'https://vscode.dev/redirect/mcp/install';
  return {url: `${origin}?name=${encodeURIComponent(recipe.serverKey)}&config=${encodeURIComponent(config)}`};
};

const formatSetupRecipe = (recipe: SetupRecipeSnippetInput, target: 'file' | 'entry'): string => {
  const host = AGENT_SETUP_RECIPE_HOSTS[recipe.host]
  if (host.configFormat !== 'shell') return formatAgentSetupRecipeConfig(recipe, host, target)
  const command = getAgentSetupRecipeCliCommand(recipe)
  if (!command) throw new Error('Setup command requires a public HTTPS URL and an ASCII server name')
  return command
}

/** Whole config for first-time setup; provenance stays outside the copied text. */
export const buildAgentSetupRecipeSnippet = (recipe: SetupRecipeSnippetInput): string =>
  formatSetupRecipe(recipe, 'file')

/** Mergeable entry for existing config; TOML tables are already additive. */
export const buildAgentSetupRecipeEntrySnippet = (recipe: SetupRecipeSnippetInput): string =>
  formatSetupRecipe(recipe, 'entry')

/**
 * The one-line caption surfaces print next to a recipe carrying header
 * placeholders: names the headers to fill and states the no-secrets contract.
 * Returns undefined for entries without placeholders.
 */
export const getAgentSetupRecipeHeadersNotice = (
  entry: PublicAgentSetupRecipeEntry | ReadyAgentSetupRecipe | null | undefined,
): string | undefined => {
  if (!entry || entry.state !== 'ready' || !entry.headers?.length) {
    return undefined
  }
  const names = entry.headers.map((header) => header.name).join(', ')
  if (getAgentSetupRecipeHostConfigFormat(entry.host) === 'shell') {
    return `The remote declares ${names}. Configure authentication using the host's official instructions; this command omits header values and secret flags.`
  }
  return `Replace the ${names} placeholders with real header values in the host config — SlothHub publishes header names only, never secret values.`
}

/**
 * The one-line disclosure surfaces print when the registry published more
 * screened remotes than the recipe selected. Returns undefined when the
 * chosen remote is the only safe one.
 */
export const getAgentSetupRecipeAlternateRemotesNotice = (
  entry: PublicAgentSetupRecipeEntry | ReadyAgentSetupRecipe | null | undefined,
): string | undefined => {
  if (!entry || entry.state !== 'ready' || !entry.alternateUrls?.length) {
    return undefined
  }
  return `Other published remotes: ${entry.alternateUrls.join(', ')}.`
}

/** Names-only disclosure kept outside the executable configuration. */
export const getAgentSetupRecipeEnvironmentNotice = (
  entry: PublicAgentSetupRecipeEntry,
): string | undefined => {
  if (entry.state !== 'ready' || !('environmentVariables' in entry) || !entry.environmentVariables.length) return undefined
  return `Configure environment variables in Cursor before use: ${entry.environmentVariables.map(({name, isSecret}) => `${name}${isSecret ? ' (secret)' : ''}`).join(', ')}. SlothHub publishes names only; no values are included.`
}

/**
 * The per-host projection public artifacts carry: one entry per supported
 * Agent Host, `ready` or `unknown`, in `AGENT_SETUP_RECIPE_HOST_VALUES` order.
 */
export const resolveAgentSetupRecipes = (input: {
  kind: string
  serverKey?: string
  observation: McpRegistryObservation | null | undefined
  registryName?: string
}): PublicAgentSetupRecipeEntry[] | undefined => {
  if (input.kind !== 'mcp_server') return undefined
  return AGENT_SETUP_RECIPE_HOST_VALUES.map((host): PublicAgentSetupRecipeEntry => {
    const recipe = deriveAgentSetupRecipe({host, serverKey: input.serverKey ?? '', observation: input.observation})
    if (recipe) return recipe
    const reason = host === 'claude_desktop' ? 'no_recipe' : getUnknownSetupRecipeReason(input.observation)
    const entry: PublicAgentSetupRecipeEntry = {state: 'unknown', host, reason}
    if (host === 'claude_desktop') {
      const registryUrl = mcpRegistryRecordUrl(input.observation?.registryName ?? input.registryName)
      if (registryUrl) entry.registryUrl = registryUrl
    }
    return entry
  })
}

const mcpRegistryRecordUrl = (name: string | undefined): string | undefined => {
  if (!name?.trim()) return undefined
  try {
    return `${MCP_REGISTRY_API_ORIGIN}/servers/${encodeURIComponent(name.trim())}`
  } catch {
    return undefined
  }
}

/** A documented host flow is not evidence of a copyable config format. */
export const getAgentSetupRecipeUnknownNotice = (host: AgentSetupRecipeHost, reason?: AgentSetupRecipeUnknownReason): string =>
  reason === 'sse_only'
    ? `${getAgentSetupRecipeHostLabel(host)} setup: the official registry published SSE only; this host recipe needs streamable HTTP.`
    : host === 'claude_desktop'
    ? 'Claude Desktop setup: no documented remote config snippet. Add remote servers through Custom Connectors in Claude; review the Registry record and permissions before connecting.'
    : `${getAgentSetupRecipeHostLabel(host)} setup: no confirmed remote recipe in the official MCP Registry.`

const getUnknownSetupRecipeReason = (
  observation: McpRegistryObservation | null | undefined,
): AgentSetupRecipeUnknownReason => {
  if (observation && observation.status !== 'active') return 'deprecated_registry'
  if (!observation?.remotes.some((remote) => isPublicMcpRemoteUrl(remote.url))) {
    return 'missing_remotes'
  }
  if (!observation.remotes.some((remote) => remote.type === MCP_REGISTRY_REMOTE_TRANSPORT && isPublicMcpRemoteUrl(remote.url))) {
    return 'sse_only'
  }
  return 'no_recipe'
}

/**
 * The deprecated singular `setupRecipe` is the Cursor entry re-keyed: a ready
 * remote recipe passes through unchanged; stdio stays unknown here. Unknown loses its `host` so
 * already-deployed strict parsers keep accepting the field.
 */
export const toLegacyAgentSetupRecipe = (
  entries: PublicAgentSetupRecipeEntry[] | undefined,
): PublicAgentSetupRecipe | undefined => {
  const cursor = entries?.find((entry) => entry.host === 'cursor')
  if (!cursor) return undefined
  return cursor.state === 'ready' && !('transport' in cursor) ? cursor : {state: 'unknown'}
}

/**
 * The recipes a consumer should print: `setupRecipes` when present, else the
 * legacy singular `setupRecipe` re-keyed as a Cursor entry so feeds that only
 * carry the deprecated field still name a host. The legacy `unknown` state is
 * hostless, so it maps to a Cursor `unknown` entry — the field only ever
 * described Cursor.
 */
export const resolvePublicAgentSetupRecipeEntries = (
  agentInterface: {
    setupRecipe?: PublicAgentSetupRecipe
    setupRecipes?: PublicAgentSetupRecipeEntry[]
    stdioSetupRecipe?: ReadyStdioAgentSetupRecipe
    sseOnlyRemotes?: true
  },
): PublicAgentSetupRecipeEntry[] => {
  const legacy = agentInterface.setupRecipe
  const storedEntries: PublicAgentSetupRecipeEntry[] = agentInterface.setupRecipes ?? (legacy
    ? [legacy.state === 'ready' ? legacy : {state: 'unknown', host: 'cursor'}]
    : [])
  const entries: PublicAgentSetupRecipeEntry[] = agentInterface.sseOnlyRemotes ? storedEntries.map((entry) =>
    entry.state === 'unknown' && entry.host !== 'claude_desktop' && entry.reason === 'no_recipe'
      ? {...entry, reason: 'sse_only'}
      : entry,
  ) : storedEntries
  const stdio = agentInterface.stdioSetupRecipe
  if (!stdio) return entries
  if (!entries.some((entry) => entry.host === 'cursor')) return [...entries, stdio]
  return entries.map((entry) => entry.host === 'cursor' && entry.state === 'unknown' ? stdio : entry)
}

/**
 * The recipe shapes a parsed feed may carry: `entrySnippet` arrived after
 * feeds already shipped without it, so parse schemas mark it optional and
 * `fillAgentSetupRecipeEntrySnippets` restores it — the field is
 * deterministic from `host`, `serverKey`, and `url`.
 */
export type ParsedReadyAgentSetupRecipe = Omit<
  ReadyRemoteAgentSetupRecipe,
  'entrySnippet'
> & {entrySnippet?: string}
export type ParsedAgentSetupRecipe =
  | ParsedReadyAgentSetupRecipe
  | {state: 'unknown'}
export type ParsedAgentSetupRecipeEntry =
  | ParsedReadyAgentSetupRecipe
  | Extract<PublicAgentSetupRecipeEntry, {state: 'unknown'}>

const withDerivedEntrySnippet = (
  recipe: ParsedReadyAgentSetupRecipe,
): ReadyRemoteAgentSetupRecipe => ({
  ...recipe,
  entrySnippet:
    recipe.entrySnippet ?? buildAgentSetupRecipeEntrySnippet(recipe),
})

/** The strict recipe fields the fill guarantees on the way out. */
type FilledAgentSetupRecipeFields = {
  setupRecipe?: PublicAgentSetupRecipe
  setupRecipes?: PublicRemoteAgentSetupRecipeEntry[]
}

/**
 * Feed parsers call this once per Agent Interface so every consumer — web,
 * CLI, MCP — reads a `ready` recipe whose mergeable `entrySnippet` is always
 * populated, whatever the feed's age.
 */
export const fillAgentSetupRecipeEntrySnippets = <
  T extends {
    setupRecipe?: ParsedAgentSetupRecipe
    setupRecipes?: ParsedAgentSetupRecipeEntry[]
  },
>(
  agentInterface: T,
): Omit<T, 'setupRecipe' | 'setupRecipes'> & FilledAgentSetupRecipeFields => {
  const {setupRecipe, setupRecipes, ...rest} = agentInterface
  const filled: FilledAgentSetupRecipeFields = {}
  if (setupRecipe) {
    filled.setupRecipe =
      setupRecipe.state === 'ready'
        ? {...setupRecipe, entrySnippet: setupRecipe.entrySnippet ?? buildAgentSetupRecipeEntrySnippet(setupRecipe)}
        : setupRecipe
  }
  if (setupRecipes) {
    filled.setupRecipes = setupRecipes.map((entry) =>
      entry.state === 'ready' ? withDerivedEntrySnippet(entry) : entry,
    )
  }
  return {...rest, ...filled}
}
