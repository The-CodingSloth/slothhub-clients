import {isValidCatalogTimestamp} from './catalogFreshnessSearch.js'
import {containsUnsafePublicTextCharacters} from './publicText.js'
import {
  normalizePublicSourceReferences,
  type PublicSourceReference,
  type SourceReferenceInput,
} from './sourceReference.js'

export const TOOL_STACK_RECIPE_STEP_KINDS = [
  'setup',
  'command',
  'prompt',
  'verification',
] as const

export type ToolStackRecipeStepKind = (typeof TOOL_STACK_RECIPE_STEP_KINDS)[number]

export interface ToolStackRecipeGuidanceInput {
  label?: string
  description?: string
  sourceReferences?: SourceReferenceInput[] | null
}

export interface ToolStackRecipeStepInput<RelatedToolInput> {
  _key?: string
  kind?: string
  title?: string
  instruction?: string
  example?: string
  language?: string
  expectedOutput?: string
  relatedTool?: RelatedToolInput | null
  sourceReferences?: SourceReferenceInput[] | null
}

export interface ToolStackRecipeInput<RelatedToolInput> {
  title?: string
  summary?: string
  reviewedAt?: string
  prerequisites?: ToolStackRecipeGuidanceInput[] | null
  limitations?: ToolStackRecipeGuidanceInput[] | null
  steps?: Array<ToolStackRecipeStepInput<RelatedToolInput> | null> | null
  sourceReferences?: SourceReferenceInput[] | null
}

export interface PublicToolStackRecipeGuidance {
  label: string
  description?: string
  sourceReferences?: PublicSourceReference[]
}

export interface PublicToolStackRecipeStep<RelatedTool> {
  kind: ToolStackRecipeStepKind
  title: string
  instruction: string
  example?: string
  language?: string
  expectedOutput?: string
  relatedTool?: RelatedTool
  sourceReferences?: PublicSourceReference[]
}

export interface PublicToolStackRecipe<RelatedTool> {
  executionMode: 'guidance_only'
  title: string
  summary?: string
  reviewedAt: string
  prerequisites: PublicToolStackRecipeGuidance[]
  limitations: PublicToolStackRecipeGuidance[]
  steps: Array<PublicToolStackRecipeStep<RelatedTool>>
  sourceReferences: PublicSourceReference[]
}

const RECIPE_STEP_KIND_SET = new Set<string>(TOOL_STACK_RECIPE_STEP_KINDS)
const UNSAFE_EXAMPLE_TEXT_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u

const normalizeText = (value: string | undefined): string | undefined => {
  if (!value) return undefined
  const normalized = value.replace(/[ \t\r\n]+/gu, ' ').trim()
  if (containsUnsafePublicTextCharacters(normalized)) return undefined
  return normalized || undefined
}

export const isSafePublicToolStackRecipeProse = (value: string): boolean =>
  Boolean(normalizeText(value))

const normalizeExample = (value: string | undefined): string | undefined => {
  if (!value || UNSAFE_EXAMPLE_TEXT_PATTERN.test(value)) return undefined
  const normalized = value
    .replace(/\r\n?/gu, '\n')
    .replace(/\t/gu, '  ')
    .split('\n')
    .map((line) => line.replace(/[ ]+$/gu, ''))
    .join('\n')
    .trim()
  return normalized || undefined
}

export const isSafePublicToolStackRecipeExample = (value: string): boolean =>
  normalizeExample(value) === value

const isRecipeStepKind = (value: string | undefined): value is ToolStackRecipeStepKind =>
  Boolean(value && RECIPE_STEP_KIND_SET.has(value))

const normalizeGuidance = (
  entries: ToolStackRecipeGuidanceInput[] | null | undefined,
): PublicToolStackRecipeGuidance[] =>
  (entries ?? []).flatMap((entry) => {
    const label = normalizeText(entry.label)
    if (!label) return []
    const description = normalizeText(entry.description)
    const sourceReferences = normalizePublicSourceReferences(entry.sourceReferences)

    return [{
      label,
      ...(description ? {description} : undefined),
      ...(sourceReferences.length > 0 ? {sourceReferences} : undefined),
    }]
  })

export const normalizePublicToolStackRecipe = <RelatedToolInput, RelatedTool>(
  input: ToolStackRecipeInput<RelatedToolInput> | null | undefined,
  normalizeRelatedTool: (tool: RelatedToolInput) => RelatedTool | undefined,
): PublicToolStackRecipe<RelatedTool> | undefined => {
  if (!input) return undefined

  const title = normalizeText(input.title)
  const summary = normalizeText(input.summary)
  const reviewedAt = isValidCatalogTimestamp(input.reviewedAt) ? input.reviewedAt : undefined
  if (!title || !reviewedAt) return undefined

  const publicSteps: Array<PublicToolStackRecipeStep<RelatedTool>> = []
  for (const step of input.steps ?? []) {
    if (!step || !isRecipeStepKind(step.kind)) return undefined
    const stepTitle = normalizeText(step.title)
    const instruction = normalizeText(step.instruction)
    const acceptsExample = step.kind === 'command' || step.kind === 'prompt'
    const example = acceptsExample ? normalizeExample(step.example) : undefined
    if (!stepTitle || !instruction) return undefined
    if (acceptsExample && !example) return undefined

    const language = step.kind === 'command' ? normalizeText(step.language) : undefined
    const expectedOutput = normalizeText(step.expectedOutput)
    const relatedTool = step.relatedTool
      ? normalizeRelatedTool(step.relatedTool)
      : undefined
    const sourceReferences = normalizePublicSourceReferences(step.sourceReferences)

    publicSteps.push({
      kind: step.kind,
      title: stepTitle,
      instruction,
      ...(example ? {example} : undefined),
      ...(language ? {language} : undefined),
      ...(expectedOutput ? {expectedOutput} : undefined),
      ...(relatedTool ? {relatedTool} : undefined),
      ...(sourceReferences.length > 0 ? {sourceReferences} : undefined),
    })
  }
  if (publicSteps.length === 0) return undefined
  if (!publicSteps.some((step) => step.kind === 'verification')) return undefined

  const inputPrerequisites = input.prerequisites ?? []
  const inputLimitations = input.limitations ?? []
  const prerequisites = normalizeGuidance(input.prerequisites)
  const limitations = normalizeGuidance(input.limitations)
  const sourceReferences = normalizePublicSourceReferences(input.sourceReferences)
  if (
    prerequisites.length === 0 ||
    limitations.length === 0 ||
    prerequisites.length !== inputPrerequisites.length ||
    limitations.length !== inputLimitations.length
  ) return undefined
  if (sourceReferences.length === 0) return undefined

  return {
    executionMode: 'guidance_only',
    title,
    ...(summary ? {summary} : undefined),
    reviewedAt,
    sourceReferences,
    prerequisites,
    limitations,
    steps: publicSteps,
  }
}
