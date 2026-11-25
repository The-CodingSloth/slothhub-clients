import {hasRuntimeObjectType, isRuntimeString} from './runtimeValidation.js'
import type {JsonValue} from './jsonValue.js'
import {containsUnsafePublicTextCharacters} from './publicText.js'
import {isCatalogTimestampAtOrBefore} from './catalogFreshnessSearch.js'
export const SETUP_COMPLEXITY_VALUES = [
  'low',
  'medium',
  'moderate',
  'high',
  'unknown',
] as const

export type SetupComplexity = (typeof SETUP_COMPLEXITY_VALUES)[number]
export const PUBLIC_SETUP_COMPLEXITY_VALUES = ['low', 'moderate', 'high'] as const
export type PublicSetupComplexity = (typeof PUBLIC_SETUP_COMPLEXITY_VALUES)[number]

export interface SetupComplexityOption {
  title: string
  value: SetupComplexity
}

export const SETUP_COMPLEXITY_OPTIONS: SetupComplexityOption[] = [
  {title: 'Low', value: 'low'},
  {title: 'Medium', value: 'medium'},
  {title: 'Moderate', value: 'moderate'},
  {title: 'High', value: 'high'},
  {title: 'Unknown', value: 'unknown'},
]

// SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
const SETUP_COMPLEXITY_LABELS: Record<SetupComplexity, string> = Object.fromEntries(
  SETUP_COMPLEXITY_OPTIONS.map((option) => [option.value, option.title]),
) as Record<SetupComplexity, string>

export interface ToolFitGuidanceInput {
  bestFor?: string[] | null
  notIdealFor?: string[] | null
  keyTradeoffs?: string[] | null
  setupComplexity?: string | null
  primaryDecisionCriteria?: string[] | null
  recommendedNextStep?: string | null
  reviewedAt?: string | null
  publicNotes?: string | null
}

export interface PublicToolFitGuidance {
  bestFor: string[]
  notIdealFor: string[]
  keyTradeoffs: string[]
  setupComplexity?: PublicSetupComplexity
  setupComplexityLabel?: string
  primaryDecisionCriteria: string[]
  recommendedNextStep?: string
  reviewedAt?: string
  publicNotes?: string
}

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim()

export const MAX_TOOL_FIT_GUIDANCE_ITEMS = 6
export const MAX_TOOL_FIT_GUIDANCE_STATEMENT_LENGTH = 240
export const MAX_TOOL_FIT_GUIDANCE_PUBLIC_NOTES_LENGTH = 400

const normalizePublicText = (value: string, maxLength: number): string | undefined => {
  if (containsUnsafePublicTextCharacters(value)) {
    return undefined
  }

  const normalized = normalizeWhitespace(value)
  return normalized && normalized.length <= maxLength ? normalized : undefined
}

const normalizeStringList = (values: string[] | null | undefined): string[] => {
  if (!Array.isArray(values) || values.length > MAX_TOOL_FIT_GUIDANCE_ITEMS) {
    return []
  }

  const seen = new Set<string>()
  const normalized: string[] = []

  for (const value of values) {
    if (!isRuntimeString(value)) {
      continue
    }

    const item = normalizePublicText(value, MAX_TOOL_FIT_GUIDANCE_STATEMENT_LENGTH)
    if (!item || seen.has(item.toLowerCase())) {
      continue
    }

    seen.add(item.toLowerCase())
    normalized.push(item)
  }

  return normalized
}

// SAFETY: The source is a closed or validated string collection; widening only enables collection operations.
export const isSetupComplexity = (value: JsonValue): value is SetupComplexity =>
  isRuntimeString(value) && (/* SAFETY: The adjacent guard or owner API establishes this asserted contract before use. */ SETUP_COMPLEXITY_VALUES as readonly string[]).includes(value)

export const toSetupComplexity = (value: JsonValue): SetupComplexity | undefined =>
  isSetupComplexity(value) ? value : undefined

export const getSetupComplexityLabel = (value: SetupComplexity): string =>
  SETUP_COMPLEXITY_LABELS[value]

export const normalizePublicToolFitGuidance = (
  input: ToolFitGuidanceInput | null | undefined,
  now: Date = new Date(),
): PublicToolFitGuidance | undefined => {
  if (!input || !hasRuntimeObjectType(input)) {
    return undefined
  }

  const bestFor = normalizeStringList(input.bestFor)
  const notIdealFor = normalizeStringList(input.notIdealFor)
  const keyTradeoffs = normalizeStringList(input.keyTradeoffs)
  const primaryDecisionCriteria = normalizeStringList(input.primaryDecisionCriteria)
  const authoredComplexity = toSetupComplexity(input.setupComplexity)
  const setupComplexity = authoredComplexity === 'medium' ? 'moderate' : authoredComplexity
  const recommendedNextStep =
    isRuntimeString(input.recommendedNextStep)
      ? normalizePublicText(input.recommendedNextStep, MAX_TOOL_FIT_GUIDANCE_STATEMENT_LENGTH)
      : undefined
  const reviewedAt =
    isCatalogTimestampAtOrBefore(input.reviewedAt, now) ? input.reviewedAt : undefined
  const publicNotes =
    isRuntimeString(input.publicNotes)
      ? normalizePublicText(input.publicNotes, MAX_TOOL_FIT_GUIDANCE_PUBLIC_NOTES_LENGTH)
      : undefined

  const hasContent =
    bestFor.length > 0 ||
    notIdealFor.length > 0 ||
    keyTradeoffs.length > 0 ||
    primaryDecisionCriteria.length > 0 ||
    Boolean(setupComplexity && setupComplexity !== 'unknown') ||
    Boolean(recommendedNextStep) ||
    Boolean(publicNotes)

  if (!hasContent) {
    return undefined
  }

  return {
    bestFor, notIdealFor, keyTradeoffs,
    ...(setupComplexity && setupComplexity !== 'unknown' ? {
      setupComplexity,
      setupComplexityLabel: getSetupComplexityLabel(setupComplexity),
    } : undefined),
    primaryDecisionCriteria,
    ...(recommendedNextStep ? { recommendedNextStep } : undefined),
    ...(reviewedAt ? { reviewedAt } : undefined),
    ...(publicNotes ? { publicNotes } : undefined)
  }
}

export const validateFitGuidanceReviewTimestamp = (
  input: ToolFitGuidanceInput | null | undefined,
  now: Date = new Date(),
): true | string => {
  if (!input || !hasRuntimeObjectType(input)) return true
  if (input.reviewedAt === undefined || input.reviewedAt === null || input.reviewedAt === '') {
    return true
  }
  return isCatalogTimestampAtOrBefore(input.reviewedAt, now)
    ? true
    : 'Fit guidance review date must be valid and not in the future.'
}

export const hasPublicToolFitGuidance = (
  input: ToolFitGuidanceInput | null | undefined,
): boolean => Boolean(normalizePublicToolFitGuidance(input))

/**
 * Editor's picks should carry enough decision substance for an evaluator.
 * Require at least one best-for statement plus either a not-ideal-for statement
 * or a recommended next step.
 */
export const validateFeaturedToolFitGuidance = (document: {
  visibility?: string | null
  fitGuidance?: ToolFitGuidanceInput | null
}): true | string => {
  if (document.visibility !== 'featured') {
    return true
  }

  const guidance = normalizePublicToolFitGuidance(document.fitGuidance)
  if (!guidance) {
    return "Editor's picks should include Fit Guidance so evaluators know when this listing is a strong fit."
  }

  if (guidance.bestFor.length === 0) {
    return "Editor's picks should include at least one Best for statement in Fit Guidance."
  }

  if (guidance.notIdealFor.length === 0 && !guidance.recommendedNextStep) {
    return "Editor's picks should include Not ideal for guidance or a recommended next step."
  }

  return true
}
