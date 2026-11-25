import {getPublicHttpUrl} from './urlSafety.js'
import {isRuntimeString} from './runtimeValidation.js'
import {containerImageCanonicalUrl, parseContainerImageReference} from './containerImage.js'
import {goModuleCanonicalUrl, isCanonicalGoModulePath} from './goModule.js'
import type {JsonValue} from './jsonValue.js'
import {parseGitlabRepositoryUrl} from './gitlabRepository.js'
export const RESOURCE_IDENTITY_KIND_VALUES = [
  'website',
  'github_repository',
  'gitlab_repository',
  'npm_package',
  'pypi_project',
  'crates_package',
  'jsr_package',
  'go_module',
  'mcp_registry_server',
  'container_image',
  'docs_site',
  'other',
] as const

export type ResourceIdentityKind = (typeof RESOURCE_IDENTITY_KIND_VALUES)[number]

export interface ResourceIdentityKindOption {
  title: string
  value: ResourceIdentityKind
}

export const DEFAULT_RESOURCE_IDENTITY_KIND: ResourceIdentityKind = 'website'

export const RESOURCE_IDENTITY_KIND_OPTIONS: ResourceIdentityKindOption[] = [
  {title: 'Official website', value: 'website'},
  {title: 'GitHub repository', value: 'github_repository'},
  {title: 'GitLab repository', value: 'gitlab_repository'},
  {title: 'npm package', value: 'npm_package'},
  {title: 'PyPI project', value: 'pypi_project'},
  {title: 'crates.io package', value: 'crates_package'},
  {title: 'JSR package', value: 'jsr_package'},
  {title: 'Go module', value: 'go_module'},
  {title: 'MCP Registry server', value: 'mcp_registry_server'},
  {title: 'Container image', value: 'container_image'},
  {title: 'Docs site', value: 'docs_site'},
  {title: 'Other', value: 'other'},
]

// SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
const RESOURCE_IDENTITY_KIND_LABELS: Record<ResourceIdentityKind, string> = Object.fromEntries(
  RESOURCE_IDENTITY_KIND_OPTIONS.map((option) => [option.value, option.title]),
) as Record<ResourceIdentityKind, string>

const RESOURCE_IDENTITY_CTA_LABELS = {
  website: 'Visit website',
  github_repository: 'Open repository',
  gitlab_repository: 'Open repository',
  npm_package: 'View package',
  pypi_project: 'View package',
  crates_package: 'View package',
  jsr_package: 'View package',
  go_module: 'View module',
  mcp_registry_server: 'Open MCP record',
  container_image: 'View image',
  docs_site: 'Read docs',
  other: 'Open resource',
} satisfies Record<ResourceIdentityKind, string>

const RESOURCE_IDENTITY_SHORT_LABELS = {
  website: 'Website',
  github_repository: 'Repository',
  gitlab_repository: 'Repository',
  npm_package: 'Package',
  pypi_project: 'Package',
  crates_package: 'Package',
  jsr_package: 'Package',
  go_module: 'Module',
  mcp_registry_server: 'MCP Registry',
  container_image: 'Container image',
  docs_site: 'Docs',
  other: 'External resource',
} satisfies Record<ResourceIdentityKind, string>

export interface ResourceIdentityInput {
  kind?: JsonValue
  canonicalUrl?: string | null
  registryId?: string | null
  websiteUrl?: string | null
  repositoryUrl?: string | null
  docsUrl?: string | null
  packageUrl?: string | null
  mcpRegistryUrl?: string | null
}

export interface ResourceIdentity {
  kind: ResourceIdentityKind
  canonicalUrl: string
  registryId?: string
  websiteUrl?: string
  repositoryUrl?: string
  docsUrl?: string
  packageUrl?: string
  mcpRegistryUrl?: string
}

export interface ResourceIdentityValidationIssue {
  path: string
  message: string
}

const trimOptional = (value: string | null | undefined): string | undefined => {
  if (!isRuntimeString(value)) {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

// SAFETY: The source is a closed or validated string collection; widening only enables collection operations.
export const isResourceIdentityKind = (value: JsonValue): value is ResourceIdentityKind =>
  isRuntimeString(value) &&
  (/* SAFETY: The adjacent guard or owner API establishes this asserted contract before use. */ RESOURCE_IDENTITY_KIND_VALUES as readonly string[]).includes(value)

export const toResourceIdentityKind = (value: JsonValue): ResourceIdentityKind =>
  isResourceIdentityKind(value) ? value : DEFAULT_RESOURCE_IDENTITY_KIND

export const getResourceIdentityKindLabel = (value: ResourceIdentityKind): string =>
  RESOURCE_IDENTITY_KIND_LABELS[value]

export const getResourceIdentityCtaLabel = (value: ResourceIdentityKind): string =>
  RESOURCE_IDENTITY_CTA_LABELS[value]

export const getResourceIdentityShortLabel = (value: ResourceIdentityKind): string =>
  RESOURCE_IDENTITY_SHORT_LABELS[value]

const registryBackedKinds = new Set<ResourceIdentityKind>([
  'npm_package',
  'pypi_project',
  'crates_package',
  'jsr_package',
  'go_module',
  'mcp_registry_server',
  'container_image',
])

const RESOURCE_IDENTITY_PRIMARY_INPUT_LABELS = {
  website: 'website URL',
  github_repository: 'repository URL',
  gitlab_repository: 'repository URL',
  npm_package: 'package URL',
  pypi_project: 'package URL',
  crates_package: 'package URL',
  jsr_package: 'package URL',
  go_module: 'package URL',
  mcp_registry_server: 'MCP Registry URL',
  container_image: 'package URL',
  docs_site: 'docs URL',
  other: 'canonical URL',
} satisfies Record<ResourceIdentityKind, string>

/**
 * The canonical candidate for a resolved identity: the explicit canonical URL,
 * the URL field dedicated to the selected kind, then any recorded public URL.
 * Shared by validation and resolution so Studio accepts exactly what the
 * public identity resolver can derive.
 */
const resolveCanonicalCandidate = (fields: {
  kind: ResourceIdentityKind
  canonicalUrl?: string
  registryId?: string
  websiteUrl?: string
  repositoryUrl?: string
  docsUrl?: string
  packageUrl?: string
  mcpRegistryUrl?: string
}): string | undefined =>
  fields.canonicalUrl ??
  (fields.kind === 'website'
    ? fields.websiteUrl
    : fields.kind === 'github_repository' || fields.kind === 'gitlab_repository'
      ? fields.repositoryUrl
      : fields.kind === 'docs_site'
        ? fields.docsUrl
        : fields.kind === 'mcp_registry_server'
          ? fields.mcpRegistryUrl
          : fields.kind === 'container_image'
            ? (containerImageCanonicalUrl(fields.registryId) ?? fields.packageUrl)
            : fields.kind === 'go_module'
              ? (goModuleCanonicalUrl(fields.registryId) ?? fields.packageUrl)
              : fields.kind === 'npm_package' ||
                  fields.kind === 'pypi_project' ||
                  fields.kind === 'crates_package' ||
                  fields.kind === 'jsr_package'
                ? fields.packageUrl
                : undefined) ??
  fields.websiteUrl ??
  fields.repositoryUrl ??
  fields.packageUrl ??
  fields.docsUrl ??
  fields.mcpRegistryUrl

export const validateResourceIdentity = (
  input: ResourceIdentityInput | null | undefined,
  legacyWebsite?: string | null,
): ResourceIdentityValidationIssue[] => {
  const issues: ResourceIdentityValidationIssue[] = []
  const kind = toResourceIdentityKind(input?.kind)
  const canonicalUrl = trimOptional(input?.canonicalUrl)
  const registryId = trimOptional(input?.registryId)
  const websiteUrl = trimOptional(input?.websiteUrl) ?? trimOptional(legacyWebsite)
  const canonicalCandidate = resolveCanonicalCandidate({
    kind,
    canonicalUrl,
    registryId,
    websiteUrl,
    repositoryUrl: trimOptional(input?.repositoryUrl),
    docsUrl: trimOptional(input?.docsUrl),
    packageUrl: trimOptional(input?.packageUrl),
    mcpRegistryUrl: trimOptional(input?.mcpRegistryUrl),
  })

  if (kind === 'website') {
    if (!canonicalCandidate) {
      issues.push({
        path: 'resourceIdentity.canonicalUrl',
        message: 'Website identity requires a website URL or canonical URL.',
      })
    }
    return issues
  }

  const primaryInputLabel = RESOURCE_IDENTITY_PRIMARY_INPUT_LABELS[kind]
  if (kind === 'gitlab_repository' && canonicalCandidate && !parseGitlabRepositoryUrl(canonicalCandidate)) {
    issues.push({path: 'resourceIdentity.canonicalUrl', message: 'GitLab identity requires a public https://gitlab.com/namespace/project repository URL.'})
  }
  const requirementSuffix =
    primaryInputLabel === 'canonical URL'
      ? 'a canonical URL'
      : registryBackedKinds.has(kind)
        ? `a ${primaryInputLabel}, registry ID, or canonical URL`
        : `a ${primaryInputLabel} or canonical URL`

  if (!canonicalCandidate && !(registryBackedKinds.has(kind) && registryId)) {
    issues.push({
      path: 'resourceIdentity.canonicalUrl',
      message: `${getResourceIdentityKindLabel(kind)} identity requires ${requirementSuffix}.`,
    })
  }

  if (registryBackedKinds.has(kind) && !registryId && !canonicalCandidate) {
    issues.push({
      path: 'resourceIdentity.registryId',
      message: `${getResourceIdentityKindLabel(kind)} identity requires a registry ID or canonical URL.`,
    })
  }

  if (kind === 'container_image' && parseContainerImageReference(registryId)?.source === 'container_registry' && !getPublicHttpUrl(canonicalCandidate)) {
    issues.push({path: 'resourceIdentity.canonicalUrl', message: 'Generic container image identity requires an authored public canonical or package URL; no registry web page can be inferred.'})
  }

  if (kind === 'container_image' && registryId && !parseContainerImageReference(registryId)) {
    issues.push({
      path: 'resourceIdentity.registryId',
      message:
        'Container image identity requires a valid container image reference such as namespace/name:tag or ghcr.io/owner/name.',
    })
  }

  if (kind === 'go_module' && registryId && !isCanonicalGoModulePath(registryId)) {
    issues.push({
      path: 'resourceIdentity.registryId',
      message:
        'Go module identity requires a canonical Go module path such as github.com/owner/repo or gopkg.in/name.vN, without a version suffix.',
    })
  }

  return issues
}

export const isValidResourceIdentity = (
  input: ResourceIdentityInput | null | undefined,
  legacyWebsite?: string | null,
): boolean => validateResourceIdentity(input, legacyWebsite).length === 0

/**
 * Resolve the public Resource Identity for a Tool.
 * Legacy website-only Tools default to website-first identity.
 */
export const resolveResourceIdentity = (input: {
  resourceIdentity?: ResourceIdentityInput | null
  website?: string | null
}): ResourceIdentity | null => {
  const raw = input.resourceIdentity
  const legacyWebsite = trimOptional(input.website)
  const kind = toResourceIdentityKind(raw?.kind ?? (legacyWebsite ? 'website' : undefined))
  const websiteUrl = trimOptional(raw?.websiteUrl) ?? legacyWebsite
  const repositoryUrl = trimOptional(raw?.repositoryUrl)
  const docsUrl = trimOptional(raw?.docsUrl)
  const packageUrl = trimOptional(raw?.packageUrl)
  const mcpRegistryUrl = trimOptional(raw?.mcpRegistryUrl)
  const registryId = trimOptional(raw?.registryId)

  const canonicalUrl = resolveCanonicalCandidate({
    kind,
    canonicalUrl: trimOptional(raw?.canonicalUrl),
    registryId,
    websiteUrl,
    repositoryUrl,
    docsUrl,
    packageUrl,
    mcpRegistryUrl,
  })

  if (!canonicalUrl) {
    return null
  }

  if (!isValidResourceIdentity({...raw, kind, canonicalUrl, registryId}, legacyWebsite)) {
    return null
  }

  return {
    kind, canonicalUrl,
    ...(registryId ? { registryId } : undefined),
    ...(websiteUrl ? { websiteUrl } : undefined),
    ...(repositoryUrl ? { repositoryUrl } : undefined),
    ...(docsUrl ? { docsUrl } : undefined),
    ...(packageUrl ? { packageUrl } : undefined),
    ...(mcpRegistryUrl ? { mcpRegistryUrl } : undefined)
  }
}

/**
 * Primary external destination for Tracked outbound URL resolution.
 * Prefer affiliate/Dub wrappers at the call site; this returns the identity destination.
 */
export const getResourceIdentityDestinationUrl = (input: {
  resourceIdentity?: ResourceIdentityInput | null
  website?: string | null
}): string | null => resolveResourceIdentity(input)?.canonicalUrl ?? null

export const hasPublicResourceIdentity = (input: {
  resourceIdentity?: ResourceIdentityInput | null
  website?: string | null
}): boolean => resolveResourceIdentity(input) !== null
