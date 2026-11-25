import {z} from 'zod'
import {isSafePublicText} from './publicText.js'
import {normalizePublicSourceReferenceUrl} from './sourceReference.js'

// The 10–20 pair pilot is an editorial release requirement (upstream #402), not a
// catalog growth estimate. See upstream docs/measurements/comparison-publication-2026-09-26.md.
export const COMPARISON_PILOT_MAX_PAIRS = 20
export const COMPARISON_PILOT_MIN_INDEXABLE_PAIRS = 10
export const COMPARISON_REVIEW_MAX_AGE_DAYS = 90
export const COMPARISON_RESEARCH_MAX_LENGTH = 2000
export const COMPARISON_GUIDANCE_MAX_LENGTH = 4000
export const COMPARISON_MAX_EVIDENCE_URLS = 10
export const COMPARISON_FIELD_LIMITS = {
  customRows: 20, toolFeatures: 20, toolFactItems: 10, securityClaims: 20, platforms: 5,
} as const
export const COMPARISON_ARTIFACT_MAX_BYTES = 4 * 1024 * 1024

export const assertComparisonArtifactSize = (contents: string): void => {
  const bytes = new TextEncoder().encode(contents).byteLength
  if (bytes > COMPARISON_ARTIFACT_MAX_BYTES) throw new Error(`comparison_publication:payload_too_large: limit_bytes=${COMPARISON_ARTIFACT_MAX_BYTES}, actual_bytes=${bytes}; shorten reviewed content or remeasure the documented budget`)
}

export const comparisonPublicTextSchema = (maximum: number) => z.string()
  .min(1).max(maximum).refine(isSafePublicText, 'Use trimmed text without control or bidi characters')

export const comparisonEvidenceUrlSchema = z.string().max(2048).refine((value) => {
  if (normalizePublicSourceReferenceUrl(value) !== value) return false
  const url = new URL(value)
  let path: string
  try { path = decodeURIComponent(url.pathname).replace(/\\/g, '/').replace(/^\/+/, '/').toLowerCase() } catch { return false }
  return url.protocol === 'https:' && !url.search && !url.hash && !/%[0-9a-f]{2}/i.test(path)
    && !/^\/(?:go|api|admin|account|studio|private)(?:\/|$)/.test(path)
}, 'Use a canonical public HTTPS evidence URL without credentials, query, fragment, or tracked redirect')

const optionalText = (maximum: number) => comparisonPublicTextSchema(maximum).nullish()

/** Research notes are private build inputs; only reviewed guidance is public. */
export const comparisonPublicationSchema = z.object({
  status: z.enum(['unreviewed', 'approved']).default('unreviewed'),
  publishedAt: z.iso.datetime({offset: true}).max(40).nullish(),
  experimental: z.boolean().default(false),
  distinctIntentEvidence: optionalText(COMPARISON_RESEARCH_MAX_LENGTH),
  distinctIntentEvidenceDate: z.iso.date().nullish(),
  competitorResearch: optionalText(COMPARISON_RESEARCH_MAX_LENGTH),
  competitorResearchDate: z.iso.date().nullish(),
  uniqueDecisionGuidance: optionalText(COMPARISON_GUIDANCE_MAX_LENGTH),
  selectionMethodology: optionalText(COMPARISON_RESEARCH_MAX_LENGTH),
  reviewer: optionalText(160),
  reviewedAt: z.iso.date().nullish(),
  reviewFingerprint: z.string().regex(/^[a-f0-9]{64}$/).nullish(),
  reviewedAtInstant: z.iso.datetime().nullish(),
  materialClaimEvidenceUrls: z.array(comparisonEvidenceUrlSchema).max(COMPARISON_MAX_EVIDENCE_URLS).default([]),
})

export type ComparisonPublication = z.infer<typeof comparisonPublicationSchema>
