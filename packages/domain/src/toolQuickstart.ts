import {
  getAgentInterfaceKindLabel,
  getAgentInterfaceSourceLabel,
  getAgentInterfaceStatusLabel,
  isValidJsrPackageName,
  isValidNpmPackageName,
  isValidPypiProjectName,
  isValidCratesPackageName,
  MAX_PUBLIC_AGENT_INTERFACES,
  normalizePublicAgentInterfaces,
  type AgentInterfaceKind,
  type AgentInterfaceSource,
  type AgentInterfaceStatus,
} from './agentInterface.js'
import {resolveResourceIdentity} from './resourceIdentity.js'
import {normalizePublicMetadataUrl} from './publicMetadata.js'
import type {PublishedToolResourceLinkSource} from './publishedToolProfile.js'
import {validatePublicHttpUrl} from './urlSafety.js'
import {normalizePypiProjectName} from './packageNames.js'
import {
  containerImagePullRef,
  isContainerImageSource,
  parseContainerImageReference,
} from './containerImage.js'
import type {JsonValue} from './jsonValue.js'
import {resolveToolAgentSkills, type ToolAgentSkillInput} from './agentSkillSource.js'
import {
  buildRepositoryObservationNotice,
  normalizeRepositoryObservation,
} from './repositoryObservation.js'
import {normalizeMcpRegistryObservation} from './mcpRegistry.js'
import type {McpRegistryPackage} from './mcpRegistryPackages.js'

export const TOOL_QUICKSTART_KIND_VALUES = [
  'install_command',
  'clone_repository',
  'mcp_setup',
  'open_docs',
] as const

export type ToolQuickstartKind = (typeof TOOL_QUICKSTART_KIND_VALUES)[number]

export const TOOL_QUICKSTART_COMMAND_LANGUAGE_VALUES = ['shell', 'yaml'] as const

export type ToolQuickstartCommandLanguage =
  (typeof TOOL_QUICKSTART_COMMAND_LANGUAGE_VALUES)[number]

export interface PublicToolQuickstart {
  kind: ToolQuickstartKind
  label: string
  status: AgentInterfaceStatus
  statusLabel: string
  command?: string
  commandLanguage?: ToolQuickstartCommandLanguage
  docsUrl?: string
  source?: AgentInterfaceSource
  sourceLabel?: string
  /** Observed provider state worth surfacing before a visitor runs the step. */
  notice?: string
}

export interface ToolQuickstartInput extends ToolAgentSkillInput {
  name?: string | null
  resourceLinks?: ReadonlyArray<PublishedToolResourceLinkSource | null> | null
  /** Raw stored `repositoryObservation` field; parsed at this boundary. */
  repositoryObservation?: JsonValue
}

const hasPublicHttpUrl = (value: string | undefined): value is string => {
  if (!value) {
    return false
  }

  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const addUniqueQuickstart = (
  quickstarts: Map<string, PublicToolQuickstart>,
  quickstart: PublicToolQuickstart,
): void => {
  // Several interfaces can describe the same action. Internal whitespace can
  // be significant in code, so only normalize line endings and outer space.
  const signature = quickstart.command
    ? JSON.stringify(['command', quickstart.commandLanguage ?? 'shell', quickstart.command.replace(/\r\n/g, '\n').trim()])
    : JSON.stringify(['docs', quickstart.docsUrl ?? ''])

  const existing = quickstarts.get(signature)
  if (existing) {
    const preferred = existing.status === 'deprecated' && quickstart.status !== 'deprecated'
      ? quickstart : existing
    const other = preferred === existing ? quickstart : existing
    quickstarts.set(signature, {
      ...preferred,
      docsUrl: preferred.docsUrl ?? other.docsUrl,
      notice: [...new Set([preferred.notice, other.notice].filter(Boolean))].join('\n\n') || undefined,
    })
    return
  }

  quickstarts.set(signature, quickstart)
}

const buildStatus = (status: AgentInterfaceStatus) => ({
  status,
  statusLabel: getAgentInterfaceStatusLabel(status),
})

const buildSource = (source: AgentInterfaceSource | undefined) =>
  source
    ? {
        source,
        sourceLabel: getAgentInterfaceSourceLabel(source),
      }
    : {}

// JSR packages install through both Deno and the JSR CLI. The same two cards
// serve jsr_package identities and jsr Agent Interface rows; sharing one
// builder keeps their signatures identical, so a Tool that lists both never
// renders the same command twice.
const buildJsrInstallQuickstarts = (
  registryId: string,
  docsUrl: string | undefined,
  status: AgentInterfaceStatus,
): PublicToolQuickstart[] => [
  {
    kind: 'install_command',
    label: 'Install with Deno',
    command: `deno add jsr:${registryId}`,
    commandLanguage: 'shell',
    ...(docsUrl ? {docsUrl} : undefined),
    ...buildSource('jsr'),
    ...buildStatus(status),
  },
  {
    kind: 'install_command',
    label: 'Install with JSR CLI',
    command: `npx jsr@latest add ${registryId}`,
    commandLanguage: 'shell',
    ...(docsUrl ? {docsUrl} : undefined),
    ...buildSource('jsr'),
    ...buildStatus(status),
  },
]

/**
 * Registry sources with a canonical install command derived from the identifier when the
 * editor left installCommand empty. Normalization has already validated the identifier
 * grammar, so these formatters only interpolate.
 */
const PACKAGE_INSTALL_COMMANDS = {
  npm: (identifier: string) => `npm install ${identifier}`,
  pypi: (identifier: string) => `pip install ${identifier}`,
}

const DERIVED_INSTALL_COMMANDS = new Map<
  AgentInterfaceSource,
  (identifier: string, kind: AgentInterfaceKind) => string
>([
  ['npm', PACKAGE_INSTALL_COMMANDS.npm],
  ['pypi', PACKAGE_INSTALL_COMMANDS.pypi],
  ['homebrew', (identifier) => `brew install ${identifier}`],
  ['homebrew_cask', (identifier) => `brew install --cask ${identifier}`],
  ['packagist', (identifier) => `composer require ${identifier}`],
  // Cargo installs executable interfaces; libraries become project dependencies.
  ['crates', (identifier, kind) =>
    kind === 'cli' || kind === 'mcp_server'
      ? `cargo install ${identifier}`
      : `cargo add ${identifier}`],
  ['rubygems', (identifier) => `gem install ${identifier}`],
  // nuget.org ships libraries and global tools; cli and MCP entries install
  // through `dotnet tool install -g`, not a project reference.
  ['nuget', (identifier, kind) =>
    kind === 'cli' || kind === 'mcp_server'
      ? `dotnet tool install -g ${identifier}`
      : `dotnet add package ${identifier}`],
  ['vscode_marketplace', (identifier) => `code --install-extension ${identifier}`],
  // Open VSX is the default registry for VSCodium (`codium --install-extension`)
  // — `code --install-extension` would resolve against the Microsoft
  // Marketplace, which is a different publisher namespace.
  ['open_vsx', (identifier) => `codium --install-extension ${identifier}`],
  ['winget', (identifier) => `winget install --id ${identifier} -e`],
  ['scoop', (identifier) => `scoop install ${identifier}`],
  // `choco install` without `-y` stays interactive by default; the id
  // grammar is locked, so no unattended flag is needed for safety.
  ['chocolatey', (identifier) => `choco install ${identifier}`],
  // The Chrome Web Store has no CLI install; its listing is docs, derived at
  // interface normalization — not a shell command.
  // GitHub Actions "install" is a workflow `uses:` line. The ref stays absent
  // on purpose — pinning is an authored choice, so the card carries a notice
  // instead of an invented version.
  ['github_actions', (identifier) => `uses: ${identifier}`],
])

const buildRegistryPackageQuickstart = (
  entry: McpRegistryPackage,
  status: AgentInterfaceStatus,
  docsUrl: string,
): PublicToolQuickstart => ({
  kind: 'install_command',
  label: 'Install package',
  command: PACKAGE_INSTALL_COMMANDS[entry.registryType](entry.identifier),
  commandLanguage: 'shell',
  ...(hasPublicHttpUrl(docsUrl) ? {docsUrl} : undefined),
  ...buildSource(entry.registryType),
  ...buildStatus(status),
})

export const buildPublicToolQuickstarts = (
  input: ToolQuickstartInput,
): PublicToolQuickstart[] => {
  const quickstarts = new Map<string, PublicToolQuickstart>()
  const agentInterfaces = normalizePublicAgentInterfaces(input.agentInterfaces, {
    registryId: input.resourceIdentity?.registryId,
    mcpRegistryUrl: input.resourceIdentity?.mcpRegistryUrl,
  })
  const identity = resolveResourceIdentity({
    resourceIdentity: input.resourceIdentity,
    website: input.website,
  })
  const hasCurrentCliInterface = agentInterfaces.some(
    (agentInterface) =>
      agentInterface.kind === 'cli' && agentInterface.status !== 'deprecated' && !agentInterface.installCommand,
  )
  // One `npx` card per package name, no matter how many sources attest it.
  const authoredNpmPackages = new Set(agentInterfaces.flatMap((entry) =>
    entry.kind === 'cli' && entry.status !== 'deprecated' && entry.source === 'npm' &&
    entry.identifier && entry.installCommand ? [entry.identifier] : [],
  ))
  const emittedNpxPackages = new Set<string>()
  const addNpxQuickstart = (
    packageName: string,
    docsUrl: string | undefined,
    status: AgentInterfaceStatus,
  ): void => {
    if (authoredNpmPackages.has(packageName) || emittedNpxPackages.has(packageName)) {
      return
    }
    emittedNpxPackages.add(packageName)
    addUniqueQuickstart(quickstarts, {
      kind: 'install_command',
      label: 'Run with npx',
      // `@latest` makes npx fetch the registry package; a bare name runs whatever the
      // working directory has under that name first (upstream docs/runnable-commands.md).
      command: `npx ${packageName}@latest`,
      commandLanguage: 'shell',
      ...(docsUrl ? {docsUrl} : undefined),
      ...buildSource('npm'),
      ...buildStatus(status),
    })
  }
  // PyPI names differing only by case or punctuation identify one project.
  const authoredPypiPackages = new Set(agentInterfaces.flatMap((entry) =>
    entry.kind === 'cli' && entry.status !== 'deprecated' && entry.source === 'pypi' &&
    entry.identifier && entry.installCommand ? [normalizePypiProjectName(entry.identifier)] : [],
  ))
  const emittedPipxPackages = new Set<string>()
  const addPipxQuickstart = (
    packageName: string,
    docsUrl: string | undefined,
    status: AgentInterfaceStatus,
  ): void => {
    const key = normalizePypiProjectName(packageName)
    if (authoredPypiPackages.has(key) || emittedPipxPackages.has(key)) return
    emittedPipxPackages.add(key)
    addUniqueQuickstart(quickstarts, {
      kind: 'install_command',
      label: 'Install with pipx',
      command: `pipx install ${packageName}`,
      commandLanguage: 'shell',
      ...(docsUrl ? {docsUrl} : undefined),
      ...buildSource('pypi'),
      ...buildStatus(status),
    })
  }
  const skills = resolveToolAgentSkills(input, agentInterfaces)
  let skillIndex = 0
  const resolvedInterfaces = agentInterfaces.map((entry) =>
    entry.kind === 'agent_skill' ? skills[skillIndex++] : entry,
  )
  if (skillIndex === 0) resolvedInterfaces.push(...skills)

  const specQuickstarts: PublicToolQuickstart[] = []
  for (const agentInterface of resolvedInterfaces) {
    const docsUrl = (hasPublicHttpUrl(agentInterface.docsUrl) ? agentInterface.docsUrl : undefined) ??
      (agentInterface.kind === 'openapi_spec' ? normalizePublicMetadataUrl(agentInterface.identifier) : undefined)
    // Defer spec links so ordinary documentation wins same-URL deduplication in either row order.
    if (agentInterface.kind === 'openapi_spec' && (!agentInterface.installCommand || agentInterface.status === 'deprecated')) {
      if (docsUrl) specQuickstarts.push({
        kind: 'open_docs', label: 'Open OpenAPI spec', docsUrl,
        ...buildSource(agentInterface.source), ...buildStatus(agentInterface.status),
      })
      continue
    }

    // A deprecated registry entry is history, not current setup guidance.
    if (agentInterface.status === 'deprecated') {
      if (docsUrl) {
        addUniqueQuickstart(quickstarts, {
          kind: 'open_docs',
          label: `Open ${agentInterface.label} docs`,
          docsUrl,
          ...buildSource(agentInterface.source),
          ...buildStatus(agentInterface.status),
        })
      }
      continue
    }

    if (agentInterface.kind === 'desktop_app') {
      const osLabel = agentInterface.operatingSystem
        ? {macos: 'macOS', windows: 'Windows', linux: 'Linux'}[agentInterface.operatingSystem]
        : undefined
      // Desktop installers are explicitly authored; package dependency commands
      // and CLI setup derivations do not describe installing an application.
      if (agentInterface.installCommand) addUniqueQuickstart(quickstarts, {
        kind: 'install_command',
        label: `Install desktop app${osLabel ? ` for ${osLabel}` : ''}`,
        command: agentInterface.installCommand,
        commandLanguage: 'shell',
        ...(docsUrl ? {docsUrl} : undefined),
        ...buildSource(agentInterface.source), ...buildStatus(agentInterface.status),
      })
      if (agentInterface.downloadUrl) addUniqueQuickstart(quickstarts, {
        kind: 'open_docs',
        label: osLabel ? `Download for ${osLabel}` : 'Download desktop app',
        docsUrl: agentInterface.downloadUrl,
        ...buildSource(agentInterface.source), ...buildStatus(agentInterface.status),
      })
      if (!agentInterface.installCommand && !agentInterface.downloadUrl && docsUrl) addUniqueQuickstart(quickstarts, {
        kind: 'open_docs', label: 'Open desktop app docs', docsUrl,
        ...buildSource(agentInterface.source), ...buildStatus(agentInterface.status),
      })
      continue
    }

    if (!agentInterface.installCommand && isContainerImageSource(agentInterface.source)) {
      const pullRef = containerImagePullRef(agentInterface.identifier, agentInterface.source)
      if (pullRef) {
        addUniqueQuickstart(quickstarts, {
          kind: 'install_command',
          label: 'Pull image',
          command: `docker pull ${pullRef}`,
          commandLanguage: 'shell',
          ...(docsUrl ? {docsUrl} : undefined),
          ...buildSource(agentInterface.source),
          ...buildStatus(agentInterface.status),
        })
        if (agentInterface.kind === 'cli' || agentInterface.kind === 'mcp_server') {
          addUniqueQuickstart(quickstarts, {
            kind: agentInterface.kind === 'mcp_server' ? 'mcp_setup' : 'install_command',
            label:
              agentInterface.kind === 'mcp_server' ? 'Set up MCP server' : 'Run container image',
            command: `docker run --rm -i ${pullRef}`,
            commandLanguage: 'shell',
            ...buildSource(agentInterface.source),
            ...buildStatus(agentInterface.status),
          })
        }
        continue
      }
    }

    if (
      !agentInterface.installCommand &&
      agentInterface.source === 'jsr' &&
      agentInterface.identifier &&
      isValidJsrPackageName(agentInterface.identifier)
    ) {
      // The canonical package page keeps these cards signature-identical to
      // the jsr_package identity cards, so a Tool listing both dedupes.
      const jsrDocsUrl = `https://jsr.io/${agentInterface.identifier}`
      for (const quickstart of buildJsrInstallQuickstarts(
        agentInterface.identifier,
        jsrDocsUrl,
        agentInterface.status,
      )) {
        addUniqueQuickstart(quickstarts, quickstart)
      }
      continue
    }

    const derivedCommand =
      agentInterface.source &&
      agentInterface.identifier
        ? DERIVED_INSTALL_COMMANDS.get(agentInterface.source)?.(
            agentInterface.identifier,
            agentInterface.kind,
          )
        : undefined
    const command = agentInterface.installCommand ?? derivedCommand

    const kind =
      agentInterface.kind === 'mcp_server' && command
        ? 'mcp_setup'
        : command
          ? 'install_command'
          : 'open_docs'

    if (kind === 'open_docs' && !docsUrl) {
      continue
    }

    const label =
      kind === 'install_command' && agentInterface.source === 'github_actions'
        ? `Use ${agentInterface.label} in a workflow`
        : kind === 'mcp_setup'
          ? 'Set up MCP server'
          : kind === 'install_command'
            ? agentInterface.kind === 'agent_skill' ? 'Install skill' : `Install ${getAgentInterfaceKindLabel(agentInterface.kind)}`
            : `Open ${agentInterface.label} docs`

    // An authored `uses:` line pins its own ref; only the derived unpinned
    // snippet needs the warning.
    const notice =
      agentInterface.source === 'github_actions' &&
      !agentInterface.installCommand &&
      derivedCommand
        ? 'Pin a tag or commit SHA before trusting this action in a workflow.'
        : undefined

    addUniqueQuickstart(quickstarts, {
      kind, label, ...buildStatus(agentInterface.status),
      ...(command ? {
        command,
        commandLanguage: command.startsWith('uses: ') ? 'yaml' as const : 'shell' as const,
      } : undefined),
      ...(docsUrl ? { docsUrl } : undefined),
      ...(notice ? { notice } : undefined),
      ...buildSource(agentInterface.source)
    })

    // Offer isolated CLI installation beside the same derived pip command.
    if (
      agentInterface.kind === 'cli' &&
      agentInterface.source === 'pypi' &&
      agentInterface.identifier &&
      !agentInterface.installCommand &&
      command === `pip install ${agentInterface.identifier}`
    ) {
      addPipxQuickstart(agentInterface.identifier, docsUrl, agentInterface.status)
    }

    // `npm install` adds a project dependency; for a CLI the first successful
    // action is usually running the binary once via `npx`. Emit it only beside
    // an `npm install` card for this same validated identifier — an authored
    // command replaces it, and deprecated interfaces are not promoted.
    if (
      agentInterface.kind === 'cli' &&
      agentInterface.source === 'npm' &&
      agentInterface.identifier &&
      command === `npm install ${agentInterface.identifier}`
    ) {
      addNpxQuickstart(agentInterface.identifier, docsUrl, agentInterface.status)
    }
  }

  for (const entry of (input.agentInterfaces ?? []).slice(0, MAX_PUBLIC_AGENT_INTERFACES)) {
    if (entry.kind !== 'mcp_server' || entry.status === 'deprecated') continue
    const observation = normalizeMcpRegistryObservation(entry.mcpRegistryObservation)
    if (observation?.status !== 'active') continue
    for (const pkg of observation.packages ?? []) {
      const identityMatches = identity?.registryId === pkg.identifier &&
        identity.kind === (pkg.registryType === 'npm' ? 'npm_package' : 'pypi_project')
      const docsUrl = identityMatches
        ? identity.packageUrl ?? identity.canonicalUrl
        : pkg.registryType === 'npm'
          ? `https://www.npmjs.com/package/${pkg.identifier}`
          : `https://pypi.org/project/${pkg.identifier}/`
      addUniqueQuickstart(quickstarts, buildRegistryPackageQuickstart(
        pkg,
        entry.status === 'official' || entry.status === 'community' ? entry.status : 'unknown',
        docsUrl,
      ))
    }
  }

  if (identity?.kind === 'github_repository' || identity?.kind === 'gitlab_repository') {
    const repositoryUrl = identity.repositoryUrl ?? identity.canonicalUrl
    if (hasPublicHttpUrl(repositoryUrl)) {
      const notice = buildRepositoryObservationNotice(
        normalizeRepositoryObservation(input.repositoryObservation),
      )
      addUniqueQuickstart(quickstarts, {
        kind: 'clone_repository',
        label: 'Clone repository',
        command: `git clone ${repositoryUrl}`,
        commandLanguage: 'shell',
        docsUrl: repositoryUrl,
        ...buildStatus('official'),
        ...(notice ? {notice} : undefined),
      })
    }
  }

  if (identity?.kind === 'container_image' && identity.registryId) {
    const parsed = parseContainerImageReference(identity.registryId)
    if (parsed) {
      addUniqueQuickstart(quickstarts, {
        kind: 'install_command',
        label: 'Pull image',
        command: `docker pull ${parsed.pullRef}`,
        commandLanguage: 'shell',
        ...(hasPublicHttpUrl(identity.canonicalUrl) ? {docsUrl: identity.canonicalUrl} : undefined),
        ...buildSource(parsed.source),
        ...buildStatus('official'),
      })
    }
  }

  if (identity?.kind === 'jsr_package' && identity.registryId) {
    const jsrDocsUrl = identity.packageUrl ?? identity.canonicalUrl
    for (const quickstart of buildJsrInstallQuickstarts(
      identity.registryId,
      hasPublicHttpUrl(jsrDocsUrl) ? jsrDocsUrl : undefined,
      'official',
    )) {
      addUniqueQuickstart(quickstarts, quickstart)
    }
  }

  if (identity?.kind === 'npm_package' && isValidNpmPackageName(identity.registryId)) {
    addUniqueQuickstart(quickstarts, buildRegistryPackageQuickstart(
      {registryType: 'npm', identifier: identity.registryId},
      'official',
      identity.packageUrl ?? identity.canonicalUrl,
    ))
    if (hasCurrentCliInterface) {
      addNpxQuickstart(identity.registryId, identity.packageUrl ?? identity.canonicalUrl, 'official')
    }
  }

  const packageSource = identity?.kind === 'pypi_project' ? 'pypi'
    : identity?.kind === 'crates_package' ? 'crates' : undefined
  const packageId = input.resourceIdentity?.registryId
  if (identity && packageSource && (
    (packageSource === 'pypi' && isValidPypiProjectName(packageId)) ||
    (packageSource === 'crates' && isValidCratesPackageName(packageId))
  )) {
    const canonicalPackageId = packageSource === 'pypi' ? normalizePypiProjectName(packageId) : packageId
    const interfaces = resolvedInterfaces.filter((entry) =>
      entry.source === packageSource && entry.identifier &&
      (packageSource === 'pypi' ? normalizePypiProjectName(entry.identifier) : entry.identifier) === canonicalPackageId)
    // Matching interfaces already supply the authored or kind-specific action
    // (or deprecated docs). The identity must not add a conflicting command.
    if (interfaces.length === 0) {
      addUniqueQuickstart(quickstarts, {
        kind: 'install_command', label: 'Install package',
        command: packageSource === 'pypi' ? `pip install ${canonicalPackageId}` : `cargo add ${canonicalPackageId}`,
        commandLanguage: 'shell', docsUrl: identity.packageUrl ?? identity.canonicalUrl,
        ...buildSource(packageSource),
        ...buildStatus('official'),
      })
      if (packageSource === 'pypi' && hasCurrentCliInterface) {
        addPipxQuickstart(canonicalPackageId, identity.packageUrl ?? identity.canonicalUrl, 'official')
      }
    }
  }

  if (identity?.kind === 'docs_site') {
    // Docs guidance must come from an explicit docs/canonical URL, not a legacy website fallback.
    const docsUrl = input.resourceIdentity?.docsUrl?.trim() || input.resourceIdentity?.canonicalUrl?.trim()
    if (docsUrl && validatePublicHttpUrl(docsUrl).success) {
      const canonicalDocsUrl = new URL(docsUrl).href
      const alreadyLinked = [...quickstarts.values()].some(
        (quickstart) => quickstart.kind === 'open_docs' && quickstart.docsUrl === canonicalDocsUrl,
      )
      if (!alreadyLinked) {
        addUniqueQuickstart(quickstarts, {
          kind: 'open_docs',
          label: 'Open docs',
          docsUrl: canonicalDocsUrl,
          ...buildStatus('official'),
        })
      }
    }
  }

  for (const resourceLink of input.resourceLinks ?? []) {
    if (resourceLink?.visibility !== 'public' || resourceLink.kind !== 'openapi_spec') continue
    const docsUrl = normalizePublicMetadataUrl(resourceLink.url)
    if (docsUrl) specQuickstarts.push({
      kind: 'open_docs', label: 'Open OpenAPI spec', docsUrl,
      ...buildStatus(resourceLink.isOfficial === true ? 'official' : 'community'),
    })
  }
  for (const spec of specQuickstarts) {
    const matches = [...quickstarts.entries()].filter(([, entry]) =>
      entry.kind === 'open_docs' && entry.docsUrl === spec.docsUrl)
    if (matches.some(([, entry]) => entry.status !== 'deprecated') ||
      (matches.length > 0 && spec.status === 'deprecated')) continue
    for (const [key] of matches) quickstarts.delete(key)
    addUniqueQuickstart(quickstarts, spec)
  }

  return [...quickstarts.values()]
}
