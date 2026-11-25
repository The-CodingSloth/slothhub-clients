import {isRuntimeString} from './runtimeValidation.js'
import type {JsonValue} from './jsonValue.js'
export const INTEGRATION_STATUS_VALUES = [
  'native',
  'via_automation',
  'via_extension',
  'api',
  'incompatible',
  'unknown',
] as const

export type IntegrationStatus = (typeof INTEGRATION_STATUS_VALUES)[number]

export interface IntegrationStatusOption {
  title: string
  value: IntegrationStatus
}

export const DEFAULT_INTEGRATION_STATUS: IntegrationStatus = 'unknown'

/** Positive evidence kinds that satisfy a broad Integration match. */
export const POSITIVE_INTEGRATION_STATUS_VALUES = [
  'native',
  'via_automation',
  'via_extension',
  'api',
] as const

export type PositiveIntegrationStatus =
  (typeof POSITIVE_INTEGRATION_STATUS_VALUES)[number]

export const isPositiveIntegrationStatus = (
  value: string | undefined,
): value is PositiveIntegrationStatus =>
  isRuntimeString(value) &&
  (/* SAFETY: The adjacent guard or owner API establishes this asserted contract before use. */ POSITIVE_INTEGRATION_STATUS_VALUES as readonly string[]).includes(value)

export const INTEGRATION_STATUS_OPTIONS: IntegrationStatusOption[] = [
  {title: 'Native', value: 'native'},
  {title: 'Via automation', value: 'via_automation'},
  {title: 'Via extension/plugin', value: 'via_extension'},
  {title: 'API', value: 'api'},
  {title: 'Incompatible', value: 'incompatible'},
  {title: 'Unknown', value: 'unknown'},
]

// SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
const INTEGRATION_STATUS_LABELS: Record<IntegrationStatus, string> = Object.fromEntries(
  INTEGRATION_STATUS_OPTIONS.map((option) => [option.value, option.title]),
) as Record<IntegrationStatus, string>

// SAFETY: The source is a closed or validated string collection; widening only enables collection operations.
export const isIntegrationStatus = (value: JsonValue): value is IntegrationStatus =>
  isRuntimeString(value) && (/* SAFETY: The adjacent guard or owner API establishes this asserted contract before use. */ INTEGRATION_STATUS_VALUES as readonly string[]).includes(value)

export const toIntegrationStatus = (value: JsonValue): IntegrationStatus =>
  isIntegrationStatus(value) ? value : DEFAULT_INTEGRATION_STATUS

export const getIntegrationStatusLabel = (value: IntegrationStatus): string =>
  INTEGRATION_STATUS_LABELS[value]
