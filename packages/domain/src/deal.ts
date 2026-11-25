import {getPublicHttpUrl} from './urlSafety.js'
import {canonicalJson} from './canonicalJson.js'
import {sha256Hex} from './sha256.js'

// upstream issue #34 defines the homepage carousel as a maximum of five active Deals.
export const HOMEPAGE_DEAL_LIMIT = 5
// Receipt (2026-08-19): `.github/workflows/reverify.yml` is the measured source
// of truth and schedules one run every 24 hours. Method: baseline 24h cadence +
// one complete missed-run recovery window (24h headroom) = 48h. This hides
// inventory before a second consecutive missed verification can leave it stale.
export const DEAL_SOURCE_CHECK_MAX_AGE_SECONDS = 2 * 24 * 60 * 60

export const DEAL_REVIEW_STATES = ['draft', 'verified', 'expired'] as const
export type DealReviewState = (typeof DEAL_REVIEW_STATES)[number]

export const DEAL_SOURCE_STATUSES = ['unchecked', 'available', 'unavailable'] as const
export type DealSourceStatus = (typeof DEAL_SOURCE_STATUSES)[number]

export interface DealPublicationInput {
  toolId?: string | null
  title?: string | null
  discountPercent?: number | null
  code?: string | null
  description?: string | null
  regions?: string[] | null
  sourceEvidenceClaims?: string[] | null
  affiliateUrlOverride?: string | null
  isActive?: boolean | null
  reviewState?: DealReviewState | null
  reviewedBy?: string | null
  verifiedAt?: string | null
  sourceUrl?: string | null
  sourceCheckedUrl?: string | null
  sourceStatus?: DealSourceStatus | null
  lastSourceCheckedAt?: string | null
  eligibility?: string | null
  termsSummary?: string | null
  commercialDisclosure?: string | null
  validFrom?: string | null
  expiresAt?: string | null
  reviewedContentFingerprint?: string | null
}

const hasText = (value: string | null | undefined): boolean =>
  Boolean(value?.trim())

const timestamp = (value: string | null | undefined): number | null => {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

interface DealPublicationIssue {
  owner: 'human' | 'automation'
  message: string
}

const normalizedText = (value: string | null | undefined): string | null =>
  value?.trim() || null
const normalizedSet = (values: string[] | null | undefined): string[] | null =>
  values ? values.map((value) => value.trim()).sort() : null
const normalizedEvidenceClaims = (
  values: string[] | null | undefined,
): string[] | null => values
  ? values.map((value) => value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim()).sort()
  : null

/**
 * GROQ twin of `isDealActiveAt`/`getDealPublicationIssues`: the Deal is only
 * publicly listable while verified, evidence-backed, inside its validity
 * window, and its evidence source has been re-checked within the reverify
 * cadence. `referenceDateTime` is a GROQ datetime expression — `dateTime(now())`
 * for request-time reads, or a build cutoff literal for static snapshots.
 */
export const buildActiveDealFilter = (referenceDateTime: string): string => `
  isActive == true &&
  reviewState == "verified" &&
  defined(reviewedBy) &&
  defined(verifiedAt) &&
  dateTime(verifiedAt) <= ${referenceDateTime} &&
  ${buildDealSourceCheckFilter(referenceDateTime)} &&
  count(sourceEvidenceClaims) > 0 &&
  defined(reviewedContentFingerprint) &&
  defined(eligibility) &&
  defined(termsSummary) &&
  defined(commercialDisclosure) &&
  defined(expiresAt) &&
  dateTime(expiresAt) > ${referenceDateTime} &&
  (!defined(validFrom) || dateTime(validFrom) <= ${referenceDateTime})
`

export const buildDealSourceCheckFilter = (referenceDateTime: string): string => `
  defined(sourceUrl) &&
  sourceCheckedUrl == sourceUrl &&
  sourceStatus == "available" &&
  defined(lastSourceCheckedAt) &&
  dateTime(lastSourceCheckedAt) >= dateTime(verifiedAt) &&
  dateTime(lastSourceCheckedAt) <= ${referenceDateTime} &&
  dateTime(lastSourceCheckedAt) >= ${referenceDateTime} - ${DEAL_SOURCE_CHECK_MAX_AGE_SECONDS}
`

export const DEAL_SOURCE_CHECK_REVIEW_FILTER = `
  _type == "deal" &&
  !(_id in path("drafts.**")) && !(_id in path("versions.**")) &&
  isActive == true && reviewState == "verified" &&
  dateTime(expiresAt) > dateTime(now()) &&
  !coalesce((${buildDealSourceCheckFilter('dateTime(now())')}), false)
`

export const getDealReviewFingerprint = (deal: DealPublicationInput): string =>
  `sha256:${sha256Hex(canonicalJson({
    toolId: normalizedText(deal.toolId),
    title: normalizedText(deal.title),
    discountPercent: Number.isFinite(deal.discountPercent) ? deal.discountPercent : null,
    code: normalizedText(deal.code),
    description: normalizedText(deal.description),
    eligibility: normalizedText(deal.eligibility),
    regions: normalizedSet(deal.regions),
    termsSummary: normalizedText(deal.termsSummary),
    commercialDisclosure: normalizedText(deal.commercialDisclosure),
    sourceUrl: normalizedText(deal.sourceUrl),
    sourceEvidenceClaims: normalizedEvidenceClaims(deal.sourceEvidenceClaims),
    validFrom: normalizedText(deal.validFrom),
    expiresAt: normalizedText(deal.expiresAt),
  }))}`

const getDealPublicationIssueDetails = (
  deal: DealPublicationInput,
): DealPublicationIssue[] => {
  const issues: DealPublicationIssue[] = []
  const humanIssue = (message: string): void => {
    issues.push({owner: 'human', message})
  }
  const automationIssue = (message: string): void => {
    issues.push({owner: 'automation', message})
  }
  const validFrom = deal.validFrom ? timestamp(deal.validFrom) : null
  const expiresAt = timestamp(deal.expiresAt)

  if (deal.isActive !== true) humanIssue('Mark the deal active before publication.')
  if (deal.reviewState !== 'verified') humanIssue('Verify the deal before publication.')
  if (!hasText(deal.reviewedBy)) humanIssue('Name the human reviewer.')
  if (timestamp(deal.verifiedAt) === null) humanIssue('Add a valid verification time.')
  if (deal.reviewedContentFingerprint !== getDealReviewFingerprint(deal)) {
    humanIssue('Record the current offer content after completing human review.')
  }
  const sourceUrl = getPublicHttpUrl(deal.sourceUrl)
  const sourceCheckedUrl = getPublicHttpUrl(deal.sourceCheckedUrl)
  if (!sourceUrl) humanIssue('Add a public evidence source URL.')
  if (!deal.sourceEvidenceClaims?.some(hasText)) {
    humanIssue('Add at least one exact source evidence excerpt.')
  }
  if (sourceUrl && sourceCheckedUrl !== sourceUrl) {
    automationIssue('Wait for the current evidence source URL to be checked.')
  }
  if (deal.sourceStatus !== 'available') automationIssue('Confirm the evidence source is available.')
  if (timestamp(deal.lastSourceCheckedAt) === null) automationIssue('Wait for a valid source check time.')
  const verifiedAt = timestamp(deal.verifiedAt)
  const lastSourceCheckedAt = timestamp(deal.lastSourceCheckedAt)
  if (
    verifiedAt !== null &&
    lastSourceCheckedAt !== null &&
    lastSourceCheckedAt < verifiedAt
  ) {
    automationIssue('Wait for the evidence source to be checked after human review.')
  }
  if (!hasText(deal.eligibility)) humanIssue('Describe who is eligible.')
  if (!hasText(deal.termsSummary)) humanIssue('Summarize the material terms.')
  if (!hasText(deal.commercialDisclosure)) humanIssue('Add a commercial disclosure.')
  if (expiresAt === null) humanIssue('Add a valid expiry time.')
  if (deal.validFrom && validFrom === null) humanIssue('Add a valid start time.')
  if (validFrom !== null && expiresAt !== null && expiresAt <= validFrom) {
    humanIssue('Deal expiry must be after its start time.')
  }

  return issues
}

export const getDealPublicationIssues = (deal: DealPublicationInput): string[] =>
  getDealPublicationIssueDetails(deal).map(({message}) => message)

export const getDealHumanReviewIssues = (deal: DealPublicationInput): string[] => {
  return getDealPublicationIssueDetails(deal)
    .filter(({owner}) => owner === 'human')
    .map(({message}) => message)
}

export const isDealActiveAt = (
  deal: DealPublicationInput,
  referenceTime: string | Date,
): boolean => {
  if (getDealPublicationIssues(deal).length > 0) return false

  const reference = referenceTime instanceof Date
    ? referenceTime.getTime()
    : timestamp(referenceTime)
  const verifiedAt = timestamp(deal.verifiedAt)
  const validFrom = deal.validFrom ? timestamp(deal.validFrom) : null
  const expiresAt = timestamp(deal.expiresAt)
  const lastSourceCheckedAt = timestamp(deal.lastSourceCheckedAt)

  if (
    reference === null ||
    !Number.isFinite(reference) ||
    verifiedAt === null ||
    lastSourceCheckedAt === null ||
    expiresAt === null
  ) {
    return false
  }

  return verifiedAt <= reference
    && lastSourceCheckedAt <= reference
    && reference - lastSourceCheckedAt <= DEAL_SOURCE_CHECK_MAX_AGE_SECONDS * 1_000
    && (validFrom === null || validFrom <= reference)
    && reference < expiresAt
}
