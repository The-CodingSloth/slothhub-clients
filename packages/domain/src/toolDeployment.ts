import {z} from 'zod'
import {SOURCE_AVAILABILITY_FILTER_LABELS, SOURCE_AVAILABILITY_FILTER_VALUES} from './sourceAvailabilityFilter.js'
import type {JsonValue} from './jsonValue.js'
import {getPublicHttpUrl} from './urlSafety.js'
import {escapeMarkdownText, toMarkdownInlineCode} from './markdownSafety.js'
import {containsUnsafePublicTextCharacters} from './publicText.js'

export const TOOL_DEPLOYMENT_MODELS = ['hosted', 'self_hosted', 'local_application'] as const
export const TOOL_SOURCE_AVAILABILITY = SOURCE_AVAILABILITY_FILTER_VALUES
export const LIBRARY_DEPLOYMENT_GUIDANCE = 'Libraries, packages, guides and websites leave deployment models empty. Libraries run inside a consuming application; guides describe other software. Record reviewed source availability separately.'

export const validateLibraryDeploymentModels = (resourceKind: string | number | undefined, models: readonly string[] | null | undefined): true | string =>
  (resourceKind === 'library_or_package' || resourceKind === 'guide_or_website') && !!models?.length ? LIBRARY_DEPLOYMENT_GUIDANCE : true
export const TOOL_DEPLOYMENT_LABELS = {
  hosted: 'Provider hosted', self_hosted: 'Self-hosted', local_application: 'Local application',
} satisfies Record<typeof TOOL_DEPLOYMENT_MODELS[number], string>
export const TOOL_SOURCE_LABELS = SOURCE_AVAILABILITY_FILTER_LABELS

const evidenceUrl = z.string().refine((value) => value.startsWith('https://') && !containsUnsafePublicTextCharacters(value)
  && getPublicHttpUrl(value) === value && new URL(value).href === value,
  'Use a canonical public HTTPS source without credentials, control characters or a private-network destination.')

const deploymentFields = {
  scope: z.string().trim().min(1).refine((value) => !containsUnsafePublicTextCharacters(value), 'Remove control characters from the edition scope.'),
  models: z.array(z.enum(TOOL_DEPLOYMENT_MODELS)).optional(),
  sourceAvailability: z.enum(TOOL_SOURCE_AVAILABILITY).optional(),
  repositoryUrl: evidenceUrl.optional(),
  sourceUrl: evidenceUrl,
  checkedAt: z.iso.datetime(),
}
export const toolDeploymentSchema = z.object(deploymentFields)
  .refine((value) => Boolean(value.models?.length || value.sourceAvailability), 'Record at least one deployment or source-availability fact.')
  .refine((value) => !value.models || new Set(value.models).size === value.models.length, 'Select each deployment model once.')
  .refine((value) => !['open_source', 'source_available'].includes(value.sourceAvailability ?? '') || Boolean(value.repositoryUrl),
    'Open-source and source-available claims require an official source repository URL.')

export type ToolDeployment = z.infer<typeof toolDeploymentSchema>
export const TOOL_DEPLOYMENT_JSON_SCHEMA = z.json().parse(z.toJSONSchema(toolDeploymentSchema, {target: 'draft-7'}))

// Sanity projections represent absent optional fields as null. Keep those
// transforms at authoring/read boundaries: MCP converts the public schema to
// JSON Schema in output mode, which cannot represent transformations.
export const toolDeploymentAuthoringSchema = z.object({
  ...deploymentFields,
  models: deploymentFields.models.nullish().transform((value) => value ?? undefined).optional(),
  sourceAvailability: deploymentFields.sourceAvailability.nullish().transform((value) => value ?? undefined).optional(),
  repositoryUrl: deploymentFields.repositoryUrl.nullish().transform((value) => value ?? undefined).optional(),
}).pipe(toolDeploymentSchema)

export const normalizeToolDeployment = (value: JsonValue, now = new Date()): ToolDeployment | undefined => {
  const parsed = toolDeploymentAuthoringSchema.safeParse(value)
  return parsed.success && Date.parse(parsed.data.checkedAt) <= now.getTime() ? parsed.data : undefined
}

export const renderToolDeploymentMarkdown = (facts: ToolDeployment): string => [
  '## Deployment and source availability',
  `Applies to: ${escapeMarkdownText(facts.scope)}.`,
  facts.models?.length ? `Deployment: ${facts.models.map((model) => TOOL_DEPLOYMENT_LABELS[model]).join(', ')}.` : 'Deployment: not recorded.',
  `Source availability: ${facts.sourceAvailability ? TOOL_SOURCE_LABELS[facts.sourceAvailability] : 'not recorded'}.`,
  'Local application does not imply offline operation. Source access does not imply a right to self-host or equivalent hosted features.',
  `Checked ${escapeMarkdownText(facts.checkedAt)}; evidence: ${toMarkdownInlineCode(facts.sourceUrl)}.`,
  facts.repositoryUrl ? `Official source: ${toMarkdownInlineCode(facts.repositoryUrl)}.` : '',
].filter(Boolean).join('\n\n')
