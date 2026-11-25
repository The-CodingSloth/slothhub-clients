import {hasRuntimeObjectType, isRuntimeString} from './runtimeValidation.js'
import type {JsonObject, JsonValue} from './jsonValue.js'
import {
  MAX_PUBLIC_AGENT_INTERFACES,
  isAgentInterfaceKind,
  isAgentInterfaceStatus,
  type AgentInterfaceKind,
  type AgentInterfaceStatus,
} from './agentInterface.js'
import {isResourceIdentityKind, type ResourceIdentityKind} from './resourceIdentity.js'
import {isResourceKind, type ResourceKind} from './resourceKind.js'
import {normalizePublicHostname, validatePublicHttpUrl} from './urlSafety.js'
import {canonicalJson} from './canonicalJson.js'
import {SLOTHHUB_PUBLIC_HOSTNAMES} from './publicHostnames.js'

export const PROJECT_TOOL_PIN_MANIFEST_ARTIFACT = 'slothhub.project-tool-pin-manifest' as const
export const PROJECT_TOOL_PIN_MANIFEST_VERSION = 4 as const
export const PROJECT_TOOL_PIN_MANIFEST_DEFAULT_FILENAME = 'slothhub.tools.json'
/**
 * The default name before the first public release, spelled with one h like a
 * look-alike domain. Readers still find a file with this name when the
 * current one is absent and ask for a rename; nothing writes it.
 */
export const PROJECT_TOOL_PIN_MANIFEST_LEGACY_FILENAME = 'slothub.tools.json'
export const PROJECT_TOOL_PIN_MANIFEST_MAX_BYTES = 64 * 1024
export const PROJECT_TOOL_PIN_MANIFEST_MAX_TOOLS = 100
export const PROJECT_TOOL_PIN_MANIFEST_MAX_AGENT_INTERFACES = 16
export const PROJECT_MANIFEST_TOOLS_ARTIFACT_MAX_BYTES = 10 * 1024 * 1024
export const PROJECT_MANIFEST_TOOLS_ARTIFACT_MAX_TOOLS = 5_000

const MAX_DEPTH = 12
const MAX_CITATIONS = 8
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
// Keep the v1 vocabulary frozen so its parser agrees with the archived JSON Schema.
const V1_RESOURCE_KINDS = new Set<ResourceKind>([
  'app', 'library_or_package', 'github_repository', 'guide_or_website', 'cli_tool',
  'api', 'mcp_server', 'agent_skill', 'template_or_starter', 'other',
])
const V2_RESOURCE_KINDS = new Set<ResourceKind>([...V1_RESOURCE_KINDS, 'ui_component'])
const V1_AGENT_INTERFACE_KINDS = new Set<AgentInterfaceKind>([
  'mcp_server', 'cli', 'sdk', 'api', 'openapi_spec', 'agent_skill',
  'browser_extension', 'automation_template',
])
const V2_AGENT_INTERFACE_KINDS = new Set<AgentInterfaceKind>([
  ...V1_AGENT_INTERFACE_KINDS, 'desktop_app', 'editor_extension',
])
const V1_RESOURCE_IDENTITY_KINDS = new Set<ResourceIdentityKind>([
  'website', 'github_repository', 'npm_package', 'pypi_project', 'crates_package',
  'mcp_registry_server', 'docs_site', 'other',
])
const V2_RESOURCE_IDENTITY_KINDS = new Set<ResourceIdentityKind>([
  ...V1_RESOURCE_IDENTITY_KINDS, 'gitlab_repository', 'jsr_package', 'go_module', 'container_image',
])
const SLOTHHUB_PUBLIC_HOSTNAME_SET = new Set(SLOTHHUB_PUBLIC_HOSTNAMES)
// SlothHub's own Vercel preview deployments all start with this. Matching the
// stem rather than listing project names keeps internal names out of the
// published clients, and a wider match only refuses more tracked links.
const SLOTHHUB_VERCEL_DEPLOYMENT_STEM = 'sloth'
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const URL_CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u

export interface ProjectToolPinManifestAgentInterface {
  kind: AgentInterfaceKind
  status: AgentInterfaceStatus
  identifier?: string
}

export interface ProjectToolPinManifestTool {
  slug: string
  detailUrl: string
  snapshot: {
    name: string
    resourceKind: ResourceKind
    resourceIdentity: {
      kind: ResourceIdentityKind
      key?: string
      url: string
    }
  }
  agentInterfaces: ProjectToolPinManifestAgentInterface[]
  role?: string
  note?: string
  citations: string[]
}

export type ProjectManifestCatalogTool = Omit<ProjectToolPinManifestTool, 'role' | 'note'>

export interface ProjectToolPinManifest {
  artifact: typeof PROJECT_TOOL_PIN_MANIFEST_ARTIFACT
  version: 1 | 2 | 3 | typeof PROJECT_TOOL_PIN_MANIFEST_VERSION
  producer: {name: string; version: string}
  createdAt: string
  provenance?: {
    catalogRevision?: string
    catalogFeedVersion?: string
    catalogGeneratedAt?: string
  }
  source?: {kind: 'saved_list'; id?: string; name?: string}
  tools: ProjectToolPinManifestTool[]
}

export type ProjectToolPinManifestInput = Omit<ProjectToolPinManifest, 'artifact' | 'version'>

export type ProjectToolPinManifestParseReason =
  | 'oversized'
  | 'malformed-json'
  | 'dangerous-key'
  | 'wrong-artifact-type'
  | 'unsupported-version'
  | 'invalid-manifest'

export type ProjectToolPinManifestParseResult =
  | {ok: true; value: ProjectToolPinManifest}
  | {ok: false; reason: ProjectToolPinManifestParseReason; value?: undefined}

export interface ProjectManifestToolsArtifact {
  version: string
  siteUrl: string
  generatedAt: string
  catalogRevision: string
  contentHash: string
  data: {tools: ProjectManifestCatalogTool[]}
}

export type ProjectManifestToolsArtifactParseResult =
  | {ok: true; value: ProjectManifestToolsArtifact}
  | {ok: false; reason:
      | 'oversized'
      | 'malformed-json'
      | 'dangerous-key'
      | 'excessive-depth'
      | 'excessive-nodes'
      | 'invalid-artifact'; value?: undefined}

export interface ProjectManifestToolsArtifactParseOptions {
  expectedVersion?: string
}

const isRecord = <Input>(value: Input): value is Input & JsonObject =>
  hasRuntimeObjectType(value) && value !== null && !Array.isArray(value)

const hasExactKeys = (
  value: JsonObject,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean => {
  const allowed = new Set([...required, ...optional])
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every((key) => allowed.has(key))
}

const normalizeText = (value: JsonValue, maxLength: number, allowEmpty = false): string | null => {
  if (!isRuntimeString(value)) return null
  const normalized = value.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim()
  if ((!allowEmpty && normalized.length === 0) || normalized.length > maxLength) return null
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(normalized)) return null
  return normalized
}

const normalizeOptionalText = (value: JsonValue, maxLength: number): string | undefined | null => {
  if (value === undefined) return undefined
  return normalizeText(value, maxLength)
}

const normalizeIsoDate = (value: JsonValue): string | null => {
  const text = normalizeText(value, 40)
  if (!text || !ISO_DATE_PATTERN.test(text)) return null
  const timestamp = Date.parse(text)
  const canonical = text.includes('.') ? text : text.replace('Z', '.000Z')
  if (Number.isNaN(timestamp) || new Date(timestamp).toISOString() !== canonical) return null
  return text
}

const normalizeHttpsUrl = (value: JsonValue): string | null => {
  if (!isRuntimeString(value) || URL_CONTROL_PATTERN.test(value)) return null
  const result = validatePublicHttpUrl(value)
  if (!result.success || !result.url) return null
  const url = new URL(result.url)
  if (url.protocol !== 'https:' || url.username || url.password) return null
  return url.toString()
}

const normalizePublicPath = (pathname: string): string | null => {
  let decoded = pathname
  try {
    for (let pass = 0; pass < 5; pass += 1) {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    }
  } catch {
    return null
  }
  if (decoded.includes('%')) return null
  const normalized = decoded.replace(/\\/g, '/').replace(/^\/+/, '/').toLowerCase()
  if (normalized.split('/').some((segment) => segment === '.' || segment === '..')) return null
  return normalized
}

const normalizeRawAbsoluteUrlPath = (value: JsonValue): string | null => {
  if (!isRuntimeString(value) || URL_CONTROL_PATTERN.test(value)) return null
  const match = /^[a-z][a-z\d+.-]*:\/\/[^/?#\\]+([/\\][^?#]*)?/iu.exec(value.trim())
  if (!match) return null
  return normalizePublicPath(match[1] ?? '/')
}

const isTrackedVisitPath = (pathname: string): boolean =>
  pathname === '/go' || pathname.startsWith('/go/')

const isSlothHubDeploymentHostname = (hostname: string): boolean => {
  const normalized = normalizePublicHostname(hostname).replace(/^www\./, '')
  if (SLOTHHUB_PUBLIC_HOSTNAME_SET.has(normalized)) return true
  if (!normalized.endsWith('.vercel.app')) return false

  return normalized.startsWith(SLOTHHUB_VERCEL_DEPLOYMENT_STEM)
}

const isSameDeploymentOrigin = (left: URL, right: URL): boolean =>
  left.protocol === right.protocol
  && normalizePublicHostname(left.hostname) === normalizePublicHostname(right.hostname)
  && left.port === right.port

type StructureIssue =
  | 'dangerous-key'
  | 'excessive-depth'
  | 'excessive-nodes'
  | 'oversized-array'

// SAFETY: The adjacent boundary checks validate the JSON container and every member read after this point.
const inspectStructure = (
  root: JsonValue,
  limits: {maxArrayItems?: number; maxNodes?: number} = {},
): StructureIssue | null => {
  const stack: Array<{value: JsonValue; depth: number}> = [{value: root, depth: 0}]
  let nodes = 0
  const maxArrayItems = limits.maxArrayItems ?? PROJECT_TOOL_PIN_MANIFEST_MAX_TOOLS
  const maxNodes = limits.maxNodes ?? 5_000

  while (stack.length > 0) {
    const current = stack.pop()!
    nodes += 1
    if (nodes > maxNodes) return 'excessive-nodes'
    if (current.depth > MAX_DEPTH) return 'excessive-depth'
    if (!current.value || !hasRuntimeObjectType(current.value)) continue

    if (Array.isArray(current.value)) {
      if (current.value.length > maxArrayItems) return 'oversized-array'
      current.value.forEach((value) => stack.push({value, depth: current.depth + 1}))
      continue
    }

    for (const [key, value] of Object.entries(current.value as JsonObject)) {
      if (DANGEROUS_KEYS.has(key)) return 'dangerous-key'
      stack.push({value, depth: current.depth + 1})
    }
  }

  return null
}

const reconstructAgentInterface = <Input>(value: Input): ProjectToolPinManifestAgentInterface | null => {
  if (!isRecord(value) || !hasExactKeys(value, ['kind', 'status'], ['identifier'])) return null
  if (!isAgentInterfaceKind(value.kind) || !isAgentInterfaceStatus(value.status)) return null
  const identifier = normalizeOptionalText(value.identifier, 200)
  if (identifier === null) return null
  return identifier
    ? {kind: value.kind, status: value.status, identifier}
    : {kind: value.kind, status: value.status}
}

const reconstructTool = <Input>(
  value: Input,
  maxAgentInterfaces = PROJECT_TOOL_PIN_MANIFEST_MAX_AGENT_INTERFACES,
  allowAnnotations = true,
): ProjectToolPinManifestTool | null => {
  if (!isRecord(value) || !hasExactKeys(
    value,
    ['slug', 'detailUrl', 'snapshot', 'agentInterfaces', 'citations'],
    allowAnnotations ? ['role', 'note'] : [],
  )) return null

  const slug = normalizeText(value.slug, 120)
  const rawDetailPath = normalizeRawAbsoluteUrlPath(value.detailUrl)
  const detailUrl = normalizeHttpsUrl(value.detailUrl)
  const role = normalizeOptionalText(value.role, 160)
  const note = normalizeOptionalText(value.note, 1_000)
  if (!slug || !SLUG_PATTERN.test(slug) || !rawDetailPath || !detailUrl || role === null || note === null) return null

  const detail = new URL(detailUrl)
  const detailPath = normalizePublicPath(detail.pathname)
  if (!detailPath || isTrackedVisitPath(detailPath) || !detailPath.endsWith(`/tool/${slug}`)) return null

  if (!isRecord(value.snapshot) || !hasExactKeys(value.snapshot, ['name', 'resourceKind', 'resourceIdentity'])) return null
  const name = normalizeText(value.snapshot.name, 160)
  if (!name || !isResourceKind(value.snapshot.resourceKind)) return null

  const identity = value.snapshot.resourceIdentity
  if (!isRecord(identity) || !hasExactKeys(identity, ['kind', 'url'], ['key'])) return null
  if (!isResourceIdentityKind(identity.kind)) return null
  const identityKey = normalizeOptionalText(identity.key, 240)
  const identityUrl = normalizeHttpsUrl(identity.url)
  if (identityKey === null || !identityUrl) return null

  if (!Array.isArray(value.agentInterfaces)
    || value.agentInterfaces.length > maxAgentInterfaces) return null
  const agentInterfaces: ProjectToolPinManifestAgentInterface[] = []
  const interfaceKeys = new Set<string>()
  for (const item of value.agentInterfaces) {
    const reconstructed = reconstructAgentInterface(item)
    if (!reconstructed) return null
    const key = `${reconstructed.kind}\u0000${reconstructed.status}\u0000${reconstructed.identifier ?? ''}`
    if (interfaceKeys.has(key)) return null
    interfaceKeys.add(key)
    agentInterfaces.push(reconstructed)
  }

  if (!Array.isArray(value.citations) || value.citations.length === 0 || value.citations.length > MAX_CITATIONS) return null
  const citations: string[] = []
  for (const citation of value.citations) {
    const normalized = normalizeHttpsUrl(citation)
    if (!normalized || citations.includes(normalized)) return null
    const citationUrl = new URL(normalized)
    if (isSlothHubDeploymentHostname(citationUrl.hostname) || isSameDeploymentOrigin(citationUrl, detail)) {
      const rawCitationPath = normalizeRawAbsoluteUrlPath(citation)
      const citationPath = normalizePublicPath(citationUrl.pathname)
      if (!rawCitationPath || !citationPath || isTrackedVisitPath(citationPath)) return null
    }
    citations.push(normalized)
  }

  return {
    slug, detailUrl, snapshot: {
        name,
        resourceKind: value.snapshot.resourceKind,
        resourceIdentity: {
          kind: identity.kind,
          ...(identityKey ? { key: identityKey } : undefined),
          url: identityUrl
        },
    }, agentInterfaces,
    ...role ? { role } : undefined,
    ...note ? { note } : undefined,
    citations
}
}

const reconstructManifest = <Input>(value: Input): ProjectToolPinManifest | null => {
  if (!isRecord(value) || !hasExactKeys(
    value,
    ['artifact', 'version', 'producer', 'createdAt', 'tools'],
    ['provenance', 'source'],
  )) return null
  const version = value.version
  if (value.artifact !== PROJECT_TOOL_PIN_MANIFEST_ARTIFACT || (version !== 1 && version !== 2 && version !== 3 && version !== PROJECT_TOOL_PIN_MANIFEST_VERSION)) return null

  if (!isRecord(value.producer) || !hasExactKeys(value.producer, ['name', 'version'])) return null
  const producerName = normalizeText(value.producer.name, 80)
  const producerVersion = normalizeText(value.producer.version, 40)
  const createdAt = normalizeIsoDate(value.createdAt)
  if (!producerName || !producerVersion || !createdAt) return null

  let provenance: ProjectToolPinManifest['provenance']
  if (value.provenance !== undefined) {
    if (!isRecord(value.provenance) || !hasExactKeys(
      value.provenance,
      [],
      ['catalogRevision', 'catalogFeedVersion', 'catalogGeneratedAt'],
    )) return null
    const catalogRevision = normalizeOptionalText(value.provenance.catalogRevision, 160)
    const catalogFeedVersion = normalizeOptionalText(value.provenance.catalogFeedVersion, 40)
    const catalogGeneratedAt = value.provenance.catalogGeneratedAt === undefined
      ? undefined
      : normalizeIsoDate(value.provenance.catalogGeneratedAt)
    if (catalogRevision === null || catalogFeedVersion === null || catalogGeneratedAt === null) return null
    if (!catalogRevision && !catalogFeedVersion && !catalogGeneratedAt) return null
    provenance = {
      ...(catalogRevision ? { catalogRevision } : undefined),
      ...(catalogFeedVersion ? { catalogFeedVersion } : undefined),
      ...(catalogGeneratedAt ? { catalogGeneratedAt } : undefined)
    }
  }

  let source: ProjectToolPinManifest['source']
  if (value.source !== undefined) {
    if (!isRecord(value.source) || !hasExactKeys(value.source, ['kind'], ['id', 'name'])) return null
    if (value.source.kind !== 'saved_list') return null
    const id = normalizeOptionalText(value.source.id, 120)
    const name = normalizeOptionalText(value.source.name, 80)
    if (id === null || name === null || (!id && !name)) return null
    source = {
      // SAFETY: The owner parser or adjacent runtime guard establishes each asserted property contract.
      kind: 'saved_list' as const,
      ...(id ? { id } : undefined),
      ...(name ? { name } : undefined)
    }
  }

  if (!Array.isArray(value.tools) || value.tools.length === 0 || value.tools.length > PROJECT_TOOL_PIN_MANIFEST_MAX_TOOLS) return null
  const tools: ProjectToolPinManifestTool[] = []
  const slugs = new Set<string>()
  for (const item of value.tools) {
    const tool = reconstructTool(item)
    if (!tool || slugs.has(tool.slug)) return null
    if (version === 1 || version === 2) {
      const resourceKinds = version === 1 ? V1_RESOURCE_KINDS : V2_RESOURCE_KINDS
      const identityKinds = version === 1 ? V1_RESOURCE_IDENTITY_KINDS : V2_RESOURCE_IDENTITY_KINDS
      const interfaceKinds = version === 1 ? V1_AGENT_INTERFACE_KINDS : V2_AGENT_INTERFACE_KINDS
      if (!resourceKinds.has(tool.snapshot.resourceKind) || !identityKinds.has(tool.snapshot.resourceIdentity.kind) ||
          tool.agentInterfaces.some(entry => !interfaceKinds.has(entry.kind))) return null
    }
    // v3 added interface kinds, but retained v2's Resource Kind vocabulary.
    if (version === 3 && !V2_RESOURCE_KINDS.has(tool.snapshot.resourceKind)) return null
    slugs.add(tool.slug)
    tools.push(tool)
  }

  return {
    artifact: PROJECT_TOOL_PIN_MANIFEST_ARTIFACT, version, producer: { name: producerName, version: producerVersion }, createdAt,
    ...(provenance ? { provenance } : undefined),
    ...(source ? { source } : undefined),
    tools
  }
}

export const parseProjectToolPinManifest = (raw: string): ProjectToolPinManifestParseResult => {
  if (new TextEncoder().encode(raw).byteLength > PROJECT_TOOL_PIN_MANIFEST_MAX_BYTES) {
    return {ok: false, reason: 'oversized'}
  }

  let parsed: JsonValue
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {ok: false, reason: 'malformed-json'}
  }

  const structureIssue = inspectStructure(parsed)
  if (structureIssue) return {
    ok: false,
    reason: structureIssue === 'dangerous-key' ? 'dangerous-key' : 'invalid-manifest',
  }
  if (!isRecord(parsed) || parsed.artifact !== PROJECT_TOOL_PIN_MANIFEST_ARTIFACT) {
    return {ok: false, reason: 'wrong-artifact-type'}
  }
  if (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3 && parsed.version !== PROJECT_TOOL_PIN_MANIFEST_VERSION) {
    return {ok: false, reason: 'unsupported-version'}
  }

  const value = reconstructManifest(parsed)
  return value ? {ok: true, value} : {ok: false, reason: 'invalid-manifest'}
}

export const buildProjectToolPinManifest = (input: ProjectToolPinManifestInput): ProjectToolPinManifest => {
  const value = reconstructManifest({
    artifact: PROJECT_TOOL_PIN_MANIFEST_ARTIFACT, version: PROJECT_TOOL_PIN_MANIFEST_VERSION, producer: input.producer, createdAt: input.createdAt,
    ...(input.provenance ? { provenance: input.provenance } : undefined),
    ...(input.source ? { source: input.source } : undefined),
    tools: input.tools
  })
  if (!value) throw new Error('invalid-manifest')
  return value
}

const CONTENT_IDENTITY_PATTERN = /^sha256:[a-f0-9]{64}$/

const buildProjectManifestCatalogTool = (
  input: ProjectManifestCatalogTool,
): ProjectManifestCatalogTool => {
  const tool = reconstructTool(input, MAX_PUBLIC_AGENT_INTERFACES, false)
  if (!tool) throw new Error('invalid-artifact')
  return tool
}

const normalizeArtifactSiteUrl = (value: JsonValue): string | null => {
  const normalized = normalizeHttpsUrl(value)
  if (!normalized) return null
  const url = new URL(normalized)
  if (url.search || url.hash) return null
  return url.toString().replace(/\/$/, '')
}

export const parseProjectManifestToolsArtifact = (
  raw: string,
  options: ProjectManifestToolsArtifactParseOptions = {},
): ProjectManifestToolsArtifactParseResult => {
  if (new TextEncoder().encode(raw).byteLength > PROJECT_MANIFEST_TOOLS_ARTIFACT_MAX_BYTES) {
    return {ok: false, reason: 'oversized'}
  }

  let parsed: JsonValue
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {ok: false, reason: 'malformed-json'}
  }

  const structureIssue = inspectStructure(parsed, {
    maxArrayItems: PROJECT_MANIFEST_TOOLS_ARTIFACT_MAX_TOOLS,
    maxNodes: 1_000_000,
  })
  if (structureIssue) return {
    ok: false,
    reason: structureIssue === 'oversized-array' ? 'invalid-artifact' : structureIssue,
  }
  if (!isRecord(parsed) || !hasExactKeys(
    parsed,
    ['version', 'siteUrl', 'generatedAt', 'catalogRevision', 'contentHash', 'data'],
  )) return {ok: false, reason: 'invalid-artifact'}

  const version = normalizeText(parsed.version, 40)
  const siteUrl = normalizeArtifactSiteUrl(parsed.siteUrl)
  const generatedAt = normalizeIsoDate(parsed.generatedAt)
  const catalogRevision = normalizeText(parsed.catalogRevision, 160)
  const contentHash = normalizeText(parsed.contentHash, 160)
  if (!version
    || (options.expectedVersion !== undefined && version !== options.expectedVersion)
    || !siteUrl
    || !generatedAt
    || !catalogRevision
    || !CONTENT_IDENTITY_PATTERN.test(catalogRevision)
    || !contentHash
    || !CONTENT_IDENTITY_PATTERN.test(contentHash)
    || !isRecord(parsed.data)
    || !hasExactKeys(parsed.data, ['tools'])
    || !Array.isArray(parsed.data.tools)
    || parsed.data.tools.length > PROJECT_MANIFEST_TOOLS_ARTIFACT_MAX_TOOLS) {
    return {ok: false, reason: 'invalid-artifact'}
  }

  const tools: ProjectManifestCatalogTool[] = []
  const slugs = new Set<string>()
  for (const item of parsed.data.tools) {
    let tool: ProjectManifestCatalogTool
    try {
      // SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
      tool = buildProjectManifestCatalogTool(item as ProjectManifestCatalogTool)
    } catch {
      return {ok: false, reason: 'invalid-artifact'}
    }
    if (slugs.has(tool.slug)) return {ok: false, reason: 'invalid-artifact'}
    slugs.add(tool.slug)
    tools.push(tool)
  }

  return {
    ok: true,
    value: {
      version,
      siteUrl,
      generatedAt,
      catalogRevision,
      contentHash,
      data: {tools},
    },
  }
}

export const serializeProjectToolPinManifest = (manifest: ProjectToolPinManifest): string => {
  const reconstructed = reconstructManifest(manifest)
  if (!reconstructed) throw new Error('invalid-manifest')
  const serialized = `${canonicalJson(reconstructed, 2)}\n`
  if (new TextEncoder().encode(serialized).byteLength > PROJECT_TOOL_PIN_MANIFEST_MAX_BYTES) {
    throw new Error('oversized')
  }
  return serialized
}

const renderText = (value: string): string => value
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('\n', ' ')

export const renderProjectToolPinManifest = (manifest: ProjectToolPinManifest): string => {
  const value = reconstructManifest(manifest)
  if (!value) throw new Error('invalid-manifest')
  const lines = [
    'Unverified project declaration',
    `Created: ${value.createdAt}`,
    `Producer: ${renderText(value.producer.name)} ${renderText(value.producer.version)}`,
    'This inventory is not a SlothHub attestation and does not install or execute anything.',
    'No selected Agent Interfaces does not mean unsupported.',
  ]

  if (value.source?.name) lines.push(`Source Saved list: ${renderText(value.source.name)}`)
  lines.push('')

  for (const [index, tool] of value.tools.entries()) {
    lines.push(`${index + 1}. ${renderText(tool.snapshot.name)} (${tool.slug})`)
    lines.push(`   Tool: ${tool.detailUrl}`)
    lines.push(`   Resource: ${tool.snapshot.resourceKind} / ${tool.snapshot.resourceIdentity.kind}`)
    lines.push(`   Identity: ${tool.snapshot.resourceIdentity.url}`)
    if (tool.role) lines.push(`   Project role: ${renderText(tool.role)}`)
    if (tool.note) lines.push(`   Note: ${renderText(tool.note)}`)
    if (tool.agentInterfaces.length > 0) {
      lines.push('   Selected Agent Interfaces:')
      for (const item of tool.agentInterfaces) {
        lines.push(`   - ${item.kind} (${item.status})${item.identifier ? `: ${renderText(item.identifier)}` : ''}`)
      }
    } else {
      lines.push('   Selected Agent Interfaces: none recorded')
    }
    lines.push('   Citations:', ...tool.citations.map((citation) => `   - ${citation}`), '')
  }

  return `${lines.join('\n').trimEnd()}\n`
}
