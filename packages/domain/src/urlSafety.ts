const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'local',
  'internal',
  'home.arpa',
]);

export interface SafeUrlResult {
  success: boolean;
  url?: string;
  error?: string;
}

const isPrivateIpv4 = (hostname: string): boolean => {
  const parts = hostname.split('.').map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
};

export const normalizePublicHostname = (hostname: string): string => {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  return normalized.startsWith('[') && normalized.endsWith(']')
    ? normalized.slice(1, -1)
    : normalized;
};

const getIpv4AddressFromTail = (tail: string): string | null => {
  if (tail.includes('.')) {
    return tail;
  }

  const hextets = tail.split(':');
  if (hextets.length !== 2) {
    return null;
  }

  const [high, low] = hextets.map((hextet) => Number.parseInt(hextet, 16));
  if (
    [high, low].some(
      (part) => !Number.isInteger(part) || part < 0 || part > 0xffff
    )
  ) {
    return null;
  }

  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
};

const getIpv4MappedAddress = (hostname: string): string | null => {
  if (!hostname.startsWith('::ffff:')) {
    return null;
  }

  return getIpv4AddressFromTail(hostname.slice('::ffff:'.length));
};

const getIpv4TranslatedAddress = (hostname: string): string | null => {
  const prefix = '::ffff:0:';
  if (!hostname.startsWith(prefix)) {
    return null;
  }

  return getIpv4AddressFromTail(hostname.slice(prefix.length));
};

const getNat64WellKnownAddress = (hostname: string): string | null => {
  const prefix = '64:ff9b::';
  if (!hostname.startsWith(prefix)) {
    return null;
  }

  return getIpv4AddressFromTail(hostname.slice(prefix.length));
};

const getIpv4CompatibleAddress = (hostname: string): string | null => {
  if (!hostname.startsWith('::') || hostname.startsWith('::ffff:')) {
    return null;
  }

  return getIpv4AddressFromTail(hostname.slice('::'.length));
};

const isPrivateIpv6 = (hostname: string): boolean => {
  const normalized = normalizePublicHostname(hostname);
  if (!normalized.includes(':')) {
    return false;
  }

  const ipv4MappedAddress = getIpv4MappedAddress(normalized);
  const ipv4TranslatedAddress = getIpv4TranslatedAddress(normalized);
  const ipv4CompatibleAddress = getIpv4CompatibleAddress(normalized);
  const nat64WellKnownAddress = getNat64WellKnownAddress(normalized);
  const firstHextet = Number.parseInt(normalized.split(':')[0] ?? '', 16);
  const isLinkLocal =
    Number.isInteger(firstHextet) &&
    firstHextet >= 0xfe80 &&
    firstHextet <= 0xfebf;
  const isDeprecatedSiteLocal =
    Number.isInteger(firstHextet) &&
    firstHextet >= 0xfec0 &&
    firstHextet <= 0xfeff;

  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    isLinkLocal ||
    isDeprecatedSiteLocal ||
    normalized.startsWith('ff') ||
    normalized.startsWith('64:ff9b:1:') ||
    (ipv4MappedAddress !== null && isPrivateIpv4(ipv4MappedAddress)) ||
    (ipv4TranslatedAddress !== null && isPrivateIpv4(ipv4TranslatedAddress)) ||
    (ipv4CompatibleAddress !== null && isPrivateIpv4(ipv4CompatibleAddress)) ||
    (nat64WellKnownAddress !== null && isPrivateIpv4(nat64WellKnownAddress))
  );
};

export const isBlockedPublicHostname = (hostname: string): boolean => {
  const normalized = normalizePublicHostname(hostname);
  return (
    BLOCKED_HOSTNAMES.has(normalized) ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized.endsWith('.home.arpa') ||
    isPrivateIpv4(normalized) ||
    isPrivateIpv6(normalized)
  );
};

/** Validates http(s) URLs for first-party metadata (detail pages, feeds). Allows localhost. */
export const validateAbsoluteHttpUrl = (value: string): SafeUrlResult => {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(value);
  } catch {
    return { success: false, error: 'Invalid URL format' };
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return { success: false, error: 'Only http(s) URLs are allowed' };
  }

  if (parsedUrl.username || parsedUrl.password) {
    return {
      success: false,
      error: 'URLs with embedded credentials are not allowed',
    };
  }

  return { success: true, url: value.trim() };
};

export const validatePublicHttpUrl = (value: string): SafeUrlResult => {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(value);
  } catch {
    return { success: false, error: 'Invalid URL format' };
  }

  // Reject escaped authority input before WHATWG decoding can erase its origin.
  // Escapes in paths and queries remain valid. Backslashes are separators for
  // special URLs too, matching the parser's treatment of legacy HTTP spellings.
  const authority = value.replace(/[\t\n\r]/g, '').match(/^[^:]+:[\\/]*([^\\/?#]*)/)?.[1];
  if (authority?.includes('%') || parsedUrl.hostname.includes('%')) {
    return { success: false, error: 'Invalid URL hostname' };
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return { success: false, error: 'Only http(s) URLs are allowed' };
  }

  if (parsedUrl.username || parsedUrl.password) {
    return {
      success: false,
      error: 'URLs with embedded credentials are not allowed',
    };
  }

  if (isBlockedPublicHostname(parsedUrl.hostname)) {
    return { success: false, error: 'URL must point to a public URL' };
  }

  return { success: true, url: value.trim() };
};

export const getPublicHttpUrl = (
  value: string | null | undefined
): string | null => {
  if (!value) {
    return null;
  }

  const result = validatePublicHttpUrl(value);
  return result.success ? result.url ?? null : null;
};
