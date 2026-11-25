/**
 * Registrable-domain (eTLD+1) comparison for website-drift decisions: a
 * redirect or proposal that stays on the same registrable domain (www,
 * protocol, path, or subdomain variants) is routine, while a different
 * registrable domain demands explicit operator confirmation.
 *
 * Uses the Public Suffix List (via tldts) to compute the registrable domain;
 * hostnames that cannot be resolved to a registrable domain yield null, which
 * comparison treats as a non-match.
 */

import {getDomain} from 'tldts'

const parseHostname = (url: string): string | null => {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return parsed.hostname.toLowerCase().replace(/\.$/, '')
  } catch {
    return null
  }
}

const isIpAddress = (hostname: string): boolean =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')

/**
 * The registrable domain (eTLD+1) of an http(s) URL, e.g.
 * `https://app.example.co.uk/path` -> `example.co.uk`. Returns null for
 * unparseable or non-http(s) URLs and for hostnames without a registrable
 * domain; IP-address hosts are returned whole.
 */
export const getRegistrableDomain = (url: string | null | undefined): string | null => {
  if (!url) {
    return null
  }
  const hostname = parseHostname(url)
  if (!hostname) {
    return null
  }
  if (isIpAddress(hostname)) {
    return hostname
  }
  // Private suffixes (e.g. github.io) count so distinct tenants on shared
  // hosting are treated as different owners.
  return getDomain(hostname, {allowPrivateDomains: true})
}

/** True when both URLs parse and share one registrable domain. */
export const isSameRegistrableDomain = (
  a: string | null | undefined,
  b: string | null | undefined,
): boolean => {
  const domainA = getRegistrableDomain(a)
  const domainB = getRegistrableDomain(b)
  return domainA !== null && domainB !== null && domainA === domainB
}
