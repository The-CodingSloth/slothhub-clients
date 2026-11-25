import {hasRuntimeObjectType, isRuntimeString} from './runtimeValidation.js'
import type {JsonValue} from './jsonValue.js'
import {
  AGENT_INTERFACE_KIND_VALUES,
  type AgentInterfaceKind,
  type AgentInterfaceStatus,
} from './agentInterface.js'
import {canonicalJson} from './canonicalJson.js'
import {
  isPositiveIntegrationStatus,
  type IntegrationStatus,
} from './integrationStatus.js'
import {
  normalizePublicToolIntegrationFacts,
  type PublicToolIntegrationFactInput,
} from './publicToolIntegrationFact.js'
import {sha256Hex} from './sha256.js'
import {validatePublicHttpUrl} from './urlSafety.js'

export const TOOL_ASSEMBLY_VERSION = 1
export const TOOL_ASSEMBLY_MIN_TOOLS = 2
export const TOOL_ASSEMBLY_MAX_TOOLS = 5
export const TOOL_ASSEMBLY_PLATFORM_VALUES = [
  'web',
  'desktop',
  'mobile',
  'extension',
  'cli',
] as const

export type ToolAssemblyPlatform = (typeof TOOL_ASSEMBLY_PLATFORM_VALUES)[number]
export type ToolAssemblyAxis = 'integration' | 'platform' | 'agent_interface'
export type ToolAssemblyFactState =
  | 'confirmed'
  | 'conflict'
  | 'unknown'
  | 'not_evaluated'

export interface ToolAssemblyFactSource {
  kind: 'tool_detail_feed' | 'inline_requirement' | 'checker'
  toolSlug?: string
  checkedAt?: string
  url?: string
}

export type ToolAssemblyIntegrationInput = PublicToolIntegrationFactInput

export interface ToolAssemblyAgentInterfaceInput {
  kind?: string | null
  status?: string | null
  checkedAt?: string | null
  docsUrl?: string | null
}

export interface ToolAssemblyToolInput {
  slug?: string | null
  name?: string | null
  detailUrl?: string | null
  platforms?: readonly string[] | null
  integrations?: readonly PublicToolIntegrationFactInput[] | null
  agentInterfaces?: readonly ToolAssemblyAgentInterfaceInput[] | null
  /** Taxonomy and prose are accepted only so callers cannot accidentally infer from them. */
  categories?: readonly string[] | null
  tags?: readonly string[] | null
  useCases?: readonly string[] | null
  description?: string | null
  keyFeatures?: readonly string[] | null
  stackSlugs?: readonly string[] | null
}

export interface ToolAssemblyRequirementsInput {
  integrations?: readonly string[] | null
  platforms?: readonly string[] | null
  agentInterfaceKinds?: readonly string[] | null
}

export type ToolAssemblyRequirementsValidation =
  | {ok: true; value: NormalizedToolAssemblyRequirements}
  | {ok: false; errors: string[]}

export interface ToolAssemblyInput {
  selectedSlugs: readonly string[]
  tools?: readonly ToolAssemblyToolInput[]
  requirements?: ToolAssemblyRequirementsInput
}

interface NormalizedToolAssemblyIntegration {
  slug: string
  name: string
  status: IntegrationStatus
  source: ToolAssemblyFactSource
}

interface NormalizedToolAssemblyAgentInterface {
  kind: AgentInterfaceKind
  status: AgentInterfaceStatus
  source: ToolAssemblyFactSource
}

interface NormalizedToolAssemblyTool {
  slug: string
  name: string
  detailUrl?: string
  platforms: ToolAssemblyPlatform[]
  integrations: NormalizedToolAssemblyIntegration[]
  agentInterfaces: NormalizedToolAssemblyAgentInterface[]
}

interface NormalizedToolAssemblyRequirements {
  integrations: string[]
  platforms: ToolAssemblyPlatform[]
  agentInterfaceKinds: AgentInterfaceKind[]
}

interface NormalizedToolAssemblyInput {
  selectedSlugs: string[]
  tools: NormalizedToolAssemblyTool[]
  unresolvedSlugs: string[]
  requirements: NormalizedToolAssemblyRequirements
}

export interface ToolAssemblyFact {
  toolSlug: string
  state: Exclude<ToolAssemblyFactState, 'not_evaluated'>
  status?: string
  source: ToolAssemblyFactSource
}

export interface ToolAssemblyFinding {
  axis: ToolAssemblyAxis
  key: string
  label: string
  state: Exclude<ToolAssemblyFactState, 'not_evaluated'>
  reason: string
  facts: ToolAssemblyFact[]
  source: ToolAssemblyFactSource
}

export interface ToolAssemblyUnresolvedTool {
  slug: string
  state: 'unknown'
  reason: string
  source: ToolAssemblyFactSource
}

export interface ToolAssemblyNotEvaluatedAxis {
  axis: 'runtime_os' | 'deployment_source' | 'resource_relationships'
  state: 'not_evaluated'
  reason: string
  source: ToolAssemblyFactSource
}

export interface ToolAssemblyReport {
  schemaVersion: 1
  identity: string
  selectedTools: Array<{slug: string; name: string}>
  requirements: NormalizedToolAssemblyRequirements
  confirmedOverlap: ToolAssemblyFinding[]
  explicitConflicts: ToolAssemblyFinding[]
  missingEvidence: ToolAssemblyFinding[]
  unresolvedTools: ToolAssemblyUnresolvedTool[]
  notEvaluatedAxes: ToolAssemblyNotEvaluatedAxis[]
  disclaimer: string
}

const compareCodePoints = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

const normalizeText = (value: JsonValue, maxLength = 160): string | undefined => {
  if (!isRuntimeString(value)) return undefined
  const normalized = value
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ')
  return normalized ? normalized.slice(0, maxLength) : undefined
}

const normalizeSlug = (value: JsonValue): string | undefined => {
  const normalized = normalizeText(value, 120)?.toLowerCase()
  return normalized && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(normalized)
    ? normalized
    : undefined
}

const normalizeUrl = (value: JsonValue): string | undefined => {
  const text = normalizeText(value, 500)
  if (!text) return undefined
  try {
    const validation = validatePublicHttpUrl(text)
    return validation.success && validation.url
      ? new URL(validation.url).href
      : undefined
  } catch {
    return undefined
  }
}

const normalizeTimestamp = (value: JsonValue): string | undefined => {
  const text = normalizeText(value, 40)
  if (!text || !Number.isFinite(Date.parse(text))) return undefined
  return new Date(text).toISOString()
}

const normalizeUniqueStrings = <T extends string>(
  value: readonly string[] | null | undefined,
  allowed?: readonly T[],
): T[] => {
  if (!Array.isArray(value)) return []
  const allowedSet = allowed ? new Set<string>(allowed) : undefined
  const unique = new Set<T>()
  for (const item of value) {
    const normalized = normalizeText(item, 120)?.toLowerCase()
    if (!normalized || (allowedSet && !allowedSet.has(normalized))) continue
    // SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
    unique.add(normalized as T)
  }
  return [...unique].sort(compareCodePoints)
}

const normalizeSlugArray = (value: readonly string[]): string[] => {
  if (!Array.isArray(value)) return []
  const unique = new Set<string>()
  for (const item of value) {
    const slug = normalizeSlug(item)
    if (slug) unique.add(slug)
  }
  return [...unique].sort(compareCodePoints)
}

const validateRequirementArray = <T extends string>(
  value: readonly string[] | null | undefined,
  label: string,
  normalize: (candidate: string) => T | undefined,
  errors: string[],
): T[] => {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    errors.push(`${label} requirements must be an array.`)
    return []
  }
  const unique = new Set<T>()
  for (const candidate of value) {
    const normalized = normalize(candidate)
    if (!normalized) {
      let displayed: string
      try {
        displayed = JSON.stringify(candidate) ?? String(candidate)
      } catch {
        displayed = String(candidate)
      }
      errors.push(`Invalid ${label} requirement ${displayed}.`)
      continue
    }
    unique.add(normalized)
  }
  return [...unique].sort(compareCodePoints)
}

export const parseToolAssemblyRequirements = (
  value: ToolAssemblyRequirementsInput | undefined,
): ToolAssemblyRequirementsValidation => {
  const errors: string[] = []
  const integrations = validateRequirementArray(
    value?.integrations,
    'Integration',
    normalizeSlug,
    errors,
  )
  const platforms = validateRequirementArray<ToolAssemblyPlatform>(
    value?.platforms,
    'platform',
    (candidate) => {
      const normalized = normalizeText(candidate, 120)?.toLowerCase()
      // SAFETY: The source is a closed or validated string collection; widening only enables collection operations.
      return normalized &&
        (TOOL_ASSEMBLY_PLATFORM_VALUES as readonly string[]).includes(normalized)
        ? (normalized as ToolAssemblyPlatform)
        : undefined
    },
    errors,
  )
  const agentInterfaceKinds = validateRequirementArray<AgentInterfaceKind>(
    value?.agentInterfaceKinds,
    'Agent Interface',
    (candidate) => {
      const normalized = normalizeText(candidate, 120)?.toLowerCase()
      // SAFETY: The source is a closed or validated string collection; widening only enables collection operations.
      return normalized &&
        (AGENT_INTERFACE_KIND_VALUES as readonly string[]).includes(normalized)
        ? (normalized as AgentInterfaceKind)
        : undefined
    },
    errors,
  )
  return errors.length > 0
    ? {ok: false, errors}
    : {ok: true, value: {integrations, platforms, agentInterfaceKinds}}
}

const normalizeIntegrations = (
  value: readonly PublicToolIntegrationFactInput[] | null | undefined,
  toolSlug: string,
): NormalizedToolAssemblyIntegration[] => {
  return normalizePublicToolIntegrationFacts(value).map((input) => ({
    slug: input.slug,
    name: input.name,
    status: input.status,
    source: {
      // SAFETY: The owner parser or adjacent runtime guard establishes each asserted property contract.
      kind: 'tool_detail_feed' as const, toolSlug,
      ...(input.checkedAt ? { checkedAt: input.checkedAt } : undefined),
      ...(input.sourceUrl ? { url: input.sourceUrl } : undefined)
    },
  }))
}

// SAFETY: The source is a closed or validated string collection; widening only enables collection operations.
const normalizeAgentInterfaces = (
  value: readonly ToolAssemblyAgentInterfaceInput[] | null | undefined,
  toolSlug: string,
): NormalizedToolAssemblyAgentInterface[] => {
  if (!Array.isArray(value)) return []
  const byKind = new Map<AgentInterfaceKind, NormalizedToolAssemblyAgentInterface>()
  for (const candidate of value) {
    if (!candidate || !hasRuntimeObjectType(candidate)) continue
    // SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
    const input = candidate as ToolAssemblyAgentInterfaceInput
    const kind = normalizeText(input.kind, 40)?.toLowerCase()
    const status = normalizeText(input.status, 40)?.toLowerCase()
    if (
      !kind ||
      !(AGENT_INTERFACE_KIND_VALUES as readonly string[]).includes(kind) ||
      !status ||
      !['official', 'community', 'deprecated', 'unknown'].includes(status)
    ) continue
    const checkedAt = normalizeTimestamp(input.checkedAt)
    const docsUrl = normalizeUrl(input.docsUrl)
    // SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
    const next: NormalizedToolAssemblyAgentInterface = {
      kind: kind as AgentInterfaceKind,
      status: status as AgentInterfaceStatus,
      source: {
        // SAFETY: The owner parser or adjacent runtime guard establishes each asserted property contract.
        kind: 'tool_detail_feed' as const, toolSlug,
        ...(checkedAt ? { checkedAt } : undefined),
        ...(docsUrl ? { url: docsUrl } : undefined)
      },
    }
    const current = byKind.get(next.kind)
    const precedence = {
      official: 4,
      community: 3,
      deprecated: 2,
      unknown: 1,
    } satisfies Record<AgentInterfaceStatus, number>
    if (
      !current ||
      precedence[next.status] > precedence[current.status] ||
      (precedence[next.status] === precedence[current.status] &&
        canonicalJson(next) < canonicalJson(current))
    ) {
      byKind.set(next.kind, next)
    }
  }
  return [...byKind.values()].sort((left, right) => compareCodePoints(left.kind, right.kind))
}

const normalizeToolAssemblyInput = (
  input: ToolAssemblyInput,
): NormalizedToolAssemblyInput => {
  const selectedSlugs = normalizeSlugArray(input.selectedSlugs)
  if (
    selectedSlugs.length < TOOL_ASSEMBLY_MIN_TOOLS ||
    selectedSlugs.length > TOOL_ASSEMBLY_MAX_TOOLS
  ) {
    throw new Error(
      `Tool Assembly requires ${TOOL_ASSEMBLY_MIN_TOOLS}-${TOOL_ASSEMBLY_MAX_TOOLS} unique Tool slugs after duplicates are removed.`,
    )
  }

  const selectedSet = new Set(selectedSlugs)
  const toolsBySlug = new Map<string, NormalizedToolAssemblyTool>()
  for (const rawTool of input.tools ?? []) {
    const slug = normalizeSlug(rawTool.slug)
    if (!slug || !selectedSet.has(slug)) continue
    const tool: NormalizedToolAssemblyTool = {
      slug, name: normalizeText(rawTool.name) ?? slug,
      ...(normalizeUrl(rawTool.detailUrl) ? { detailUrl: normalizeUrl(rawTool.detailUrl) } : undefined),
      platforms: normalizeUniqueStrings(rawTool.platforms, TOOL_ASSEMBLY_PLATFORM_VALUES), integrations: normalizeIntegrations(rawTool.integrations, slug), agentInterfaces: normalizeAgentInterfaces(rawTool.agentInterfaces, slug)
    }
    const current = toolsBySlug.get(slug)
    if (!current || canonicalJson(tool) < canonicalJson(current)) toolsBySlug.set(slug, tool)
  }

  const requirements = parseToolAssemblyRequirements(input.requirements)
  if (!requirements.ok) throw new Error(requirements.errors.join(' '))

  const tools = [...toolsBySlug.values()].sort((left, right) =>
    compareCodePoints(left.slug, right.slug),
  )
  return {
    selectedSlugs,
    tools,
    unresolvedSlugs: selectedSlugs.filter((slug) => !toolsBySlug.has(slug)),
    requirements: requirements.value,
  }
}

const checkerSource: ToolAssemblyFactSource = {kind: 'checker'}
const requirementSource: ToolAssemblyFactSource = {kind: 'inline_requirement'}
const factSource = (tool: NormalizedToolAssemblyTool): ToolAssemblyFactSource => ({
  // SAFETY: The owner parser or adjacent runtime guard establishes each asserted property contract.
  kind: 'tool_detail_feed' as const, toolSlug: tool.slug,
  ...(tool.detailUrl ? { url: tool.detailUrl } : undefined)
})

const finding = (
  axis: ToolAssemblyAxis,
  key: string,
  label: string,
  state: ToolAssemblyFinding['state'],
  reason: string,
  facts: ToolAssemblyFact[],
  source: ToolAssemblyFactSource = checkerSource,
): ToolAssemblyFinding => ({axis, key, label, state, reason, facts, source})

const evaluateIntegrations = (
  normalized: NormalizedToolAssemblyInput,
): Pick<ToolAssemblyReport, 'confirmedOverlap' | 'explicitConflicts' | 'missingEvidence'> => {
  const confirmedOverlap: ToolAssemblyFinding[] = []
  const explicitConflicts: ToolAssemblyFinding[] = []
  const missingEvidence: ToolAssemblyFinding[] = []
  const keys = new Set(normalized.requirements.integrations)
  for (const tool of normalized.tools) for (const entry of tool.integrations) keys.add(entry.slug)

  for (const key of [...keys].sort(compareCodePoints)) {
    const requirement = normalized.requirements.integrations.includes(key)
    const toolsBySlug = new Map(normalized.tools.map((tool) => [tool.slug, tool]))
    const matches = normalized.selectedSlugs.map((slug) => ({
      slug,
      tool: toolsBySlug.get(slug),
      fact: toolsBySlug.get(slug)?.integrations.find((entry) => entry.slug === key),
    }))
    const positives = matches.filter(({fact}) =>
      fact ? isPositiveIntegrationStatus(fact.status) : false,
    )
    const negatives = matches.filter(({fact}) => fact?.status === 'incompatible')
    const unknowns = matches.filter(({fact}) => !fact || fact.status === 'unknown')
    const label = matches.find(({fact}) => fact)?.fact?.name ?? key
    const facts: ToolAssemblyFact[] = matches.map(({slug, tool, fact}) => ((() => {
                                                                             const state = (
        fact?.status === 'incompatible'
          ? 'conflict'
          : fact && fact.status !== 'unknown'
            ? 'confirmed'
            : 'unknown'
      ) satisfies ToolAssemblyFact['state']
                                                                             return {
                                                                               toolSlug: slug, state,
                                                                               ...(fact ? { status: fact.status } : undefined),
                                                                               source: fact?.source ??
                                                                                 (tool ? factSource(tool) : { kind: 'tool_detail_feed', toolSlug: slug })
                                                                             };
                                                                           })()))

    if (negatives.length > 0 && (positives.length > 0 || requirement)) {
      explicitConflicts.push(
        finding(
          'integration',
          key,
          label,
          'conflict',
          requirement
            ? `A selected Tool has structured incompatible evidence for required Integration ${label}.`
            : `Selected Tools contain contradictory structured facts for Integration ${label}.`,
          facts,
          requirement ? requirementSource : checkerSource,
        ),
      )
    } else if (matches.length > 0 && positives.length === matches.length) {
      confirmedOverlap.push(
        finding(
          'integration',
          key,
          label,
          'confirmed',
          `Every selected Tool has structured positive evidence for Integration ${label}.`,
          facts,
        ),
      )
    } else if (requirement || positives.length > 0 || unknowns.length > 0) {
      missingEvidence.push(
        finding(
          'integration',
          key,
          label,
          'unknown',
          `Integration ${label} is missing structured evidence for one or more selected Tools; absence is not incompatibility.`,
          facts,
          requirement ? requirementSource : checkerSource,
        ),
      )
    }
  }
  return {confirmedOverlap, explicitConflicts, missingEvidence}
}

// SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
const evaluatePositiveAxis = (
  normalized: NormalizedToolAssemblyInput,
  axis: 'platform' | 'agent_interface',
) => {
  const required =
    axis === 'platform'
      ? normalized.requirements.platforms
      : normalized.requirements.agentInterfaceKinds
  const allKeys = new Set<string>(required)
  for (const tool of normalized.tools) {
    const values =
      axis === 'platform'
        ? tool.platforms
        : tool.agentInterfaces
            .filter((entry) => entry.status !== 'unknown' && entry.status !== 'deprecated')
            .map((entry) => entry.kind)
    for (const value of values) allKeys.add(value)
  }
  const confirmed: ToolAssemblyFinding[] = []
  const missing: ToolAssemblyFinding[] = []
  const toolsBySlug = new Map(normalized.tools.map((tool) => [tool.slug, tool]))
  for (const key of [...allKeys].sort(compareCodePoints)) {
    const facts: ToolAssemblyFact[] = normalized.selectedSlugs.map((slug) => {
      const tool = toolsBySlug.get(slug)
      if (!tool) {
        return {
          toolSlug: slug,
          state: 'unknown',
          source: {kind: 'tool_detail_feed', toolSlug: slug},
        }
      }
      if (axis === 'platform') {
        // SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
        const present = tool.platforms.includes(key as ToolAssemblyPlatform)
        return (() => {
                 const state = (present ? 'confirmed' : 'unknown') satisfies ToolAssemblyFact['state']
                 return {
                   toolSlug: tool.slug, state,
                   ...(present ? { status: 'listed' } : undefined),
                   source: factSource(tool)
                 };
               })()
      }
      const entry = tool.agentInterfaces.find((candidate) => candidate.kind === key)
      return (() => {
               const state = (
          entry && entry.status !== 'unknown' && entry.status !== 'deprecated'
            ? 'confirmed'
            : 'unknown'
        ) satisfies ToolAssemblyFact['state']
               return {
                 toolSlug: tool.slug, state,
                 ...(entry ? { status: entry.status } : undefined),
                 source: entry?.source ?? factSource(tool)
               };
             })()
    })
    if (facts.length > 0 && facts.every((fact) => fact.state === 'confirmed')) {
      confirmed.push(
        finding(
          axis,
          key,
          key.replaceAll('_', ' '),
          'confirmed',
          `Every selected Tool lists this ${axis === 'platform' ? 'platform' : 'Agent Interface kind'}.`,
          facts,
        ),
      )
    } else if (
      required.includes(key as never) ||
      facts.some((fact) => fact.state === 'confirmed')
    ) {
      missing.push(
        finding(
          axis,
          key,
          key.replaceAll('_', ' '),
          'unknown',
          `One or more selected Tools lack structured evidence for this requirement; absence is not unsupported.`,
          facts,
          requirementSource,
        ),
      )
    }
  }
  return {confirmed, missing}
}

export const checkToolAssembly = (input: ToolAssemblyInput): ToolAssemblyReport => {
  const normalized = normalizeToolAssemblyInput(input)
  const integration = evaluateIntegrations(normalized)
  const platforms = evaluatePositiveAxis(normalized, 'platform')
  const agentInterfaces = evaluatePositiveAxis(normalized, 'agent_interface')
  const identityInput = {
    schemaVersion: TOOL_ASSEMBLY_VERSION,
    normalized,
  }
  return {
    schemaVersion: TOOL_ASSEMBLY_VERSION,
    identity: `sha256:${sha256Hex(canonicalJson(identityInput))}`,
    selectedTools: normalized.tools.map(({slug, name}) => ({slug, name})),
    requirements: normalized.requirements,
    confirmedOverlap: [...integration.confirmedOverlap, ...platforms.confirmed, ...agentInterfaces.confirmed],
    explicitConflicts: integration.explicitConflicts,
    missingEvidence: [...integration.missingEvidence, ...platforms.missing, ...agentInterfaces.missing],
    unresolvedTools: normalized.unresolvedSlugs.map((slug) => ({
      slug,
      state: 'unknown',
      reason: 'No validated public Tool detail feed was available for this selected slug.',
      source: {kind: 'tool_detail_feed', toolSlug: slug},
    })),
    notEvaluatedAxes: [
      {
        axis: 'runtime_os',
        state: 'not_evaluated',
        reason: 'Runtime and OS facts are not in the v1 public assembly contract.',
        source: checkerSource,
      },
      {
        axis: 'deployment_source',
        state: 'not_evaluated',
        reason: 'Deployment and source facts are not in the v1 public assembly contract.',
        source: checkerSource,
      },
      {
        axis: 'resource_relationships',
        state: 'not_evaluated',
        reason: 'Typed resource relationships are not in the v1 public assembly contract.',
        source: checkerSource,
      },
    ],
    disclaimer:
      'Mechanical intersection of reviewed public facts only. This is not a compatibility guarantee, certification, security audit, or dependency resolution.',
  }
}

export const serializeToolAssemblyReport = (report: ToolAssemblyReport): string =>
  canonicalJson(report)
