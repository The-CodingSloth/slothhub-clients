import {isRuntimeString} from './runtimeValidation.js'
import type {JsonValue} from './jsonValue.js'
import type {PublicSourceReference} from './sourceReference.js'

export const PUBLIC_TEXT_CONTROL_PATTERN = new RegExp(
  '[\\u0000-\\u001f\\u007f-\\u009f\\u061c\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]',
  'u',
)

export interface SourceBackedEvidence extends PublicSourceReference {
  checkedAt: string
}

export const normalizePublicText = (
  value: JsonValue,
  maxLength: number,
): string | undefined => {
  if (!isRuntimeString(value)) return undefined
  const normalized = value.replace(/\s+/gu, ' ').trim()
  if (
    !normalized ||
    normalized.length > maxLength ||
    PUBLIC_TEXT_CONTROL_PATTERN.test(normalized)
  ) {
    return undefined
  }
  return normalized
}

export const normalizeOptionalPublicText = (
  value: JsonValue,
  maxLength: number,
): string | undefined | null => {
  if (
    value === undefined ||
    value === null ||
    (isRuntimeString(value) && !value.trim())
  ) {
    return undefined
  }
  return normalizePublicText(value, maxLength) ?? null
}

export const resolveSourceBackedEvidence = (
  keys: JsonValue,
  references: ReadonlyMap<string, PublicSourceReference>,
  maxEvidence: number,
): SourceBackedEvidence[] | undefined => {
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > maxEvidence) {
    return undefined
  }

  const normalizedKeys = keys.map((key) =>
    isRuntimeString(key) ? key.trim() : '',
  )
  if (
    normalizedKeys.some((key) => !key) ||
    new Set(normalizedKeys).size !== normalizedKeys.length
  ) {
    return undefined
  }

  const evidence: SourceBackedEvidence[] = []
  for (const key of normalizedKeys) {
    const reference = references.get(key)
    if (!reference?.checkedAt) return undefined
    evidence.push({...reference, checkedAt: reference.checkedAt})
  }
  return evidence
}
