import {z} from 'zod'
import {freeTierTermsSnapshotSchema} from './freeTierTerms.js'
export * from './freeTierTerms.js'
import {containsUnsafePublicTextCharacters} from './publicText.js'
import {MAX_PUBLIC_METADATA_NOTE_LENGTH} from './publicMetadata.js'
import {toolPricingCostBasisSchema, toolPricingPlanIdSchema} from './toolPricingCostBasis.js'
import {summarizePersonaCostEstimates, type PersonaCostEstimate} from './personaCostContract.js'
export {
  PRICING_CHECK_MAX_AGE_DAYS,
  PRICING_RECHECK_QUEUE_FILTER,
  canShowPricingCheck,
  isPricingCheckOutdated,
  selectPublicPricingCheck,
} from './pricingCheckFreshness.js'

const pricingText = z.string().trim().min(1).max(MAX_PUBLIC_METADATA_NOTE_LENGTH, {
  error: (issue) => `Pricing text too long: limit_characters=${MAX_PUBLIC_METADATA_NOTE_LENGTH}, actual_characters=${z.string().safeParse(issue.input).data?.length ?? 0}. Shorten the note and link the full terms in source references.`,
})
  .refine((value) => !containsUnsafePublicTextCharacters(value), 'Use plain public pricing text.')
const amount = z.number().nonnegative()
// upstream issue #1861 explicitly requests a 500-character editorial pricing note.
export const TOOL_PRICING_NOTE_MAX_LENGTH = 500
export const TOOL_PRICING_BILLING_PERIODS = ['month', 'year', 'one_time', 'usage'] as const
export type ToolPricingBillingPeriod = (typeof TOOL_PRICING_BILLING_PERIODS)[number]
export const toolPricingNoteSchema = z.string().trim().min(1).max(TOOL_PRICING_NOTE_MAX_LENGTH)
  .refine((value) => !containsUnsafePublicTextCharacters(value), 'Use plain public pricing text.')

/** Omitted priceType means listed, so existing plans keep requiring listPrice. */
export const TOOL_PRICING_PLAN_PRICE_TYPES = ['listed', 'custom'] as const
export type ToolPricingPlanPriceType = (typeof TOOL_PRICING_PLAN_PRICE_TYPES)[number]

/** Amounts use the pricing currency's major unit; billing describes cadence and commitment. */
export const toolPricingPlanSchema = z.object({
  planId: toolPricingPlanIdSchema.optional(),
  name: pricingText,
  costBasis: toolPricingCostBasisSchema.optional(),
  priceType: z.enum(TOOL_PRICING_PLAN_PRICE_TYPES).optional(),
  listPrice: amount.optional(),
  billing: pricingText,
  billingPeriod: z.enum(TOOL_PRICING_BILLING_PERIODS).optional(),
  promoPrice: amount.optional(),
  promoEndsAt: z.iso.datetime({offset: true}).optional(),
  promoNote: pricingText.optional(),
}).superRefine((plan, ctx) => {
  if (plan.costBasis && !plan.planId) {
    ctx.addIssue({code: 'custom', path: ['planId'], message: 'A cost basis needs a stable plan id.'})
  }
  const custom = plan.priceType === 'custom'
  if (!custom && plan.listPrice === undefined) {
    ctx.addIssue({code: 'custom', path: ['listPrice'], message: 'Listed plans require a list price. Use priceType custom when the vendor publishes no single amount.'})
  }
  if (custom && (plan.promoPrice !== undefined || plan.promoEndsAt !== undefined || plan.promoNote !== undefined)) {
    ctx.addIssue({code: 'custom', path: ['promoPrice'], message: 'A custom plan cannot include a promotional price. Record the vendor wording in billing.'})
  }
  if (!custom && plan.promoPrice !== undefined && !plan.promoEndsAt && !plan.promoNote) {
    ctx.addIssue({code: 'custom', path: ['promoNote'], message: 'Record when the promotion ends, or a note when no date is published.'})
  }
  if (!custom && plan.promoPrice !== undefined && plan.listPrice !== undefined && plan.promoPrice > plan.listPrice) {
    ctx.addIssue({code: 'custom', path: ['promoPrice'], message: 'A promotional price cannot exceed the list price for the same billing basis.'})
  }
  if (!custom && plan.promoPrice === undefined && (plan.promoEndsAt || plan.promoNote)) {
    ctx.addIssue({code: 'custom', path: ['promoPrice'], message: 'Record the promotional price or clear its promotion terms.'})
  }
})
export const toolUsageAddOnSchema = z.object({unit: pricingText, rate: amount, billing: pricingText, planName: pricingText.optional()})
interface PricingPlanAssociationInput {
  plans?: readonly {name: string}[] | null
  usageAddOns?: readonly {planName?: string}[] | null
}

const validateUsagePlanAssociations = (pricing: PricingPlanAssociationInput, ctx: z.RefinementCtx): void => {
  pricing.usageAddOns?.forEach((addOn, index) => {
    if (addOn.planName && pricing.plans?.filter((plan) => plan.name === addOn.planName).length !== 1) {
      ctx.addIssue({code: 'custom', path: ['usageAddOns', index, 'planName'],
        message: 'Usage add-on plan name must match exactly one recorded plan. Copy its plan name, give duplicate plans distinct names, or clear the association for a shared rate.'})
    }
  })
}

const uniquePlanIds = (plans: Array<{planId?: string}>) => {
  const ids = plans.flatMap((plan) => plan.planId ? [plan.planId] : [])
  return new Set(ids).size === ids.length
}
export const toolPricingEvidenceSchema = z.object({
  plans: z.array(toolPricingPlanSchema).refine(uniquePlanIds, 'Plan ids must be unique within the Tool.').optional(),
  notes: toolPricingNoteSchema.optional(),
  regionalPricingNote: pricingText.optional(),
  usageAddOns: z.array(toolUsageAddOnSchema).optional(),
  sourceDiscrepancyNote: pricingText.optional(),
}).superRefine(validateUsagePlanAssociations)
export type ToolPricingEvidence = z.infer<typeof toolPricingEvidenceSchema>

const rowMetadata = {_key: z.string().optional(), _type: z.string().optional()}
/** Guarded replacements keep editor row identities; public evidence strips them. */
export const toolPricingEvidenceSnapshotSchema = z.object({
  freeTierTerms: freeTierTermsSnapshotSchema.nullish(),
  plans: z.array(toolPricingPlanSchema.safeExtend(rowMetadata)).refine(uniquePlanIds, 'Plan ids must be unique within the Tool.').nullish(),
  usageAddOns: z.array(toolUsageAddOnSchema.extend(rowMetadata)).nullish(),
  notes: toolPricingNoteSchema.nullish(),
  regionalPricingNote: pricingText.nullish(),
  sourceDiscrepancyNote: pricingText.nullish(),
}).superRefine(validateUsagePlanAssociations)
export type ToolPricingEvidenceSnapshot = z.infer<typeof toolPricingEvidenceSnapshotSchema>

export const normalizePublicToolPricingEvidence = (value: Omit<ToolPricingEvidenceSnapshot, 'freeTierTerms'> | null | undefined): ToolPricingEvidence => {
  const parsed = toolPricingEvidenceSchema.safeParse(Object.fromEntries(Object.entries(value ?? {}).filter(([, entry]) => entry != null)))
  return parsed.success ? parsed.data : {}
}

type PricingEvidenceRenderOptions = {includePlanIds?: boolean}
export const summarizeToolPricingEvidence = (
  value: (Omit<ToolPricingEvidenceSnapshot, 'freeTierTerms'> & {currency?: string | null; personaCosts?: PersonaCostEstimate[]}) | null | undefined,
  renderText: (text: string) => string = (text) => text,
  options: PricingEvidenceRenderOptions = {},
): string[] => {
  const parsedCurrency = z.enum(['USD', 'EUR', 'GBP']).safeParse(value?.currency)
  const currency = parsedCurrency.success ? ` ${parsedCurrency.data}` : ''
  const {plans, usageAddOns, notes, regionalPricingNote, sourceDiscrepancyNote} = normalizePublicToolPricingEvidence(value)
  return [
    ...summarizePersonaCostEstimates(value?.personaCosts ?? []).map(renderText),
    ...(plans ?? []).map((plan) => [
      `Plan ${renderText(plan.name)}: ${plan.priceType === 'custom' || plan.listPrice === undefined ? 'Custom' : `list ${plan.listPrice}${currency}`}`,
      ...(plan.planId && options.includePlanIds !== false ? [`plan ID: ${renderText(plan.planId)}`] : []),
      ...(plan.priceType !== 'custom' && plan.promoPrice !== undefined ? [`promotional ${plan.promoPrice}${currency}`] : []),
      renderText(plan.billing),
      ...(plan.billingPeriod ? [`Amount period: ${plan.billingPeriod}`] : []),
      ...(plan.promoEndsAt ? [`promotion ends ${renderText(plan.promoEndsAt)}`] : []),
      ...(plan.promoNote ? [renderText(plan.promoNote)] : []),
    ].join('; ')),
    ...(usageAddOns ?? []).map((addOn) => `Usage add-on${addOn.planName ? ` (${renderText(addOn.planName)})` : ''}: ${addOn.rate}${currency} per ${renderText(addOn.unit)}; ${renderText(addOn.billing)}`),
    ...(notes ? [`Pricing note: ${renderText(notes)}`] : []),
    ...(regionalPricingNote ? [`Regional pricing: ${renderText(regionalPricingNote)}`] : []),
    ...(sourceDiscrepancyNote ? [`Pricing source discrepancy: ${renderText(sourceDiscrepancyNote)}`] : []),
  ]
}
