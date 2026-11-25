export type ToolWebsiteMatchKind = 'duplicate' | 'same-host' | 'none'

export type ToolWebsiteCandidate = {
  website?: string | null
}

const TRACKING_PARAM_NAMES = new Set(['ref', 'source'])

const isTrackingParam = (key: string): boolean => {
  const normalizedKey = key.toLowerCase()
  return normalizedKey.startsWith('utm_') || TRACKING_PARAM_NAMES.has(normalizedKey)
}

const parseHttpUrl = (value: string | null | undefined): URL | null => {
  if (!value) {
    return null
  }

  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null
    }
    if (url.username || url.password) {
      return null
    }
    return url
  } catch {
    return null
  }
}

const removeTrackingParams = (url: URL): void => {
  const paramsToDelete: string[] = []

  for (const [key] of url.searchParams) {
    if (isTrackingParam(key)) {
      paramsToDelete.push(key)
    }
  }

  paramsToDelete.forEach((key) => url.searchParams.delete(key))
}

const normalizePathname = (pathname: string): string => {
  if (pathname === '/') {
    return ''
  }

  return pathname.replace(/\/+$/, '')
}

const sortedSearchParams = (url: URL): string => {
  const params = Array.from(url.searchParams.entries()).sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    if (leftKey === rightKey) {
      return leftValue.localeCompare(rightValue)
    }
    return leftKey.localeCompare(rightKey)
  })

  return new URLSearchParams(params).toString()
}

export const normalizeToolWebsiteForStorage = (value: string | null | undefined): string | null => {
  const url = parseHttpUrl(value)
  if (!url) {
    return null
  }

  url.hostname = url.hostname.toLowerCase()
  url.hash = ''
  removeTrackingParams(url)

  const search = url.searchParams.toString()
  const pathname = url.pathname === '/' && search ? '/' : normalizePathname(url.pathname)

  return `${url.protocol}//${url.host}${pathname}${search ? `?${search}` : ''}`
}

export const getToolWebsiteIdentityKey = (value: string | null | undefined): string | null => {
  const url = parseHttpUrl(value)
  if (!url) {
    return null
  }

  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '')
  url.hash = ''
  removeTrackingParams(url)

  const pathname = normalizePathname(url.pathname)
  const search = sortedSearchParams(url)

  return `${url.host}${pathname}${search ? `?${search}` : ''}`
}

export const getToolWebsiteHost = (value: string | null | undefined): string | null => {
  const url = parseHttpUrl(value)
  return url?.hostname.toLowerCase().replace(/^www\./, '') ?? null
}

export const classifyToolWebsiteMatch = (
  submittedWebsite: string | null | undefined,
  candidate: ToolWebsiteCandidate,
): ToolWebsiteMatchKind => {
  const submittedKey = getToolWebsiteIdentityKey(submittedWebsite)
  const candidateKey = getToolWebsiteIdentityKey(candidate.website)

  if (submittedKey && candidateKey && submittedKey === candidateKey) {
    return 'duplicate'
  }

  const submittedHost = getToolWebsiteHost(submittedWebsite)
  const candidateHost = getToolWebsiteHost(candidate.website)

  if (submittedHost && candidateHost && submittedHost === candidateHost) {
    return 'same-host'
  }

  return 'none'
}
