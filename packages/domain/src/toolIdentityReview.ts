import {parseContainerImageReference} from './containerImage.js'
import {normalizeMcpRegistryObservation} from './mcpRegistry.js'
import {isRuntimeString} from './runtimeValidation.js'
import {z} from 'zod'
import {REGISTRY_ENRICHMENT_SOURCE_VALUES, getRegistryResourceIdentityKey} from './registryEnrichmentSource.js'
import {inferResourceSubmissionIdentity, normalizeResourceSubmissionIdentity} from './resourceSubmissionIdentity.js'
import type {JsonValue} from './jsonValue.js'
import type {ResourceIdentityInput} from './resourceIdentity.js'
import {normalizePublicMetadataUrl} from './publicMetadata.js'

export const excludedRegistryIdentitySchema = z.object({
  source: z.enum(REGISTRY_ENRICHMENT_SOURCE_VALUES),
  identifier: z.string().trim().min(1),
  sourceUrl: z.string().refine(value => Boolean(normalizePublicMetadataUrl(value)), 'Use a safe public evidence URL.'),
  checkedAt: z.iso.datetime({offset: true}),
})
export type ExcludedRegistryIdentity = z.infer<typeof excludedRegistryIdentitySchema>
const identitySources = {
  github_repository: 'github', gitlab_repository: 'gitlab', npm_package: 'npm',
  pypi_project: 'pypi', crates_package: 'crates', mcp_registry_server: 'mcp_registry',
} as const

export interface RegistryIdentityAttachment {
  _key?: string | null
  kind?: string | null
  status?: string | null
  mcpRegistryObservation?: JsonValue
  source?: string | null
  identifier?: string | null
  docsUrl?: string | null
  installCommand?: string | null
}
export function validateExcludedRegistryIdentities(excluded: readonly ExcludedRegistryIdentity[], identity?: ResourceIdentityInput | null, interfaces?: readonly (RegistryIdentityAttachment | null)[] | null): true | string {
  if (!excluded.length) return true
  const attached: {source: string; identifier: string}[] = (interfaces ?? []).flatMap(row => row?.source && row.identifier ? [{source: row.source, identifier: row.identifier}] : [])
  for (const row of interfaces ?? []) {
    const packages = normalizeMcpRegistryObservation(row?.mcpRegistryObservation ?? null)?.packages ?? []
    attached.push(...packages.map(item => ({source: item.registryType, identifier: item.identifier})))
  }
  const linkedIdentities = [identity?.canonicalUrl, identity?.repositoryUrl, identity?.packageUrl, identity?.mcpRegistryUrl].flatMap(url => {
    const linked = url ? inferResourceSubmissionIdentity(url) : null
    return linked ? [linked] : []
  })
  const registryUrl = identity?.kind === 'mcp_registry_server' ? identity.mcpRegistryUrl
    : identity?.kind === 'github_repository' || identity?.kind === 'gitlab_repository' ? identity.repositoryUrl
      : identity?.packageUrl
  const primary = identity ? normalizeResourceSubmissionIdentity({kind: identity.kind, identifier: identity.registryId ?? registryUrl ?? identity.canonicalUrl}) ?? identity : identity
  for (const candidate of [primary, ...linkedIdentities]) {
    const kind = candidate?.kind
    if (isRuntimeString(kind) && kind in identitySources && candidate?.registryId) {
      // SAFETY: membership in the closed identitySources map establishes this key.
      attached.push({source: identitySources[kind as keyof typeof identitySources], identifier: candidate.registryId})
    }
  }
  const keys = new Set(excluded.map(row => getRegistryResourceIdentityKey(row.source, row.identifier)))
  for (const row of attached) {
    const source = z.enum(REGISTRY_ENRICHMENT_SOURCE_VALUES).safeParse(row.source)
    if (source.success && keys.has(getRegistryResourceIdentityKey(source.data, row.identifier))) return `Not this tool: ${row.source} ${row.identifier} is recorded as an unrelated registry identity. Remove the attachment or correct the reviewed exclusion.`
  }
  return true
}

export interface DistributionIdentityTool {
  _id?: string
  name?: string | null
  slug?: string | null
  resourceIdentity?: {repositoryUrl?: string | null; canonicalUrl?: string | null} | null
}
export interface DistributionParent {
  toolId: string
  name: string
  slug: string
  reason: 'repository_match' | 'distribution_suffix'
}
function repositoryKey(tool: DistributionIdentityTool): string | undefined {
  const value = tool.resourceIdentity?.repositoryUrl ?? tool.resourceIdentity?.canonicalUrl
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (!['github.com', 'www.github.com', 'gitlab.com', 'www.gitlab.com'].includes(url.hostname)) return undefined
    const path = url.pathname.replace(/\.git\/?$/i, '').replace(/\/$/, '')
    if (path.split('/').filter(Boolean).length < 2) return undefined
    return `${url.hostname.replace(/^www\./, '')}${path}`.toLowerCase()
  } catch {return undefined}
}
export function findDistributionParents(tool: DistributionIdentityTool, catalog: readonly DistributionIdentityTool[]): DistributionParent[] {
  const id = tool._id?.replace(/^drafts\./, '')
  const repository = repositoryKey(tool)
  const slug = tool.slug?.toLowerCase()
  return catalog.flatMap(parent => {
    if (!parent._id || parent._id.startsWith('drafts.') || parent._id.startsWith('versions.') || !parent.slug || parent._id === id) return []
    const sameRepository = repository && repository === repositoryKey(parent)
    const suffix = slug && ['container', 'docker', 'image', 'npm', 'cli'].some(value => slug === `${parent.slug?.toLowerCase()}-${value}`)
    return sameRepository || suffix ? [{toolId: parent._id.replace(/^drafts\./, ''), name: parent.name || parent.slug, slug: parent.slug, reason: sameRepository ? 'repository_match' as const : 'distribution_suffix' as const}] : []
  }).filter((parent, index, rows) => rows.findIndex(row => row.toolId === parent.toolId) === index)
}

export function normalizeExcludedRegistryIdentities(value: JsonValue | undefined): ExcludedRegistryIdentity[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(row => {
    const parsed = excludedRegistryIdentitySchema.safeParse(row)
    return parsed.success ? [parsed.data] : []
  })
}

// GROQ selects a superset of canonical repository equivalents. The domain URL
// parser above remains authoritative, so a coarse candidate key cannot itself
// produce a parent warning (for example for a repository containing ".git").
const repositoryCandidateKeyProjection = (field: string): string => {
  const authorityAndPath = `string::split(lower(${field}), "://")[1]`
  const withoutQuery = `string::split(string::split(${authorityAndPath}, "?")[0], "#")[0]`
  const withoutWww = `array::join(string::split(${withoutQuery}, "www."), "")`
  const withoutGit = `string::split(${withoutWww}, ".git")[0]`
  return `array::join(string::split(${withoutGit}, "/")[@ != ""], "/")`
}
const parentRepository = 'coalesce(resourceIdentity.repositoryUrl, resourceIdentity.canonicalUrl)'
export const getDistributionRepositoryCandidateFilter = (subjectRepository: string): string => `
  defined(${parentRepository}) && defined(${subjectRepository}) &&
  ${repositoryCandidateKeyProjection(parentRepository)} == ${repositoryCandidateKeyProjection(subjectRepository)}
`
const subjectRepository = 'coalesce(^.resourceIdentity.repositoryUrl, ^.resourceIdentity.canonicalUrl)'
export const DISTRIBUTION_PARENT_CANDIDATES_PROJECTION = `"possibleParentTools": *[
  _type == "tool" && !(_id in path("drafts.**")) && _id != string::split(^._id, "drafts.")[-1] &&
  (defined(slug.current) && (
    ^.slug.current in [slug.current + "-container", slug.current + "-docker", slug.current + "-image", slug.current + "-npm", slug.current + "-cli"] ||
    (${getDistributionRepositoryCandidateFilter(subjectRepository)})
  ))
]{_id, name, "slug": slug.current, resourceIdentity{repositoryUrl, canonicalUrl}}`

/** Container tags belong to a release, rather than the distribution's name. */
export function getDistributionCandidateSlug(identity: ResourceIdentityInput, fallback?: string): string | undefined {
  if (identity.kind === 'container_image') {
    const image = parseContainerImageReference(identity.registryId ?? identity.packageUrl ?? identity.canonicalUrl)
    return image?.name.split('/').at(-1)
  }
  return identity.registryId?.split('/').at(-1) ?? fallback
}
