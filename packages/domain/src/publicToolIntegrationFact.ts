import {hasRuntimeObjectType, isRuntimeNumber, isRuntimeString} from './runtimeValidation.js'
import type {JsonValue} from './jsonValue.js'
import {canonicalJson} from './canonicalJson.js'
import {
  isIntegrationStatus,
  type IntegrationStatus,
} from './integrationStatus.js'
import {isValidCatalogTimestamp} from './catalogFreshnessSearch.js'
import {validatePublicHttpUrl} from './urlSafety.js'
import {MAX_PUBLIC_METADATA_LABEL_LENGTH} from './publicMetadata.js'

export const MAX_PUBLIC_TOOL_INTEGRATIONS = 50
export const MAX_PUBLIC_EVIDENCE_CLOCK_SKEW_MS = 5 * 60 * 1000

export interface PublicToolIntegrationFactInput {
  slug?: JsonValue
  name?: JsonValue
  status?: JsonValue
  extensionName?: JsonValue
  checkedAt?: JsonValue
  sourceUrl?: JsonValue
}

export interface PublicToolIntegrationFact {
  slug: string
  name: string
  status: IntegrationStatus
  extensionName?: string
  checkedAt?: string
  sourceUrl?: string
}

const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu

const normalizeText = (value: JsonValue, maxLength: number): string | undefined => {
  if (!isRuntimeString(value)) return undefined
  const text = value
    .normalize('NFC')
    .replace(UNSAFE_TEXT, ' ')
    .trim()
    .replace(/\s+/gu, ' ')
  return text ? text.slice(0, maxLength) : undefined
}

export const normalizePublicToolIntegrationSlug = (value: JsonValue): string | undefined => {
  const slug = normalizeText(value, 120)?.toLowerCase()
  return slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug) ? slug : undefined
}

const normalizeCheckedAt = (
  value: JsonValue,
  nowMs: number,
  maxFutureSkewMs: number,
): string | undefined => {
  const checkedAt = normalizeText(value, 40)
  if (!checkedAt || !isValidCatalogTimestamp(checkedAt)) return undefined
  const timestamp = Date.parse(checkedAt)
  return timestamp <= nowMs + maxFutureSkewMs
    ? new Date(timestamp).toISOString()
    : undefined
}

const normalizeSourceUrl = (value: JsonValue): string | undefined => {
  const sourceUrl = normalizeText(value, 500)
  if (!sourceUrl) return undefined
  const validation = validatePublicHttpUrl(sourceUrl)
  return validation.success && validation.url
    ? new URL(validation.url).href
    : undefined
}

const STATUS_PRECEDENCE = {
  incompatible: 4,
  native: 3,
  api: 2,
  via_automation: 1,
  via_extension: 1,
  unknown: 0,
} satisfies Record<IntegrationStatus, number>

const preferFact = (
  current: PublicToolIntegrationFact,
  candidate: PublicToolIntegrationFact,
): PublicToolIntegrationFact => {
  const precedence = STATUS_PRECEDENCE[candidate.status] - STATUS_PRECEDENCE[current.status]
  if (precedence !== 0) return precedence > 0 ? candidate : current
  return canonicalJson(candidate) < canonicalJson(current) ? candidate : current
}

/**
 * Deep public contract for Tool–Integration evidence.
 *
 * Callers may pass wider Studio/feed objects; only the compact allowlisted
 * fields survive. The cap and deterministic duplicate rule are shared by
 * browser, CLI, feed, and MCP adapters.
 */
export const normalizePublicToolIntegrationFacts = <Input>(
  value: Input,
  options: {
    now?: string | number | Date
    maxFutureSkewMs?: number
  } = {},
): PublicToolIntegrationFact[] => {
  if (!Array.isArray(value)) return []
  const parsedNow =
    options.now instanceof Date
      ? options.now.getTime()
      : isRuntimeString(options.now)
        ? Date.parse(options.now)
        : options.now
  const nowMs =
    isRuntimeNumber(parsedNow) && Number.isFinite(parsedNow)
      ? parsedNow
      : Date.now()
  const maxFutureSkewMs =
    isRuntimeNumber(options.maxFutureSkewMs) &&
    Number.isFinite(options.maxFutureSkewMs) &&
    options.maxFutureSkewMs >= 0
      ? options.maxFutureSkewMs
      : MAX_PUBLIC_EVIDENCE_CLOCK_SKEW_MS
  const bySlug = new Map<string, PublicToolIntegrationFact>()
  for (const candidate of value) {
    if (!candidate || !hasRuntimeObjectType(candidate)) continue
    // SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
    const input = candidate as PublicToolIntegrationFactInput
    const slug = normalizePublicToolIntegrationSlug(input.slug)
    const name = normalizeText(input.name, 160)
    if (!slug || !name || !isIntegrationStatus(input.status)) continue
    const rawCheckedAt = normalizeText(input.checkedAt, 40)
    if (
      rawCheckedAt &&
      isValidCatalogTimestamp(rawCheckedAt) &&
      Date.parse(rawCheckedAt) > nowMs + maxFutureSkewMs
    ) {
      continue
    }
    const checkedAt = normalizeCheckedAt(input.checkedAt, nowMs, maxFutureSkewMs)
    const sourceUrl = normalizeSourceUrl(input.sourceUrl)
    const extensionName = input.status === 'via_extension' ? normalizeText(input.extensionName, MAX_PUBLIC_METADATA_LABEL_LENGTH) : undefined
    // Every public compatibility claim needs dated evidence. Unknown is editorial work in progress.
    if (input.status === 'unknown' || !checkedAt || !sourceUrl) continue
    const fact: PublicToolIntegrationFact = {
      slug, name, status: input.status,
      ...(extensionName ? { extensionName } : undefined),
      ...(checkedAt ? { checkedAt } : undefined),
      ...(sourceUrl ? { sourceUrl } : undefined)
    }
    const current = bySlug.get(slug)
    bySlug.set(slug, current ? preferFact(current, fact) : fact)
  }
  return [...bySlug.values()]
    .sort((left, right) => (left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0))
    .slice(0, MAX_PUBLIC_TOOL_INTEGRATIONS)
}
