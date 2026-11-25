import {isRuntimeString} from './runtimeValidation.js'
import type {JsonValue} from './jsonValue.js'
export const RESOURCE_KIND_VALUES = [
  'app',
  'library_or_package',
  'github_repository',
  'guide_or_website',
  'cli_tool',
  'api',
  'mcp_server',
  'agent_skill',
  'template_or_starter',
  'ui_component',
  'dataset',
  'specification',
  'other',
] as const

export type ResourceKind = (typeof RESOURCE_KIND_VALUES)[number]

export interface ResourceKindOption {
  title: string
  value: ResourceKind
}

export const DEFAULT_RESOURCE_KIND: ResourceKind = 'app'

export const RESOURCE_KIND_VALIDATION_MESSAGE = 'Choose a valid primary Resource Kind.'

export const RESOURCE_KIND_OPTIONS: ResourceKindOption[] = [
  {title: 'App', value: 'app'},
  {title: 'Library or package', value: 'library_or_package'},
  {title: 'GitHub repository', value: 'github_repository'},
  {title: 'Guide or website', value: 'guide_or_website'},
  {title: 'CLI tool', value: 'cli_tool'},
  {title: 'API', value: 'api'},
  {title: 'MCP server', value: 'mcp_server'},
  {title: 'Agent skill', value: 'agent_skill'},
  {title: 'Template or starter', value: 'template_or_starter'},
  {title: 'UI component', value: 'ui_component'},
  {title: 'Dataset', value: 'dataset'},
  {title: 'Specification or standard', value: 'specification'},
  {title: 'Other', value: 'other'},
]

// SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
const RESOURCE_KIND_LABELS: Record<ResourceKind, string> = Object.fromEntries(
  RESOURCE_KIND_OPTIONS.map((option) => [option.value, option.title]),
) as Record<ResourceKind, string>

// SAFETY: The source is a closed or validated string collection; widening only enables collection operations.
export const isResourceKind = (value: JsonValue): value is ResourceKind =>
  isRuntimeString(value) && (/* SAFETY: The adjacent guard or owner API establishes this asserted contract before use. */ RESOURCE_KIND_VALUES as readonly string[]).includes(value)

export const validateResourceKind = (value: JsonValue): true | string =>
  isResourceKind(value) ? true : RESOURCE_KIND_VALIDATION_MESSAGE

export const toResourceKind = (value: JsonValue): ResourceKind =>
  isResourceKind(value) ? value : DEFAULT_RESOURCE_KIND

export const getResourceKindLabel = (value: ResourceKind): string => RESOURCE_KIND_LABELS[value]

/** Resource Kinds where public visitors use pricing and platform the way they use an app listing. */
const RESOURCE_KINDS_REQUIRING_PRICING_AND_PLATFORM = new Set<ResourceKind>([
  'app',
  'cli_tool',
  'mcp_server',
])

/**
 * Pricing and platform are publication blockers only for app-like listings.
 * Missing or invalid Resource Kind follows the public default (`app`).
 */
export const resourceKindRequiresPricingAndPlatform = (value: JsonValue): boolean =>
  RESOURCE_KINDS_REQUIRING_PRICING_AND_PLATFORM.has(toResourceKind(value))
