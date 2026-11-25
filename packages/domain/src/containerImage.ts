import {isRuntimeString} from './runtimeValidation.js'
import {validatePublicHttpUrl} from './urlSafety.js'
import type {JsonValue} from './jsonValue.js'
import type {AgentInterfaceSource} from './agentInterface.js'

// Retains the existing catalog identifier envelope; Studio reports this limit explicitly.
export const MAX_CONTAINER_IMAGE_REFERENCE_LENGTH = 160

export type ContainerImageRegistrySource = 'docker_hub' | 'ghcr' | 'container_registry'

export interface ContainerImageReference {
  source: ContainerImageRegistrySource
  /** Registry-relative image path such as `namespace/name`, without host or tag. */
  name: string
  tag?: string
  /** Canonical `docker pull` reference including the registry host when required. */
  pullRef: string
  /** Whether the input carried an explicit registry host. */
  explicitHost: boolean
  registryHost?: string
}

// OCI distribution grammar: lowercase name components joined by `/`, optional `:tag`.
// https://github.com/distribution/reference/blob/main/regexp.go: separator.
const NAME_COMPONENT = '[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*'
const NAME_PATTERN = new RegExp(`^${NAME_COMPONENT}(?:/${NAME_COMPONENT})*$`)
const TAG_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/
const GHCR_HOST = 'ghcr.io'
const DOCKER_HOSTS = new Set(['docker.io', 'index.docker.io', 'registry-1.docker.io'])

const looksLikeRegistryHost = (component: string): boolean =>
  component.includes('.') || component.includes(':') || component === 'localhost'

// DNS label syntax (RFC 1123), with an optional TCP port. IP literals and
// single-label/internal hosts are not public registry hostnames for the catalog.
const PUBLIC_REGISTRY_HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?(?::[0-9]+)?$/

const isPublicRegistryHost = (host: string): boolean => {
  if (!PUBLIC_REGISTRY_HOST.test(host)) return false
  const hostname = host.split(':')[0]
  if (!hostname || hostname === GHCR_HOST || DOCKER_HOSTS.has(hostname)) return false
  // RFC 1035 section 2.3.4: each ASCII DNS label is at most 63 octets.
  if (hostname.split('.').some((label) => label.length > 63)) return false
  const port = host.split(':')[1]
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) return false
  return validatePublicHttpUrl(`https://${host}/`).success
}

export const parseContainerImageReference = (
  value: JsonValue,
): ContainerImageReference | null => {
  if (!isRuntimeString(value)) return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_CONTAINER_IMAGE_REFERENCE_LENGTH || /[^\x21-\x7e]/.test(trimmed)) return null
  if (trimmed.includes('@')) return null

  const slashIndex = trimmed.indexOf('/')
  const firstComponent = slashIndex === -1 ? trimmed : trimmed.slice(0, slashIndex)
  let source: ContainerImageRegistrySource = 'docker_hub'
  let explicitHost = false
  let registryHost: string | undefined
  let rest = trimmed

  if (slashIndex !== -1 && looksLikeRegistryHost(firstComponent)) {
    const host = firstComponent.toLowerCase()
    if (host === GHCR_HOST) {
      source = 'ghcr'
    } else if (!DOCKER_HOSTS.has(host)) {
      if (!isPublicRegistryHost(host)) return null
      source = 'container_registry'
      registryHost = host
    }
    explicitHost = true
    rest = trimmed.slice(slashIndex + 1)
  }

  const tagIndex = rest.lastIndexOf(':')
  const name = tagIndex === -1 ? rest : rest.slice(0, tagIndex)
  const tag = tagIndex === -1 ? undefined : rest.slice(tagIndex + 1)

  if (!NAME_PATTERN.test(name)) return null
  if (tag !== undefined && !TAG_PATTERN.test(tag)) return null
  if (source === 'ghcr' && !name.includes('/')) return null

  const pullRef =
    source === 'docker_hub' ? `${name}${tag ? `:${tag}` : ''}`
      : `${registryHost ?? GHCR_HOST}/${name}${tag ? `:${tag}` : ''}`

  return {source, name, ...(tag ? {tag} : undefined), pullRef, explicitHost, ...(registryHost ? {registryHost} : undefined)}
}

export const isValidContainerImageReference = (value: JsonValue): boolean =>
  parseContainerImageReference(value) !== null

export const isContainerImageSource = (
  value: string | undefined,
): value is ContainerImageRegistrySource => value === 'docker_hub' || value === 'ghcr' || value === 'container_registry'

/**
 * Resolve the canonical `docker pull` reference for an interface identifier.
 * GHCR identifiers may omit the host; generic registries require their full host.
 * Docker Hub accepts its own explicit hosts and omits them from the pull ref.
 */
export const containerImagePullRef = (
  identifier: string | undefined,
  source: AgentInterfaceSource | undefined,
): string | null => {
  const parsed = parseContainerImageReference(identifier)
  if (!parsed || !isContainerImageSource(source)) return null
  if (source === 'container_registry') return parsed.source === source ? parsed.pullRef : null
  if (source === 'docker_hub') return parsed.source === 'docker_hub' ? parsed.pullRef : null
  if (parsed.source === 'ghcr') return parsed.pullRef
  return parsed.explicitHost
    ? null
    : `${GHCR_HOST}/${parsed.name}${parsed.tag ? `:${parsed.tag}` : ''}`
}

// Docker Hub serves official images under the reserved `library/` namespace.
const dockerHubCanonicalName = (name: string): string =>
  name.startsWith('library/') ? name.slice('library/'.length) : name

export const containerImageCanonicalUrl = (value: JsonValue): string | null => {
  const parsed = parseContainerImageReference(value)
  if (!parsed) return null
  if (parsed.source === 'container_registry') return null
  if (parsed.source === 'ghcr') return `https://ghcr.io/${parsed.name}`
  const canonicalName = dockerHubCanonicalName(parsed.name)
  return `https://hub.docker.com/${canonicalName.includes('/') ? 'r' : '_'}/${canonicalName}`
}
