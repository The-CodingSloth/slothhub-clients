import {validateAbsoluteHttpUrl} from './urlSafety.js'

export type AdvertisedCatalogFeedGroup = 'feeds' | 'snapshots'

export interface AdvertisedCatalogUrlMap {
  readonly [key: string]: string | undefined
}

export interface AdvertisedCatalogFeeds extends AdvertisedCatalogUrlMap {
  readonly tools: string
  readonly projectManifestTools?: string
  readonly toolLookup?: string
  readonly searchIndex: string
  readonly categories: string
  readonly tags: string
  readonly useCases: string
  readonly stacks: string
  readonly best: string
  readonly alternatives?: string
  readonly comparisons?: string
  readonly articles?: string
}

export interface AdvertisedCatalogSnapshots extends AdvertisedCatalogUrlMap {
  readonly full: string
  readonly ndjson: string
}

export interface AdvertisedCatalogIndex {
  readonly feeds: AdvertisedCatalogUrlMap
  readonly snapshots?: AdvertisedCatalogUrlMap
}

export interface AdvertisedCatalogFeedUrl {
  group: AdvertisedCatalogFeedGroup
  key: string
  url: string
}

const ADVERTISED_CATALOG_FEED_GROUPS = ['feeds', 'snapshots'] as const
const ADVERTISED_CATALOG_FEED_LIMIT_RECOVERY =
  'Use a catalog index that advertises no more than the configured public URL limit.'
const INVALID_ADVERTISED_CATALOG_URL_RECOVERY =
  'Remove tracked visit URLs and advertise only absolute HTTP(S) catalog URLs.'

// Receipt (2026-08-29): the current registry advertises 14 feeds plus 2 snapshots.
// Four times that measured catalog leaves room for additive keys while bounding a
// doctor run initiated from an externally controlled, allowed preview index.
export const MAX_ADVERTISED_CATALOG_URLS = 64

export class AdvertisedCatalogFeedLimitError extends Error {
  readonly code = 'advertised_catalog_feed_limit_exceeded'
  readonly recovery = ADVERTISED_CATALOG_FEED_LIMIT_RECOVERY

  constructor(
    readonly configuredLimit: number,
    readonly observedCount: number,
  ) {
    super(
      `advertised_catalog_feed_limit_exceeded: configured_limit=${configuredLimit} observed_count=${observedCount} recovery=${ADVERTISED_CATALOG_FEED_LIMIT_RECOVERY}`,
    )
    this.name = 'AdvertisedCatalogFeedLimitError'
  }
}

export class InvalidAdvertisedCatalogUrlError extends Error {
  readonly code = 'invalid_advertised_catalog_url'
  readonly recovery = INVALID_ADVERTISED_CATALOG_URL_RECOVERY

  constructor(
    readonly group: AdvertisedCatalogFeedGroup,
    readonly key: string,
  ) {
    super(
      'invalid_advertised_catalog_url: An advertised catalog URL is malformed or uses a tracked visit route.',
    )
    this.name = 'InvalidAdvertisedCatalogUrlError'
  }
}

const isTrackedVisitUrl = (value: string): boolean => {
  try {
    return new URL(value).pathname.split('/').some((segment) => {
      try {
        return decodeURIComponent(segment).toLowerCase() === 'go'
      } catch {
        return true
      }
    })
  } catch {
    return false
  }
}

export const listAdvertisedCatalogFeeds = (
  index: AdvertisedCatalogIndex,
): AdvertisedCatalogFeedUrl[] => {
  const advertised: AdvertisedCatalogFeedUrl[] = []

  for (const group of ADVERTISED_CATALOG_FEED_GROUPS) {
    const record = index[group]
    if (!record) continue
    for (const [key, url] of Object.entries(record)) {
      if (url === undefined) continue
      if (!validateAbsoluteHttpUrl(url).success || isTrackedVisitUrl(url)) {
        throw new InvalidAdvertisedCatalogUrlError(group, key)
      }
      advertised.push({group, key, url})
    }
  }

  if (advertised.length > MAX_ADVERTISED_CATALOG_URLS) {
    throw new AdvertisedCatalogFeedLimitError(
      MAX_ADVERTISED_CATALOG_URLS,
      advertised.length,
    )
  }

  return advertised
}
