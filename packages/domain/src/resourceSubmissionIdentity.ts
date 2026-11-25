import {isRuntimeString} from './runtimeValidation.js'
import type {JsonValue} from './jsonValue.js'
import {
  getResourceIdentityKindLabel,
  isResourceIdentityKind,
  resolveResourceIdentity,
  toResourceIdentityKind,
  type ResourceIdentity,
  type ResourceIdentityInput,
  type ResourceIdentityKind,
  type ResourceIdentityValidationIssue,
  validateResourceIdentity,
} from './resourceIdentity.js'
import {
  getToolWebsiteHost,
  getToolWebsiteIdentityKey,
  normalizeToolWebsiteForStorage,
} from './toolWebsiteIdentity.js'
import {validatePublicHttpUrl} from './urlSafety.js'
import {
  containerImageCanonicalUrl,
  parseContainerImageReference,
} from './containerImage.js'
import {isCanonicalGoModulePath} from './goModule.js'
import {isValidNpmPackageName, isValidPypiProjectName} from './agentInterface.js'
import {parseGitlabRepositoryUrl} from './gitlabRepository.js'

export type ResourceSubmissionIdentityInput = {
  kind?: JsonValue
  identifier?: string | null
  websiteUrl?: string | null
}

export type NormalizedResourceSubmissionIdentity = ResourceIdentity & {
  /** Primary URL used for Tracked outbound / email display when present. */
  primaryUrl: string
  /** Optional marketing website companion for non-website identities. */
  companionWebsiteUrl?: string
}

export type ResourceSubmissionIdentityIssue = {
  path: string
  message: string
}

const trimOptional = (value: string | null | undefined): string | undefined => {
  if (!isRuntimeString(value)) {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

const ensureHttpsUrl = (value: string): string | null => {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`
  const normalized = normalizeToolWebsiteForStorage(withProtocol)
  if (!normalized || !validatePublicHttpUrl(normalized).success) {
    return null
  }
  return normalized
}

const parseGithubRepository = (
  identifier: string,
): {canonicalUrl: string; registryId: string; repositoryUrl: string} | null => {
  const trimmed = identifier.trim()
  const ownerRepoMatch = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)(?:\.git)?\/?$/i,
  )
  const shorthandMatch = trimmed.match(/^([^/\s]+)\/([^/\s#?]+)$/)
  const match = ownerRepoMatch ?? shorthandMatch

  if (!match) {
    return null
  }

  const owner = match[1]?.toLowerCase()
  const repo = match[2]?.replace(/\.git$/i, '').toLowerCase()
  if (!owner || !repo || owner === '.' || repo === '.') {
    return null
  }

  const registryId = `${owner}/${repo}`
  const canonicalUrl = `https://github.com/${registryId}`
  return {canonicalUrl, registryId, repositoryUrl: canonicalUrl}
}

const parseNpmPackage = (
  identifier: string,
): {canonicalUrl: string; registryId: string; packageUrl: string} | null => {
  const trimmed = identifier.trim()
  const urlMatch = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?npmjs\.com\/package\/(@?[^/\s]+(?:\/[^/\s]+)?)\/?$/i,
  )
  const registryId = (urlMatch?.[1] ?? trimmed).toLowerCase()

  if (!isValidNpmPackageName(registryId)) {
    return null
  }

  const canonicalUrl = `https://www.npmjs.com/package/${registryId}`
  return {canonicalUrl, registryId, packageUrl: canonicalUrl}
}

const parsePypiProject = (
  identifier: string,
): {canonicalUrl: string; registryId: string; packageUrl: string} | null => {
  const trimmed = identifier.trim()
  const urlMatch = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?pypi\.org\/project\/([^/\s#?]+)\/?$/i,
  )
  const registryId = (urlMatch?.[1] ?? trimmed)
    .toLowerCase()
    .replace(/[-_.]+/g, '-')

  if (!isValidPypiProjectName(registryId)) {
    return null
  }

  const canonicalUrl = `https://pypi.org/project/${registryId}/`
  return {canonicalUrl, registryId, packageUrl: canonicalUrl}
}

const parseCratesPackage = (
  identifier: string,
): {canonicalUrl: string; registryId: string; packageUrl: string} | null => {
  const trimmed = identifier.trim()
  const urlMatch = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?crates\.io\/crates\/([^/\s#?]+)\/?$/i,
  )
  const registryId = (urlMatch?.[1] ?? trimmed).toLowerCase()

  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(registryId)) {
    return null
  }

  const canonicalUrl = `https://crates.io/crates/${registryId}`
  return {canonicalUrl, registryId, packageUrl: canonicalUrl}
}

const parseJsrPackage = (
  identifier: string,
): {canonicalUrl: string; registryId: string; packageUrl: string} | null => {
  const trimmed = identifier.trim()
  const urlMatch = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?jsr\.io\/(@[^/\s#?]+\/[^/\s#?]+)\/?$/i,
  )
  // JSR scopes and package names are case-insensitive and lowercase on publish.
  const registryId = (urlMatch?.[1] ?? trimmed).toLowerCase()

  if (
    !/^@[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(registryId)
  ) {
    return null
  }

  const canonicalUrl = `https://jsr.io/${registryId}`
  return {canonicalUrl, registryId, packageUrl: canonicalUrl}
}

const parseGoModule = (
  identifier: string,
): {canonicalUrl: string; registryId: string; packageUrl: string} | null => {
  const trimmed = identifier.trim()
  const urlMatch = trimmed.match(
    /^(?:https?:\/\/)?pkg\.go\.dev\/([^\s?#]+?)\/?$/i,
  )
  const registryId = urlMatch?.[1] ?? trimmed

  if (!isCanonicalGoModulePath(registryId)) {
    return null
  }

  const canonicalUrl = `https://pkg.go.dev/${registryId}`
  return {canonicalUrl, registryId, packageUrl: canonicalUrl}
}

const parseMcpRegistryServer = (
  identifier: string,
): {canonicalUrl: string; registryId: string; mcpRegistryUrl: string} | null => {
  const trimmed = identifier.trim()
  const urlMatch = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?registry\.modelcontextprotocol\.io\/(?:v0(?:\.\d+)?\/)?servers\/([^/\s#?]+)\/?$/i,
  )
  let registryId: string
  try {
    registryId = decodeURIComponent(urlMatch?.[1] ?? trimmed).trim()
  } catch {
    return null
  }

  if (!registryId || /\s/.test(registryId)) {
    return null
  }

  const canonicalUrl = `https://registry.modelcontextprotocol.io/v0.1/servers/${encodeURIComponent(registryId)}`
  return {canonicalUrl, registryId, mcpRegistryUrl: canonicalUrl}
}

const parseContainerImageSubmission = (
  identifier: string,
): {canonicalUrl: string; registryId: string; packageUrl: string} | null => {
  const trimmed = identifier.trim()
  const hubUrlMatch = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?hub\.docker\.com\/(?:r\/([^/\s?#]+\/[^/\s?#]+)|_\/([^/\s?#]+?))\/?(?:[?#].*)?$/i,
  )
  const ghcrUrlMatch = trimmed.match(/^(?:https?:\/\/)?ghcr\.io\/([^\s?#]+?)\/?(?:[?#].*)?$/i)
  const reference =
    hubUrlMatch?.[1] ??
    hubUrlMatch?.[2] ??
    (ghcrUrlMatch?.[1] ? `ghcr.io/${ghcrUrlMatch[1]}` : trimmed)
  const parsed = parseContainerImageReference(reference)
  if (!parsed) {
    return null
  }

  const canonicalUrl = containerImageCanonicalUrl(parsed.pullRef)
  if (!canonicalUrl) {
    return null
  }

  return {canonicalUrl, registryId: parsed.pullRef, packageUrl: canonicalUrl}
}

const buildIdentityFromKind = (
  kind: ResourceIdentityKind,
  identifier: string,
): ResourceIdentityInput | null => {
  switch (kind) {
    case 'website': {
      const canonicalUrl = ensureHttpsUrl(identifier)
      if (!canonicalUrl) {
        return null
      }
      return {kind, canonicalUrl, websiteUrl: canonicalUrl}
    }
    case 'github_repository': {
      const parsed = parseGithubRepository(identifier)
      return parsed ? {kind, ...parsed} : null
    }
    case 'gitlab_repository': {
      const registryId = parseGitlabRepositoryUrl(identifier)
      if (!registryId) return null
      const canonicalUrl = `https://gitlab.com/${registryId}`
      return {kind, canonicalUrl, registryId, repositoryUrl: canonicalUrl}
    }
    case 'npm_package': {
      const parsed = parseNpmPackage(identifier)
      return parsed ? {kind, ...parsed} : null
    }
    case 'pypi_project': {
      const parsed = parsePypiProject(identifier)
      return parsed ? {kind, ...parsed} : null
    }
    case 'crates_package': {
      const parsed = parseCratesPackage(identifier)
      return parsed ? {kind, ...parsed} : null
    }
    case 'jsr_package': {
      const parsed = parseJsrPackage(identifier)
      return parsed ? {kind, ...parsed} : null
    }
    case 'go_module': {
      const parsed = parseGoModule(identifier)
      return parsed ? {kind, ...parsed} : null
    }
    case 'mcp_registry_server': {
      const parsed = parseMcpRegistryServer(identifier)
      return parsed ? {kind, ...parsed} : null
    }
    case 'container_image': {
      const parsed = parseContainerImageSubmission(identifier)
      return parsed ? {kind, ...parsed} : null
    }
    case 'docs_site':
    case 'other': {
      const canonicalUrl = ensureHttpsUrl(identifier)
      if (!canonicalUrl) {
        return null
      }
      return {
        kind, canonicalUrl,
        ...(kind === 'docs_site' ? { docsUrl: canonicalUrl } : undefined)
      }
    }
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}

// The duplicate-key extractor only keys URLs on the exact registry hosts, so a
// positive match proves the kind-specific field carries the right destination —
// not merely a value the lenient identifier parsers could reinterpret.
const urlMatchesRegistryKind = (
  kind: ResourceIdentityKind,
  value: string,
): boolean => registryIdentityFromUrl(value)?.kind === kind

interface ResourceIdentityPrimaryUrlRequirement {
  field: 'repositoryUrl' | 'packageUrl' | 'mcpRegistryUrl'
  matches: (value: string) => boolean
  expected: string
}

const KIND_PRIMARY_URL_REQUIREMENTS = new Map<
  ResourceIdentityKind,
  ResourceIdentityPrimaryUrlRequirement
>([
  ['gitlab_repository', {
    field: 'repositoryUrl', matches: (value) => Boolean(parseGitlabRepositoryUrl(value)),
    expected: 'a GitLab repository URL such as https://gitlab.com/group/project',
  }],
  [
    'github_repository',
    {
      field: 'repositoryUrl',
      matches: (value: string) => urlMatchesRegistryKind('github_repository', value),
      expected: 'a GitHub repository URL such as https://github.com/owner/repo',
    },
  ],
  [
    'npm_package',
    {
      field: 'packageUrl',
      matches: (value: string) => urlMatchesRegistryKind('npm_package', value),
      expected: 'an npm package URL such as https://www.npmjs.com/package/name',
    },
  ],
  [
    'pypi_project',
    {
      field: 'packageUrl',
      matches: (value: string) => urlMatchesRegistryKind('pypi_project', value),
      expected: 'a PyPI project URL such as https://pypi.org/project/name/',
    },
  ],
  [
    'crates_package',
    {
      field: 'packageUrl',
      matches: (value: string) => urlMatchesRegistryKind('crates_package', value),
      expected: 'a crates.io package URL such as https://crates.io/crates/name',
    },
  ],
  [
    'jsr_package',
    {
      field: 'packageUrl',
      matches: (value: string) => urlMatchesRegistryKind('jsr_package', value),
      expected: 'a JSR package URL such as https://jsr.io/@scope/name',
    },
  ],
  [
    'go_module',
    {
      field: 'packageUrl',
      matches: (value: string) => urlMatchesRegistryKind('go_module', value),
      expected: 'a Go package URL such as https://pkg.go.dev/module/path',
    },
  ],
  [
    'mcp_registry_server',
    {
      field: 'mcpRegistryUrl',
      matches: (value: string) =>
        urlMatchesRegistryKind('mcp_registry_server', value),
      expected:
        'an MCP Registry server URL such as https://registry.modelcontextprotocol.io/v0.1/servers/name',
    },
  ],
  [
    'container_image',
    {
      field: 'packageUrl',
      matches: (value: string) => parseContainerImageSubmission(value) !== null,
      expected:
        'a container registry URL such as https://hub.docker.com/r/namespace/name or https://ghcr.io/owner/name',
    },
  ],
])

// Registry ID format checks for kinds that parse an identifier. Container image
// and Go module registry IDs already carry dedicated checks in
// validateResourceIdentity, so they are not repeated here.
const REGISTRY_ID_EXPECTED_FORMATS = new Map<ResourceIdentityKind, string>([
  ['github_repository', 'an owner/repository identifier such as acme/widgets'],
  ['npm_package', 'an npm package name such as lodash or @scope/name'],
  ['pypi_project', 'a PyPI project name such as requests'],
  ['crates_package', 'a crates.io package name such as serde'],
  ['jsr_package', 'a JSR package identifier such as @scope/name'],
  [
    'mcp_registry_server',
    'an MCP Registry server name such as io.github.owner/server',
  ],
])

/**
 * Authoring-time format checks for kind-specific Resource Identity fields.
 * The field that declares the identity must match the expected host or
 * identifier format for the selected kind so editors get the named error at
 * the field instead of a generic canonical-URL failure.
 */
export const validateResourceIdentityFieldFormats = (
  input: ResourceIdentityInput | null | undefined,
): ResourceIdentityValidationIssue[] => {
  if (!input) {
    return []
  }

  const kind = toResourceIdentityKind(input.kind)
  const issues: ResourceIdentityValidationIssue[] = []

  const primary = KIND_PRIMARY_URL_REQUIREMENTS.get(kind)
  if (primary) {
    const value = trimOptional(input[primary.field])
    const genericImage = kind === 'container_image' && parseContainerImageReference(input.registryId)?.source === 'container_registry'
    const valid = value && (genericImage ? validatePublicHttpUrl(value).success : primary.matches(value))
    if (value && !valid) {
      issues.push({
        path: `resourceIdentity.${primary.field}`,
        message: genericImage
          ? 'Generic container image identity expects an authored public HTTP or HTTPS package URL without credentials or private-network destinations.'
          : `${getResourceIdentityKindLabel(kind)} identity expects ${primary.expected}.`,
      })
    }
  }

  const registryId = trimOptional(input.registryId)
  const expectedRegistryFormat = REGISTRY_ID_EXPECTED_FORMATS.get(kind)
  if (
    registryId &&
    expectedRegistryFormat &&
    !buildIdentityFromKind(kind, registryId)
  ) {
    issues.push({
      path: 'resourceIdentity.registryId',
      message: `${getResourceIdentityKindLabel(kind)} identity expects ${expectedRegistryFormat}.`,
    })
  }

  return issues
}

export const validateResourceSubmissionIdentityInput = (
  input: ResourceSubmissionIdentityInput,
): ResourceSubmissionIdentityIssue[] => {
  const issues: ResourceSubmissionIdentityIssue[] = []
  const kindValue = input.kind
  if (!isResourceIdentityKind(kindValue)) {
    issues.push({
      path: 'resourceIdentity.kind',
      message: 'Choose a valid Resource Identity kind.',
    })
    return issues
  }

  const identifier = trimOptional(input.identifier)
  if (!identifier) {
    issues.push({
      path: 'resourceIdentity.identifier',
      message: `${getResourceIdentityKindLabel(kindValue)} submissions require a URL or registry identifier.`,
    })
    return issues
  }

  const built = buildIdentityFromKind(kindValue, identifier)
  if (!built) {
    issues.push({
      path: 'resourceIdentity.identifier',
      message: `Could not parse that value as a valid identity of type: ${getResourceIdentityKindLabel(kindValue)}.`,
    })
    return issues
  }

  const companionWebsite = trimOptional(input.websiteUrl)
  if (companionWebsite) {
    const normalizedCompanion = ensureHttpsUrl(companionWebsite)
    if (!normalizedCompanion) {
      issues.push({
        path: 'resourceIdentity.websiteUrl',
        message: 'Optional website URL must be a valid http(s) URL.',
      })
    } else {
      built.websiteUrl = normalizedCompanion
    }
  }

  for (const issue of validateResourceIdentity(built, built.websiteUrl)) {
    issues.push(issue)
  }

  return issues
}

export const normalizeResourceSubmissionIdentity = (
  input: ResourceSubmissionIdentityInput,
): NormalizedResourceSubmissionIdentity | null => {
  if (validateResourceSubmissionIdentityInput(input).length > 0) {
    return null
  }

  if (!isResourceIdentityKind(input.kind)) {
    return null
  }

  const identifier = trimOptional(input.identifier)
  if (!identifier) {
    return null
  }

  const built = buildIdentityFromKind(input.kind, identifier)
  if (!built) {
    return null
  }

  const companionWebsite = trimOptional(input.websiteUrl)
  if (companionWebsite) {
    const normalizedCompanion = ensureHttpsUrl(companionWebsite)
    if (normalizedCompanion) {
      built.websiteUrl = normalizedCompanion
    }
  }

  const resolved = resolveResourceIdentity({
    resourceIdentity: built,
    website: built.websiteUrl,
  })
  if (!resolved) {
    return null
  }

  return {
    ...resolved, primaryUrl: resolved.canonicalUrl,
    ...(resolved.websiteUrl && resolved.kind !== 'website' ? { companionWebsiteUrl: resolved.websiteUrl } : undefined)
  }
}

/**
 * Stable duplicate key for Resource Identity submissions.
 * Website-first identities reuse the existing website identity key.
 * Registry-backed identities prefer `kind:registryId`.
 * A canonical URL that is itself a registry or GitHub repository page resolves
 * to that registry key so a website-first listing collides with the matching
 * registry-first listing for the same resource.
 */
const registryDuplicateKinds = new Set<ResourceIdentityKind>([
  'npm_package',
  'pypi_project',
  'crates_package',
  'jsr_package',
  'go_module',
  'mcp_registry_server',
  'container_image',
])

const registryIdentityFromUrl = (
  canonicalUrl: string | null | undefined,
): {kind: ResourceIdentityKind; registryId: string} | null => {
  if (!isRuntimeString(canonicalUrl)) {
    return null
  }
  const trimmed = canonicalUrl.trim()
  const gitlab = parseGitlabRepositoryUrl(trimmed)
  if (gitlab) return {kind: 'gitlab_repository', registryId: gitlab.toLowerCase()}

  const github = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s#?]+)\/([^/\s#?]+)\/?(?:[?#].*)?$/i,
  )
  if (github) {
    const owner = github[1]?.toLowerCase()
    const repo = github[2]?.replace(/\.git$/i, '').toLowerCase()
    if (owner && repo && owner !== '.' && repo !== '.') {
      return {kind: 'github_repository', registryId: `${owner}/${repo}`}
    }
    return null
  }

  const npm = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?npmjs\.com\/package\/(@?[^/\s#?]+(?:\/[^/\s#?]+)?)\/?(?:[?#].*)?$/i,
  )
  if (npm?.[1]) {
    return {kind: 'npm_package', registryId: npm[1].toLowerCase()}
  }

  const pypi = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?pypi\.org\/project\/([^/\s#?]+)\/?(?:[?#].*)?$/i,
  )
  if (pypi?.[1]) {
    return {kind: 'pypi_project', registryId: pypi[1].toLowerCase().replace(/[-_.]+/g, '-')}
  }

  const crates = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?crates\.io\/crates\/([^/\s#?]+)\/?(?:[?#].*)?$/i,
  )
  if (crates?.[1]) {
    return {kind: 'crates_package', registryId: crates[1].toLowerCase()}
  }

  const jsr = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?jsr\.io\/(@[^/\s#?]+\/[^/\s#?]+)\/?(?:[?#].*)?$/i,
  )
  if (jsr?.[1]) {
    const registryId = jsr[1].toLowerCase()
    if (/^@[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(registryId)) {
      return {kind: 'jsr_package', registryId: registryId}
    }
    return null
  }

  const goModule = trimmed.match(
    /^(?:https?:\/\/)?pkg\.go\.dev\/([^\s?#]+?)\/?(?:[?#].*)?$/i,
  )
  if (goModule?.[1]) {
    const registryId = goModule[1]
    return isCanonicalGoModulePath(registryId)
      ? {kind: 'go_module', registryId: registryId.toLowerCase()}
      : null
  }

  const mcp = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?registry\.modelcontextprotocol\.io\/(?:v0(?:\.\d+)?\/)?servers\/([^/\s#?]+)\/?(?:[?#].*)?$/i,
  )
  if (mcp?.[1]) {
    try {
      const registryId = decodeURIComponent(mcp[1]).trim().toLowerCase()
      if (registryId && !/\s/.test(registryId)) {
        return {kind: 'mcp_registry_server', registryId: registryId}
      }
    } catch {
      return null
    }
    return null
  }

  return null
}

/** Recognize native registry roots with the same URL policy used for duplicate keys. */
export const inferResourceSubmissionIdentity = (
  sourceUrl: string,
  pageKind: 'website' | 'docs_site' = 'website',
): NormalizedResourceSubmissionIdentity | null => {
  if (!validatePublicHttpUrl(sourceUrl).success) return null
  const native = registryIdentityFromUrl(sourceUrl)
  const nativeUrl = new URL(sourceUrl)
  nativeUrl.search = ''
  nativeUrl.hash = ''
  return normalizeResourceSubmissionIdentity({
    kind: native?.kind ?? pageKind,
    identifier: native ? nativeUrl.href : sourceUrl,
  })
}

// Container tags version a single image identity; duplicates key on the tag-free reference.
// Docker Hub's reserved `library/` namespace aliases official images to their bare name.
const containerImageDuplicateKey = (registryId: string): string | null => {
  const parsed = parseContainerImageReference(registryId)
  if (!parsed) {
    return null
  }
  const name =
    parsed.source === 'docker_hub' && parsed.name.startsWith('library/')
      ? parsed.name.slice('library/'.length)
      : parsed.name
  return `container_image:${parsed.registryHost ? `${parsed.registryHost}/` : parsed.source === 'ghcr' ? 'ghcr.io/' : ''}${name}`
}

export const getResourceIdentityDuplicateKey = (input: {
  resourceIdentity?: ResourceIdentityInput | null
  website?: string | null
}): string | null => {
  const inputKind = input.resourceIdentity?.kind
  const inputRegistryId = trimOptional(input.resourceIdentity?.registryId)
  if (
    isResourceIdentityKind(inputKind) &&
    registryDuplicateKinds.has(inputKind) &&
    inputRegistryId
  ) {
    if (inputKind === 'container_image') {
      const containerKey = containerImageDuplicateKey(inputRegistryId)
      if (containerKey) {
        return containerKey
      }
    }
    return `${inputKind}:${inputRegistryId.toLowerCase()}`
  }

  const resolved = resolveResourceIdentity(input)
  if (!resolved) {
    return null
  }

  const native = registryIdentityFromUrl(resolved.canonicalUrl)
  if (native) {
    return `${native.kind}:${native.registryId}`
  }

  if (resolved.kind === 'website') {
    return getToolWebsiteIdentityKey(resolved.canonicalUrl)
  }

  if (resolved.registryId) {
    if (resolved.kind === 'container_image') {
      const containerKey = containerImageDuplicateKey(resolved.registryId)
      if (containerKey) {
        return containerKey
      }
    }
    return `${resolved.kind}:${resolved.registryId.toLowerCase()}`
  }

  const urlKey = getToolWebsiteIdentityKey(resolved.canonicalUrl)
  return urlKey ? `${resolved.kind}:${urlKey}` : null
}

export const getResourceSubmissionDuplicateKey = (
  input: ResourceSubmissionIdentityInput,
): string | null => {
  const normalized = normalizeResourceSubmissionIdentity(input)
  if (!normalized) {
    return null
  }

  return getResourceIdentityDuplicateKey({
    resourceIdentity: normalized,
    website: normalized.kind === 'website' ? normalized.canonicalUrl : normalized.websiteUrl,
  })
}

export const getResourceIdentityHostHint = (input: {
  resourceIdentity?: ResourceIdentityInput | null
  website?: string | null
}): string | null => {
  const resolved = resolveResourceIdentity(input)
  if (!resolved) {
    return null
  }

  return getToolWebsiteHost(resolved.canonicalUrl)
}

export const toSanityResourceIdentityObject = (
  identity: NormalizedResourceSubmissionIdentity,
): ResourceIdentityInput => {
  const {
    kind,
    canonicalUrl,
    registryId,
    websiteUrl,
    repositoryUrl,
    docsUrl,
    packageUrl,
    mcpRegistryUrl,
  } = identity

  return {
    kind, canonicalUrl,
    ...(registryId ? { registryId } : undefined),
    ...(websiteUrl ? { websiteUrl } : undefined),
    ...(repositoryUrl ? { repositoryUrl } : undefined),
    ...(docsUrl ? { docsUrl } : undefined),
    ...(packageUrl ? { packageUrl } : undefined),
    ...(mcpRegistryUrl ? { mcpRegistryUrl } : undefined)
  }
}
