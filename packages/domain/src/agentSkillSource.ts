import {normalizePublicAgentInterfaces, type AgentInterfaceInput, type PublicAgentInterface} from './agentInterface.js'
import {resolveResourceIdentity, type ResourceIdentityInput} from './resourceIdentity.js'
import {isValidGithubRepositoryId, parseGithubRepositoryId} from './registryEnrichment.js'
import {normalizePublicSourceReferences, normalizePublicSourceReferenceUrl, type SourceReferenceInput} from './sourceReference.js'

/** A specific GitHub skill folder and its original Markdown file. */
export interface AgentSkillSource {
  fileUrl: string
  directoryUrl: string
  installCommand: string
}

/** Accept explicit skill paths; a repository alone does not identify a skill. */
export function resolveAgentSkillSource(value: string | null | undefined): AgentSkillSource | null {
  if (!value || !URL.canParse(value)) return null
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return null
  const parts = url.pathname.split('/').filter(Boolean)
  // Restrict interpolated command arguments to shell-safe GitHub path segments.
  if (parts.some((part) => !/^[\w.-]+$/.test(part) || part === '.' || part === '..')) return null
  let owner: string
  let repository: string
  let ref: string
  let path: string[]
  if (url.hostname === 'raw.githubusercontent.com' && parts.length >= 4 && parts.at(-1) === 'SKILL.md') {
    [owner, repository, ref, ...path] = parts
    path.pop()
  } else if (url.hostname === 'github.com' && parts.length >= 4 && ['tree', 'blob'].includes(parts[2])) {
    [owner, repository, , ref, ...path] = parts
    if (parts[2] === 'blob' && path.at(-1) !== 'SKILL.md') return null
    if (path.at(-1) === 'SKILL.md') path.pop()
    else if (path.length === 0) return null
  } else return null
  const directoryUrl = `https://github.com/${owner}/${repository}/tree/${ref}${path.length ? `/${path.join('/')}` : ''}`
  return {
    directoryUrl,
    fileUrl: `https://raw.githubusercontent.com/${owner}/${repository}/${ref}/${[...path, 'SKILL.md'].join('/')}`,
    installCommand: `npx skills@latest add ${directoryUrl}`,
  }
}

export interface ToolAgentSkillInput {
  resourceKind?: string | null
  agentInterfaces?: AgentInterfaceInput[] | null
  sourceReferences?: SourceReferenceInput[] | null
  resourceIdentity?: ResourceIdentityInput | null
  website?: string | null
}

/** Keep each skill's source and command together across the page and agent clients. */
export function resolveToolAgentSkills(
  input: ToolAgentSkillInput,
  interfaces = normalizePublicAgentInterfaces(input.agentInterfaces, {sourceReferences: input.sourceReferences}),
): PublicAgentInterface[] {
  const skills = interfaces
    .filter((entry) => entry.kind === 'agent_skill')
  const fallbackUrls = [
    ...normalizePublicSourceReferences(input.sourceReferences).map((entry) => entry.url),
    input.resourceIdentity?.canonicalUrl,
    input.website,
  ].map((url) => normalizePublicSourceReferenceUrl(url))
  const identity = resolveResourceIdentity(input)
  const identityRepository = identity?.kind === 'github_repository' ? parseGithubRepositoryId(identity) : null
  const identityRepositoryUrl = identityRepository ? `https://github.com/${identityRepository}` : undefined
  const fallbackUrl = fallbackUrls.find((url) => resolveAgentSkillSource(url))
    ?? fallbackUrls.find((url) => url) ?? identityRepositoryUrl

  const hasRetiredSkill = input.agentInterfaces?.some((entry) => entry.kind === 'agent_skill' && entry.status === 'deprecated')
  if (skills.length === 0 && !hasRetiredSkill && input.resourceKind === 'agent_skill' && fallbackUrl) {
    skills.push({kind: 'agent_skill', status: 'unknown', label: 'Agent skill', docsUrl: fallbackUrl})
  }
  const primary = skills.find((entry) => entry.status !== 'deprecated')
  return skills.map((entry) => {
    if (entry.status === 'deprecated') {
      const retired = {...entry}
      delete retired.installCommand
      return retired
    }
    // Tool-level metadata can fill a missing primary source, never replace a
    // different authored source or supply another interface's command.
    const repository = entry.source === 'github' && entry.identifier &&
      entry.identifier.split('/').length === 2 && !/\.git$/i.test(entry.identifier) &&
      isValidGithubRepositoryId(entry.identifier) ? entry.identifier : undefined
    const repositoryUrl = repository ? `https://github.com/${repository}` : undefined
    const docsUrl = entry.docsUrl ?? repositoryUrl ?? (entry === primary && input.resourceKind === 'agent_skill' ? fallbackUrl : undefined)
    const fallbackRepository = repository ?? (
      entry === primary && input.resourceKind === 'agent_skill' && !entry.identifier &&
      docsUrl?.replace(/\/$/, '') === identityRepositoryUrl ? identityRepository : undefined
    )
    const shorthand = fallbackRepository && docsUrl?.replace(/\/$/, '') === `https://github.com/${fallbackRepository}`
      ? `npx skills@latest add ${fallbackRepository}` : undefined
    const installCommand = entry.installCommand ?? resolveAgentSkillSource(docsUrl)?.installCommand ?? shorthand
    const skill = {...entry}
    if (docsUrl) skill.docsUrl = docsUrl
    if (installCommand) skill.installCommand = installCommand
    return skill
  })
}
