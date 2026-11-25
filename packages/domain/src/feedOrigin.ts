import {normalizePublicHostname, validateAbsoluteHttpUrl} from './urlSafety.js'

const isLoopbackHttpUrl = (url: URL): boolean =>
  url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(normalizePublicHostname(url.hostname))

/** Local citation exceptions belong only to the matching loopback catalog. */
export function isLocalFeedUrl(value: string, siteUrl: string): boolean {
  if (!validateAbsoluteHttpUrl(value).success || !validateAbsoluteHttpUrl(siteUrl).success) return false
  const site = new URL(siteUrl)
  return isLoopbackHttpUrl(site) && site.origin === new URL(value).origin
}

/** A remote feed cannot authorize navigation to the consumer's loopback services. */
export function assertLocalFeedTransportOrigin(siteUrl: string, requestUrl: string): void {
  const site = new URL(siteUrl);
  if (!isLoopbackHttpUrl(site)) return;
  if (site.origin !== new URL(requestUrl).origin) {
    throw new Error('feed_origin_mismatch: A loopback feed siteUrl must match the configured request origin. recovery=Use the matching local catalog base URL or correct the remote feed siteUrl.');
  }
}
