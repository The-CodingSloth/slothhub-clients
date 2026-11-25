export const PUBLIC_TEXT_UNSAFE_CHARACTERS = [
  ...Array.from({length: 32}, (_, index) => String.fromCodePoint(index)),
  ...Array.from({length: 33}, (_, index) => String.fromCodePoint(0x7f + index)),
  '\u061c',
  '\u200e',
  '\u200f',
  '\u2028',
  '\u2029',
  ...Array.from({length: 5}, (_, index) => String.fromCodePoint(0x202a + index)),
  ...Array.from({length: 4}, (_, index) => String.fromCodePoint(0x2066 + index)),
] as const

const UNSAFE_PUBLIC_TEXT_PATTERN = new RegExp(
  `[${PUBLIC_TEXT_UNSAFE_CHARACTERS.join('')}]`,
  'u',
)

export const containsUnsafePublicTextCharacters = (value: string): boolean =>
  UNSAFE_PUBLIC_TEXT_PATTERN.test(value)

export const isSafePublicText = (value: string): boolean =>
  value.length > 0 &&
  value.trim() === value &&
  !containsUnsafePublicTextCharacters(value)
