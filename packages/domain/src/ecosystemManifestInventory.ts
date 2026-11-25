import {normalizePypiProjectName} from './packageNames.js'
import {parse as parseToml} from 'smol-toml'

import type {JsonObject, JsonValue} from './jsonValue.js'
import {hasRuntimeObjectType, isRuntimeString} from './runtimeValidation.js'
import {
  TOOL_LOOKUP_MAX_INPUT_LENGTH,
  createToolLookupResolver,
  getCachedToolLookupResolver,
  type ToolLookupArtifact,
  type ToolLookupCandidate,
  type ToolLookupNamespace,
} from './toolLookup.js'

export const ECOSYSTEM_MANIFEST_INVENTORY_ARTIFACT =
  'slothhub.ecosystem-dependency-inventory' as const
export const ECOSYSTEM_MANIFEST_INVENTORY_VERSION = 1 as const
export const ECOSYSTEM_MANIFEST_INVENTORY_MAX_BYTES = 64 * 1024
export const ECOSYSTEM_MANIFEST_INVENTORY_MAX_DEPENDENCIES = 512
export const ECOSYSTEM_MANIFEST_INVENTORY_MAX_DEPTH = 12

export const MANIFEST_ECOSYSTEM_VALUES = ['npm', 'pypi', 'crates'] as const
export type ManifestEcosystem = (typeof MANIFEST_ECOSYSTEM_VALUES)[number]
export type TomlManifestEcosystem = Exclude<ManifestEcosystem, 'npm'>

export const isManifestEcosystem = (value: JsonValue): value is ManifestEcosystem =>
  isRuntimeString(value) &&
  // SAFETY: The source is a closed constant collection; widening only enables collection membership.
  (MANIFEST_ECOSYSTEM_VALUES as readonly string[]).includes(value)

export const PYPI_DEPENDENCY_MAPS = [
  'project.dependencies',
  'project.optional-dependencies',
  'dependency-groups',
] as const

export const CRATES_DEPENDENCY_MAPS = [
  'dependencies',
  'dev-dependencies',
  'build-dependencies',
  'target.*.dependencies',
  'target.*.dev-dependencies',
  'target.*.build-dependencies',
] as const

const CRATES_DEPENDENCY_TABLE_NAMES = [
  'dependencies',
  'dev-dependencies',
  'build-dependencies',
] as const

export type EcosystemManifestInventoryState =
  | 'matched'
  | 'aliased'
  | 'retired'
  | 'unknown'
  | 'unsupported'
  | 'capability_unavailable'

export type EcosystemManifestInventoryErrorCode =
  | 'malformed_toml'
  | 'invalid_manifest'
  | 'invalid_dependency_table'
  | 'invalid_dependency_value'
  | 'dangerous_key'
  | 'excessive_depth'
  | 'oversized_key'
  | 'oversized_value'
  | 'dependency_limit_exceeded'
  | 'invalid_ecosystem'
  | 'unsupported_manifest'
  | 'ecosystem_required'

export class EcosystemManifestInventoryError extends Error {
  readonly code: EcosystemManifestInventoryErrorCode
  readonly configuredLimit?: number
  readonly observedValue?: number
  readonly recovery: string

  constructor(
    code: EcosystemManifestInventoryErrorCode,
    message: string,
    recovery: string,
    limit?: {configuredLimit: number; observedValue: number},
  ) {
    super(message)
    this.name = 'EcosystemManifestInventoryError'
    this.code = code
    this.recovery = recovery
    this.configuredLimit = limit?.configuredLimit
    this.observedValue = limit?.observedValue
  }
}

export interface EcosystemManifestInventoryDependency {
  name: string
  declaredIn: string[]
  state: EcosystemManifestInventoryState
  tool?: ToolLookupCandidate
}

export interface EcosystemManifestInventoryReport {
  artifact: typeof ECOSYSTEM_MANIFEST_INVENTORY_ARTIFACT
  version: typeof ECOSYSTEM_MANIFEST_INVENTORY_VERSION
  ecosystem: TomlManifestEcosystem
  lookupVersion: ToolLookupArtifact['version'] | null
  dependencyMaps: readonly string[]
  dependencies: EcosystemManifestInventoryDependency[]
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

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const TOML_RECOVERY =
  'Provide one valid pyproject.toml or Cargo.toml containing only bounded TOML values.'

// Lockfiles and generated dependency trees are named manifests the inventory
// contract refuses outright: they are never opened, parsed, or walked.
const UNSUPPORTED_MANIFEST_BASENAMES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  'poetry.lock',
  'pdm.lock',
  'uv.lock',
  'cargo.lock',
  'gemfile.lock',
  'composer.lock',
  'packages.lock.json',
  'requirements.txt',
])

const manifestBasename = (sourcePath: string): string => {
  const segments = sourcePath.split(/[\\/]/)
  return (segments[segments.length - 1] ?? '').toLowerCase()
}

/**
 * Resolves the inventory ecosystem from an explicit --ecosystem value or, when
 * absent, the manifest basename. Detection is closed and deterministic: only
 * pyproject.toml and Cargo.toml names select a TOML ecosystem; every other name
 * keeps the historical npm package.json behavior (including stdin). Lockfiles,
 * generated dependency trees, glob metacharacters, and unrecognized .toml
 * names fail before the file is ever read.
 */
export const resolveInventoryEcosystem = (
  explicit: string | undefined,
  sourcePath: string,
): ManifestEcosystem => {
  if (/[*?]/.test(sourcePath)) {
    throw new EcosystemManifestInventoryError(
      'unsupported_manifest',
      'Manifest paths are read literally; glob patterns are never expanded.',
      'Pass one explicit manifest file path or pipe it through stdin with -.',
    )
  }
  const basename = manifestBasename(sourcePath)
  if (UNSUPPORTED_MANIFEST_BASENAMES.has(basename)) {
    throw new EcosystemManifestInventoryError(
      'unsupported_manifest',
      `Manifest "${basename}" is a lockfile or dependency-list format the inventory never reads.`,
      'Pass one explicit package.json, pyproject.toml, or Cargo.toml manifest instead.',
    )
  }
  if (explicit !== undefined) {
    if (isManifestEcosystem(explicit)) return explicit
    throw new EcosystemManifestInventoryError(
      'invalid_ecosystem',
      `Inventory ecosystem "${explicit}" is not supported.`,
      'Choose --ecosystem npm, pypi, or crates.',
    )
  }
  if (basename === 'pyproject.toml') return 'pypi'
  if (basename === 'cargo.toml') return 'crates'
  if (basename.endsWith('.toml')) {
    throw new EcosystemManifestInventoryError(
      'ecosystem_required',
      `Manifest "${basename}" is TOML but its ecosystem cannot be detected from the name.`,
      'Pass --ecosystem pypi or --ecosystem crates with this manifest.',
    )
  }
  return 'npm'
}

const isPlainObject = (value: JsonValue): value is JsonObject => {
  if (value === null || !hasRuntimeObjectType(value) || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const fail = (
  code: EcosystemManifestInventoryErrorCode,
  message: string,
  recovery = TOML_RECOVERY,
  limit?: {configuredLimit: number; observedValue: number},
): never => {
  throw new EcosystemManifestInventoryError(code, message, recovery, limit)
}

// Mirrors the npm manifest guard: an iterative walk enforces depth, key, and
// value tripwires on the entire parsed TOML tree before dependency tables are
// read. TOML scalar leaves (numbers, booleans, datetimes) need no inspection.
const inspectHostileToml = (root: JsonValue): void => {
  const stack: Array<{value: JsonValue; depth: number}> = [{value: root, depth: 0}]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current.depth > ECOSYSTEM_MANIFEST_INVENTORY_MAX_DEPTH) {
      fail(
        'excessive_depth',
        `Manifest nesting exceeds the configured depth limit of ${ECOSYSTEM_MANIFEST_INVENTORY_MAX_DEPTH}; observed at least ${current.depth}.`,
        'Flatten unrelated manifest metadata or provide a smaller manifest.',
        {
          configuredLimit: ECOSYSTEM_MANIFEST_INVENTORY_MAX_DEPTH,
          observedValue: current.depth,
        },
      )
    }
    if (isRuntimeString(current.value)) {
      if (current.value.length > TOOL_LOOKUP_MAX_INPUT_LENGTH) {
        fail(
          'oversized_value',
          `Manifest string exceeds the configured ${TOOL_LOOKUP_MAX_INPUT_LENGTH}-character value limit; observed ${current.value.length}.`,
          TOML_RECOVERY,
          {
            configuredLimit: TOOL_LOOKUP_MAX_INPUT_LENGTH,
            observedValue: current.value.length,
          },
        )
      }
      continue
    }
    if (current.value === null || !hasRuntimeObjectType(current.value)) continue
    if (Array.isArray(current.value)) {
      for (const item of current.value) {
        stack.push({value: item, depth: current.depth + 1})
      }
      continue
    }
    if (!isPlainObject(current.value)) continue
    for (const [key, value] of Object.entries(current.value)) {
      if (DANGEROUS_KEYS.has(key)) {
        fail('dangerous_key', `Manifest contains the forbidden key ${key}.`)
      }
      if (key.length > TOOL_LOOKUP_MAX_INPUT_LENGTH) {
        fail(
          'oversized_key',
          `Manifest key exceeds the configured ${TOOL_LOOKUP_MAX_INPUT_LENGTH}-character key limit; observed ${key.length}.`,
          TOML_RECOVERY,
          {
            configuredLimit: TOOL_LOOKUP_MAX_INPUT_LENGTH,
            observedValue: key.length,
          },
        )
      }
      stack.push({value, depth: current.depth + 1})
    }
  }
}

const parseTomlManifest = (raw: string): JsonObject => {
  let parsed: JsonValue
  try {
    // SAFETY: smol-toml's parse returns JSON-shaped values for TOML input;
    // inspectHostileToml validates the complete tree before domain use.
    parsed = parseToml(raw) as JsonValue
  } catch {
    return fail('malformed_toml', 'Dependency manifest is not valid TOML.')
  }
  inspectHostileToml(parsed)
  if (!isPlainObject(parsed)) {
    return fail('invalid_manifest', 'Dependency manifest must be a TOML table.')
  }
  return parsed
}

type DeclaredDependencies = Map<string, {name: string; declaredIn: string[]}>

const recordDependency = (
  declared: DeclaredDependencies,
  dedupeKey: string,
  name: string,
  declaredIn: string,
): void => {
  const existing = declared.get(dedupeKey)
  if (existing) {
    if (!existing.declaredIn.includes(declaredIn)) existing.declaredIn.push(declaredIn)
  } else {
    declared.set(dedupeKey, {name, declaredIn: [declaredIn]})
  }
  if (declared.size > ECOSYSTEM_MANIFEST_INVENTORY_MAX_DEPENDENCIES) {
    fail(
      'dependency_limit_exceeded',
      `Manifest dependency count exceeds the configured limit of ${ECOSYSTEM_MANIFEST_INVENTORY_MAX_DEPENDENCIES}; observed ${declared.size}.`,
      'Remove dependency declarations or inventory a smaller explicit manifest.',
      {
        configuredLimit: ECOSYSTEM_MANIFEST_INVENTORY_MAX_DEPENDENCIES,
        observedValue: declared.size,
      },
    )
  }
}

// PEP 508 requirement strings begin with the project name followed by optional
// extras, version specifiers, direct references, and environment markers. Only
// the leading name is extracted; the remainder is never interpreted or emitted.
const PEP_508_NAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?/

const recordPypiRequirement = (
  declared: DeclaredDependencies,
  requirement: string,
  declaredIn: string,
): void => {
  const name = requirement.trim().match(PEP_508_NAME_PATTERN)?.[0]
  if (!name) {
    recordDependency(declared, `requirement:${requirement}`, requirement, declaredIn)
    return
  }
  recordDependency(declared, `pypi:${normalizePypiProjectName(name)}`, name, declaredIn)
}

const readPypiRequirementArray = (
  declared: DeclaredDependencies,
  table: JsonValue,
  tablePath: string,
): void => {
  if (!Array.isArray(table)) {
    return fail(
      'invalid_dependency_table',
      `${tablePath} must be a TOML array of PEP 508 requirement strings when present.`,
    )
  }
  for (const entry of table) {
    if (!isRuntimeString(entry)) {
      return fail(
        'invalid_dependency_value',
        `${tablePath} entries must be bounded requirement strings.`,
      )
    }
    recordPypiRequirement(declared, entry, tablePath)
  }
}

// PEP 735 dependency groups permit {include-group = "name"} members alongside
// requirement strings. Group references are not project names and are skipped;
// any other non-string member fails closed like a malformed requirement.
const readPypiDependencyGroups = (
  declared: DeclaredDependencies,
  groups: JsonValue,
): void => {
  if (!isPlainObject(groups)) {
    return fail(
      'invalid_dependency_table',
      'dependency-groups must be a TOML table of requirement arrays when present.',
    )
  }
  for (const [group, members] of Object.entries(groups)) {
    if (!Array.isArray(members)) {
      return fail(
        'invalid_dependency_table',
        `dependency-groups.${group} must be a TOML array when present.`,
      )
    }
    const tablePath = `dependency-groups.${group}`
    for (const member of members) {
      if (isRuntimeString(member)) {
        recordPypiRequirement(declared, member, tablePath)
        continue
      }
      if (isPlainObject(member) && isRuntimeString(member['include-group'])) continue
      return fail(
        'invalid_dependency_value',
        `${tablePath} entries must be requirement strings or include-group references.`,
      )
    }
  }
}

const extractPypiDependencies = (manifest: JsonObject): DeclaredDependencies => {
  const declared: DeclaredDependencies = new Map()
  const project = manifest['project']
  if (project !== undefined) {
    if (isPlainObject(project)) {
      if (project['dependencies'] !== undefined) {
        readPypiRequirementArray(declared, project['dependencies'], 'project.dependencies')
      }
      const optionalDependencies = project['optional-dependencies']
      if (optionalDependencies !== undefined) {
        if (!isPlainObject(optionalDependencies)) {
          return fail(
            'invalid_dependency_table',
            'project.optional-dependencies must be a TOML table of requirement arrays when present.',
          )
        }
        for (const [extra, requirements] of Object.entries(optionalDependencies)) {
          readPypiRequirementArray(
            declared,
            requirements,
            `project.optional-dependencies.${extra}`,
          )
        }
      }
    }
  }
  const groups = manifest['dependency-groups']
  if (groups !== undefined) readPypiDependencyGroups(declared, groups)
  return declared
}

const readCratesDependencyTable = (
  declared: DeclaredDependencies,
  table: JsonValue,
  tablePath: string,
): void => {
  if (!isPlainObject(table)) {
    return fail(
      'invalid_dependency_table',
      `${tablePath} must be a TOML table of dependency entries when present.`,
    )
  }
  for (const [name, value] of Object.entries(table)) {
    if (!isRuntimeString(value) && !isPlainObject(value)) {
      return fail(
        'invalid_dependency_value',
        `${tablePath}.${name} must be a version string or dependency table.`,
      )
    }
    // Dependency values are never interpreted: version, path, git, workspace,
    // and feature fields are ignored entirely and path/workspace dependencies
    // are never followed.
    recordDependency(declared, `crates:${name.toLowerCase()}`, name, tablePath)
  }
}

const extractCratesDependencies = (manifest: JsonObject): DeclaredDependencies => {
  const declared: DeclaredDependencies = new Map()
  for (const tableName of CRATES_DEPENDENCY_TABLE_NAMES) {
    const table = manifest[tableName]
    if (table !== undefined) readCratesDependencyTable(declared, table, tableName)
  }
  const target = manifest['target']
  if (isPlainObject(target)) {
    for (const [targetName, targetTable] of Object.entries(target)) {
      if (!isPlainObject(targetTable)) continue
      for (const tableName of CRATES_DEPENDENCY_TABLE_NAMES) {
        const table = targetTable[tableName]
        if (table !== undefined) {
          readCratesDependencyTable(
            declared,
            table,
            `target.${targetName}.${tableName}`,
          )
        }
      }
    }
  }
  return declared
}

const ECOSYSTEM_TABLES = {
  pypi: PYPI_DEPENDENCY_MAPS,
  crates: CRATES_DEPENDENCY_MAPS,
} satisfies Record<TomlManifestEcosystem, readonly string[]>

const ECOSYSTEM_NAMESPACE = {
  pypi: 'pypi_project',
  crates: 'crates_package',
} satisfies Record<TomlManifestEcosystem, ToolLookupNamespace>

const ECOSYSTEM_DISCLAIMER = {
  pypi: 'Unknown means only that this public SlothHub lookup has no matching PyPI identity. This report makes no installation, security, support, or compatibility claim.',
  crates: 'Unknown means only that this public SlothHub lookup has no matching crates.io identity. This report makes no installation, security, support, or compatibility claim.',
} satisfies Record<TomlManifestEcosystem, string>

const STATE_ORDER = {
  matched: 0,
  aliased: 1,
  retired: 2,
  unsupported: 3,
  unknown: 4,
  capability_unavailable: 5,
} satisfies Record<EcosystemManifestInventoryState, number>

const compareCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

export const inventoryEcosystemManifest = (
  raw: string,
  ecosystem: TomlManifestEcosystem,
  lookup: ToolLookupArtifact | null,
): EcosystemManifestInventoryReport => {
  const manifest = parseTomlManifest(raw)
  const declared = ecosystem === 'pypi'
    ? extractPypiDependencies(manifest)
    : extractCratesDependencies(manifest)
  const namespace = ECOSYSTEM_NAMESPACE[ecosystem]
  const resolver = lookup
    ? getCachedToolLookupResolver(lookup)
    : createToolLookupResolver(null)
  const dependencies = Array.from(declared.values(), ({name, declaredIn}) => {
    const outcome = resolver.resolve({namespace, value: name})
    if (outcome.kind === 'resolved') {
      return {name, declaredIn, state: 'matched', tool: outcome.tool} as const
    }
    if (outcome.kind === 'aliased') {
      return {name, declaredIn, state: 'aliased', tool: outcome.tool} as const
    }
    if (outcome.kind === 'retired') {
      return {name, declaredIn, state: 'retired'} as const
    }
    if (outcome.kind === 'invalid_input') {
      return {name, declaredIn, state: 'unsupported'} as const
    }
    if (outcome.kind === 'not_found') {
      return {name, declaredIn, state: 'unknown'} as const
    }
    return {name, declaredIn, state: 'capability_unavailable'} as const
  }).sort((left, right) =>
    STATE_ORDER[left.state] - STATE_ORDER[right.state] || compareCodeUnits(left.name, right.name),
  )

  const summary = {
    total: dependencies.length,
    matched: 0,
    aliased: 0,
    retired: 0,
    unknown: 0,
    unsupported: 0,
    capabilityUnavailable: 0,
  }
  for (const dependency of dependencies) {
    if (dependency.state === 'capability_unavailable') summary.capabilityUnavailable += 1
    else summary[dependency.state] += 1
  }

  return {
    artifact: ECOSYSTEM_MANIFEST_INVENTORY_ARTIFACT,
    version: ECOSYSTEM_MANIFEST_INVENTORY_VERSION,
    ecosystem,
    lookupVersion: lookup?.version ?? null,
    dependencyMaps: ECOSYSTEM_TABLES[ecosystem],
    dependencies,
    summary,
    disclaimer: ECOSYSTEM_DISCLAIMER[ecosystem],
  }
}
