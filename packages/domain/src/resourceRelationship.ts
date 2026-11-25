import type {JsonValue} from './jsonValue.js'
import {isSafePublicText} from './publicText.js'
import {resolveResourceIdentity, type ResourceIdentityInput} from './resourceIdentity.js'
import {getResourceKindLabel, toResourceKind, type ResourceKind} from './resourceKind.js'
import {isRuntimeString} from './runtimeValidation.js'
import {normalizePublicSourceReferenceUrl} from './sourceReference.js'
import {isValidToolPublicSlug} from './toolLookup.js'

export const RESOURCE_RELATIONSHIP_KIND_VALUES = [
  'docs_for',
  'package_for',
  'source_repository_for',
  'mcp_server_for',
  'complements',
] as const

export type ResourceRelationshipKind = (typeof RESOURCE_RELATIONSHIP_KIND_VALUES)[number]
export const RESOURCE_RELATIONSHIP_DIRECTION_VALUES = ['outgoing', 'incoming'] as const
export type ResourceRelationshipDirection = (typeof RESOURCE_RELATIONSHIP_DIRECTION_VALUES)[number]

export interface ResourceRelationshipKindOption {
  title: string
  value: ResourceRelationshipKind
}

export const RESOURCE_RELATIONSHIP_KIND_OPTIONS: ResourceRelationshipKindOption[] = [
  {title: 'Documentation for', value: 'docs_for'},
  {title: 'Package for', value: 'package_for'},
  {title: 'Source repository for', value: 'source_repository_for'},
  {title: 'MCP server for', value: 'mcp_server_for'},
  {title: 'Complements', value: 'complements'},
]

const RESOURCE_RELATIONSHIP_LABELS = {
  docs_for: {outgoing: 'Documentation for', incoming: 'Documentation'},
  package_for: {outgoing: 'Package for', incoming: 'Package'},
  source_repository_for: {
    outgoing: 'Source repository for',
    incoming: 'Source repository',
  },
  mcp_server_for: {outgoing: 'MCP server for', incoming: 'MCP server'},
  complements: {outgoing: 'Complements', incoming: 'Complements'},
} satisfies Record<ResourceRelationshipKind, Record<ResourceRelationshipDirection, string>>

export interface ResourceRelationshipReferenceInput {
  _ref?: string | null
}

export interface ResourceRelationshipEditorInput {
  _id?: string
  _type?: string
  kind?: JsonValue
  subject?: ResourceRelationshipReferenceInput | null
  target?: ResourceRelationshipReferenceInput | null
}

export interface PublicResourceRelationshipTargetInput {
  id?: string | null
  name?: string | null
  slug?: string | null
  website?: string | null
  resourceIdentity?: ResourceIdentityInput | null
  resourceKind?: JsonValue
}

export interface PublicResourceRelationshipInput {
  kind?: JsonValue
  direction?: JsonValue
  target?: PublicResourceRelationshipTargetInput | null
  evidenceUrl?: string | null
}

export interface PublicResourceRelationshipTarget {
  id: string
  name: string
  slug: string
  canonicalUrl: string
  resourceKind: {value: ResourceKind; label: string}
}

export interface PublicResourceRelationship {
  kind: ResourceRelationshipKind
  direction: ResourceRelationshipDirection
  label: string
  target: PublicResourceRelationshipTarget
  evidenceUrl?: string
}

const isResourceRelationshipKind = (value: JsonValue): value is ResourceRelationshipKind =>
  isRuntimeString(value) &&
  RESOURCE_RELATIONSHIP_KIND_VALUES.some((kind) => kind === value)

const isResourceRelationshipDirection = (
  value: JsonValue,
): value is ResourceRelationshipDirection => value === 'outgoing' || value === 'incoming'

const normalizeText = (value: string | null | undefined): string | undefined => {
  if (!isRuntimeString(value)) return undefined
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > 0 ? normalized : undefined
}

const canonicalSanityId = (value: string): string => value.replace(/^drafts\./, '')

export const getResourceRelationshipLabel = (
  kind: ResourceRelationshipKind,
  direction: ResourceRelationshipDirection,
): string => RESOURCE_RELATIONSHIP_LABELS[kind][direction]

export const validateResourceRelationship = (
  value: ResourceRelationshipEditorInput | null | undefined,
): true | string => {
  const subjectId = normalizeText(value?.subject?._ref)
  const targetId = normalizeText(value?.target?._ref)

  if (!subjectId) return 'Choose the subject resource.'
  if (!targetId) return 'Choose the target resource.'
  if (!isResourceRelationshipKind(value?.kind)) {
    return 'Choose a supported Resource Relationship kind.'
  }

  if (
    canonicalSanityId(subjectId) === canonicalSanityId(targetId)
  ) {
    return 'A resource cannot relate to itself.'
  }

  return true
}

export const normalizePublicResourceRelationships = (
  relationships: PublicResourceRelationshipInput[] | null | undefined,
  sourceId: string,
): PublicResourceRelationship[] => {
  const normalized: PublicResourceRelationship[] = []
  const seen = new Set<string>()
  const canonicalSourceId = canonicalSanityId(sourceId)

  for (const relationship of relationships ?? []) {
    const target = relationship.target
    const id = normalizeText(target?.id)
    const name = normalizeText(target?.name)
    const slug = normalizeText(target?.slug)
    const identity = resolveResourceIdentity({
      resourceIdentity: target?.resourceIdentity,
      website: target?.website,
    })
    const canonicalUrl = normalizePublicSourceReferenceUrl(identity?.canonicalUrl)

    if (
      !isResourceRelationshipKind(relationship.kind) ||
      !isResourceRelationshipDirection(relationship.direction) ||
      !id ||
      id.startsWith('drafts.') ||
      !name ||
      !isSafePublicText(name) ||
      !isValidToolPublicSlug(slug) ||
      !canonicalUrl ||
      canonicalSanityId(id) === canonicalSourceId
    ) {
      continue
    }

    const deduplicationDirection = relationship.kind === 'complements' ? 'reciprocal' : relationship.direction
    const deduplicationKey = `${relationship.kind}:${deduplicationDirection}:${canonicalSanityId(id)}`
    if (seen.has(deduplicationKey)) continue
    seen.add(deduplicationKey)

    const resourceKind = toResourceKind(target?.resourceKind)
    const evidenceUrl = normalizePublicSourceReferenceUrl(relationship.evidenceUrl)

    normalized.push({
      kind: relationship.kind,
      direction: relationship.direction,
      label: getResourceRelationshipLabel(relationship.kind, relationship.direction),
      target: {
        id,
        name,
        slug,
        canonicalUrl,
        resourceKind: {value: resourceKind, label: getResourceKindLabel(resourceKind)},
      },
      ...(evidenceUrl ? {evidenceUrl} : undefined),
    })
  }

  return normalized
}
