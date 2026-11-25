import {z} from 'zod'
import {DEAL_SOURCE_CHECK_MAX_AGE_SECONDS} from './deal.js'
import {getPublicHttpUrl} from './urlSafety.js'
import {escapeMarkdownText, encodeMarkdownUrl} from './markdownSafety.js'

const text = z.string().trim().min(1)

/** Public offer facts; reviewer identity and raw evidence excerpts stay private. */
export const publicToolDealSchema = z.object({
  id: text,
  title: text,
  description: text,
  discountPercent: z.number().min(1).max(100).optional(),
  code: text.optional(),
  eligibility: text,
  regions: z.array(text).optional(),
  termsSummary: text,
  commercialDisclosure: text,
  sourceUrl: z.string().refine((value) => Boolean(getPublicHttpUrl(value))),
  verifiedAt: z.iso.datetime(),
  lastSourceCheckedAt: z.iso.datetime(),
  validFrom: z.iso.datetime().optional(),
  expiresAt: z.iso.datetime(),
}).refine((deal) => Boolean(deal.code || deal.discountPercent), 'An offer needs a discount or code.')

export type PublicToolDeal = z.infer<typeof publicToolDealSchema>
export const PUBLIC_TOOL_DEAL_JSON_SCHEMA = z.json().parse(z.toJSONSchema(publicToolDealSchema, {target: 'draft-7'}))

export const filterCurrentToolDeals = (
  deals: readonly PublicToolDeal[],
  now: Date = new Date(),
): PublicToolDeal[] => deals.filter((deal) => {
  const reference = now.getTime()
  const verified = Date.parse(deal.verifiedAt)
  const checked = Date.parse(deal.lastSourceCheckedAt)
  return verified <= checked && checked <= reference
    && reference - checked <= DEAL_SOURCE_CHECK_MAX_AGE_SECONDS * 1000
    && (!deal.validFrom || Date.parse(deal.validFrom) <= reference)
    && reference < Date.parse(deal.expiresAt)
})

export const renderToolDealsMarkdown = (deals: readonly PublicToolDeal[]): string => [
  '## Verified deals',
  'Offers are verified as of the catalog build; recheck the source before purchase. Commercial disclosures apply.',
  ...(deals.length ? deals.map((deal) => [
    `- **${escapeMarkdownText(deal.title)}**: ${escapeMarkdownText(deal.description)}`,
    ...(deal.discountPercent ? [`  - Discount: ${deal.discountPercent}%`] : []),
    ...(deal.code ? [`  - Code: ${escapeMarkdownText(deal.code)}`] : []),
    `  - Eligibility: ${escapeMarkdownText(deal.eligibility)}`,
    ...(deal.regions?.length ? [`  - Regions: ${deal.regions.map(escapeMarkdownText).join(', ')}`] : []),
    `  - Terms: ${escapeMarkdownText(deal.termsSummary)}`,
    `  - Disclosure: ${escapeMarkdownText(deal.commercialDisclosure)}`,
    `  - Expires: ${deal.expiresAt}${deal.validFrom ? `; starts: ${deal.validFrom}` : ''}`,
    `  - Verified: ${deal.verifiedAt}; source checked: ${deal.lastSourceCheckedAt}`,
    `  - Source: <${encodeMarkdownUrl(deal.sourceUrl)}>`,
  ].join('\n')) : ['No active verified deals in this catalog snapshot.']),
].join('\n\n')
