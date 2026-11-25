import type {JsonValue} from './jsonValue.js'
import {isRuntimeString} from './runtimeValidation.js'

/**
 * One browse filter over the reviewed `deployment.sourceAvailability` fact,
 * shared by browser search, browse pages, the search index, CLI and MCP.
 *
 * The filter takes the full closed vocabulary rather than a yes/no switch: a
 * "not open source" option would merge closed-source, source-available and
 * unassessed Tools, and unassessed Tools (45 of 207 on 2026-11-24) must never
 * be presented as either. Human pages offer only the open-source value.
 */
// The vocabulary lives here, free of schema dependencies, so browser bundles
// can filter without loading zod; toolDeployment.ts builds its schema from it.
export const SOURCE_AVAILABILITY_FILTER_VALUES = ['open_source', 'source_available', 'closed_source'] as const
export type SourceAvailabilityFilterValue = (typeof SOURCE_AVAILABILITY_FILTER_VALUES)[number]

/** URL, feed and agent parameter name; CLI spells it --source-availability and MCP source_availability. */
export const SOURCE_AVAILABILITY_FILTER_PARAMETER = 'sourceAvailability'

/** The value human browse and search controls expose. */
export const OPEN_SOURCE_FILTER_VALUE = 'open_source' satisfies SourceAvailabilityFilterValue

export const SOURCE_AVAILABILITY_FILTER_MATCH_RULE =
  'Matches the reviewed deployment.sourceAvailability fact exactly (open_source, source_available or closed_source). Tools without a reviewed fact never match any value.'

export const SOURCE_AVAILABILITY_FILTER_LABELS = {
  open_source: 'Open source', source_available: 'Source available', closed_source: 'Closed source',
} satisfies Record<SourceAvailabilityFilterValue, string>

const sourceAvailabilitySet = new Set<string>(SOURCE_AVAILABILITY_FILTER_VALUES)

export const isSourceAvailabilityFilterValue = (
  value: JsonValue | undefined,
): value is SourceAvailabilityFilterValue =>
  isRuntimeString(value) && sourceAvailabilitySet.has(value)

/** Accepts the URL spelling and agent-typed variants such as `open-source` or `Open source`. */
export const normalizeSourceAvailabilityFilter = (
  value: string | null | undefined,
): SourceAvailabilityFilterValue | null => {
  const normalized = (value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  return isSourceAvailabilityFilterValue(normalized) ? normalized : null
}

/**
 * True when no filter is set, or when the Tool's reviewed fact equals it. An
 * unrecognised filter value matches nothing, so a typo never widens results.
 */
export const matchesSourceAvailability = (
  sourceAvailability: string | null | undefined,
  filter: JsonValue | undefined,
): boolean => {
  if (filter === undefined || filter === null || filter === '') return true
  return isSourceAvailabilityFilterValue(filter) && sourceAvailability === filter
}
