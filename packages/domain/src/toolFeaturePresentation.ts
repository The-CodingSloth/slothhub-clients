import type {ToolFeatureLimitEntry} from './toolFeatureDetails.js'
import type {ToolInstallInput} from './toolFeatureInstall.js'
import type {TOOL_CAPABILITY_LIST_KINDS} from './toolFeatureCapabilityList.js'

// Public rendering must not construct the schemas used by content editors.
export const TOOL_FEATURE_LIMIT_QUALIFIER_LABELS = {up_to: 'Up to', included: 'Included', unlimited: 'Unlimited', minimum: 'Minimum'} as const
export const TOOL_CAPABILITY_EFFECT_LABELS = {read: 'Read', write: 'Write', destructive: 'Destructive'} as const
export const TOOL_FEATURE_OUTPUT_UNAVAILABLE_LABELS = {not_documented: 'Not documented', interactive: 'Interactive', not_run: 'Not run'} as const

/** Preserve authored values and units without guessing numeric or locale semantics. */
export function formatToolFeatureLimitEntry(entry: ToolFeatureLimitEntry): string {
  const value = [entry.qualifier ? TOOL_FEATURE_LIMIT_QUALIFIER_LABELS[entry.qualifier] : undefined, entry.value, entry.unit].filter(Boolean).join(' ')
  const quantity = `${value}${entry.period ? `/${entry.period}` : ''}`
  return quantity ? `${entry.label}: ${quantity}` : entry.label
}

export function formatToolCapabilityCount(listKind: typeof TOOL_CAPABILITY_LIST_KINDS[number], count: number): string {
  const noun = {mcp_tool: 'tool', command: 'command', skill: 'skill', endpoint: 'endpoint'}[listKind]
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

export interface ToolInstallCommand {manager: ToolInstallInput['managers'][number]; command: string}

/** Manager syntax is generated only for choices an editor has verified at the source. */
export function getToolInstallCommands(input: ToolInstallInput): ToolInstallCommand[] {
  return input.managers.map((manager) => {
    const base = {npm: 'npm install', pnpm: 'pnpm add', yarn: 'yarn add', bun: 'bun add', deno: 'deno add', pip: 'pip install', uv: 'uv add', brew: 'brew install', winget: 'winget install', scoop: 'scoop install', choco: 'choco install'}[manager]
    const dev = input.dev ? (manager === 'uv' ? '--dev' : manager === 'deno' ? '--package-json -D' : '-D') : ''
    const pinned = input.ecosystem === 'js' && input.packageName.lastIndexOf('@') > 0
    const exact = input.exact || pinned ? (manager === 'deno' ? '--save-exact' : manager === 'uv' ? '--bounds exact' : '-E') : ''
    const name = manager === 'deno' ? `npm:${input.packageName}` : input.packageName
    return {manager, command: [base, dev, exact, name, input.extraArgs].filter(Boolean).join(' ')}
  })
}
