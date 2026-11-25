export {renderAgentReadinessMarkdown, formatAgentReadiness, buildAgentReadiness, buildAgentReadinessDisputeUrl, agentReadinessSchema, type AgentReadiness} from './agentReadiness.js'
import {deriveAgentSetupFacts, type AgentSetupFacts} from './agentSetupFacts.js'
export {deriveAgentSetupFacts, formatAgentSetupFacts, AGENT_AUTH_METHOD_VALUES, AGENT_EXECUTION_COST_VALUES, agentSetupFactsSchema, validateAgentSetupEvidence, type AgentSetupFacts} from './agentSetupFacts.js'
import {isValidNpmPackageName, isValidPypiProjectName} from './packageNames.js'
export {isValidNpmPackageName, isValidPypiProjectName} from './packageNames.js'
import {hasRuntimeObjectType, isRuntimeString} from './runtimeValidation.js'
import type {JsonValue} from './jsonValue.js'
import {
  MAX_PUBLIC_SOURCE_REFERENCE_URL_LENGTH,
  buildUniquePublicSourceReferenceMap,
  type PublicSourceReference,
  type SourceReferenceInput,
} from './sourceReference.js'
import {
  containerImageCanonicalUrl,
  containerImagePullRef,
  isContainerImageSource,
} from './containerImage.js'
import {isValidCatalogTimestamp} from './catalogFreshnessSearch.js'
import {validatePublicHttpUrl} from './urlSafety.js'
import {
  AGENT_SETUP_RECIPE_CONFIG_HOST_VALUES,
  normalizeMcpRegistryObservation,
  resolveAgentSetupRecipes,
  resolvePublicAgentSetupRecipeEntries,
  type ReadyStdioAgentSetupRecipe,
  toLegacyAgentSetupRecipe,
  type AgentSetupRecipeHost,
  type PublicAgentSetupRecipe,
  type PublicRemoteAgentSetupRecipeEntry,
} from './mcpRegistry.js'

import {isAgentInterfaceKind, getAgentInterfaceKindLabel, type AgentInterfaceKind} from './agentInterfaceKinds.js'
export {AGENT_INTERFACE_KIND_VALUES, AGENT_INTERFACE_KIND_OPTIONS, isAgentInterfaceKind, getAgentInterfaceKindLabel, matchesAgentInterfaceKind, type AgentInterfaceKind} from './agentInterfaceKinds.js'

export const AGENT_INTERFACE_STATUS_VALUES = [
  'official',
  'community',
  'deprecated',
  'unknown',
] as const

export type AgentInterfaceStatus = (typeof AGENT_INTERFACE_STATUS_VALUES)[number]

export const AGENT_INTERFACE_SOURCE_VALUES = [
  'mcp_registry',
  'npm',
  'pypi',
  'packagist',
  'jsr',
  'crates',
  'rubygems',
  'nuget',
  'homebrew',
  'homebrew_cask',
  'docker_hub',
  'ghcr',
  'container_registry',
  'winget',
  'scoop',
  'chocolatey',
  'vscode_marketplace',
  'open_vsx',
  'chrome_web_store',
  'firefox_add_ons',
  'github',
  'gitlab',
  'github_actions',
  'openapi',
  'manual',
  'other',
] as const

export type AgentInterfaceSource = (typeof AGENT_INTERFACE_SOURCE_VALUES)[number]

export const AGENT_AUTOMATION_CAPABILITY_VALUES = ['yes', 'no', 'partial', 'unknown'] as const
export type AgentAutomationCapability = (typeof AGENT_AUTOMATION_CAPABILITY_VALUES)[number]

export const AGENT_AUTOMATION_EVIDENCE_BASIS_VALUES = [
  'documented',
  'hands_on_tested',
  'experimental',
  'unknown',
] as const
export type AgentAutomationEvidenceBasis =
  (typeof AGENT_AUTOMATION_EVIDENCE_BASIS_VALUES)[number]

export const AGENT_AUTOMATION_SIDE_EFFECT_VALUES = [
  'filesystem',
  'network',
  'account',
  'billing',
  'destructive',
] as const
export type AgentAutomationSideEffect = (typeof AGENT_AUTOMATION_SIDE_EFFECT_VALUES)[number]

export const AGENT_AUTOMATION_WORKSPACE_CONCURRENCY_VALUES = [
  'parallel_safe',
  'requires_isolation',
  'single_writer',
  'unsafe',
  'unknown',
] as const
export type AgentAutomationWorkspaceConcurrency =
  (typeof AGENT_AUTOMATION_WORKSPACE_CONCURRENCY_VALUES)[number]

export const AGENT_AUTOMATION_ISOLATION_SUPPORT_VALUES = [
  'worktree',
  'directory',
  'container',
  'none',
  'unknown',
] as const
export type AgentAutomationIsolationSupport =
  (typeof AGENT_AUTOMATION_ISOLATION_SUPPORT_VALUES)[number]

export interface AgentInterfaceAutomationInput {
  nonInteractive?: string
  structuredOutput?: string
  dryRun?: string
  evidenceBasis?: string
  sideEffects?: string[]
  workspaceConcurrency?: string
  isolationSupport?: string[]
  checkedAt?: string
  notes?: string
  evidenceReferenceKeys?: string[]
}

export interface PublicAgentInterfaceAutomation {
  nonInteractive?: AgentAutomationCapability
  structuredOutput?: AgentAutomationCapability
  dryRun?: AgentAutomationCapability
  evidenceBasis?: AgentAutomationEvidenceBasis
  sideEffects?: AgentAutomationSideEffect[]
  workspaceConcurrency?: AgentAutomationWorkspaceConcurrency
  isolationSupport?: AgentAutomationIsolationSupport[]
  checkedAt: string
  notes?: string
  evidenceReferences: PublicSourceReference[]
}

export interface AgentInterfaceOption<T extends string> {
  title: string
  value: T
}

export const AGENT_INTERFACE_STATUS_OPTIONS: AgentInterfaceOption<AgentInterfaceStatus>[] = [
  {title: 'Official', value: 'official'},
  {title: 'Community', value: 'community'},
  {title: 'Deprecated', value: 'deprecated'},
  {title: 'Unknown', value: 'unknown'},
]

export const AGENT_INTERFACE_SOURCE_OPTIONS: AgentInterfaceOption<AgentInterfaceSource>[] = [
  {title: 'MCP Registry', value: 'mcp_registry'},
  {title: 'npm', value: 'npm'},
  {title: 'PyPI', value: 'pypi'},
  {title: 'Packagist', value: 'packagist'},
  {title: 'JSR', value: 'jsr'},
  {title: 'crates.io', value: 'crates'},
  {title: 'RubyGems', value: 'rubygems'},
  {title: 'NuGet', value: 'nuget'},
  {title: 'Homebrew', value: 'homebrew'},
  {title: 'Homebrew Cask', value: 'homebrew_cask'},
  {title: 'Docker Hub', value: 'docker_hub'},
  {title: 'GHCR', value: 'ghcr'},
  {title: 'Other container registry', value: 'container_registry'},
  {title: 'winget', value: 'winget'},
  {title: 'Scoop', value: 'scoop'},
  {title: 'Chocolatey', value: 'chocolatey'},
  {title: 'VS Code Marketplace', value: 'vscode_marketplace'},
  {title: 'Open VSX', value: 'open_vsx'},
  {title: 'Chrome Web Store', value: 'chrome_web_store'},
  {title: 'Firefox Add-ons', value: 'firefox_add_ons'},
  {title: 'GitHub', value: 'github'},
  {title: 'GitLab', value: 'gitlab'},
  {title: 'GitHub Actions', value: 'github_actions'},
  {title: 'OpenAPI', value: 'openapi'},
  {title: 'Manual', value: 'manual'},
  {title: 'Other', value: 'other'},
]

// SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
const AGENT_INTERFACE_STATUS_LABELS: Record<AgentInterfaceStatus, string> = Object.fromEntries(
  AGENT_INTERFACE_STATUS_OPTIONS.map((option) => [option.value, option.title]),
) as Record<AgentInterfaceStatus, string>

// SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
const AGENT_INTERFACE_SOURCE_LABELS: Record<AgentInterfaceSource, string> = Object.fromEntries(
  AGENT_INTERFACE_SOURCE_OPTIONS.map((option) => [option.value, option.title]),
) as Record<AgentInterfaceSource, string>

// SAFETY: The source is a closed or validated string collection; widening only enables collection operations.
export const isAgentInterfaceStatus = (value: JsonValue): value is AgentInterfaceStatus =>
  isRuntimeString(value) && (/* SAFETY: The adjacent guard or owner API establishes this asserted contract before use. */ AGENT_INTERFACE_STATUS_VALUES as readonly string[]).includes(value)

// SAFETY: The source is a closed or validated string collection; widening only enables collection operations.
export const isAgentInterfaceSource = (value: JsonValue): value is AgentInterfaceSource =>
  isRuntimeString(value) && (/* SAFETY: The adjacent guard or owner API establishes this asserted contract before use. */ AGENT_INTERFACE_SOURCE_VALUES as readonly string[]).includes(value)

const COMPOSER_PACKAGE_NAME_PATTERN =
  /^[a-z0-9]+(?:[_.-][a-z0-9]+)*\/[a-z0-9]+(?:(?:[_.]|-{1,2})[a-z0-9]+)*$/

/**
 * Composer's package-name grammar from the composer.json schema.
 * Keep this check local and deterministic so copy-only commands cannot interpolate arbitrary text.
 */
export const isValidComposerPackageName = (value: JsonValue): value is string =>
  isRuntimeString(value) && COMPOSER_PACKAGE_NAME_PATTERN.test(value)

// winget PackageIdentifier is `Publisher.Package`; the format rule comes from
// microsoft/winget-pkgs manifest requirements and is case-insensitive.
const WINGET_PACKAGE_IDENTIFIER_PATTERN = /^[A-Za-z0-9.+-]+\.[A-Za-z0-9.+-]+$/

export const isWingetPackageIdentifier = (value: string): boolean =>
  WINGET_PACKAGE_IDENTIFIER_PATTERN.test(value)

// Scoop app names are lowercase manifest filenames in bucket repos; an
// optional `bucket/` prefix selects a non-main bucket (`extras/pwsh`).
// Strict so a derived copy-only command can never interpolate flags,
// paths, or shell metacharacters.
const SCOOP_APP_NAME_PATTERN =
  /^([a-z0-9][a-z0-9-]*\/)?[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/

export const isValidScoopAppName = (value: JsonValue): value is string =>
  isRuntimeString(value) && value.length <= 100 && SCOOP_APP_NAME_PATTERN.test(value)

// Chocolatey package ids are lowercase alphanumeric segments joined by
// `.`, `-`, or `_` separators — never leading, trailing, or doubled
// separators, and never uppercase. Strict so a derived copy-only command
// can never interpolate flags or shell metacharacters.
const CHOCOLATEY_PACKAGE_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/

export const isValidChocolateyPackageId = (value: JsonValue): value is string =>
  isRuntimeString(value) && value.length <= 100 && CHOCOLATEY_PACKAGE_ID_PATTERN.test(value)

/**
 * Chrome Web Store public item ids are exactly 32 lowercase letters in the
 * range a-p. The store listing URL is the only unauthenticated install
 * surface, so the identifier stays strictly validated before it can be
 * interpolated into any public-facing URL.
 */
const CHROME_WEB_STORE_ITEM_ID_PATTERN = /^[a-p]{32}$/

export const isValidChromeWebStoreItemId = (value: JsonValue): value is string =>
  isRuntimeString(value) && CHROME_WEB_STORE_ITEM_ID_PATTERN.test(value)

/**
 * GitHub Actions `uses:` identity: `owner/repo` plus an optional path to the
 * action directory (`owner/repo/path`). Owner names follow GitHub login rules
 * (alphanumerics and hyphens, never a leading or trailing hyphen); repository
 * and path segments allow dots and underscores. No `@ref` — the ref is an
 * authored choice, never part of the identifier. Strict so a derived
 * copy-only `uses:` line can never interpolate refs, flags, or path escapes.
 */
const GITHUB_ACTIONS_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/
const GITHUB_ACTIONS_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/

export const isValidGithubActionsIdentifier = (value: JsonValue): value is string => {
  if (!isRuntimeString(value) || value.length > 160) return false
  const [owner, repo, ...pathSegments] = value.split('/')
  if (!owner || !repo || !GITHUB_ACTIONS_OWNER_PATTERN.test(owner)) return false
  if (repo === '.' || repo === '..' || !GITHUB_ACTIONS_SEGMENT_PATTERN.test(repo)) return false
  return pathSegments.every(
    (segment) =>
      segment !== '.' && segment !== '..' && GITHUB_ACTIONS_SEGMENT_PATTERN.test(segment),
  )
}

/**
 * Firefox Add-ons (addons.mozilla.org) identifiers are either the public
 * add-on slug — lowercase alphanumerics joined by `.`, `_`, or `-` — or the
 * extension's install GUID (`{uuid}` braces or `name@domain` email-style).
 * Strict so a derived listing URL can never interpolate path segments,
 * query text, or separators that would escape the canonical route.
 */
const FIREFOX_ADDON_SLUG_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const FIREFOX_ADDON_GUID_PATTERN =
  /^(?:\{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}|[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)$/

export const isValidFirefoxAddonsIdentifier = (value: JsonValue): value is string =>
  isRuntimeString(value) &&
  value.length <= 100 &&
  (FIREFOX_ADDON_SLUG_PATTERN.test(value) || FIREFOX_ADDON_GUID_PATTERN.test(value))

const CHROME_WEB_STORE_HOST = 'chromewebstore.google.com'

export const buildChromeWebStoreItemUrl = (itemId: string): string =>
  `https://${CHROME_WEB_STORE_HOST}/detail/${itemId}`

/**
 * Canonical public listing URL for registry sources whose strict identifier
 * grammar makes the URL a pure function of the identifier. winget has no
 * per-package listing page (winget-pkgs is a manifest repository), so it is
 * intentionally absent; npm and PyPI predate this derivation and are
 * covered by Resource Identity instead.
 */
const getAgentInterfaceRegistryListingUrl = (
  source: AgentInterfaceSource,
  identifier: string,
): string | undefined => {
  if (source === 'mcp_registry') {
    return `https://registry.modelcontextprotocol.io/servers/${encodeURIComponent(identifier)}`
  }
  if (source === 'nuget') return `https://www.nuget.org/packages/${identifier}`
  if (source === 'rubygems') return `https://rubygems.org/gems/${identifier}`
  if (source === 'packagist') return `https://packagist.org/packages/${identifier}`
  if (source === 'vscode_marketplace') {
    return `https://marketplace.visualstudio.com/items?itemName=${encodeURIComponent(identifier)}`
  }
  if (source === 'open_vsx') {
    // Extension ids are publisher.extension with a single dot, enforced by
    // isValidVscodeExtensionId before this runs.
    const [publisher, name] = identifier.split('.')
    return publisher && name
      ? `https://open-vsx.org/extension/${publisher}/${name}`
      : undefined
  }
  if (source === 'jsr') return `https://jsr.io/${identifier}`
  if (source === 'github_actions') {
    // The repository page is the verifiable listing; the Marketplace slug
    // comes from action.yml and cannot be derived from owner/repo.
    const [owner, repo] = identifier.split('/')
    return owner && repo ? `https://github.com/${owner}/${repo}` : undefined
  }
  if (source === 'crates') return `https://crates.io/crates/${identifier}`
  if ((source === 'homebrew' || source === 'homebrew_cask') && identifier.includes('/')) {
    const [owner, tap] = identifier.split('/')
    return `https://github.com/${owner}/homebrew-${tap}`
  }
  if (source === 'homebrew') return `https://formulae.brew.sh/formula/${identifier}`
  if (source === 'homebrew_cask') return `https://formulae.brew.sh/cask/${identifier}`
  if (isContainerImageSource(source) && containerImagePullRef(identifier, source)) {
    return containerImageCanonicalUrl(identifier) ?? undefined
  }
  return undefined
}

export const isChromeWebStoreListingUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value)
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname === CHROME_WEB_STORE_HOST &&
      !parsed.username &&
      !parsed.password
    )
  } catch {
    return false
  }
}

const FIREFOX_ADDONS_HOST = 'addons.mozilla.org'

// AMO locales (`en-US`, `pt-BR`, `de`, …) prefix the listing path; the
// canonical listing URL drops them so every visitor lands on the same page.
const FIREFOX_ADDONS_LOCALE_SEGMENT_PATTERN = /^[a-z]{2,3}(?:-[a-zA-Z0-9]{2,8})?$/

/**
 * Public AMO listing path: `/firefox/addon/{slug}/` optionally prefixed by a
 * visitor locale (`/en-US/firefox/addon/{slug}/`). Returns the listing slug —
 * GUID identifiers have no public listing path — or undefined for anything
 * that is not an add-on listing URL.
 */
export const parseFirefoxAddonsListingSlug = (value: string): string | undefined => {
  try {
    const parsed = new URL(value)
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname !== FIREFOX_ADDONS_HOST ||
      parsed.username ||
      parsed.password
    ) {
      return undefined
    }
    const segments = parsed.pathname.split('/').filter(Boolean)
    if (segments.length > 0 && FIREFOX_ADDONS_LOCALE_SEGMENT_PATTERN.test(segments[0] ?? '')) {
      segments.shift()
    }
    if (segments.length !== 3 || segments[0] !== 'firefox' || segments[1] !== 'addon') {
      return undefined
    }
    const slug = segments[2]
    return slug && FIREFOX_ADDON_SLUG_PATTERN.test(slug) ? slug : undefined
  } catch {
    return undefined
  }
}

/**
 * Canonical AMO listing URL for a slug-grammar identifier. GUID identifiers
 * have no public listing path, so no URL can be derived for them.
 */
export const buildFirefoxAddonsListingUrl = (identifier: string): string | undefined =>
  FIREFOX_ADDON_SLUG_PATTERN.test(identifier)
    ? `https://${FIREFOX_ADDONS_HOST}/firefox/addon/${identifier}/`
    : undefined

/**
 * Canonicalizes an editor-authored AMO listing URL — strips any locale
 * prefix — or returns undefined when the value is not an add-on listing URL.
 */
export const normalizeFirefoxAddonsListingUrl = (value: string): string | undefined => {
  const slug = parseFirefoxAddonsListingSlug(value)
  return slug ? `https://${FIREFOX_ADDONS_HOST}/firefox/addon/${slug}/` : undefined
}

export const isFirefoxAddonsListingUrl = (value: string): boolean =>
  normalizeFirefoxAddonsListingUrl(value) !== undefined
// RubyGems' public name rules: lowercase letters, digits, underscores, and dashes with
// separators between alphanumeric segments. Strict so a derived copy-only command can
// never interpolate spaces or shell metacharacters.
const RUBYGEMS_GEM_NAME_PATTERN = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/

export const isValidGemName = (value: JsonValue): value is string =>
  isRuntimeString(value) && RUBYGEMS_GEM_NAME_PATTERN.test(value)

// VS Code Marketplace extension ids are `publisher.extension`; each segment is letters,
// digits, and `-`/`_` separators between alphanumeric runs — the same shape
// `code --install-extension` accepts. Strict so a derived copy-only command can never
// interpolate spaces or shell metacharacters.
const VSCODE_EXTENSION_ID_PATTERN = /^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*\.[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/

export const isValidVscodeExtensionId = (value: JsonValue): value is string =>
  isRuntimeString(value) && VSCODE_EXTENSION_ID_PATTERN.test(value)

// The Open VSX registry listing for an extension id lives at
// /extension/{publisher}/{name}; other paths (publisher pages, search) are not
// listing URLs.
export const isOpenVsxListingUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value)
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname !== 'open-vsx.org' ||
      parsed.port ||
      parsed.username ||
      parsed.password
    ) {
      return false
    }
    const segments = parsed.pathname.split('/').filter(Boolean)
    return segments.length === 3 && segments[0] === 'extension' &&
      isValidVscodeExtensionId(`${segments[1]}.${segments[2]}`)
  } catch {
    return false
  }
}

// nuget.org package ids start with a letter, digit, or underscore, then use ASCII
// letters, digits, dots, and dashes with no consecutive separators; 100 characters max.
// Strict so a derived copy-only command can never interpolate spaces or shell
// metacharacters.
const NUGET_PACKAGE_ID_PATTERN = /^[A-Za-z0-9_](?:[A-Za-z0-9]|[.-](?=[A-Za-z0-9]))*$/

export const isValidNuGetPackageId = (value: JsonValue): value is string =>
  isRuntimeString(value) && value.length <= 100 && NUGET_PACKAGE_ID_PATTERN.test(value)

// Homebrew formula names are lowercase letters and digits joined by `-`, `_`, `+`,
// and `.` separators, optionally ending in `+` (e.g. `libsigc++`).
// An optional owner/tap prefix identifies a third-party tap. Version pins and flags
// are not formula names. Strict so a derived copy-only command can never interpolate options or
// shell metacharacters.
const HOMEBREW_FORMULA_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9_.+-]*[a-z0-9+])?$/

// A qualified Homebrew name uses the GitHub owner and tap repository suffix.
// Keep both path segments lowercase and free of shell syntax, like the token.
const HOMEBREW_TAP_OWNER_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const HOMEBREW_TAP_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9_.-]*[a-z0-9])?$/

const isValidHomebrewIdentifier = (value: string, tokenPattern: RegExp): boolean => {
  const parts = value.split('/')
  if (parts.length === 1) return tokenPattern.test(value)
  const [owner, tap, token] = parts
  return parts.length === 3 && owner !== undefined && tap !== undefined && token !== undefined &&
    HOMEBREW_TAP_OWNER_PATTERN.test(owner) && HOMEBREW_TAP_NAME_PATTERN.test(tap) &&
    tokenPattern.test(token)
}

export const isValidHomebrewFormulaName = (value: JsonValue): value is string =>
  isRuntimeString(value) && isValidHomebrewIdentifier(value, HOMEBREW_FORMULA_NAME_PATTERN)

// JSR package names are the @scope/name grammar the Resource Identity submission
// parser applies: lowercase alphanumeric scope with dash separators, and a
// lowercase name allowing dash and underscore separators. Canonical JSR names
// are lowercase, so the authored value must already match. Strict so a derived
// copy-only command can never interpolate spaces or shell metacharacters.
const JSR_PACKAGE_NAME_PATTERN = /^@[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:[-_][a-z0-9]+)*$/

export const isValidJsrPackageName = (value: JsonValue): value is string =>
  isRuntimeString(value) && JSR_PACKAGE_NAME_PATTERN.test(value)

// crates.io names use the grammar the Resource Identity submission parser
// applies: a leading ASCII letter, then letters, digits, `-`, or `_`, 64
// characters max. Strict so a derived copy-only command can never interpolate
// flags, version specifiers, or shell metacharacters.
const CRATES_PACKAGE_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/

export const isValidCratesPackageName = (value: JsonValue): value is string =>
  isRuntimeString(value) && value.length <= 64 && CRATES_PACKAGE_NAME_PATTERN.test(value)

// Homebrew cask tokens are lowercase alphanumeric segments joined by single
// hyphens (the Cask Cookbook token rules) — narrower than formula names, which
// also allow + . _ and trailing +. Strict so a derived copy-only command can
// never interpolate options or shell metacharacters.
const HOMEBREW_CASK_TOKEN_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const isValidHomebrewCaskToken = (value: JsonValue): value is string =>
  isRuntimeString(value) && isValidHomebrewIdentifier(value, HOMEBREW_CASK_TOKEN_PATTERN)

const isValidGenericContainerIdentifier = (value: JsonValue): value is string =>
  isRuntimeString(value) && value === value.trim() && containerImagePullRef(value, 'container_registry') !== null

/**
 * Registry sources whose identifiers must match the authored value exactly — a trimmed or
 * otherwise repaired spelling is malformed input, not a name to fix.
 */
const STRICT_IDENTIFIER_SOURCES = new Map<
  AgentInterfaceSource,
  (value: JsonValue) => value is string
>([
  ['container_registry', isValidGenericContainerIdentifier],
  ['npm', isValidNpmPackageName],
  ['pypi', isValidPypiProjectName],
  ['homebrew', isValidHomebrewFormulaName],
  ['homebrew_cask', isValidHomebrewCaskToken],
  ['packagist', isValidComposerPackageName],
  ['rubygems', isValidGemName],
  ['nuget', isValidNuGetPackageId],
  ['scoop', isValidScoopAppName],
  ['chocolatey', isValidChocolateyPackageId],
  ['vscode_marketplace', isValidVscodeExtensionId],
  ['open_vsx', isValidVscodeExtensionId],
  ['chrome_web_store', isValidChromeWebStoreItemId],
  ['github_actions', isValidGithubActionsIdentifier],
  ['firefox_add_ons', isValidFirefoxAddonsIdentifier],
  ['jsr', isValidJsrPackageName],
  ['crates', isValidCratesPackageName],
])

export const isAgentInterfaceIdentifierValid = (
  source: AgentInterfaceSource | undefined,
  identifier: string,
): boolean => {
  if (source === 'winget') return isWingetPackageIdentifier(identifier)
  const strictValidator = source ? STRICT_IDENTIFIER_SOURCES.get(source) : undefined
  return strictValidator ? strictValidator(identifier) : true
}

export const getAgentInterfaceStatusLabel = (value: AgentInterfaceStatus): string =>
  AGENT_INTERFACE_STATUS_LABELS[value]

export const getAgentInterfaceSourceLabel = (value: AgentInterfaceSource): string =>
  AGENT_INTERFACE_SOURCE_LABELS[value]

export interface AgentInterfaceInput {
  _key?: string
  kind?: string
  status?: string
  source?: string
  identifier?: string
  docsUrl?: string
  installCommand?: string
  operatingSystem?: string
  downloadUrl?: string
  authRequirement?: string
  authMethod?: string
  executionCost?: string
  executionCostSourceUrl?: string
  installCommandSourceUrl?: string
  checkedAt?: string
  capabilitiesNote?: string
  label?: string
  automation?: AgentInterfaceAutomationInput
  /** Sweep-written MCP Registry facts; parsed at this boundary. */
  mcpRegistryObservation?: JsonValue
}

/** Optional tool-level MCP Registry pointers used when an interface only sets source. */
export interface AgentInterfaceRegistryContext {
  registryId?: string | null
  mcpRegistryUrl?: string | null
}

export interface AgentInterfaceNormalizationContext extends AgentInterfaceRegistryContext {
  /** Rich detail only: keep catalog cards and search props small. */
  includeSetupFacts?: boolean
  sourceReferences?: SourceReferenceInput[] | null
  /** Tool slug — the `mcpServers` key a derived Cursor recipe uses. */
  slug?: string | null
}

export interface NormalizedPublicAgentInterfaceIdentity {
  kind: AgentInterfaceKind
  source?: AgentInterfaceSource
  identifier?: string
  docsUrl?: string
}

export interface PublicAgentInterface {
  setupFacts?: AgentSetupFacts
  kind: AgentInterfaceKind
  status: AgentInterfaceStatus
  label: string
  source?: AgentInterfaceSource
  identifier?: string
  docsUrl?: string
  installCommand?: string
  operatingSystem?: 'macos' | 'windows' | 'linux'
  downloadUrl?: string
  authRequirement?: string
  checkedAt?: string
  capabilitiesNote?: string
  automation?: PublicAgentInterfaceAutomation
  /**
   * Derived Cursor setup state. Present on `mcp_server` interfaces: `ready`
   * carries a Cursor recipe built from the stored MCP Registry observation;
   * `unknown` means no confirmed remote recipe exists.
   * @deprecated Prefer `setupRecipes`, which carries every supported host.
   */
  setupRecipe?: PublicAgentSetupRecipe
  /**
   * Derived setup state per supported Agent Host, in
   * `AGENT_SETUP_RECIPE_HOST_VALUES` order. Present on `mcp_server`
   * interfaces; each entry is `ready` with a copy-only snippet or `unknown`
   * naming its host.
   */
  setupRecipes?: PublicRemoteAgentSetupRecipeEntry[]
  /** Additive fallback so older remote-only feed parsers keep accepting the Tool. */
  stdioSetupRecipe?: ReadyStdioAgentSetupRecipe
  /** Additive metadata; older clients retain the compatible no_recipe state. */
  sseOnlyRemotes?: true
}

const PUBLIC_TEXT_CONTROL_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu
const PUBLIC_TEXT_CONTROL_TEST_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u

const normalizeText = (value: string | undefined, maxLength?: number, preserveSpacing = false): string | undefined => {
  const normalized = (value ?? '')
    .replace(PUBLIC_TEXT_CONTROL_PATTERN, '')
    .replace(/\s+/g, (spacing) => preserveSpacing ? spacing : ' ')
    .trim()
  if (normalized.length === 0) {
    return undefined
  }

  if (maxLength !== undefined && normalized.length > maxLength) {
    return normalized.slice(0, maxLength).trim()
  }

  return normalized
}

const normalizePublicHttpUrl = (value: string | undefined): string | undefined => {
  if (
    !value ||
    value.trim().length > MAX_PUBLIC_SOURCE_REFERENCE_URL_LENGTH ||
    PUBLIC_TEXT_CONTROL_TEST_PATTERN.test(value)
  ) {
    return undefined
  }

  const result = validatePublicHttpUrl(value)
  if (!result.success) return undefined
  const canonical = new URL(result.url ?? value).href
  return canonical.length <= MAX_PUBLIC_SOURCE_REFERENCE_URL_LENGTH ? canonical : undefined
}

/** Normalize the identity fields exactly as they appear in the public interface projection. */
export const normalizePublicAgentInterfaceIdentity = (
  entry: AgentInterfaceInput | null | undefined,
  registryContext?: AgentInterfaceRegistryContext | null,
): NormalizedPublicAgentInterfaceIdentity | undefined => {
  if (!entry || !hasRuntimeObjectType(entry) || !isAgentInterfaceKind(entry.kind)) {
    return undefined
  }

  const source: AgentInterfaceSource | undefined = isAgentInterfaceSource(entry.source)
    ? entry.source
    : undefined
  const contextRegistryId = normalizeText(registryContext?.registryId ?? undefined, 160)
  const contextMcpRegistryUrl = normalizePublicHttpUrl(
    registryContext?.mcpRegistryUrl ?? undefined,
  )
  const strictIdentifierValidator = source ? STRICT_IDENTIFIER_SOURCES.get(source) : undefined
  const normalizedIdentifier = strictIdentifierValidator
    ? strictIdentifierValidator(entry.identifier)
      ? entry.identifier
      : undefined
    : normalizeText(entry.identifier, 160) ??
      (source === 'mcp_registry' ? contextRegistryId : undefined)
  const identifier: string | undefined =
    normalizedIdentifier && isAgentInterfaceIdentifierValid(source, normalizedIdentifier)
      ? normalizedIdentifier
      : undefined
  const entryDocsUrl = normalizePublicHttpUrl(entry.docsUrl)
  const chromeStoreDocsUrl =
    source === 'chrome_web_store' && entryDocsUrl && isChromeWebStoreListingUrl(entryDocsUrl)
      ? entryDocsUrl
      : undefined
  const openVsxDocsUrl =
    source === 'open_vsx' && entryDocsUrl && isOpenVsxListingUrl(entryDocsUrl)
      ? entryDocsUrl
      : undefined
  const firefoxAddonsDocsUrl =
    source === 'firefox_add_ons' && entryDocsUrl
      ? normalizeFirefoxAddonsListingUrl(entryDocsUrl)
      : undefined
  const docsUrl: string | undefined =
    source === 'chrome_web_store'
      ? chromeStoreDocsUrl ??
        (identifier ? buildChromeWebStoreItemUrl(identifier) : undefined)
      : source === 'open_vsx'
        ? openVsxDocsUrl ??
          (identifier
            ? getAgentInterfaceRegistryListingUrl(source, identifier)
            : undefined)
        : source === 'firefox_add_ons'
          ? firefoxAddonsDocsUrl ??
            (identifier ? buildFirefoxAddonsListingUrl(identifier) : undefined)
          : entryDocsUrl ??
            (source === 'mcp_registry' && contextMcpRegistryUrl
              ? contextMcpRegistryUrl
              : source && identifier
                ? getAgentInterfaceRegistryListingUrl(source, identifier)
                : undefined)

  return {
    kind: entry.kind,
    ...(source ? {source} : undefined),
    ...(identifier ? {identifier} : undefined),
    ...(docsUrl ? {docsUrl} : undefined),
  }
}

const isIsoDateTime = (value: string | undefined): value is string => {
  const raw = normalizeText(value)
  return Boolean(raw && isValidCatalogTimestamp(raw))
}

// SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
const isEnumValue = <T extends string>(
  values: readonly T[],
  value: JsonValue,
): value is T => isRuntimeString(value) && values.includes(value as T)

const normalizeEnumValue = <T extends string>(
  value: JsonValue,
  values: readonly T[],
): T | undefined => isEnumValue(values, value) ? value : undefined

export const getAgentInterfaceIdentityKey = (
  value: AgentInterfaceInput | null | undefined,
  context?: AgentInterfaceRegistryContext,
): string | undefined => {
  const identity = normalizePublicAgentInterfaceIdentity(value, context)
  if (!identity) return undefined

  const identityKind = identity.identifier ? 'identifier' : identity.docsUrl ? 'docsUrl' : undefined
  const identityValue = identity.identifier ?? identity.docsUrl
  if (identity.source === 'mcp_registry' && !identityValue) {
    return JSON.stringify([identity.kind, identity.source, 'source-only'])
  }
  return identityKind && identityValue
    ? JSON.stringify([identity.kind, identity.source ?? '', identityKind, identityValue])
    : undefined
}

export const MAX_PUBLIC_AGENT_INTERFACES = 20
export const MAX_AGENT_AUTOMATION_INPUT_ITEMS = 50
export const MAX_AGENT_AUTOMATION_EVIDENCE_REFERENCES = 3
export const MAX_AGENT_AUTOMATION_NOTES_LENGTH = 280

const normalizeEnumArray = <T extends string>(
  value: JsonValue,
  values: readonly T[],
): T[] => {
  if (!Array.isArray(value)) {
    return []
  }

  const normalized = new Set<T>()
  const scanLength = Math.min(value.length, MAX_AGENT_AUTOMATION_INPUT_ITEMS)
  for (let index = 0; index < scanLength; index += 1) {
    const entry = value[index]
    if (isEnumValue(values, entry)) {
      normalized.add(entry)
      if (normalized.size === values.length) {
        break
      }
    }
  }

  return [...normalized]
}

const normalizeIsolationSupport = (value: JsonValue): AgentAutomationIsolationSupport[] => {
  const normalized = normalizeEnumArray(value, AGENT_AUTOMATION_ISOLATION_SUPPORT_VALUES)
  const hasSentinel = normalized.includes('none') || normalized.includes('unknown')
  return hasSentinel && normalized.length > 1 ? [] : normalized
}

const resolveEvidenceReferences = (
  value: JsonValue,
  evidenceByKey: ReadonlyMap<string, PublicSourceReference>,
): PublicSourceReference[] => {
  if (!Array.isArray(value)) {
    return []
  }

  const seenKeys = new Set<string>()
  const references: PublicSourceReference[] = []
  const scanLength = Math.min(value.length, MAX_AGENT_AUTOMATION_INPUT_ITEMS)
  for (let index = 0; index < scanLength; index += 1) {
    const key = normalizeText(isRuntimeString(value[index]) ? value[index] : undefined, 160)
    if (!key || seenKeys.has(key)) {
      continue
    }

    seenKeys.add(key)
    const reference = evidenceByKey.get(key)
    if (reference) {
      references.push(reference)
      if (references.length === MAX_AGENT_AUTOMATION_EVIDENCE_REFERENCES) {
        break
      }
    }
  }

  return references
}

const normalizePublicAutomation = (
  automation: AgentInterfaceAutomationInput | null | undefined,
  evidenceByKey: ReadonlyMap<string, PublicSourceReference>,
): PublicAgentInterfaceAutomation | undefined => {
  if (!automation || !hasRuntimeObjectType(automation) || !isIsoDateTime(automation.checkedAt)) {
    return undefined
  }

  const nonInteractive = normalizeEnumValue(
    automation.nonInteractive,
    AGENT_AUTOMATION_CAPABILITY_VALUES,
  )
  const structuredOutput = normalizeEnumValue(
    automation.structuredOutput,
    AGENT_AUTOMATION_CAPABILITY_VALUES,
  )
  const dryRun = normalizeEnumValue(automation.dryRun, AGENT_AUTOMATION_CAPABILITY_VALUES)
  const evidenceBasis = normalizeEnumValue(
    automation.evidenceBasis,
    AGENT_AUTOMATION_EVIDENCE_BASIS_VALUES,
  )
  const sideEffects = normalizeEnumArray(
    automation.sideEffects,
    AGENT_AUTOMATION_SIDE_EFFECT_VALUES,
  )
  const workspaceConcurrency = normalizeEnumValue(
    automation.workspaceConcurrency,
    AGENT_AUTOMATION_WORKSPACE_CONCURRENCY_VALUES,
  )
  const isolationSupport = normalizeIsolationSupport(automation.isolationSupport)
  const notes = normalizeText(automation.notes, MAX_AGENT_AUTOMATION_NOTES_LENGTH)
  const evidenceReferences = resolveEvidenceReferences(
    automation.evidenceReferenceKeys,
    evidenceByKey,
  )

  const hasFact = Boolean(
    nonInteractive ||
      structuredOutput ||
      dryRun ||
      evidenceBasis ||
      sideEffects.length > 0 ||
      workspaceConcurrency ||
      isolationSupport.length > 0,
  )
  if (!hasFact || evidenceReferences.length === 0) {
    return undefined
  }

  return {
    ...(nonInteractive ? { nonInteractive } : undefined),
    ...(structuredOutput ? { structuredOutput } : undefined),
    ...(dryRun ? { dryRun } : undefined),
    ...(evidenceBasis ? { evidenceBasis } : undefined),
    ...(sideEffects.length > 0 ? { sideEffects } : undefined),
    ...(workspaceConcurrency ? { workspaceConcurrency } : undefined),
    ...(isolationSupport.length > 0 ? { isolationSupport } : undefined),
    checkedAt: normalizeText(automation.checkedAt)!,
    ...(notes ? { notes } : undefined),
    evidenceReferences
  }
}

export const normalizePublicAgentInterfaces = (
  agentInterfaces: Array<AgentInterfaceInput | null | undefined> | null | undefined,
  registryContext?: AgentInterfaceNormalizationContext | null,
): PublicAgentInterface[] => {
  const evidenceByKey = buildUniquePublicSourceReferenceMap(registryContext?.sourceReferences)
  if (!Array.isArray(agentInterfaces)) return []

  const publicInterfaces: PublicAgentInterface[] = []
  const scanLength = Math.min(agentInterfaces.length, MAX_PUBLIC_AGENT_INTERFACES)
  for (let index = 0; index < scanLength; index += 1) {
    const entry: AgentInterfaceInput | null | undefined = agentInterfaces[index]
    if (!entry || !hasRuntimeObjectType(entry)) {
      continue
    }
    if (!isAgentInterfaceKind(entry.kind)) {
      continue
    }

    const status = isAgentInterfaceStatus(entry.status) ? entry.status : 'unknown'
    const normalizedIdentity = normalizePublicAgentInterfaceIdentity(entry, registryContext)
    if (!normalizedIdentity) continue
    const {kind, source, identifier, docsUrl} = normalizedIdentity
    // Spaces inside quoted arguments are part of the command, not prose formatting.
    const installCommand = status === 'deprecated' ? undefined : normalizeText(entry.installCommand, 500, true)
    const downloadUrl = kind === 'desktop_app' && status !== 'deprecated'
      ? normalizePublicHttpUrl(entry.downloadUrl) : undefined
    const operatingSystem = kind === 'desktop_app' &&
      (entry.operatingSystem === 'macos' || entry.operatingSystem === 'windows' || entry.operatingSystem === 'linux')
      ? entry.operatingSystem : undefined
    const authRequirement = normalizeText(entry.authRequirement, 120)
    const capabilitiesNote = normalizeText(entry.capabilitiesNote, 280)
    const label = normalizeText(entry.label, 80) ?? getAgentInterfaceKindLabel(entry.kind)
    const checkedAt: string | undefined = isIsoDateTime(entry.checkedAt)
      ? normalizeText(entry.checkedAt)
      : undefined
    const automation = normalizePublicAutomation(entry.automation, evidenceByKey)
    const observation = normalizeMcpRegistryObservation(entry.mcpRegistryObservation)
    const setupRecipes = status === 'deprecated' ? undefined : resolveAgentSetupRecipes({
      kind: entry.kind,
      serverKey: registryContext?.slug ?? undefined,
      observation,
      registryName: source === 'mcp_registry' ? identifier : undefined,
    })
    const setupRecipe = toLegacyAgentSetupRecipe(setupRecipes)

    // Match Studio: mcp_registry source counts as a pointer (often lives on resourceIdentity).
    const hasActionablePointer = Boolean(
      identifier || docsUrl || installCommand || downloadUrl || source === 'mcp_registry',
    )

    if (!hasActionablePointer) {
      continue
    }

    const publicInterface: PublicAgentInterface = {kind, status, label}
    if (source) publicInterface.source = source
    if (identifier) publicInterface.identifier = identifier
    if (docsUrl) publicInterface.docsUrl = docsUrl
    if (installCommand) publicInterface.installCommand = installCommand
    if (downloadUrl) publicInterface.downloadUrl = downloadUrl
    if (operatingSystem) publicInterface.operatingSystem = operatingSystem
    if (authRequirement) publicInterface.authRequirement = authRequirement
    if (checkedAt) publicInterface.checkedAt = checkedAt
    if (capabilitiesNote) publicInterface.capabilitiesNote = capabilitiesNote
    if (automation) publicInterface.automation = automation
    if (setupRecipe) publicInterface.setupRecipe = setupRecipe
    if (setupRecipes) publicInterface.setupRecipes = setupRecipes.map((recipe) => {
      if (recipe.state === 'unknown' && recipe.reason === 'sse_only') {
        publicInterface.sseOnlyRemotes = true
        return {...recipe, reason: 'no_recipe'}
      }
      if (recipe.state === 'ready' && 'transport' in recipe) {
        publicInterface.stdioSetupRecipe = recipe
        return {state: 'unknown', host: recipe.host}
      }
      return recipe
    })
    if (registryContext?.includeSetupFacts) {
      publicInterface.setupFacts = deriveAgentSetupFacts(entry, publicInterface)
    }
    publicInterfaces.push(publicInterface)
  }
  return publicInterfaces
}

export const getSearchableAgentInterfaceKinds = (
  agentInterfaces: AgentInterfaceInput[] | null | undefined,
  registryContext?: AgentInterfaceRegistryContext | null,
): AgentInterfaceKind[] => [
  ...new Set(
    normalizePublicAgentInterfaces(agentInterfaces, registryContext)
      .filter((agentInterface) => agentInterface.status !== 'deprecated')
      .map((agentInterface) => agentInterface.kind),
  ),
]

/**
 * Agent Hosts with a `ready` derived Setup Recipe on this Tool — the facet
 * vocabulary for "wire this into Cursor/Zed/…" discovery. `unknown` recipes
 * are absent, not incompatible; deprecated interfaces contribute nothing.
 */
export const getSearchableAgentSetupRecipeHosts = (
  agentInterfaces: AgentInterfaceInput[] | null | undefined,
  context?: AgentInterfaceNormalizationContext | null,
): AgentSetupRecipeHost[] => {
  const readyHosts = new Set(
    normalizePublicAgentInterfaces(agentInterfaces, context)
      .filter((agentInterface) => agentInterface.status !== 'deprecated')
      .flatMap(resolvePublicAgentSetupRecipeEntries)
      .filter((recipe) => recipe.state === 'ready')
      .map((recipe) => recipe.host),
  )

  return AGENT_SETUP_RECIPE_CONFIG_HOST_VALUES.filter((host) => readyHosts.has(host))
}

export {AGENT_INTERFACE_FACET_MINIMUM_COVERAGE, AGENT_INTERFACE_FACET_MINIMUM_TOOL_COUNT, shouldExposeAgentInterfaceKindFacet} from './agentInterfaceKinds.js'
