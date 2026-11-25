import {
  createToolLookupResolver,
  getCachedToolLookupResolver,
  type ToolLookupArtifact,
  type ToolLookupCandidate,
} from './toolLookup.js'
import {isValidHomebrewFormulaName} from './agentInterface.js'

export const BREWFILE_INVENTORY_ARTIFACT = 'slothhub.brewfile-inventory' as const
export const BREWFILE_INVENTORY_VERSION = 1 as const
export const BREWFILE_INVENTORY_MAX_BYTES = 64 * 1024
export const BREWFILE_INVENTORY_MAX_FORMULAS = 512

export type BrewfileInventoryState =
  | 'matched'
  | 'aliased'
  | 'retired'
  | 'unknown'
  | 'unsupported'
  | 'capability_unavailable'

export type BrewfileInventoryErrorCode = 'formula_limit_exceeded'

export class BrewfileInventoryError extends Error {
  readonly code: BrewfileInventoryErrorCode
  readonly configuredLimit?: number
  readonly observedValue?: number
  readonly recovery: string

  constructor(
    code: BrewfileInventoryErrorCode,
    message: string,
    recovery: string,
    limit?: {configuredLimit: number; observedValue: number},
  ) {
    super(message)
    this.name = 'BrewfileInventoryError'
    this.code = code
    this.recovery = recovery
    this.configuredLimit = limit?.configuredLimit
    this.observedValue = limit?.observedValue
  }
}

export interface BrewfileInventoryFormula {
  name: string
  state: BrewfileInventoryState
  tool?: ToolLookupCandidate
}

export interface BrewfileInventoryReport {
  artifact: typeof BREWFILE_INVENTORY_ARTIFACT
  version: typeof BREWFILE_INVENTORY_VERSION
  lookupVersion: ToolLookupArtifact['version'] | null
  formulas: BrewfileInventoryFormula[]
  summary: {
    total: number
    matched: number
    aliased: number
    retired: number
    unknown: number
    unsupported: number
    capabilityUnavailable: number
  }
  disclaimer: string
}

// Only `brew "name"` and `brew 'name'` declarations are parsed. Casks, taps,
// `mas`, `vscode`, options hashes, comments, and every other Brewfile DSL form
// are ignored; nothing in the file is ever executed.
const BREWFILE_BREW_LINE =
  /^[ \t]*brew[ \t]+(?:"([^"\r\n]*)"|'([^'\r\n]*)')[ \t]*(?:[,#)]|$)/

const extractFormulaNames = (raw: string): string[] => {
  const source = raw.startsWith('\uFEFF') ? raw.slice(1) : raw
  const names: string[] = []
  const seen = new Set<string>()
  for (const line of source.split(/\r\n|\r|\n/)) {
    const match = BREWFILE_BREW_LINE.exec(line)
    if (!match) continue
    const name = match[1] ?? match[2] ?? ''
    if (seen.has(name)) continue
    seen.add(name)
    names.push(name)
    if (names.length > BREWFILE_INVENTORY_MAX_FORMULAS) {
      throw new BrewfileInventoryError(
        'formula_limit_exceeded',
        `Brewfile formula count exceeds the configured limit of ${BREWFILE_INVENTORY_MAX_FORMULAS}; observed at least ${names.length}.`,
        'Remove brew declarations or inventory a smaller explicit Brewfile.',
        {
          configuredLimit: BREWFILE_INVENTORY_MAX_FORMULAS,
          observedValue: names.length,
        },
      )
    }
  }
  return names
}

const STATE_ORDER = {
  matched: 0,
  aliased: 1,
  retired: 2,
  unsupported: 3,
  unknown: 4,
  capability_unavailable: 5,
} satisfies Record<BrewfileInventoryState, number>

const compareCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

export const inventoryBrewfile = (
  raw: string,
  lookup: ToolLookupArtifact | null,
): BrewfileInventoryReport => {
  const names = extractFormulaNames(raw)
  const resolver = lookup
    ? getCachedToolLookupResolver(lookup)
    : createToolLookupResolver(null)
  const formulas = names.map((name): BrewfileInventoryFormula => {
    if (!isValidHomebrewFormulaName(name)) {
      return {name, state: 'unsupported'}
    }
    const outcome = resolver.resolve({namespace: 'homebrew_formula', value: name})
    if (outcome.kind === 'resolved') {
      return {name, state: 'matched', tool: outcome.tool}
    }
    if (outcome.kind === 'aliased') {
      return {name, state: 'aliased', tool: outcome.tool}
    }
    if (outcome.kind === 'retired') {
      return {name, state: 'retired'}
    }
    if (outcome.kind === 'invalid_input') {
      return {name, state: 'unsupported'}
    }
    if (outcome.kind === 'not_found') {
      return {name, state: 'unknown'}
    }
    // 'ambiguous' is never reported as unknown: ambiguous identity ownership
    // is a capability gap, not evidence that no Tool maps the formula.
    return {name, state: 'capability_unavailable'}
  }).sort((left, right) =>
    STATE_ORDER[left.state] - STATE_ORDER[right.state] || compareCodeUnits(left.name, right.name),
  )

  const summary = {
    total: formulas.length,
    matched: 0,
    aliased: 0,
    retired: 0,
    unknown: 0,
    unsupported: 0,
    capabilityUnavailable: 0,
  }
  for (const formula of formulas) {
    if (formula.state === 'capability_unavailable') summary.capabilityUnavailable += 1
    else summary[formula.state] += 1
  }

  return {
    artifact: BREWFILE_INVENTORY_ARTIFACT,
    version: BREWFILE_INVENTORY_VERSION,
    lookupVersion: lookup?.version ?? null,
    formulas,
    summary,
    disclaimer:
      'Unknown means only that this public SlothHub lookup has no matching Homebrew formula identity. This report makes no installation, security, support, or compatibility claim.',
  }
}
