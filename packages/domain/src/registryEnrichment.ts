import {hasRuntimeObjectType, isRuntimeBoolean, isRuntimeNumber, isRuntimeString} from './runtimeValidation.js'
import type {JsonValue} from './jsonValue.js'
import {z} from 'zod'
import spdxLicenseIds from 'spdx-license-ids' with {type: 'json'}
import {parseGitlabRepositoryUrl} from './gitlabRepository.js'
import type {McpRegistryPackage} from './mcpRegistryPackages.js'
import type {
  ResourceIdentity,
  ResourceIdentityKind,
} from './resourceIdentity.js'
import {
  isValidSpdxExpression,
  type SourceBackedLicenseFact,
} from './licenseFacts.js'
import {
  normalizeMcpRegistryEnrichment,
  type McpRegistryRemote,
  type McpRegistryServerStatus,
} from './mcpRegistry.js'
export {
  REGISTRY_ENRICHMENT_SOURCE_VALUES,
  getRegistryResourceIdentityKey,
  isRegistryEnrichmentSource,
  type RegistryEnrichmentSource,
} from './registryEnrichmentSource.js'
import {
  getRegistryResourceIdentityKey,
  type RegistryEnrichmentSource,
} from './registryEnrichmentSource.js'
export type RegistryEnrichmentStatus = 'ok' | 'not_found' | 'error' | 'stale'
export type RegistryEnrichmentFailureKind =
  'not_found' | 'rate_limited' | 'server_error' | 'timeout' | 'dns' | 'network' | 'invalid_response'

export interface RegistryEnrichmentRequest {
  source: RegistryEnrichmentSource
  registryId: string
  sourceUrl: string
  apiUrl: string
}

export interface RegistryEnrichmentFacts {
  name?: string
  description?: string
  latestVersion?: string
  license?: string
  licenseFacts?: SourceBackedLicenseFact[]
  repositoryUrl?: string
  homepageUrl?: string
  docsUrl?: string
  packageUrl?: string
  registryUrl?: string
  language?: string
  starCount?: number
  forkCount?: number
  topics?: string[]
  defaultBranch?: string
  lastCommitAt?: string
  pushedAt?: string
  updatedAt?: string
  publishedAt?: string
  isArchived?: boolean
  isDeprecated?: boolean
  isDisabled?: boolean
  isFork?: boolean
  visibility?: string
  /** Registry-managed lifecycle status (`_meta` official block) for MCP servers. */
  mcpRegistryStatus?: McpRegistryServerStatus
  /** Parsed streamable HTTP and SSE remotes from the MCP Registry record. */
  mcpRemotes?: McpRegistryRemote[]
  mcpPackages?: McpRegistryPackage[]
}

export interface RegistryEnrichmentSnapshot {
  source: RegistryEnrichmentSource
  registryId: string
  sourceUrl: string
  apiUrl: string
  status: RegistryEnrichmentStatus
  fetchedAt: string
  staleAt?: string
  attemptedAt?: string
  retryAt?: string
  failureKind?: RegistryEnrichmentFailureKind
  failureCount?: number
  errorMessage?: string
  facts?: RegistryEnrichmentFacts
}

export interface RegistryEnrichmentFetchResponse {
  ok: boolean
  status: number
  retryAt?: string
  etag?: string
  lastModified?: string
  json: () => Promise<JsonValue>
}

export interface RegistryEnrichmentCacheValidators {
  etag?: string
  lastModified?: string
}

export interface RegistryEnrichmentFetchOptions {
  /** Sweep-only extra read: date the canonical default branch, never any-branch activity. */
  observeDefaultBranchCommit?: boolean
  fetchedAt?: string
  previousSnapshot?: RegistryEnrichmentSnapshot | null
  fetch?: (url: string) => Promise<RegistryEnrichmentFetchResponse>
}

type RegistryBackedIdentityKind = Extract<
  ResourceIdentityKind,
  'github_repository' | 'gitlab_repository' | 'npm_package' | 'pypi_project' | 'crates_package' | 'mcp_registry_server'
>

const kindToSource = {
  github_repository: 'github',
  gitlab_repository: 'gitlab',
  npm_package: 'npm',
  pypi_project: 'pypi',
  crates_package: 'crates',
  mcp_registry_server: 'mcp_registry',
} satisfies Record<RegistryBackedIdentityKind, RegistryEnrichmentSource>

const trimString = (value: JsonValue): string | undefined => {
  if (!isRuntimeString(value)) {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

const readNumber = (value: JsonValue): number | undefined =>
  isRuntimeNumber(value) && Number.isFinite(value) ? value : undefined

const readBoolean = (value: JsonValue): boolean | undefined =>
  isRuntimeBoolean(value) ? value : undefined

const readTopics = (topics: JsonValue): string[] | undefined => {

  if (!Array.isArray(topics)) {
    return undefined
  }

  const normalizedTopics = topics.filter(
    (topic): topic is string => isRuntimeString(topic) && topic.trim().length > 0,
  )

  return normalizedTopics.length > 0 ? normalizedTopics : undefined
}

interface GithubLicenseApiInput {
  spdx_id?: JsonValue
  key?: JsonValue
}

interface GithubRepositoryApiInput {
  full_name?: JsonValue
  description?: JsonValue
  homepage?: JsonValue
  html_url?: JsonValue
  language?: JsonValue
  license?: JsonValue
  stargazers_count?: JsonValue
  forks_count?: JsonValue
  topics?: JsonValue
  default_branch?: JsonValue
  pushed_at?: JsonValue
  updated_at?: JsonValue
  archived?: JsonValue
  disabled?: JsonValue
  fork?: JsonValue
  visibility?: JsonValue
}

const readGithubLicenseFact = (
  value: JsonValue,
  request: RegistryEnrichmentRequest,
  checkedAt: string,
): SourceBackedLicenseFact => {
  const provenance = {
    scope: 'repository' as const,
    registryId: request.registryId,
    source: request.source,
    sourceUrl: request.sourceUrl,
    checkedAt,
  }

  if (!hasRuntimeObjectType(value) || value === null || Array.isArray(value)) {
    return {
      _key: 'github-repository-license',
      ...provenance,
      status: 'unknown',
      unknownReason: 'missing',
    }
  }

  // SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
  const license = value as GithubLicenseApiInput
  const spdxId = trimString(license.spdx_id)

  if (spdxId && isValidSpdxExpression(spdxId)) {
    return {
      _key: 'github-repository-license',
      ...provenance,
      status: 'observed',
      spdxExpression: spdxId,
    }
  }

  return {
    _key: 'github-repository-license',
    ...provenance,
    status: 'unknown',
    ...(spdxId === 'NOASSERTION' ? {note: 'GitHub reports NOASSERTION; review the license files or package manifest and record scoped evidence manually.'} : undefined),
    unknownReason:
      trimString(license.key) === 'other'
        ? 'custom'
        : spdxId
          ? 'unparseable'
          : 'missing',
  }
}

export const isValidGithubRepositoryId = (value: string): boolean => {
  const [owner, repository, extra] = value.split('/')

  return Boolean(
    owner &&
    repository &&
    !extra &&
    owner.length <= 39 &&
    repository.length <= 100 &&
    /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(owner) &&
    !owner.includes('--') &&
    repository !== '.' &&
    repository !== '..' &&
    /^[A-Za-z0-9._-]+$/.test(repository),
  )
}

export const parseGithubRepositoryId = (identity: ResourceIdentity): string | null => {
  const explicitId = trimString(identity.registryId)
  if (explicitId) {
    const normalizedId = explicitId.replace(/\.git$/i, '')
    if (isValidGithubRepositoryId(normalizedId)) {
      return normalizedId
    }
  }

  const candidateUrl = trimString(identity.repositoryUrl) ?? trimString(identity.canonicalUrl)
  if (!candidateUrl) {
    return null
  }

  try {
    const url = new URL(candidateUrl)
    if (
      url.protocol !== 'https:' ||
      url.port ||
      url.username ||
      url.password ||
      (url.hostname !== 'github.com' && url.hostname !== 'www.github.com')
    ) {
      return null
    }

    const [owner, repo, extra] = url.pathname.split('/').filter(Boolean)
    if (!owner || !repo || extra) {
      return null
    }

    const normalizedId = `${owner}/${repo.replace(/\.git$/i, '')}`
    return isValidGithubRepositoryId(normalizedId) ? normalizedId : null
  } catch {
    return null
  }
}

const encodeRegistryId = (value: string): string => encodeURIComponent(value)

const getCratesSparseIndexPath = (crateName: string): string => {
  const normalized = crateName.toLowerCase()

  if (normalized.length === 1) {
    return `1/${normalized}`
  }

  if (normalized.length === 2) {
    return `2/${normalized}`
  }

  if (normalized.length === 3) {
    return `3/${normalized[0]}/${normalized}`
  }

  return `${normalized.slice(0, 2)}/${normalized.slice(2, 4)}/${normalized}`
}

export const buildRegistryEnrichmentRequest = (
  identity: ResourceIdentity | null | undefined,
): RegistryEnrichmentRequest | null => {
  if (!identity || !(identity.kind in kindToSource)) {
    return null
  }

  if (identity.kind === 'gitlab_repository') {
    const registryId = parseGitlabRepositoryUrl(identity.canonicalUrl)
    if (!registryId || (identity.registryId && getRegistryResourceIdentityKey('gitlab', identity.registryId) !== getRegistryResourceIdentityKey('gitlab', registryId))) return null
    return {
      source: 'gitlab', registryId, sourceUrl: `https://gitlab.com/${registryId}`,
      apiUrl: `https://gitlab.com/api/v4/projects/${encodeURIComponent(registryId)}?license=true`,
    }
  }

  if (identity.kind === 'github_repository') {
    const registryId = parseGithubRepositoryId(identity)
    if (!registryId) {
      return null
    }

    return {
      source: 'github',
      registryId,
      sourceUrl: `https://github.com/${registryId}`,
      apiUrl: `https://api.github.com/repos/${registryId}`,
    }
  }

  const registryId = trimString(identity.registryId)
  if (!registryId) {
    return null
  }

  if (identity.kind === 'npm_package') {
    return {
      source: 'npm',
      registryId,
      sourceUrl: identity.packageUrl ?? `https://www.npmjs.com/package/${registryId}`,
      apiUrl: `https://registry.npmjs.org/${encodeRegistryId(registryId)}`,
    }
  }

  if (identity.kind === 'pypi_project') {
    return {
      source: 'pypi',
      registryId,
      sourceUrl: identity.packageUrl ?? `https://pypi.org/project/${registryId}/`,
      apiUrl: `https://pypi.org/pypi/${encodeRegistryId(registryId)}/json`,
    }
  }

  if (identity.kind === 'crates_package') {
    return {
      source: 'crates',
      registryId,
      sourceUrl: identity.packageUrl ?? `https://crates.io/crates/${registryId}`,
      apiUrl: `https://index.crates.io/${getCratesSparseIndexPath(registryId)}`,
    }
  }

  if (identity.kind === 'mcp_registry_server') {
    return {
      source: 'mcp_registry',
      registryId,
      sourceUrl:
        identity.mcpRegistryUrl ??
        `https://registry.modelcontextprotocol.io/servers/${encodeRegistryId(registryId)}`,
      apiUrl: `https://registry.modelcontextprotocol.io/v0.1/servers/${encodeRegistryId(registryId)}/versions/latest`,
    }
  }

  return null
}

const gitlabProjectSchema = z.object({
  path_with_namespace: z.string().min(1),
  web_url: z.string().url(),
  description: z.string().nullable().optional(),
  star_count: z.number().int().nonnegative().optional(),
  forks_count: z.number().int().nonnegative().optional(),
  archived: z.boolean().optional(),
  visibility: z.literal('public'),
  default_branch: z.string().nullable().optional(),
  last_activity_at: z.iso.datetime().optional(),
  topics: z.array(z.string()).optional(),
  license: z.object({key: z.string()}).nullable().optional(),
})

const normalizeGitlabRepositoryEnrichment = (
  payload: JsonValue,
  request: RegistryEnrichmentRequest,
  fetchedAt: string,
): RegistryEnrichmentSnapshot => {
  const parsed = gitlabProjectSchema.safeParse(payload)
  if (!parsed.success) throw Object.assign(new Error('GitLab response was not a valid public project'), {code: 'REGISTRY_INVALID_RESPONSE'})
  const input = parsed.data
  const observedId = parseGitlabRepositoryUrl(input.web_url)
  if (!observedId || observedId.toLowerCase() !== input.path_with_namespace.toLowerCase()) {
    throw Object.assign(new Error('GitLab response omitted a valid canonical project'), {code: 'REGISTRY_INVALID_RESPONSE'})
  }
  // GitLab returns a lowercase license key rather than a canonical SPDX ID.
  const spdxExpression = spdxLicenseIds.find((id) => id.toLowerCase() === input.license?.key.toLowerCase())
  const provenance = {scope: 'repository' as const, source: 'gitlab' as const, registryId: observedId, sourceUrl: input.web_url, checkedAt: fetchedAt}
  const licenseFact: SourceBackedLicenseFact = spdxExpression
    ? {...provenance, status: 'observed', spdxExpression}
    : {...provenance, status: 'unknown', unknownReason: input.license ? 'custom' : 'missing'}
  return {...request, status: 'ok', fetchedAt, facts: {
    name: input.path_with_namespace, repositoryUrl: input.web_url,
    ...(input.description ? {description: input.description} : undefined),
    ...(input.star_count !== undefined ? {starCount: input.star_count} : undefined),
    ...(input.forks_count !== undefined ? {forkCount: input.forks_count} : undefined),
    ...(input.archived !== undefined ? {isArchived: input.archived} : undefined),
    visibility: input.visibility,
    ...(input.default_branch ? {defaultBranch: input.default_branch} : undefined),
    ...(input.last_activity_at ? {updatedAt: input.last_activity_at} : undefined),
    ...(input.topics ? {topics: input.topics} : undefined),
    licenseFacts: [licenseFact],
  }}
}

export const normalizeGithubRepositoryEnrichment = (
  payload: JsonValue,
  request: RegistryEnrichmentRequest,
  fetchedAt: string,
): RegistryEnrichmentSnapshot => {
  if (!hasRuntimeObjectType(payload) || payload === null || Array.isArray(payload)) {
    throw Object.assign(new Error('GitHub response must be an object'), {
      code: 'REGISTRY_INVALID_RESPONSE',
    })
  }
  // SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
  const input = payload as GithubRepositoryApiInput
  const name = trimString(input.full_name)
  if (!name || !isValidGithubRepositoryId(name)) {
    throw Object.assign(new Error('GitHub response omitted a valid canonical repository name'), {
      code: 'REGISTRY_INVALID_RESPONSE',
    })
  }
  const description = trimString(input.description)
  const homepageUrl = trimString(input.homepage)
  const repositoryUrl = trimString(input.html_url)
  const language = trimString(input.language)
  const licenseFact = readGithubLicenseFact(input.license, request, fetchedAt)
  const starCount = readNumber(input.stargazers_count)
  const forkCount = readNumber(input.forks_count)
  const topics = readTopics(input.topics)
  const defaultBranch = trimString(input.default_branch)
  const pushedAt = trimString(input.pushed_at)
  const updatedAt = trimString(input.updated_at)
  const isArchived = readBoolean(input.archived)
  const isDisabled = readBoolean(input.disabled)
  const isFork = readBoolean(input.fork)
  const visibility = trimString(input.visibility)
  const licenseFacts = [licenseFact]

  return {
    ...request,
    status: 'ok',
    fetchedAt,
    facts: {
      ...(name ? { name } : undefined),
      ...(description ? { description } : undefined),
      ...(homepageUrl ? { homepageUrl } : undefined),
      ...(repositoryUrl ? { repositoryUrl } : undefined),
      ...(language ? { language } : undefined),
      licenseFacts,
      ...(starCount !== undefined ? { starCount } : undefined),
      ...(forkCount !== undefined ? { forkCount } : undefined),
      ...(topics ? { topics } : undefined),
      ...(defaultBranch ? { defaultBranch } : undefined),
      ...(pushedAt ? { pushedAt } : undefined),
      ...(updatedAt ? { updatedAt } : undefined),
      ...(isArchived !== undefined ? { isArchived } : undefined),
      ...(isDisabled !== undefined ? { isDisabled } : undefined),
      ...(isFork !== undefined ? { isFork } : undefined),
      ...(visibility ? { visibility } : undefined)
    },
  }
}

export const buildRegistryEnrichmentFailure = (
  request: RegistryEnrichmentRequest,
  attemptedAt: string,
  errorMessage: string,
  status: Extract<RegistryEnrichmentStatus, 'not_found' | 'error'> = 'not_found',
  failureKind: RegistryEnrichmentFailureKind = status === 'not_found'
    ? 'not_found'
    : 'invalid_response',
  previousSnapshot?: RegistryEnrichmentSnapshot | null,
): RegistryEnrichmentSnapshot => {
  const sameTarget =
    previousSnapshot !== null &&
    previousSnapshot !== undefined &&
    getRegistryResourceIdentityKey(previousSnapshot.source, previousSnapshot.registryId) ===
      getRegistryResourceIdentityKey(request.source, request.registryId)
  const failureCount =
    sameTarget && previousSnapshot.failureKind === failureKind
      ? (previousSnapshot.failureCount ?? 0) + 1
      : 1

  if (sameTarget && previousSnapshot.facts) {
    const {retryAt: _retryAt, ...retainedSnapshot} = previousSnapshot
    return {
      ...retainedSnapshot,
      ...request,
      status: 'stale',
      staleAt: previousSnapshot.staleAt ?? attemptedAt,
      attemptedAt,
      failureKind,
      failureCount,
      errorMessage,
    }
  }

  return {
    ...request,
    status,
    fetchedAt: attemptedAt,
    attemptedAt,
    failureKind,
    failureCount,
    errorMessage,
  }
}

const classifyResponseFailure = (
  status: number,
) => {
  if (status === 404) {
    return {status: 'not_found', kind: 'not_found'} satisfies {
      status: Extract<RegistryEnrichmentStatus, 'not_found' | 'error'>
      kind: RegistryEnrichmentFailureKind
    }
  }
  if (status === 429) {
    return {status: 'error', kind: 'rate_limited'} satisfies {
      status: Extract<RegistryEnrichmentStatus, 'not_found' | 'error'>
      kind: RegistryEnrichmentFailureKind
    }
  }
  if (status >= 500) {
    return {status: 'error', kind: 'server_error'} satisfies {
      status: Extract<RegistryEnrichmentStatus, 'not_found' | 'error'>
      kind: RegistryEnrichmentFailureKind
    }
  }
  return {status: 'error', kind: 'invalid_response'} satisfies {
    status: Extract<RegistryEnrichmentStatus, 'not_found' | 'error'>
    kind: RegistryEnrichmentFailureKind
  }
}

const isTransientRegistryStatus = (status: number): boolean =>
  status === 408 || status === 429 || status >= 500

export const fetchRegistryEnrichmentSnapshot = async (
  identity: ResourceIdentity | null | undefined,
  options: RegistryEnrichmentFetchOptions = {},
): Promise<RegistryEnrichmentSnapshot | null> => {
  const request = buildRegistryEnrichmentRequest(identity)
  if (!request) {
    return null
  }

  const fetchedAt = options.fetchedAt ?? new Date().toISOString()

  if (request.source !== 'github' && request.source !== 'gitlab' && request.source !== 'mcp_registry') {
    return null
  }

  const fetcher: (url: string) => Promise<RegistryEnrichmentFetchResponse> = options.fetch ?? fetch

  try {
    const response = await fetcher(request.apiUrl)

    if (!response.ok) {
      const failure = classifyResponseFailure(response.status)
      const shouldPreserve =
        response.status === 404 || isTransientRegistryStatus(response.status)
      const snapshot = buildRegistryEnrichmentFailure(
        request,
        fetchedAt,
        `${request.source} returned ${response.status}`,
        failure.status,
        failure.kind,
        shouldPreserve ? options.previousSnapshot : undefined,
      )
      return response.retryAt && Number.isFinite(Date.parse(response.retryAt))
        ? {...snapshot, retryAt: response.retryAt}
        : snapshot
    }

    const payload = await response.json()
    if (request.source === 'github' && options.observeDefaultBranchCommit) {
      const snapshot = normalizeGithubRepositoryEnrichment(payload, request, fetchedAt)
      if (!snapshot.facts?.defaultBranch || !snapshot.facts.name) return snapshot
      const url = new URL(`https://api.github.com/repos/${snapshot.facts.name}/commits`)
      url.searchParams.set('sha', snapshot.facts.defaultBranch)
      url.searchParams.set('per_page', '1')
      const commitResponse = await fetcher(url.toString())
      if (!commitResponse.ok) {
        const failure = classifyResponseFailure(commitResponse.status)
        const failed = buildRegistryEnrichmentFailure(request, fetchedAt, `github default-branch commit returned ${commitResponse.status}`, failure.status, failure.kind, options.previousSnapshot)
        return commitResponse.retryAt ? {...failed, retryAt: commitResponse.retryAt} : failed
      }
      const commits = z.array(z.object({commit: z.object({committer: z.object({date: z.iso.datetime({offset: true})})})})).min(1).max(1).safeParse(await commitResponse.json())
      if (!commits.success || Date.parse(commits.data[0]!.commit.committer.date) > Date.parse(fetchedAt)) {
        throw Object.assign(new Error('GitHub default-branch commit omitted a valid observed date'), {code: 'REGISTRY_INVALID_RESPONSE'})
      }
      return {...snapshot, facts: {...snapshot.facts, lastCommitAt: commits.data[0]!.commit.committer.date}}
    }
    return request.source === 'mcp_registry'
      ? normalizeMcpRegistryEnrichment(payload, request, fetchedAt)
      : request.source === 'gitlab'
        ? normalizeGitlabRepositoryEnrichment(payload, request, fetchedAt)
      : normalizeGithubRepositoryEnrichment(payload, request, fetchedAt)
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Registry fetch failed'
    let failureKind: RegistryEnrichmentFailureKind = 'network'
    if (error instanceof Error && /abort|timeout/i.test(error.name)) {
      failureKind = 'timeout'
    } else {
      const code =
        hasRuntimeObjectType(error) && error !== null && 'code' in error
          ? String(error.code)
          : undefined
      if (code === 'REGISTRY_TIMEOUT') failureKind = 'timeout'
      else if (code === 'REGISTRY_DNS' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
        failureKind = 'dns'
      } else if (code === 'REGISTRY_INVALID_RESPONSE') failureKind = 'invalid_response'
    }
    return buildRegistryEnrichmentFailure(
      request,
      fetchedAt,
      errorMessage,
      'error',
      failureKind,
      options.previousSnapshot,
    )
  }
}
