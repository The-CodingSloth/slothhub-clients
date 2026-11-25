import {normalizePublicAgentSearchText} from './agentSearch.js'
import {PUBLIC_TEXT_UNSAFE_CHARACTERS} from './publicText.js'

// Receipt (2026-09-14): published Tools carry 6 and 8 SEO keywords today; the
// searchAlias term limit (80 characters) already bounds vocabulary entries.
export const TOOL_ALTERNATE_NAME_MAX_ITEMS = 8
export const TOOL_ALTERNATE_NAME_MAX_LENGTH = 80

/**
 * Vocabulary rules editors maintain in `searchAlias` documents. A `synonym`
 * group is symmetric: a Tool whose search text already contains any member
 * term also answers queries written with the other terms. A `oneWay` rule is
 * directional: `source` is the visitor phrase and `target` is the canonical
 * phrase SlothHub content uses, so only `target` can anchor the projection.
 */
export interface SearchIndexAliasRule {
  /** Document identity, present when the rule was read from `searchAlias`. */
  _id?: string
  /** Editor-facing label used when a rule is named in warnings. */
  name?: string | null
  type?: 'synonym' | 'oneWay' | null
  terms?: ReadonlyArray<string | null | undefined> | null
  source?: string | null
  target?: string | null
  isEnabled?: boolean | null
}

const UNSAFE_CHARACTER_PATTERN = new RegExp(
  `[${PUBLIC_TEXT_UNSAFE_CHARACTERS.join('')}]`,
  'gu',
)

const normalizeAliasDisplayName = (value: string): string =>
  value.replace(UNSAFE_CHARACTER_PATTERN, '').trim()

export const normalizeToolAlternateNames = (values: unknown): string[] => {
  if (!Array.isArray(values)) {
    return []
  }

  const seen = new Set<string>()
  const names: string[] = []

  values.forEach((value) => {
    if (names.length >= TOOL_ALTERNATE_NAME_MAX_ITEMS || typeof value !== 'string') {
      return
    }

    const name = normalizeAliasDisplayName(value).slice(
      0,
      TOOL_ALTERNATE_NAME_MAX_LENGTH,
    ).trim()
    const normalized = normalizePublicAgentSearchText(name)
    if (!normalized || seen.has(normalized)) {
      return
    }

    seen.add(normalized)
    names.push(name)
  })

  return names
}

const phraseAppearsInText = (normalizedText: string, phrase: string): boolean =>
  ` ${normalizedText} `.includes(` ${phrase} `)

const ruleSearchTerms = (
  normalizedText: string,
  rule: SearchIndexAliasRule,
): string[] => {
  if (rule.isEnabled === false) {
    return []
  }

  if (rule.type === 'oneWay') {
    const source = normalizePublicAgentSearchText(rule.source ?? undefined)
    const target = normalizePublicAgentSearchText(rule.target ?? undefined)

    return source && target && phraseAppearsInText(normalizedText, target)
      ? [source]
      : []
  }

  const terms = [
    ...new Set(
      (rule.terms ?? [])
        .map((term) => normalizePublicAgentSearchText(term ?? undefined))
        .filter(Boolean),
    ),
  ]

  return terms.some((term) => phraseAppearsInText(normalizedText, term))
    ? terms
    : []
}

/**
 * Visitor phrases an enabled alias rule claims: every term in a synonym
 * group, or the visitor-facing `source` of a one-way alias. The one-way
 * `target` is canonical content language, not a claim on visitor phrasing,
 * so it never conflicts. Normalization matches `projectSearchIndexTerms`
 * exactly — `K8S`, `k8s`, and unicode variants are the same claim.
 */
export const collectSearchAliasClaimedPhrases = (
  rule: SearchIndexAliasRule | null | undefined,
): string[] => {
  if (!rule || rule.isEnabled === false) {
    return []
  }

  if (rule.type === 'oneWay') {
    const source = normalizePublicAgentSearchText(rule.source ?? undefined)
    return source ? [source] : []
  }

  return [
    ...new Set(
      (rule.terms ?? [])
        .map((term) => normalizePublicAgentSearchText(term ?? undefined))
        .filter((term): term is string => Boolean(term)),
    ),
  ]
}

export interface SearchIndexAliasRuleConflict<Rule extends SearchIndexAliasRule> {
  /** The earlier rule that keeps the contested phrase claims. */
  kept: Rule
  /** The later rule skipped so every phrase resolves deterministically. */
  skipped: Rule
  /** Normalized phrases both rules claim. */
  phrases: string[]
}

/**
 * Resolves alias collisions in query order: the first rule claiming a visitor
 * phrase wins and later rules claiming any of the same phrases are skipped.
 * The conflict list lets the caller warn with document identity instead of
 * silently dropping the duplicate.
 */
export interface SearchIndexAliasRuleDedup<Rule extends SearchIndexAliasRule> {
  rules: Rule[]
  conflicts: SearchIndexAliasRuleConflict<Rule>[]
}

export const dedupeSearchIndexAliasRules = <Rule extends SearchIndexAliasRule>(
  rules: ReadonlyArray<Rule | null | undefined> | null | undefined,
): SearchIndexAliasRuleDedup<Rule> => {
  const claimants = new Map<string, Rule>()
  const kept: Rule[] = []
  const conflicts: SearchIndexAliasRuleConflict<Rule>[] = []

  ;(rules ?? []).forEach((rule) => {
    if (!rule) {
      return
    }

    const phrases = collectSearchAliasClaimedPhrases(rule)
    const contested = phrases.filter((phrase) => claimants.has(phrase))
    const owner = contested.length > 0 ? claimants.get(contested[0]!) : undefined
    if (contested.length > 0 && owner) {
      conflicts.push({kept: owner, skipped: rule, phrases: contested})
      return
    }

    phrases.forEach((phrase) => claimants.set(phrase, rule))
    kept.push(rule)
  })

  return {rules: kept, conflicts}
}

/**
 * Groups evaluation-style alias claims (`alias` → `canonicalSlug`) by the
 * canonical Tool they resolve to. Shared by the packaged catalog fixture and
 * the browser search evaluation so both read claims identically.
 */
export const groupAliasClaimsByCanonicalSlug = (
  claims:
    | ReadonlyArray<{alias?: string | null; canonicalSlug?: string | null} | null | undefined>
    | undefined,
): Map<string, string[]> => {
  const bySlug = new Map<string, string[]>()

  ;(claims ?? []).forEach((claim) => {
    if (!claim?.canonicalSlug || !claim.alias) {
      return
    }
    const aliases = bySlug.get(claim.canonicalSlug) ?? []
    aliases.push(claim.alias)
    bySlug.set(claim.canonicalSlug, aliases)
  })

  return bySlug
}

/**
 * Alias terms a public Tool should answer to. The same projection backs the
 * production search-index feed and the packaged evaluation fixture so the
 * vocabulary is defined once and consumed identically everywhere.
 */
export const getSearchIndexAliasTermsForText = (
  normalizedSearchText: string,
  rules: ReadonlyArray<SearchIndexAliasRule | null | undefined>,
): string[] => {
  if (!normalizedSearchText) {
    return []
  }

  const terms = new Set<string>()
  ;(rules ?? []).forEach((rule) => {
    if (!rule) {
      return
    }

    ruleSearchTerms(normalizedSearchText, rule).forEach((term) => {
      if (!phraseAppearsInText(normalizedSearchText, term)) {
        terms.add(term)
      }
    })
  })

  return [...terms]
}

/**
 * Normalize the base search terms and append the alias vocabulary that applies
 * to this Tool: published `alternateNames` first, then `searchAlias` rules
 * anchored by the Tool's own text. Returns the full term list plus the alias
 * subset so feeds can publish `search.aliases` alongside `search.text`.
 */
export const projectSearchIndexTerms = (
  baseTerms: ReadonlyArray<string | null | undefined>,
  options?: {
    rules?: ReadonlyArray<SearchIndexAliasRule | null | undefined>
    alternateNames?: ReadonlyArray<string | null | undefined> | null
  },
): {terms: string[]; aliasTerms: string[]} => {
  const terms = (baseTerms ?? [])
    .map((term) => normalizePublicAgentSearchText(term ?? undefined))
    .filter(Boolean)
  const normalizedText = terms.join(' ')

  const aliasTerms: string[] = []
  const seen = new Set<string>()
  const addAliasTerm = (term: string | null | undefined) => {
    const normalized = normalizePublicAgentSearchText(term ?? undefined)
    if (!normalized || seen.has(normalized)) {
      return
    }
    if (phraseAppearsInText(normalizedText, normalized)) {
      return
    }

    seen.add(normalized)
    aliasTerms.push(normalized)
  }

  normalizeToolAlternateNames(options?.alternateNames).forEach(addAliasTerm)
  getSearchIndexAliasTermsForText(normalizedText, options?.rules ?? []).forEach(
    addAliasTerm,
  )

  return {terms: [...terms, ...aliasTerms], aliasTerms}
}
