import type {JsonValue} from './jsonValue.js'
import {
  normalizePublicMetadataText,
} from './publicMetadata.js'
import type {JsonObject} from './jsonValue.js'
import {hasRuntimeObjectType, isRuntimeBoolean, isRuntimeString} from './runtimeValidation.js'

const isJsonObject = (value: JsonValue): value is JsonObject =>
  hasRuntimeObjectType(value) && value !== null && !Array.isArray(value)

/** Consenting identity for article bylines and Tool reviewer attribution. */

export const CONTRIBUTOR_NAME_MAX_LENGTH = 120

export const CONTRIBUTOR_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const normalizeContributorSlug = (value: JsonValue): string | undefined => {
  if (!isRuntimeString(value)) return undefined
  const slug = value.trim()
  return slug.length <= 96 && CONTRIBUTOR_SLUG_PATTERN.test(slug) ? slug : undefined
}

/** Compact byline/attribution projection: just identity, no profile body. */
export interface PublicContributorAttribution {
  name: string
  slug: string
  retired: boolean
}

export const normalizeContributorAttribution = (
  source: JsonValue,
): PublicContributorAttribution | null => {
  if (!isJsonObject(source)) return null
  const name = normalizePublicMetadataText(
    source.name,
    CONTRIBUTOR_NAME_MAX_LENGTH,
  )
  const slug = normalizeContributorSlug(source.slug)
  if (!name || !slug) return null
  return {name, slug, retired: isRuntimeBoolean(source.retired) && source.retired}
}
