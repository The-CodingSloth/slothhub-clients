import {z} from 'zod'
import type {JsonValue} from './jsonValue.js'
import type {ResourceIdentity} from './resourceIdentity.js'
import {buildRegistryEnrichmentRequest} from './registryEnrichment.js'
import {getRegistryResourceIdentityKey, REGISTRY_ENRICHMENT_SOURCE_VALUES, type RegistryEnrichmentSource} from './registryEnrichmentSource.js'
import {licenseFactNoteSchema, LICENSE_FACT_SCOPE_VALUES, LICENSE_FACT_UNKNOWN_REASON_VALUES, getSpdxExpressionIdentity, isValidSpdxExpression, normalizeSourceBackedLicenseFacts} from './licenseFacts.js'
import {containsUnsafePublicTextCharacters} from './publicText.js'
import {getPublicHttpUrl, normalizePublicHostname} from './urlSafety.js'
import {escapeMarkdownText, toMarkdownInlineCode} from './markdownSafety.js'
import {getRegistrableDomain} from './registrableDomain.js'
import {getCommonLicenseLabel} from './commonLicenses.js'

const licenseEvidenceUrl = z.string().refine((value) => {
  if (!value.startsWith('https://') || containsUnsafePublicTextCharacters(value) || getPublicHttpUrl(value) !== value) return false
  const url = new URL(value)
  return url.href === value && !url.search && !url.hash
}, 'Use a canonical public HTTPS evidence URL without credentials, query parameters or fragments.')
export const officialLicenseSourceUrlsSchema = z.array(licenseEvidenceUrl)
const licenseTargetText = z.string().trim().min(1).refine((value) => !containsUnsafePublicTextCharacters(value) && !/[\r\n\t]/u.test(value), 'Use a single-line component name or repository-relative path.')
const licenseRelativePath = licenseTargetText.refine((value) => !value.startsWith('/') && !/[\\:*?"<>|]/u.test(value) && value.split('/').every((part) => part !== '' && part !== '.' && part !== '..'), 'Use an exact repository-relative path without traversal, wildcards or a trailing slash.')
const licenseFactTargetSchema = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('component'), value: licenseTargetText}),
  z.object({kind: z.literal('path'), value: licenseRelativePath}),
])
const reviewedLicenseTargetSchema = z.union([licenseFactTargetSchema, z.object({kind: z.literal('paths'), paths: z.array(licenseRelativePath).min(1).refine((paths) => new Set(paths).size === paths.length, 'Record each exact path only once.')})])
export const LICENSE_EVIDENCE_KIND_VALUES = ['license_file', 'package_manifest', 'skill_frontmatter', 'registry_metadata', 'repository_detection'] as const
const evidence = {evidenceKind: z.enum(LICENSE_EVIDENCE_KIND_VALUES).optional(), note: licenseFactNoteSchema.optional(), scope: z.enum(LICENSE_FACT_SCOPE_VALUES), appliesTo: licenseFactTargetSchema.optional(), sourceUrl: licenseEvidenceUrl, checkedAt: z.iso.datetime(), source: z.enum([...REGISTRY_ENRICHMENT_SOURCE_VALUES, 'official_website']).optional()}
export const publicToolLicenseFactSchema = z.discriminatedUnion('status', [
  z.object({...evidence, status: z.literal('observed'), spdxExpression: z.string().refine((value) => !containsUnsafePublicTextCharacters(value) && isValidSpdxExpression(value), 'Enter a valid SPDX expression, or choose custom terms with a summary for reviewed non-SPDX terms.')}),
  z.object({...evidence, status: z.literal('unknown'), unknownReason: z.enum(LICENSE_FACT_UNKNOWN_REASON_VALUES)}),
  z.object({...evidence, source: z.literal('official_website'), reviewedSource: z.enum(REGISTRY_ENRICHMENT_SOURCE_VALUES).optional(), status: z.literal('custom_terms'), licenseRef: z.string().regex(/^LicenseRef-[A-Za-z0-9.-]+$/u, 'Use a LicenseRef-* identifier for custom terms.').optional(), summary: z.string().trim().min(1).refine((value) => !containsUnsafePublicTextCharacters(value), 'Use plain public text for the terms summary.')}),
])
export type PublicToolLicenseFact = z.infer<typeof publicToolLicenseFactSchema>
export const TOOL_LICENSE_FACT_JSON_SCHEMA = z.json().parse(z.toJSONSchema(publicToolLicenseFactSchema, {target: 'draft-7'}))

export interface OfficialWebsiteLicenseContext {
  website?: string | null
  officialLicenseSourceUrls?: readonly string[] | null
  resourceIdentity?: Partial<Pick<ResourceIdentity, 'canonicalUrl' | 'websiteUrl' | 'docsUrl' | 'repositoryUrl' | 'packageUrl'>> | null
}

const resourcePath = (url: URL): string | null => {
  try {
    // Reject escaped separators and double encoding rather than letting server
    // decoding move a URL outside the resource established by the editor.
    if (/%(?:2f|5c|25)/iu.test(url.pathname)) return null
    return decodeURIComponent(url.pathname).replace(/\/+$/u, '')
  } catch {
    return null
  }
}

// These repository/package hosts serve unrelated resources beneath one origin.
// Their landing pages cannot establish ownership of a project's license terms.
const SHARED_LICENSE_EVIDENCE_HOSTS = new Set([
  'github.com', 'api.github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org',
  'npmjs.com', 'registry.npmjs.org', 'pypi.org', 'crates.io', 'jsr.io', 'registry.modelcontextprotocol.io',
])

const isWithinOfficialResource = (candidate: URL, official: URL): boolean => {
  const candidatePath = resourcePath(candidate)
  const officialPath = resourcePath(official)
  const officialHost = normalizePublicHostname(official.hostname).replace(/^www\./u, '')
  if (officialPath === '' && SHARED_LICENSE_EVIDENCE_HOSTS.has(officialHost)) return false
  if (candidate.origin !== official.origin) {
    // Only a dedicated domain root establishes authority over its subdomains.
    // A project path or a docs subdomain cannot authorize sibling tenants.
    return official.protocol === 'https:' && candidate.protocol === 'https:'
      && !official.port && !candidate.port && officialPath === '' && candidatePath !== null
      && getRegistrableDomain(official.href) === officialHost
      && candidate.hostname.endsWith(`.${officialHost}`)
      && !SHARED_LICENSE_EVIDENCE_HOSTS.has(officialHost)
  }
  return candidatePath !== null && officialPath !== null
    && (candidatePath === officialPath || candidatePath.startsWith(`${officialPath}/`))
}

const isLicenseEvidenceSourceHost = (source: RegistryEnrichmentSource, sourceUrl: string): boolean => {
  const hosts = {github: ['github.com'], gitlab: ['gitlab.com'], npm: ['npmjs.com'], pypi: ['pypi.org'], crates: ['crates.io'], mcp_registry: ['registry.modelcontextprotocol.io']}
  return hosts[source]?.includes(new URL(sourceUrl).hostname.replace(/^www\./u, '')) ?? false
}

/** Editor-owned evidence is validated independently of sweep-owned registry facts. */
export const officialWebsiteLicenseFactAuthoringSchema = (context: OfficialWebsiteLicenseContext, now = new Date()) => {
  const reviewedUrls = officialLicenseSourceUrlsSchema.safeParse(context.officialLicenseSourceUrls ?? [])
  const resources = [context.website, context.resourceIdentity?.canonicalUrl, context.resourceIdentity?.websiteUrl, context.resourceIdentity?.docsUrl, context.resourceIdentity?.repositoryUrl, context.resourceIdentity?.packageUrl]
    .flatMap((value) => {
      const safeUrl = getPublicHttpUrl(value)
      return safeUrl ? [new URL(safeUrl)] : []
    })
  const source = z.enum([...REGISTRY_ENRICHMENT_SOURCE_VALUES, 'official_website']).default('official_website')
  return z.discriminatedUnion('status', [
    publicToolLicenseFactSchema.options[0].extend({source, appliesTo: reviewedLicenseTargetSchema.optional()}),
    publicToolLicenseFactSchema.options[1].extend({source, appliesTo: reviewedLicenseTargetSchema.optional()}),
    publicToolLicenseFactSchema.options[2].omit({reviewedSource: true}).extend({source, appliesTo: reviewedLicenseTargetSchema.optional()}),
  ]).superRefine((fact, ctx) => {
    const safeUrl = getPublicHttpUrl(fact.sourceUrl)
    if (fact.source !== 'official_website' && (!safeUrl || !isLicenseEvidenceSourceHost(fact.source, safeUrl))) ctx.addIssue({code: 'custom', path: ['source'], message: 'The license source must match its registry host.'})
    const reviewedExternalSource = reviewedUrls.success && reviewedUrls.data.includes(fact.sourceUrl)
    if (!safeUrl || (!reviewedExternalSource && !resources.some((resource) => isWithinOfficialResource(new URL(safeUrl), resource)))) ctx.addIssue({code: 'custom', path: ['sourceUrl'], message: 'Use a source within the current Tool website, canonical identity, or official docs URL (same origin and resource path, or a subdomain of a dedicated website domain root). Shared repository/package hosts require a project-specific URL; their host roots cannot authorize license evidence. For external terms, record the exact URL in reviewed official license source URLs first.'})
    if (Date.parse(fact.checkedAt) > now.getTime()) ctx.addIssue({code: 'custom', path: ['checkedAt'], message: 'Checked at cannot be in the future.'})
  })
}

interface OfficialWebsiteLicenseEvidence extends Pick<OfficialWebsiteLicenseContext, 'officialLicenseSourceUrls'> {
  facts: JsonValue
  website?: string | null
}

const getToolLicenseFactSource = (fact: PublicToolLicenseFact) =>
  fact.status === 'custom_terms' ? fact.reviewedSource ?? fact.source : fact.source

const licenseEvidencePriority = (fact: PublicToolLicenseFact): number =>
  fact.evidenceKind === 'license_file' || fact.evidenceKind === 'package_manifest' || fact.evidenceKind === 'skill_frontmatter'
    ? 2 : fact.evidenceKind === 'registry_metadata' ? 1 : 0

const reconcilePublicLicenseFacts = (facts: PublicToolLicenseFact[]): PublicToolLicenseFact[] => {
  const byTarget = new Map<string, PublicToolLicenseFact[]>()
  for (const fact of facts) {
    const key = licenseTargetKey(fact)
    const group = byTarget.get(key) ?? []
    group.push(fact)
    byTarget.set(key, group)
  }
  return facts.map((fact) => {
    if (fact.status === 'unknown') return fact
    const group = byTarget.get(licenseTargetKey(fact)) ?? []
    const known = group.filter((entry) => entry.status !== 'unknown')
    const highestPriority = Math.max(...known.map(licenseEvidencePriority))
    const strongest = known.filter((entry) => licenseEvidencePriority(entry) === highestPriority)
    const strongestTerms = new Set(strongest.map(licenseTermsKey))
    const explicitConflict = group.some((entry) => entry.status === 'unknown' && entry.unknownReason === 'conflicting' && licenseEvidencePriority(entry) >= highestPriority)
    if (!explicitConflict && strongestTerms.size === 1 && strongestTerms.has(licenseTermsKey(fact))) return fact
    const original = getToolLicenseFactLabel(fact)
    const source = getToolLicenseFactSource(fact)
    return {
      scope: fact.scope, sourceUrl: fact.sourceUrl, checkedAt: fact.checkedAt,
      ...(fact.appliesTo ? {appliesTo: fact.appliesTo} : undefined),
      ...(source ? {source} : undefined),
      ...(fact.evidenceKind ? {evidenceKind: fact.evidenceKind} : undefined),
      note: `Observed ${original}; differs from other recorded license evidence.${fact.note ? ` ${fact.note}` : ''}`,
      status: 'unknown' as const, unknownReason: 'conflicting' as const,
    }
  })
}

/** Registry identity and official host joins are revalidated before publication. */
export const normalizePublicToolLicenseFacts = (
  value: JsonValue, identity: ResourceIdentity | null | undefined, now = new Date(),
  websiteEvidence?: OfficialWebsiteLicenseEvidence,
): PublicToolLicenseFact[] => {
  const websiteSchema = officialWebsiteLicenseFactAuthoringSchema({website: websiteEvidence?.website, resourceIdentity: identity, officialLicenseSourceUrls: websiteEvidence?.officialLicenseSourceUrls}, now)
  const websiteFacts = Array.isArray(websiteEvidence?.facts) ? websiteEvidence.facts.flatMap((input) => {
    const parsed = websiteSchema.safeParse(input)
    if (!parsed.success) return []
    const authoredFact = parsed.data
    // Catalog 27 clients require this literal for custom terms. Preserve the
    // reviewed registry provenance additively without changing their parser.
    const fact = authoredFact.status === 'custom_terms'
      ? {...authoredFact, source: 'official_website' as const, ...(authoredFact.source !== 'official_website' ? {reviewedSource: authoredFact.source} : undefined)}
      : authoredFact
    if (fact.appliesTo?.kind === 'paths') return fact.appliesTo.paths.map((value) => ({...fact, appliesTo: {kind: 'path' as const, value}}))
    const {appliesTo, ...rest} = fact
    return [{...rest, ...(appliesTo ? {appliesTo} : undefined)}]
  }) : []
  const request = identity ? buildRegistryEnrichmentRequest(identity) : null
  if (!request || !Array.isArray(value)) return reconcilePublicLicenseFacts(websiteFacts)
  const registryFacts = normalizeSourceBackedLicenseFacts(value).flatMap((fact) => {
    if (getRegistryResourceIdentityKey(fact.source, fact.registryId) !== getRegistryResourceIdentityKey(request.source, request.registryId)
      || Date.parse(fact.checkedAt) > now.getTime()) return []
    const url = new URL(fact.sourceUrl)
    url.search = ''
    url.hash = ''
    const common = {scope: fact.scope, sourceUrl: url.href, checkedAt: fact.checkedAt, ...(fact.note ? {note: fact.note} : undefined)}
    const parsed = publicToolLicenseFactSchema.safeParse(fact.status === 'observed'
      ? {...common, status: fact.status, spdxExpression: fact.spdxExpression}
      : {...common, status: fact.status, unknownReason: fact.unknownReason})
    return parsed.success ? [parsed.data] : []
  })
  return reconcilePublicLicenseFacts([...registryFacts, ...websiteFacts])
}

export const getToolLicenseFactSourceLabel = (fact: PublicToolLicenseFact): string => {
  switch (getToolLicenseFactSource(fact)) {
    case 'official_website': return 'Official website'
    case 'github': return 'GitHub'
    case 'gitlab': return 'GitLab'
    case 'npm': return 'npm'
    case 'pypi': return 'PyPI'
    case 'crates': return 'crates.io'
    case 'mcp_registry': return 'MCP Registry'
    default: return 'Registry observation'
  }
}

export const getToolLicenseFactLabel = (fact: PublicToolLicenseFact): string =>
  fact.status === 'observed' ? fact.spdxExpression : fact.status === 'custom_terms' ? `Custom terms${fact.licenseRef ? ` (${fact.licenseRef})` : ''}: ${fact.summary}` : `Unknown (${fact.unknownReason})`

const licenseTargetKey = (fact: PublicToolLicenseFact): string => JSON.stringify([fact.scope, fact.appliesTo?.kind, fact.appliesTo?.value])
const licenseTermsKey = (fact: Exclude<PublicToolLicenseFact, {status: 'unknown'}>): string =>
  fact.status === 'observed' ? `spdx:${getSpdxExpressionIdentity(fact.spdxExpression)}` : JSON.stringify(['custom_terms', fact.sourceUrl, fact.summary])

export const getToolLicenseFactScopeLabel = (fact: PublicToolLicenseFact): string =>
  `${fact.scope}${fact.appliesTo ? ` — ${fact.appliesTo.kind}: ${fact.appliesTo.value}` : ''}`

export const hasMixedToolLicenseFacts = (facts: readonly PublicToolLicenseFact[]): boolean => {
  const known = facts.filter((fact) => fact.status !== 'unknown')
  const targets = new Set(known.map(licenseTargetKey))
  const terms = new Set(known.map(licenseTermsKey))
  return targets.size > 1 && terms.size > 1
}

export const renderToolLicenseFactsMarkdown = (facts: readonly PublicToolLicenseFact[]): string => facts.length ? [
  '## Observed license metadata',
  ...(hasMixedToolLicenseFacts(facts) ? ['Mixed license metadata; terms differ by the recorded scope or target.'] : []),
  'Source-backed license metadata, not legal advice or a license-compatibility conclusion. Check the cited source and applicable terms.',
  ...facts.map((fact) => `- ${escapeMarkdownText(getToolLicenseFactScopeLabel(fact))}: ${toMarkdownInlineCode(getToolLicenseFactLabel(fact))}; ${getToolLicenseFactSourceLabel(fact)}; checked ${escapeMarkdownText(fact.checkedAt)}; source ${toMarkdownInlineCode(fact.sourceUrl)}${fact.note ? `; ${escapeMarkdownText(fact.note)}` : ''}`),
].join('\n\n') : ''


type ObservedToolLicenseFact = Extract<PublicToolLicenseFact, {status: 'observed'}>
export interface CommonToolLicense {
  /** The SPDX identifier every fact records. */
  spdxExpression: string
  /** Short name, such as "Apache 2.0". */
  label: string
  facts: ObservedToolLicenseFact[]
}

/** The one common license every fact records, else null. */
export const getCommonToolLicense = (facts: readonly PublicToolLicenseFact[]): CommonToolLicense | null => {
  const observed = facts.flatMap((fact) => fact.status === 'observed' ? [fact] : [])
  if (observed.length === 0 || observed.length !== facts.length) return null
  const expressions = new Set(observed.map((fact) => fact.spdxExpression.trim()))
  const [spdxExpression] = expressions
  const label = expressions.size === 1 && spdxExpression ? getCommonLicenseLabel(spdxExpression) : undefined
  return spdxExpression && label ? {spdxExpression, label, facts: observed} : null
}

