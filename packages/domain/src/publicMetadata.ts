import type {JsonValue} from './jsonValue.js'
import {isRuntimeString} from './runtimeValidation.js'
import {validatePublicHttpUrl} from './urlSafety.js'

export const MAX_PUBLIC_METADATA_URL_LENGTH = 2048
export const MAX_PUBLIC_METADATA_LABEL_LENGTH = 160
export const MAX_PUBLIC_METADATA_NOTE_LENGTH = 180
export const MAX_PUBLIC_ALTERNATIVE_NOTE_LENGTH = 500

export const PUBLIC_METADATA_CANONICAL_URL_PATTERN = [
  '^(?!.*[\\u0000-\\u001f\\u007f-\\u009f\\u061c\\u200e\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069])',
  '(?!https?://[^/?#]*[A-Z])',
  '(?!https?://[^/?#]*%)',
  '(?!(?:https://[^/?#]*:0*443|http://[^/?#]*:0*80)(?:[/?#]|$))',
  '(?!https?://[^?#]*/(?:\\.|%2[eE]){1,2}(?:[/#?]|$))',
  'https?://',
  '(?![^/?#]*@)',
  '(?=[^/?#]+/)',
  '(?!(?:',
  'localhost(?:\\.localdomain)?|[^/?#]+\\.localhost|metadata\\.google\\.internal|',
  '0(?:\\.\\d+){0,3}|10(?:\\.\\d+){0,3}|100\\.(?:6[4-9]|[7-9]\\d|1[01]\\d|12[0-7])(?:\\.\\d+){0,2}|',
  '127(?:\\.\\d+){0,3}|169\\.254(?:\\.\\d+){0,2}|172\\.(?:1[6-9]|2\\d|3[01])(?:\\.\\d+){0,2}|',
  '192\\.168(?:\\.\\d+){0,2}|198\\.(?:18|19)(?:\\.\\d+){0,2}|(?:22[4-9]|23\\d|24\\d|25[0-5])(?:\\.\\d+){0,3}|',
  '\\d+|0[xX][0-9a-fA-F]+|',
  '\\[(?:::|::1|::ffff(?::0)?:|64:ff9b(?::1)?:|f[cd]|fe[89ab]|ff)[0-9a-fA-F:.]*\\]',
  ')(?::\\d+)?(?:[/?#]|$))',
].join('')

const PUBLIC_TEXT_CONTROL_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu
const PUBLIC_TEXT_CONTROL_TEST_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u

export const normalizePublicMetadataText = (
  value: JsonValue,
  maxLength: number,
): string | undefined => {
  if (!isRuntimeString(value)) return undefined

  const normalized = value.replace(PUBLIC_TEXT_CONTROL_PATTERN, '').replace(/\s+/gu, ' ').trim()
  if (!normalized) return undefined
  if (normalized.length <= maxLength) return normalized

  const truncated = normalized.slice(0, maxLength)
  const safeEnd = /[\uD800-\uDBFF]$/u.test(truncated) ? truncated.slice(0, -1) : truncated
  return safeEnd.trim()
}

export const normalizePublicMetadataUrl = (
  value: JsonValue,
  maxLength: number = MAX_PUBLIC_METADATA_URL_LENGTH,
): string | undefined => {
  if (
    !isRuntimeString(value) ||
    value.length > maxLength ||
    PUBLIC_TEXT_CONTROL_TEST_PATTERN.test(value)
  ) {
    return undefined
  }

  const result = validatePublicHttpUrl(value)
  if (!result.success) return undefined

  const canonical = new URL(result.url ?? value).href
  return canonical.length <= maxLength ? canonical : undefined
}
