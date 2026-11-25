import {hasRuntimeObjectType} from './runtimeValidation.js'
import type {JsonValue} from './jsonValue.js'
import {isValidCatalogTimestamp} from './catalogFreshnessSearch.js'
import {
  MAX_PUBLIC_METADATA_LABEL_LENGTH,
  MAX_PUBLIC_METADATA_NOTE_LENGTH,
  MAX_PUBLIC_METADATA_URL_LENGTH,
  normalizePublicMetadataText,
  normalizePublicMetadataUrl,
} from './publicMetadata.js'

export const SOURCE_REFERENCE_TYPE_VALUES = [
  'official_docs',
  'pricing_page',
  'changelog',
  'repository',
  'package_registry',
  'source_code',
  'official_site',
  'release_api',
  'version_endpoint',
  'review_notes',
  'hands_on_test',
  'vendor_update',
  'correction_report',
  'other',
] as const

export type SourceReferenceType = (typeof SOURCE_REFERENCE_TYPE_VALUES)[number]
export type SourceReferenceVisibility = 'public' | 'private'

export const MAX_PUBLIC_SOURCE_REFERENCES = 50
export const MAX_PUBLIC_SOURCE_REFERENCE_KEY_LENGTH = 160
export const MAX_PUBLIC_SOURCE_REFERENCE_TITLE_LENGTH = MAX_PUBLIC_METADATA_LABEL_LENGTH
export const MAX_PUBLIC_SOURCE_REFERENCE_NOTE_LENGTH = MAX_PUBLIC_METADATA_NOTE_LENGTH
export const MAX_PUBLIC_SOURCE_REFERENCE_URL_LENGTH = MAX_PUBLIC_METADATA_URL_LENGTH

export interface SourceReferenceInput {
  _key?: string
  _type?: 'sourceReference'
  title?: string
  url?: string
  sourceType?: string
  checkedAt?: string
  note?: string
  visibility?: string
  /** Editorial classification; never inferred as a fact from source wording. */
  claimKind?: string
  /** Sources supporting this specific claim, rather than unrelated listing citations. */
  evidenceReferenceKeys?: readonly string[]
}

export interface PublicSourceReference {
  title: string
  url: string
  sourceType: SourceReferenceType
  checkedAt?: string
  note?: string
}

export interface NormalizedPublicSourceReference {
  key?: string
  reference: PublicSourceReference
}

const SOURCE_REFERENCE_TYPE_SET = new Set<string>(SOURCE_REFERENCE_TYPE_VALUES)
export const normalizeSourceReferenceTitle = (value: JsonValue): string | undefined =>
  normalizePublicMetadataText(value, MAX_PUBLIC_SOURCE_REFERENCE_TITLE_LENGTH)

export const isSourceReferenceVisibility = (value: JsonValue): value is SourceReferenceVisibility =>
  value === 'public' || value === 'private'

export const normalizePublicSourceReferenceUrl = (value: JsonValue): string | undefined => {
  return normalizePublicMetadataUrl(value, MAX_PUBLIC_SOURCE_REFERENCE_URL_LENGTH)
}

export const normalizePublicSourceReferenceKey = (value: JsonValue): string | undefined =>
  normalizePublicMetadataText(value, MAX_PUBLIC_SOURCE_REFERENCE_KEY_LENGTH)

export const normalizePublicSourceReference = <Input>(
  value: Input,
): NormalizedPublicSourceReference | undefined => {
  if (!value || !hasRuntimeObjectType(value)) return undefined
  // SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
  const input = value as SourceReferenceInput
  if (input.visibility !== 'public') return undefined

  const title = normalizeSourceReferenceTitle(input.title)
  const url = normalizePublicSourceReferenceUrl(input.url)
  if (!title || !url || !SOURCE_REFERENCE_TYPE_SET.has(input.sourceType ?? '')) {
    return undefined
  }

  const checkedAt = isValidCatalogTimestamp(input.checkedAt) ? input.checkedAt : undefined
  const note = normalizePublicMetadataText(input.note, MAX_PUBLIC_SOURCE_REFERENCE_NOTE_LENGTH)
  const key = normalizePublicSourceReferenceKey(input._key)

  return {
    ...key ? { key } : undefined,
    reference: {
      title, url,
      // SAFETY: The owner parser or adjacent runtime guard establishes each asserted property contract.
      sourceType: input.sourceType as SourceReferenceType,
      ...(checkedAt ? { checkedAt } : undefined),
      ...(note ? { note } : undefined)
    }
}
}

const buildUniquePublicSourceReferenceMapBy = <Input>(
  sourceReferences: readonly Input[] | null | undefined,
  getRawIdentity: (input: SourceReferenceInput) => string | undefined,
  getCandidateIdentity: (candidate: NormalizedPublicSourceReference) => string | undefined,
): ReadonlyMap<string, PublicSourceReference> => {
  const identityCounts = new Map<string, number>()
  const candidates: Array<NormalizedPublicSourceReference | undefined> = []
  const scanLength = Math.min(sourceReferences?.length ?? 0, MAX_PUBLIC_SOURCE_REFERENCES)

  for (let index = 0; index < scanLength; index += 1) {
    const value = sourceReferences?.[index]
    const candidate = normalizePublicSourceReference(value)
    // SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
    const rawIdentity =
      value && hasRuntimeObjectType(value)
        ? getRawIdentity(value as SourceReferenceInput)
        : undefined
    if (rawIdentity) {
      identityCounts.set(rawIdentity, (identityCounts.get(rawIdentity) ?? 0) + 1)
    }
    candidates.push(candidate)
  }

  const referencesByIdentity = new Map<string, PublicSourceReference>()
  for (const candidate of candidates) {
    if (!candidate) continue
    const identity = getCandidateIdentity(candidate)
    if (identity && identityCounts.get(identity) === 1) {
      referencesByIdentity.set(identity, candidate.reference)
    }
  }
  return referencesByIdentity
}

export const buildUniquePublicSourceReferenceMap = <Input>(
  sourceReferences: readonly Input[] | null | undefined,
): ReadonlyMap<string, PublicSourceReference> =>
  buildUniquePublicSourceReferenceMapBy(
    sourceReferences,
    (input) => normalizePublicSourceReferenceKey(input._key),
    (candidate) => candidate.key,
  )

export const buildUniquePublicSourceReferenceUrlMap = <Input>(
  sourceReferences: readonly Input[] | null | undefined,
): ReadonlyMap<string, PublicSourceReference> =>
  buildUniquePublicSourceReferenceMapBy(
    sourceReferences,
    (input) => normalizePublicSourceReferenceUrl(input.url),
    (candidate) => candidate.reference.url,
  )

export const normalizePublicSourceReferences = <Input>(
  sourceReferences: readonly Input[] | null | undefined,
): PublicSourceReference[] => {
  if (!Array.isArray(sourceReferences)) return []

  const references: PublicSourceReference[] = []
  const scanLength = Math.min(sourceReferences.length, MAX_PUBLIC_SOURCE_REFERENCES)
  for (let index = 0; index < scanLength; index += 1) {
    const normalized = normalizePublicSourceReference(sourceReferences[index])
    if (normalized) references.push(normalized.reference)
  }
  return references
}
