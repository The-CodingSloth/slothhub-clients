import {hasRuntimeObjectType, isRuntimeString} from './runtimeValidation.js'
const VOLATILE_HASH_KEYS = new Set([
  'generatedAt',
  'catalogRevision',
  'contentHash',
])

const canonicalize = <Value>(value: Value): JsonValue => {
  // SAFETY: The adjacent boundary checks validate the JSON container and every member read after this point.
  const jsonValue = value as JsonValue
  if (isRuntimeString(jsonValue)) return jsonValue.replace(/\r\n?/g, '\n')
  if (Array.isArray(jsonValue)) return jsonValue.map(canonicalize)
  if (jsonValue && hasRuntimeObjectType(jsonValue)) {
    // SAFETY: The adjacent boundary checks validate the JSON container and every member read after this point.
    return Object.fromEntries(
      Object.entries(jsonValue as JsonObject)
        .filter(([key]) => !VOLATILE_HASH_KEYS.has(key))
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, entry]) => [key, canonicalize(entry)]),
    )
  }
  return jsonValue
}

export const canonicalContentHashInput = <Value>(value: Value): string =>
  JSON.stringify(canonicalize(value))

export const canonicalIndexContentHashInput = <Value>(value: Value): string => {
  if (!value || !hasRuntimeObjectType(value) || Array.isArray(value)) {
    return canonicalContentHashInput(value)
  }
  // SAFETY: The adjacent boundary checks validate the JSON container and every member read after this point.
  const index = value as JsonObject
  const hashes = index.contentHashes
  if (!hashes || !hasRuntimeObjectType(hashes) || Array.isArray(hashes)) {
    return canonicalContentHashInput(index)
  }
  // SAFETY: The adjacent boundary checks validate the JSON container and every member read after this point.
  const {'/api/index.json': _selfHash, ...leafHashes} = hashes as JsonObject
  return canonicalContentHashInput({...index, contentHashes: leafHashes})
}
import type {JsonObject, JsonValue} from './jsonValue.js'
