import {groqHasTrimmedText} from './groqText.js'
import {CURRENT_ALTERNATIVES_REVIEW_FILTER, hasAlternativesCoverage, type ToolAlternativesReview} from './toolAlternativesReview.js'
import {REGISTRY_OBSERVATIONS_NEEDING_REVIEW_FILTER} from './registryObservationFreshness.js'
import {COMPARISON_REVIEW_MAX_AGE_DAYS, COMPARISON_PILOT_MIN_INDEXABLE_PAIRS} from './comparisonPublication.js'
import {hasRuntimeObjectType, isRuntimeBoolean, isRuntimeNumber, isRuntimeString} from './runtimeValidation.js'
import type {JsonValue} from './jsonValue.js'
import {resolveResourceIdentity, type ResourceIdentityInput} from './resourceIdentity.js'
import {isResourceKind, RESOURCE_KIND_VALUES, resourceKindRequiresPricingAndPlatform} from './resourceKind.js'
import {validatePublicHttpUrl} from './urlSafety.js'
import {
  MAX_TOOL_FIT_GUIDANCE_ITEMS,
  validateFeaturedToolFitGuidance,
} from './toolFitGuidance.js'
import {PUBLIC_TEXT_UNSAFE_CHARACTERS} from './publicText.js'
import {
  EDITORIAL_EVIDENCE_EXEMPTION,
  isEditorialPublicationCandidate,
  validateCuratedListEvidenceReadiness,
  validateToolStackEvidenceReadiness,
} from './editorialRecommendationEvidence.js'
import {
  MAX_PUBLIC_SOURCE_REFERENCE_URL_LENGTH,
  MAX_PUBLIC_SOURCE_REFERENCES,
  SOURCE_REFERENCE_TYPE_VALUES,
  type SourceReferenceInput,
} from './sourceReference.js'
import {MEDIA_CAPTURE_STALE_AFTER_SECONDS} from './mediaCaptureFreshness.js'
import {MAX_PUBLIC_EVIDENCE_CLOCK_SKEW_MS} from './publicToolIntegrationFact.js'
import {buildActiveDealFilter, DEAL_SOURCE_CHECK_REVIEW_FILTER} from './deal.js'
import {
  LIVING_CATALOG_FRESHNESS_QUERY_FIELDS,
  LIVING_CATALOG_READINESS_RULES,
} from './livingCatalogFreshness.js'

export type LaunchReadinessStatus = 'ready' | 'warning' | 'blocking'
export type LaunchReadinessSeverity = 'warning' | 'blocking'
export type LaunchReadinessCountKey = keyof LaunchReadinessCounts
export type LaunchReadinessSource = 'sanity' | 'fixture'

export type LaunchReadinessCounts = {
  publishedUseCases?: number
  publishedTools: number
  toolsMissingCoreFields: number
  toolsMissingPublishedCategories: number
  toolsMissingUseCases: number
  toolsMissingAlternatives: number
  toolsWithThinAlternatives: number
  categoriesWithoutTools: number
  useCasesWithoutTools: number
  categoriesNeedingReview: number
  articlesNeedingReview: number
  integrationFactsNeedingReview: number
  publishersAwaitingApproval: number
  registrySweepOverdue: number
  registryObservationsNeedingReview: number
  reviewedComparisonPairs: number
  comparisonsNeedingReview: number
  articlesMissingPublicTools: number
  toolsNeedingDubRegeneration: number
  publishedToolStacks: number
  toolStacksNeedingReview: number
  publishedBestOfLists: number
  bestOfListsNeedingReview: number
  pendingSubmissions: number
  pendingCorrectionReports: number
  flaggedDeadDestinationTools: number
  bestOfListsFailingQualityGates: number
  toolStacksFailingQualityGates: number
  bestOfListsMissingRecommendationEvidence: number
  toolStacksMissingRecommendationEvidence: number
  featuredToolsMissingFitGuidance: number
  useCasesMissingDescriptions: number
  toolsNeedingMediaReview: number
  toolsOverdueForWebsiteCheck: number
  toolsAffectedByMissingCrawlActivity: number
  activePublicDeals: number
  dealsNeedingSourceChecks: number
  enabledSearchAliases: number
}

export type LaunchReadinessToolProjection = {
  resourceKind?: string | null
  hasDescription: boolean
  hasLongDescription: boolean
  hasLogo: boolean
  hasPricing: boolean
  hasPlatforms: boolean
  hasCategories: boolean
  hasKeyFeatures: boolean
  hasOversizedDestination: boolean
  website?: string | null
  resourceIdentity?: ResourceIdentityInput | null
}

export type LaunchReadinessEditorialEvidenceEntryProjection = {
  description?: string | null
  editorialBlurb?: string | null
  evidenceExemption?: string | null
  hasDescription?: boolean | null
  sourceReferences?: SourceReferenceInput[] | null
}

export type LaunchReadinessEditorialEvidenceDocumentProjection = {
  entries?: LaunchReadinessEditorialEvidenceEntryProjection[] | null
}

export type LaunchReadinessPublicQueryResult = Omit<
  LaunchReadinessCounts,
  | 'toolsMissingCoreFields'
  | 'bestOfListsMissingRecommendationEvidence'
  | 'toolStacksMissingRecommendationEvidence'
  | 'pendingSubmissions'
  | 'pendingCorrectionReports'
  | 'publishersAwaitingApproval'
  | 'registrySweepOverdue'
  | 'toolsNeedingDubRegeneration'
> &
  Partial<
    Pick<
      LaunchReadinessCounts,
      'bestOfListsMissingRecommendationEvidence' | 'toolStacksMissingRecommendationEvidence'
    >
  > & {
  coreFieldTools?: LaunchReadinessToolProjection[] | null
  bestOfRecommendationEvidence?: LaunchReadinessEditorialEvidenceDocumentProjection[] | null
  toolStackRecommendationEvidence?: LaunchReadinessEditorialEvidenceDocumentProjection[] | null
}

export type LaunchReadinessQueryResult = LaunchReadinessPublicQueryResult & {
  registrySweepOverdue: number
  publishersAwaitingApproval: number
  toolsNeedingDubRegeneration: number
  pendingSubmissions: number
  pendingCorrectionReports: number
}

export type LaunchReadinessRule = {
  id: string
  countKey: LaunchReadinessCountKey
  severity: LaunchReadinessSeverity
  target: {type: 'zero'} | {type: 'minimum'; minimum: number}
  label: string
  actionLabel: string
  studioPath: string
  description: string
}

export type LaunchReadinessSignal = {
  id: string
  label: string
  severity: LaunchReadinessSeverity
  count: number
  status: LaunchReadinessStatus
  actionLabel: string
  studioPath: string
  description: string
}

export type LaunchReadinessSummary = {
  status: LaunchReadinessStatus
  readyCount: number
  warningCount: number
  blockingCount: number
  signals: LaunchReadinessSignal[]
}

export type LaunchReadinessAvailableReport = {
  schemaVersion: typeof LAUNCH_READINESS_REPORT_SCHEMA_VERSION
  generatedAt: string
  source: LaunchReadinessSource
  status: LaunchReadinessStatus
  aggregates: {ready: number; warning: number; blocking: number}
  rules: Array<{
    id: string
    severity: LaunchReadinessSeverity
    count: number
    status: LaunchReadinessStatus
  }>
}

export type LaunchReadinessUnavailableReport = {
  schemaVersion: typeof LAUNCH_READINESS_REPORT_SCHEMA_VERSION
  generatedAt: string
  source: 'none'
  status: 'unknown' | 'invalid_configuration'
  reason: 'upstream_failure' | 'invalid_configuration'
  constraint?: {
    code: 'input_budget_exceeded'
    limitBytes: number
    actualBytes: number
    recovery: string
  }
  aggregates: {ready: null; warning: null; blocking: null}
  rules: Array<{
    id: string
    severity: LaunchReadinessSeverity
    count: null
    status: 'unknown'
  }>
}

export type LaunchReadinessReport =
  LaunchReadinessAvailableReport | LaunchReadinessUnavailableReport

export const LAUNCH_READINESS_REPORT_SCHEMA_VERSION = '1.0.0' as const
export const LAUNCH_READINESS_MAX_PROJECTED_TOOLS = 1_000
export const LAUNCH_READINESS_MAX_PROJECTED_EDITORIAL_DOCUMENTS = 1_000
export const LAUNCH_READINESS_MAX_PROJECTED_EDITORIAL_ENTRIES = 100
export const LAUNCH_READINESS_MAX_PROJECTED_EDITORIAL_TOTAL_ENTRIES = 1_000
export const LAUNCH_READINESS_MAX_PROJECTED_EDITORIAL_SOURCE_CANDIDATES = 32
export const LAUNCH_READINESS_MAX_PROJECTED_EDITORIAL_RAW_TITLE_LENGTH = 2_048
export const LAUNCH_READINESS_PROJECTION_BUDGET_BYTES = 512_000
export const LAUNCH_READINESS_MAX_INPUT_BYTES = 512_000
export const LAUNCH_READINESS_MAX_OUTPUT_BYTES = 65_536
export const LAUNCH_READINESS_MAX_DESTINATION_LENGTH = 2_048
/**
 * Public Tool count at which a Category page with no editorial body needs
 * review. Measured 2026-09-15: production categories top out at 1 Tool each
 * (7 categories, max = 1), so the rule is inert today and fires only once a
 * category offers enough choice that "how to choose" prose earns its place.
 */
export const CATEGORY_BODY_TOOL_COUNT_THRESHOLD = 10

export const LAUNCH_QUALITY_POLICY = {
  minimumEditorialTools: 3,
  messages: {
    curatedListMinimum:
      'Published Best-of lists need at least 3 public ranked tools for launch-quality pages.',
    curatedListBlurb: 'Every ranked tool in a published Best-of list needs an editorial blurb.',
    toolStackMinimum:
      'Published Tool Stacks need at least 3 public tools for launch-quality pages.',
    toolStackRoles:
      'Every tool in a published Tool Stack needs a role label and either a description or the descriptive role-only exemption.',
  },
} as const

const PUBLIC_REFERENCE_FILTER = `defined(@->_id) && !(@->_id in path("drafts.**")) && @->seo.noIndex != true`
const GROQ_UNSAFE_PUBLIC_TEXT_CHARACTERS = JSON.stringify(PUBLIC_TEXT_UNSAFE_CHARACTERS)
// Keep queue eligibility aligned with the public normalizer for unsafe characters
// and list cardinality. Statement length is intentionally checked only by the
// canonical validator: it collapses whitespace before applying the 240-character
// limit, which cannot be represented faithfully by the current GROQ helpers.
const groqHasSafePublicText = (field: string): string =>
  `${groqHasTrimmedText(field)} && count(string::split(${field}, "")[@ in ${GROQ_UNSAFE_PUBLIC_TEXT_CHARACTERS}]) == 0`
const groqHasSafeGuidanceList = (field: string): string =>
  `coalesce(count(${field}), 0) <= ${MAX_TOOL_FIT_GUIDANCE_ITEMS} && coalesce(count(${field}[${groqHasSafePublicText('@')}]), 0) > 0`
export const LAUNCH_READINESS_PUBLISHED_CATEGORY_REFERENCE_FILTER =
  `${PUBLIC_REFERENCE_FILTER} && @->_type == "category" && ${groqHasTrimmedText('@->slug.current')}`
/** The catalog count includes every public resource kind, including reference sites and vendor guides. */
const PUBLISHED_TOOL_FILTER =
  `_type == "tool" && defined(slug.current) && seo.noIndex != true && !(_id in path("drafts.**"))`
const MEDIA_CAPTURE_FUTURE_SKEW_SECONDS = MAX_PUBLIC_EVIDENCE_CLOCK_SKEW_MS / 1000
/**
 * Primary media is the first gallery item: images carry `image.capturedAt`,
 * videos carry `publishedAt`. Missing, stale, or future dates flag the Tool
 * for media review — never counted as fresh.
 */
export const LAUNCH_READINESS_TOOL_MEDIA_REVIEW_FILTER =
  `${PUBLISHED_TOOL_FILTER} && (
    (mediaGallery[0].type == "image"
      && (!defined(mediaGallery[0].image.capturedAt)
        || dateTime(mediaGallery[0].image.capturedAt + "T00:00:00Z") < dateTime(now()) - ${MEDIA_CAPTURE_STALE_AFTER_SECONDS}
        || dateTime(mediaGallery[0].image.capturedAt + "T00:00:00Z") > dateTime(now()) + ${MEDIA_CAPTURE_FUTURE_SKEW_SECONDS}))
    || (mediaGallery[0].type == "video"
      && (!defined(mediaGallery[0].publishedAt)
        || dateTime(mediaGallery[0].publishedAt) < dateTime(now()) - ${MEDIA_CAPTURE_STALE_AFTER_SECONDS}
        || dateTime(mediaGallery[0].publishedAt) > dateTime(now()) + ${MEDIA_CAPTURE_FUTURE_SKEW_SECONDS}))
  )`
export const LAUNCH_READINESS_NO_PUBLISHED_CATEGORY_FILTER =
  `${PUBLISHED_TOOL_FILTER} && !defined(categories[${LAUNCH_READINESS_PUBLISHED_CATEGORY_REFERENCE_FILTER}][0])`
export const LAUNCH_READINESS_FEATURED_TOOL_MISSING_FIT_GUIDANCE_FILTER = `${PUBLISHED_TOOL_FILTER} && !defined(successorTool) && visibility == "featured" && (
  !(${groqHasSafeGuidanceList('fitGuidance.bestFor')})
  || (
    !(${groqHasSafeGuidanceList('fitGuidance.notIdealFor')})
    && !(${groqHasSafePublicText('fitGuidance.recommendedNextStep')})
  )
)`
const PUBLIC_EDITORIAL_TOOL_FILTER = `defined(tool._ref) && defined(tool->_id) && !(tool->_id in path("drafts.**")) && tool->seo.noIndex != true`
/** Public editorial pickers must resolve to a published, indexable, active Tool. */
export const PUBLIC_TOOL_PICKER_FILTER = `${PUBLISHED_TOOL_FILTER} && !(_id in path("versions.**")) && !defined(successorTool)`
const PUBLISHED_AT_FILTER = `defined(publishedAt) && publishedAt <= now()`
export const ARTICLES_NEEDING_REVIEW_FILTER = `_type == "blogPost" && ${PUBLISHED_AT_FILTER} && defined(slug.current) && seo.noIndex != true && !(_id in path("drafts.**")) && !(_id in path("versions.**")) && (!defined(reviewedAt) || (defined(nextReviewAt) && nextReviewAt <= now()))`
export const ARTICLES_MISSING_PUBLIC_TOOLS_FILTER = `_type == "blogPost" && ${PUBLISHED_AT_FILTER}
  && seo.noIndex != true && !(_id in path("drafts.**")) && !(_id in path("versions.**"))
  && coalesce(count(relatedTools[defined(@->_id) && @->_type == "tool" && defined(@->slug.current)
    && !(@->_id in path("drafts.**")) && !(@->_id in path("versions.**"))
    && @->seo.noIndex != true && !defined(@->successorTool)]), 0) == 0`
const PUBLISHED_APPROVED_COMPARISON_FILTER = `_type == "comparison" && !(_id in path("drafts.**")) && !(_id in path("versions.**")) && publication.status == "approved"`
const COMPARISON_REVIEW_CURRENT_FILTER = `defined(publication.reviewedAtInstant)
  && dateTime(publication.reviewedAt + "T00:00:00Z") >= dateTime(now()) - ${COMPARISON_REVIEW_MAX_AGE_DAYS * 24 * 60 * 60}
  && dateTime(publication.reviewedAtInstant) <= dateTime(now())
  && !coalesce(dateTime(toolA->lastUpdated) > dateTime(publication.reviewedAtInstant), false)
  && !coalesce(dateTime(toolB->lastUpdated) > dateTime(publication.reviewedAtInstant), false)`
export const COMPARISONS_NEEDING_REVIEW_FILTER = `${PUBLISHED_APPROVED_COMPARISON_FILTER} && !coalesce((${COMPARISON_REVIEW_CURRENT_FILTER}), false)`
export const REVIEWED_COMPARISON_PAIRS_FILTER = `${PUBLISHED_APPROVED_COMPARISON_FILTER} && ${COMPARISON_REVIEW_CURRENT_FILTER}
  && publication.experimental != true && defined(publication.publishedAt) && publication.publishedAt <= now()
  && toolA->_type == "tool" && toolB->_type == "tool" && defined(toolA->slug.current) && defined(toolB->slug.current) && toolA->_id != toolB->_id
  && toolA->seo.noIndex != true && toolB->seo.noIndex != true
  && !defined(toolA->successorTool) && !defined(toolB->successorTool)
  && !(toolA->_id in path("drafts.**")) && !(toolB->_id in path("drafts.**"))
  && !(toolA->_id in path("versions.**")) && !(toolB->_id in path("versions.**"))`
// Integration claims share the reviewed editorial-claim cadence; see upstream docs/integration-discovery.md.
export const INTEGRATION_FACTS_NEEDING_REVIEW_FILTER = `${PUBLISHED_TOOL_FILTER} && !(_id in path("versions.**")) && count(integrations[
  status in ["native", "api", "via_automation", "via_extension"] &&
  (!defined(checkedAt) || dateTime(checkedAt) < dateTime(now()) - ${COMPARISON_REVIEW_MAX_AGE_DAYS * 24 * 60 * 60})
]) > 0`
export const PUBLISHERS_AWAITING_APPROVAL_FILTER = '_type == "publisher" && approved != true'
export const TOOLS_NEEDING_DUB_REGENERATION_FILTER = '_type == "tool" && needsDubRegeneration == true && seo.noIndex != true && !defined(successorTool)'
export const CATEGORIES_NEEDING_REVIEW_FILTER = `_type == "category" && defined(slug.current) && seo.noIndex != true && !(_id in path("drafts.**"))
    && (
      (defined(body[0]) && (!defined(reviewedAt) || (defined(nextReviewAt) && nextReviewAt <= now())))
      || (!defined(body[0]) && count(*[
        _type == "tool" && defined(slug.current) && seo.noIndex != true
        && !(_id in path("drafts.**")) && references(^._id)
      ]) >= ${CATEGORY_BODY_TOOL_COUNT_THRESHOLD})
    )`
const EDITORIAL_QUALITY_FILTER = groqHasTrimmedText('publishedAt')
const CURATED_LIST_EVIDENCE_DOCUMENT_FILTER = `_type == "curatedList" && ${EDITORIAL_QUALITY_FILTER} && seo.noIndex != true && !(_id in path("drafts.**"))`
const TOOL_STACK_EVIDENCE_DOCUMENT_FILTER = `_type == "toolStack" && ${EDITORIAL_QUALITY_FILTER} && seo.noIndex != true && !(_id in path("drafts.**"))`
const BOUNDED_PUBLIC_EDITORIAL_SOURCE_FILTER = `
  visibility == "public"
  && defined(title)
  && length(title) <= ${LAUNCH_READINESS_MAX_PROJECTED_EDITORIAL_RAW_TITLE_LENGTH}
  && defined(url)
  && length(url) <= ${MAX_PUBLIC_SOURCE_REFERENCE_URL_LENGTH}
  && sourceType in ${JSON.stringify(SOURCE_REFERENCE_TYPE_VALUES)}
`
const buildEditorialEntryCount = (documentFilter: string, entryField: string): string =>
  `coalesce(math::sum(*[${documentFilter}]{"value": count(${entryField}[${PUBLIC_EDITORIAL_TOOL_FILTER}])}.value), 0)`
const buildEditorialSourceCandidateCount = (documentFilter: string, entryField: string): string =>
  `coalesce(math::sum(*[${documentFilter}]{"value": coalesce(math::sum(${entryField}[${PUBLIC_EDITORIAL_TOOL_FILTER}]{"value": count(sourceReferences[0...${MAX_PUBLIC_SOURCE_REFERENCES}][${BOUNDED_PUBLIC_EDITORIAL_SOURCE_FILTER}])}.value), 0)}.value), 0)`
const buildOversizedEditorialSourceTitleCount = (
  documentFilter: string,
  entryField: string,
): string =>
  `coalesce(math::sum(*[${documentFilter}]{"value": coalesce(math::sum(${entryField}[${PUBLIC_EDITORIAL_TOOL_FILTER}]{"value": count(sourceReferences[0...${MAX_PUBLIC_SOURCE_REFERENCES}][visibility == "public" && defined(title) && length(title) > ${LAUNCH_READINESS_MAX_PROJECTED_EDITORIAL_RAW_TITLE_LENGTH}])}.value), 0)}.value), 0)`

export const LAUNCH_READINESS_QUERY = `{
  ${LIVING_CATALOG_FRESHNESS_QUERY_FIELDS},
  "publishedTools": count(*[
    ${PUBLISHED_TOOL_FILTER}
  ]),
  "toolsMissingPublishedCategories": count(*[
    ${LAUNCH_READINESS_NO_PUBLISHED_CATEGORY_FILTER}
  ]),
  "coreFieldTools": *[
    ${PUBLISHED_TOOL_FILTER}
  ] | order(_id asc) [0...${LAUNCH_READINESS_MAX_PROJECTED_TOOLS + 1}]{
    "resourceKind": select(resourceKind in ${JSON.stringify(RESOURCE_KIND_VALUES)} => resourceKind),
    "hasDescription": defined(description),
    "hasLongDescription": defined(longDescription),
    "hasLogo": defined(logo),
    "hasPricing": defined(pricing),
    "hasPlatforms": defined(platforms[0]),
    "hasCategories": defined(categories[${LAUNCH_READINESS_PUBLISHED_CATEGORY_REFERENCE_FILTER}][0]),
    "hasKeyFeatures": defined(keyFeatures[0]),
    "website": select(
      !defined(website) || length(website) <= ${LAUNCH_READINESS_MAX_DESTINATION_LENGTH} => website
    ),
    resourceIdentity{
      "kind": select(!defined(kind) || length(kind) <= ${LAUNCH_READINESS_MAX_DESTINATION_LENGTH} => kind),
      "canonicalUrl": select(!defined(canonicalUrl) || length(canonicalUrl) <= ${LAUNCH_READINESS_MAX_DESTINATION_LENGTH} => canonicalUrl),
      "registryId": select(!defined(registryId) || length(registryId) <= ${LAUNCH_READINESS_MAX_DESTINATION_LENGTH} => registryId),
      "websiteUrl": select(!defined(websiteUrl) || length(websiteUrl) <= ${LAUNCH_READINESS_MAX_DESTINATION_LENGTH} => websiteUrl),
      "repositoryUrl": select(!defined(repositoryUrl) || length(repositoryUrl) <= ${LAUNCH_READINESS_MAX_DESTINATION_LENGTH} => repositoryUrl),
      "docsUrl": select(!defined(docsUrl) || length(docsUrl) <= ${LAUNCH_READINESS_MAX_DESTINATION_LENGTH} => docsUrl),
      "packageUrl": select(!defined(packageUrl) || length(packageUrl) <= ${LAUNCH_READINESS_MAX_DESTINATION_LENGTH} => packageUrl),
      "mcpRegistryUrl": select(!defined(mcpRegistryUrl) || length(mcpRegistryUrl) <= ${LAUNCH_READINESS_MAX_DESTINATION_LENGTH} => mcpRegistryUrl)
    },
    "hasOversizedDestination":
      (defined(website) && length(website) > ${LAUNCH_READINESS_MAX_DESTINATION_LENGTH})
      || (defined(resourceIdentity.canonicalUrl) && length(resourceIdentity.canonicalUrl) > ${LAUNCH_READINESS_MAX_DESTINATION_LENGTH})
      || (defined(resourceIdentity.kind) && length(resourceIdentity.kind) > ${LAUNCH_READINESS_MAX_DESTINATION_LENGTH})
      || (defined(resourceIdentity.registryId) && length(resourceIdentity.registryId) > ${LAUNCH_READINESS_MAX_DESTINATION_LENGTH})
      || (defined(resourceIdentity.websiteUrl) && length(resourceIdentity.websiteUrl) > ${LAUNCH_READINESS_MAX_DESTINATION_LENGTH})
      || (defined(resourceIdentity.repositoryUrl) && length(resourceIdentity.repositoryUrl) > ${LAUNCH_READINESS_MAX_DESTINATION_LENGTH})
      || (defined(resourceIdentity.docsUrl) && length(resourceIdentity.docsUrl) > ${LAUNCH_READINESS_MAX_DESTINATION_LENGTH})
      || (defined(resourceIdentity.packageUrl) && length(resourceIdentity.packageUrl) > ${LAUNCH_READINESS_MAX_DESTINATION_LENGTH})
      || (defined(resourceIdentity.mcpRegistryUrl) && length(resourceIdentity.mcpRegistryUrl) > ${LAUNCH_READINESS_MAX_DESTINATION_LENGTH})
  },
  "publishedUseCases": count(*[_type == "useCase" && defined(slug.current) && seo.noIndex != true && !(_id in path("drafts.**"))]),
  "toolsMissingUseCases": count(*[
    _type == "tool" && defined(slug.current) && seo.noIndex != true
    && !(_id in path("drafts.**")) && !defined(useCases[0])
  ]),
  "toolsMissingAlternatives": count(*[
    _type == "tool" && defined(slug.current) && seo.noIndex != true && !(_id in path("drafts.**"))
    && !coalesce(${CURRENT_ALTERNATIVES_REVIEW_FILTER}, false)
    && coalesce(count(alternativeTools[${PUBLIC_REFERENCE_FILTER} && @->_type == "tool" && defined(@->slug.current)]), 0) == 0
  ]),
  "toolsWithThinAlternatives": count(*[
    _type == "tool" && defined(slug.current) && seo.noIndex != true && !(_id in path("drafts.**"))
    && !coalesce(${CURRENT_ALTERNATIVES_REVIEW_FILTER}, false)
    && count(alternativeTools[${PUBLIC_REFERENCE_FILTER} && @->_type == "tool" && defined(@->slug.current)]) == 1
  ]),
  "categoriesWithoutTools": count(*[
    _type == "category" && defined(slug.current) && seo.noIndex != true && !(_id in path("drafts.**"))
    && count(*[
      _type == "tool" && defined(slug.current) && seo.noIndex != true
      && !(_id in path("drafts.**")) && references(^._id)
    ]) == 0
  ]),
  "useCasesWithoutTools": count(*[
    _type == "useCase" && defined(slug.current) && seo.noIndex != true && !(_id in path("drafts.**"))
    && count(*[
      _type == "tool" && defined(slug.current) && seo.noIndex != true
      && !(_id in path("drafts.**")) && references(^._id)
    ]) == 0
  ]),
  "categoriesNeedingReview": count(*[${CATEGORIES_NEEDING_REVIEW_FILTER}]),
  "articlesNeedingReview": count(*[${ARTICLES_NEEDING_REVIEW_FILTER}]),
  "integrationFactsNeedingReview": count(*[${INTEGRATION_FACTS_NEEDING_REVIEW_FILTER}]),
  "registryObservationsNeedingReview": count(*[${REGISTRY_OBSERVATIONS_NEEDING_REVIEW_FILTER}]),
  "reviewedComparisonPairs": count(*[${REVIEWED_COMPARISON_PAIRS_FILTER}]),
  "comparisonsNeedingReview": count(*[${COMPARISONS_NEEDING_REVIEW_FILTER}]),
  "articlesMissingPublicTools": count(*[${ARTICLES_MISSING_PUBLIC_TOOLS_FILTER}]),
  "publishedToolStacks": count(*[
    _type == "toolStack" && defined(slug.current) && ${PUBLISHED_AT_FILTER}
    && seo.noIndex != true && !(_id in path("drafts.**"))
  ]),
  "toolStacksNeedingReview": count(*[
    _type == "toolStack" && defined(slug.current) && ${PUBLISHED_AT_FILTER}
    && seo.noIndex != true && !(_id in path("drafts.**"))
    && (!defined(reviewedAt) || (defined(nextReviewAt) && nextReviewAt <= now()))
  ]),
  "publishedBestOfLists": count(*[
    _type == "curatedList" && defined(slug.current) && ${PUBLISHED_AT_FILTER}
    && seo.noIndex != true && !(_id in path("drafts.**"))
  ]),
  "bestOfListsNeedingReview": count(*[
    _type == "curatedList" && defined(slug.current) && ${PUBLISHED_AT_FILTER}
    && seo.noIndex != true && !(_id in path("drafts.**"))
    && (!defined(reviewedAt) || (defined(nextReviewAt) && nextReviewAt <= now()))
  ]),
  "flaggedDeadDestinationTools": count(*[
    _type == "tool" && hasDeadDestination == true && !(_id in path("drafts.**"))
  ]),
  "bestOfListsFailingQualityGates": count(*[
    _type == "curatedList" && ${EDITORIAL_QUALITY_FILTER}
    && seo.noIndex != true && !(_id in path("drafts.**"))
    && (
      coalesce(count(rankedTools[
        defined(tool._ref) && defined(tool->_id)
        && !(tool->_id in path("drafts.**")) && tool->seo.noIndex != true
      ]), 0) < ${LAUNCH_QUALITY_POLICY.minimumEditorialTools}
      || coalesce(count(rankedTools[
        defined(tool._ref) && defined(tool->_id)
        && !(tool->_id in path("drafts.**")) && tool->seo.noIndex != true
        && !(${groqHasTrimmedText('editorialBlurb')})
      ]), 0) > 0
    )
  ]),
  "toolStacksFailingQualityGates": count(*[
    _type == "toolStack" && ${EDITORIAL_QUALITY_FILTER}
    && seo.noIndex != true && !(_id in path("drafts.**"))
    && (
      coalesce(count(tools[
        defined(tool._ref) && defined(tool->_id)
        && !(tool->_id in path("drafts.**")) && tool->seo.noIndex != true
      ]), 0) < ${LAUNCH_QUALITY_POLICY.minimumEditorialTools}
      || coalesce(count(tools[
        defined(tool._ref) && defined(tool->_id)
        && !(tool->_id in path("drafts.**")) && tool->seo.noIndex != true
        && (
          !(${groqHasTrimmedText('role')})
          || (!(${groqHasTrimmedText('description')})
            && evidenceExemption != "${EDITORIAL_EVIDENCE_EXEMPTION}")
        )
      ]), 0) > 0
    )
  ]),
  "bestOfRecommendationEvidence": select(
    ${buildEditorialEntryCount(CURATED_LIST_EVIDENCE_DOCUMENT_FILTER, 'rankedTools')}
      <= ${LAUNCH_READINESS_MAX_PROJECTED_EDITORIAL_TOTAL_ENTRIES}
    && ${buildEditorialSourceCandidateCount(CURATED_LIST_EVIDENCE_DOCUMENT_FILTER, 'rankedTools')}
      <= ${LAUNCH_READINESS_MAX_PROJECTED_EDITORIAL_SOURCE_CANDIDATES}
    && ${buildOversizedEditorialSourceTitleCount(CURATED_LIST_EVIDENCE_DOCUMENT_FILTER, 'rankedTools')} == 0
    => *[${CURATED_LIST_EVIDENCE_DOCUMENT_FILTER}]
      | order(_id asc) [0...${LAUNCH_READINESS_MAX_PROJECTED_EDITORIAL_DOCUMENTS + 1}]{
        "entries": coalesce(
          rankedTools[${PUBLIC_EDITORIAL_TOOL_FILTER}]
            [0...${LAUNCH_READINESS_MAX_PROJECTED_EDITORIAL_ENTRIES + 1}]{
              "sourceReferences": sourceReferences[0...${MAX_PUBLIC_SOURCE_REFERENCES}]
                [${BOUNDED_PUBLIC_EDITORIAL_SOURCE_FILTER}]{
                  title,
                  url,
                  sourceType,
                  visibility
                }
            },
          []
        )
      }
  ),
  "toolStackRecommendationEvidence": select(
    ${buildEditorialEntryCount(TOOL_STACK_EVIDENCE_DOCUMENT_FILTER, 'tools')}
      <= ${LAUNCH_READINESS_MAX_PROJECTED_EDITORIAL_TOTAL_ENTRIES}
    && ${buildEditorialSourceCandidateCount(TOOL_STACK_EVIDENCE_DOCUMENT_FILTER, 'tools')}
      <= ${LAUNCH_READINESS_MAX_PROJECTED_EDITORIAL_SOURCE_CANDIDATES}
    && ${buildOversizedEditorialSourceTitleCount(TOOL_STACK_EVIDENCE_DOCUMENT_FILTER, 'tools')} == 0
    => *[${TOOL_STACK_EVIDENCE_DOCUMENT_FILTER}]
      | order(_id asc) [0...${LAUNCH_READINESS_MAX_PROJECTED_EDITORIAL_DOCUMENTS + 1}]{
        "entries": coalesce(
          tools[${PUBLIC_EDITORIAL_TOOL_FILTER}]
            [0...${LAUNCH_READINESS_MAX_PROJECTED_EDITORIAL_ENTRIES + 1}]{
              "hasDescription": ${groqHasTrimmedText('description')},
              "evidenceExemption": select(
                evidenceExemption == "${EDITORIAL_EVIDENCE_EXEMPTION}"
                  => "${EDITORIAL_EVIDENCE_EXEMPTION}"
              ),
              "sourceReferences": sourceReferences[0...${MAX_PUBLIC_SOURCE_REFERENCES}]
                [${BOUNDED_PUBLIC_EDITORIAL_SOURCE_FILTER}]{
                  title,
                  url,
                  sourceType,
                  visibility
                }
            },
          []
        )
      }
  ),
  "featuredToolsMissingFitGuidance": count(*[
    ${LAUNCH_READINESS_FEATURED_TOOL_MISSING_FIT_GUIDANCE_FILTER}
  ]),
  "useCasesMissingDescriptions": count(*[
    _type == "useCase" && defined(slug.current) && seo.noIndex != true
    && !(_id in path("drafts.**")) && !(${groqHasTrimmedText('description')})
  ]),
  "toolsNeedingMediaReview": count(*[
    ${LAUNCH_READINESS_TOOL_MEDIA_REVIEW_FILTER}
  ]),
  "activePublicDeals": count(*[
    _type == "deal" && !(_id in path("drafts.**"))
    && ${buildActiveDealFilter('dateTime(now())')}
    && defined(tool->_id) && !(tool->_id in path("drafts.**"))
    && tool->seo.noIndex != true
    && defined(tool->name) && defined(tool->slug.current)
    && !defined(tool->successorTool)
  ]),
  "dealsNeedingSourceChecks": count(*[${DEAL_SOURCE_CHECK_REVIEW_FILTER}]),
  "enabledSearchAliases": count(*[
    _type == "searchAlias" && isEnabled != false && !(_id in path("drafts.**"))
  ])
}`

export const LAUNCH_READINESS_RULES: readonly LaunchReadinessRule[] = [
  {id: 'reviewed-comparison-pairs', countKey: 'reviewedComparisonPairs', severity: 'warning', target: {type: 'minimum', minimum: COMPARISON_PILOT_MIN_INDEXABLE_PAIRS}, label: 'Reviewed comparison candidates', actionLabel: 'Review comparison pilot', studioPath: '/compare/approvedComparisons', description: `The comparison pilot requires ${COMPARISON_PILOT_MIN_INDEXABLE_PAIRS} indexable pairs. This candidate count checks approval, current review, publication, and public Tool references. The publication build validates fingerprints and evidence before allowing indexing; deferred indexing does not block the rest of the catalog.`},
  {id: 'comparisons-needing-review', countKey: 'comparisonsNeedingReview', severity: 'warning', target: {type: 'zero'}, label: 'Comparison reviews overdue', actionLabel: 'Review comparisons', studioPath: '/compare/agingComparisons', description: `Approved comparisons need a valid review within ${COMPARISON_REVIEW_MAX_AGE_DAYS} days.`},
  {id: 'articles-missing-public-tools', countKey: 'articlesMissingPublicTools', severity: 'warning', target: {type: 'zero'}, label: 'Articles missing public Tools', actionLabel: 'Connect articles to Tools', studioPath: '/inbox/editorialFreshness;articlesMissingPublicTools', description: 'Published articles without a public related Tool do not appear on Tool article rails. No minimum article count is required.'},
  {id: 'integration-facts-needing-review', countKey: 'integrationFactsNeedingReview', severity: 'warning', target: {type: 'zero'}, label: 'Integration facts needing review', actionLabel: 'Review integration evidence', studioPath: '/inbox/editorialFreshness;integrationFactsNeedingReview', description: `Positive compatibility claims need a review date within the shared ${COMPARISON_REVIEW_MAX_AGE_DAYS}-day editorial cadence.`},
  {id: 'registry-sweep-overdue', countKey: 'registrySweepOverdue', severity: 'warning', target: {type: 'zero'}, label: 'No recent successful registry sweep', actionLabel: 'Review registry observations', studioPath: '/inbox/editorialFreshness;registryObservationsNeedingReview', description: 'No successful registry sweep was recorded within the existing 24-hour recheck interval. Restore the scheduled runner and inspect stale observations.'},
  {id: 'registry-observations-needing-review', countKey: 'registryObservationsNeedingReview', severity: 'warning', target: {type: 'zero'}, label: 'Registry observations needing review', actionLabel: 'Review registry observations', studioPath: '/inbox/editorialFreshness;registryObservationsNeedingReview', description: 'Public Tools have missing or unavailable repository observations, or active MCP interfaces with missing or retired registry records.'},
  {id: 'articles-needing-review', countKey: 'articlesNeedingReview', severity: 'warning', target: {type: 'zero'}, label: 'Articles needing review', actionLabel: 'Review articles', studioPath: '/inbox/editorialFreshness;articlesNeedingReview', description: 'Published articles need a review stamp and should be checked when their next review is due.'},
  {id: 'publishers-awaiting-approval', countKey: 'publishersAwaitingApproval', severity: 'warning', target: {type: 'zero'}, label: 'Publishers awaiting approval', actionLabel: 'Review publishers', studioPath: '/inbox/editorialWorkQueues;publishersAwaitingApproval', description: 'Review organization identity and official links before approving a Publisher.'},
  {id: 'tools-needing-dub-regeneration', countKey: 'toolsNeedingDubRegeneration', severity: 'warning', target: {type: 'zero'}, label: 'Tools needing tracked link regeneration', actionLabel: 'Review tracked links', studioPath: '/inbox/editorialWorkQueues;toolsNeedingDubRegeneration', description: 'Regenerate tracked links after the official destination changes, then clear the flag.'},
  {
    id: 'published-tools',
    countKey: 'publishedTools',
    severity: 'blocking',
    target: {type: 'minimum', minimum: 1},
    label: 'Published tools',
    actionLabel: 'Open tools',
    studioPath: '/tools',
    description: 'Counts public listings across all resource kinds, including guides and reference sites. At least one must exist before launch surfaces can be credible.',
  },
  {
    id: 'tools-missing-core-fields',
    countKey: 'toolsMissingCoreFields',
    severity: 'blocking',
    target: {type: 'zero'},
    label: 'Tools missing core fields or destination',
    actionLabel: 'Review tools',
    studioPath: '/tools',
    description:
      'Public Tools should have a valid Resource Kind, safe canonical destination, logo, category, description, and feature data. Pricing and platforms are required only for app, CLI tool, and MCP server listings. Overview is optional.',
  },
  {
    id: 'tools-missing-published-categories',
    countKey: 'toolsMissingPublishedCategories',
    severity: 'blocking',
    target: {type: 'zero'},
    label: 'Tools without a published Category',
    actionLabel: 'Review categories',
    studioPath: '/inbox/editorialWorkQueues;toolsWithoutPublishedCategory',
    description: 'Every public Tool needs at least one published Category for catalog discovery.',
  },
  {
    id: 'tools-missing-use-cases',
    countKey: 'toolsMissingUseCases',
    severity: 'warning',
    target: {type: 'zero'},
    label: 'Tools missing use cases',
    actionLabel: 'Review tools',
    studioPath: '/tools',
    description:
      'Use case coverage helps people and agents find tools for a workflow through catalog metadata and feeds.',
  },
  {
    id: 'tools-missing-alternatives',
    countKey: 'toolsMissingAlternatives',
    severity: 'warning',
    target: {type: 'zero'},
    label: 'Tools missing alternatives',
    actionLabel: 'Review tools',
    studioPath: '/tools',
    description: 'Public Tools without curated alternatives only offer category neighbors for further discovery.',
  },
  {
    id: 'thin-alternatives',
    countKey: 'toolsWithThinAlternatives',
    severity: 'warning',
    target: {type: 'zero'},
    label: 'Thin alternatives coverage',
    actionLabel: 'Review tools',
    studioPath: '/tools',
    description: 'Tools with exactly one public alternative offer limited comparison context on their Tool pages.',
  },
  {
    id: 'empty-categories',
    countKey: 'categoriesWithoutTools',
    severity: 'warning',
    target: {type: 'zero'},
    label: 'Categories without public tools',
    actionLabel: 'Open categories',
    studioPath: '/settings/category',
    description: 'Empty public taxonomy pages make the catalog feel unfinished.',
  },
  {
    id: 'empty-use-cases',
    countKey: 'useCasesWithoutTools',
    severity: 'warning',
    target: {type: 'zero'},
    label: 'Use cases without public tools',
    actionLabel: 'Open use cases',
    studioPath: '/settings/useCase',
    description: 'The agent Markdown feed at /use-case/:slug.md requires at least one public tool; empty feeds return 404.',
  },
  {
    id: 'categories-needing-review',
    countKey: 'categoriesNeedingReview',
    severity: 'warning',
    target: {type: 'zero'},
    label: 'Categories needing editorial review',
    actionLabel: 'Review categories',
    studioPath: '/inbox/editorialFreshness;categoriesNeedingReview',
    description:
      'Categories with a stale editorial body, or enough public Tools to need one, should be reviewed.',
  },
  {
    id: 'published-tool-stacks',
    countKey: 'publishedToolStacks',
    severity: 'blocking',
    target: {type: 'minimum', minimum: 1},
    label: 'Published tool stacks',
    actionLabel: 'Open tool stacks',
    studioPath: '/collections/toolStack',
    description: 'Launch should include at least one published editorial stack.',
  },
  {
    id: 'tool-stacks-needing-review',
    countKey: 'toolStacksNeedingReview',
    severity: 'warning',
    target: {type: 'zero'},
    label: 'Tool stacks needing review',
    actionLabel: 'Review stacks',
    studioPath: '/inbox/editorialFreshness;stacksNeedingReview',
    description: 'Published stacks should be reviewed or have a future review date.',
  },
  {
    id: 'best-of-lists-needing-review',
    countKey: 'bestOfListsNeedingReview',
    severity: 'warning',
    target: {type: 'zero'},
    label: 'Best-of lists needing review',
    actionLabel: 'Review lists',
    studioPath: '/inbox/editorialFreshness;bestOfNeedingReview',
    description: 'Published best-of lists should be reviewed or have a future review date.',
  },
  {
    id: 'pending-submissions',
    countKey: 'pendingSubmissions',
    severity: 'warning',
    target: {type: 'zero'},
    label: 'Pending submissions',
    actionLabel: 'Review submissions',
    studioPath: '/inbox/pendingSubmissions',
    description: 'Pending submissions can contain launch-relevant tools editors should triage.',
  },
  {
    id: 'pending-correction-reports',
    countKey: 'pendingCorrectionReports',
    severity: 'blocking',
    target: {type: 'zero'},
    label: 'Pending correction reports',
    actionLabel: 'Review reports',
    studioPath: '/inbox/pendingCorrectionReports',
    description: 'Open correction reports can indicate public trust or accuracy problems.',
  },
  {
    id: 'dead-destinations',
    countKey: 'flaggedDeadDestinationTools',
    severity: 'blocking',
    target: {type: 'zero'},
    label: 'Flagged dead destinations',
    actionLabel: 'Review flagged tools',
    studioPath: '/inbox/flaggedTools',
    description: 'Dead outbound destinations can break core Visit actions and affiliate paths.',
  },
  {
    id: 'best-of-quality-gates',
    countKey: 'bestOfListsFailingQualityGates',
    severity: 'warning',
    target: {type: 'zero'},
    label: 'Best-of lists failing quality gates',
    actionLabel: 'Review lists',
    studioPath: '/collections/curatedList',
    description:
      'Published best-of lists must meet the shared public Tool and editorial blurb gates.',
  },
  {
    id: 'tool-stack-quality-gates',
    countKey: 'toolStacksFailingQualityGates',
    severity: 'blocking',
    target: {type: 'zero'},
    label: 'Tool stacks failing quality gates',
    actionLabel: 'Review stacks',
    studioPath: '/collections/toolStack',
    description: 'Published Tool Stacks must meet the shared public Tool and role-guidance gates.',
  },
  {
    id: 'best-of-recommendation-evidence',
    countKey: 'bestOfListsMissingRecommendationEvidence',
    severity: 'warning',
    target: {type: 'zero'},
    label: 'Best-of lists missing recommendation evidence',
    actionLabel: 'Review lists',
    studioPath: '/collections/curatedList',
    description:
      'Published Best-of entries should include one to three public HTTPS Source References.',
  },
  {
    id: 'tool-stack-recommendation-evidence',
    countKey: 'toolStacksMissingRecommendationEvidence',
    severity: 'warning',
    target: {type: 'zero'},
    label: 'Tool stacks missing recommendation evidence',
    actionLabel: 'Review stacks',
    studioPath: '/collections/toolStack',
    description:
      'Evaluative Tool Stack entries should include public evidence; role-only entries need the documented exemption.',
  },
  {
    id: 'featured-fit-guidance',
    countKey: 'featuredToolsMissingFitGuidance',
    severity: 'warning',
    target: {type: 'zero'},
    label: "Editor's picks missing fit guidance",
    actionLabel: 'Review tools',
    studioPath: '/inbox/editorialWorkQueues;featuredToolsMissingFitGuidance',
    description: "Editor's picks should meet the shared Fit Guidance decision-support gate.",
  },
  {
    id: 'use-case-descriptions',
    countKey: 'useCasesMissingDescriptions',
    severity: 'warning',
    target: {type: 'zero'},
    label: 'Use cases missing descriptions',
    actionLabel: 'Open use cases',
    studioPath: '/settings/useCase',
    description: 'Public Use Cases should meet the shared workflow-description gate.',
  },
  {
    id: 'tools-needing-media-review',
    countKey: 'toolsNeedingMediaReview',
    severity: 'warning',
    target: {type: 'zero'},
    label: 'Tools needing media review',
    actionLabel: 'Review media',
    studioPath: '/inbox/editorialFreshness;toolsNeedingMediaReview',
    description:
      'Published Tools whose primary media is older than the media freshness window or has an unknown capture date. A warning, not a blocker: an old screenshot of a stable Tool is acceptable.',
  },
  ...LIVING_CATALOG_READINESS_RULES,
  {
    id: 'active-public-deals',
    countKey: 'activePublicDeals',
    severity: 'warning',
    target: {type: 'minimum', minimum: 1},
    label: 'Active public deals',
    actionLabel: 'Open deals',
    studioPath: '/deals',
    description:
      'The public /deals page and homepage slots need at least one verified, evidence-fresh Deal on a public Tool.',
  },
  {
    id: 'deals-needing-source-checks',
    countKey: 'dealsNeedingSourceChecks',
    severity: 'warning',
    target: {type: 'zero'},
    label: 'Deals awaiting source checks',
    actionLabel: 'Review source checks',
    studioPath: '/deals/dealsNeedingSourceChecks',
    description: 'Enabled, verified Deals whose source is unchecked, unavailable, changed, or outside the public freshness window. Review the source-check queue and minute worker results.',
  },
  {
    id: 'enabled-search-aliases',
    countKey: 'enabledSearchAliases',
    severity: 'warning',
    target: {type: 'minimum', minimum: 1},
    label: 'Enabled search aliases',
    actionLabel: 'Open search aliases',
    studioPath: '/settings/searchAlias',
    description:
      'At least one enabled Search alias should exist so query expansion covers common terms.',
  },
] as const

const aggregateCountKeys = [
  'integrationFactsNeedingReview',
  'registrySweepOverdue',
  'registryObservationsNeedingReview',
  'reviewedComparisonPairs',
  'comparisonsNeedingReview',
  'articlesMissingPublicTools',
  'articlesNeedingReview',
  'publishersAwaitingApproval',
  'toolsNeedingDubRegeneration',
  'publishedTools',
  'toolsMissingPublishedCategories',
  'toolsMissingUseCases',
  'toolsMissingAlternatives',
  'toolsWithThinAlternatives',
  'categoriesWithoutTools',
  'useCasesWithoutTools',
  'categoriesNeedingReview',
  'publishedToolStacks',
  'toolStacksNeedingReview',
  'publishedBestOfLists',
  'bestOfListsNeedingReview',
  'pendingSubmissions',
  'pendingCorrectionReports',
  'flaggedDeadDestinationTools',
  'bestOfListsFailingQualityGates',
  'toolStacksFailingQualityGates',
  'featuredToolsMissingFitGuidance',
  'useCasesMissingDescriptions',
  'toolsNeedingMediaReview',
  'toolsOverdueForWebsiteCheck',
  'toolsAffectedByMissingCrawlActivity',
  'activePublicDeals',
  'dealsNeedingSourceChecks',
  'enabledSearchAliases',
] as const satisfies ReadonlyArray<keyof LaunchReadinessQueryResult>

const hasCompleteCoreFields = (tool: LaunchReadinessToolProjection): boolean =>
  isResourceKind(tool.resourceKind) &&
  tool.hasDescription &&
  tool.hasLogo &&
  (!resourceKindRequiresPricingAndPlatform(tool.resourceKind) ||
    (tool.hasPricing && tool.hasPlatforms)) &&
  tool.hasCategories &&
  tool.hasKeyFeatures

const hasSafePublicDestination = (tool: LaunchReadinessToolProjection): boolean => {
  if (tool.hasOversizedDestination) return false
  const identity = resolveResourceIdentity({
    website: tool.website,
    resourceIdentity: tool.resourceIdentity,
  })
  return identity !== null && validatePublicHttpUrl(identity.canonicalUrl).success
}

export const countToolsMissingCoreFields = (
  tools: LaunchReadinessToolProjection[] | null | undefined,
): number =>
  (tools ?? []).reduce(
    (count, tool) =>
      count + (hasCompleteCoreFields(tool) && hasSafePublicDestination(tool) ? 0 : 1),
    0,
  )

// SAFETY: The preceding parser or closed-vocabulary check establishes this primitive value.
function assertCount(key: string, value: JsonValue): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Launch readiness count ${key} must be a non-negative integer.`)
  }
}

const projectionBooleanKeys = [
  'hasDescription',
  'hasLongDescription',
  'hasLogo',
  'hasPricing',
  'hasPlatforms',
  'hasCategories',
  'hasKeyFeatures',
  'hasOversizedDestination',
] as const
const resourceIdentityStringKeys = [
  'kind',
  'canonicalUrl',
  'registryId',
  'websiteUrl',
  'repositoryUrl',
  'docsUrl',
  'packageUrl',
  'mcpRegistryUrl',
] as const

type LaunchReadinessCheckedRecord =
  | LaunchReadinessToolProjection
  | ResourceIdentityInput
  | LaunchReadinessEditorialEvidenceDocumentProjection
  | LaunchReadinessEditorialEvidenceEntryProjection

const isRecord = (value: LaunchReadinessCheckedRecord | null | undefined): boolean =>
  hasRuntimeObjectType(value) && value !== null && !Array.isArray(value)

const assertOptionalBoundedString = (label: string, value: JsonValue): void => {
  if (value !== undefined && value !== null && !isRuntimeString(value)) {
    throw new Error(`Launch readiness projection ${label} must be a string.`)
  }
  if (isRuntimeString(value) && value.length > LAUNCH_READINESS_MAX_DESTINATION_LENGTH) {
    throw new Error(`Launch readiness projection ${label} exceeded its field limit.`)
  }
}

const assertToolProjection = (value: LaunchReadinessToolProjection, index: number): void => {
  if (!isRecord(value)) throw new Error(`Launch readiness Tool projection ${index} is invalid.`)
  for (const key of projectionBooleanKeys) {
    if (!isRuntimeBoolean(value[key])) {
      throw new Error(`Launch readiness Tool projection ${index}.${key} must be boolean.`)
    }
  }
  assertOptionalBoundedString(`${index}.resourceKind`, value.resourceKind)
  assertOptionalBoundedString(`${index}.website`, value.website)
  if (value.resourceIdentity !== undefined && value.resourceIdentity !== null) {
    if (!isRecord(value.resourceIdentity)) {
      throw new Error(`Launch readiness Tool projection ${index}.resourceIdentity is invalid.`)
    }
    for (const key of resourceIdentityStringKeys) {
      assertOptionalBoundedString(`${index}.resourceIdentity.${key}`, value.resourceIdentity[key])
    }
  }
}

const getLegacyEvidenceGapCount = (
  result: LaunchReadinessQueryResult,
  key: 'bestOfListsMissingRecommendationEvidence' | 'toolStacksMissingRecommendationEvidence',
): number => {
  const value = result[key]
  assertCount(key, value)
  return value
}

const countProjectedEditorialEvidenceGaps = (
  result: LaunchReadinessQueryResult,
  projectionKey: 'bestOfRecommendationEvidence' | 'toolStackRecommendationEvidence',
): number | undefined => {
  const documents = result[projectionKey]
  if (documents === undefined) return undefined
  if (documents === null) {
    throw new Error(`Launch readiness ${projectionKey} projection exceeded its response budget.`)
  }
  if (!Array.isArray(documents)) {
    throw new Error(`Launch readiness ${projectionKey} projection is invalid.`)
  }
  if (documents.length > LAUNCH_READINESS_MAX_PROJECTED_EDITORIAL_DOCUMENTS) {
    throw new Error(`Launch readiness ${projectionKey} projection exceeded its document limit.`)
  }

  let gapCount = 0
  for (const [documentIndex, document] of documents.entries()) {
    if (!isRecord(document) || !Array.isArray(document.entries)) {
      throw new Error(`Launch readiness ${projectionKey} projection ${documentIndex} is invalid.`)
    }
    if (document.entries.length > LAUNCH_READINESS_MAX_PROJECTED_EDITORIAL_ENTRIES) {
      throw new Error(`Launch readiness ${projectionKey} projection exceeded its entry limit.`)
    }

    const entries = document.entries.map((entry, entryIndex) => {
      if (!isRecord(entry)) {
        throw new Error(
          `Launch readiness ${projectionKey} projection ${documentIndex}.${entryIndex} is invalid.`,
        )
      }
      return {
        ...(entry.hasDescription === true
          ? {
            // SAFETY: The owner parser or adjacent runtime guard establishes each asserted property contract.
            description: 'projected' as const
          }
          : isRuntimeString(entry.description)
            ? { description: entry.description }
            : {}),
        ...(isRuntimeString(entry.editorialBlurb) ? { editorialBlurb: entry.editorialBlurb } : undefined),
        ...(isRuntimeString(entry.evidenceExemption) ? { evidenceExemption: entry.evidenceExemption } : undefined),
        ...(Array.isArray(entry.sourceReferences) ? { sourceReferences: entry.sourceReferences } : undefined)
      }
    })
    const validationResult =
      projectionKey === 'bestOfRecommendationEvidence'
        ? validateCuratedListEvidenceReadiness({
            publishedAt: 'projected',
            rankedTools: entries,
          })
        : validateToolStackEvidenceReadiness({
            publishedAt: 'projected',
            tools: entries,
          })
    if (validationResult !== true) gapCount += 1
  }
  return gapCount
}

export const buildLaunchReadinessCounts = (
  result: LaunchReadinessQueryResult,
): LaunchReadinessCounts => {
  if (!Array.isArray(result.coreFieldTools)) {
    throw new Error('Launch readiness Tool projection is missing from the Sanity response.')
  }
  if (result.coreFieldTools.length > LAUNCH_READINESS_MAX_PROJECTED_TOOLS) {
    throw new Error('Launch readiness Tool projection exceeded its projection limit.')
  }
  for (const key of aggregateCountKeys) assertCount(key, result[key])
  if (result.publishedUseCases !== undefined) assertCount('publishedUseCases', result.publishedUseCases)
  if (result.coreFieldTools.length !== result.publishedTools) {
    throw new Error('Launch readiness Tool projection does not match the published Tool count.')
  }
  result.coreFieldTools.forEach(assertToolProjection)
  const bestOfEvidenceGapCount =
    countProjectedEditorialEvidenceGaps(result, 'bestOfRecommendationEvidence') ??
    getLegacyEvidenceGapCount(result, 'bestOfListsMissingRecommendationEvidence')
  const toolStackEvidenceGapCount =
    countProjectedEditorialEvidenceGaps(result, 'toolStackRecommendationEvidence') ??
    getLegacyEvidenceGapCount(result, 'toolStacksMissingRecommendationEvidence')

  return {
    publishedTools: result.publishedTools,
    publishedUseCases: result.publishedUseCases,
    toolsMissingCoreFields: countToolsMissingCoreFields(result.coreFieldTools),
    toolsMissingPublishedCategories: result.toolsMissingPublishedCategories,
    toolsMissingUseCases: result.toolsMissingUseCases,
    toolsMissingAlternatives: result.toolsMissingAlternatives,
    toolsWithThinAlternatives: result.toolsWithThinAlternatives,
    categoriesWithoutTools: result.categoriesWithoutTools,
    useCasesWithoutTools: result.useCasesWithoutTools,
    categoriesNeedingReview: result.categoriesNeedingReview,
    articlesNeedingReview: result.articlesNeedingReview,
    integrationFactsNeedingReview: result.integrationFactsNeedingReview,
    registrySweepOverdue: result.registrySweepOverdue,
    registryObservationsNeedingReview: result.registryObservationsNeedingReview,
    reviewedComparisonPairs: result.reviewedComparisonPairs,
    comparisonsNeedingReview: result.comparisonsNeedingReview,
    articlesMissingPublicTools: result.articlesMissingPublicTools,
    publishersAwaitingApproval: result.publishersAwaitingApproval,
    toolsNeedingDubRegeneration: result.toolsNeedingDubRegeneration,
    publishedToolStacks: result.publishedToolStacks,
    toolStacksNeedingReview: result.toolStacksNeedingReview,
    publishedBestOfLists: result.publishedBestOfLists,
    bestOfListsNeedingReview: result.bestOfListsNeedingReview,
    pendingSubmissions: result.pendingSubmissions,
    pendingCorrectionReports: result.pendingCorrectionReports,
    flaggedDeadDestinationTools: result.flaggedDeadDestinationTools,
    bestOfListsFailingQualityGates: result.bestOfListsFailingQualityGates,
    toolStacksFailingQualityGates: result.toolStacksFailingQualityGates,
    bestOfListsMissingRecommendationEvidence: bestOfEvidenceGapCount,
    toolStacksMissingRecommendationEvidence: toolStackEvidenceGapCount,
    featuredToolsMissingFitGuidance: result.featuredToolsMissingFitGuidance,
    useCasesMissingDescriptions: result.useCasesMissingDescriptions,
    toolsNeedingMediaReview: result.toolsNeedingMediaReview,
    toolsOverdueForWebsiteCheck: result.toolsOverdueForWebsiteCheck,
    toolsAffectedByMissingCrawlActivity: result.toolsAffectedByMissingCrawlActivity,
    activePublicDeals: result.activePublicDeals,
    dealsNeedingSourceChecks: result.dealsNeedingSourceChecks,
    enabledSearchAliases: result.enabledSearchAliases,
  }
}

const normalizeCount = (value: number | undefined): number =>
  isRuntimeNumber(value) && Number.isFinite(value) && value >= 0 ? value : 0

const evaluateRule = (rule: LaunchReadinessRule, count: number): LaunchReadinessStatus => {
  const passes = rule.target.type === 'zero' ? count === 0 : count >= rule.target.minimum
  return passes ? 'ready' : rule.severity
}

export const buildLaunchReadinessSummary = (
  rawCounts: LaunchReadinessCounts,
): LaunchReadinessSummary => {
  const signals = LAUNCH_READINESS_RULES.map((rule): LaunchReadinessSignal => {
    const count = normalizeCount(rawCounts[rule.countKey])
    const signal: LaunchReadinessSignal = {
      id: rule.id,
      label: rule.label,
      severity: rule.severity,
      count,
      status: evaluateRule(rule, count),
      actionLabel: rule.actionLabel,
      studioPath: rule.studioPath,
      description: rule.description,
    }
    if (rule.id === 'tools-missing-use-cases' && rawCounts.publishedUseCases === 0) {
      signal.actionLabel = 'Create use cases'
      signal.studioPath = '/settings/useCase'
      signal.description = 'No published Use Cases exist. Create and publish a Use Case in Settings (/settings/useCase), then attach it to public Tools.'
    }
    return signal
  })
  const blockingCount = signals.filter(({status}) => status === 'blocking').length
  const warningCount = signals.filter(({status}) => status === 'warning').length
  const readyCount = signals.length - blockingCount - warningCount
  return {
    status: blockingCount > 0 ? 'blocking' : warningCount > 0 ? 'warning' : 'ready',
    readyCount,
    warningCount,
    blockingCount,
    signals,
  }
}

export const buildLaunchReadinessReport = (
  result: LaunchReadinessQueryResult,
  options: {generatedAt: string; source: LaunchReadinessSource},
): LaunchReadinessAvailableReport => {
  const summary = buildLaunchReadinessSummary(buildLaunchReadinessCounts(result))
  return {
    schemaVersion: LAUNCH_READINESS_REPORT_SCHEMA_VERSION,
    generatedAt: options.generatedAt,
    source: options.source,
    status: summary.status,
    aggregates: {
      ready: summary.readyCount,
      warning: summary.warningCount,
      blocking: summary.blockingCount,
    },
    rules: summary.signals.map(({id, severity, count, status}) => ({
      id,
      severity,
      count,
      status,
    })),
  }
}

export const buildUnavailableLaunchReadinessReport = (
  generatedAt: string,
  status: LaunchReadinessUnavailableReport['status'],
  reason: LaunchReadinessUnavailableReport['reason'],
  constraint?: LaunchReadinessUnavailableReport['constraint'],
): LaunchReadinessUnavailableReport => ({
  schemaVersion: LAUNCH_READINESS_REPORT_SCHEMA_VERSION, generatedAt,
  // SAFETY: The owner parser or adjacent runtime guard establishes each asserted property contract.
  source: 'none' as const, status, reason,
  ...(constraint ? { constraint } : undefined),
  aggregates: { ready: null, warning: null, blocking: null }, rules: LAUNCH_READINESS_RULES.map(({ id, severity }) => ({
    id,
    severity,
    count: null,
    status: 'unknown',
  } satisfies LaunchReadinessUnavailableReport['rules'][number]))
})

export type SanityReference = {_ref?: string}
export type SlugValue = {current?: string}
export type SeoValue = {noIndex?: boolean}
export type PublicDocument = {slug?: SlugValue; seo?: SeoValue}
export type RankedToolValue = {
  editorialBlurb?: string
  sourceReferences?: SourceReferenceInput[]
  tool?: SanityReference
}
export type CuratedListQualityDocument = {
  publishedAt?: string
  rankedTools?: RankedToolValue[]
  seo?: SeoValue
}
export type PublicToolReferenceStatus = Record<string, boolean>
export type PublicToolReferenceContext = {
  publicToolReferenceStatus: PublicToolReferenceStatus
  retiredToolReferenceStatus?: Record<string, boolean>
  toolDescriptionByReferenceId: Record<string, string | undefined>
}
export type PublicToolReferenceOptions = {
  document?: PublicDocument
  publicToolReferenceStatus?: PublicToolReferenceStatus
}
export type ToolStackItemValue = {
  role?: string
  description?: string
  evidenceExemption?: string
  sourceReferences?: SourceReferenceInput[]
  tool?: SanityReference
}
export type ToolStackQualityDocument = {
  publishedAt?: string
  tools?: ToolStackItemValue[]
  seo?: SeoValue
}
export type ToolFitGuidanceValue = {
  bestFor?: string[]
  notIdealFor?: string[]
  keyTradeoffs?: string[]
  setupComplexity?: string
  primaryDecisionCriteria?: string[]
  recommendedNextStep?: string
  reviewedAt?: string
  publicNotes?: string
}
export type ToolQualityDocument = PublicDocument & {
  useCases?: SanityReference[]
  visibility?: string
  successorTool?: SanityReference | null
  fitGuidance?: ToolFitGuidanceValue
}
export type UseCaseQualityDocument = PublicDocument & {description?: string}

type SanityClientLike = {
  fetch: <T>(query: string, params: {toolIds: string[]}) => Promise<T>
}
type ToolReferenceStatusResult = {
  _id: string
  description?: string | null
  isPublic: boolean
  isRetired: boolean
}

const PUBLIC_TOOL_REFERENCE_STATUS_QUERY = `*[_id in $toolIds]{
  _id,
  description,
  "isPublic": defined(slug.current) && !(_id in path("drafts.**")) && seo.noIndex != true,
  "isRetired": defined(successorTool)
}`
const isNonEmptyString = (value: string | undefined): boolean => Boolean(value?.trim())
const isPublicDocument = (document: PublicDocument): boolean =>
  isNonEmptyString(document.slug?.current) && document.seo?.noIndex !== true
const getReferenceId = (reference: SanityReference | undefined): string | undefined => {
  const referenceId = reference?._ref
  return isNonEmptyString(referenceId) ? referenceId : undefined
}
const getUniqueReferenceIds = (references: Array<SanityReference | undefined>): string[] =>
  Array.from(new Set(references.map(getReferenceId).filter((id): id is string => Boolean(id))))
const isPublicToolReference = (
  reference: SanityReference | undefined,
  publicToolReferenceStatus: PublicToolReferenceStatus | undefined,
): boolean => {
  const referenceId = getReferenceId(reference)
  return Boolean(
    referenceId && (!publicToolReferenceStatus || publicToolReferenceStatus[referenceId]),
  )
}

export const fetchPublicToolReferenceContext = async (
  client: SanityClientLike,
  references: Array<SanityReference | undefined>,
): Promise<PublicToolReferenceContext> => {
  const toolIds = getUniqueReferenceIds(references)
  if (toolIds.length === 0) {
    return {publicToolReferenceStatus: {}, retiredToolReferenceStatus: {}, toolDescriptionByReferenceId: {}}
  }
  const results = await client.fetch<ToolReferenceStatusResult[]>(
    PUBLIC_TOOL_REFERENCE_STATUS_QUERY,
    {
      toolIds,
    },
  )
  const resultById = new Map(results.map((result) => [result._id, result]))
  return {
    publicToolReferenceStatus: Object.fromEntries(
      toolIds.map((toolId) => [toolId, resultById.get(toolId)?.isPublic === true]),
    ),
    retiredToolReferenceStatus: Object.fromEntries(
      toolIds.map((toolId) => [toolId, resultById.get(toolId)?.isRetired === true]),
    ),
    toolDescriptionByReferenceId: Object.fromEntries(
      toolIds.map((toolId) => {
        const description = resultById.get(toolId)?.description ?? undefined
        return [toolId, isNonEmptyString(description) ? description : undefined]
      }),
    ),
  }
}

export const fetchPublicToolReferenceStatus = async (
  client: SanityClientLike,
  references: Array<SanityReference | undefined>,
): Promise<PublicToolReferenceStatus> =>
  (await fetchPublicToolReferenceContext(client, references)).publicToolReferenceStatus

export const validatePublishedCuratedListReadiness = (
  document: CuratedListQualityDocument,
  options: PublicToolReferenceOptions = {},
): true | string => {
  if (!isEditorialPublicationCandidate(document)) return true
  const publicRankedTools = (document.rankedTools ?? []).filter(({tool}) =>
    isPublicToolReference(tool, options.publicToolReferenceStatus),
  )
  if (publicRankedTools.length < LAUNCH_QUALITY_POLICY.minimumEditorialTools) {
    return LAUNCH_QUALITY_POLICY.messages.curatedListMinimum
  }
  if (publicRankedTools.some(({editorialBlurb}) => !isNonEmptyString(editorialBlurb))) {
    return LAUNCH_QUALITY_POLICY.messages.curatedListBlurb
  }
  return true
}

export const validatePublishedToolStackReadiness = (
  document: ToolStackQualityDocument,
  options: PublicToolReferenceOptions = {},
): true | string => {
  if (!isEditorialPublicationCandidate(document)) return true
  const publicTools = (document.tools ?? []).filter(({tool}) =>
    isPublicToolReference(tool, options.publicToolReferenceStatus),
  )
  if (publicTools.length < LAUNCH_QUALITY_POLICY.minimumEditorialTools) {
    return LAUNCH_QUALITY_POLICY.messages.toolStackMinimum
  }
  if (
    publicTools.some(
      ({role, description, evidenceExemption}) =>
        !isNonEmptyString(role) ||
        (!isNonEmptyString(description) && evidenceExemption !== EDITORIAL_EVIDENCE_EXEMPTION),
    )
  ) {
    return LAUNCH_QUALITY_POLICY.messages.toolStackRoles
  }
  return true
}

export const validatePublicToolUseCaseReadiness = (
  document: ToolQualityDocument,
  options: {publishedUseCaseCount?: number} = {},
): true | string => {
  if (!isPublicDocument(document)) return true
  if (options.publishedUseCaseCount === 0) return 'No published Use Cases exist. Create and publish a Use Case in Settings (/settings/useCase), then select it here.'
  if ((document.useCases ?? []).length > 0) return true
  return 'Add at least one Use Case so public Tools appear in workflow discovery surfaces.'
}

export const validateAlternativeToolsReadiness = (
  alternativeTools: SanityReference[] | undefined,
  options: PublicToolReferenceOptions & {
    relatedTools?: SanityReference[]
    review?: ToolAlternativesReview
    peerIds?: string[]
    now?: Date
  } = {},
): true | string => {
  if (options.document && !isPublicDocument(options.document)) return true
  const publicAlternativeTools = (alternativeTools ?? []).filter((reference) =>
    isPublicToolReference(reference, options.publicToolReferenceStatus),
  )
  if (hasAlternativesCoverage(publicAlternativeTools.length, options.review, options.peerIds, options.now)) return true
  return 'Review alternatives: add at least 2 alternatives when suitable, or record why no suitable alternative exists. Companion tools do not establish alternatives coverage. Weak alternatives are not required.'
}

export const validateFeaturedToolFitGuidanceReadiness = (
  document: Pick<ToolQualityDocument, 'visibility' | 'successorTool' | 'fitGuidance' | 'slug' | 'seo'>,
): true | string =>
  isPublicDocument(document) && document.successorTool == null
    ? validateFeaturedToolFitGuidance(document)
    : true

export const validateUseCaseReadiness = (document: UseCaseQualityDocument): true | string => {
  if (!isPublicDocument(document) || isNonEmptyString(document.description)) return true
  return 'Add a short description for this use case’s agent Markdown feed at /use-case/:slug.md.'
}
