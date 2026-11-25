import {Decimal} from 'decimal.js'
import type {ToolPricingEvidence} from './toolPricingEvidence.js'
import {isPricingCheckOutdated} from './pricingCheckFreshness.js'
import {isCatalogTimestampAtOrBefore} from './catalogFreshnessSearch.js'
import {COST_PERSONAS, COST_PERSONA_VERSION, PERSONA_COST_FORMULA, type PersonaCostEstimate} from './personaCostContract.js'
export {personaCostEstimateSchema} from './personaCostContract.js'

const personas = {solo: {seats: 1, projects: 1}, team5: {seats: 5, projects: 3}, heavy_agent: {seats: 1, projects: 1}} as const

type PricingPlan = NonNullable<ToolPricingEvidence['plans']>[number]
type Persona = PersonaCostEstimate['persona']
type Reason = NonNullable<PersonaCostEstimate['reason']>

/** One cited scenario per plan/persona, not an inferred cheapest-plan ranking. */
export function computePersonaCostEstimates(
  pricing: ToolPricingEvidence & {currency?: string | null},
  computedAt: Date,
): PersonaCostEstimate[] {
  // Binary64 decimal spellings span exponents -324..308. Subtraction, two
  // products and addition need fewer than 1,000 significant digits even at
  // those extremes; 1,024 retains guard digits for division by 12.
  // See upstream docs/persona-cost-estimates.md for the bound and regression receipt.
  const arithmetic = Decimal.clone({precision: 1024})
  const plans = pricing.plans ?? []
  return plans.flatMap((plan) => COST_PERSONAS.map((persona) => estimatePlan(pricing, plans, plan, persona, computedAt, arithmetic)))
}


function estimatePlan(
  pricing: ToolPricingEvidence & {currency?: string | null},
  plans: PricingPlan[],
  plan: PricingPlan,
  persona: Persona,
  now: Date,
  arithmetic: typeof Decimal,
): PersonaCostEstimate {
  const basis = plan.costBasis
  const annual = plan.billingPeriod === 'year'
  const monthlyBasisKnown = pricing.currency === 'USD' && (plan.billingPeriod === 'month' || annual)
  const monthly = plan.listPrice === undefined ? null : new arithmetic(plan.listPrice).div(annual ? 12 : 1)
  const freePlans = plans.filter((candidate) => candidate.listPrice === 0 && candidate.priceType !== 'custom')
  const freePlan = freePlans.filter((candidate) => candidate.planId && candidate.costBasis?.usageUnit === basis?.usageUnit && (basis?.usageUnit !== 'other' || candidate.planId === plan.planId) && candidate.costBasis?.overageBehavior !== 'unlimited' && (candidate.billingPeriod === 'month' || candidate.billingPeriod === 'year'))
    .sort((left, right) => (right.costBasis?.includedMonthlyUsage ?? 0) - (left.costBasis?.includedMonthlyUsage ?? 0) || (left.planId ?? '').localeCompare(right.planId ?? '', 'en'))[0]
  const freeBasis = freePlan?.costBasis
  const soloUsage = freePlans.length === 0 ? 0 : freeBasis?.includedMonthlyUsage ?? null
  const rawUsage = persona === 'heavy_agent' ? new arithmetic(10000) : soloUsage === null ? null : new arithmetic(soloUsage).mul(persona === 'team5' ? 5 : 1)
  const usage = rawUsage !== null && Number.isFinite(rawUsage.toNumber()) ? rawUsage.toNumber() : null
  const result: PersonaCostEstimate = {
    persona, personaVersion: COST_PERSONA_VERSION, monthlyUsd: null, currency: 'USD', formula: PERSONA_COST_FORMULA,
    inputs: {
      planId: plan.planId ?? null,
      planPrice: !monthlyBasisKnown ? null : basis?.chargeUnit === 'plan' ? monthly?.toNumber() ?? null : basis ? 0 : null,
      seatPrice: !monthlyBasisKnown ? null : basis?.chargeUnit === 'seat' ? monthly?.toNumber() ?? null : basis ? 0 : null,
      ...personas[persona], usage,
      included: basis?.includedMonthlyUsage ?? null, unitPrice: monthlyBasisKnown ? basis?.unitPrice ?? null : null,
      usageUnit: basis?.usageUnit ?? null, annualPriceDividedBy12: annual,
      soloBaselinePlanId: persona !== 'heavy_agent' ? freePlan?.planId ?? null : null,
    },
    evidenceUrls: [...new Set([...(basis?.evidenceUrls ?? []), ...(freeBasis && persona !== 'heavy_agent' ? freeBasis.evidenceUrls : [])])],
    pricingCheckedAt: basis && freeBasis && persona !== 'heavy_agent' && Date.parse(freeBasis.checkedAt) < Date.parse(basis.checkedAt) ? freeBasis.checkedAt : basis?.checkedAt ?? null,
    computedAt: now.toISOString(), stale: isPricingCheckOutdated(basis?.checkedAt, now) || (persona !== 'heavy_agent' && isPricingCheckOutdated(freeBasis?.checkedAt, now)),
  }
  const fail = (reason: Reason): PersonaCostEstimate => ({...result, reason})
  if (!plan.planId) return fail('missing_plan_id')
  if (plans.filter((candidate) => candidate.planId === plan.planId).length !== 1) return fail('ambiguous_plan_id')
  if (plan.priceType === 'custom') return fail('custom_price')
  if (!basis) return fail('missing_cost_basis')
  if (pricing.currency !== 'USD') return fail('currency_not_usd')
  if (plan.billingPeriod !== 'month' && plan.billingPeriod !== 'year') return fail('unsupported_billing_period')
  if (!isCatalogTimestampAtOrBefore(basis.checkedAt, now) || (freeBasis && persona !== 'heavy_agent' && !isCatalogTimestampAtOrBefore(freeBasis.checkedAt, now))) return fail('future_pricing_check')
  if (persona === 'heavy_agent' && basis.usageUnit === 'other') return fail('incompatible_usage_unit')
  if (rawUsage !== null && usage === null) return fail('amount_out_of_range')
  if (rawUsage === null) return fail('missing_free_tier_baseline')
  if (!basis.unlimitedSeats && (basis.seatLimit === undefined || basis.seatLimit < personas[persona].seats)) return fail('seat_limit')
  if (!basis.unlimitedProjects && (basis.projectLimit === undefined || basis.projectLimit < personas[persona].projects)) return fail('project_limit')
  if (basis.overageBehavior === 'blocked' && rawUsage.greaterThan(basis.includedMonthlyUsage)) return fail('usage_limit')
  if (monthly === null) return fail('custom_price')
  const total = monthly.mul(basis.chargeUnit === 'seat' ? personas[persona].seats : 1).plus(arithmetic.max(0, rawUsage.minus(basis.includedMonthlyUsage)).mul(basis.unitPrice))
  if (!total.isFinite() || total.mul(100).greaterThan(Number.MAX_SAFE_INTEGER)) return fail('amount_out_of_range')
  return {...result, monthlyUsd: total.toDecimalPlaces(2, arithmetic.ROUND_HALF_UP).toNumber()}
}
