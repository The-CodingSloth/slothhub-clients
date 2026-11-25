import {isRuntimeString} from './runtimeValidation.js'
import type {JsonValue} from './jsonValue.js'
const OBVIOUS_PLACEHOLDER_ALT_TEXT = new Set([
  'test',
  'testing',
  'placeholder',
  'todo',
  'tbd',
  'n/a',
  'alt',
  'alt text',
  'image',
  'screenshot',
  'photo',
  'untitled',
  'test image',
  'test screenshot',
])

const NUMBERED_IMAGE_ALT_TEXT = /^(?:image|screenshot) #?\d+$/

/**
 * Identifies only the media-alt placeholders that editors commonly enter verbatim.
 *
 * Comparison uses NFKC, lowercasing, collapsed whitespace, and removal of ASCII
 * quotes/brackets at the edges plus terminal `. , ! ? : ;` punctuation. Punctuation
 * inside the value is preserved. This intentionally does not guess from substrings or
 * semantic similarity.
 */
export const isObviousPlaceholderAltText = (value: JsonValue): boolean => {
  if (!isRuntimeString(value)) return false

  const normalized = value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^[\s"'`([{<]+|[\s"'`)\]}>.,!?:;]+$/g, '')

  return (
    OBVIOUS_PLACEHOLDER_ALT_TEXT.has(normalized) || NUMBERED_IMAGE_ALT_TEXT.test(normalized)
  )
}
