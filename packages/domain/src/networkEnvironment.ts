import {hasRuntimeObjectType, isRuntimeString} from './runtimeValidation.js'

/**
 * Proxy and CA-bundle hints for feed transport failures.
 *
 * Node's global fetch ignores HTTP(S)_PROXY unless NODE_USE_ENV_PROXY=1 (or
 * --use-env-proxy) is enabled, and honours NODE_EXTRA_CA_CERTS natively. These
 * helpers detect when an environment variable that would have changed the
 * outcome was configured but inert. Only variable names are ever reported —
 * proxy URLs routinely embed credentials and must never reach diagnostics.
 */

export const NETWORK_ENVIRONMENT_HINT_CODES = [
  'proxy_env_not_enabled',
  'ca_bundle_env_not_set',
] as const

export type NetworkEnvironmentHintCode =
  (typeof NETWORK_ENVIRONMENT_HINT_CODES)[number]

export interface NetworkEnvironmentHint {
  readonly code: NetworkEnvironmentHintCode
  /** Environment variable names the operator can act on. Values are never included. */
  readonly variables: readonly string[]
  readonly message: string
}

export interface NetworkEnvironmentSummary {
  readonly httpsProxy: boolean
  readonly httpProxy: boolean
  readonly noProxy: boolean
  /** True when NODE_USE_ENV_PROXY or NODE_OPTIONS=--use-env-proxy activates env-proxy support. */
  readonly envProxyEnabled: boolean
  readonly nodeExtraCaCerts: boolean
}

export type NetworkEnvironmentVariables = Readonly<Record<string, string | undefined>>

const PROXY_VARIABLE_NAMES = [
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'ALL_PROXY',
  'all_proxy',
] as const

// Values shorter than a plausible URL are ignored so redaction cannot mangle
// ordinary prose (a one-character variable value would erase that letter).
const MIN_REDACTED_VALUE_LENGTH = 4
export const REDACTED_NETWORK_VALUE = '[redacted proxy value]'

// TLS failure codes surface as `cause.code` on Node's fetch TypeError.
const TLS_CERTIFICATE_ERROR_CODES = new Set([
  'CERT_CHAIN_TOO_LONG',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_REJECTED',
  'CERT_UNTRUSTED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'HOSTNAME_MISMATCH',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY',
  'UNABLE_TO_DECRYPT_CERT_SIGNATURE',
  'UNABLE_TO_GET_CRL',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
])

const NETWORK_CONNECT_ERROR_CODES = new Set([
  'EADDRNOTAVAIL',
  'EAI_AGAIN',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTDOWN',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
])

const MAX_ERROR_CHAIN_DEPTH = 6

type NetworkFailureKind = 'connect' | 'timeout' | 'tls_certificate' | 'none'

const isEnvironmentSet = (env: NetworkEnvironmentVariables, name: string): boolean => {
  const value = env[name]
  return isRuntimeString(value) && value.trim().length > 0
}

const isEnvironmentProxyEnabled = (env: NetworkEnvironmentVariables): boolean => {
  const flag = env.NODE_USE_ENV_PROXY
  if (isRuntimeString(flag) && ['1', 'true'].includes(flag.trim().toLowerCase())) return true
  const nodeOptions = env.NODE_OPTIONS
  return isRuntimeString(nodeOptions) && nodeOptions.split(/\s+/u).includes('--use-env-proxy')
}

const classifyErrorLevel = (error: object): NetworkFailureKind | 'http_status' => {
  const code = 'code' in error && isRuntimeString(error.code) ? error.code : undefined
  const name = 'name' in error && isRuntimeString(error.name) ? error.name : ''
  const message = 'message' in error && isRuntimeString(error.message) ? error.message : ''

  if (/\bHTTP\s+\d{3}\b/u.test(message)) return 'http_status'
  if (code && TLS_CERTIFICATE_ERROR_CODES.has(code)) return 'tls_certificate'
  if (name === 'TimeoutError' || /\btimed?\s*out\b/iu.test(message) || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return 'timeout'
  }
  if (code && (NETWORK_CONNECT_ERROR_CODES.has(code) || code.startsWith('UND_ERR_'))) {
    return 'connect'
  }
  if (/fetch failed/iu.test(message)) return 'connect'
  return 'none'
}

const classifyNetworkFailure = (error: unknown): NetworkFailureKind => {
  let current: unknown = error
  let depth = 0
  let sawTimeout = false
  let sawConnect = false

  while (hasRuntimeObjectType(current) && current !== null && depth < MAX_ERROR_CHAIN_DEPTH) {
    const level = classifyErrorLevel(current)
    if (level === 'http_status') return 'none'
    if (level === 'tls_certificate') return 'tls_certificate'
    if (level === 'timeout') sawTimeout = true
    if (level === 'connect') sawConnect = true
    current = 'cause' in current ? current.cause : undefined
    depth += 1
  }

  if (sawTimeout) return 'timeout'
  return sawConnect ? 'connect' : 'none'
}

export const summarizeNetworkEnvironment = (
  env: NetworkEnvironmentVariables,
): NetworkEnvironmentSummary => ({
  httpsProxy: isEnvironmentSet(env, 'HTTPS_PROXY') || isEnvironmentSet(env, 'https_proxy'),
  httpProxy: isEnvironmentSet(env, 'HTTP_PROXY') || isEnvironmentSet(env, 'http_proxy'),
  noProxy: isEnvironmentSet(env, 'NO_PROXY') || isEnvironmentSet(env, 'no_proxy'),
  envProxyEnabled: isEnvironmentProxyEnabled(env),
  nodeExtraCaCerts: isEnvironmentSet(env, 'NODE_EXTRA_CA_CERTS'),
})

/**
 * Replace configured proxy variable values in diagnostic text. Node surfaces
 * malformed proxy URLs verbatim in invalid-URL errors and proxies routinely
 * embed credentials, so these values must never reach output. Variable names
 * stay readable; only values are redacted.
 */
export const redactNetworkEnvironmentSecrets = (
  text: string,
  env: NetworkEnvironmentVariables,
): string => {
  let sanitized = text
  for (const name of PROXY_VARIABLE_NAMES) {
    const value = env[name]
    if (!isRuntimeString(value)) continue
    for (const candidate of new Set([value, value.trim()])) {
      if (candidate.length < MIN_REDACTED_VALUE_LENGTH) continue
      sanitized = sanitized.split(candidate).join(REDACTED_NETWORK_VALUE)
    }
  }
  return sanitized
}

/**
 * Return an actionable hint when a transport failure lines up with an inert
 * environment variable, or undefined when the environment cannot explain it.
 * HTTP status failures already reached a server, so they never produce a hint.
 */
export const describeNetworkEnvironmentHint = <ErrorValue>(
  error: ErrorValue,
  env: NetworkEnvironmentVariables,
): NetworkEnvironmentHint | undefined => {
  const failure = classifyNetworkFailure(error)
  if (failure === 'none') return undefined

  if (failure === 'tls_certificate' && !isEnvironmentSet(env, 'NODE_EXTRA_CA_CERTS')) {
    return {
      code: 'ca_bundle_env_not_set',
      variables: ['NODE_EXTRA_CA_CERTS'],
      message:
        'TLS certificate verification failed. If a corporate proxy or antivirus intercepts HTTPS, set NODE_EXTRA_CA_CERTS to the path of the organization CA bundle.',
    }
  }

  const configuredProxyVariables = PROXY_VARIABLE_NAMES.filter((name) => isEnvironmentSet(env, name))
  if (configuredProxyVariables.length > 0 && !isEnvironmentProxyEnabled(env)) {
    const variableNames = configuredProxyVariables.join(' and ')
    return {
      code: 'proxy_env_not_enabled',
      variables: ['NODE_USE_ENV_PROXY'],
      message: `${variableNames} ${configuredProxyVariables.length === 1 ? 'is' : 'are'} set, but Node.js fetch ignores proxy variables until NODE_USE_ENV_PROXY=1 (or --use-env-proxy via NODE_OPTIONS) is enabled.`,
    }
  }

  return undefined
}
