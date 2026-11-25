import type {JsonValue} from './jsonValue.js'
import {isRuntimeString} from './runtimeValidation.js'

export const AGENT_INTERFACE_KIND_VALUES = [
  'mcp_server',
  'mcp_client',
  'llms_txt',
  'cli',
  'desktop_app',
  'sdk',
  'api',
  'openapi_spec',
  'agent_skill',
  'browser_extension',
  'editor_extension',
  'automation_template',
] as const

export type AgentInterfaceKind = (typeof AGENT_INTERFACE_KIND_VALUES)[number]

const labels = {
  mcp_client: 'MCP client', llms_txt: 'llms.txt',
  mcp_server: 'MCP server', cli: 'CLI', desktop_app: 'Desktop app', sdk: 'SDK',
  api: 'API', openapi_spec: 'OpenAPI spec', agent_skill: 'Agent skill',
  browser_extension: 'Browser extension', editor_extension: 'Editor extension',
  automation_template: 'Automation template',
} satisfies Record<AgentInterfaceKind, string>

export const AGENT_INTERFACE_KIND_OPTIONS = AGENT_INTERFACE_KIND_VALUES.map(value => ({
  value, title: labels[value],
}))

export const isAgentInterfaceKind = (value: JsonValue): value is AgentInterfaceKind =>
  isRuntimeString(value) && AGENT_INTERFACE_KIND_VALUES.some(kind => kind === value)

export const getAgentInterfaceKindLabel = (value: AgentInterfaceKind): string => labels[value]

/** Match the public facet without loading interface normalization or lookup. */
export const matchesAgentInterfaceKind = (
  agentInterfaceKinds: readonly AgentInterfaceKind[] | null | undefined,
  requestedKind: JsonValue,
): boolean => {
  if (requestedKind === undefined || requestedKind === null || requestedKind === '') {
    return true
  }

  return (
    isAgentInterfaceKind(requestedKind) &&
    Array.isArray(agentInterfaceKinds) &&
    agentInterfaceKinds.includes(requestedKind)
  )
}

export const AGENT_INTERFACE_FACET_MINIMUM_COVERAGE = 0.05
export const AGENT_INTERFACE_FACET_MINIMUM_TOOL_COUNT = 5

export const shouldExposeAgentInterfaceKindFacet = (
  totalToolCount: number,
  coveredToolCount: number,
): boolean =>
  totalToolCount > 0 &&
  coveredToolCount >= AGENT_INTERFACE_FACET_MINIMUM_TOOL_COUNT &&
  coveredToolCount / totalToolCount >= AGENT_INTERFACE_FACET_MINIMUM_COVERAGE
