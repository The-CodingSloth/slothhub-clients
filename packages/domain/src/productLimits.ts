import {hasRuntimeObjectType} from './runtimeValidation.js'
import {isValidCatalogTimestamp} from './catalogFreshnessSearch.js'
import {
  buildUniquePublicSourceReferenceMap,
  type PublicSourceReference,
  type SourceReferenceInput,
  type SourceReferenceType,
} from './sourceReference.js'
import {
  normalizeOptionalPublicText,
  normalizePublicText,
  resolveSourceBackedEvidence,
  type SourceBackedEvidence,
} from './sourceBackedFact.js'

export const PRODUCT_LIMIT_STATE_VALUES = [
  'bounded',
  'unlimited_claimed',
  'not_disclosed',
  'unknown',
] as const
export const PRODUCT_LIMIT_COMPARATOR_VALUES = [
  'less_than',
  'at_most',
  'exactly',
  'at_least',
  'greater_than',
] as const
export const PRODUCT_LIMIT_BASIS_VALUES = ['documented_limit', 'observed_envelope'] as const
export const PRODUCT_LIMIT_VENDOR_CLAIM_SOURCE_VALUES = [
  'official_docs',
  'pricing_page',
  'changelog',
  'vendor_update',
] as const satisfies readonly SourceReferenceType[]

export type ProductLimitState = (typeof PRODUCT_LIMIT_STATE_VALUES)[number]
export type ProductLimitComparator = (typeof PRODUCT_LIMIT_COMPARATOR_VALUES)[number]
export type ProductLimitBasis = (typeof PRODUCT_LIMIT_BASIS_VALUES)[number]

// Eight recorded plans × Cypress’s three distinct metrics; see
// upstream docs/measurements/plan-pricing-capacity-2026-11-05.md.
export const PRODUCT_LIMIT_MAX_FACTS = 24
export const PRODUCT_LIMIT_MAX_EVIDENCE = 3
export const PRODUCT_LIMIT_MAX_METRIC_LENGTH = 120
export const PRODUCT_LIMIT_MAX_SCOPE_LENGTH = 120
export const PRODUCT_LIMIT_MAX_UNIT_LENGTH = 80
export const PRODUCT_LIMIT_MAX_NOTE_LENGTH = 300

export interface ProductLimitInput {
  _key?: string
  metric?: string
  planScope?: string
  deploymentScope?: string
  basis?: string
  state?: string
  comparator?: string
  value?: number
  unit?: string
  note?: string
  evidenceReferenceKeys?: string[]
  reviewedAt?: string
}

export type ProductLimitEvidence = SourceBackedEvidence

interface PublicProductLimitBase {
  state: ProductLimitState
  note?: string
  evidence: ProductLimitEvidence[]
  reviewedAt?: string
}

export interface PublicBoundedProductLimit extends PublicProductLimitBase {
  state: 'bounded'
  comparator: ProductLimitComparator
  value: number
  unit: string
  reviewedAt: string
}

export interface PublicUnlimitedClaimedProductLimit extends PublicProductLimitBase {
  state: 'unlimited_claimed'
  reviewedAt: string
}

export interface PublicNonNumericProductLimit extends PublicProductLimitBase {
  state: 'not_disclosed' | 'unknown'
}

export type PublicProductLimitVariant =
  | PublicBoundedProductLimit
  | PublicUnlimitedClaimedProductLimit
  | PublicNonNumericProductLimit

export interface PublicProductLimitGroup {
  metric: string
  planScope?: string
  deploymentScope?: string
  basis?: ProductLimitBasis
  ambiguous: boolean
  facts: PublicProductLimitVariant[]
}

const STATE_SET = new Set<string>(PRODUCT_LIMIT_STATE_VALUES)
const COMPARATOR_SET = new Set<string>(PRODUCT_LIMIT_COMPARATOR_VALUES)
const BASIS_SET = new Set<string>(PRODUCT_LIMIT_BASIS_VALUES)
const VENDOR_CLAIM_SOURCE_SET = new Set<string>(PRODUCT_LIMIT_VENDOR_CLAIM_SOURCE_VALUES)

const buildDuplicateKey = (
  metric: string,
  planScope: string | undefined,
  deploymentScope: string | undefined,
  basis: ProductLimitBasis | undefined,
): string =>
  JSON.stringify(
    [metric, planScope ?? '', deploymentScope ?? '', basis ?? ''].map((part) =>
      part.normalize('NFKC').toLocaleLowerCase('en-US'),
    ),
  )

// SAFETY: The preceding parser or closed-vocabulary check establishes this primitive value.
const normalizeFact = (
  input: ProductLimitInput,
  references: ReadonlyMap<string, PublicSourceReference>,
):
  | {
      key: string
      metric: string
      planScope?: string
      deploymentScope?: string
      basis?: ProductLimitBasis
      fact: PublicProductLimitVariant
    }
  | undefined => {
  const metric = normalizePublicText(input.metric, PRODUCT_LIMIT_MAX_METRIC_LENGTH)
  const planScope = normalizeOptionalPublicText(input.planScope, PRODUCT_LIMIT_MAX_SCOPE_LENGTH)
  const deploymentScope = normalizeOptionalPublicText(
    input.deploymentScope,
    PRODUCT_LIMIT_MAX_SCOPE_LENGTH,
  )
  const note = normalizeOptionalPublicText(input.note, PRODUCT_LIMIT_MAX_NOTE_LENGTH)
  if (
    !metric ||
    planScope === null ||
    deploymentScope === null ||
    note === null ||
    !STATE_SET.has(input.state ?? '')
  ) {
    return undefined
  }

  // SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
  const state = input.state as ProductLimitState
  // SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
  const basis = BASIS_SET.has(input.basis ?? '')
    ? (input.basis as ProductLimitBasis)
    : undefined
  const isNonAssertive = state === 'not_disclosed' || state === 'unknown'
  if (isNonAssertive) {
    if (input.basis !== undefined) return undefined
  } else if (!basis) {
    return undefined
  }
  if (basis === 'observed_envelope' && state !== 'bounded') return undefined
  const key = buildDuplicateKey(metric, planScope, deploymentScope, basis)
  const base = {
    ...(note ? { note } : undefined)
  }

  if (state === 'bounded') {
    const unit = normalizePublicText(input.unit, PRODUCT_LIMIT_MAX_UNIT_LENGTH)
    const evidence = resolveSourceBackedEvidence(input.evidenceReferenceKeys, references, PRODUCT_LIMIT_MAX_EVIDENCE)
    if (
      !Number.isFinite(input.value) ||
      (input.value as number) < 0 ||
      Math.abs(input.value as number) > Number.MAX_SAFE_INTEGER ||
      !unit ||
      !COMPARATOR_SET.has(input.comparator ?? '') ||
      !evidence ||
      (basis === 'observed_envelope' &&
        !evidence.some((reference) => reference.sourceType === 'hands_on_test')) ||
      !isValidCatalogTimestamp(input.reviewedAt)
    ) {
      return undefined
    }
    return {
      key, metric,
      ...(planScope ? { planScope } : undefined),
      ...(deploymentScope ? { deploymentScope } : undefined),
      ...(basis ? { basis } : undefined),
      // SAFETY: The owner parser or adjacent runtime guard establishes each asserted property contract.
      fact: {
        ...base,
        state,
        comparator: input.comparator as ProductLimitComparator,
        value: input.value as number,
        unit,
        evidence,
        reviewedAt: input.reviewedAt as string,
      }
    }
  }

  if (
    input.value !== undefined ||
    input.comparator !== undefined ||
    normalizeOptionalPublicText(input.unit, PRODUCT_LIMIT_MAX_UNIT_LENGTH) !== undefined
  ) {
    return undefined
  }

  if (state === 'unlimited_claimed') {
    const evidence = resolveSourceBackedEvidence(input.evidenceReferenceKeys, references, PRODUCT_LIMIT_MAX_EVIDENCE)
    if (
      !evidence ||
      !evidence.some((reference) => VENDOR_CLAIM_SOURCE_SET.has(reference.sourceType)) ||
      !isValidCatalogTimestamp(input.reviewedAt)
    ) {
      return undefined
    }
    return {
      key, metric,
      ...(planScope ? { planScope } : undefined),
      ...(deploymentScope ? { deploymentScope } : undefined),
      ...(basis ? { basis } : undefined),
      // SAFETY: The owner parser or adjacent runtime guard establishes each asserted property contract.
      fact: {
        ...base,
        state,
        evidence,
        reviewedAt: input.reviewedAt as string,
      }
    }
  }

  if ((input.evidenceReferenceKeys?.length ?? 0) > 0 || input.reviewedAt !== undefined) {
    return undefined
  }
  return (() => {
           const evidence = new Array<SourceBackedEvidence>();
           return {
             key, metric,
             ...(planScope ? { planScope } : undefined),
             ...(deploymentScope ? { deploymentScope } : undefined),
             fact: { ...base, state, evidence }
           };
         })()
}

const variantIdentity = (fact: PublicProductLimitVariant): string =>
  JSON.stringify({
    state: fact.state,
    ...('comparator' in fact ? { comparator: fact.comparator } : undefined),
    ...('value' in fact ? { value: fact.value } : undefined),
    ...('unit' in fact ? { unit: fact.unit } : undefined)
  })

const exactVariantIdentity = (fact: PublicProductLimitVariant): string =>
  JSON.stringify({
    claim: variantIdentity(fact),
    note: fact.note,
    evidence: fact.evidence.map((reference) => reference.url).sort(),
    reviewedAt: fact.reviewedAt,
  })

interface ProductLimitReconstruction {
  value: PublicProductLimitGroup[]
  error?: string
}

const reconstructProductLimits = <Input>(
  limits: readonly Input[] | null | undefined,
  sourceReferences: readonly SourceReferenceInput[] | null | undefined,
): ProductLimitReconstruction => {
  if (!Array.isArray(limits)) {
    return limits == null
      ? {value: []}
      : {value: [], error: 'Product limits must be an array.'}
  }

  const references = buildUniquePublicSourceReferenceMap(sourceReferences)
  const groups = new Map<string, PublicProductLimitGroup>()
  const exactIdentitiesByKey = new Map<string, Set<string>>()
  const evidenceByClaim = new Map<string, Set<string>>()
  const noteByClaim = new Map<string, string | undefined>()
  let error = limits.length > PRODUCT_LIMIT_MAX_FACTS
    ? `Product limit fact count exceeded: limit_facts=${PRODUCT_LIMIT_MAX_FACTS}, actual_facts=${limits.length}. Consolidate duplicate facts or request a capacity review for the documented plan and metric workload.`
    : undefined

  const captureError = (message: string) => {
    error ??= message
  }

  for (let index = 0; index < Math.min(limits.length, PRODUCT_LIMIT_MAX_FACTS); index += 1) {
    const value: Input | undefined = limits[index]
    // SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
    const normalized: ReturnType<typeof normalizeFact> = value && hasRuntimeObjectType(value)
      ? normalizeFact(value as ProductLimitInput, references)
      : undefined
    if (!normalized) {
      captureError(
        `Product limit ${index + 1} is invalid or does not resolve exclusively to checked public sources.`,
      )
      continue
    }

    const identity = variantIdentity(normalized.fact)
    const exactIdentity = exactVariantIdentity(normalized.fact)
    const exactIdentities = exactIdentitiesByKey.get(normalized.key) ?? new Set<string>()
    if (exactIdentities.has(exactIdentity)) {
      captureError(`Product limit ${index + 1} exactly duplicates an earlier fact.`)
    } else {
      exactIdentities.add(exactIdentity)
      exactIdentitiesByKey.set(normalized.key, exactIdentities)
    }

    const claimKey = `${normalized.key}\u0000${identity}`
    if (noteByClaim.has(claimKey) && noteByClaim.get(claimKey) !== normalized.fact.note) {
      captureError(
        `Product limit ${index + 1} repeats an earlier assertion with a different note. Consolidate the note and evidence into one fact.`,
      )
    } else {
      noteByClaim.set(claimKey, normalized.fact.note)
    }
    const evidence = evidenceByClaim.get(claimKey) ?? new Set<string>()
    for (const reference of normalized.fact.evidence) evidence.add(reference.url)
    if (evidence.size > PRODUCT_LIMIT_MAX_EVIDENCE) {
      captureError(
        `Product limit ${index + 1} gives one assertion more than ${PRODUCT_LIMIT_MAX_EVIDENCE} evidence sources. Consolidate them into one fact.`,
      )
    }
    evidenceByClaim.set(claimKey, evidence)

    const existing = groups.get(normalized.key)
    if (existing) {
      const corroborated = existing.facts.find(
        (fact) => variantIdentity(fact) === identity,
      )
      if (corroborated) {
        const evidenceByUrl = new Map(
          corroborated.evidence.map((reference) => [reference.url, reference]),
        )
        for (const reference of normalized.fact.evidence) {
          if (evidenceByUrl.size >= PRODUCT_LIMIT_MAX_EVIDENCE) break
          evidenceByUrl.set(reference.url, reference)
        }
        corroborated.evidence = [...evidenceByUrl.values()]
        if (
          normalized.fact.reviewedAt &&
          (!corroborated.reviewedAt ||
            Date.parse(normalized.fact.reviewedAt) >
              Date.parse(corroborated.reviewedAt))
        ) {
          corroborated.reviewedAt = normalized.fact.reviewedAt
        }
        continue
      }
      existing.facts.push(normalized.fact)
      existing.ambiguous = true
    } else {
      const baseGroup = {
        metric: normalized.metric,
        ambiguous: false,
        facts: [normalized.fact],
      } satisfies PublicProductLimitGroup
      const group: PublicProductLimitGroup = baseGroup
      if (normalized.planScope) group.planScope = normalized.planScope
      if (normalized.deploymentScope) group.deploymentScope = normalized.deploymentScope
      if (normalized.basis) group.basis = normalized.basis
      groups.set(normalized.key, group)
    }
  }

  return {
    value: [...groups.values()],
    ...(error ? { error } : undefined)
  }
}

export const normalizePublicProductLimits = <Input>(
  limits: readonly Input[] | null | undefined,
  sourceReferences: readonly SourceReferenceInput[] | null | undefined,
): PublicProductLimitGroup[] => reconstructProductLimits(limits, sourceReferences).value

export const validateProductLimits = (
  limits: readonly ProductLimitInput[] | null | undefined,
  sourceReferences: readonly SourceReferenceInput[] | null | undefined,
): true | string => {
  const reconstruction = reconstructProductLimits(limits, sourceReferences)
  return reconstruction.error ?? true
}
