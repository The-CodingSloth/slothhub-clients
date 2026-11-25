import {z} from 'zod'
import type {JsonValue} from './jsonValue.js'
import {hasRuntimeObjectType, isRuntimeString} from './runtimeValidation.js'
import {isValidCatalogTimestamp} from './catalogFreshnessSearch.js'
import {
  buildUniquePublicSourceReferenceMap,
  type SourceReferenceInput,
} from './sourceReference.js'
import {
  normalizeOptionalPublicText,
  resolveSourceBackedEvidence,
  type SourceBackedEvidence,
} from './sourceBackedFact.js'

export const TOOL_TRIAL_ELIGIBILITY_VALUES = [
  'open',
  'eligibility_limited',
  'sales_assisted',
] as const
export const TOOL_TRIAL_CARD_REQUIREMENT_VALUES = [
  'required',
  'not_required',
  'unknown',
] as const
export const TOOL_TRIAL_END_BEHAVIOR_VALUES = [
  'converts_to_paid',
  'reverts_to_free',
  'access_ends',
] as const

export type ToolTrialEligibility = (typeof TOOL_TRIAL_ELIGIBILITY_VALUES)[number]
export type ToolTrialCardRequirement =
  (typeof TOOL_TRIAL_CARD_REQUIREMENT_VALUES)[number]
export type ToolTrialEndBehavior = (typeof TOOL_TRIAL_END_BEHAVIOR_VALUES)[number]

export const TOOL_TRIAL_ELIGIBILITY_LABELS = {
  open: 'Open to anyone',
  eligibility_limited: 'Eligibility limited',
  sales_assisted: 'Sales assisted',
} satisfies Record<ToolTrialEligibility, string>
export const TOOL_TRIAL_END_BEHAVIOR_LABELS = {
  converts_to_paid: 'Converts to paid plan',
  reverts_to_free: 'Reverts to free plan',
  access_ends: 'Access ends',
} satisfies Record<ToolTrialEndBehavior, string>
export const TOOL_TRIAL_CARD_REQUIREMENT_LABELS = {
  required: 'Card required',
  not_required: 'No card required',
  unknown: 'Unknown',
} satisfies Record<ToolTrialCardRequirement, string>

// Receipt: upstream docs/measurements/trial-terms-editor-limits-2026-09-30.md
export const TRIAL_TERMS_MAX_EVIDENCE = 3
export const TRIAL_TERMS_MAX_NAME_LENGTH = 120
export const TRIAL_TERMS_MAX_DURATION_LENGTH = 80
export const TRIAL_TERMS_MAX_NOTE_LENGTH = 240

export type ToolTrialTermsInput = {
  planName?: string
  eligibility?: string
  eligibilityNote?: string
  duration?: string
  cardRequirement?: string
  endBehavior?: string
  endNote?: string
  evidenceReferenceKeys?: string[]
  reviewedAt?: string
}

export type TrialTermsEvidence = SourceBackedEvidence

export interface PublicTrialTerms {
  planName?: string
  eligibility?: ToolTrialEligibility
  eligibilityNote?: string
  duration?: string
  cardRequirement?: ToolTrialCardRequirement
  endBehavior?: ToolTrialEndBehavior
  endNote?: string
  evidence: TrialTermsEvidence[]
  reviewedAt: string
}

const ELIGIBILITY_SET = new Set<string>(TOOL_TRIAL_ELIGIBILITY_VALUES)
const CARD_REQUIREMENT_SET = new Set<string>(TOOL_TRIAL_CARD_REQUIREMENT_VALUES)
const END_BEHAVIOR_SET = new Set<string>(TOOL_TRIAL_END_BEHAVIOR_VALUES)

// Construct the boundary schema only when normalization runs, so browser callers
// of the labels and summary helper do not initialize unused Zod schemas.
const createTrialTermsInputSchema = () => z.object({
  planName: z.string().nullish().transform((value) => value ?? undefined),
  eligibility: z.string().optional().catch(undefined),
  eligibilityNote: z.string().nullish().transform((value) => value ?? undefined),
  duration: z.string().nullish().transform((value) => value ?? undefined),
  cardRequirement: z.string().optional().catch(undefined),
  endBehavior: z.string().optional().catch(undefined),
  endNote: z.string().nullish().transform((value) => value ?? undefined),
  evidenceReferenceKeys: z.array(z.string()).optional(),
  reviewedAt: z.string().optional(),
})
let trialTermsInputSchema: ReturnType<typeof createTrialTermsInputSchema> | undefined

export const normalizePublicTrialTerms = (
  value: ToolTrialTermsInput | JsonValue,
  sourceReferences: readonly SourceReferenceInput[] | null | undefined,
): PublicTrialTerms | undefined => {
  trialTermsInputSchema ??= createTrialTermsInputSchema()
  const parsed = trialTermsInputSchema.safeParse(value)
  if (!parsed.success) return undefined
  const input: ToolTrialTermsInput = parsed.data
  const planName = normalizeOptionalPublicText(
    input.planName,
    TRIAL_TERMS_MAX_NAME_LENGTH,
  )
  const eligibilityNote = normalizeOptionalPublicText(
    input.eligibilityNote,
    TRIAL_TERMS_MAX_NOTE_LENGTH,
  )
  const duration = normalizeOptionalPublicText(
    input.duration,
    TRIAL_TERMS_MAX_DURATION_LENGTH,
  )
  const endNote = normalizeOptionalPublicText(
    input.endNote,
    TRIAL_TERMS_MAX_NOTE_LENGTH,
  )
  if (
    planName === null ||
    eligibilityNote === null ||
    duration === null ||
    endNote === null
  ) {
    return undefined
  }

  // SAFETY: The closed-vocabulary check establishes the asserted enum member.
  const eligibility = ELIGIBILITY_SET.has(input.eligibility ?? '')
    ? (input.eligibility as ToolTrialEligibility)
    : undefined
  // SAFETY: The closed-vocabulary check establishes the asserted enum member.
  const cardRequirement = CARD_REQUIREMENT_SET.has(input.cardRequirement ?? '')
    ? (input.cardRequirement as ToolTrialCardRequirement)
    : undefined
  // SAFETY: The closed-vocabulary check establishes the asserted enum member.
  const endBehavior = END_BEHAVIOR_SET.has(input.endBehavior ?? '')
    ? (input.endBehavior as ToolTrialEndBehavior)
    : undefined

  if (
    !planName &&
    !eligibility &&
    !eligibilityNote &&
    !duration &&
    !cardRequirement &&
    !endBehavior &&
    !endNote
  ) {
    return undefined
  }

  const evidence = resolveSourceBackedEvidence(
    input.evidenceReferenceKeys,
    buildUniquePublicSourceReferenceMap(sourceReferences),
    TRIAL_TERMS_MAX_EVIDENCE,
  )
  if (!evidence || !isValidCatalogTimestamp(input.reviewedAt)) {
    return undefined
  }

  return {
    ...(planName ? {planName} : undefined),
    ...(eligibility ? {eligibility} : undefined),
    ...(eligibilityNote ? {eligibilityNote} : undefined),
    ...(duration ? {duration} : undefined),
    ...(cardRequirement ? {cardRequirement} : undefined),
    ...(endBehavior ? {endBehavior} : undefined),
    ...(endNote ? {endNote} : undefined),
    evidence,
    reviewedAt: input.reviewedAt,
  }
}

export const validateToolTrialTerms = (
  value: ToolTrialTermsInput | null | undefined,
  context: {trialAvailability?: string} | undefined,
): true | string => {
  if (!value || !hasRuntimeObjectType(value)) return true

  const hasContent = [
    value.planName,
    value.eligibility,
    value.eligibilityNote,
    value.duration,
    value.cardRequirement,
    value.endBehavior,
    value.endNote,
  ].some((field) => isRuntimeString(field) && field.trim() !== '')
  if (!hasContent) {
    return value.evidenceReferenceKeys?.length || value.reviewedAt
      ? 'Add at least one trial term detail or clear the evidence and review fields.'
      : true
  }
  if (context?.trialAvailability !== 'available') {
    return 'Set trial availability to Available before documenting trial terms.'
  }
  if (!value.evidenceReferenceKeys?.length) {
    return 'Choose at least one source reference as evidence for these trial terms.'
  }
  if (!value.reviewedAt) {
    return 'Add a review date for these trial terms.'
  }
  return true
}

export const summarizePublicTrialTerms = (
  terms: PublicTrialTerms,
  escapeText: (value: string) => string = (value) => value,
): string[] => [
  ...(terms.planName ? [`Trial plan: ${escapeText(terms.planName)}`] : []),
  ...(terms.eligibility
    ? [`Trial eligibility: ${TOOL_TRIAL_ELIGIBILITY_LABELS[terms.eligibility]}`]
    : []),
  ...(terms.eligibilityNote
    ? [`Trial conditions: ${escapeText(terms.eligibilityNote)}`]
    : []),
  ...(terms.duration ? [`Trial length: ${escapeText(terms.duration)}`] : []),
  ...(terms.cardRequirement
    ? [`Card required: ${terms.cardRequirement === 'required' ? 'Yes' : terms.cardRequirement === 'unknown' ? 'Unknown' : 'No'}`]
    : []),
  ...(terms.endBehavior
    ? [`When the trial ends: ${TOOL_TRIAL_END_BEHAVIOR_LABELS[terms.endBehavior]}`]
    : []),
  ...(terms.endNote ? [`Trial end detail: ${escapeText(terms.endNote)}`] : []),
  ...terms.evidence.map((source) => `Trial terms source: ${source.url} (checked ${escapeText(source.checkedAt)})`),
  `Trial terms reviewed: ${terms.reviewedAt}`,
]
