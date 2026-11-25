import type {JsonValue} from './jsonValue.js'
import {MAX_PUBLIC_METADATA_LABEL_LENGTH} from './publicMetadata.js'
import {containsUnsafePublicTextCharacters} from './publicText.js'
import type {SourceReferenceInput} from './sourceReference.js'
import {normalizePublicToolFitGuidance, type PublicToolFitGuidance, type ToolFitGuidanceInput} from './toolFitGuidance.js'
import {isRuntimeString} from './runtimeValidation.js'
import {normalizeToolFeatureDetails, isToolBenchmarkCurrent, type ToolFeatureDetail, type ToolFeatureContext} from './toolFeatureDetails.js'

export const MAX_TOOL_DECISION_KEY_FEATURES = 10
export const MAX_TOOL_DECISION_WORKFLOW_SLUG_LENGTH = 96
export const MAX_TOOL_DECISION_WORKFLOW_DESCRIPTION_LENGTH = 200

const PUBLIC_WORKFLOW_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

export interface ToolDecisionUseCaseSource {
  name?: JsonValue
  slug?: JsonValue
  description?: JsonValue
}

export interface ToolDecisionSupportSource extends ToolFeatureContext {
  keyFeatures?: readonly JsonValue[] | null
  keyFeatureDetails?: JsonValue
  useCases?: ReadonlyArray<ToolDecisionUseCaseSource | null> | null
  fitGuidance?: ToolFitGuidanceInput | null
  sourceReferences?: readonly SourceReferenceInput[] | null
  lastUpdated?: JsonValue
}

export interface PublishedToolDecisionWorkflow {
  name: string
  slug: string
  description: string
}

export interface PublishedToolDecisionSupport {
  keyFeatures: string[]
  keyFeatureDetails?: ToolFeatureDetail[]
  workflows: PublishedToolDecisionWorkflow[]
  fitGuidance: PublicToolFitGuidance | null
}

const normalizeBoundedPublicText = (value: JsonValue, maxLength: number): string | undefined => {
  if (!isRuntimeString(value) || containsUnsafePublicTextCharacters(value)) return undefined

  const normalized = value.replace(/\s+/gu, ' ').trim()
  return normalized && normalized.length <= maxLength ? normalized : undefined
}

const normalizeKeyFeatures = (values: readonly JsonValue[] | null | undefined): string[] => {
  if (!Array.isArray(values) || values.length > MAX_TOOL_DECISION_KEY_FEATURES) return []

  const seen = new Set<string>()
  const keyFeatures: string[] = []
  for (const value of values) {
    const keyFeature = normalizeBoundedPublicText(value, MAX_PUBLIC_METADATA_LABEL_LENGTH)
    const identity = keyFeature?.toLocaleLowerCase('en-US')
    if (!keyFeature || !identity || seen.has(identity)) continue

    seen.add(identity)
    keyFeatures.push(keyFeature)
  }
  return keyFeatures
}

const normalizeWorkflowSlug = (value: JsonValue): string | undefined =>
  isRuntimeString(value) &&
  value.length <= MAX_TOOL_DECISION_WORKFLOW_SLUG_LENGTH &&
  PUBLIC_WORKFLOW_SLUG_PATTERN.test(value)
    ? value
    : undefined

const sameWorkflow = (
  first: PublishedToolDecisionWorkflow,
  second: PublishedToolDecisionWorkflow,
): boolean => first.name === second.name && first.description === second.description

const normalizeWorkflows = (
  values: ReadonlyArray<ToolDecisionUseCaseSource | null> | null | undefined,
): PublishedToolDecisionWorkflow[] => {
  if (!Array.isArray(values)) return []

  const bySlug = new Map<string, PublishedToolDecisionWorkflow>()
  const conflicts = new Set<string>()
  for (const value of values) {
    if (!value) continue
    const workflow: PublishedToolDecisionWorkflow | null = (() => {
      const name = normalizeBoundedPublicText(value.name, MAX_PUBLIC_METADATA_LABEL_LENGTH)
      const slug = normalizeWorkflowSlug(value.slug)
      const description = normalizeBoundedPublicText(
        value.description,
        MAX_TOOL_DECISION_WORKFLOW_DESCRIPTION_LENGTH,
      )
      return name && slug && description ? {name, slug, description} : null
    })()
    if (!workflow || conflicts.has(workflow.slug)) continue

    const existing = bySlug.get(workflow.slug)
    if (!existing) {
      bySlug.set(workflow.slug, workflow)
    } else if (!sameWorkflow(existing, workflow)) {
      bySlug.delete(workflow.slug)
      conflicts.add(workflow.slug)
    }
  }
  return [...bySlug.values()]
}

interface NormalizedToolDecisionContent {
  keyFeatures: string[]
  keyFeatureDetails?: ToolFeatureDetail[]
  workflows: PublishedToolDecisionWorkflow[]
  fitGuidance: PublicToolFitGuidance | null
}

const normalizeToolDecisionContent = (
  source: ToolDecisionSupportSource,
  now: Date,
): NormalizedToolDecisionContent => {
  const authoredFeatures = normalizeKeyFeatures(source.keyFeatures)
  const details = normalizeToolFeatureDetails(source.keyFeatureDetails, authoredFeatures, source)
  const hidden = new Set(details.filter((detail) => !isToolBenchmarkCurrent(detail, now.getTime())).map(({feature}) => feature))
  const keyFeatures = authoredFeatures.filter((feature) => !hidden.has(feature))
  const keyFeatureDetails = details.filter(({feature}) => !hidden.has(feature))
  return {
    keyFeatures,
    ...(keyFeatureDetails.length ? {keyFeatureDetails} : undefined),
    workflows: normalizeWorkflows(source.useCases),
    fitGuidance: normalizePublicToolFitGuidance(source.fitGuidance, now) ?? null,
  }
}

export const buildPublishedToolDecisionSupport = (
  source: ToolDecisionSupportSource,
  now: Date = new Date(),
): PublishedToolDecisionSupport => normalizeToolDecisionContent(source, now)
