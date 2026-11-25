import {isCatalogTimestampAtOrBefore} from './catalogFreshnessSearch.js'
import {groqHasTrimmedText} from './groqText.js'
import {MAX_PUBLIC_SOURCE_REFERENCES, SOURCE_REFERENCE_TYPE_VALUES, normalizeSourceReferenceTitle} from './sourceReference.js'

/** A pricing check older than this is outdated. Exactly this age is still current. */
export const PRICING_CHECK_MAX_AGE_DAYS = 90
const PRICING_CHECK_MAX_AGE_MS = PRICING_CHECK_MAX_AGE_DAYS * 24 * 60 * 60 * 1000
const PRICING_CHECK_MAX_AGE_SECONDS = PRICING_CHECK_MAX_AGE_MS / 1000

export interface PricingCheckSource {
  title?: string | null
  sourceType?: string | null
  checkedAt?: string | null
  visibility?: string | null
}

export interface PublicPricingCheck {
  checkedAt: string
  source: string
}

const SOURCE_TYPE_LABELS = new Set<string>(SOURCE_REFERENCE_TYPE_VALUES)

/** A page title visitors can read. Source-type enums such as pricing_page are not titles. */
const pricingPageTitle = (title: PricingCheckSource['title']): string | undefined => {
  const label = normalizeSourceReferenceTitle(title)
  if (!label || SOURCE_TYPE_LABELS.has(label)) return undefined
  return label
}

/** Known pricing models only. Missing, blank, and unknown values are not a checked price. */
export const canShowPricingCheck = (input: {
  pricing?: string | null
  trialAvailability?: string | null
}): boolean => {
  if (input.pricing !== 'free' && input.pricing !== 'paid' && input.pricing !== 'freemium') return false
  const trial = input.trialAvailability
  if (trial == null) return true
  return trial === 'available' || trial === 'unavailable'
}

/** True only when checkedAt is a real past timestamp more than 90 days before now. */
export const isPricingCheckOutdated = (checkedAt: string | null | undefined, now: Date): boolean => {
  if (!isCatalogTimestampAtOrBefore(checkedAt, now)) return false
  return now.getTime() - Date.parse(checkedAt) > PRICING_CHECK_MAX_AGE_MS
}

/** Oldest public pricing-page source with a page title and a usable checked date. */
export const selectPublicPricingCheck = (
  sources: readonly PricingCheckSource[] | null | undefined,
  now: Date,
): PublicPricingCheck | null => {
  const scanLength = Math.min(sources?.length ?? 0, MAX_PUBLIC_SOURCE_REFERENCES)
  let selected: (PublicPricingCheck & {time: number}) | null = null
  for (let index = 0; index < scanLength; index += 1) {
    const source = sources?.[index]
    if (!source || source.visibility !== 'public' || source.sourceType !== 'pricing_page') continue
    const label = pricingPageTitle(source.title)
    if (!label || !isCatalogTimestampAtOrBefore(source.checkedAt, now)) continue
    const time = Date.parse(source.checkedAt)
    // Keep the oldest date so a freshly checked plan cannot hide a stale one.
    if (!selected || time < selected.time || (time === selected.time && label.localeCompare(selected.source, 'en') < 0)) {
      selected = {checkedAt: source.checkedAt, source: label, time}
    }
  }
  return selected ? {checkedAt: selected.checkedAt, source: selected.source} : null
}

const publicPricingSource = `sourceType == "pricing_page" && visibility == "public" && ${groqHasTrimmedText('title')} && defined(checkedAt) && dateTime(checkedAt) <= dateTime(now())`
const pricingSources = `sourceReferences[0...${MAX_PUBLIC_SOURCE_REFERENCES}][${publicPricingSource}]`

/** Published tools whose oldest public pricing check is more than 90 days old. */
export const PRICING_RECHECK_QUEUE_FILTER = [
  `_type == "tool"`,
  `defined(slug.current)`,
  `seo.noIndex != true`,
  `!(_id in path("drafts.**"))`,
  `!(_id in path("versions.**"))`,
  `count(${pricingSources}[dateTime(checkedAt) < dateTime(now()) - ${PRICING_CHECK_MAX_AGE_SECONDS}]) > 0`,
].join(' && ')
