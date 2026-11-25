import {isRuntimeString} from './runtimeValidation.js'
import type {JsonValue} from './jsonValue.js'
export const REGISTRY_ENRICHMENT_SOURCE_VALUES = [
  'github',
  'gitlab',
  'npm',
  'pypi',
  'crates',
  'mcp_registry',
] as const

export type RegistryEnrichmentSource =
  (typeof REGISTRY_ENRICHMENT_SOURCE_VALUES)[number]

// SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
export const isRegistryEnrichmentSource = (
  value: JsonValue,
): value is RegistryEnrichmentSource =>
  isRuntimeString(value) &&
  REGISTRY_ENRICHMENT_SOURCE_VALUES.includes(/* SAFETY: The adjacent guard or owner API establishes this asserted contract before use. */ value as RegistryEnrichmentSource)

export const getRegistryResourceIdentityKey = (
  source: RegistryEnrichmentSource,
  registryId: string,
): string => {
  const normalizedId =
    source === 'pypi'
      ? registryId.toLowerCase().replace(/[._-]+/gu, '-')
      : source === 'github' || source === 'gitlab'
        ? registryId.replace(/\.git$/iu, '').toLowerCase()
        : source === 'npm'
          ? registryId.toLowerCase()
          : registryId
  return `${source}:${normalizedId}`
}
