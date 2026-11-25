export const safeDiagnostic = <Value>(value: Value): string => String(value)
  .replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim()

export const serializeTerminalSafeJson = <Value>(value: Value, space?: number): string => {
  const serialized = JSON.stringify(value, null, space)
  if (serialized === undefined) return 'null'
  return serialized.replace(
    /[\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/gu,
    (character) => `\\u${character.codePointAt(0)!.toString(16).padStart(4, '0')}`,
  )
}
