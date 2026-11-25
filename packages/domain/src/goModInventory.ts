import {isCanonicalGoModulePath} from './goModule.js'
import {
  TOOL_LOOKUP_MAX_INPUT_LENGTH,
  createToolLookupResolver,
  getCachedToolLookupResolver,
  type ToolLookupArtifact,
  type ToolLookupCandidate,
} from './toolLookup.js'

export const GO_MOD_INVENTORY_ARTIFACT = 'slothhub.go-module-inventory' as const
export const GO_MOD_INVENTORY_VERSION = 1 as const
export const GO_MOD_INVENTORY_MAX_BYTES = 64 * 1024
export const GO_MOD_INVENTORY_MAX_LINES = 4_096
export const GO_MOD_INVENTORY_MAX_DEPENDENCIES = 512

// An explicit Go filename selects the Go parser (including its go.work
// rejection). Inline/stdin input selects it only through a module directive.
export const isGoModuleInventorySource = (source: string, raw: string): boolean => {
  if (source !== '-') {
    const basename = source.split(/[\\/]/).pop()
    return basename === 'go.mod' || basename === 'go.work'
  }
  const firstMeaningful = raw
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .find((line) => line.length > 0)
  return firstMeaningful !== undefined && /^module\s+\S/.test(firstMeaningful)
}

export type GoModInventoryState =
  | 'matched'
  | 'aliased'
  | 'retired'
  | 'unknown'
  | 'unsupported'
  | 'capability_unavailable'

export type GoModInventoryErrorCode =
  | 'malformed_go_mod'
  | 'missing_module_directive'
  | 'workspace_file'
  | 'oversized_line'
  | 'line_limit_exceeded'
  | 'requirement_limit_exceeded'

export class GoModInventoryError extends Error {
  readonly code: GoModInventoryErrorCode
  readonly configuredLimit?: number
  readonly observedValue?: number
  readonly recovery: string

  constructor(
    code: GoModInventoryErrorCode,
    message: string,
    recovery: string,
    limit?: {configuredLimit: number; observedValue: number},
  ) {
    super(message)
    this.name = 'GoModInventoryError'
    this.code = code
    this.recovery = recovery
    this.configuredLimit = limit?.configuredLimit
    this.observedValue = limit?.observedValue
  }
}

export interface GoModInventoryRequirement {
  modulePath: string
  version: string
  state: GoModInventoryState
  tool?: ToolLookupCandidate
}

export interface GoModSkippedDirective {
  directive: 'replace' | 'exclude' | 'retract'
  rule: `${'replace' | 'exclude' | 'retract'}_not_followed`
  count: number
}

export interface GoModInventoryReport {
  artifact: typeof GO_MOD_INVENTORY_ARTIFACT
  version: typeof GO_MOD_INVENTORY_VERSION
  lookupVersion: ToolLookupArtifact['version'] | null
  modulePath: string
  requirements: GoModInventoryRequirement[]
  skippedDirectives: GoModSkippedDirective[]
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

const RECOVERY =
  'Provide one explicit go.mod no larger than 65536 bytes containing bounded require directives only.'
const WORKSPACE_RECOVERY =
  'Provide one explicit go.mod file. go.work workspaces are never followed; inventory a single module file.'

const fail = (
  code: GoModInventoryErrorCode,
  message: string,
  recovery = RECOVERY,
  limit?: {configuredLimit: number; observedValue: number},
): never => {
  throw new GoModInventoryError(code, message, recovery, limit)
}

// Required-version grammar: canonical semver including pseudo-versions and
// +incompatible suffixes. Anything else means the line is not a require entry.
const GO_MOD_VERSION_PATTERN = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

type SkippedDirectiveName = GoModSkippedDirective['directive']

const SKIPPED_DIRECTIVES = new Set<SkippedDirectiveName>(['replace', 'exclude', 'retract'])

const isSkippedDirectiveName = (value: string): value is SkippedDirectiveName =>
  (/* SAFETY: SKIPPED_DIRECTIVES is built solely from SkippedDirectiveName literals, so membership proves the union. */
    SKIPPED_DIRECTIVES as ReadonlySet<string>).has(value)

const METADATA_DIRECTIVES = new Set(['go', 'toolchain', 'godebug'])

// A `use` directive exists only in go.work files; seeing one means the caller
// handed over a workspace file, which must fail closed rather than partially parse.
const WORKSPACE_DIRECTIVES = new Set(['use'])

const stripLineComment = (line: string): string => {
  const index = line.indexOf('//')
  return (index < 0 ? line : line.slice(0, index)).trim()
}

const compareCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

const STATE_ORDER = {
  matched: 0,
  aliased: 1,
  retired: 2,
  unsupported: 3,
  unknown: 4,
  capability_unavailable: 5,
} satisfies Record<GoModInventoryState, number>

interface ParsedGoMod {
  modulePath: string
  requirements: Map<string, string>
  skippedCounts: Map<SkippedDirectiveName, number>
}

const parseGoMod = (raw: string): ParsedGoMod => {
  // C-style comments are legal in go.mod but rare; strip complete spans and
  // let any unterminated `/*` fail the directive grammar below.
  const text = raw.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const lines = text.split(/\r?\n/)
  if (lines.length > GO_MOD_INVENTORY_MAX_LINES) {
    fail(
      'line_limit_exceeded',
      `go.mod exceeds the configured limit of ${GO_MOD_INVENTORY_MAX_LINES} lines; observed ${lines.length}.`,
      RECOVERY,
      {configuredLimit: GO_MOD_INVENTORY_MAX_LINES, observedValue: lines.length},
    )
  }

  let modulePath: string | undefined
  let blockDirective: 'require' | SkippedDirectiveName | null = null
  const requirements = new Map<string, string>()
  const skippedCounts = new Map<SkippedDirectiveName, number>()

  const addRequirement = (modulePathValue: string, version: string): void => {
    if (requirements.has(modulePathValue)) return
    if (requirements.size >= GO_MOD_INVENTORY_MAX_DEPENDENCIES) {
      fail(
        'requirement_limit_exceeded',
        `go.mod requirement count exceeds the configured limit of ${GO_MOD_INVENTORY_MAX_DEPENDENCIES}; observed at least ${requirements.size + 1}.`,
        'Remove requirements or inventory a smaller explicit go.mod.',
        {
          configuredLimit: GO_MOD_INVENTORY_MAX_DEPENDENCIES,
          observedValue: requirements.size + 1,
        },
      )
    }
    requirements.set(modulePathValue, version)
  }

  for (const rawLine of lines) {
    if (rawLine.length > TOOL_LOOKUP_MAX_INPUT_LENGTH) {
      fail(
        'oversized_line',
        `go.mod line exceeds the configured ${TOOL_LOOKUP_MAX_INPUT_LENGTH}-character limit; observed ${rawLine.length}.`,
        RECOVERY,
        {configuredLimit: TOOL_LOOKUP_MAX_INPUT_LENGTH, observedValue: rawLine.length},
      )
    }
    const line = stripLineComment(rawLine)
    if (!line) continue

    if (blockDirective) {
      if (line === ')') {
        blockDirective = null
        continue
      }
      if (blockDirective === 'require') {
        const tokens = line.split(/\s+/)
        const [path, version] = tokens
        if (tokens.length !== 2 || !path || !version || !GO_MOD_VERSION_PATTERN.test(version)) {
          fail('malformed_go_mod', `A require block line must read "<module> <version>"; got "${line.slice(0, 80)}".`)
        }
        addRequirement(path, version)
      }
      // Lines inside replace/exclude/retract blocks are never followed.
      continue
    }

    const tokens = line.split(/\s+/)
    const directive = tokens[0]

    if (WORKSPACE_DIRECTIVES.has(directive ?? '')) {
      fail(
        'workspace_file',
        'Input declares a go.work workspace directive (`use`); workspace files are never followed.',
        WORKSPACE_RECOVERY,
      )
    }

    switch (directive) {
      case 'module': {
        const declared = tokens[1]
        if (tokens.length !== 2 || !declared || modulePath !== undefined || !isCanonicalGoModulePath(declared)) {
          fail('malformed_go_mod', 'The module directive must appear once and name a canonical Go module path.')
        }
        modulePath = declared
        break
      }
      case 'require': {
        if (tokens.length === 2 && tokens[1] === '(') {
          blockDirective = 'require'
          break
        }
        const [path, version] = [tokens[1], tokens[2]]
        if (tokens.length !== 3 || !path || !version || !GO_MOD_VERSION_PATTERN.test(version)) {
          fail('malformed_go_mod', `A require line must read "require <module> <version>"; got "${line.slice(0, 80)}".`)
        }
        addRequirement(path, version)
        break
      }
      default: {
        if (directive && isSkippedDirectiveName(directive)) {
          skippedCounts.set(directive, (skippedCounts.get(directive) ?? 0) + 1)
          if (tokens[tokens.length - 1] === '(') {
            blockDirective = directive
          }
          break
        }
        if (directive && METADATA_DIRECTIVES.has(directive)) {
          if (tokens.length !== 2) {
            fail('malformed_go_mod', `The ${directive} directive must take exactly one argument.`)
          }
          break
        }
        fail('malformed_go_mod', `Unrecognized go.mod directive "${(directive ?? '').slice(0, 80)}".`)
      }
    }
  }

  if (blockDirective) {
    fail('malformed_go_mod', `go.mod ends inside an unterminated ${blockDirective} block.`)
  }
  if (!modulePath) {
    return fail('missing_module_directive', 'go.mod input has no module directive; it cannot be a module file.')
  }

  return {modulePath, requirements, skippedCounts}
}

export const inventoryGoMod = (
  raw: string,
  lookup: ToolLookupArtifact | null,
): GoModInventoryReport => {
  const {modulePath, requirements, skippedCounts} = parseGoMod(raw)
  const resolver = lookup
    ? getCachedToolLookupResolver(lookup)
    : createToolLookupResolver(null)

  const resolved = Array.from(requirements, ([requirementPath, version]) => {
    if (!isCanonicalGoModulePath(requirementPath)) {
      return {modulePath: requirementPath, version, state: 'unsupported'} as const
    }
    const outcome = resolver.resolve({namespace: 'go_module', value: requirementPath})
    if (outcome.kind === 'resolved') {
      return {modulePath: requirementPath, version, state: 'matched', tool: outcome.tool} as const
    }
    if (outcome.kind === 'aliased') {
      return {modulePath: requirementPath, version, state: 'aliased', tool: outcome.tool} as const
    }
    if (outcome.kind === 'retired') {
      return {modulePath: requirementPath, version, state: 'retired'} as const
    }
    if (outcome.kind === 'invalid_input') {
      return {modulePath: requirementPath, version, state: 'unsupported'} as const
    }
    if (outcome.kind === 'not_found') {
      return {modulePath: requirementPath, version, state: 'unknown'} as const
    }
    return {modulePath: requirementPath, version, state: 'capability_unavailable'} as const
  }).sort(
    (left, right) =>
      STATE_ORDER[left.state] - STATE_ORDER[right.state] ||
      compareCodeUnits(left.modulePath, right.modulePath),
  )

  const summary = {
    total: resolved.length,
    matched: 0,
    aliased: 0,
    retired: 0,
    unknown: 0,
    unsupported: 0,
    capabilityUnavailable: 0,
  }
  for (const requirement of resolved) {
    if (requirement.state === 'capability_unavailable') summary.capabilityUnavailable += 1
    else summary[requirement.state] += 1
  }

  const skippedDirectives = Array.from(skippedCounts, ([directive, count]) => ({
    directive,
    rule: `${directive}_not_followed` as const,
    count,
  })).sort((left, right) => compareCodeUnits(left.directive, right.directive))

  return {
    artifact: GO_MOD_INVENTORY_ARTIFACT,
    version: GO_MOD_INVENTORY_VERSION,
    lookupVersion: lookup?.version ?? null,
    modulePath,
    requirements: resolved,
    skippedDirectives,
    summary,
    disclaimer:
      'Unknown means only that this public SlothHub lookup has no matching Go module identity. This report makes no installation, security, support, or compatibility claim.',
  }
}
