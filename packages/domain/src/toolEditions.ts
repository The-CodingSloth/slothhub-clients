import {z} from 'zod'
import {toolPricingPlanIdSchema} from './toolPricingCostBasis.js'
import type {ToolPricingEvidence} from './toolPricingEvidence.js'
import type {JsonValue} from './jsonValue.js'
import {TOOL_DEPLOYMENT_LABELS, TOOL_DEPLOYMENT_MODELS, TOOL_SOURCE_AVAILABILITY, TOOL_SOURCE_LABELS} from './toolDeployment.js'
import {containsUnsafePublicTextCharacters} from './publicText.js'
import {getPublicHttpUrl} from './urlSafety.js'
import {isValidSpdxExpression} from './licenseFacts.js'
import {escapeMarkdownText, toMarkdownInlineCode} from './markdownSafety.js'

const text = z.string().trim().min(1).refine(value => !containsUnsafePublicTextCharacters(value), 'Use plain public text.')
const identifier = text.regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, 'Use a stable lowercase ID with hyphens or underscores.')
const evidenceUrl = text.refine(value => value.startsWith('https://') && getPublicHttpUrl(value) === value && new URL(value).href === value, 'Use a canonical public HTTPS evidence URL.')
const evidence = {sourceUrl: evidenceUrl, checkedAt: z.iso.datetime({offset: true})}
const spdx = text.refine(isValidSpdxExpression, 'Use a valid SPDX license expression.')
const licenseFields = {
  spdxExpression: spdx,
  artifactPattern: text,
  ...evidence,
  changeDate: z.iso.date().optional(),
  changeLicense: spdx.optional(),
}
export const toolEditionLicenseSchema = z.object(licenseFields).refine(value => Boolean(value.changeDate) === Boolean(value.changeLicense), 'Record both the license change date and the change license, or neither.')
const editionFields = {
  id: identifier,
  name: text,
  deploymentModel: z.enum(TOOL_DEPLOYMENT_MODELS),
  sourceAvailability: z.enum(TOOL_SOURCE_AVAILABILITY),
  repositoryUrl: evidenceUrl.optional(),
  pricing: z.enum(['free', 'paid', 'freemium']),
  planIds: z.array(toolPricingPlanIdSchema).optional(),
  license: toolEditionLicenseSchema.optional(),
  ...evidence,
}
export const toolEditionSchema = z.object(editionFields).superRefine((edition, ctx) => {
  if (edition.sourceAvailability !== 'closed_source' && !edition.repositoryUrl) ctx.addIssue({code: 'custom', path: ['repositoryUrl'], message: 'Source-available and open-source editions require an official source repository.'})
  if (edition.planIds && new Set(edition.planIds).size !== edition.planIds.length) ctx.addIssue({code: 'custom', path: ['planIds'], message: 'Reference each pricing plan once.'})
})
export const toolEditionsSchema = z.array(toolEditionSchema).refine(editions => new Set(editions.map(edition => edition.id)).size === editions.length, 'Each edition needs a unique stable ID.')
export type ToolEdition = z.infer<typeof toolEditionSchema>
export const TOOL_EDITIONS_JSON_SCHEMA = z.json().parse(z.toJSONSchema(toolEditionsSchema, {target: 'draft-7'}))

const optional = <T extends z.ZodType>(schema: T) => schema.nullish().transform(value => value ?? undefined).optional()
const licenseAuthoring = z.object({...licenseFields, changeDate: optional(z.iso.date()), changeLicense: optional(spdx)})
export const toolEditionsAuthoringSchema = z.array(z.object({...editionFields, repositoryUrl: optional(evidenceUrl), planIds: optional(z.array(toolPricingPlanIdSchema)), license: optional(licenseAuthoring)})).pipe(toolEditionsSchema)

/** The first authored edition is the default download; missing facts never create editions. */
export const normalizeToolEditions = (value: JsonValue, now = new Date()): ToolEdition[] => {
  const result = toolEditionsAuthoringSchema.safeParse(value)
  if (!result.success || result.data.some(edition => Date.parse(edition.checkedAt) > now.getTime() || edition.license && Date.parse(edition.license.checkedAt) > now.getTime())) return []
  return result.data
}
type EditionPricingPlan = Pick<NonNullable<ToolPricingEvidence['plans']>[number], 'planId' | 'listPrice' | 'priceType'>
export const validateToolEditionPlans = (editions: readonly ToolEdition[], plans: readonly EditionPricingPlan[] | null | undefined): string[] => {
  const problems: string[] = []
  for (const edition of editions) for (const id of edition.planIds ?? []) {
    const matching = plans?.filter(plan => plan.planId === id) ?? []
    if (matching.length !== 1) {
      problems.push(`${edition.id}: plan ${id} does not resolve to exactly one pricing plan.`)
    } else if (edition.pricing === 'free' && matching.some(plan => plan.priceType === 'custom' || plan.listPrice !== undefined && plan.listPrice > 0)) {
      problems.push(`${edition.id}: free edition references paid or custom-priced plan ${id}. Correct the edition pricing or plan association.`)
    }
  }
  return problems
}

export const toolEditionSummarySchema = z.object({
  editionCount: z.number().int().min(1),
  freeToSelfHost: z.boolean(),
  pricing: z.enum(['free', 'paid', 'freemium']),
  pricingLabel: text,
  licenseLabel: text.optional(),
})
export const TOOL_EDITION_SUMMARY_JSON_SCHEMA = z.json().parse(z.toJSONSchema(toolEditionSummarySchema, {target: 'draft-7'}))
export type ToolEditionSummary = z.infer<typeof toolEditionSummarySchema>
export const summarizeToolEditions = (editions: readonly ToolEdition[]): ToolEditionSummary | undefined => {
  if (!editions.length) return undefined
  const freeToSelfHost = editions.some(edition => edition.pricing === 'free' && edition.deploymentModel === 'self_hosted')
  const paidHosted = editions.some(edition => edition.pricing !== 'free' && edition.deploymentModel === 'hosted')
  const pricing = editions.every(edition => edition.pricing === 'free') ? 'free' : editions.every(edition => edition.pricing === 'paid') ? 'paid' : 'freemium'
  const defaultLicense = editions[0]?.license?.spdxExpression
  return {editionCount: editions.length, freeToSelfHost, pricing, pricingLabel: freeToSelfHost && paidHosted ? 'Free to self-host · Paid hosted plans' : pricing === 'free' ? 'Free' : pricing === 'paid' ? 'Paid' : editions.length === 1 ? 'Freemium' : 'Free and paid editions', ...(defaultLicense ? {licenseLabel: editions.length > 1 ? `${defaultLicense} +${editions.length - 1} editions` : defaultLicense} : undefined)}
}
export const renderToolEditionsMarkdown = (editions: readonly ToolEdition[]): string => editions.length ? [
  '## Editions and downloads',
  'The first edition is the default download. Prices and licenses apply only to the named edition; source access does not establish hosting rights.',
  ...editions.map(edition => [
    `### ${escapeMarkdownText(edition.name)}`,
    `${TOOL_DEPLOYMENT_LABELS[edition.deploymentModel]}; ${TOOL_SOURCE_LABELS[edition.sourceAvailability]}; pricing: ${edition.pricing}.`,
    ...(edition.repositoryUrl ? [`Source repository: ${toMarkdownInlineCode(edition.repositoryUrl)}.`] : []),
    ...(edition.planIds?.length ? [`Pricing plan IDs: ${edition.planIds.map(toMarkdownInlineCode).join(', ')}.`] : []),
    `Evidence: ${toMarkdownInlineCode(edition.sourceUrl)}; checked ${escapeMarkdownText(edition.checkedAt)}.`,
    ...(edition.license ? [`Download ${toMarkdownInlineCode(edition.license.artifactPattern)}: ${toMarkdownInlineCode(edition.license.spdxExpression)}; evidence ${toMarkdownInlineCode(edition.license.sourceUrl)}; checked ${escapeMarkdownText(edition.license.checkedAt)}.`, ...(edition.license.changeDate ? [`License changes on ${edition.license.changeDate} to ${toMarkdownInlineCode(edition.license.changeLicense ?? '')}.`] : [])] : []),
  ].join('\n\n')),
].join('\n\n') : ''
