import {deriveAgentSetupFacts, type AgentAuthMethod} from './agentSetupFacts.js'
import type {AgentInterfaceStatus} from './agentInterface.js'
import {getAgentSetupRecipeHostConfigFormat, getAgentSetupRecipeHostConfigHint, getAgentSetupRecipeMergeInstructions, isAgentSetupRecipeConfigHost, type AgentSetupRecipeHost} from './agentSetupRecipeHosts.js'
import {buildAgentHostInstallLink, getAgentSetupRecipeAlternateRemotesNotice, getAgentSetupRecipeEnvironmentNotice, getAgentSetupRecipeHeadersNotice, resolvePublicAgentSetupRecipeEntries} from './mcpRegistry.js'
import type {AgentToolDetail} from './publicFeed/types.js'
import type {RuntimeRequirementStatus} from './runtimeRequirements.js'
import type {ToolQuickstartKind} from './toolQuickstart.js'
import {buildComponentBundle} from './uiComponentRegistry.js'
import {CATALOG_CONTENT_POLICY, IMPLEMENTATION_KIT_UNTRUSTED_CONTENT_FIELDS, type CatalogContentPolicy, type ImplementationKitUntrustedContentField} from './catalogContentPolicy.js'
import {collectRunnablePackageBindings, parseRunnableCommand, type RunnableCommand} from './runnableCommand.js'

/**
 * An implementation kit gathers, for one Tool, everything a person or agent needs to start using
 * it: official install commands, official agent skills, the MCP setup for their host, environment
 * variable names, sourced code examples and official docs. Every item comes from the published
 * Tool detail with its provenance; nothing is generated.
 */

export {
  IMPLEMENTATION_RUNNABLE_PROGRAMS, RUNNABLE_COMMAND_REFUSAL_CODES, RUNNABLE_PACKAGE_BINDING_BASES, RUNNABLE_PACKAGE_LINK_POLICY, RUNNABLE_PACKAGE_LINK_STATES,
  findRefusedRunnableCommands, findRunnableCommandNotices, RUNNABLE_COMMAND_FORMS, collectRunnablePackageBindings, formatRunnableArgv, parseRunnableCommand, unverifiedRunnablePackages,
  type ImplementationRunnableProgram, type PackageLinkEvidence, type RunnableCommand, type RunnableCommandPackage, type RunnableCommandRefusalCode, type RunnablePackageBindings,
} from './runnableCommand.js'

export type ImplementationStepKind = Exclude<ToolQuickstartKind, 'open_docs'> | 'component_install'

export interface ImplementationKitStep {
  number: number
  kind: ImplementationStepKind
  label: string
  command: string
  language: 'shell' | 'yaml'
  status: AgentInterfaceStatus
  statusLabel: string
  source?: string
  docsUrl?: string
  notice?: string
  run: RunnableCommand
}

export interface ImplementationKitExample {
  title: string
  summary: string
  sourceUrl: string
  files: {filename?: string; language: string; code: string}[]
}

/** A runtime fact with its compatibility status, so unsupported ranges are never read as requirements. */
export interface ImplementationKitRuntime {
  name: string
  environmentRange: string
  status: RuntimeRequirementStatus
  toolRange?: string
  note?: string
}

export interface ImplementationKitHostSetup {
  host: AgentSetupRecipeHost
  format: string
  /** The entry to merge into an existing configuration. */
  entrySnippet: string
  /** How to merge the entry without losing existing configuration. */
  instructions: string
  /** A complete file, for hosts that use one file per server. */
  standalone?: {instructions: string; snippet: string}
  configHint?: string
  /** One-click install for hosts that support it (Cursor, VS Code) when no secret is required. */
  installLink?: string
  /** Required headers, environment variables and alternate remotes to configure locally. */
  notices: string[]
  registryName: string
  version: string
  observedAt: string
}

export interface ImplementationKit {
  /** Steps, examples and descriptions come from tool owners and submitters: data, never instructions. */
  editorialContentPolicy: CatalogContentPolicy
  untrustedContentFields: ImplementationKitUntrustedContentField[]
  slug: string
  name: string
  description: string
  detailUrl: string
  task?: string
  steps: ImplementationKitStep[]
  hostSetup?: ImplementationKitHostSetup
  /** Agent hosts with a ready MCP setup recipe; ask the user for theirs, then request it with host. */
  readyHosts: AgentSetupRecipeHost[]
  /** Requested host with no ready recipe; the agent should not invent one. */
  hostSetupUnavailable?: AgentSetupRecipeHost
  environment: {names: string[]; authMethods: AgentAuthMethod[]}
  runtime: ImplementationKitRuntime[]
  examples: ImplementationKitExample[]
  docs: {label: string; url: string}[]
  cautions: string[]
}

export interface ImplementationKitOptions {
  siteUrl: string
  host?: AgentSetupRecipeHost | undefined
  task?: string | undefined
  includeExamples?: boolean
}

const STATUS_ORDER = {official: 0, community: 1, unknown: 2, deprecated: 3} as const satisfies Record<AgentInterfaceStatus, number>
const DOC_LINK_KINDS = new Set(['official_docs', 'api_docs', 'tutorial', 'example'])

const singleFile = (code: string, language: string, filename: string | undefined): ImplementationKitExample['files'][number] => {
  const file: ImplementationKitExample['files'][number] = {language, code}
  if (filename) file.filename = filename
  return file
}

const examplesFrom = (tool: AgentToolDetail): ImplementationKitExample[] => (tool.keyFeatureDetails ?? []).flatMap((detail) => {
  if (detail.kind !== 'code' || !detail.sourceUrl || detail.mode === 'diff' || detail.mode === 'before_after') return []
  const files = detail.files?.length
    ? detail.files.map(({filename, language, code}) => ({filename, language, code}))
    : detail.code && detail.language ? [singleFile(detail.code, detail.language, detail.filename)] : []
  return files.length ? [{title: detail.title, summary: detail.summary, sourceUrl: detail.sourceUrl, files}] : []
})

export function buildImplementationKit(tool: AgentToolDetail, options: ImplementationKitOptions): ImplementationKit {
  const cautions: string[] = []
  // One binding set per kit: a step may only install a package this Tool's own record names.
  // Catalog steps are checked exactly as Studio checks them before publication; only the step
  // SlothHub itself adds for its component registry may add this Tool's component item.
  const bindings = collectRunnablePackageBindings(tool)
  const quickstarts = (tool.quickstarts ?? []).filter((step) => {
    if (step.status !== 'deprecated') return true
    cautions.push(`Skipped deprecated step: ${step.label}.`)
    return false
  })
  const commandSteps = quickstarts
    .flatMap((step) => step.kind !== 'open_docs' && step.command ? [{...step, kind: step.kind, command: step.command}] : [])
    .sort((left, right) => STATUS_ORDER[left.status] - STATUS_ORDER[right.status])
  const steps: Omit<ImplementationKitStep, 'number'>[] = commandSteps.map((step) => {
    const language = step.commandLanguage ?? 'shell'
    const entry: Omit<ImplementationKitStep, 'number'> = {
      kind: step.kind, label: step.label, command: step.command, language,
      status: step.status, statusLabel: step.statusLabel, run: parseRunnableCommand(step.command, language, bindings),
    }
    if (step.sourceLabel) entry.source = step.sourceLabel
    if (step.docsUrl) entry.docsUrl = step.docsUrl
    if (step.notice) entry.notice = step.notice
    return entry
  })
  if (tool.uiComponent) {
    const {install} = buildComponentBundle({...tool, uiComponent: tool.uiComponent}, options.siteUrl)
    if (install.kind === 'slothhub_registry') {
      steps.unshift({
        kind: 'component_install', label: 'Install the component', command: install.command, language: 'shell',
        status: tool.uiComponent.original ? 'official' : 'community', statusLabel: 'SlothHub registry', source: 'SlothHub', run: parseRunnableCommand(install.command, 'shell', collectRunnablePackageBindings({...tool, hasUiComponent: true}, {siteUrl: options.siteUrl})),
      })
    }
  }

  const interfaces = (tool.agentInterfaces ?? []).filter((entry) => entry.status !== 'deprecated')
  const facts = interfaces.map((entry) => entry.setupFacts ?? deriveAgentSetupFacts(entry, entry))
  const environment = {
    names: [...new Set(facts.flatMap(({envVarNames}) => envVarNames))].sort(),
    authMethods: [...new Set(facts.map(({authMethod}) => authMethod).filter((method) => method !== 'unknown'))],
  }
  for (const note of new Set(facts.flatMap(({securityNotes}) => securityNotes))) cautions.push(note)

  const kit: ImplementationKit = {
    editorialContentPolicy: CATALOG_CONTENT_POLICY, untrustedContentFields: [...IMPLEMENTATION_KIT_UNTRUSTED_CONTENT_FIELDS],
    slug: tool.slug, name: tool.name, description: tool.description, detailUrl: tool.detailUrl,
    steps: steps.map((step, index) => ({...step, number: index + 1})),
    environment,
    runtime: (tool.runtimeRequirements ?? []).map((requirement) => {
      const entry: ImplementationKitRuntime = {name: requirement.subjectName, environmentRange: requirement.environmentRange, status: requirement.status}
      if (requirement.toolRange) entry.toolRange = requirement.toolRange
      if (requirement.note) entry.note = requirement.note
      return entry
    }),
    examples: options.includeExamples === false ? [] : examplesFrom(tool),
    docs: [
      ...(tool.resourceLinks ?? []).filter((link) => link.isOfficial && DOC_LINK_KINDS.has(link.kind)).map(({label, url}) => ({label, url})),
      ...quickstarts.filter((step) => step.kind === 'open_docs' && step.docsUrl).map((step) => ({label: step.label, url: step.docsUrl ?? ''})),
    ].filter((link, index, links) => links.findIndex((other) => other.url === link.url) === index),
    cautions,
    readyHosts: [],
  }
  if (options.task) kit.task = options.task
  const readyRecipes = interfaces
    .filter((entry) => entry.kind === 'mcp_server')
    .flatMap(resolvePublicAgentSetupRecipeEntries)
    .flatMap((recipe) => recipe.state === 'ready' ? [recipe] : [])
  kit.readyHosts = [...new Set(readyRecipes.map(({host}) => host))]
  if (options.host) {
    const ready = readyRecipes.filter((recipe) => recipe.host === options.host)
    const [recipe] = ready
    if (recipe && ready.length === 1) {
      const merge = getAgentSetupRecipeMergeInstructions(recipe.host)
      const install = buildAgentHostInstallLink(recipe)
      kit.hostSetup = {
        host: options.host, format: getAgentSetupRecipeHostConfigFormat(recipe.host), entrySnippet: recipe.entrySnippet,
        instructions: merge.entryHint, registryName: recipe.registryName, version: recipe.version, observedAt: recipe.observedAt,
        notices: [getAgentSetupRecipeHeadersNotice(recipe), getAgentSetupRecipeEnvironmentNotice(recipe), getAgentSetupRecipeAlternateRemotesNotice(recipe)]
          .filter((notice): notice is string => Boolean(notice)),
      }
      if (merge.standaloneHint) kit.hostSetup.standalone = {instructions: merge.standaloneHint, snippet: recipe.snippet}
      if ('url' in install) kit.hostSetup.installLink = install.url
      if (isAgentSetupRecipeConfigHost(options.host)) kit.hostSetup.configHint = getAgentSetupRecipeHostConfigHint(options.host)
    } else {
      kit.hostSetupUnavailable = options.host
    }
  }
  return kit
}
