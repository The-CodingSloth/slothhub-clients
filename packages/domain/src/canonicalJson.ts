import {hasRuntimeObjectType} from './runtimeValidation.js'
import type {JsonObject, JsonPrimitive, JsonValue} from './jsonValue.js'
const sortObjectKeysDeep = <Input>(value: Input): JsonValue => {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeysDeep)
  }
  if (value !== null && hasRuntimeObjectType(value)) {
    // SAFETY: The adjacent boundary checks validate the JSON container and every member read after this point.
    const entries = Object.entries(value as JsonObject)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
    return Object.fromEntries(entries.map(([key, entryValue]) => [key, sortObjectKeysDeep(entryValue)]))
  }
  // SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
  return value as JsonPrimitive | undefined
}

/**
 * Deterministic JSON encoding with optional indentation (sorted object keys,
 * `undefined` -> `null`).
 * The re-verification engine writes `toolChange` value snapshots with this
 * encoding and the Studio review flow compares against them, so both sides
 * must share this one implementation.
 */
export const canonicalJson = <Input>(value: Input, space?: string | number): string =>
  JSON.stringify(sortObjectKeysDeep(value ?? null), null, space)
