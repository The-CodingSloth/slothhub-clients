import {isRuntimeString} from './runtimeValidation.js'
import type {JsonValue} from './jsonValue.js'
import {
  MAX_PUBLIC_SOURCE_REFERENCES,
  normalizePublicSourceReference,
  type PublicSourceReference,
  type SourceReferenceInput,
} from './sourceReference.js'

export const MAX_EDITORIAL_SOURCE_REFERENCES = 3
export const EDITORIAL_EVIDENCE_EXEMPTION = 'descriptive_role_only' as const

export type EditorialEvidenceExemption = typeof EDITORIAL_EVIDENCE_EXEMPTION

export type EditorialEvidenceItem = {
  description?: string
  editorialBlurb?: string
  evidenceExemption?: string
  role?: string
  sourceReferences?: readonly SourceReferenceInput[]
  tool?: {_ref?: string}
}

export type PublicEditorialDocument = {
  publishedAt?: string
  seo?: {noIndex?: boolean}
}

export type EditorialEvidenceDocument<TItem extends EditorialEvidenceItem> =
  PublicEditorialDocument & {
    rankedTools?: readonly TItem[]
    tools?: readonly TItem[]
  }

export type EditorialEvidenceValidationOptions = {
  publicToolReferenceStatus?: Readonly<Record<string, boolean>>
  toolDescriptionByReferenceId?: Readonly<Record<string, string | undefined>>
}

const hasText = (value: JsonValue): value is string =>
  isRuntimeString(value) && value.trim().length > 0

export const isPublicEditorialDocument = (document: PublicEditorialDocument): boolean =>
  hasText(document.publishedAt) && document.seo?.noIndex !== true

/** Publication readiness applies before the server assigns a publication date. */
export const isEditorialPublicationCandidate = (document: PublicEditorialDocument): boolean =>
  document.seo?.noIndex !== true

const isTrackedOutboundPath = (url: URL): boolean => {
  let pathname = url.pathname
  let fullyDecoded = false
  try {
    for (let pass = 0; pass < 3; pass += 1) {
      const decoded = decodeURIComponent(pathname)
      if (decoded === pathname) {
        fullyDecoded = true
        break
      }
      pathname = decoded
    }
  } catch {
    return true
  }

  if (!fullyDecoded && /%(?:25|2f|5c)/iu.test(pathname)) return true

  const pathSegments: string[] = []
  for (const segment of pathname.replaceAll('\\', '/').split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      pathSegments.pop()
      continue
    }
    pathSegments.push(segment)
  }

  const normalized = `/${pathSegments.join('/')}`.toLowerCase()
  return normalized === '/go' || normalized.startsWith('/go/')
}

const getSourceIdentity = (source: PublicSourceReference): string =>
  JSON.stringify([
    source.title,
    source.url,
    source.sourceType,
    source.checkedAt ?? '',
    source.note ?? '',
  ])

export const normalizeEditorialSourceReferences = <Input>(
  sourceReferences: readonly Input[] | null | undefined,
): PublicSourceReference[] => {
  if (!Array.isArray(sourceReferences)) return []

  const normalizedSources: PublicSourceReference[] = []
  const identities = new Set<string>()
  const scanLength = Math.min(sourceReferences.length, MAX_PUBLIC_SOURCE_REFERENCES)

  for (
    let index = 0;
    index < scanLength && normalizedSources.length < MAX_EDITORIAL_SOURCE_REFERENCES;
    index += 1
  ) {
    const candidate = sourceReferences[index]
    const normalized = normalizePublicSourceReference(candidate)?.reference
    if (!normalized) continue

    const url = new URL(normalized.url)
    if (url.protocol !== 'https:' || isTrackedOutboundPath(url)) continue

    const identity = getSourceIdentity(normalized)
    if (identities.has(identity)) continue
    identities.add(identity)
    normalizedSources.push(normalized)
  }

  return normalizedSources
}

const UNSUPPORTED_FIRST_PARTY_TEST_CLAIM =
  /\b(?:we|our (?:team|editors?))(?:(?:['’]ve)|\s+(?:have|has))?\s+(?:tested|tried|used)\b/iu

const UNSUPPORTED_FIRST_PARTY_HANDS_ON_CLAIM =
  /\b(?:our(?:\s+(?:team|editors?)(?:['’]s?)?)?(?:\s+(?:has|have))?|we(?:(?:['’]ve)|\s+have)?(?:\s+(?:went|got))?)\s+hands[- ]on\b/iu

export const containsUnsupportedHandsOnClaim = (value: JsonValue): boolean =>
  hasText(value) &&
  (UNSUPPORTED_FIRST_PARTY_TEST_CLAIM.test(value) ||
    UNSUPPORTED_FIRST_PARTY_HANDS_ON_CLAIM.test(value))

const hasPublicEvidence = (item: EditorialEvidenceItem): boolean =>
  normalizeEditorialSourceReferences(item.sourceReferences).length > 0

const getToolReferenceId = (item: EditorialEvidenceItem): string | undefined => {
  const referenceId = item.tool?._ref
  return hasText(referenceId) ? referenceId : undefined
}

const isPublicEditorialItem = (
  item: EditorialEvidenceItem,
  options: EditorialEvidenceValidationOptions,
): boolean => {
  if (!options.publicToolReferenceStatus) return true
  const referenceId = getToolReferenceId(item)
  return Boolean(referenceId && options.publicToolReferenceStatus[referenceId])
}

const getPublicEditorialItems = <TItem extends EditorialEvidenceItem>(
  items: readonly TItem[] | undefined,
  options: EditorialEvidenceValidationOptions,
): TItem[] => (items ?? []).filter((item) => isPublicEditorialItem(item, options))

export const validateCuratedListEvidenceReadiness = (
  document: EditorialEvidenceDocument<EditorialEvidenceItem>,
  options: EditorialEvidenceValidationOptions = {},
): true | string => {
  if (!isEditorialPublicationCandidate(document)) return true

  const rankedTools = getPublicEditorialItems(document.rankedTools, options)
  if (rankedTools.some((item) => !hasPublicEvidence(item))) {
    return 'Every published Best-of entry should include one to three public HTTPS Source References.'
  }
  return true
}

export const validateCuratedListHandsOnClaims = (
  document: EditorialEvidenceDocument<EditorialEvidenceItem>,
  options: EditorialEvidenceValidationOptions = {},
): true | string => {
  if (!isEditorialPublicationCandidate(document)) return true
  return getPublicEditorialItems(document.rankedTools, options).some((item) => {
    if (hasText(item.editorialBlurb)) {
      return containsUnsupportedHandsOnClaim(item.editorialBlurb)
    }
    const referenceId = getToolReferenceId(item)
    return containsUnsupportedHandsOnClaim(
      referenceId ? options.toolDescriptionByReferenceId?.[referenceId] : undefined,
    )
  })
    ? 'Remove first-party hands-on wording until completed public Evaluation Records are available.'
    : true
}

export const validateToolStackEvidenceReadiness = (
  document: EditorialEvidenceDocument<EditorialEvidenceItem>,
  options: EditorialEvidenceValidationOptions = {},
): true | string => {
  if (!isEditorialPublicationCandidate(document)) return true

  for (const item of getPublicEditorialItems(document.tools, options)) {
    const hasDescription = hasText(item.description)
    const isExempt = item.evidenceExemption === EDITORIAL_EVIDENCE_EXEMPTION

    if (hasDescription && isExempt) {
      return 'The descriptive-role evidence exemption only applies to role-only items without an evaluative description.'
    }
    if (!hasDescription && !isExempt) {
      return 'Add evidence and a recommendation description, or mark it as a descriptive role-only item.'
    }
    if (hasDescription && !hasPublicEvidence(item)) {
      return 'Every evaluative Tool Stack entry should include one to three public HTTPS Source References.'
    }
  }
  return true
}

export const validateToolStackHandsOnClaims = (
  document: EditorialEvidenceDocument<EditorialEvidenceItem>,
  options: EditorialEvidenceValidationOptions = {},
): true | string => {
  if (!isEditorialPublicationCandidate(document)) return true
  return getPublicEditorialItems(document.tools, options).some((item) => {
    if (item.evidenceExemption === EDITORIAL_EVIDENCE_EXEMPTION) return false
    if (hasText(item.description)) return containsUnsupportedHandsOnClaim(item.description)
    const referenceId = getToolReferenceId(item)
    return containsUnsupportedHandsOnClaim(
      referenceId ? options.toolDescriptionByReferenceId?.[referenceId] : undefined,
    )
  })
    ? 'Remove first-party hands-on wording until completed public Evaluation Records are available.'
    : true
}
