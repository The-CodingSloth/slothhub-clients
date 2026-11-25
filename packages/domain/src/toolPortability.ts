import {z} from 'zod'
import {isCatalogTimestampAtOrBefore} from './catalogFreshnessSearch.js'
import {isSafePublicText} from './publicText.js'
import {
  normalizePublicMetadataUrl,
  MAX_PUBLIC_METADATA_LABEL_LENGTH,
  MAX_PUBLIC_METADATA_NOTE_LENGTH,
  MAX_PUBLIC_METADATA_URL_LENGTH,
} from './publicMetadata.js'
import {
  buildUniquePublicSourceReferenceMap,
  SOURCE_REFERENCE_TYPE_VALUES,
  type SourceReferenceInput,
  type PublicSourceReference,
} from './sourceReference.js'
import {resolveResourceIdentity, type ResourceIdentityInput} from './resourceIdentity.js'
import {getToolWebsiteIdentityKey} from './toolWebsiteIdentity.js'
import {isValidToolPublicSlug} from './toolLookup.js'

export const PORTABILITY_DIRECTION_VALUES = ['import', 'export', 'both'] as const
export const PORTABILITY_SUPPORT_VALUES = [
  'native',
  'adapter',
  'partial',
  'claimed',
  'unknown',
] as const
export const PORTABILITY_EXIT_VALUES = ['full', 'partial', 'none', 'unknown'] as const
export const PORTABILITY_EXIT_SCOPE_VALUES = ['data', 'configuration', 'history', 'assets'] as const
export const PORTABILITY_SCOPE_VALUES = [...PORTABILITY_EXIT_SCOPE_VALUES, 'identity'] as const
export const PORTABILITY_MIGRATION_DIRECTION_VALUES = [
  'into_this_tool',
  'out_of_this_tool',
] as const
export const PORTABILITY_MIGRATION_METHOD_VALUES = [
  'native',
  'partner',
  'manual',
  'community',
] as const
export const PORTABILITY_MIGRATION_STATUS_VALUES = [
  'supported',
  'partial',
  'deprecated',
  'unknown',
] as const
// Receipt: upstream docs/measurements/tool-portability-2026-09-26.md.
export const PORTABILITY_MAX_FORMATS = 8
export const PORTABILITY_MAX_MIGRATIONS = 8
export const PORTABILITY_MAX_EVIDENCE = 3

export const PORTABILITY_LABELS = {
  import: 'Import',
  export: 'Export',
  both: 'Import and export',
  native: 'Native',
  adapter: 'Adapter',
  partial: 'Partial',
  claimed: 'Claimed',
  unknown: 'Unknown',
  full: 'Full',
  none: 'None',
  data: 'Data',
  configuration: 'Configuration',
  history: 'History',
  assets: 'Assets',
  identity: 'Identity',
  into_this_tool: 'Into this tool from',
  out_of_this_tool: 'Out of this tool to',
  partner: 'Partner',
  manual: 'Manual',
  community: 'Community',
  supported: 'Supported',
  deprecated: 'Deprecated',
} as const

const text = (limit: number) =>
  z
    .string()
    .min(1)
    .max(limit, {
      error: (issue) =>
        `Portability text limit=${limit}, observed=${issue.input?.length ?? 'unavailable'}; shorten the text.`,
    })
    .refine(isSafePublicText, 'Use trimmed text without control or bidirectional characters.')
const label = text(MAX_PUBLIC_METADATA_LABEL_LENGTH)
const note = text(MAX_PUBLIC_METADATA_NOTE_LENGTH)
const checkedAt = z.iso.datetime({offset: true})
const inputCheckedAt = checkedAt.refine((value) => isCatalogTimestampAtOrBefore(value), 'Checked dates cannot be in the future.')
const publicUrl = z
  .string()
  .max(MAX_PUBLIC_METADATA_URL_LENGTH)
  .refine(
    (value) => normalizePublicMetadataUrl(value) === value,
    'Use a canonical public HTTP or HTTPS URL.',
  )
const inputUrl = z
  .string()
  .max(MAX_PUBLIC_METADATA_URL_LENGTH, {
    error: (issue) =>
      `Portability URL limit=${MAX_PUBLIC_METADATA_URL_LENGTH}, observed=${issue.input?.length ?? 'unavailable'}; use a shorter public canonical URL.`,
  })
  .refine(
    (value) => Boolean(normalizePublicMetadataUrl(value)),
    'Use a safe public HTTP or HTTPS URL.',
  )
  .transform((value) => new URL(value).href)
const evidenceKeys = z
  .array(label)
  .max(PORTABILITY_MAX_EVIDENCE, {
    error: (issue) =>
      `Portability evidence limit=${PORTABILITY_MAX_EVIDENCE}, observed=${issue.input?.length ?? 'unavailable'}; select fewer sources.`,
  })
  .refine((keys) => new Set(keys).size === keys.length, 'Select each source once.')
const claimFields = {
  checkedAt: inputCheckedAt.optional(),
  evidenceReferenceKeys: evidenceKeys.optional(),
}
const scope = z
  .array(z.enum(PORTABILITY_SCOPE_VALUES))
  .min(1)
  .max(PORTABILITY_SCOPE_VALUES.length, {
    error: (issue) =>
      `Migration scope limit=${PORTABILITY_SCOPE_VALUES.length}, observed=${issue.input?.length ?? 'unavailable'}; select each scope once.`,
  })
  .refine((values) => new Set(values).size === values.length, 'Select each migration scope once.')
const counterpartResourceIdentitySchema = z.object({
  kind: z.json().optional(), canonicalUrl: z.string().nullish(), registryId: z.string().nullish(),
  websiteUrl: z.string().nullish(), repositoryUrl: z.string().nullish(), docsUrl: z.string().nullish(),
  packageUrl: z.string().nullish(), mcpRegistryUrl: z.string().nullish(),
})
const resolvedToolSchema = z.object({
  id: label.refine((value) => !value.startsWith('drafts.')),
  name: label,
  slug: label.refine(isValidToolPublicSlug),
  url: z.string().optional(),
  website: z.string().nullish(),
  resourceIdentity: counterpartResourceIdentitySchema.nullish(),
  isPublic: z.literal(true),
}).transform(tool => ({
  id: tool.id, name: tool.name, slug: tool.slug, isPublic: tool.isPublic,
  url: resolveResourceIdentity({resourceIdentity: tool.resourceIdentity, website: tool.website ?? tool.url})?.canonicalUrl,
})).pipe(z.object({id: label, name: label, slug: label, url: inputUrl, isPublic: z.literal(true)}))
const counterpartInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('tool'),
    tool: z.object({_ref: label}).optional(),
    // Invalid public metadata makes this counterpart unresolved, without hiding unrelated facts.
    resolvedTool: resolvedToolSchema.nullish().catch(undefined),
  }),
  z.object({kind: z.literal('external'), name: label, url: inputUrl, ...claimFields}),
])
const formatFields = {name: label, direction: z.enum(PORTABILITY_DIRECTION_VALUES)}
const formatInputSchema = z.object({
  ...formatFields,
  supportMode: z.enum(PORTABILITY_SUPPORT_VALUES),
  version: label.optional(),
  profile: label.optional(),
  note: note.optional(),
  ...claimFields,
})
const exitInputSchema = z.object({
  scope: z.enum(PORTABILITY_EXIT_SCOPE_VALUES),
  state: z.enum(PORTABILITY_EXIT_VALUES),
  note: note.optional(),
  ...claimFields,
})
const migrationInputSchema = z.object({
  direction: z.enum(PORTABILITY_MIGRATION_DIRECTION_VALUES),
  counterpart: counterpartInputSchema,
  method: z.enum(PORTABILITY_MIGRATION_METHOD_VALUES),
  scope,
  status: z.enum(PORTABILITY_MIGRATION_STATUS_VALUES),
  instructions: note.optional(),
  ...claimFields,
})
export const toolPortabilityInputSchema = z.object({
  formats: z
    .array(formatInputSchema)
    .max(PORTABILITY_MAX_FORMATS, {
      error: (issue) =>
        `Portability formats limit=${PORTABILITY_MAX_FORMATS}, observed=${issue.input?.length ?? 'unavailable'}; keep the relevant formats.`,
    })
    .optional(),
  exits: z
    .array(exitInputSchema)
    .max(PORTABILITY_EXIT_SCOPE_VALUES.length, {
      error: (issue) =>
        `Portability exits limit=${PORTABILITY_EXIT_SCOPE_VALUES.length}, observed=${issue.input?.length ?? 'unavailable'}; record each exit scope once.`,
    })
    .optional(),
  migrations: z
    .array(migrationInputSchema)
    .max(PORTABILITY_MAX_MIGRATIONS, {
      error: (issue) =>
        `Portability migrations limit=${PORTABILITY_MAX_MIGRATIONS}, observed=${issue.input?.length ?? 'unavailable'}; keep the relevant migration paths.`,
    })
    .optional(),
})
export type ToolPortabilityInput = z.infer<typeof toolPortabilityInputSchema>

const evidenceSchema = z
  .object({
    title: label,
    url: publicUrl,
    sourceType: z.enum(SOURCE_REFERENCE_TYPE_VALUES),
    checkedAt,
  })
  .strict()
const publicClaimFields = {
  checkedAt,
  evidence: z.array(evidenceSchema).min(1).max(PORTABILITY_MAX_EVIDENCE),
}
const publicCounterpartSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('tool'),
      name: label,
      slug: label.refine(isValidToolPublicSlug),
      url: publicUrl,
    })
    .strict(),
  z
    .object({kind: z.literal('external'), name: label, url: publicUrl, ...publicClaimFields})
    .strict(),
])
const publicMigrationFields = {
  key: z.string(),
  direction: z.enum(PORTABILITY_MIGRATION_DIRECTION_VALUES),
  counterpart: publicCounterpartSchema,
  scope,
}
export const publicToolPortabilitySchema = z
  .object({
    formats: z
      .array(
        z.union([
          z.object({...formatFields, supportMode: z.literal('unknown')}).strict(),
          formatInputSchema
            .extend({
              ...publicClaimFields,
              supportMode: z.enum(['native', 'adapter', 'partial', 'claimed']),
            })
            .omit({evidenceReferenceKeys: true})
            .strict(),
        ]),
      )
      .max(PORTABILITY_MAX_FORMATS),
    exits: z
      .array(
        z.union([
          z
            .object({scope: z.enum(PORTABILITY_EXIT_SCOPE_VALUES), state: z.literal('unknown')})
            .strict(),
          exitInputSchema
            .extend({...publicClaimFields, state: z.enum(['full', 'partial', 'none'])})
            .omit({evidenceReferenceKeys: true})
            .strict(),
        ]),
      )
      .max(PORTABILITY_EXIT_SCOPE_VALUES.length),
    migrations: z
      .array(
        z.union([
          z.object({...publicMigrationFields, status: z.literal('unknown')}).strict(),
          z
            .object({
              ...publicMigrationFields,
              method: z.enum(PORTABILITY_MIGRATION_METHOD_VALUES),
              status: z.enum(['supported', 'partial', 'deprecated']),
              instructions: note.optional(),
              ...publicClaimFields,
            })
            .strict(),
        ]),
      )
      .max(PORTABILITY_MAX_MIGRATIONS),
  })
  .strict()
  .superRefine((value, context) => {
    const keys = new Set<string>()
    const identities = new Set<string>()
    for (const [index, migration] of value.migrations.entries()) {
      const identity =
        migration.counterpart.kind === 'tool'
          ? `tool:${migration.counterpart.slug}`
          : `external:${getToolWebsiteIdentityKey(migration.counterpart.url)}`
      const key = migrationKey(migration.direction, identity, migration.scope)
      const identityKey = migrationKey(
        migration.direction,
        `url:${getToolWebsiteIdentityKey(migration.counterpart.url)}`,
        migration.scope,
      )
      if (migration.key !== key || keys.has(key) || identities.has(identityKey))
        context.addIssue({
          code: 'custom',
          path: ['migrations', index, 'key'],
          message:
            'Migration keys must be unique and match direction, counterpart, and sorted scope.',
        })
      keys.add(key)
      identities.add(identityKey)
    }
  })
export type PublicToolPortability = z.infer<typeof publicToolPortabilitySchema>
export const TOOL_PORTABILITY_JSON_SCHEMA = z
  .json()
  .parse(z.toJSONSchema(publicToolPortabilitySchema, {target: 'draft-7'}))

export interface PortabilitySourceTool {
  _id: string
  slug?: string
  website?: string
  resourceIdentity?: ResourceIdentityInput | null
}
type PortabilityClaim =
  | z.infer<typeof formatInputSchema>
  | z.infer<typeof exitInputSchema>
  | z.infer<typeof migrationInputSchema>
  | Extract<z.infer<typeof counterpartInputSchema>, {kind: 'external'}>
type PortabilityMigration = z.infer<typeof migrationInputSchema>

function resolveClaim(
  input: PortabilityClaim,
  references: ReadonlyMap<string, PublicSourceReference>,
) {
  if (!input.checkedAt || !input.evidenceReferenceKeys?.length) return undefined
  const evidence = input.evidenceReferenceKeys.map((key) => {
    const source = references.get(key)
    return evidenceSchema.safeParse(
      source && inputCheckedAt.safeParse(source.checkedAt).success && {
        title: source.title,
        url: source.url,
        sourceType: source.sourceType,
        checkedAt: source.checkedAt,
      },
    )
  })
  if (evidence.some((value) => !value.success)) return undefined
  return {
    checkedAt: input.checkedAt,
    evidence: evidence.flatMap((value) => (value.success ? [value.data] : [])),
  }
}
function migrationKey(
  direction: PortabilityMigration['direction'],
  identity: string,
  scopes: PortabilityMigration['scope'],
) {
  return JSON.stringify([direction, identity, [...scopes].sort()])
}
const normalizedText = (value: string) => value.normalize('NFKC').toLowerCase()
const canonicalId = (value: string) => value.replace(/^drafts\./, '')

function validateIdentities(input: ToolPortabilityInput, source: PortabilitySourceTool) {
  const seen = new Set<string>()
  const add = (key: string) => {
    if (seen.has(key))
      throw new Error(
        'Duplicate portability fact. Consolidate rows with the same direction, counterpart and scope, or format/exit identity.',
      )
    seen.add(key)
  }
  for (const format of input.formats ?? [])
    add(
      JSON.stringify([
        'format',
        normalizedText(format.name),
        format.direction,
        normalizedText(format.version ?? ''),
        normalizedText(format.profile ?? ''),
      ]),
    )
  for (const exit of input.exits ?? []) add(`exit:${exit.scope}`)
  const sourceUrl = getToolWebsiteIdentityKey(resolveResourceIdentity(source)?.canonicalUrl)
  for (const migration of input.migrations ?? []) {
    const counterpart = migration.counterpart
    if (counterpart.kind === 'tool') {
      const id = counterpart.tool?._ref ?? counterpart.resolvedTool?.id
      if (id && canonicalId(id) === canonicalId(source._id))
        throw new Error('A Tool cannot migrate to or from itself. Choose another counterpart.')
      if (source.slug && counterpart.resolvedTool?.slug === source.slug)
        throw new Error('A Tool cannot migrate to or from itself. Choose another counterpart.')
      if (sourceUrl && getToolWebsiteIdentityKey(counterpart.resolvedTool?.url) === sourceUrl)
        throw new Error(
          'A Tool cannot migrate to or from its own canonical identity. Choose another counterpart.',
        )
      if (id) add(migrationKey(migration.direction, `tool:${canonicalId(id)}`, migration.scope))
      if (counterpart.resolvedTool)
        add(
          migrationKey(
            migration.direction,
            `url:${getToolWebsiteIdentityKey(counterpart.resolvedTool.url)}`,
            migration.scope,
          ),
        )
    } else {
      const identity = getToolWebsiteIdentityKey(counterpart.url)
      if (sourceUrl && identity === sourceUrl)
        throw new Error('An external counterpart cannot be the current Tool. Choose another URL.')
      add(migrationKey(migration.direction, `url:${identity}`, migration.scope))
    }
  }
}

function reconstructPortability(
  input: ToolPortabilityInput,
  references: readonly SourceReferenceInput[] | null | undefined,
  source: PortabilitySourceTool,
): PublicToolPortability {
  validateIdentities(input, source)
  const sources = buildUniquePublicSourceReferenceMap(references)
  const formats: PublicToolPortability['formats'] = (input.formats ?? []).map((format) => {
    const claim = resolveClaim(format, sources)
    if (format.supportMode === 'unknown' || !claim)
      return {name: format.name, direction: format.direction, supportMode: 'unknown'}
    const {checkedAt: _date, evidenceReferenceKeys: _keys, ...facts} = format
    return {...facts, ...claim}
  })
  const exits: PublicToolPortability['exits'] = (input.exits ?? []).map((exit) => {
    const claim = resolveClaim(exit, sources)
    if (exit.state === 'unknown' || !claim) return {scope: exit.scope, state: 'unknown'}
    const {checkedAt: _date, evidenceReferenceKeys: _keys, ...facts} = exit
    return {...facts, ...claim}
  })
  const migrations: PublicToolPortability['migrations'] = []
  for (const migration of input.migrations ?? []) {
    const inputCounterpart = migration.counterpart
    let counterpart: z.infer<typeof publicCounterpartSchema>
    if (inputCounterpart.kind === 'tool') {
      const tool = inputCounterpart.resolvedTool
      if (!tool || (inputCounterpart.tool && inputCounterpart.tool._ref !== tool.id)) continue
      counterpart = {kind: 'tool', name: tool.name, slug: tool.slug, url: tool.url}
    } else {
      const identityClaim = resolveClaim(inputCounterpart, sources)
      if (!identityClaim) continue
      counterpart = {
        kind: 'external',
        name: inputCounterpart.name,
        url: inputCounterpart.url,
        ...identityClaim,
      }
    }
    const identity =
      counterpart.kind === 'tool'
        ? `tool:${counterpart.slug}`
        : `external:${getToolWebsiteIdentityKey(counterpart.url)}`
    const key = migrationKey(migration.direction, identity, migration.scope)
    const base = {
      key,
      direction: migration.direction,
      counterpart,
      scope: [...migration.scope].sort(),
    }
    const claim = resolveClaim(migration, sources)
    if (migration.status === 'unknown' || !claim) migrations.push({...base, status: 'unknown'})
    else
      migrations.push({
        ...base,
        status: migration.status,
        method: migration.method,
        ...(migration.instructions ? {instructions: migration.instructions} : undefined),
        ...claim,
      })
  }
  return publicToolPortabilitySchema.parse({formats, exits, migrations})
}

/** Public projection never infers reverse claims or falls back from a hidden Tool to external details. */
export function normalizePublicToolPortability<Input>(
  value: Input,
  references: readonly SourceReferenceInput[] | null | undefined,
  source: PortabilitySourceTool,
): PublicToolPortability | undefined {
  if (value == null) return undefined
  const parsed = toolPortabilityInputSchema.safeParse(value)
  if (!parsed.success) {
    if (parsed.error.issues.some((issue) => issue.code === 'too_big'))
      throw new Error(parsed.error.message)
    return undefined
  }
  const facts = reconstructPortability(parsed.data, references, source)
  return facts.formats.length || facts.exits.length || facts.migrations.length ? facts : undefined
}

export function validateToolPortability<Input>(
  value: Input,
  references: readonly SourceReferenceInput[] | null | undefined,
  source: PortabilitySourceTool,
): true | string {
  if (value == null) return true
  const parsed = toolPortabilityInputSchema.safeParse(value)
  if (!parsed.success)
    return parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ')
  try {
    validateIdentities(parsed.data, source)
    const sources = buildUniquePublicSourceReferenceMap(references)
    for (const format of parsed.data.formats ?? []) {
      if (format.supportMode === 'unknown' && (format.version || format.profile || format.note))
        return 'Unknown format support cannot carry asserted versions, profiles, or notes.'
      if (format.supportMode !== 'unknown' && !resolveClaim(format, sources))
        return 'Format support needs a checked date and 1–3 checked public sources.'
    }
    for (const exit of parsed.data.exits ?? []) {
      if (exit.state === 'unknown' && exit.note)
        return 'Unknown exit facts cannot carry asserted notes.'
      if (exit.state !== 'unknown' && !resolveClaim(exit, sources))
        return 'Each exit claim, including none, needs a checked date and 1–3 checked public sources.'
    }
    for (const migration of parsed.data.migrations ?? []) {
      if (migration.counterpart.kind === 'tool' && !migration.counterpart.tool?._ref)
        return 'Select the counterpart Tool. Hidden or unpublished Tools are omitted from public output.'
      if (
        migration.counterpart.kind === 'external' &&
        !resolveClaim(migration.counterpart, sources)
      )
        return 'An external counterpart needs its own public name, URL, checked date, and 1–3 checked public sources.'
      if (migration.status === 'unknown' && migration.instructions)
        return 'Unknown migration support cannot carry asserted instructions.'
      if (migration.status !== 'unknown' && !resolveClaim(migration, sources))
        return 'Migration support needs a checked date and 1–3 checked public sources.'
    }
    return true
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid portability facts.'
  }
}
