import {isRuntimeBoolean, isRuntimeString} from './runtimeValidation.js'
import type {JsonValue} from './jsonValue.js'
export const CATALOG_DESTINATION_HEALTH_VALUES = ['healthy'] as const

export type CatalogDestinationHealthFilter =
  (typeof CATALOG_DESTINATION_HEALTH_VALUES)[number]

export interface CatalogFreshnessFilterInput {
  destinationHealth?: JsonValue
  verified?: JsonValue
  lastCheckedAfter?: JsonValue
}

export interface CatalogFreshnessFilters {
  destinationHealth: CatalogDestinationHealthFilter | null
  verified: true | null
  lastCheckedAfter: string | null
}

export type CatalogFreshnessFilterParseResult =
  | {ok: true; filters: CatalogFreshnessFilters}
  | {ok: false; filters: CatalogFreshnessFilters; errors: string[]}

export interface CatalogSearchFreshnessProjection {
  hasDeadDestination?: boolean
  verifiedAt?: string
  lastCheckedAt?: string
}

export interface CatalogSearchFreshnessProjectionSource {
  hasDeadDestination?: JsonValue
  verifiedAt?: JsonValue
  lastCheckedAt?: JsonValue
}

const EMPTY_FILTERS: CatalogFreshnessFilters = {
  destinationHealth: null,
  verified: null,
  lastCheckedAfter: null,
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const ISO_TIMESTAMP_PATTERN =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/

export const isExactUtcDate = (value: JsonValue): value is string => {
  if (!isRuntimeString(value) || !DATE_ONLY_PATTERN.test(value)) {
    return false
  }

  const timestamp = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
}

export const isValidCatalogTimestamp = (value: JsonValue): value is string => {
  if (!isRuntimeString(value)) return false
  const match = ISO_TIMESTAMP_PATTERN.exec(value)
  if (!match || !isExactUtcDate(match[1])) return false

  const [, , hour, minute, second, offsetHour = '00', offsetMinute = '00'] = match
  return (
    Number(hour) < 24 &&
    Number(minute) < 60 &&
    Number(second) < 60 &&
    Number(offsetHour) < 24 &&
    Number(offsetMinute) < 60 &&
    Number.isFinite(Date.parse(value))
  )
}

export const isCatalogTimestampAtOrBefore = (
  value: JsonValue,
  now: Date = new Date(),
): value is string =>
  isValidCatalogTimestamp(value) &&
  Number.isFinite(now.getTime()) &&
  Date.parse(value) <= now.getTime()

export const parseCatalogFreshnessFilters = (
  input: CatalogFreshnessFilterInput,
): CatalogFreshnessFilterParseResult => {
  const filters = {...EMPTY_FILTERS}
  const errors: string[] = []

  if (input.destinationHealth !== undefined && input.destinationHealth !== null) {
    if (input.destinationHealth === 'healthy') {
      filters.destinationHealth = 'healthy'
    } else {
      errors.push("destinationHealth must be 'healthy'")
    }
  }

  if (input.verified !== undefined && input.verified !== null) {
    if (input.verified === true || input.verified === 'true') {
      filters.verified = true
    } else {
      errors.push("verified must be 'true'")
    }
  }

  if (input.lastCheckedAfter !== undefined && input.lastCheckedAfter !== null) {
    if (isExactUtcDate(input.lastCheckedAfter)) {
      filters.lastCheckedAfter = input.lastCheckedAfter
    } else {
      errors.push('lastCheckedAfter must be an exact UTC date in YYYY-MM-DD format')
    }
  }

  return errors.length > 0 ? {ok: false, filters, errors} : {ok: true, filters}
}

export const matchesCatalogFreshnessFilters = (
  projection: CatalogSearchFreshnessProjection | null | undefined,
  parsed: CatalogFreshnessFilterParseResult,
): boolean => {
  if (!parsed.ok) {
    return false
  }

  const {filters} = parsed
  const safeProjection = projection ?? {}

  if (filters.destinationHealth && safeProjection.hasDeadDestination !== false) {
    return false
  }

  if (filters.verified && !isCatalogTimestampAtOrBefore(safeProjection.verifiedAt)) {
    return false
  }

  if (filters.lastCheckedAfter) {
    if (!isValidCatalogTimestamp(safeProjection.lastCheckedAt)) {
      return false
    }

    const lowerBound = Date.parse(`${filters.lastCheckedAfter}T00:00:00.000Z`)
    if (Date.parse(safeProjection.lastCheckedAt) < lowerBound) {
      return false
    }
  }

  return true
}

export const buildCatalogSearchFreshnessProjection = <
  TSource extends CatalogSearchFreshnessProjectionSource,
>(
  source: TSource,
  now: Date = new Date(),
): CatalogSearchFreshnessProjection => ({
  ...(isRuntimeBoolean(source.hasDeadDestination) ? { hasDeadDestination: source.hasDeadDestination } : undefined),
  ...(isCatalogTimestampAtOrBefore(source.verifiedAt, now) ? { verifiedAt: source.verifiedAt } : undefined),
  ...(isValidCatalogTimestamp(source.lastCheckedAt) ? { lastCheckedAt: source.lastCheckedAt } : undefined)
})
