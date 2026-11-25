import {z} from 'zod'
import {pricingCostEvidenceUrlSchema, toolPricingPlanIdSchema} from './toolPricingCostBasis.js'

/** Workloads and freshness are the published assumptions in upstream issue #1884. */
export const COST_PERSONA_VERSION = '2026-10' as const
export const COST_PERSONAS = ['solo', 'team5', 'heavy_agent'] as const
export const PERSONA_COST_FORMULA = 'round((planPrice + seatPrice * seats + max(0, usage - included) * unitPrice) * 100) / 100'

export const personaCostEstimateSchema = z.object({
  persona: z.enum(COST_PERSONAS),
  personaVersion: z.literal(COST_PERSONA_VERSION),
  monthlyUsd: z.number().nonnegative().nullable(),
  currency: z.literal('USD'),
  formula: z.literal(PERSONA_COST_FORMULA),
  inputs: z.object({
    planId: toolPricingPlanIdSchema.nullable(),
    planPrice: z.number().nonnegative().nullable(),
    seatPrice: z.number().nonnegative().nullable(),
    seats: z.number().int().positive(),
    projects: z.number().int().positive(),
    usage: z.number().nonnegative().nullable(),
    included: z.number().nonnegative().nullable(),
    unitPrice: z.number().nonnegative().nullable(),
    usageUnit: z.enum(['request', 'tool_call', 'other']).nullable(),
    soloBaselinePlanId: toolPricingPlanIdSchema.nullable(),
    annualPriceDividedBy12: z.boolean(),
  }),
  evidenceUrls: z.array(pricingCostEvidenceUrlSchema),
  pricingCheckedAt: z.iso.datetime({offset: true}).nullable(),
  computedAt: z.iso.datetime({offset: true}),
  stale: z.boolean(),
  reason: z.enum(['missing_plan_id', 'ambiguous_plan_id', 'custom_price', 'missing_cost_basis', 'currency_not_usd', 'unsupported_billing_period', 'future_pricing_check', 'missing_free_tier_baseline', 'incompatible_usage_unit', 'seat_limit', 'project_limit', 'usage_limit', 'amount_out_of_range']).optional(),
})
export type PersonaCostEstimate = z.infer<typeof personaCostEstimateSchema>

export function summarizePersonaCostEstimates(estimates: readonly PersonaCostEstimate[]): string[] {
  return estimates.map((estimate) => [
    `${estimate.persona} (${estimate.personaVersion}), plan ${estimate.inputs.planId ?? 'unknown'}: ${estimate.monthlyUsd === null ? `unavailable (${estimate.reason})` : `${estimate.monthlyUsd.toFixed(2)} USD/month`}`,
    estimate.inputs.annualPriceDividedBy12 ? 'annual list price divided by 12' : 'monthly list price',
    `formula ${estimate.formula}`,
    `inputs ${JSON.stringify(estimate.inputs)}`,
    `pricing checked ${estimate.pricingCheckedAt ?? 'unknown'}`,
    `computed ${estimate.computedAt}`,
    estimate.stale ? 'stale pricing' : 'pricing not marked stale',
    `evidence ${estimate.evidenceUrls.join(', ') || 'none — estimate unavailable'}`,
  ].join('; '))
}

