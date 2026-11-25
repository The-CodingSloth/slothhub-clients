import {toolCapabilityListFields, toolCapabilityCountsMatch, isToolCapabilityInterfaceReferenceValid, type ToolCapabilityInterfaceRow} from './toolFeatureCapabilityList.js'
import {z} from 'zod'
import {getToolInstallCommands, validateToolInstall, toolInstallFields, toolInstallCommandSchema} from './toolFeatureInstall.js'
import {classifyToolFeatureDiffLines} from './toolFeatureDiff.js'

import {getToolFeatureExamples, getToolFeatureLanguage, getToolFeatureSource} from './toolFeatureContent.js'
import {ARTICLE_CODE_LANGUAGES} from './articleRichText.js'
import type {JsonValue} from './jsonValue.js'
import {validatePublicHttpUrl} from './urlSafety.js'
import {LIVING_CATALOG_CHECK_MAX_AGE_SECONDS} from './livingCatalogFreshness.js'
import {normalizePublicRuntimeRequirements, parsePublicRuntimeRequirements, RUNTIME_REQUIREMENT_SUBJECT_KIND_VALUES, RUNTIME_REQUIREMENT_STATUS_VALUES, type RuntimeRequirementInput} from './runtimeRequirements.js'
import type {SourceReferenceInput} from './sourceReference.js'
import {toolFeatureImageFields} from './toolFeatureImage.js'
import {TOOL_FEATURE_LIMIT_QUALIFIER_LABELS} from './toolFeaturePresentation.js'
export {TOOL_FEATURE_LIMIT_QUALIFIER_LABELS, TOOL_FEATURE_OUTPUT_UNAVAILABLE_LABELS, formatToolFeatureLimitEntry} from './toolFeaturePresentation.js'

export const TOOL_FEATURE_LIMIT_TYPES = ['quota', 'rate-limit', 'usage-restriction', 'license'] as const
export const TOOL_FEATURE_LIMIT_QUALIFIERS = ['up_to', 'included', 'unlimited', 'minimum'] as const
export const toolFeatureSourceUrlSchema = z.url().refine((value) => {
  if (!validatePublicHttpUrl(value).success) return false
  const url = new URL(value)
  return url.protocol === 'https:' && !url.port
}, 'Use a public HTTPS source URL without credentials or a custom port.')
export const toolFeatureCheckableSourceUrlSchema = toolFeatureSourceUrlSchema.refine(
  (value) => URL.canParse(value) && !new URL(value).search,
  'Use the canonical public documentation URL without query parameters; the source reader cannot check query-bearing URLs.',
)

const limitEntrySchema = z.object({
  type: z.enum(TOOL_FEATURE_LIMIT_TYPES),
  label: z.string().trim().min(1),
  qualifier: z.enum(TOOL_FEATURE_LIMIT_QUALIFIERS).optional(),
  value: z.union([z.string().trim().min(1), z.number().nonnegative()]).pipe(z.coerce.string()).optional(),
  unit: z.string().trim().min(1).optional(),
  period: z.string().trim().min(1).optional(),
  sourceUrl: toolFeatureSourceUrlSchema.optional(),
}).refine(({period, value, unit}) => !period || !!value || !!unit, {
  path: ['period'],
  message: 'Add a value or unit before setting a period.',
})
export type ToolFeatureLimitEntry = z.infer<typeof limitEntrySchema>

/** Authoring policy; keep existing public values readable while writes require a correction. */
export function validateToolFeatureLimitValue(entry: ToolFeatureLimitEntry): true | string {
  if (entry.qualifier === 'unlimited' && entry.value) {
    return `“${entry.label}”: remove value when qualifier is Unlimited; keep the scope in label or unit.`
  }
  if (entry.qualifier && entry.qualifier !== 'unlimited' && !entry.value) {
    return `“${entry.label}”: add a value when qualifier is ${TOOL_FEATURE_LIMIT_QUALIFIER_LABELS[entry.qualifier]}; remove the qualifier if no amount applies.`
  }
  if (entry.type !== 'license' && entry.value && /[\p{Sc}%٪％]/u.test(entry.value)) {
    return `“${entry.label}”: keep currency symbols and percent signs out of value; put the currency or percentage in unit and the cadence in period.`
  }
  if (entry.type !== 'license' && entry.value && entry.unit && entry.value.toLowerCase().endsWith(entry.unit.toLowerCase())) {
    const quantity = entry.value.slice(0, -entry.unit.length)
    if (/[\s\d]$/.test(quantity)) return `“${entry.label}”: value repeats unit “${entry.unit}”; remove the trailing unit from value.`
  }
  return true
}

export const TOOL_FEATURE_SHELLS = ['shell', 'bash', 'sh', 'zsh', 'fish', 'powershell', 'cmd'] as const
export const toolFeatureShellSchema = z.enum(TOOL_FEATURE_SHELLS, {
  error: `shell-not-allowed: Choose a supported shell: ${TOOL_FEATURE_SHELLS.join(', ')}. Use shell for a generic shell command.`,
})
export const TOOL_FEATURE_OUTPUT_UNAVAILABLE_TYPES = ['not_documented', 'interactive', 'not_run'] as const
const outputUnavailableSchema = z.object({
  type: z.enum(TOOL_FEATURE_OUTPUT_UNAVAILABLE_TYPES),
  reason: z.string().trim().min(1, 'Explain why example output is unavailable.').regex(/^[^\r\n]+$/u, 'Keep the output explanation on one line.'),
})
export const TOOL_FEATURE_PLAYGROUND_PROVIDERS = ['StackBlitz', 'CodeSandbox'] as const
/** Curated icon keys editors can pick for a key feature; the site maps each to a glyph. */
export const TOOL_FEATURE_ICONS = [
  'sparkles', 'zap', 'bot', 'brain', 'code', 'terminal', 'layers', 'workflow',
  'plug', 'puzzle', 'database', 'cloud', 'globe', 'search', 'chart', 'gauge',
  'shield', 'lock', 'users', 'message', 'git-branch', 'rocket', 'palette', 'image',
  'file-text', 'settings', 'wand', 'clock',
] as const
export type ToolFeatureIconName = (typeof TOOL_FEATURE_ICONS)[number]

const playgroundSchema = z.object({
  provider: z.enum(TOOL_FEATURE_PLAYGROUND_PROVIDERS),
  url: z.url().refine((value) => {
    if (!URL.canParse(value)) return false
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
  }, 'Use a public HTTPS project URL without credentials or a custom port.'),
}).refine(({provider, url}) => {
  if (!URL.canParse(url)) return false
  const parsed = new URL(url)
  return provider === 'StackBlitz'
    ? parsed.hostname === 'stackblitz.com' && /^\/(?:edit|github|fork)\/.+/.test(parsed.pathname)
    : parsed.hostname === 'codesandbox.io' && /^\/(?:s|p\/(?:sandbox|devbox|github))\/.+/.test(parsed.pathname)
}, 'Choose a project URL on the selected playground provider.')

const playgrounds = z.array(playgroundSchema).refine(
  (values) => new Set(values.map(({provider}) => provider)).size === values.length,
  'Keep one project link per playground provider.',
).optional()

const featureFields = {
  feature: z.string().trim().min(1),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  icon: z.enum(TOOL_FEATURE_ICONS).optional(),
  checkedAt: z.iso.datetime({offset: true}).optional(),
  sourceUrl: toolFeatureSourceUrlSchema.optional(),
  image: z.object({
    ...toolFeatureImageFields,
    sourceUrl: toolFeatureCheckableSourceUrlSchema.optional(),
    checkedAt: z.iso.datetime({offset: true}).optional(),
  }).optional(),
}

const codeSource = z.string().refine((value) => value.trim().length > 0, 'Add a code example.')
// The JSON guard excludes metadata-only patches without forbidding unpaired +++/--- source.
// Hunk counts and ambiguous header pairs remain owned by the shared runtime classifier.
const metadataOnlyDiffPattern = /^(?:(?:[^+\-@\n][^\n]*|\r?)\n|---[\t ][^\n]*\n\+\+\+[\t ][^\n]*(?:\n|$))+(?:(?:@@| |\\)[^\n]*(?:\n|$))*\n*$/
const commandSource = z.string().refine((value) => value.trim().length > 0, 'Add a terminal command without prompt markers or output.')
const exampleOutput = z.string().refine((value) => value.trim().length > 0, 'Remove empty example output.').optional()
const codeFileSchema = z.object({filename: z.string().trim().min(1), language: z.enum(ARTICLE_CODE_LANGUAGES), code: codeSource})
const terminalVariantSchema = z.object({label: z.string().trim().min(1), shell: toolFeatureShellSchema, command: commandSource, output: exampleOutput})
const shortcutEntrySchema = z.object({
  action: z.string().trim().min(1),
  mac: z.string().trim().min(1).optional(),
  windows: z.string().trim().min(1).optional(),
  linux: z.string().trim().min(1).optional(),
}).refine((entry) => !!(entry.mac || entry.windows || entry.linux), 'Add at least one source-authored OS key combination.')
  // Mirror the cross-field rule in public JSON, while editors can hold incomplete drafts.
  .meta({anyOf: [{required: ['mac']}, {required: ['windows']}, {required: ['linux']}]})

export const TOOL_FEATURE_TABLE_KINDS = ['config', 'env', 'flag', 'param', 'output_field'] as const
export const TOOL_FEATURE_PERMISSION_MODELS = ['oauth', 'extension', 'runtime', 'token', 'role'] as const
const permissionEntrySchema = z.object({
  permission: z.string().refine((value) => !!value.trim(), 'Add the verbatim permission name.'),
  scope: z.string().trim().min(1).optional(),
  required: z.boolean(),
  reason: z.string().trim().min(1).optional(),
})
// Editorial preview budget requested by upstream #1705; receipt: upstream docs/measurements/key-feature-tables-2026-10-20.md.
export const MAX_TOOL_FEATURE_REFERENCE_ROWS = 12
const referenceRowSchema = z.object({
  name: z.string().refine((value) => !!value.trim(), 'Add the verbatim name.'),
  type: z.string().trim().min(1).optional(),
  default: z.string().optional(),
  required: z.boolean().optional(),
  description: z.string().trim().min(1),
  sourceUrl: toolFeatureSourceUrlSchema.optional(),
})
const referenceFeatureSchema = z.object({
  ...featureFields, kind: z.literal('reference'), tableKind: z.enum(TOOL_FEATURE_TABLE_KINDS),
  rows: z.array(referenceRowSchema).min(1).max(MAX_TOOL_FEATURE_REFERENCE_ROWS, {error: (issue) => `reference_rows_exceeded: limit_rows=${MAX_TOOL_FEATURE_REFERENCE_ROWS}, actual_rows=${Array.isArray(issue.input) ? issue.input.length : 'unavailable'}. Keep representative rows and link to the full reference in the official docs URL.`}),
  sourceUrl: toolFeatureCheckableSourceUrlSchema,
})
// Public rows retain the existing runtime requirement contract and evidence policy.
const compatibilityRowsSchema = z.array(z.object({
  subjectKind: z.enum(RUNTIME_REQUIREMENT_SUBJECT_KIND_VALUES), subjectName: z.string(), environmentRange: z.string(),
  toolRange: z.string().optional(), status: z.enum(RUNTIME_REQUIREMENT_STATUS_VALUES), note: z.string().optional(),
  evidence: z.array(z.object({title: z.string(), url: z.string(), checkedAt: z.string()})), reviewedAt: z.string(),
})).min(1).refine((rows) => parsePublicRuntimeRequirements(rows).success, 'Use validated runtime requirements with public evidence.')

export interface ToolFeatureContext {
  runtimeRequirements?: readonly RuntimeRequirementInput[] | null
  sourceReferences?: readonly SourceReferenceInput[] | null
  agentInterfaces?: readonly (ToolCapabilityInterfaceRow | null)[] | null
}

const installFeatureSchema = z.object({...featureFields, kind: z.literal('install'), ...toolInstallFields, sourceUrl: toolFeatureCheckableSourceUrlSchema, commands: z.array(toolInstallCommandSchema).optional()})
const validatedInstallFeatureSchema = installFeatureSchema.superRefine(validateToolInstall)

const capabilityListFeatureSchema = z.object({...featureFields, kind: z.literal('capability_list'), ...toolCapabilityListFields, sourceUrl: toolFeatureCheckableSourceUrlSchema, count: z.number().int().nonnegative().optional()})
const publicCapabilityListFeatureSchema = capabilityListFeatureSchema.omit({agentInterfaceKey: true}).strict().extend({count: z.number().int().nonnegative().describe('Computed from items.length. Enforce equality using toolFeaturePublicDetailSchema or an equivalent cross-field check.')}).required({checkedAt: true})
  .refine(toolCapabilityCountsMatch, 'Remove typed capability counts or match the number of entries.')
  .refine((detail) => detail.count === detail.items.length, 'Public capability count must equal items.length; regenerate the Tool detail feed.')
const publicInstallFeatureSchema = installFeatureSchema.required({checkedAt: true, commands: true}).superRefine(validateToolInstall)
  .refine((detail) => JSON.stringify(detail.commands) === JSON.stringify(getToolInstallCommands(detail)), 'Public install commands must match the selected managers and inputs; regenerate the Tool detail feed.')
const verifiedFeatureEvidenceSchema = z.object({sourceUrl: toolFeatureCheckableSourceUrlSchema, checkedAt: z.iso.datetime({offset: true})})

function hasVerifiedFeatureEvidence(detail: ToolFeatureDetail): boolean {
  const parsed = verifiedFeatureEvidenceSchema.safeParse(detail)
  return parsed.success && Date.parse(parsed.data.checkedAt) <= Date.now()
}

function hasCapabilityInterface(detail: Extract<ToolFeatureDetail, {kind: 'capability_list'}>, context?: ToolFeatureContext): boolean {
  return isToolCapabilityInterfaceReferenceValid(detail, context?.agentInterfaces)
}

const permissionsFeatureSchema = z.object({...featureFields, kind: z.literal('permissions'), model: z.enum(TOOL_FEATURE_PERMISSION_MODELS), entries: z.array(permissionEntrySchema).min(1, 'Add at least one permission.')})

const proseFeatureSchemas = [
  z.object({...featureFields, kind: z.literal('feature'), body: z.string().trim().min(1), bullets: z.array(z.string().trim().min(1).regex(/^[^\r\n]+$/u, 'Keep each bullet on one line.')).optional()}),
  z.object({...featureFields, kind: z.literal('markdown'), body: z.string().trim().min(1)}),
  z.object({...featureFields, kind: z.literal('limits'), entries: z.array(limitEntrySchema).min(1, 'Add at least one limit entry.')}),
  z.object({...featureFields, kind: z.literal('shortcuts'), context: z.string().trim().min(1).optional(), entries: z.array(shortcutEntrySchema).min(1, 'Add at least one shortcut.')}),
  z.object({
    ...featureFields, kind: z.literal('compatibility'),
    rowKeys: z.array(z.string().trim().min(1)).min(1).refine((keys) => new Set(keys).size === keys.length, 'Choose each runtime row once.'),
    rows: compatibilityRowsSchema.optional().describe('Resolved public runtime requirements in rowKeys order; generated from the Tool, never authored separately.'),
  }),
  z.object({
    ...featureFields,
    kind: z.literal('benchmark'),
    metric: z.string().trim().min(1),
    value: z.string().trim().min(1),
    unit: z.string().trim().min(1),
    comparedTo: z.string().trim().min(1).optional(),
    methodologyUrl: toolFeatureCheckableSourceUrlSchema,
    claimant: z.enum(['vendor', 'independent']),
    environment: z.object({hardware: z.string().trim().min(1), version: z.string().trim().min(1), date: z.iso.date()}),
    sourceUrl: toolFeatureCheckableSourceUrlSchema,
  }),
] as const
const slashCommandArgumentSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  required: z.boolean().optional(),
})
const slashCommandFeature = z.object({
  ...featureFields,
  kind: z.literal('slash_command'),
  host: z.string().trim().min(1, 'Name the app where this command runs.'),
  placeholderNote: z.string().trim().min(1).optional(),
  args: z.array(slashCommandArgumentSchema).refine((args) => new Set(args.map(({name}) => name)).size === args.length, 'Use distinct argument names.').optional(),
  command: z.string().refine((value) => value.trim().length > 0, 'Add an in-app command.'),
  output: exampleOutput,
})
/** One-based inclusive ranges, matching Expressive Code's numeric marker syntax. */
export const toolFeatureHighlightLinesSchema = z.string().trim().regex(/^[1-9]\d*(?:\s*-\s*[1-9]\d*)?(?:\s*,\s*[1-9]\d*(?:\s*-\s*[1-9]\d*)?)*$/u, 'Use line numbers or ranges, such as 3-5,8.').refine((value) => value.split(',').every((part) => {
  const [start, end = start] = part.split('-').map(Number)
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end
}), 'Use ascending ranges of safe positive line numbers.')

export function isToolFeatureLineHighlighted(selection: string, line: number): boolean {
  return selection.split(',').some((part) => {
    const [start, end = start] = part.split('-').map(Number)
    return line >= start && line <= end
  })
}

const codeFeatureFields = z.object({
  ...featureFields,
  kind: z.literal('code'),
  highlightLines: toolFeatureHighlightLinesSchema.optional(),
  caption: z.string().trim().min(1).regex(/^[^\r\n]*$/u, 'Keep the code caption on one line.').optional(),
  mode: z.enum(['single', 'files', 'before_after', 'diff']).optional(),
  before: codeFileSchema.optional(),
  after: codeFileSchema.optional(),
  code: codeSource.optional(),
  language: z.enum(ARTICLE_CODE_LANGUAGES).optional(),
  filename: z.string().trim().min(1).optional(),
  files: z.array(codeFileSchema).min(1).refine((files) => new Set(files.map(({filename}) => filename)).size === files.length, 'Use a distinct filename for each file.').describe('Ordered example files. Filenames must be distinct within this array; enforce this semantic rule with toolFeatureDetailSchema or an equivalent property-uniqueness check, because Draft-7 cannot express it.').optional(),
  copyable: z.boolean().optional(),
  placeholderNote: z.string().trim().optional(),
  playgrounds,
})
const terminalFeatureFields = z.object({
  ...featureFields,
  kind: z.literal('terminal'),
  command: commandSource.optional(),
  shell: toolFeatureShellSchema.optional(),
  workingDirectory: z.string().trim().min(1).optional(),
  pairedWith: z.string().trim().min(1).optional(),
  output: exampleOutput,
  outputUnavailable: outputUnavailableSchema.optional(),
  variants: z.array(terminalVariantSchema).min(1).refine((variants) => new Set(variants.map(({label}) => label)).size === variants.length, 'Use a distinct label for each terminal variant.').describe('Ordered command variants. Labels must be distinct within this array; enforce this semantic rule with toolFeatureDetailSchema or an equivalent property-uniqueness check, because Draft-7 cannot express it.').optional(),
  copyable: z.boolean().optional(),
  placeholderNote: z.string().trim().optional(),
  playgrounds,
})
// Structural alternatives also supply the required fields in the public JSON contract.
const codeFeatureSources = z.union([
  codeFeatureFields.extend({mode: z.literal('single').optional(), files: z.array(codeFileSchema).max(0).optional()}).required({code: true, language: true}),
  codeFeatureFields.extend({mode: z.literal('files').optional()}).required({files: true}),
  codeFeatureFields.extend({mode: z.literal('before_after'), sourceUrl: toolFeatureCheckableSourceUrlSchema}).required({before: true, after: true}),
  codeFeatureFields.extend({mode: z.literal('diff'), sourceUrl: toolFeatureCheckableSourceUrlSchema,
    code: codeSource.regex(/(?:^|\n)[+-]/, 'Add at least one added (+) or removed (-) source line, not just file headers.')
      .refine((source) => classifyToolFeatureDiffLines(source).some(Boolean), 'Add at least one changed source line, excluding file headers.')
      .meta({not: {pattern: metadataOnlyDiffPattern.source}})
      .describe('Authored diff with at least one added or removed source line. Enforce hunk-aware header exclusion with toolFeatureDetailSchema; the JSON pattern checks line structure but cannot count hunk lines.'),
  }).required({code: true, language: true}),
]).refine((detail) => {
  const selection = detail.highlightLines
  if (!selection) return true
  const sources = detail.mode === 'before_after' ? [detail.before.code, detail.after.code] : detail.files?.length ? detail.files.map((file) => file.code) : [detail.code ?? '']
  return sources.every((source) => selection.split(',').every((part) => Number(part.split('-').at(-1)) <= source.split('\n').length))
}, {path: ['highlightLines'], message: 'Highlighted lines must exist in every example file. Adjust the selection or source.'})
const terminalFeatureSources = z.union([
  terminalFeatureFields.extend({variants: z.array(terminalVariantSchema).max(0).optional()}).required({command: true, shell: true}),
  terminalFeatureFields.required({variants: true}),
]).refine((detail) => !detail.outputUnavailable || !(detail.variants?.length ? detail.variants.some(({output}) => !!output) : detail.output), {
  path: ['outputUnavailable'],
  message: 'Remove the output-unavailable explanation when example output is supplied. It applies to every command variant.',
})
const otherFeatureContractSchemas = [...proseFeatureSchemas, permissionsFeatureSchema.extend({sourceUrl: toolFeatureCheckableSourceUrlSchema}).required({checkedAt: true}), referenceFeatureSchema.required({checkedAt: true}), slashCommandFeature, codeFeatureSources, terminalFeatureSources] as const
export const toolFeatureDetailContractSchema = z.union([...otherFeatureContractSchemas, publicCapabilityListFeatureSchema, publicInstallFeatureSchema])
/** Intake accepts authored inputs and strips derived fields before creating a Sanity draft. */
export const toolFeatureIntakeDetailSchema = z.union([
  ...otherFeatureContractSchemas,
  installFeatureSchema.omit({commands: true, checkedAt: true}).superRefine(validateToolInstall),
  capabilityListFeatureSchema.omit({count: true, checkedAt: true}).refine(toolCapabilityCountsMatch, 'Remove typed capability counts or match the number of entries.').refine((detail) => !detail.agentInterfaceKey || detail.listKind === 'mcp_tool', 'Only MCP tool lists can reference an MCP server row.'),
]).superRefine((detail, context) => {
  if (detail.kind !== 'limits') return
  detail.entries.forEach((entry, index) => {
    const validation = validateToolFeatureLimitValue(entry)
    if (validation !== true) context.addIssue({code: 'custom', path: ['entries', index, 'value'], message: validation})
  })
})

/** Reviewed commands must not silently discard unsupported properties on a feature.
 * Keep extraction tolerant; apply the existing intake policy after checking keys,
 * including its removal of caller-supplied derived counts, commands and dates.
 * Reviewed table rows also reject unsupported keys before the tolerant parser runs.
 */
export const toolFeatureReviewedIntakeDetailSchema = z.discriminatedUnion('kind', [
  permissionsFeatureSchema.extend({entries: z.array(permissionEntrySchema.strict()).min(1, 'Add at least one permission.')}).strict(),
  proseFeatureSchemas[0].strict(),
  proseFeatureSchemas[1].strict(),
  proseFeatureSchemas[2].extend({entries: z.array(limitEntrySchema.strict()).min(1, 'Add at least one limit entry.')}).strict(),
  proseFeatureSchemas[3].extend({entries: z.array(shortcutEntrySchema.strict()).min(1, 'Add at least one shortcut.')}).strict(),
  proseFeatureSchemas[4].strict(),
  proseFeatureSchemas[5].strict(),
  referenceFeatureSchema.extend({rows: referenceRowSchema.strict().array().min(1).max(MAX_TOOL_FEATURE_REFERENCE_ROWS, {error: (issue) => `reference_rows_exceeded: limit_rows=${MAX_TOOL_FEATURE_REFERENCE_ROWS}, actual_rows=${Array.isArray(issue.input) ? issue.input.length : 'unavailable'}. Keep representative rows and link to the full reference in the official docs URL.`})}).strict(),
  slashCommandFeature.extend({args: z.array(slashCommandArgumentSchema.strict()).optional()}).strict(),
  codeFeatureFields.extend({
    before: codeFileSchema.strict().optional(),
    after: codeFileSchema.strict().optional(),
    // The intake transform below retains the canonical array and mode validation.
    files: z.array(codeFileSchema.strict()).optional(),
  }).strict(),
  terminalFeatureFields.extend({
    variants: z.array(terminalVariantSchema.strict()).optional(),
    outputUnavailable: outputUnavailableSchema.strict().optional(),
  }).strict(),
  installFeatureSchema.strict(),
  capabilityListFeatureSchema.strict(),
]).transform((detail, context) => {
  const result = toolFeatureIntakeDetailSchema.safeParse(detail)
  if (result.success) return result.data
  for (const issue of result.error.issues) context.addIssue({...issue})
  return z.NEVER
})

/** Retain focused field errors while enforcing the same source alternatives as public JSON. */
const featureDetailSchema = z.discriminatedUnion('kind', [
  ...proseFeatureSchemas,
  validatedInstallFeatureSchema,
  capabilityListFeatureSchema.refine(toolCapabilityCountsMatch, 'Remove typed capability counts or match the number of entries.').refine((detail) => !detail.agentInterfaceKey || detail.listKind === 'mcp_tool', 'Only MCP tool lists can reference an MCP server row.'),
  permissionsFeatureSchema,
  referenceFeatureSchema,
  slashCommandFeature,
  codeFeatureFields.refine((detail) => codeFeatureSources.safeParse(detail).success, 'Complete the selected code mode: single code and language, files, or both before/after files. Comparisons and diffs need a canonical official source URL. Diffs also need at least one added (+) or removed (-) source line, excluding file headers.'),
  terminalFeatureFields.refine((detail) => terminalFeatureSources.safeParse(detail).success, 'Add a terminal command and shell, or at least one variant. Remove the output-unavailable explanation when any active command supplies example output.'),
])

/** Hidden single-example fields must not reject their authored replacements. */
export const toolFeatureDetailSchema = z.preprocess((value) => {
  const parsed = z.object({kind: z.string()}).catchall(z.json().optional()).safeParse(value)
  if (!parsed.success) return value
  let input = parsed.data
  const image = z.object({checkedAt: z.json().optional(), sourceUrl: z.json().optional()}).catchall(z.json()).safeParse(input.image)
  if (image.success && image.data.checkedAt && !image.data.sourceUrl) {
    const {checkedAt: _imageCheckedAt, ...withoutImageDate} = image.data
    input = {...input, image: withoutImageDate}
  }
  // Retain legacy content, but never publish an unsupported verification claim.
  if (input.checkedAt && !input.sourceUrl) {
    const {checkedAt: _checkedAt, ...withoutDate} = input
    input = withoutDate
  }
  if (input.kind === 'code' && input.mode === 'before_after') {
    const {files: _files, code: _code, language: _language, filename: _filename, ...comparison} = input
    return comparison
  }
  if (input.kind === 'code') {
    const {before: _before, after: _after, ...withoutComparison} = input
    input = withoutComparison
  }
  if (input.kind === 'code' && (input.mode === 'single' || input.mode === 'diff')) {
    const {files: _files, ...single} = input
    return single
  }
  if (input.kind === 'code' && input.files !== undefined) {
    if (Array.isArray(input.files) && input.files.length === 0) {
      const {files: _files, ...legacy} = input
      return legacy
    }
    const {code: _code, language: _language, filename: _filename, ...replacement} = input
    return replacement
  }
  if (input.kind === 'terminal' && input.variants !== undefined) {
    if (Array.isArray(input.variants) && input.variants.length === 0) {
      const {variants: _variants, ...legacy} = input
      return legacy
    }
    const {command: _command, shell: _shell, output: _output, ...replacement} = input
    return replacement
  }
  return input
}, featureDetailSchema)

export const toolFeaturePublicDetailSchema = toolFeatureDetailSchema.refine((detail) => toolFeatureDetailContractSchema.safeParse(detail).success, 'Complete the public feature contract, including official sourceUrl and checkedAt for references, permissions, installs and capability lists.')

export type ToolFeatureDetail = z.infer<typeof toolFeatureDetailSchema>
/** Reuse the measured catalog evidence window; see upstream docs/measurements/living-catalog-freshness-2026-09-22.md. */
export function isToolBenchmarkCurrent(detail: ToolFeatureDetail, nowMs: number): boolean {
  if (detail.kind !== 'benchmark') return true
  const measuredAt = Date.parse(detail.environment.date)
  return measuredAt <= nowMs && nowMs - measuredAt <= LIVING_CATALOG_CHECK_MAX_AGE_SECONDS * 1000
}
export type ToolDeveloperFeatureDetail = Extract<ToolFeatureDetail, {kind: 'code' | 'terminal' | 'slash_command'}>
export const TOOL_FEATURE_DETAIL_JSON_SCHEMA = z.json().parse(z.toJSONSchema(toolFeatureDetailContractSchema, {target: 'draft-7'}))

function resolveCompatibilityRows(detail: Extract<ToolFeatureDetail, {kind: 'compatibility'}>, context: ToolFeatureContext) {
  const rows = detail.rowKeys.flatMap((key) => {
    const matches = (context.runtimeRequirements ?? []).filter((row) => row._key === key)
    return matches.length === 1 ? normalizePublicRuntimeRequirements(matches, [...context.sourceReferences ?? []]) : []
  })
  const parsed = compatibilityRowsSchema.safeParse(rows)
  return parsed.success ? parsed.data : []
}

export function normalizeToolFeatureDetails(
  value: JsonValue,
  keyFeatures: readonly string[],
  context?: ToolFeatureContext,
): ToolFeatureDetail[] {
  if (!Array.isArray(value)) return []
  const candidates = value.flatMap<ToolFeatureDetail>((item) => {
    const parsed = toolFeatureDetailSchema.safeParse(item)
    if (!parsed.success) return []
    const detail = parsed.data
    if ((detail.kind === 'install' || detail.kind === 'capability_list') && !hasVerifiedFeatureEvidence(detail)) return []
    if (detail.kind === 'capability_list') {
      if (!hasCapabilityInterface(detail, context)) return []
      const {agentInterfaceKey: _agentInterfaceKey, ...publicDetail} = detail
      return [{...publicDetail, count: detail.items.length}]
    }
    if (detail.kind === 'install') return [{...detail, commands: getToolInstallCommands(detail)}]
    // Owner proposals and Studio drafts can await editorial verification; public references cannot.
    if ((detail.kind === 'reference' || detail.kind === 'permissions') && !toolFeatureDetailContractSchema.safeParse(detail).success) return []
    if (detail.kind === 'compatibility' && context) {
      const rows = resolveCompatibilityRows(detail, context)
      return rows.length === detail.rowKeys.length ? [{...detail, rows}] : []
    }
    // Retain the primary example fields for clients that predate files and variants.
    if (detail.kind === 'code' && detail.files?.[0]) return [{...detail, ...detail.files[0]}]
    if (detail.kind === 'terminal' && detail.variants?.[0]) {
      const {command, shell, output} = detail.variants[0]
      const {output: _legacyOutput, ...shared} = detail
      if (output) return [{...shared, command, shell, output}]
      return [{...shared, command, shell}]
    }
    return [detail]
  })
  const details = keyFeatures.flatMap((feature) => {
    const matches = candidates.filter((item) => item.feature === feature)
    if (feature === keyFeatures[0] && matches.some((item) => item.kind === 'benchmark')) return []
    return matches.length === 1 ? matches : []
  })
  return details.map((detail) => {
    if (detail.kind !== 'terminal' || !detail.pairedWith || details.some((target) => target.kind === 'code' && target.feature === detail.pairedWith)) return detail
    // Preserve the command while omitting a stale relationship from public artifacts.
    const {pairedWith: _pairedWith, ...unpaired} = detail
    return unpaired
  })
}

export function validateToolFeatureDetails(value: JsonValue, keyFeatures: readonly string[], options?: ToolFeatureContext & {allowUnverifiedEvidence?: boolean}): true | string {
  if (value == null) return true
  const parsed = z.array(toolFeatureDetailSchema).safeParse(value)
  if (!parsed.success) return `Complete each feature preview: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`
  const seen = new Set<string>()
  for (const detail of parsed.data) {
    if ((detail.kind === 'install' || detail.kind === 'capability_list') && !hasVerifiedFeatureEvidence(detail) && !options?.allowUnverifiedEvidence) return `“${detail.feature}” needs a checkable official sourceUrl and a checkedAt date that is not in the future. Verify every manager command or capability claim at that source before publication.`
    if (detail.kind === 'capability_list' && options && !hasCapabilityInterface(detail, options) && !options.allowUnverifiedEvidence) return `“${detail.feature}” references missing, duplicate or non-MCP interface row “${detail.agentInterfaceKey}”. Select one existing mcp_server row on this Tool or remove the association.`
    if ((detail.kind === 'reference' || detail.kind === 'permissions') && !toolFeatureDetailContractSchema.safeParse(detail).success && !options?.allowUnverifiedEvidence) return `“${detail.feature}” needs a checkable official sourceUrl and checkedAt date. Review the official reference and record the feature checked date before publication.`
    if (detail.kind === 'compatibility' && options && !options.allowUnverifiedEvidence && resolveCompatibilityRows(detail, options).length !== detail.rowKeys.length) {
      return `“${detail.feature}” references missing or unverified runtime rows (${detail.rowKeys.join(', ')}). Select existing row keys with valid public evidence, or record their status as unknown.`
    }
    if (detail.kind === 'benchmark' && detail.feature === keyFeatures[0]) return `“${detail.feature}” is a benchmark. Put a capability or workflow first.`
    if (!keyFeatures.includes(detail.feature)) return `“${detail.feature}” is not in Key features. Copy its exact feature text or remove this preview.`
    if (seen.has(detail.feature)) return `“${detail.feature}” has more than one preview. Keep one preview per feature.`
    seen.add(detail.feature)
  }
  for (const detail of parsed.data) {
    if (detail.kind === 'limits') {
      for (const entry of detail.entries) {
        const validation = validateToolFeatureLimitValue(entry)
        if (validation !== true) return `“${detail.feature}”: ${validation}`
      }
    }
    if (detail.kind === 'limits' && detail.entries.some((entry) => entry.sourceUrl) && !toolFeatureCheckableSourceUrlSchema.safeParse(detail.sourceUrl).success) {
      return `“${detail.feature}” needs a checkable parent official source URL supporting its sourced limits. Add the canonical public HTTPS documentation page without query parameters so scheduled checks can review it.`
    }
    if (detail.kind === 'terminal' && detail.pairedWith && !parsed.data.some((target) => target.kind === 'code' && target.feature === detail.pairedWith)) {
      return `“${detail.feature}” must pair with a code feature on this Tool. Choose its exact feature text or remove the pairing “${detail.pairedWith}”.`
    }
  }
  return true
}

/** Conservative authoring hints, not a parser: avoid treating markup and generic types as placeholders. */
export function toolFeatureNeedsPlaceholderNote(detail: ToolFeatureDetail): boolean {
  if (detail.kind !== 'code' && detail.kind !== 'terminal' && detail.kind !== 'slash_command') return false
  if (detail.placeholderNote?.trim()) return false
  return getToolFeatureExamples(detail).some((example) => {
    const source = getToolFeatureSource(example)
    if (/\bYOUR[-_][A-Z0-9]+(?:[-_][A-Z0-9]+)*\b/.test(source) || /\bx{3,}\b/i.test(source)) return true
    if (example.kind === 'code' && ['html', 'jsx', 'tsx'].includes(getToolFeatureLanguage(example))) return false
    return /<(?:[A-Z][A-Z0-9_]{1,}|[a-zA-Z][a-zA-Z0-9]*(?:[-_][a-zA-Z0-9]+)+|url|token|path|key)>/.test(source)
  })
}
