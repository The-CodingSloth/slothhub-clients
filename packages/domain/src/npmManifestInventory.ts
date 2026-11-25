import type {JsonObject, JsonValue} from './jsonValue.js'
import {hasRuntimeObjectType, isRuntimeString} from './runtimeValidation.js'
import {
  TOOL_LOOKUP_MAX_INPUT_LENGTH,
  createToolLookupResolver,
  getCachedToolLookupResolver,
  isCanonicalNpmPackageName,
  type ToolLookupArtifact,
  type ToolLookupCandidate,
} from './toolLookup.js'

export const NPM_MANIFEST_INVENTORY_ARTIFACT =
  'slothhub.workspace-dependency-inventory' as const
export const NPM_MANIFEST_INVENTORY_VERSION = 1 as const
export const NPM_MANIFEST_INVENTORY_MAX_BYTES = 64 * 1024
export const NPM_MANIFEST_INVENTORY_MAX_DEPENDENCIES = 512
export const NPM_MANIFEST_INVENTORY_MAX_DEPTH = 12

export const NPM_MANIFEST_DEPENDENCY_MAPS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const

export type NpmManifestDependencyMap = (typeof NPM_MANIFEST_DEPENDENCY_MAPS)[number]
export type NpmManifestInventoryState =
  | 'matched'
  | 'aliased'
  | 'retired'
  | 'unknown'
  | 'unsupported'
  | 'capability_unavailable'

export type NpmManifestInventoryErrorCode =
  | 'malformed_json'
  | 'invalid_manifest'
  | 'invalid_dependency_map'
  | 'invalid_dependency_value'
  | 'dangerous_key'
  | 'excessive_depth'
  | 'oversized_key'
  | 'oversized_value'
  | 'dependency_limit_exceeded'

export class NpmManifestInventoryError extends Error {
  readonly code: NpmManifestInventoryErrorCode
  readonly configuredLimit?: number
  readonly observedValue?: number
  readonly recovery: string

  constructor(
    code: NpmManifestInventoryErrorCode,
    message: string,
    recovery: string,
    limit?: {configuredLimit: number; observedValue: number},
  ) {
    super(message)
    this.name = 'NpmManifestInventoryError'
    this.code = code
    this.recovery = recovery
    this.configuredLimit = limit?.configuredLimit
    this.observedValue = limit?.observedValue
  }
}

export interface NpmManifestInventoryDependency {
  name: string
  declaredIn: NpmManifestDependencyMap[]
  state: NpmManifestInventoryState
  tool?: ToolLookupCandidate
}

export interface NpmManifestInventoryReport {
  artifact: typeof NPM_MANIFEST_INVENTORY_ARTIFACT
  version: typeof NPM_MANIFEST_INVENTORY_VERSION
  lookupVersion: ToolLookupArtifact['version'] | null
  dependencyMaps: NpmManifestDependencyMap[]
  dependencies: NpmManifestInventoryDependency[]
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
const RECOVERY = 'Provide one valid package.json containing only bounded JSON values.'

const isPlainObject = (value: JsonValue): value is JsonObject => {
  if (value === null || !hasRuntimeObjectType(value) || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const fail = (
  code: NpmManifestInventoryErrorCode,
  message: string,
  recovery = RECOVERY,
  limit?: {configuredLimit: number; observedValue: number},
): never => {
  throw new NpmManifestInventoryError(code, message, recovery, limit)
}

const inspectHostileJson = (root: JsonValue): void => {
  const stack: Array<{value: JsonValue; depth: number}> = [{value: root, depth: 0}]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current.depth > NPM_MANIFEST_INVENTORY_MAX_DEPTH) {
      fail(
        'excessive_depth',
        `Manifest nesting exceeds the configured depth limit of ${NPM_MANIFEST_INVENTORY_MAX_DEPTH}; observed at least ${current.depth}.`,
        'Flatten unrelated manifest metadata or provide a smaller package.json.',
        {
          configuredLimit: NPM_MANIFEST_INVENTORY_MAX_DEPTH,
          observedValue: current.depth,
        },
      )
    }
    if (isRuntimeString(current.value)) {
      if (current.value.length > TOOL_LOOKUP_MAX_INPUT_LENGTH) {
        fail(
          'oversized_value',
          `Manifest string exceeds the configured ${TOOL_LOOKUP_MAX_INPUT_LENGTH}-character value limit; observed ${current.value.length}.`,
          RECOVERY,
          {
            configuredLimit: TOOL_LOOKUP_MAX_INPUT_LENGTH,
            observedValue: current.value.length,
          },
        )
      }
      continue
    }
    if (current.value === null || !hasRuntimeObjectType(current.value)) continue
    for (const [key, value] of Object.entries(current.value)) {
      if (DANGEROUS_KEYS.has(key)) {
        fail('dangerous_key', `Manifest contains the forbidden key ${key}.`)
      }
      if (key.length > TOOL_LOOKUP_MAX_INPUT_LENGTH) {
        fail(
          'oversized_key',
          `Manifest key exceeds the configured ${TOOL_LOOKUP_MAX_INPUT_LENGTH}-character key limit; observed ${key.length}.`,
          RECOVERY,
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

const parseManifest = (raw: string): JsonObject => {
  let parsed: JsonValue
  try {
    // SAFETY: JSON.parse returns JSON-compatible values; inspectHostileJson validates the complete tree before domain use.
    parsed = JSON.parse(raw) as JsonValue
  } catch {
    return fail('malformed_json', 'Workspace dependency manifest is not valid JSON.')
  }
  inspectHostileJson(parsed)
  if (!isPlainObject(parsed)) {
    return fail('invalid_manifest', 'Workspace dependency manifest must be a JSON object.')
  }
  return parsed
}

const extractDependencies = (manifest: JsonObject): Map<string, NpmManifestDependencyMap[]> => {
  const declaredInByName = new Map<string, NpmManifestDependencyMap[]>()
  for (const mapName of NPM_MANIFEST_DEPENDENCY_MAPS) {
    const dependencyMap = manifest[mapName]
    if (dependencyMap === undefined) continue
    const dependencyObject = isPlainObject(dependencyMap)
      ? dependencyMap
      : fail(
        'invalid_dependency_map',
        `${mapName} must be a plain JSON object when present.`,
      )
    for (const [name, value] of Object.entries(dependencyObject)) {
      if (!isRuntimeString(value)) {
        fail(
          'invalid_dependency_value',
          `${mapName}.${name} must be a bounded string.`,
        )
      }
      const declaredIn = declaredInByName.get(name)
      if (declaredIn) declaredIn.push(mapName)
      else declaredInByName.set(name, [mapName])
      if (declaredInByName.size > NPM_MANIFEST_INVENTORY_MAX_DEPENDENCIES) {
        fail(
          'dependency_limit_exceeded',
          `Manifest dependency count exceeds the configured limit of ${NPM_MANIFEST_INVENTORY_MAX_DEPENDENCIES}; observed ${declaredInByName.size}.`,
          'Remove dependency declarations or inventory a smaller explicit package.json.',
          {
            configuredLimit: NPM_MANIFEST_INVENTORY_MAX_DEPENDENCIES,
            observedValue: declaredInByName.size,
          },
        )
      }
    }
  }
  return declaredInByName
}

const STATE_ORDER = {
  matched: 0,
  aliased: 1,
  retired: 2,
  unsupported: 3,
  unknown: 4,
  capability_unavailable: 5,
} satisfies Record<NpmManifestInventoryState, number>

const compareCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

export const inventoryNpmManifest = (
  raw: string,
  lookup: ToolLookupArtifact | null,
): NpmManifestInventoryReport => {
  const manifest = parseManifest(raw)
  const declaredInByName = extractDependencies(manifest)
  const resolver = lookup
    ? getCachedToolLookupResolver(lookup)
    : createToolLookupResolver(null)
  const dependencies = Array.from(declaredInByName, ([name, declaredIn]) => {
    if (!isCanonicalNpmPackageName(name)) {
      return {name, declaredIn, state: 'unsupported'} as const
    }
    const outcome = resolver.resolve({namespace: 'npm_package', value: name})
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
    artifact: NPM_MANIFEST_INVENTORY_ARTIFACT,
    version: NPM_MANIFEST_INVENTORY_VERSION,
    lookupVersion: lookup?.version ?? null,
    dependencyMaps: [...NPM_MANIFEST_DEPENDENCY_MAPS],
    dependencies,
    summary,
    disclaimer:
      'Unknown means only that this public SlothHub lookup has no matching npm identity. This report makes no installation, security, support, or compatibility claim.',
  }
}
