import {isCanonicalGoModulePath} from './goModule.js'
import {normalizePypiProjectName} from './packageNames.js'
import {hasRuntimeObjectType, isRuntimeString} from './runtimeValidation.js'
import type {JsonObject, JsonValue} from './jsonValue.js'
import {isValidHomebrewFormulaName} from './agentInterface.js'
import {
  getResourceIdentityDuplicateKey,
  normalizeResourceSubmissionIdentity,
} from './resourceSubmissionIdentity.js'
import {
  isResourceIdentityKind,
  resolveResourceIdentity,
  type ResourceIdentityInput,
  type ResourceIdentityKind,
} from './resourceIdentity.js'
import {getToolWebsiteIdentityKey} from './toolWebsiteIdentity.js'
import {validateAbsoluteHttpUrl, validatePublicHttpUrl} from './urlSafety.js'
import {containerImagePullRef, isContainerImageSource, parseContainerImageReference} from './containerImage.js'
import {
  isAgentInterfaceIdentifierValid,
  normalizePublicAgentInterfaces,
  parseFirefoxAddonsListingSlug,
  type AgentInterfaceInput,
  type AgentInterfaceSource,
} from './agentInterface.js'

export const TOOL_LOOKUP_ARTIFACT_VERSION = '5.0.0'
export const TOOL_LOOKUP_MAX_INPUT_LENGTH = 2_048
export const TOOL_LOOKUP_MAX_CANDIDATES = 10
export const TOOL_LOOKUP_MAX_ARTIFACT_TOOLS = 5_000
export const TOOL_LOOKUP_MAX_IDENTITY_CLAIMS = 5_000
// Receipt: at most 4 intrinsic keys (slug, display_name, canonical_url,
// Resource Identity) plus one key per normalized Agent Interface, bounded by
// MAX_PUBLIC_AGENT_INTERFACES (20).
export const TOOL_LOOKUP_MAX_KEYS_PER_TOOL = 24
export const TOOL_ALIAS_MAX_ROUTE_CLAIMS = 10_000
export const TOOL_ALIAS_MAX_HISTORY_ITEMS = 30_000
export const TOOL_ALIAS_MAX_EDITOR_HISTORY_ITEMS = 5

export const TOOL_LOOKUP_NAMESPACE_VALUES = [
  'slug',
  'display_name',
  'canonical_url',
  'github_repository',
  'github_actions',
  'npm_package',
  'pypi_project',
  'crates_package',
  'go_module',
  'mcp_registry_server',
  'container_image',
  'jsr_package',
  'nuget',
  'rubygems',
  'packagist',
  'vscode_marketplace',
  'open_vsx',
  'chrome_web_store',
  'firefox_add_ons',
  'homebrew_formula',
] as const

export type ToolLookupNamespace = (typeof TOOL_LOOKUP_NAMESPACE_VALUES)[number]

/**
 * Registry namespaces eligible for exact-identifier lookup and identity
 * claims. This is the canonical list — the published artifact's
 * `identityClaims.namespace` enum derives from it so the JSON Schema can
 * never drift from what `buildToolLookupArtifact` emits.
 */
export const REGISTRY_LOOKUP_NAMESPACE_VALUES = [
  'github_repository',
  'npm_package',
  'pypi_project',
  'crates_package',
  'go_module',
  'mcp_registry_server',
  'container_image',
  'jsr_package',
] as const

export type RegistryLookupNamespace = (typeof REGISTRY_LOOKUP_NAMESPACE_VALUES)[number]

export interface ToolLookupCandidate {
  slug: string
  name: string
  detailUrl: string
}

export interface ToolLookupAgentInterface {
  source?: string | null
  identifier?: string | null
}

export interface ToolLookupSource extends ToolLookupCandidate {
  sourceToolId?: string | null
  slugHistory?: readonly ToolSlugHistoryItem[] | null
  successorToolId?: string | null
  isRetired?: boolean
  isPublic?: boolean
  website?: string | null
  resourceIdentity?: ResourceIdentityInput | null
  /** Raw Agent Interface rows; normalized interfaces emit registry lookup keys. */
  agentInterfaces?: Array<AgentInterfaceInput | null | undefined> | null
}

export interface ToolSlugHistoryItem {
  slug: string
  sourceToolId: string
}

export interface ToolAliasClaim extends ToolSlugHistoryItem {
  canonicalSlug: string
}

interface ToolLookupIdentityClaimBase {
  namespace: Extract<ToolLookupNamespace, ResourceIdentityKind>
  value: string
  sourceToolId: string
}

export type ToolLookupIdentityClaim =
  | ToolLookupIdentityClaimBase & {disposition: 'aliased'; canonicalSlug: string}
  | ToolLookupIdentityClaimBase & {disposition: 'retired'; canonicalSlug?: never}

export interface ToolAliasRegistryOptions {
  reservedSlugs?: readonly string[]
  onIdentityClaimConflict?: (conflict: {
    namespace: ToolLookupNamespace
    value: string
    sourceToolIds: string[]
  }) => void
}

export interface ToolLookupKey {
  namespace: ToolLookupNamespace
  value: string
}

export interface ToolLookupArtifactTool extends ToolLookupCandidate {
  keys: ToolLookupKey[]
}

export interface ToolLookupArtifact {
  version: typeof TOOL_LOOKUP_ARTIFACT_VERSION
  complete: true
  tools: ToolLookupArtifactTool[]
  aliases: ToolAliasClaim[]
  identityClaims: ToolLookupIdentityClaim[]
}

export const TOOL_LOOKUP_IDENTITY_CLAIM_LIMIT_RECOVERY =
  'Reduce the published identity claims or remeasure the lookup limit before regenerating the complete artifact.'

export class ToolLookupArtifactLimitError extends Error {
  readonly code = 'tool_lookup_identity_claim_limit_exceeded' as const
  readonly configuredLimit = TOOL_LOOKUP_MAX_IDENTITY_CLAIMS
  readonly observedValue: number
  readonly recovery = TOOL_LOOKUP_IDENTITY_CLAIM_LIMIT_RECOVERY

  constructor(observedValue: number) {
    super(
      `tool_lookup_identity_claim_limit_exceeded: configured_limit=${TOOL_LOOKUP_MAX_IDENTITY_CLAIMS} observed_value=${observedValue} recovery=${TOOL_LOOKUP_IDENTITY_CLAIM_LIMIT_RECOVERY}`,
    )
    this.name = 'ToolLookupArtifactLimitError'
    this.observedValue = observedValue
  }
}

export interface ToolAliasMapping {
  aliasSlug: string
  canonicalSlug: string
}

export const getToolAliasMappings = (
  artifact: Pick<ToolLookupArtifact, 'aliases'>,
): ToolAliasMapping[] =>
  artifact.aliases.map(({slug, canonicalSlug}) => ({aliasSlug: slug, canonicalSlug}))

export interface ToolLookupInput {
  namespace: ToolLookupNamespace
  value: string
}

export type ToolLookupReferenceParseResult =
  | {kind: 'not_explicit'}
  | {kind: 'lookup'; input: ToolLookupInput}
  | {kind: 'invalid_input'; namespace?: ToolLookupNamespace; message: string}

export type ToolLookupResult =
  | {kind: 'resolved'; namespace: ToolLookupNamespace; tool: ToolLookupCandidate}
  | {kind: 'aliased'; namespace: ToolLookupNamespace; tool: ToolLookupCandidate}
  | {kind: 'retired'; namespace: ToolLookupNamespace}
  | {
      kind: 'ambiguous'
      namespace: ToolLookupNamespace
      candidates: ToolLookupCandidate[]
      total: number
    }
  | {kind: 'not_found'; namespace: ToolLookupNamespace}
  | {kind: 'invalid_input'; namespace?: ToolLookupNamespace; message: string}
  | {kind: 'capability_unavailable'; namespace: ToolLookupNamespace}

const isRecord = <Input>(value: Input): value is Input & JsonObject =>
  hasRuntimeObjectType(value) && value !== null

const hasOnlyKeys = (value: JsonObject, allowed: readonly string[]): boolean =>
  Object.keys(value).every((key) => allowed.includes(key))

const LOOKUP_CONTROL_OR_BIDI = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u
export const TOOL_PUBLIC_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const isValidToolPublicSlug = (value: JsonValue): value is string =>
  isRuntimeString(value) &&
  value.length <= 160 &&
  TOOL_PUBLIC_SLUG_PATTERN.test(value)
const registryNamespaces = new Set<ToolLookupNamespace>(REGISTRY_LOOKUP_NAMESPACE_VALUES)
const validatedArtifacts = new WeakSet<ToolLookupArtifact>()

// SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
const isRegistryLookupNamespace = (
  value: JsonValue,
): value is Extract<ToolLookupNamespace, ResourceIdentityKind> =>
  isResourceIdentityKind(value) && registryNamespaces.has(value as ToolLookupNamespace)

/**
 * Agent Interface sources that are also lookup namespaces. Their strict
 * identifier grammar makes the registry listing a pure function of the id, so
 * an interface row can emit a canonical key exactly like a Resource Identity
 * claim does. homebrew, winget, scoop, chocolatey, openapi, manual, and other
 * stay unmapped: they have no per-identifier listing URL contract.
 */
type AgentInterfaceLookupNamespace = Extract<ToolLookupNamespace, AgentInterfaceSource>
const agentInterfaceLookupNamespaces = new Set<ToolLookupNamespace>([
  'nuget',
  'rubygems',
  'packagist',
  'vscode_marketplace',
  'open_vsx',
  'chrome_web_store',
  'github_actions',
  'firefox_add_ons',
])
// SAFETY: The source is a closed or validated string collection; widening only enables collection operations.
const isAgentInterfaceLookupNamespace = (
  value: JsonValue,
): value is AgentInterfaceLookupNamespace =>
  isRuntimeString(value) &&
  agentInterfaceLookupNamespaces.has(value as ToolLookupNamespace)

const getAgentInterfaceLookupNamespace = (
  source: AgentInterfaceSource,
): ToolLookupNamespace | undefined => {
  if (source === 'npm') return 'npm_package'
  if (source === 'pypi') return 'pypi_project'
  if (source === 'jsr') return 'jsr_package'
  if (source === 'crates') return 'crates_package'
  if (source === 'github') return 'github_repository'
  if (source === 'mcp_registry') return 'mcp_registry_server'
  if (isContainerImageSource(source)) return 'container_image'
  if (isAgentInterfaceLookupNamespace(source)) return source
  return undefined
}

// SAFETY: The source is a closed or validated string collection; widening only enables collection operations.
const isLookupNamespace = (value: JsonValue): value is ToolLookupNamespace =>
  isRuntimeString(value) &&
  (TOOL_LOOKUP_NAMESPACE_VALUES as readonly string[]).includes(value)

const HOMEBREW_FORMULA_KEY_PREFIX = 'homebrew_formula:'

const normalizeDisplayName = (value: string): string =>
  value.trim().normalize('NFC').toLocaleLowerCase('en-US')

const normalizeRegistryLookup = (
  namespace: ToolLookupNamespace,
  value: string,
): string | null => {
  if (isAgentInterfaceLookupNamespace(namespace)) {
    // These registries match package identifiers case-insensitively, so the
    // canonical key lowercases before the strict grammar check.
    const identifier = value.trim().toLowerCase()
    const valid =
      isAgentInterfaceIdentifierValid(namespace, identifier) ||
      // Marketplace listing slugs form a second github_actions key space,
      // emitted when an interface's docs URL is the listing page.
      (namespace === 'github_actions' &&
        GITHUB_ACTIONS_MARKETPLACE_SLUG_PATTERN.test(identifier))
    return valid ? `${namespace}:${identifier}` : null
  }
  if (!isRegistryLookupNamespace(namespace)) {
    return null
  }

  // Image lookup keys describe pull references, not registry web pages.
  if (namespace === 'container_image' && parseContainerImageReference(value)) {
    return getResourceIdentityDuplicateKey({resourceIdentity: {kind: 'container_image', registryId: value}})
  }

  // SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
  const normalized = normalizeResourceSubmissionIdentity({
    kind: namespace as ResourceIdentityKind,
    identifier: value,
  })
  if (!normalized) {
    return null
  }

  return getResourceIdentityDuplicateKey({resourceIdentity: normalized})
}

export const isCanonicalNpmPackageName = (value: string): boolean =>
  normalizeRegistryLookup('npm_package', value) === `npm_package:${value}`

const normalizeLookupValue = (
  namespace: JsonValue,
  rawValue: JsonValue,
): {namespace: ToolLookupNamespace; value: string} | {message: string} => {
  if (!isLookupNamespace(namespace)) {
    return {message: 'Choose a supported Tool lookup namespace.'}
  }
  if (!isRuntimeString(rawValue)) {
    return {message: 'Tool lookup value must be a string.'}
  }

  const value = rawValue.trim()
  if (!value || value.length > TOOL_LOOKUP_MAX_INPUT_LENGTH || LOOKUP_CONTROL_OR_BIDI.test(value)) {
    return {message: 'Tool lookup value is empty, too long, or contains unsafe control characters.'}
  }

  if (namespace === 'slug') {
    return isValidToolPublicSlug(value)
      ? {namespace, value}
      : {message: 'Tool slug must use lowercase letters, numbers, and hyphens.'}
  }

  if (namespace === 'display_name') {
    return {namespace, value: normalizeDisplayName(value)}
  }

  if (namespace === 'canonical_url') {
    if (!validatePublicHttpUrl(value).success) {
      return {message: 'Canonical URL must be a safe public http(s) URL without credentials.'}
    }
    const key = getToolWebsiteIdentityKey(value)
    return key ? {namespace, value: key} : {message: 'Canonical URL is invalid.'}
  }

  if (namespace === 'homebrew_formula') {
    return isValidHomebrewFormulaName(value)
      ? {namespace, value: `${HOMEBREW_FORMULA_KEY_PREFIX}${value}`}
      : {message: 'Tool lookup value is invalid for namespace homebrew_formula.'}
  }

  const key = normalizeRegistryLookup(namespace, value)
  return key
    ? {namespace, value: key}
    : {message: `Tool lookup value is invalid for namespace ${namespace}.`}
}

const GITHUB_RESERVED_SEGMENTS = new Set([
  'about', 'account', 'apps', 'collections', 'contact', 'enterprise', 'events',
  'explore', 'features', 'gist', 'join', 'login', 'marketplace', 'new',
  'notifications', 'organizations', 'orgs', 'pricing', 'readme', 'search',
  'security', 'settings', 'site', 'sponsors', 'topics', 'trending', 'users',
  'watching',
])

const GITHUB_SEGMENT_PATTERN = /^[A-Za-z0-9_.-]+$/

// Marketplace listing slugs are lowercase kebab-case and come from the
// action.yml `name`, not the repository — they are a separate key space from
// the `owner/repo` identifier grammar.
const GITHUB_ACTIONS_MARKETPLACE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const parseGithubActionsMarketplaceSlug = (url: URL): string | null => {
  if (url.hostname.toLowerCase() !== 'github.com') return null
  const segments = url.pathname.split('/').filter(Boolean)
  const slug = segments[2]
  return segments[0] === 'marketplace' &&
    segments[1] === 'actions' &&
    segments.length === 3 &&
    slug &&
    GITHUB_ACTIONS_MARKETPLACE_SLUG_PATTERN.test(slug)
    ? slug
    : null
}

// A Marketplace listing URL recorded as an interface's docsUrl contributes its
// slug as a second `github_actions:` key, so a pasted listing URL resolves to
// the Tool that owns the action.
const getGithubActionsMarketplaceSlug = (docsUrl: string | undefined): string | null => {
  if (!docsUrl) return null
  let url: URL
  try {
    url = new URL(docsUrl)
  } catch {
    return null
  }
  return parseGithubActionsMarketplaceSlug(url)
}

const stripWww = (host: string): string =>
  host.startsWith('www.') ? host.slice('www.'.length) : host


const parseRegistryReferenceUrl = (
  host: string,
  url: URL,
): {namespace: ToolLookupNamespace; value: string} | null => {
  const segments = url.pathname.split('/').filter(Boolean)
  if (host === 'github.com') {
    const [owner, repo] = segments
    if (owner === 'marketplace') {
      const slug = parseGithubActionsMarketplaceSlug(url)
      return slug ? {namespace: 'github_actions', value: slug} : null
    }
    if (
      !owner || !repo ||
      GITHUB_RESERVED_SEGMENTS.has(owner.toLowerCase()) ||
      !GITHUB_SEGMENT_PATTERN.test(owner) ||
      !GITHUB_SEGMENT_PATTERN.test(repo)
    ) {
      return null
    }
    const repository = repo.endsWith('.git') ? repo.slice(0, -'.git'.length) : repo
    return repository ? {namespace: 'github_repository', value: `${owner}/${repository}`} : null
  }

  if (host === 'npmjs.com') {
    if (segments[0] !== 'package') return null
    const names = segments.slice(1)
    if (names[0]?.startsWith('@')) {
      return names[1] ? {namespace: 'npm_package', value: `${names[0]}/${names[1]}`} : null
    }
    return names[0] ? {namespace: 'npm_package', value: names[0]} : null
  }

  if (host === 'npm.im') {
    return segments[0] ? {namespace: 'npm_package', value: segments[0]} : null
  }

  if (host === 'pypi.org') {
    if (segments[0] !== 'project' || !segments[1]) return null
    return {namespace: 'pypi_project', value: normalizePypiProjectName(segments[1])}
  }

  if (host === 'crates.io') {
    if (segments[0] !== 'crates' || !segments[1]) return null
    return {namespace: 'crates_package', value: segments[1]}
  }

  if (host === 'jsr.io') {
    const [scope, pkg] = segments
    if (!scope?.startsWith('@') || !pkg) return null
    const name = pkg.split('@')[0]
    return name ? {namespace: 'jsr_package', value: `${scope}/${name}`} : null
  }

  if (host === 'docs.rs') {
    const name = segments[0] === 'crate' ? segments[1] : segments[0]
    return name ? {namespace: 'crates_package', value: name} : null
  }

  if (host === 'nuget.org') {
    const identifier = segments[0] === 'packages' ? segments[1] : undefined
    return identifier && isAgentInterfaceIdentifierValid('nuget', identifier)
      ? {namespace: 'nuget', value: identifier}
      : null
  }

  if (host === 'rubygems.org') {
    const identifier = segments[0] === 'gems' ? segments[1] : undefined
    return identifier && isAgentInterfaceIdentifierValid('rubygems', identifier)
      ? {namespace: 'rubygems', value: identifier}
      : null
  }

  if (host === 'packagist.org') {
    if (segments[0] !== 'packages' || segments.length !== 3) return null
    const identifier = `${segments[1]}/${segments[2]}`
    return isAgentInterfaceIdentifierValid('packagist', identifier)
      ? {namespace: 'packagist', value: identifier}
      : null
  }

  if (host === 'marketplace.visualstudio.com') {
    if (segments.length !== 1 || segments[0] !== 'items') return null
    const itemName = url.searchParams.get('itemName')
    return itemName && isAgentInterfaceIdentifierValid('vscode_marketplace', itemName)
      ? {namespace: 'vscode_marketplace', value: itemName}
      : null
  }

  if (host === 'open-vsx.org') {
    // Listing pages live at /extension/{publisher}/{name}; the public REST API
    // mirrors that shape at /api/{publisher}/{name}.
    if (
      (segments[0] !== 'extension' && segments[0] !== 'api') ||
      segments.length !== 3
    ) {
      return null
    }
    const identifier = `${segments[1]}.${segments[2]}`
    return isAgentInterfaceIdentifierValid('open_vsx', identifier)
      ? {namespace: 'open_vsx', value: identifier}
      : null
  }

  if (host === 'chromewebstore.google.com') {
    if (
      segments[0] !== 'detail' ||
      (segments.length !== 2 && segments.length !== 3)
    ) {
      return null
    }
    const itemId = segments[segments.length - 1]
    return itemId && isAgentInterfaceIdentifierValid('chrome_web_store', itemId)
      ? {namespace: 'chrome_web_store', value: itemId}
      : null
  }

  if (host === 'addons.mozilla.org') {
    // Locale-prefixed listing paths resolve to the same canonical slug key.
    const slug = parseFirefoxAddonsListingSlug(url.toString())
    return slug ? {namespace: 'firefox_add_ons', value: slug} : null
  }

  if (host === 'hub.docker.com' || host === 'ghcr.io') {
    const normalized = normalizeResourceSubmissionIdentity({
      kind: 'container_image',
      identifier: url.toString(),
    })
    const pullRef = normalized?.registryId
    return pullRef ? {namespace: 'container_image', value: pullRef} : null
  }

  if (host === 'pkg.go.dev') {
    // The entire path is the module path; a bare host visit resolves nothing.
    const modulePath = segments.join('/')
    return isCanonicalGoModulePath(modulePath)
      ? {namespace: 'go_module', value: modulePath}
      : null
  }

  return null
}

const REGISTRY_URL_HOSTS = [
  'github.com',
  'npmjs.com',
  'npm.im',
  'pypi.org',
  'crates.io',
  'docs.rs',
  'jsr.io',
  'nuget.org',
  'rubygems.org',
  'packagist.org',
  'marketplace.visualstudio.com',
  'open-vsx.org',
  'chromewebstore.google.com',
  'addons.mozilla.org',
  'hub.docker.com',
  'ghcr.io',
  'pkg.go.dev',
]

/**
 * Parses a whole-input registry or package URL into a Tool lookup key.
 * Returns null for anything that is not a single http(s) URL, and for
 * credentials, non-default ports, fragments, and spoofed registry hosts.
 */
export const parseToolReferenceUrl = (
  input: JsonValue,
): {namespace: ToolLookupNamespace; value: string} | null => {
  if (!isRuntimeString(input)) return null
  const reference = input.trim()
  if (!reference || reference.length > TOOL_LOOKUP_MAX_INPUT_LENGTH) return null

  let url: URL
  try {
    url = new URL(reference)
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password || url.port || url.hash) return null

  const host = url.hostname.toLowerCase()
  const registryHost = stripWww(host)
  if (REGISTRY_URL_HOSTS.includes(registryHost)) {
    return parseRegistryReferenceUrl(registryHost, url)
  }
  // A registry host used as a label prefix (github.com.evil.tld) or a registry
  // subdomain that is not a package/repo page (gist.github.com) never resolves.
  if (
    REGISTRY_URL_HOSTS.some(
      (known) => registryHost.startsWith(`${known}.`) || registryHost.endsWith(`.${known}`),
    )
  ) {
    return null
  }

  return {namespace: 'canonical_url', value: url.toString()}
}

export const parseExplicitToolLookupReference = (
  input: JsonValue,
): ToolLookupReferenceParseResult => {
  if (!isRuntimeString(input)) {
    return {kind: 'invalid_input', message: 'Tool lookup reference must be a string.'}
  }

  const reference = input.trim()
  const image = parseContainerImageReference(reference)
  // Explicit registry hosts identify images with or without ports and tags.
  // Bare owner/repository references retain GitHub shorthand behavior.
  if (image?.explicitHost) return {kind: 'lookup', input: {namespace: 'container_image', value: image.pullRef}}

  const separator = reference.indexOf(':')
  if (separator < 0) {
    return {kind: 'not_explicit'}
  }

  const namespace = reference.slice(0, separator)
  if (!isLookupNamespace(namespace)) {
    const urlLookup = parseToolReferenceUrl(reference)
    if (urlLookup) {
      return {kind: 'lookup', input: urlLookup}
    }
    return {
      kind: 'invalid_input',
      message: 'Choose a supported Tool lookup namespace before the colon.',
    }
  }

  const value = reference.slice(separator + 1)
  const normalized = normalizeLookupValue(namespace, value)
  if ('message' in normalized) {
    return {kind: 'invalid_input', namespace, message: normalized.message}
  }

  return {kind: 'lookup', input: {namespace, value}}
}

// SAFETY: Search pinning must not reuse parseGithubRepository — its shorthand
// pattern admits Unicode, so homograph lookalike owners would resolve. This
// shape is ASCII-only per the GitHub owner/repo rules callers rely on.
const GITHUB_SEARCH_SHORTHAND_PATTERN = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/
const GITHUB_SEARCH_RESERVED_SEGMENTS = new Set([
  'about', 'account', 'apps', 'collections', 'contact', 'enterprise', 'events',
  'explore', 'features', 'gist', 'join', 'login', 'marketplace', 'new',
  'notifications', 'organizations', 'orgs', 'pricing', 'readme', 'search',
  'security', 'settings', 'site', 'sponsors', 'topics', 'trending', 'users',
  'watching',
])

// SAFETY: npm scoped names are gated to ASCII for the same reason;
// normalizeResourceSubmissionIdentity remains the authority on
// package-name validity once the shape matches.
const NPM_SEARCH_SCOPE_PATTERN = /^@[A-Za-z0-9][A-Za-z0-9._~-]{0,63}\/[A-Za-z0-9._~-]{1,214}$/

/**
 * Parses a raw search query into an exact Tool lookup input when the whole
 * query parses as an explicit Tool lookup reference, an ASCII npm
 * @scope/package name, or an ASCII GitHub owner/repo shorthand. Anything
 * else is 'not_explicit' so callers fall through to normal ranking.
 */
export const parseToolSearchIdentifier = (
  input: JsonValue,
): ToolLookupReferenceParseResult => {
  const explicit = parseExplicitToolLookupReference(input)
  if (explicit.kind !== 'not_explicit') return explicit
  if (!isRuntimeString(input)) return {kind: 'not_explicit'}

  const reference = input.trim()
  if (NPM_SEARCH_SCOPE_PATTERN.test(reference)) {
    return {kind: 'lookup', input: {namespace: 'npm_package', value: reference}}
  }

  const match = reference.match(GITHUB_SEARCH_SHORTHAND_PATTERN)
  if (!match) return {kind: 'not_explicit'}

  const owner = match[1] ?? ''
  const repository = (match[2] ?? '').replace(/\.git$/i, '')
  if (
    !owner || !repository ||
    GITHUB_SEARCH_RESERVED_SEGMENTS.has(owner.toLowerCase()) ||
    repository === '.' || repository === '..'
  ) {
    return {kind: 'not_explicit'}
  }

  return {kind: 'lookup', input: {namespace: 'github_repository', value: `${owner}/${repository}`}}
}

const isCanonicalArtifactKey = (
  namespace: ToolLookupNamespace,
  value: string,
): boolean => {
  if (
    !value ||
    value.length > TOOL_LOOKUP_MAX_INPUT_LENGTH ||
    LOOKUP_CONTROL_OR_BIDI.test(value)
  ) {
    return false
  }
  if (namespace === 'slug') return isValidToolPublicSlug(value)
  if (namespace === 'display_name') return normalizeDisplayName(value) === value
  if (namespace === 'canonical_url') {
    const publicUrl = `https://${value}`
    return (
      validatePublicHttpUrl(publicUrl).success &&
      getToolWebsiteIdentityKey(publicUrl) === value
    )
  }
  if (namespace === 'homebrew_formula') {
    return (
      value.startsWith(HOMEBREW_FORMULA_KEY_PREFIX) &&
      isValidHomebrewFormulaName(value.slice(HOMEBREW_FORMULA_KEY_PREFIX.length))
    )
  }
  const prefix = `${namespace}:`
  if (!value.startsWith(prefix) || value.length <= prefix.length) {
    return false
  }
  return normalizeRegistryLookup(namespace, value.slice(prefix.length)) === value
}

export const parseToolLookupArtifact = <Payload>(payload: Payload): ToolLookupArtifact => {
  if (
    !isRecord(payload) ||
    !hasOnlyKeys(payload, ['version', 'complete', 'tools', 'aliases', 'identityClaims']) ||
    payload.version !== TOOL_LOOKUP_ARTIFACT_VERSION ||
    payload.complete !== true ||
    !Array.isArray(payload.tools) ||
    !Array.isArray(payload.aliases) ||
    !Array.isArray(payload.identityClaims)
  ) {
    throw new Error('Tool lookup artifact is invalid or unsupported.')
  }
  if (payload.tools.length > TOOL_LOOKUP_MAX_ARTIFACT_TOOLS) {
    throw new Error('Tool lookup artifact contains too many Tools.')
  }
  if (payload.aliases.length > TOOL_ALIAS_MAX_HISTORY_ITEMS) {
    throw new Error('Tool lookup artifact contains too many aliases.')
  }
  if (payload.identityClaims.length > TOOL_LOOKUP_MAX_IDENTITY_CLAIMS) {
    throw new ToolLookupArtifactLimitError(payload.identityClaims.length)
  }
  if (payload.tools.length + payload.aliases.length > TOOL_ALIAS_MAX_ROUTE_CLAIMS) {
    throw new Error('Tool lookup artifact contains too many route claims.')
  }

  const seenSlugs = new Set<string>()
  const tools = payload.tools.map((rawTool): ToolLookupArtifactTool => {
    if (
      !isRecord(rawTool) ||
      !hasOnlyKeys(rawTool, ['slug', 'name', 'detailUrl', 'keys']) ||
      !isValidToolPublicSlug(rawTool.slug) ||
      seenSlugs.has(rawTool.slug) ||
      !isRuntimeString(rawTool.name) ||
      !rawTool.name.trim() ||
      rawTool.name.length > 300 ||
      LOOKUP_CONTROL_OR_BIDI.test(rawTool.name) ||
      !isRuntimeString(rawTool.detailUrl) ||
      LOOKUP_CONTROL_OR_BIDI.test(rawTool.detailUrl) ||
      !validateAbsoluteHttpUrl(rawTool.detailUrl).success ||
      !Array.isArray(rawTool.keys) ||
      rawTool.keys.length > TOOL_LOOKUP_MAX_KEYS_PER_TOOL
    ) {
      throw new Error('Tool lookup artifact contains an invalid Tool.')
    }
    seenSlugs.add(rawTool.slug)

    const seenKeys = new Set<string>()
    const keys = rawTool.keys.map((rawKey: JsonValue): ToolLookupKey => {
      if (
        !isRecord(rawKey) ||
        !hasOnlyKeys(rawKey, ['namespace', 'value']) ||
        !isLookupNamespace(rawKey.namespace) ||
        !isRuntimeString(rawKey.value)
      ) {
        throw new Error('Tool lookup artifact contains an invalid key.')
      }
      const pair = `${rawKey.namespace}\u0000${rawKey.value}`
      if (
        !isCanonicalArtifactKey(rawKey.namespace, rawKey.value) ||
        seenKeys.has(pair)
      ) {
        throw new Error('Tool lookup artifact contains an invalid key.')
      }
      seenKeys.add(pair)
      return {namespace: rawKey.namespace, value: rawKey.value}
    })
    const slugKeys = keys.filter((key: ToolLookupKey) => key.namespace === 'slug')
    if (slugKeys.length !== 1 || slugKeys[0]?.value !== rawTool.slug) {
      throw new Error('Tool lookup artifact must contain exactly its canonical slug key.')
    }

    return {
      slug: rawTool.slug,
      name: rawTool.name,
      detailUrl: new URL(rawTool.detailUrl).href,
      keys,
    }
  })

  const canonicalBySlug = new Map(tools.map((tool) => [tool.slug, tool]))
  const seenAliasSlugs = new Set<string>()
  const canonicalSlugBySourceId = new Map<string, string>()
  const aliases = payload.aliases.map((rawAlias): ToolAliasClaim => {
    const sourceToolId = isRecord(rawAlias) && isRuntimeString(rawAlias.sourceToolId)
      ? rawAlias.sourceToolId.trim()
      : ''
    if (
      !isRecord(rawAlias) ||
      !hasOnlyKeys(rawAlias, ['slug', 'sourceToolId', 'canonicalSlug']) ||
      !isValidToolPublicSlug(rawAlias.slug) ||
      !isRuntimeString(rawAlias.sourceToolId) ||
      rawAlias.sourceToolId !== sourceToolId ||
      !sourceToolId ||
      sourceToolId.length > 256 ||
      LOOKUP_CONTROL_OR_BIDI.test(sourceToolId) ||
      !isValidToolPublicSlug(rawAlias.canonicalSlug) ||
      rawAlias.slug === rawAlias.canonicalSlug ||
      seenSlugs.has(rawAlias.slug) ||
      seenAliasSlugs.has(rawAlias.slug) ||
      !canonicalBySlug.has(rawAlias.canonicalSlug)
    ) {
      throw new Error('Tool lookup artifact contains an invalid alias claim.')
    }
    const existingCanonicalSlug = canonicalSlugBySourceId.get(sourceToolId)
    if (existingCanonicalSlug && existingCanonicalSlug !== rawAlias.canonicalSlug) {
      throw new Error('One alias source identity cannot point to multiple canonical successors.')
    }
    canonicalSlugBySourceId.set(sourceToolId, rawAlias.canonicalSlug)
    seenAliasSlugs.add(rawAlias.slug)
    return {
      slug: rawAlias.slug,
      sourceToolId,
      canonicalSlug: rawAlias.canonicalSlug,
    }
  })

  const activeIdentityKeys = new Set(
    tools.flatMap((tool) => tool.keys.map((key) => `${key.namespace}\u0000${key.value}`)),
  )
  const seenIdentityKeys = new Set<string>()
  const identityDispositionBySourceId = new Map<string, string>()
  const identityClaims = payload.identityClaims.map((rawClaim): ToolLookupIdentityClaim => {
    const sourceToolId = isRecord(rawClaim) && isRuntimeString(rawClaim.sourceToolId)
      ? rawClaim.sourceToolId.trim()
      : ''
    const disposition = isRecord(rawClaim) ? rawClaim.disposition : undefined
    const canonicalSlug = isRecord(rawClaim) ? rawClaim.canonicalSlug : undefined
    const allowedKeys = disposition === 'aliased'
      ? ['namespace', 'value', 'disposition', 'sourceToolId', 'canonicalSlug']
      : ['namespace', 'value', 'disposition', 'sourceToolId']
    if (
      !isRecord(rawClaim) ||
      !hasOnlyKeys(rawClaim, allowedKeys) ||
      !isRegistryLookupNamespace(rawClaim.namespace) ||
      !isRuntimeString(rawClaim.value) ||
      !isCanonicalArtifactKey(rawClaim.namespace, rawClaim.value) ||
      (disposition !== 'aliased' && disposition !== 'retired') ||
      !isRuntimeString(rawClaim.sourceToolId) ||
      rawClaim.sourceToolId !== sourceToolId ||
      !sourceToolId ||
      sourceToolId.length > 256 ||
      LOOKUP_CONTROL_OR_BIDI.test(sourceToolId) ||
      (disposition === 'aliased' &&
        (!isRuntimeString(canonicalSlug) || !canonicalBySlug.has(canonicalSlug))) ||
      (disposition === 'retired' && canonicalSlug !== undefined)
    ) {
      throw new Error('Tool lookup artifact contains an invalid identity claim.')
    }
    const identityKey = `${rawClaim.namespace}\u0000${rawClaim.value}`
    if (activeIdentityKeys.has(identityKey) || seenIdentityKeys.has(identityKey)) {
      throw new Error('Tool lookup artifact contains a colliding identity claim.')
    }
    const provenance = `${disposition}\u0000${canonicalSlug ?? ''}`
    const existingProvenance = identityDispositionBySourceId.get(sourceToolId)
    const routeCanonicalSlug = canonicalSlugBySourceId.get(sourceToolId)
    if (
      (existingProvenance && existingProvenance !== provenance) ||
      (routeCanonicalSlug &&
        (disposition !== 'aliased' || canonicalSlug !== routeCanonicalSlug))
    ) {
      throw new Error('One identity source cannot have contradictory retirement provenance.')
    }
    seenIdentityKeys.add(identityKey)
    identityDispositionBySourceId.set(sourceToolId, provenance)
    if (disposition === 'aliased') {
      if (!isRuntimeString(canonicalSlug)) {
        throw new Error('Tool lookup artifact contains an invalid identity claim.')
      }
      return {
        namespace: rawClaim.namespace,
        value: rawClaim.value,
        disposition,
        sourceToolId,
        canonicalSlug,
      }
    }
    return {
      namespace: rawClaim.namespace,
      value: rawClaim.value,
      disposition,
      sourceToolId,
    }
  })

  const artifact: ToolLookupArtifact = {
    version: TOOL_LOOKUP_ARTIFACT_VERSION,
    complete: true,
    tools,
    aliases,
    identityClaims,
  }
  validatedArtifacts.add(artifact)
  return artifact
}

const pushKey = (keys: ToolLookupKey[], namespace: ToolLookupNamespace, value: string | null): void => {
  if (value && !keys.some((key) => key.namespace === namespace && key.value === value)) {
    keys.push({namespace, value})
  }
}

const collectAgentInterfaceLookupKeys = (tool: ToolLookupSource): ToolLookupKey[] => {
  const keys: ToolLookupKey[] = []
  for (const agentInterface of normalizePublicAgentInterfaces(tool.agentInterfaces, {
    registryId: tool.resourceIdentity?.registryId,
    mcpRegistryUrl: tool.resourceIdentity?.mcpRegistryUrl,
  })) {
    const source = agentInterface.source
    const identifier = agentInterface.identifier
    if (!source || !identifier || agentInterface.status === 'deprecated') continue
    const namespace = getAgentInterfaceLookupNamespace(source)
    if (!namespace) continue
    if (source === 'firefox_add_ons' && agentInterface.docsUrl) {
      const listingSlug = parseFirefoxAddonsListingSlug(agentInterface.docsUrl)
      if (listingSlug) pushKey(keys, namespace, normalizeRegistryLookup(namespace, listingSlug))
    }
    const lookupIdentifier = isContainerImageSource(source)
      ? containerImagePullRef(identifier, source)
      : identifier
    pushKey(
      keys,
      namespace,
      lookupIdentifier
        ? normalizeRegistryLookup(namespace, lookupIdentifier)
        : null,
    )
    if (source === 'github_actions') {
      const slug = getGithubActionsMarketplaceSlug(agentInterface.docsUrl)
      pushKey(keys, 'github_actions', slug ? `github_actions:${slug}` : null)
    }
  }
  return keys
}

export const buildToolLookupArtifact = (
  tools: readonly ToolLookupSource[],
  options: ToolAliasRegistryOptions = {},
): ToolLookupArtifact => {
  if (tools.length > TOOL_LOOKUP_MAX_ARTIFACT_TOOLS) {
    throw new Error('Tool alias registry contains too many Tools.')
  }

  const sourceById = new Map<string, ToolLookupSource>()
  const canonicalOwnerBySlug = new Map<string, string>()
  const reservedSlugs = new Set<string>()

  for (const rawReservedSlug of options.reservedSlugs ?? []) {
    const reservedSlug = rawReservedSlug.trim()
    if (!isValidToolPublicSlug(reservedSlug)) {
      throw new Error(`Tool alias registry contains an invalid reserved slug: ${rawReservedSlug}.`)
    }
    if (reservedSlugs.has(reservedSlug)) {
      throw new Error(`Tool alias registry contains a duplicate public route slug: ${reservedSlug}.`)
    }
    reservedSlugs.add(reservedSlug)
  }

  tools.forEach((tool, index) => {
    const slug = tool.slug.trim()
    if (!isValidToolPublicSlug(slug)) {
      throw new Error(`Tool alias registry contains an invalid Tool slug: ${tool.slug}.`)
    }
    const providedSourceToolId = tool.sourceToolId?.trim()
    const hasAliasMetadata = Boolean(
      (tool.slugHistory?.length ?? 0) > 0 ||
      tool.successorToolId?.trim() ||
      tool.isRetired === true,
    )
    if (hasAliasMetadata && !providedSourceToolId) {
      throw new Error(`Tool ${slug} requires a stable source Tool identity for alias provenance.`)
    }
    const sourceToolId = providedSourceToolId || `artifact-tool-${index}`
    if (
      sourceToolId.length > 256 ||
      LOOKUP_CONTROL_OR_BIDI.test(sourceToolId) ||
      sourceById.has(sourceToolId)
    ) {
      throw new Error(`Tool alias registry contains a duplicate or invalid Tool identity: ${sourceToolId}.`)
    }
    if (canonicalOwnerBySlug.has(slug)) {
      throw new Error(`Tool alias registry contains a duplicate current slug: ${slug}.`)
    }
    if (reservedSlugs.has(slug)) {
      throw new Error(`Tool slug collides with another public route: ${slug}.`)
    }
    sourceById.set(sourceToolId, {...tool, sourceToolId, slug})
    canonicalOwnerBySlug.set(slug, sourceToolId)
  })

  const historyOwnerBySlug = new Map<string, string>()
  let historyCount = 0
  for (const [sourceToolId, tool] of sourceById) {
    const history = tool.slugHistory ?? []
    if (history.length > TOOL_ALIAS_MAX_EDITOR_HISTORY_ITEMS) {
      throw new Error(`Tool ${sourceToolId} has more than ${TOOL_ALIAS_MAX_EDITOR_HISTORY_ITEMS} editor-managed historical slugs.`)
    }
    for (const claim of history) {
      historyCount += 1
      if (historyCount > TOOL_ALIAS_MAX_HISTORY_ITEMS) {
        throw new Error('Tool alias registry history limit exceeded.')
      }
      const slug = claim.slug.trim()
      if (
        !isValidToolPublicSlug(slug) ||
        claim.sourceToolId.trim() !== sourceToolId ||
        slug === tool.slug ||
        canonicalOwnerBySlug.has(slug) ||
        historyOwnerBySlug.has(slug) ||
        reservedSlugs.has(slug)
      ) {
        throw new Error(`Tool alias registry contains an invalid or colliding historical slug: ${claim.slug}.`)
      }
      historyOwnerBySlug.set(slug, sourceToolId)
    }
  }

  if (reservedSlugs.size + tools.length + historyCount > TOOL_ALIAS_MAX_ROUTE_CLAIMS) {
    throw new Error('Tool alias registry route-claim limit exceeded; refusing to validate a partial registry.')
  }

  const activeTools: ToolLookupSource[] = []
  const canonicalSlugBySourceId = new Map<string, string>()
  for (const [sourceToolId, tool] of sourceById) {
    const successorToolId = tool.successorToolId?.trim()
    if (successorToolId) {
      const successor = sourceById.get(successorToolId)
      if (
        tool.isPublic !== false ||
        successorToolId === sourceToolId ||
        !successor ||
        successor.successorToolId?.trim() ||
        successor.isPublic === false
      ) {
        throw new Error(`Retired Tool ${sourceToolId} must name one existing public, non-retired successor.`)
      }
      canonicalSlugBySourceId.set(sourceToolId, successor.slug)
      continue
    }
    if (tool.isRetired === true) {
      if (tool.isPublic !== false) {
        throw new Error(`Retired Tool ${sourceToolId} cannot remain public.`)
      }
      continue
    }
    if (tool.isPublic === false && (tool.slugHistory?.length ?? 0) > 0) {
      throw new Error(
        `Non-public Tool ${sourceToolId} with historical slugs must name one existing public, non-retired successor.`,
      )
    }
    if (tool.isPublic !== false) {
      activeTools.push(tool)
      canonicalSlugBySourceId.set(sourceToolId, tool.slug)
    }
  }

  const aliases: ToolAliasClaim[] = []
  for (const [sourceToolId, tool] of sourceById) {
    const canonicalSlug = canonicalSlugBySourceId.get(sourceToolId)
    if (!canonicalSlug) continue
    if (tool.successorToolId?.trim()) {
      aliases.push({slug: tool.slug, sourceToolId, canonicalSlug})
    }
    for (const claim of tool.slugHistory ?? []) {
      aliases.push({slug: claim.slug.trim(), sourceToolId, canonicalSlug})
    }
  }

  const activeRegistryOwners = new Map<string, Set<string>>()
  for (const tool of activeTools) {
    const identity = resolveResourceIdentity({
      resourceIdentity: tool.resourceIdentity,
      website: tool.website,
    })
    const keys = collectAgentInterfaceLookupKeys(tool)
    if (identity && isRegistryLookupNamespace(identity.kind) && validatePublicHttpUrl(identity.canonicalUrl).success) {
      pushKey(keys, identity.kind, normalizeRegistryLookup(identity.kind, identity.registryId ?? identity.canonicalUrl))
    }
    for (const {namespace, value} of keys) {
      const key = `${namespace}\u0000${value}`
      const owners = activeRegistryOwners.get(key) ?? new Set<string>()
      owners.add(tool.slug)
      activeRegistryOwners.set(key, owners)
    }
  }

  // Homebrew formula keys come from public Agent Interfaces, not Resource
  // Identity. A formula claimed by more than one active Tool is ambiguous and
  // is omitted rather than silently merged into one Tool's key set.
  const homebrewFormulasBySourceId = new Map<string, string[]>()
  const homebrewFormulaOwners = new Map<string, Set<string>>()
  for (const tool of activeTools) {
    const sourceToolId = tool.sourceToolId ?? ''
    const formulas: string[] = []
    for (const agentInterface of tool.agentInterfaces ?? []) {
      const identifier = agentInterface?.identifier
      if (agentInterface?.status === 'deprecated') continue
      if (agentInterface?.source !== 'homebrew' || !isRuntimeString(identifier)) continue
      if (!isValidHomebrewFormulaName(identifier) || formulas.includes(identifier)) continue
      formulas.push(identifier)
      const owners = homebrewFormulaOwners.get(identifier) ?? new Set<string>()
      owners.add(sourceToolId)
      homebrewFormulaOwners.set(identifier, owners)
    }
    if (formulas.length > 0) homebrewFormulasBySourceId.set(sourceToolId, formulas)
  }

  const ambiguousHomebrewFormulas = new Set<string>()
  for (const [formula, owners] of homebrewFormulaOwners) {
    if (owners.size <= 1) continue
    ambiguousHomebrewFormulas.add(formula)
    options.onIdentityClaimConflict?.({
      namespace: 'homebrew_formula',
      value: `${HOMEBREW_FORMULA_KEY_PREFIX}${formula}`,
      sourceToolIds: [...owners],
    })
  }

  const claimCandidatesByKey = new Map<
    string,
    Array<{sourceToolId: string; claim: ToolLookupIdentityClaim}>
  >()
  for (const [sourceToolId, tool] of sourceById) {
    if (tool.isPublic !== false) continue
    const identity = resolveResourceIdentity({
      resourceIdentity: tool.resourceIdentity,
      website: tool.website,
    })
    if (!identity || !isRegistryLookupNamespace(identity.kind)) continue
    const value = normalizeRegistryLookup(identity.kind, identity.registryId ?? identity.canonicalUrl)
    if (!value) continue
    const canonicalSlug = canonicalSlugBySourceId.get(sourceToolId)
    if (!canonicalSlug && tool.isRetired !== true) continue
    const activeOwners = activeRegistryOwners.get(`${identity.kind}\u0000${value}`)
    if (canonicalSlug && activeOwners?.has(canonicalSlug)) continue
    if (activeOwners) {
      throw new Error(`Retired Tool ${sourceToolId} has a registry identity owned by another active Tool.`)
    }
    const claim: ToolLookupIdentityClaim = canonicalSlug
      ? {
        namespace: identity.kind,
        value,
        disposition: 'aliased',
        sourceToolId,
        canonicalSlug,
      }
      : {
        namespace: identity.kind,
        value,
        disposition: 'retired',
        sourceToolId,
      }
    const claimKey = `${identity.kind}\u0000${value}`
    const candidates = claimCandidatesByKey.get(claimKey) ?? []
    candidates.push({sourceToolId, claim})
    claimCandidatesByKey.set(claimKey, candidates)
  }

  const identityClaims: ToolLookupIdentityClaim[] = []
  for (const candidates of claimCandidatesByKey.values()) {
    const distinctSources = [...new Set(candidates.map(({sourceToolId}) => sourceToolId))]
    if (distinctSources.length > 1) {
      const {namespace, value} = candidates[0].claim
      options.onIdentityClaimConflict?.({namespace, value, sourceToolIds: distinctSources})
      continue
    }
    identityClaims.push(candidates[0].claim)
  }

  if (activeTools.length + aliases.length > TOOL_ALIAS_MAX_ROUTE_CLAIMS) {
    throw new Error('Tool alias registry route-claim limit exceeded; refusing to emit a partial registry.')
  }

  const artifact: ToolLookupArtifact = {
    version: TOOL_LOOKUP_ARTIFACT_VERSION,
    complete: true,
    tools: activeTools.map((tool): ToolLookupArtifactTool => {
      const slug = tool.slug.trim()
      const name = isRuntimeString(tool.name) ? tool.name.trim() : ''
      const detailUrl = isRuntimeString(tool.detailUrl) ? tool.detailUrl.trim() : ''
      if (
        !name ||
        name.length > 300 ||
        LOOKUP_CONTROL_OR_BIDI.test(name)
      ) {
        throw new Error(
          `Tool alias registry contains an invalid public name for ${slug} (${tool.sourceToolId}).`,
        )
      }
      if (
        LOOKUP_CONTROL_OR_BIDI.test(detailUrl) ||
        !validateAbsoluteHttpUrl(detailUrl).success
      ) {
        throw new Error(
          `Tool alias registry contains an invalid detail URL for ${slug} (${tool.sourceToolId}).`,
        )
      }

      const keys: ToolLookupKey[] = []
      pushKey(keys, 'slug', slug)
      pushKey(keys, 'display_name', normalizeDisplayName(name))

      const identity = resolveResourceIdentity({
        resourceIdentity: tool.resourceIdentity,
        website: tool.website,
      })
      if (identity && validatePublicHttpUrl(identity.canonicalUrl).success) {
        pushKey(keys, 'canonical_url', getToolWebsiteIdentityKey(identity.canonicalUrl))
        if (isRegistryLookupNamespace(identity.kind)) {
          pushKey(keys, identity.kind, normalizeRegistryLookup(identity.kind, identity.registryId ?? identity.canonicalUrl))
        }
      }

      for (const key of collectAgentInterfaceLookupKeys(tool)) pushKey(keys, key.namespace, key.value)
      const homebrewFormulas = homebrewFormulasBySourceId.get(tool.sourceToolId ?? '') ?? []
      const unambiguousFormulas = homebrewFormulas.filter(
        (formula) => !ambiguousHomebrewFormulas.has(formula),
      )
      if (keys.length + unambiguousFormulas.length > TOOL_LOOKUP_MAX_KEYS_PER_TOOL) {
        throw new Error(
          `Tool ${slug} declares more lookup keys than the configured ${TOOL_LOOKUP_MAX_KEYS_PER_TOOL}-key limit.`,
        )
      }
      for (const formula of unambiguousFormulas) {
        pushKey(keys, 'homebrew_formula', `${HOMEBREW_FORMULA_KEY_PREFIX}${formula}`)
      }

      return {slug, name, detailUrl: new URL(detailUrl).href, keys}
    }),
    aliases,
    identityClaims,
  }

  return parseToolLookupArtifact(artifact)
}

export interface ToolLookupResolver {
  resolve: (input: ToolLookupInput) => ToolLookupResult
}

const resolverCache = new WeakMap<ToolLookupArtifact, ToolLookupResolver>()

export const createToolLookupResolver = (
  artifact: ToolLookupArtifact | null | undefined,
): ToolLookupResolver => {
  let parsedArtifact: ToolLookupArtifact | null = null
  if (artifact?.version === TOOL_LOOKUP_ARTIFACT_VERSION) {
    try {
      parsedArtifact = validatedArtifacts.has(artifact)
        ? artifact
        : parseToolLookupArtifact(artifact)
    } catch {
      parsedArtifact = null
    }
  }
  const available = parsedArtifact !== null
  const index = new Map<
    string,
    {total: number; candidates: ToolLookupCandidate[]}
  >()
  const identityClaimIndex = new Map<
    string,
    | {kind: 'aliased'; tool: ToolLookupCandidate}
    | {kind: 'retired'}
  >()

  if (parsedArtifact) {
    const addCandidate = (indexKey: string, candidate: ToolLookupCandidate): void => {
      const entry = index.get(indexKey) ?? {total: 0, candidates: []}
      entry.total += 1
      if (entry.candidates.length < TOOL_LOOKUP_MAX_CANDIDATES) {
        entry.candidates.push(candidate)
        entry.candidates.sort((left, right) => left.slug.localeCompare(right.slug))
      } else {
        const largest = entry.candidates[entry.candidates.length - 1]
        if (largest && candidate.slug.localeCompare(largest.slug) < 0) {
          entry.candidates[entry.candidates.length - 1] = candidate
          entry.candidates.sort((left, right) => left.slug.localeCompare(right.slug))
        }
      }
      index.set(indexKey, entry)
    }
    const candidateBySlug = new Map<string, ToolLookupCandidate>()
    for (const tool of parsedArtifact.tools) {
      const candidate = {slug: tool.slug, name: tool.name, detailUrl: tool.detailUrl}
      candidateBySlug.set(tool.slug, candidate)
      for (const key of tool.keys) {
        addCandidate(`${key.namespace}\u0000${key.value}`, candidate)
      }
    }
    for (const alias of parsedArtifact.aliases) {
      const candidate = candidateBySlug.get(alias.canonicalSlug)
      if (candidate) {
        index.set(`slug\u0000${alias.slug}`, {total: 1, candidates: [candidate]})
      }
    }
    for (const claim of parsedArtifact.identityClaims) {
      const key = `${claim.namespace}\u0000${claim.value}`
      if (claim.disposition === 'retired') {
        identityClaimIndex.set(key, {kind: 'retired'})
        continue
      }
      const candidate = candidateBySlug.get(claim.canonicalSlug)
      if (candidate) identityClaimIndex.set(key, {kind: 'aliased', tool: candidate})
    }
  }

  return {
    resolve: (input) => {
      const normalized = normalizeLookupValue(input?.namespace, input?.value)
      if ('message' in normalized) {
        return {
          // SAFETY: The owner parser or adjacent runtime guard establishes each asserted property contract.
          kind: 'invalid_input' as const,
          ...(isLookupNamespace(input?.namespace) ? { namespace: input.namespace } : undefined),
          message: normalized.message
        }
      }
      if (!available) {
        return {kind: 'capability_unavailable', namespace: normalized.namespace}
      }

      const entry = index.get(`${normalized.namespace}\u0000${normalized.value}`)
      const identityClaim = identityClaimIndex.get(
        `${normalized.namespace}\u0000${normalized.value}`,
      )
      if (identityClaim?.kind === 'retired') {
        return {kind: 'retired', namespace: normalized.namespace}
      }
      if (identityClaim?.kind === 'aliased') {
        return {
          kind: 'aliased',
          namespace: normalized.namespace,
          tool: identityClaim.tool,
        }
      }
      if (!entry || entry.total === 0) {
        return {kind: 'not_found', namespace: normalized.namespace}
      }
      if (entry.total === 1) {
        return {kind: 'resolved', namespace: normalized.namespace, tool: entry.candidates[0]!}
      }
      return {
        kind: 'ambiguous',
        namespace: normalized.namespace,
        candidates: entry.candidates,
        total: entry.total,
      }
    },
  }
}

export const getCachedToolLookupResolver = (
  artifact: ToolLookupArtifact,
): ToolLookupResolver => {
  const cached = resolverCache.get(artifact)
  if (cached) return cached
  const resolver = createToolLookupResolver(artifact)
  resolverCache.set(artifact, resolver)
  return resolver
}
// Slash-spelled registry namespaces probed when a bare shorthand misses its
// primary interpretation. `owner/name` collides between GitHub and Docker
// Hub; `@scope/name` collides between npm and JSR. Packagist-style
// vendor/package identities join here once they become lookup namespaces.
const getSearchIdentifierFallbackNamespaces = (
  namespace: ToolLookupNamespace,
): readonly ToolLookupNamespace[] => {
  if (namespace === 'github_repository') return ['container_image']
  if (namespace === 'npm_package') return ['jsr_package']
  return []
}

const lookupPinCandidates = (result: ToolLookupResult): ToolLookupCandidate[] => {
  if (result.kind === 'resolved' || result.kind === 'aliased') return [result.tool]
  if (result.kind === 'ambiguous') return result.candidates
  return []
}

/**
 * Resolves a raw search query into an exact Tool lookup outcome. Bare
 * identifier shorthand is ambiguous by spelling — owner/name collides
 * between GitHub and Docker Hub, and @scope/name collides between npm
 * and JSR — so a shorthand that pins no Tool under its primary registry
 * is tried against every namespace sharing that spelling. Live hits on
 * multiple registries report ambiguity instead of silently choosing one.
 * Explicit namespace:value references and pasted URLs keep their stated
 * scope: the shorthand patterns admit no ':', so a colon always means
 * the caller named the registry themselves.
 */
export const resolveToolSearchIdentifier = (
  resolver: ToolLookupResolver,
  input: JsonValue,
): ToolLookupResult | {kind: 'not_explicit'} => {
  const reference = parseToolSearchIdentifier(input)
  if (reference.kind !== 'lookup') return reference

  const primary = resolver.resolve(reference.input)
  const fallbackNamespaces = getSearchIdentifierFallbackNamespaces(
    reference.input.namespace,
  )
  if (
    fallbackNamespaces.length === 0 ||
    !isRuntimeString(input) ||
    input.includes(':')
  ) {
    return primary
  }

  const fallbackOutcomes = fallbackNamespaces.map(
    (namespace) =>
      resolver.resolve({
        namespace,
        // Registry spellings are lowercase-only, so the
        // shorthand's casing is canonicalized before probing.
        value: reference.input.value.toLowerCase(),
      }),
  )
  const fallbackCandidates = fallbackOutcomes.flatMap(lookupPinCandidates)
  if (fallbackCandidates.length === 0) return primary

  const seenSlugs = new Set<string>()
  const merged: ToolLookupCandidate[] = []
  for (const candidate of [...lookupPinCandidates(primary), ...fallbackCandidates]) {
    if (seenSlugs.has(candidate.slug)) continue
    seenSlugs.add(candidate.slug)
    merged.push(candidate)
  }
  merged.sort((left, right) => left.slug.localeCompare(right.slug))

  if (merged.length <= 1) {
    return (
      [primary, ...fallbackOutcomes].find(
        (outcome) => lookupPinCandidates(outcome).length > 0,
      ) ?? primary
    )
  }
  return {
    kind: 'ambiguous',
    namespace: reference.input.namespace,
    candidates: merged.slice(0, TOOL_LOOKUP_MAX_CANDIDATES),
    total: merged.length,
  }
}
