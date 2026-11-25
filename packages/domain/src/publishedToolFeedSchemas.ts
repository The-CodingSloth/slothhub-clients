import type {ParsedReadyAgentSetupRecipe} from './mcpRegistry.js';
import {buildAgentHostInstallLink} from './mcpRegistry.js';
import {z} from 'zod'

import {isCatalogTimestampAtOrBefore} from './catalogFreshnessSearch.js'
import type {JsonObject, JsonValue} from './jsonValue.js'
import {hasRuntimeObjectType, isRuntimeBoolean} from './runtimeValidation.js'
import {
  MAX_PUBLIC_ALTERNATIVE_NOTE_LENGTH,
  MAX_PUBLIC_METADATA_LABEL_LENGTH,
  MAX_PUBLIC_METADATA_NOTE_LENGTH,
  normalizePublicMetadataUrl,
} from './publicMetadata.js'
import {RESOURCE_IDENTITY_KIND_VALUES} from './resourceIdentity.js'
import {
  AGENT_SETUP_RECIPE_HOST_VALUES,
  AGENT_SETUP_RECIPE_CONFIG_HOST_VALUES,
  AGENT_SETUP_RECIPE_UNKNOWN_REASON_VALUES,
  MAX_MCP_REGISTRY_OBSERVED_REMOTES,
} from './mcpRegistry.js'
import {RESOURCE_LINK_KINDS} from './publishedToolProfile.js'
import {REPOSITORY_OBSERVATION_STATUS_VALUES} from './repositoryObservation.js'
import {isSafePublicText} from './publicText.js'
import {
  MAX_PUBLIC_SOURCE_REFERENCE_NOTE_LENGTH,
  MAX_PUBLIC_SOURCE_REFERENCE_TITLE_LENGTH,
  SOURCE_REFERENCE_TYPE_VALUES,
} from './sourceReference.js'
import {
  MAX_TOOL_FIT_GUIDANCE_ITEMS,
  MAX_TOOL_FIT_GUIDANCE_PUBLIC_NOTES_LENGTH,
  MAX_TOOL_FIT_GUIDANCE_STATEMENT_LENGTH,
  PUBLIC_SETUP_COMPLEXITY_VALUES,
  getSetupComplexityLabel,
} from './toolFitGuidance.js'

const safePublicMetadataTextSchema = (maxLength: number) =>
  z
    .string()
    .min(1)
    .max(maxLength)
    .refine(
      isSafePublicText,
      'Public text must be trimmed and exclude control or bidi characters',
    )

export const publicMetadataUrlSchema = z.string().refine(
  (value) => normalizePublicMetadataUrl(value) === value,
  'Expected a canonical public http(s) URL',
)

export const publicToolResourceIdentityReferenceSchema = z.object({
  kind: z.enum(RESOURCE_IDENTITY_KIND_VALUES),
  kindLabel: safePublicMetadataTextSchema(MAX_PUBLIC_METADATA_LABEL_LENGTH),
  canonicalUrl: publicMetadataUrlSchema,
  ctaLabel: safePublicMetadataTextSchema(MAX_PUBLIC_METADATA_LABEL_LENGTH),
  registryId: safePublicMetadataTextSchema(MAX_PUBLIC_METADATA_LABEL_LENGTH).optional(),
  websiteUrl: publicMetadataUrlSchema.optional(),
  repositoryUrl: publicMetadataUrlSchema.optional(),
  docsUrl: publicMetadataUrlSchema.optional(),
  packageUrl: publicMetadataUrlSchema.optional(),
  mcpRegistryUrl: publicMetadataUrlSchema.optional(),
})

/**
 * Public repository-observation contract shared by feed producers and the
 * CLI/MCP parsers. `fetchedAt` is the last successful fetch; `never_fetched`
 * means the identity has not been observed by the sweep yet.
 */
export const publicRepositoryObservationSchema = z.object({
  source: z.enum(['github', 'gitlab']).optional(),
  status: z.enum(REPOSITORY_OBSERVATION_STATUS_VALUES),
  isArchived: z.boolean().optional(),
  isDisabled: z.boolean().optional(),
  fetchedAt: z.iso.datetime({offset: true}).optional(),
  lastCommitAt: z.iso.datetime({offset: true}).optional(),
  pushedAt: z.iso.datetime({offset: true}).optional(),
  starCount: z.number().int().nonnegative().safe().optional(),
})

const agentSetupRecipeHeaderSchema = z
  .object({
    name: z.string().min(1),
    isRequired: z.boolean(),
    isSecret: z.boolean(),
  })
  .strict()

const readyAgentSetupRecipeFields = {
  state: z.literal('ready'),
  serverKey: z.string().min(1),
  url: z.string().min(1),
  registryName: z.string().min(1),
  version: z.string().min(1),
  observedAt: z.string().min(1),
  headers: z.array(agentSetupRecipeHeaderSchema).optional(),
  // Bounded by the observation cap minus the primary remote.
  alternateUrls: z
    .array(z.string().min(1))
    .max(MAX_MCP_REGISTRY_OBSERVED_REMOTES - 1)
    .optional(),
  snippet: z.string().min(1),
  /** Absent on feeds published before the field existed — derived on read. */
  entrySnippet: z.string().min(1).optional(),
  installLink: z.string().optional(),
} as const

const validInstallLink = (recipe: ParsedReadyAgentSetupRecipe): boolean => {
  if (recipe.installLink === undefined) return true;
  const derived = buildAgentHostInstallLink({...recipe, entrySnippet: recipe.entrySnippet ?? ''});
  return 'url' in derived && recipe.installLink === derived.url;
};

/**
 * The legacy singular `setupRecipe` contract — Cursor-only when ready and
 * hostless when unknown, matching `PublicAgentSetupRecipe`. Consumers should
 * prefer `setupRecipes`.
 */
export const publicAgentSetupRecipeSchema = z.union([
  z
    .object({...readyAgentSetupRecipeFields, host: z.literal('cursor')})
    .strict().refine(validInstallLink, 'Invalid editor install link: use the derived URL-only link.'),
  z.object({state: z.literal('unknown')}).strict(),
])

/** Additive Cursor stdio fallback; older consumers ignore this separate field. */
export const publicStdioSetupRecipeSchema = z.object({
  state: z.literal('ready'),
  host: z.literal('cursor'),
  transport: z.literal('stdio'),
  serverKey: z.string().min(1),
  command: z.enum(['npx', 'uvx']),
  args: z.array(z.string()),
  environmentVariables: z.array(z.object({name: z.string(), isSecret: z.boolean()}).strict()),
  registryName: z.string().min(1),
  version: z.string().min(1),
  observedAt: z.string().min(1),
  snippet: z.string().min(1),
  entrySnippet: z.string().min(1),
}).strict()

/** Existing remote-only wire entry; unknown names its host. */
export const publicAgentSetupRecipeEntrySchema = z.union([
  z
    .object({
      ...readyAgentSetupRecipeFields,
      host: z.enum(AGENT_SETUP_RECIPE_CONFIG_HOST_VALUES),
    })
    .strict().refine(validInstallLink, 'Invalid editor install link: use the derived URL-only link.'),
  z
    .object({
      state: z.literal('unknown'),
      host: z.enum(AGENT_SETUP_RECIPE_HOST_VALUES),
      registryUrl: publicMetadataUrlSchema.optional(),
      reason: z.enum(AGENT_SETUP_RECIPE_UNKNOWN_REASON_VALUES).optional(),
    })
    .strict(),
])

export const publicToolResourceLinkSchema = z.object({
  label: safePublicMetadataTextSchema(MAX_PUBLIC_METADATA_LABEL_LENGTH),
  url: publicMetadataUrlSchema,
  kind: z.enum(RESOURCE_LINK_KINDS),
  isOfficial: z.boolean(),
  checkedAt: z.iso.datetime({offset: true}).optional(),
  note: safePublicMetadataTextSchema(MAX_PUBLIC_METADATA_NOTE_LENGTH).optional(),
})

export const publicToolResourceLinksSchema = z
  .array(publicToolResourceLinkSchema)
  .superRefine((resources, context) => {
    const seen = new Set<string>()
    resources.forEach((resource, index) => {
      if (seen.has(resource.url)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'url'],
          message: 'Resource Link URLs must be unique',
        })
      }
      seen.add(resource.url)
    })
  })

const publicToolFitGuidanceItemSchema = safePublicMetadataTextSchema(MAX_TOOL_FIT_GUIDANCE_STATEMENT_LENGTH)

export const publicToolFitGuidanceSchema = z
  .object({
    bestFor: z.array(publicToolFitGuidanceItemSchema).max(MAX_TOOL_FIT_GUIDANCE_ITEMS),
    notIdealFor: z.array(publicToolFitGuidanceItemSchema).max(MAX_TOOL_FIT_GUIDANCE_ITEMS),
    keyTradeoffs: z.array(publicToolFitGuidanceItemSchema).max(MAX_TOOL_FIT_GUIDANCE_ITEMS),
    setupComplexity: z.enum(PUBLIC_SETUP_COMPLEXITY_VALUES).optional(),
    setupComplexityLabel: publicToolFitGuidanceItemSchema.optional(),
    primaryDecisionCriteria: z
      .array(publicToolFitGuidanceItemSchema)
      .max(MAX_TOOL_FIT_GUIDANCE_ITEMS),
    recommendedNextStep: publicToolFitGuidanceItemSchema.optional(),
    reviewedAt: z.iso.datetime({offset: true}).optional(),
    publicNotes: safePublicMetadataTextSchema(
      MAX_TOOL_FIT_GUIDANCE_PUBLIC_NOTES_LENGTH,
    ).optional(),
  })
  .superRefine((guidance, context) => {
    const expectedLabel = guidance.setupComplexity
      ? getSetupComplexityLabel(guidance.setupComplexity)
      : undefined
    if (guidance.setupComplexityLabel !== expectedLabel) {
      context.addIssue({
        code: 'custom',
        path: ['setupComplexityLabel'],
        message: 'Setup complexity label must match the setup complexity value',
      })
    }
    if (
      guidance.bestFor.length === 0 &&
      guidance.notIdealFor.length === 0 &&
      guidance.keyTradeoffs.length === 0 &&
      guidance.primaryDecisionCriteria.length === 0 &&
      !guidance.setupComplexity &&
      !guidance.recommendedNextStep &&
      !guidance.publicNotes
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Fit guidance must contain at least one substantive guidance field',
      })
    }
  })

const destinationHealthEntrySchema = z.object({
  status: z.enum(['ok', 'dead']).optional(),
  consecutiveFailures: z.number().optional(),
  consecutiveSuccesses: z.number().optional(),
  firstFailedAt: z.string().optional(),
  deadSince: z.string().optional(),
  lastProbedAt: z.string().optional(),
  lastError: z.string().optional(),
})

/** Public decision summaries deliberately exclude raw probe errors and private notes. */
export const publicToolCheckSummarySchema = z.object({
  methodologyPath: z.literal('/about#recorded-checks'),
  verifiedAt: z.iso.datetime({offset: true}).optional(),
  lastCheckedAt: z.iso.datetime({offset: true}).optional(),
  sources: z.array(z.object({title: safePublicMetadataTextSchema(MAX_PUBLIC_SOURCE_REFERENCE_TITLE_LENGTH), url: publicMetadataUrlSchema, checkedAt: z.iso.datetime({offset: true}).optional()})),
  destinations: z.array(z.object({destination: z.literal('website'), status: z.enum(['ok', 'dead']), checkedAt: z.iso.datetime({offset: true})})),
})
export type PublicToolCheckSummary = z.infer<typeof publicToolCheckSummarySchema>

export const publicToolSwitchingGroupSchema = z.object({
  id: z.enum(['open_source', 'self_hosted', 'free_tier', 'cheaper']),
  label: safePublicMetadataTextSchema(MAX_PUBLIC_METADATA_LABEL_LENGTH),
  rule: safePublicMetadataTextSchema(MAX_PUBLIC_METADATA_NOTE_LENGTH),
  members: z.array(z.object({slug: z.string().min(1), name: safePublicMetadataTextSchema(MAX_PUBLIC_METADATA_LABEL_LENGTH), scope: z.string().refine(isSafePublicText, 'Use plain public edition or pricing scope.'), evidenceUrls: z.array(publicMetadataUrlSchema).min(1)})).min(1),
})
export type PublicToolSwitchingGroup = z.infer<typeof publicToolSwitchingGroupSchema>

export const publicToolFreshnessSchema = z.object({
  isVerified: z.boolean(),
  releaseDate: z.string().optional(),
  lastUpdated: z.string().optional(),
  verifiedAt: z.iso.datetime({offset: true}).optional(),
  lastCheckedAt: z.string().optional(),
  destinationHealth: z
    .object({
      website: destinationHealthEntrySchema.optional(),
      affiliateUrl: destinationHealthEntrySchema.optional(),
    })
    .optional(),
  hasDeadDestination: z.boolean().optional(),
})

export interface PublicToolFreshnessFields {
  isVerified: boolean
  verifiedAt?: string
}

export const normalizePublicToolFreshness = <Freshness extends PublicToolFreshnessFields>(
  freshness: Freshness,
): Freshness => ({
  ...freshness,
  isVerified: freshness.isVerified && Boolean(freshness.verifiedAt),
})

const isJsonObject = (value: JsonValue): value is JsonObject =>
  hasRuntimeObjectType(value) && value !== null && !Array.isArray(value)

const isPublicToolFreshnessFields = (
  value: JsonValue,
): value is JsonObject & PublicToolFreshnessFields =>
  isJsonObject(value) && isRuntimeBoolean(value.isVerified)

const normalizePublicToolFeedJson = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizePublicToolFeedJson(entry))
  }
  if (!isJsonObject(value)) {
    return value
  }

  const next: JsonObject = {}
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'freshness' && isPublicToolFreshnessFields(nested)) {
      next[key] = normalizePublicToolFreshness(nested)
      continue
    }
    next[key] = nested === undefined ? undefined : normalizePublicToolFeedJson(nested)
  }
  return next
}

export const normalizePublicToolFeedFreshness = <Value>(value: Value): Value =>
  normalizePublicToolFeedJson(value as JsonValue) as Value

export interface PublicToolFeedTemporalSummary {
  freshness: {
    verifiedAt?: string
    lastUpdated?: string
  }
}

export interface PublicToolFeedTemporalDetail extends PublicToolFeedTemporalSummary {

  resourceLinks?: ReadonlyArray<{checkedAt?: string}>
  fitGuidance?: {reviewedAt?: string}

  alternativeTools?: ReadonlyArray<PublicToolFeedTemporalSummary>
  relatedTools?: ReadonlyArray<PublicToolFeedTemporalSummary>
}

export interface PublicToolFeedTemporalIssue {
  path: Array<string | number>
  message: string
}

const getPublicTimestampReferenceIssue = (
  value: string | undefined,
  referenceTime: Date,
  path: Array<string | number>,
): PublicToolFeedTemporalIssue | undefined =>
  value && !isCatalogTimestampAtOrBefore(value, referenceTime)
    ? {
      path,
      message: 'Timestamp must be valid and no later than the feed generatedAt value',
    }
    : undefined

export const getPublicToolSummaryTemporalIssues = (
  tool: PublicToolFeedTemporalSummary,
  referenceTime: Date,
  path: Array<string | number> = [],
): PublicToolFeedTemporalIssue[] => {
  const issue = getPublicTimestampReferenceIssue(
    tool.freshness.verifiedAt,
    referenceTime,
    [...path, 'freshness', 'verifiedAt'],
  )

  return issue ? [issue] : []
}

export const getPublicToolDetailTemporalIssues = (
  tool: PublicToolFeedTemporalDetail,
  referenceTime: Date,
): PublicToolFeedTemporalIssue[] => [
  ...getPublicToolSummaryTemporalIssues(tool, referenceTime),
  ...(tool.resourceLinks ?? []).flatMap((resource, index) => {
    const issue = getPublicTimestampReferenceIssue(
      resource.checkedAt,
      referenceTime,
      ['resourceLinks', index, 'checkedAt'],
    )
    return issue ? [issue] : []
  }),
  ...(tool.fitGuidance?.reviewedAt
    ? [
        getPublicTimestampReferenceIssue(
          tool.fitGuidance.reviewedAt,
          referenceTime,
          ['fitGuidance', 'reviewedAt'],
        ),
      ].filter((issue): issue is PublicToolFeedTemporalIssue => Boolean(issue))
    : []),
  ...(tool.alternativeTools ?? []).flatMap((alternative, index) =>
    getPublicToolSummaryTemporalIssues(alternative, referenceTime, [
      'alternativeTools',
      index,
    ]),
  ),
  ...(tool.relatedTools ?? []).flatMap((companion, index) =>
    getPublicToolSummaryTemporalIssues(companion, referenceTime, ['relatedTools', index]),
  ),
]

export const publicToolSwitchReasonSchema = z.object({note: safePublicMetadataTextSchema(MAX_PUBLIC_ALTERNATIVE_NOTE_LENGTH), sourceUrl: publicMetadataUrlSchema})
