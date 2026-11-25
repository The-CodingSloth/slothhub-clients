import {z} from 'zod'
import {validatePublicHttpUrl} from './urlSafety.js'
import {containsUnsafePublicTextCharacters} from './publicText.js'

export const toolPricingPlanIdSchema = z.string().trim().min(1).regex(/^[a-z0-9][a-z0-9_-]*$/)
export const pricingCostEvidenceUrlSchema = z.string().refine((url) => !containsUnsafePublicTextCharacters(url) && validatePublicHttpUrl(url).success, 'Use a public HTTP(S) evidence URL without credentials or control characters.')

/** Explicit, editor-reviewed inputs; billing prose is never a calculator input. */
export const toolPricingCostBasisSchema = z.object({
  chargeUnit: z.enum(['seat', 'plan']),
  seatLimit: z.number().int().positive().optional(),
  unlimitedSeats: z.boolean().optional(),
  projectLimit: z.number().int().positive().optional(),
  unlimitedProjects: z.boolean().optional(),
  includedMonthlyUsage: z.number().nonnegative(),
  usageUnit: z.enum(['request', 'tool_call', 'other']),
  overageBehavior: z.enum(['metered', 'blocked', 'unlimited']),
  unitPrice: z.number().nonnegative(),
  evidenceUrls: z.array(pricingCostEvidenceUrlSchema).min(1),
  checkedAt: z.iso.datetime({offset: true}),
}).superRefine((basis, ctx) => {
  for (const [count, unlimited] of [['seatLimit', 'unlimitedSeats'], ['projectLimit', 'unlimitedProjects']] as const) {
    if ((basis[count] !== undefined) === (basis[unlimited] === true)) {
      ctx.addIssue({code: 'custom', path: [count], message: 'Record either a positive capacity or explicit unlimited capacity, not both.'})
    }
  }
  if (basis.overageBehavior !== 'metered' && basis.unitPrice !== 0) {
    ctx.addIssue({code: 'custom', path: ['unitPrice'], message: 'Blocked or unlimited usage has no marginal charge; use unit price 0.'})
  }
})

export type ToolPricingCostBasis = z.infer<typeof toolPricingCostBasisSchema>
