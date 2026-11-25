import {isCatalogTimestampAtOrBefore} from './catalogFreshnessSearch.js'
import {
  normalizeContributorAttribution,
  type PublicContributorAttribution,
} from './contributor.js'
import type {JsonValue} from './jsonValue.js'
import {
  MAX_PUBLIC_METADATA_LABEL_LENGTH,
  MAX_PUBLIC_METADATA_NOTE_LENGTH,
  normalizePublicMetadataText,
  normalizePublicMetadataUrl,
} from './publicMetadata.js'
import {
  normalizeRepositoryObservation,
  type PublicRepositoryObservation,
} from './repositoryObservation.js'
import {
  isResourceIdentityKind,
  resolveResourceIdentity,
  type ResourceIdentity,
  type ResourceIdentityInput,
} from './resourceIdentity.js'
import {isRuntimeBoolean, isRuntimeString} from './runtimeValidation.js'
import {
  buildPublishedToolDecisionSupport,
  type PublishedToolDecisionSupport,
  type ToolDecisionSupportSource,
} from './toolDecisionSupport.js'

export const RESOURCE_LINK_KINDS = [
  'official_docs',
  'github_repository',
  'package_registry',
  'changelog',
  'api_docs',
  'openapi_spec',
  'mcp_registry',
  'example',
  'tutorial',
  'pricing',
  'support',
  'status_page',
  'community',
  'other',
] as const

export type ResourceLinkKind = (typeof RESOURCE_LINK_KINDS)[number]

export const RESOURCE_LINK_KIND_LABELS = {
  official_docs: 'Official docs',
  github_repository: 'GitHub repository',
  package_registry: 'Package registry',
  changelog: 'Changelog',
  api_docs: 'API docs',
  openapi_spec: 'OpenAPI spec',
  mcp_registry: 'MCP registry',
  example: 'Example',
  tutorial: 'Tutorial',
  pricing: 'Pricing',
  support: 'Support',
  status_page: 'Status page',
  community: 'Community',
  other: 'Resource',
} satisfies Record<ResourceLinkKind, string>

export interface PublishedToolResourceLinkSource {
  label?: JsonValue
  url?: JsonValue
  kind?: JsonValue
  isOfficial?: JsonValue
  visibility?: JsonValue
  checkedAt?: JsonValue
  note?: JsonValue
}

export interface PublishedToolProfileSource extends ToolDecisionSupportSource {
  verifiedAt?: JsonValue
  verifiedByContributor?: JsonValue
  resourceIdentity?: ResourceIdentityInput | null
  website?: string | null
  resourceLinks?: ReadonlyArray<PublishedToolResourceLinkSource | null> | null
  repositoryObservation?: JsonValue
}

export interface PublishedEditorialVerification {
  verifiedAt: string
  /** Consented public attribution for the vouching contributor, when recorded. */
  verifiedBy?: PublicContributorAttribution
}

export interface PublishedToolResource {
  label: string
  url: string
  kind: ResourceLinkKind
  isOfficial: boolean
  checkedAt?: string
  note?: string
}

export interface PublishedToolProfile {
  editorialVerification: PublishedEditorialVerification | null
  resourceIdentity: ResourceIdentity | null
  /** Cached GitHub repository observation; `never_fetched` while unobserved. */
  repositoryObservation: PublicRepositoryObservation | null
  resources: PublishedToolResource[]
  officialResources: PublishedToolResource[]
  sameAsUrls: string[]
  decisionSupport: PublishedToolDecisionSupport
}

const RESOURCE_LINK_KIND_SET = new Set<string>(RESOURCE_LINK_KINDS)

export const isResourceLinkKind = (value: JsonValue): value is ResourceLinkKind =>
  isRuntimeString(value) && RESOURCE_LINK_KIND_SET.has(value)

export const isPublishedEditorialVerificationTimestamp = (
  value: JsonValue,
  now: Date = new Date(),
): value is string => isCatalogTimestampAtOrBefore(value, now)

const normalizeResourceLink = (
  source: PublishedToolResourceLinkSource | null,
  now: Date,
): PublishedToolResource | null => {
  if (!source || source.visibility !== 'public') return null

  const label = normalizePublicMetadataText(source.label, MAX_PUBLIC_METADATA_LABEL_LENGTH)
  const url = normalizePublicMetadataUrl(source.url)
  if (!label || !url || !isResourceLinkKind(source.kind)) return null

  const checkedAt = isCatalogTimestampAtOrBefore(source.checkedAt, now)
    ? source.checkedAt
    : undefined
  const note = normalizePublicMetadataText(source.note, MAX_PUBLIC_METADATA_NOTE_LENGTH)

  return {
    label,
    url,
    kind: source.kind,
    isOfficial: isRuntimeBoolean(source.isOfficial) && source.isOfficial,
    ...(checkedAt ? {checkedAt} : undefined),
    ...(note ? {note} : undefined),
  }
}

const resourceProvenanceTime = (resource: PublishedToolResource): number => {
  if (!resource.checkedAt) return Number.NEGATIVE_INFINITY
  const time = Date.parse(resource.checkedAt)
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY
}

const compareDuplicateResourceProvenance = (
  left: PublishedToolResource,
  right: PublishedToolResource,
): number => {
  const timeDelta = resourceProvenanceTime(left) - resourceProvenanceTime(right)
  if (timeDelta !== 0) return timeDelta
  if (left.isOfficial !== right.isOfficial) return left.isOfficial ? 1 : -1
  return left.label.localeCompare(right.label)
}

const mergeDuplicatePublishedResources = (
  matches: readonly PublishedToolResource[],
): PublishedToolResource[] => {
  const newest = matches.reduce<PublishedToolResource | undefined>(
    (winner, candidate) =>
      !winner || compareDuplicateResourceProvenance(winner, candidate) < 0
        ? candidate
        : winner,
    undefined,
  )
  if (!newest) return []

  const hasConsistentOfficialIdentity = matches.every(
    (match) => match.isOfficial && match.kind === newest.kind,
  )
  return [{...newest, isOfficial: hasConsistentOfficialIdentity}]
}

const normalizeResourceIdentity = (source: PublishedToolProfileSource): ResourceIdentity | null => {
  const explicitKind = source.resourceIdentity?.kind
  if (explicitKind !== undefined && !isResourceIdentityKind(explicitKind)) return null

  const identity = resolveResourceIdentity({
    resourceIdentity: source.resourceIdentity,
    website: source.website,
  })
  if (!identity) return null

  const canonicalUrl = normalizePublicMetadataUrl(identity.canonicalUrl)
  if (!canonicalUrl) return null

  const websiteUrl = normalizePublicMetadataUrl(identity.websiteUrl)
  const repositoryUrl = normalizePublicMetadataUrl(identity.repositoryUrl)
  const docsUrl = normalizePublicMetadataUrl(identity.docsUrl)
  const packageUrl = normalizePublicMetadataUrl(identity.packageUrl)
  const mcpRegistryUrl = normalizePublicMetadataUrl(identity.mcpRegistryUrl)
  const registryId = normalizePublicMetadataText(
    identity.registryId,
    MAX_PUBLIC_METADATA_LABEL_LENGTH,
  )

  return {
    kind: identity.kind,
    canonicalUrl,
    ...(registryId ? {registryId} : undefined),
    ...(websiteUrl ? {websiteUrl} : undefined),
    ...(repositoryUrl ? {repositoryUrl} : undefined),
    ...(docsUrl ? {docsUrl} : undefined),
    ...(packageUrl ? {packageUrl} : undefined),
    ...(mcpRegistryUrl ? {mcpRegistryUrl} : undefined),
  }
}

export const buildPublishedToolProfile = (
  source: PublishedToolProfileSource,
  now: Date = new Date(),
): PublishedToolProfile => {
  const candidates = (source.resourceLinks ?? []).map((resourceLink) =>
    normalizeResourceLink(resourceLink, now),
  )
  const candidatesByUrl = new Map<string, PublishedToolResource[]>()
  for (const candidate of candidates) {
    if (candidate) {
      const matches = candidatesByUrl.get(candidate.url) ?? []
      matches.push(candidate)
      candidatesByUrl.set(candidate.url, matches)
    }
  }

  const resources = [...candidatesByUrl.values()].flatMap((matches) =>
    mergeDuplicatePublishedResources(matches),
  )
  const officialResources = resources.filter((resource) => resource.isOfficial)
  const resourceIdentity = normalizeResourceIdentity(source)
  const repositoryObservation = normalizeRepositoryObservation(source.repositoryObservation)
  const repositorySource = resourceIdentity?.kind === 'gitlab_repository' ? 'gitlab' : 'github'
  const verifiedBy = normalizeContributorAttribution(source.verifiedByContributor)
  const sameAsUrls = [
    resourceIdentity?.canonicalUrl,
    resourceIdentity?.repositoryUrl,
    resourceIdentity?.packageUrl,
    resourceIdentity?.docsUrl,
    resourceIdentity?.mcpRegistryUrl,
    resourceIdentity?.websiteUrl,
  ].filter((value): value is string => Boolean(value))

  return {
    editorialVerification: isPublishedEditorialVerificationTimestamp(source.verifiedAt, now)
      ? {verifiedAt: source.verifiedAt, ...(verifiedBy ? {verifiedBy} : undefined)}
      : null,
    resourceIdentity,
    repositoryObservation:
      resourceIdentity?.kind === 'github_repository' || resourceIdentity?.kind === 'gitlab_repository'
        ? (repositoryObservation && (repositoryObservation.source ?? 'github') === repositorySource ? repositoryObservation : {
            status: 'never_fetched' as const,
          })
        : null,
    resources,
    officialResources,
    sameAsUrls: [...new Set(sameAsUrls)],
    decisionSupport: buildPublishedToolDecisionSupport(source, now),
  }
}
