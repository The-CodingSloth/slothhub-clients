/** Validate that a runtime value uses JavaScript's string representation. */
export const isRuntimeString = <Value,>(value: Value): value is Value & string =>
  typeof value === 'string'

/** Validate that a runtime value uses JavaScript's number representation, including non-finite numbers. */
export const isRuntimeNumber = <Value,>(value: Value): value is Value & number =>
  typeof value === 'number'

/** Validate that a runtime value uses JavaScript's boolean representation. */
export const isRuntimeBoolean = <Value,>(value: Value): value is Value & boolean =>
  typeof value === 'boolean'

/** Validate that a runtime value is undefined. */
export const isRuntimeUndefined = <Value,>(value: Value): value is Value & undefined =>
  value === undefined

/** Validate that a runtime value uses JavaScript's symbol representation. */
export const isRuntimeSymbol = <Value,>(value: Value): value is Value & symbol =>
  typeof value === 'symbol'

/** Validate that a runtime value is callable. */
export const isRuntimeFunction = <Value,>(
  value: Value,
): value is Value & ((...args: never[]) => never) =>
  typeof value === 'function'

/** Validate JavaScript's object representation exactly, including arrays and null but excluding functions. */
export const hasRuntimeObjectType = <Value,>(
  value: Value,
): value is Value & (object | null) =>
  typeof value === 'object'
