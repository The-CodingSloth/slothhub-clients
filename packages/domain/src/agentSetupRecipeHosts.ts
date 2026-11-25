import type {JsonValue} from './jsonValue.js'
import {isRuntimeString} from './runtimeValidation.js'

/**
 * Agent Hosts the shared Setup Recipe projector can emit. `setup --host` reads
 * this vocabulary rather than keeping a second parser.
 */
export const AGENT_SETUP_RECIPE_CONFIG_HOST_VALUES = [
  'cursor',
  'gemini_cli',
  'zed',
  'windsurf',
  'kiro',
  'codex_cli',
  'opencode',
  'copilot_cli',
  'claude_code',
  'vscode',
  'cline',
  'amp',
  'continue',
  'jetbrains_ai_assistant',
  'junie',
  'warp',
  'goose',
] as const
export type AgentSetupRecipeConfigHost = (typeof AGENT_SETUP_RECIPE_CONFIG_HOST_VALUES)[number]
export const AGENT_SETUP_RECIPE_HOST_VALUES = [...AGENT_SETUP_RECIPE_CONFIG_HOST_VALUES, 'claude_desktop'] as const
export type AgentSetupRecipeHost = (typeof AGENT_SETUP_RECIPE_HOST_VALUES)[number]

export const isAgentSetupRecipeConfigHost = (value: JsonValue): value is AgentSetupRecipeConfigHost =>
  isRuntimeString(value) && AGENT_SETUP_RECIPE_CONFIG_HOST_VALUES.some((host) => host === value)

/** Per-host presentation facts — labels for cards, CLI output, and markdown. */
interface AgentSetupRecipeHostPresentation {
  label: string
  /** The filename or settings destination shown next to the copy button. */
  configFileName: string
  /** Omitted for file targets. Settings destinations must never be called files. */
  configTargetKind?: 'settings'
  /**
   * Fuller config-location guidance for text renderers when the filename
   * alone is ambiguous — e.g. Copilot CLI's user vs project paths. Absent
   * when `configFileName` already names the target unambiguously.
   */
  configHint?: string
  /** Omit authentication scaffolding for hosts with a URL-only recipe. */
  headerMode?: 'omit'
}

export type AgentSetupRecipeHostMeta = AgentSetupRecipeHostPresentation & ({
  configFormat: 'shell'
  cliCommand: string
  rootKey?: never
  remoteField?: never
  remoteType?: never
} | {
  /** Config syntax; absent means JSON. */
  configFormat?: 'toml' | 'yaml'
  /** Copy-only CLI alternative, never executed. */
  cliCommand?: string
  /** Root key the host reads. */
  rootKey: 'mcpServers' | 'context_servers' | 'mcp_servers' | 'mcp' | 'servers' | 'extensions' | 'amp.mcpServers'
  /** Remote field name inside each entry (`url`, `httpUrl`, or `serverUrl`). */
  remoteField: 'url' | 'httpUrl' | 'serverUrl' | 'uri'
  /**
   * Transport literal the host's config requires on each remote entry —
   * Copilot CLI entries carry `type: "http"` for streamable HTTP remotes.
   * Hosts without one (Cursor, Zed) omit `type` entirely.
   */
  remoteType?: 'http' | 'remote' | 'streamableHttp'
})

type AgentSetupRecipeHostCatalog = {
  [Host in AgentSetupRecipeConfigHost]: AgentSetupRecipeHostMeta
}

export const AGENT_SETUP_RECIPE_HOSTS: AgentSetupRecipeHostCatalog = {
  cursor: {
    label: 'Cursor',
    configFileName: 'mcp.json',
    configHint: '.cursor/mcp.json (project) or ~/.cursor/mcp.json (user)',
    rootKey: 'mcpServers',
    remoteField: 'url',
  },
  gemini_cli: {
    label: 'Gemini CLI',
    configFileName: 'settings.json',
    rootKey: 'mcpServers',
    remoteField: 'httpUrl',
  },
  zed: {
    label: 'Zed',
    configFileName: 'settings.json',
    rootKey: 'context_servers',
    remoteField: 'url',
  },
  windsurf: {
    label: 'Windsurf',
    configFileName: 'mcp_config.json',
    rootKey: 'mcpServers',
    remoteField: 'serverUrl',
  },
  kiro: {
    label: 'Kiro',
    configFileName: 'mcp.json',
    configHint: '.kiro/settings/mcp.json (workspace) or ~/.kiro/settings/mcp.json (user)',
    rootKey: 'mcpServers',
    remoteField: 'url',
  },
  codex_cli: {
    label: 'Codex CLI',
    configFileName: 'config.toml',
    configHint:
      '~/.codex/config.toml (user) or .codex/config.toml (project) — shared by Codex CLI, ChatGPT desktop, and the Codex IDE extension',
    configFormat: 'toml',
    rootKey: 'mcp_servers',
    remoteField: 'url',
    cliCommand: 'codex mcp add {serverKey} --url {url}',
  },
  opencode: {
    label: 'OpenCode',
    configFileName: 'opencode.json',
    rootKey: 'mcp',
    remoteField: 'url',
    remoteType: 'remote',
  },
  copilot_cli: {
    label: 'GitHub Copilot CLI',
    // User-level config is `~/.copilot/mcp-config.json`; project config is
    // `.mcp.json` or `.github/mcp.json` (github/docs add-mcp-servers.md,
    // verified 2026-09-16). Not the VS Code `servers` shape — Copilot CLI
    // remote entries must carry an explicit `type`.
    configFileName: 'mcp-config.json',
    configHint:
      '~/.copilot/mcp-config.json (user) or .mcp.json / .github/mcp.json (project)',
    rootKey: 'mcpServers',
    remoteField: 'url',
    remoteType: 'http',
  },
  claude_code: {
    label: 'Claude Code',
    configFileName: '~/.claude.json',
    configFormat: 'shell',
    cliCommand: 'claude mcp add --transport http {serverKey} {url}',
  },
  vscode: {
    label: 'VS Code',
    configFileName: '.vscode/mcp.json',
    configHint: '.vscode/mcp.json (workspace)',
    rootKey: 'servers',
    remoteField: 'url',
    remoteType: 'http',
    headerMode: 'omit',
  },
  cline: {
    label: 'Cline',
    configFileName: 'mcp.json',
    configHint: 'Configure MCP Servers (Cline IDE) or ~/.cline/mcp.json (CLI)',
    rootKey: 'mcpServers',
    remoteField: 'url',
    remoteType: 'streamableHttp',
    headerMode: 'omit',
  },
  amp: {
    label: 'Amp',
    configFileName: 'settings.json',
    configHint: '.amp/settings.json (workspace; approval required) or ~/.config/amp/settings.json (user)',
    rootKey: 'amp.mcpServers',
    remoteField: 'url',
    headerMode: 'omit',
  },
  continue: {
    label: 'Continue',
    configFileName: 'mcp.yaml',
    configHint: '.continue/mcpServers/ (workspace)',
    configFormat: 'yaml',
    rootKey: 'mcpServers',
    remoteField: 'url',
    headerMode: 'omit',
  },
  jetbrains_ai_assistant: {
    label: 'JetBrains AI Assistant',
    configFileName: 'AI Assistant MCP settings',
    configHint: 'Settings → Tools → AI Assistant → Model Context Protocol (MCP); select HTTP when adding a server',
    configTargetKind: 'settings',
    rootKey: 'mcpServers',
    remoteField: 'url',
    // The official remote example establishes only the URL shape. Required
    // authentication remains unknown until host-specific evidence is verified.
    headerMode: 'omit',
  },
  junie: {
    label: 'Junie',
    configFileName: '.junie/mcp/mcp.json',
    configHint: '.junie/mcp/mcp.json (project) or ~/.junie/mcp/mcp.json (user)',
    rootKey: 'mcpServers',
    remoteField: 'url',
    // Keep the verified header-free recipe separate from authentication setup.
    headerMode: 'omit',
  },
  warp: {
    label: 'Warp',
    configFileName: '.warp/.mcp.json',
    configHint: '.warp/.mcp.json (project, requires approval) or ~/.warp/.mcp.json (user)',
    rootKey: 'mcpServers',
    remoteField: 'url',
    // File locations verified 2026-09-29: https://docs.warp.dev/agents/capabilities/mcp/
    // Keep the verified header-free recipe separate from authentication setup.
    headerMode: 'omit',
  },
  goose: {
    label: 'Goose',
    configFileName: '~/.config/goose/config.yaml',
    configFormat: 'yaml',
    rootKey: 'extensions',
    remoteField: 'uri',
    headerMode: 'omit',
  },
}

export const getAgentSetupRecipeHostLabel = (
  host: AgentSetupRecipeHost,
): string => host === 'claude_desktop' ? 'Claude Desktop' : AGENT_SETUP_RECIPE_HOSTS[host].label

export const getAgentSetupRecipeHostConfigFileName = (
  host: AgentSetupRecipeConfigHost,
): string => AGENT_SETUP_RECIPE_HOSTS[host].configFileName

export const getAgentSetupRecipeHostConfigTargetKind = (
  host: AgentSetupRecipeConfigHost,
): 'file' | 'settings' => AGENT_SETUP_RECIPE_HOSTS[host].configTargetKind ?? 'file'

export const getAgentSetupRecipeHostConfigHint = (
  host: AgentSetupRecipeConfigHost,
): string | undefined => AGENT_SETUP_RECIPE_HOSTS[host].configHint

export const getAgentSetupRecipeHostConfigFormat = (
  host: AgentSetupRecipeConfigHost,
): 'json' | 'toml' | 'yaml' | 'shell' => AGENT_SETUP_RECIPE_HOSTS[host].configFormat ?? 'json'

export const getAgentSetupRecipeHostRootKey = (
  host: AgentSetupRecipeConfigHost,
): string | undefined => AGENT_SETUP_RECIPE_HOSTS[host].rootKey

/** Copy instructions shared by Tool pages and text consumers. */
export const getAgentSetupRecipeCopyHint = (host: AgentSetupRecipeConfigHost): string =>
  getAgentSetupRecipeHostConfigFormat(host) === 'shell'
    ? 'run in a POSIX shell in your project directory (local scope)'
    : host === 'continue'
    ? 'append to the mcpServers YAML list in .continue/mcpServers/ (workspace)'
    : `merge into ${getAgentSetupRecipeHostRootKey(host)} in ${getAgentSetupRecipeHostConfigHint(host) ?? getAgentSetupRecipeHostConfigFileName(host)}`

// SAFETY: The source is a closed or validated string collection; widening only enables collection operations.
export const isAgentSetupRecipeHost = (
  value: JsonValue,
): value is AgentSetupRecipeHost =>
  isRuntimeString(value) &&
  (/* SAFETY: The adjacent guard or owner API establishes this asserted contract before use. */ AGENT_SETUP_RECIPE_HOST_VALUES as readonly string[]).includes(value)

/**
 * Catalog facet match: a Tool qualifies when the requested host appears in its
 * derived `setupRecipeHosts` (ready recipes only). Unknown host values fail
 * closed — they match nothing rather than widening results.
 */
export const matchesAgentSetupRecipeHost = (
  setupRecipeHosts: readonly AgentSetupRecipeHost[] | null | undefined,
  requestedHost: JsonValue,
): boolean => {
  if (
    requestedHost === undefined ||
    requestedHost === null ||
    requestedHost === ''
  ) {
    return true
  }

  return (
    isAgentSetupRecipeConfigHost(requestedHost) &&
    Array.isArray(setupRecipeHosts) &&
    setupRecipeHosts.includes(requestedHost)
  )
}

export interface AgentSetupRecipeMergeInstructions {
  entryHint: string
  standaloneHint?: string
}

export function getAgentSetupRecipeMergeInstructions(
  host: AgentSetupRecipeConfigHost,
): AgentSetupRecipeMergeInstructions {
  const meta = AGENT_SETUP_RECIPE_HOSTS[host]
  if (host === 'continue')
    return {
      entryHint:
        'Append this entry to the existing mcpServers YAML list. Preserve its metadata and other entries; resolve duplicate server names before merging.',
      standaloneHint:
        'For a new standalone file, choose an unused .yaml filename in .continue/mcpServers/ and use the complete configuration below. Preserve existing files.',
    }
  return {
    entryHint:
      meta.configFormat === 'shell'
        ? `Copy and review, then ${getAgentSetupRecipeCopyHint(host)}.`
        : meta.configFormat === 'yaml'
        ? `Paste under the ${meta.rootKey} mapping, preserving the shown indentation and your existing entries.`
        : meta.configFormat === 'toml'
        ? `Paste into ${meta.configHint ?? meta.configFileName} — the table is additive; your existing entries stay.`
        : `Paste inside the ${meta.rootKey} object — your existing entries stay.`,
  }
}
