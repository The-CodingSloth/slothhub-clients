import {z} from 'zod'
import {containsUnsafePublicTextCharacters} from './publicText.js'
import {hasRuntimeObjectType, isRuntimeString} from './runtimeValidation.js'
import type {JsonValue} from './jsonValue.js'
import parseSpdxExpression from 'spdx-expression-parse'

import {
  getRegistryResourceIdentityKey,
  isRegistryEnrichmentSource,
  type RegistryEnrichmentSource,
} from './registryEnrichmentSource.js'

export const licenseFactNoteSchema = z.string().trim().min(1).refine((value) => !containsUnsafePublicTextCharacters(value) && !/[\r\n\t]/u.test(value), 'Use a single line of plain public text for the license note.')

export const LICENSE_FACT_SCOPE_VALUES = [
  'repository',
  'package',
  'resource',
] as const
export const LICENSE_FACT_UNKNOWN_REASON_VALUES = [
  'missing',
  'custom',
  'conflicting',
  'unparseable',
] as const

export type LicenseFactScope = (typeof LICENSE_FACT_SCOPE_VALUES)[number]
export type LicenseFactUnknownReason =
  (typeof LICENSE_FACT_UNKNOWN_REASON_VALUES)[number]

interface SourceBackedLicenseFactBase {
  note?: string
  _key?: string
  scope: LicenseFactScope
  registryId: string
  source: RegistryEnrichmentSource
  sourceUrl: string
  checkedAt: string
}

export type SourceBackedLicenseFact =
  | (SourceBackedLicenseFactBase & {
      status: 'observed'
      spdxExpression: string
      unknownReason?: never
    })
  | (SourceBackedLicenseFactBase & {
      status: 'unknown'
      spdxExpression?: never
      unknownReason: LicenseFactUnknownReason
    })

const readNonEmptyString = (value: JsonValue): string | undefined =>
  isRuntimeString(value) && value.trim() ? value.trim() : undefined

export const isValidSpdxExpression = (value: JsonValue): value is string => {
  const expression = readNonEmptyString(value)
  if (!expression) {
    return false
  }

  try {
    parseSpdxExpression(expression)
    return true
  } catch {
    return false
  }
}

interface ParsedSpdxExpression {
  license?: string
  plus?: boolean
  exception?: string
  conjunction?: string
  left?: ParsedSpdxExpression
  right?: ParsedSpdxExpression
}

const getSpdxNodeIdentity = (node: ParsedSpdxExpression): string => {
  if (node.conjunction && node.left && node.right) {
    const conjunction = node.conjunction.toLowerCase()
    const operands: ParsedSpdxExpression[] = []
    const collectOperands = (candidate: ParsedSpdxExpression): void => {
      if (
        candidate.conjunction?.toLowerCase() === conjunction &&
        candidate.left &&
        candidate.right
      ) {
        collectOperands(candidate.left)
        collectOperands(candidate.right)
        return
      }
      operands.push(candidate)
    }
    collectOperands(node)
    return `${conjunction}(${operands
      .map(getSpdxNodeIdentity)
      .sort()
      .join(',')})`
  }

  return [
    `license:${node.license ?? ''}`,
    `plus:${node.plus === true}`,
    `exception:${node.exception ?? ''}`,
  ].join(';')
}

export const getSpdxExpressionIdentity = (expression: string): string =>
  getSpdxNodeIdentity(
    // SAFETY: spdx-expression-parse returns this recursive SPDX node shape after parsing a validated expression.
    parseSpdxExpression(expression) as ParsedSpdxExpression,
  )

export const normalizeRfc3339Timestamp = (
  value: JsonValue,
): string | undefined => {
  const checkedAt = readNonEmptyString(value)
  const match = checkedAt?.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/u,
  )
  if (!checkedAt || !match) {
    return undefined
  }

  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    offsetHourText,
    offsetMinuteText,
  ] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const offsetHour = Number(offsetHourText ?? 0)
  const offsetMinute = Number(offsetMinuteText ?? 0)
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth =
    [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
      month - 1
    ] ?? 0
  if (
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return undefined
  }

  const timestamp = Date.parse(checkedAt)
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString()
}

const normalizeHttpUrl = (value: string): string | undefined => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}

const LICENSE_SOURCE_HOSTS = {
  github: new Set(['github.com', 'www.github.com']),
  gitlab: new Set(['gitlab.com']),
  npm: new Set(['npmjs.com', 'www.npmjs.com']),
  pypi: new Set(['pypi.org', 'www.pypi.org']),
  crates: new Set(['crates.io', 'www.crates.io']),
  mcp_registry: new Set(['registry.modelcontextprotocol.io']),
} satisfies Record<
  RegistryEnrichmentSource,
  ReadonlySet<string>
>

const normalizeSourceUrl = (
  value: string,
  source: RegistryEnrichmentSource,
  registryId?: string,
): string | undefined => {
  const normalized = normalizeHttpUrl(value)
  if (!normalized) return undefined

  const url = new URL(normalized)
  if (
    url.username ||
    url.password ||
    url.port ||
    !LICENSE_SOURCE_HOSTS[source].has(url.hostname.toLowerCase())
  ) {
    return undefined
  }

  if (!registryId) {
    return url.href
  }

  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(url.pathname).replace(/\/+$/u, '')
  } catch {
    return undefined
  }
  const expectedPath =
    source === 'github' || source === 'gitlab'
      ? `/${registryId.replace(/\.git$/iu, '')}`
      : source === 'npm'
        ? `/package/${registryId}`
        : source === 'pypi'
          ? `/project/${registryId}`
          : source === 'crates'
            ? `/crates/${registryId}`
            : `/servers/${registryId}`

  if (source === 'pypi') {
    const projectPrefix = '/project/'
    if (!decodedPath.toLowerCase().startsWith(projectPrefix)) {
      return undefined
    }
    return getRegistryResourceIdentityKey(
      source,
      decodedPath.slice(projectPrefix.length),
    ) === getRegistryResourceIdentityKey(source, registryId)
      ? url.href
      : undefined
  }

  return decodedPath.toLowerCase() === expectedPath.toLowerCase()
    ? url.href
    : undefined
}

interface SourceBackedLicenseFactCandidate {
  note?: string
  scope?: string
  status?: string
  spdxExpression?: string
  unknownReason?: string
  registryId?: string
  source?: string
  sourceUrl?: string
  checkedAt?: string
}

const normalizeLicenseFact = <Input,>(
  value: Input,
): SourceBackedLicenseFact | undefined => {
  if (!value || !hasRuntimeObjectType(value) || Array.isArray(value)) {
    return undefined
  }

  // SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
  const fact = value as Input & SourceBackedLicenseFactCandidate
  const noteResult = licenseFactNoteSchema.optional().safeParse(fact.note)
  if (!noteResult.success) return undefined
  const note = noteResult.data
  const scopeResult = z.enum(LICENSE_FACT_SCOPE_VALUES).safeParse(fact.scope)
  const scope = scopeResult.success ? scopeResult.data : undefined
  const source = isRegistryEnrichmentSource(fact.source)
    ? fact.source
    : undefined
  const registryId = readNonEmptyString(fact.registryId)
  const sourceUrlValue = readNonEmptyString(fact.sourceUrl)
  const sourceUrl =
    sourceUrlValue && source
      ? normalizeSourceUrl(sourceUrlValue, source, registryId)
      : undefined
  const checkedAt = normalizeRfc3339Timestamp(fact.checkedAt)

  if (!scope || !registryId || !source || !sourceUrl || !checkedAt) {
    return undefined
  }

  if (
    fact.status === 'observed' &&
    isValidSpdxExpression(fact.spdxExpression)
  ) {
    return {
      scope,
      ...(note ? {note} : undefined),
      status: 'observed',
      spdxExpression: fact.spdxExpression.trim(),
      registryId,
      source,
      sourceUrl,
      checkedAt,
    }
  }

  if (fact.status === 'observed') {
    return {
      scope,
      ...(note ? {note} : undefined),
      status: 'unknown',
      unknownReason: 'unparseable',
      registryId,
      source,
      sourceUrl,
      checkedAt,
    }
  }

  if (fact.status !== 'unknown') {
    return undefined
  }

  // SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
  const unknownReason = LICENSE_FACT_UNKNOWN_REASON_VALUES.includes(
    fact.unknownReason as LicenseFactUnknownReason,
  )
    ? (fact.unknownReason as LicenseFactUnknownReason)
    : undefined

  if (!unknownReason) {
    return undefined
  }

  return {
    scope,
    ...(note ? {note} : undefined),
    status: 'unknown',
    unknownReason,
    registryId,
    source,
    sourceUrl,
    checkedAt,
  }
}

export const normalizeSourceBackedLicenseFacts = <Input,>(
  values: readonly Input[] | null | undefined,
): SourceBackedLicenseFact[] => {
  if (!Array.isArray(values)) {
    return []
  }

  const facts = values
    .map(normalizeLicenseFact)
    .filter((fact): fact is SourceBackedLicenseFact => Boolean(fact))

  const observedByResource = new Map<string, Set<string>>()
  for (const fact of facts) {
    if (fact.status !== 'observed' || !fact.spdxExpression) {
      continue
    }
    const resourceKey = `${getRegistryResourceIdentityKey(
      fact.source,
      fact.registryId,
    )}:${fact.scope}`
    const expressions = observedByResource.get(resourceKey) ?? new Set<string>()
    expressions.add(getSpdxExpressionIdentity(fact.spdxExpression))
    observedByResource.set(resourceKey, expressions)
  }

  return facts.map((fact) =>
    fact.status === 'observed' &&
    (observedByResource.get(
      `${getRegistryResourceIdentityKey(
        fact.source,
        fact.registryId,
      )}:${fact.scope}`,
    )?.size ?? 0) > 1
      ? {
          scope: fact.scope,
          ...(fact.note ? {note: fact.note} : undefined),
          status: 'unknown',
          unknownReason: 'conflicting',
          registryId: fact.registryId,
          source: fact.source,
          sourceUrl: fact.sourceUrl,
          checkedAt: fact.checkedAt,
        }
      : fact,
  )
}

export const normalizeRegistryEnrichmentLicenseFacts = <Snapshot>(snapshot: Snapshot) => {
  if (!snapshot || !hasRuntimeObjectType(snapshot)) {
    return []
  }
  // SAFETY: The adjacent boundary checks validate the JSON container and every member read after this point.
  const value = snapshot as {
    source?: JsonValue
    registryId?: JsonValue
    sourceUrl?: JsonValue
    fetchedAt?: JsonValue
    facts?: { licenseFacts?: JsonValue; license?: JsonValue }
  }
  const currentFacts = value.facts?.licenseFacts
  if (Array.isArray(currentFacts)) {
    return normalizeSourceBackedLicenseFacts(currentFacts)
  }

  const source = isRegistryEnrichmentSource(value.source)
    ? value.source
    : undefined
  const registryId = readNonEmptyString(value.registryId)
  const sourceUrl = readNonEmptyString(value.sourceUrl)
  const checkedAt = normalizeRfc3339Timestamp(value.fetchedAt)
  const legacyLicense = readNonEmptyString(value.facts?.license)
  if (!source || !registryId || !sourceUrl || !checkedAt || !legacyLicense) {
    return []
  }
  const legacyLicenseIsSpdx = ((value: string): boolean =>
    isValidSpdxExpression(value))(legacyLicense)

  return normalizeSourceBackedLicenseFacts([
    {
      scope:
        source === 'github'
          ? 'repository'
          : source === 'mcp_registry'
            ? 'resource'
            : 'package',
      registryId,
      status: legacyLicenseIsSpdx ? 'observed' : 'unknown',
      ...(legacyLicenseIsSpdx
        ? { spdxExpression: legacyLicense }
        : {
            unknownReason:
              legacyLicense.toUpperCase() === 'NOASSERTION'
                ? 'custom'
                : 'unparseable',
          }),
      source,
      sourceUrl,
      checkedAt,
      ...(legacyLicense.toUpperCase() === 'NOASSERTION' ? {note: 'GitHub reports NOASSERTION; review the license files or package manifest and record scoped evidence manually.'} : undefined),
    },
  ])
}
