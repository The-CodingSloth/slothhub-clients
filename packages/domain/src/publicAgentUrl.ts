import {SLOTHHUB_PUBLIC_HOSTNAMES} from './publicHostnames.js'
import {isValidToolPublicSlug} from './toolLookup.js'
import {isBlockedPublicHostname, normalizePublicHostname} from './urlSafety.js'

export const TRACKED_OUTBOUND_SURFACES = [
  'web',
  'tool_page',
  'mobile',
  'extension',
  'email',
  'agent',
  'comparison',
  'deal',
] as const

export type TrackedOutboundSurface = (typeof TRACKED_OUTBOUND_SURFACES)[number]

export interface PublicToolUrlRecord {
  slug: string
  detailUrl: string
  visitUrl: string
}

const OUTPUT_CONTROL_OR_BIDI =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u

const decodeForInspection = (value: string): string | undefined => {
  let decoded = value
  try {
    for (let pass = 0; pass < 5; pass += 1) {
      const next = decodeURIComponent(decoded)
      if (next === decoded) return decoded
      decoded = next
    }
    return decoded.includes('%') ? undefined : decoded
  } catch {
    return undefined
  }
}

interface InspectedPublicHttpsUrl {
  decoded: string
  url: URL
}

const SLOTHHUB_PUBLIC_HOSTNAME_SET = new Set(SLOTHHUB_PUBLIC_HOSTNAMES)

const isSlothHubDeploymentHostname = (hostname: string): boolean =>
  SLOTHHUB_PUBLIC_HOSTNAME_SET.has(normalizePublicHostname(hostname))

const inspectPublicHttpsUrl = (value: string): InspectedPublicHttpsUrl | undefined => {
  const decoded = decodeForInspection(value)
  if (value.trim() !== value || decoded === undefined || OUTPUT_CONTROL_OR_BIDI.test(decoded)) {
    return undefined
  }

  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      isBlockedPublicHostname(url.hostname)
    ) {
      return undefined
    }
    return {decoded, url}
  } catch {
    return undefined
  }
}

const containsTrackedOutboundReference = (decoded: string): boolean => {
  const normalized = decoded.replaceAll('\\', '/').toLowerCase()
  return normalized.endsWith('/go') || normalized.includes('/go/')
}

const getTrustedCatalogOrigin = (siteUrl: string): string | undefined => {
  const url = inspectPublicHttpsUrl(siteUrl)?.url
  if (!url || !isSlothHubDeploymentHostname(url.hostname)) return undefined
  if (url.pathname !== '/' || url.search || url.hash) return undefined
  return url.origin
}

export const getTrackedOutboundPath = (
  slug: string,
  surface: TrackedOutboundSurface = 'web',
): string => `/go/${encodeURIComponent(slug)}?surface=${encodeURIComponent(surface)}`

export const getCanonicalToolDetailUrl = (
  tool: Pick<PublicToolUrlRecord, 'slug' | 'detailUrl'>,
  siteUrl: string,
): string | undefined => {
  const origin = getTrustedCatalogOrigin(siteUrl)
  if (!origin || !isValidToolPublicSlug(tool.slug)) return undefined

  const expected = `${origin}/tool/${encodeURIComponent(tool.slug)}`
  const detailUrl = inspectPublicHttpsUrl(tool.detailUrl)?.url
  return detailUrl?.href === expected && tool.detailUrl === expected ? expected : undefined
}

export const getExactTrackedOutboundUrl = (
  tool: PublicToolUrlRecord,
  siteUrl: string,
  surface: TrackedOutboundSurface,
): string | undefined => {
  const origin = getTrustedCatalogOrigin(siteUrl)
  if (!origin || !getCanonicalToolDetailUrl(tool, siteUrl)) return undefined

  const expected = `${origin}${getTrackedOutboundPath(tool.slug, surface)}`
  const visitUrl = inspectPublicHttpsUrl(tool.visitUrl)?.url
  return visitUrl?.href === expected && tool.visitUrl === expected ? expected : undefined
}

export const getSafeCitationUrl = (value: string | undefined): string | undefined => {
  if (!value) return undefined
  const inspected = inspectPublicHttpsUrl(value)
  if (!inspected || containsTrackedOutboundReference(inspected.decoded)) return undefined
  return inspected.url.href
}
