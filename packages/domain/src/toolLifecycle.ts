import {z} from 'zod'
import {isCatalogTimestampAtOrBefore} from './catalogFreshnessSearch.js'
import {isSafePublicText} from './publicText.js'
import {
  normalizePublicMetadataUrl,
  MAX_PUBLIC_METADATA_LABEL_LENGTH,
  MAX_PUBLIC_METADATA_URL_LENGTH,
} from './publicMetadata.js'
import {
  buildUniquePublicSourceReferenceMap,
  type SourceReferenceInput,
  type PublicSourceReference,
  SOURCE_REFERENCE_TYPE_VALUES,
} from './sourceReference.js'

export const TOOL_MAINTENANCE_STATUS_VALUES = ['active', 'unmaintained', 'reference', 'unknown'] as const
export const TOOL_MAINTENANCE_STATUS_LABELS = {active: 'Active', unmaintained: 'Unmaintained', reference: 'Reference', unknown: 'Unknown'} as const

export const TOOL_RELEASE_MODEL_VALUES = [
  'rolling',
  'versioned',
  'hosted_service',
  'unknown',
] as const
// Representative release policies and editorial fixtures: upstream docs/measurements/tool-lifecycle-2026-09-26.md.
export const TOOL_LIFECYCLE_MAX_EVIDENCE = 3

export const TOOL_RELEASE_MODEL_LABELS = {
  rolling: 'Rolling',
  versioned: 'Versioned',
  hosted_service: 'Hosted service',
  unknown: 'Unknown',
} as const

const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max, {
      error: (issue) =>
        `Lifecycle text limit=${max}, observed=${issue.input?.length ?? 'unavailable'}; shorten the text.`,
    })
    .refine(isSafePublicText, 'Use trimmed text without control or bidirectional characters.')
// Consumers validate the recorded instant without consulting their own clock.
const checkedAt = z.iso.datetime({offset: true})
const inputCheckedAt = checkedAt.refine((value) => isCatalogTimestampAtOrBefore(value), 'Checked dates cannot be in the future.')
const evidenceKeys = z
  .array(text(MAX_PUBLIC_METADATA_LABEL_LENGTH))
  .max(TOOL_LIFECYCLE_MAX_EVIDENCE, {
    error: (issue) =>
      `Lifecycle evidence limit=${TOOL_LIFECYCLE_MAX_EVIDENCE}, observed=${issue.input?.length ?? 'unavailable'}; select fewer sources.`,
  })
  .refine((keys) => new Set(keys).size === keys.length, 'Select each source once.')
const claimInput = {
  evidenceReferenceKeys: evidenceKeys.optional(),
  checkedAt: inputCheckedAt.optional(),
}
export const toolLifecycleInputSchema = z.object({
  maintenanceStatus: z.enum(TOOL_MAINTENANCE_STATUS_VALUES).optional(),
  maintenanceEvidenceReferenceKeys: evidenceKeys.optional(),
  releaseModel: z.enum(TOOL_RELEASE_MODEL_VALUES).optional(),
  ...claimInput,
})
export type ToolLifecycleInput = z.infer<typeof toolLifecycleInputSchema>

const lifecycleEvidenceSchema = z
  .object({
    title: text(MAX_PUBLIC_METADATA_LABEL_LENGTH),
    url: z
      .string()
      .max(MAX_PUBLIC_METADATA_URL_LENGTH)
      .refine((url) => normalizePublicMetadataUrl(url) === url),
    sourceType: z.enum(['official_docs', 'changelog', 'vendor_update', 'other']),
    checkedAt,
  })
  .strict()
  .refine(
    (reference) =>
      reference.sourceType !== 'other' ||
      (URL.canParse(reference.url) && new URL(reference.url).hostname === 'endoflife.date'),
    'Use official lifecycle evidence or a reviewed endoflife.date pointer.',
  )
export function isToolLifecycleEvidence(reference: PublicSourceReference): boolean {
  return inputCheckedAt.safeParse(reference.checkedAt).success && lifecycleEvidenceSchema.safeParse({title: reference.title, url: reference.url, sourceType: reference.sourceType, checkedAt: reference.checkedAt}).success
}

const publicClaim = {
  evidence: z.array(lifecycleEvidenceSchema).min(1).max(TOOL_LIFECYCLE_MAX_EVIDENCE),
  checkedAt,
}
const publicReleaseModelSchema = z.union([
  z.object({value: z.literal('unknown')}).strict(),
  z.object({value: z.enum(['rolling', 'versioned', 'hosted_service']), ...publicClaim}).strict(),
])
const maintenanceEvidenceSchema = z.object({
  title: text(MAX_PUBLIC_METADATA_LABEL_LENGTH),
  url: z.string().max(MAX_PUBLIC_METADATA_URL_LENGTH).refine((url) => normalizePublicMetadataUrl(url) === url),
  sourceType: z.enum(SOURCE_REFERENCE_TYPE_VALUES),
  checkedAt,
}).strict()

export function isToolMaintenanceEvidence(reference: PublicSourceReference): boolean {
  return inputCheckedAt.safeParse(reference.checkedAt).success && maintenanceEvidenceSchema.safeParse({title: reference.title, url: reference.url, sourceType: reference.sourceType, checkedAt: reference.checkedAt}).success
}

export const publicToolLifecycleSchema = z
  .object({
    maintenanceStatus: z.enum(TOOL_MAINTENANCE_STATUS_VALUES).optional(),
    maintenanceEvidence: z.array(maintenanceEvidenceSchema).min(1).max(TOOL_LIFECYCLE_MAX_EVIDENCE).optional(),
    releaseModel: publicReleaseModelSchema,
    // Deprecated compatibility key; remove at the next major feed version.
    releaseLines: z.array(z.never()),
  })
  .strict()
  .refine((value) => !['unmaintained', 'reference'].includes(value.maintenanceStatus ?? 'unknown') || Boolean(value.maintenanceEvidence?.length), 'Maintenance status needs cited public evidence.')
export type PublicToolLifecycle = z.infer<typeof publicToolLifecycleSchema>
export const TOOL_LIFECYCLE_JSON_SCHEMA = z
  .json()
  .parse(z.toJSONSchema(publicToolLifecycleSchema, {target: 'draft-7'}))

function resolveClaim(
  input: ToolLifecycleInput,
  references: ReadonlyMap<string, PublicSourceReference>,
) {
  if (!input.checkedAt || !input.evidenceReferenceKeys?.length) return undefined
  const evidence = input.evidenceReferenceKeys.map((key) => {
    const reference = references.get(key)
    if (!reference || !isToolLifecycleEvidence(reference)) return undefined
    // Keep only the evidence identity and date; private/editor notes never travel with claims.
    return lifecycleEvidenceSchema.safeParse({
      title: reference.title,
      url: reference.url,
      sourceType: reference.sourceType,
      checkedAt: reference.checkedAt,
    })
  })
  if (evidence.some((item) => !item?.success)) return undefined
  return {
    checkedAt: input.checkedAt,
    evidence: evidence.flatMap((item) => (item?.success ? [item.data] : [])),
  }
}

function reconstructLifecycle(
  input: ToolLifecycleInput,
  references: readonly SourceReferenceInput[] | null | undefined,
) {
  const sources = buildUniquePublicSourceReferenceMap(references)
  const maintenanceSources = (input.maintenanceEvidenceReferenceKeys ?? []).map((key) => sources.get(key))
  const maintenanceEvidence = maintenanceSources.length && maintenanceSources.every((reference) => reference && isToolMaintenanceEvidence(reference))
    ? maintenanceSources.flatMap((reference) => reference ? [maintenanceEvidenceSchema.parse({title: reference.title, url: reference.url, sourceType: reference.sourceType, checkedAt: reference.checkedAt})] : [])
    : undefined
  const maintenanceStatus = ['unmaintained', 'reference'].includes(input.maintenanceStatus ?? 'unknown') && !maintenanceEvidence
    ? 'unknown' : input.maintenanceStatus
  const modelClaim = resolveClaim(input, sources)
  const releaseModel: PublicToolLifecycle['releaseModel'] =
    input.releaseModel && input.releaseModel !== 'unknown' && modelClaim
      ? {value: input.releaseModel, ...modelClaim}
      : {value: 'unknown'}
  const value = publicToolLifecycleSchema.parse({
    ...(maintenanceStatus ? {maintenanceStatus} : undefined),
    ...(maintenanceEvidence ? {maintenanceEvidence} : undefined),
    releaseModel,
    releaseLines: [],
  })
  return value
}

/** Parse the CMS field once, then resolve every assertion against public editorial evidence. */
export function normalizePublicToolLifecycle<Input>(
  value: Input,
  references: readonly SourceReferenceInput[] | null | undefined,
): PublicToolLifecycle | undefined {
  if (value == null) return undefined
  const parsed = toolLifecycleInputSchema.safeParse(value)
  if (!parsed.success) {
    if (parsed.error.issues.some((issue) => issue.code === 'too_big'))
      throw new Error(parsed.error.message)
    return undefined
  }
  if (!parsed.data.maintenanceStatus && !parsed.data.releaseModel) return undefined
  return reconstructLifecycle(parsed.data, references)
}

export function validateToolLifecycle<Input>(
  value: Input,
  references: readonly SourceReferenceInput[] | null | undefined,
): true | string {
  if (value == null) return true
  const parsed = toolLifecycleInputSchema.safeParse(value)
  if (!parsed.success)
    return parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ')
  if ((!parsed.data.releaseModel || parsed.data.releaseModel === 'unknown') && (parsed.data.checkedAt || parsed.data.evidenceReferenceKeys?.length))
    return 'Choose a release model before adding its checked date or evidence.'
  try {
    const result = reconstructLifecycle(parsed.data, references)
    if (['unmaintained', 'reference'].includes(parsed.data.maintenanceStatus ?? 'unknown') && result.maintenanceStatus === 'unknown') return 'Maintenance status needs 1–3 checked public source references.'
    if (
      parsed.data.releaseModel &&
      parsed.data.releaseModel !== 'unknown' &&
      result.releaseModel.value === 'unknown'
    )
      return 'Release model needs a checked date and 1–3 checked public lifecycle sources.'
    return true
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid lifecycle facts.'
  }
}
