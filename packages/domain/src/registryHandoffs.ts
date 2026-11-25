import type {AgentInterfaceKind} from './agentInterface.js'
import type {ResourceKind} from './resourceKind.js'

// Preserve the browser handoff contract; see upstream docs/measurements/registry-handoffs-2026-09-22.md.
export const REGISTRY_HANDOFF_QUERY_MAX_LENGTH = 120
export const PACKAGE_REGISTRY_VALUES = ['npm', 'pypi', 'crates_io'] as const
export type PackageRegistry = typeof PACKAGE_REGISTRY_VALUES[number]
export const PACKAGE_REGISTRY_IDENTITY_KINDS = {
  npm: 'npm_package', pypi: 'pypi_project', crates_io: 'crates_package',
} as const satisfies {[Registry in PackageRegistry]: string}

/** Package membership follows the primary Resource Identity, never text or secondary links. */
export const getPackageRegistry = (identityKind: string | undefined): PackageRegistry | undefined =>
  PACKAGE_REGISTRY_VALUES.find((registry) => PACKAGE_REGISTRY_IDENTITY_KINDS[registry] === identityKind)

export const PACKAGE_REGISTRY_LABELS = {
  npm: 'npm', pypi: 'PyPI (Python)', crates_io: 'crates.io (Rust)',
} as const satisfies {[Registry in PackageRegistry]: string}

export const REGISTRY_HANDOFF_DESTINATIONS = ['github', 'npm', 'pypi', 'crates_io', 'mcp_registry', 'skills_sh'] as const
export type RegistryHandoffDestination = typeof REGISTRY_HANDOFF_DESTINATIONS[number]
export interface RegistryHandoff {
  destination: RegistryHandoffDestination
  label: string
  href: string
}

interface RegistryHandoffFilters {
  resourceKind?: ResourceKind | null
  agentInterfaceKind?: AgentInterfaceKind
  packageRegistry?: PackageRegistry
}

const SEARCH_DESTINATIONS = {
  github: {label: 'Search GitHub', href: 'https://github.com/search'},
  npm: {label: 'Search npm', href: 'https://www.npmjs.com/search'},
  pypi: {label: 'Search PyPI', href: 'https://pypi.org/search/'},
  crates_io: {label: 'Search crates.io', href: 'https://crates.io/search'},
} as const
const CONTROL_OR_FORMAT_CHARACTERS = /[\p{Cc}\p{Cf}]/u

export const normalizeRegistryHandoffQuery = (rawQuery: string): string | null => {
  if (CONTROL_OR_FORMAT_CHARACTERS.test(rawQuery)) return null
  const normalized = rawQuery.normalize('NFC').trim().replace(/\s+/gu, ' ')
  if (!normalized) return null
  return Array.from(normalized).slice(0, REGISTRY_HANDOFF_QUERY_MAX_LENGTH).join('')
}

export const getRegistryHandoffs = (
  rawQuery: string,
  filters: RegistryHandoffFilters = {},
): RegistryHandoff[] => {
  const query = normalizeRegistryHandoffQuery(rawQuery)
  if (!query) return []

  // A package registry is more specific than an interface implemented by a package.
  if (!filters.packageRegistry) {
    const kind = filters.resourceKind === 'mcp_server' || filters.resourceKind === 'agent_skill'
      ? filters.resourceKind : filters.agentInterfaceKind
    // These registries do not document a stable human search URL.
    if (kind === 'mcp_server') {
      return [{destination: 'mcp_registry', label: 'Browse MCP Registry', href: 'https://registry.modelcontextprotocol.io/'}]
    }
    if (kind === 'agent_skill') {
      return [{destination: 'skills_sh', label: 'Browse skills.sh', href: 'https://skills.sh/'}]
    }
  }

  const destinations: Array<keyof typeof SEARCH_DESTINATIONS> = filters.packageRegistry
    ? [filters.packageRegistry] : ['github', 'npm']
  return destinations.map((destination) => {
    const {label, href} = SEARCH_DESTINATIONS[destination]
    const url = new URL(href)
    url.searchParams.set('q', query)
    if (destination === 'github') url.searchParams.set('type', 'repositories')
    return {destination, label, href: url.toString()}
  })
}
