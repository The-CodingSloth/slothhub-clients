import {z} from 'zod'
import {PROGRAMMING_LANGUAGE_ID_PATTERN} from './programmingLanguageId.js'
import {LANGUAGE_SUPPORT_KIND_VALUES, isReadableProgrammingLanguageName, isValidLanguageSupportSource} from './languageSupport.js'
export {LANGUAGE_SUPPORT_KIND_LABELS, matchesSupportedLanguages} from './languageSupport.js'

/** Editor-owned identifiers: names may change; published identifiers must not. */
export const programmingLanguageIdSchema = z.string().regex(PROGRAMMING_LANGUAGE_ID_PATTERN,
  'Use a stable lowercase identifier, such as python, c-sharp, or c-plus-plus.')

export const languageSupportSourceSchema = z.string().refine(isValidLanguageSupportSource,
  'Link to authoritative documentation using a public HTTPS URL without credentials.')

export const languageSupportKindSchema = z.enum(LANGUAGE_SUPPORT_KIND_VALUES)
export const programmingLanguageNameSchema = z.string().trim().min(1).refine(isReadableProgrammingLanguageName, 'Use a readable language name.')

export const supportedLanguageSchema = z.object({
  id: programmingLanguageIdSchema,
  name: programmingLanguageNameSchema,
  supportKind: languageSupportKindSchema,
  sourceUrl: languageSupportSourceSchema,
})

export type SupportedLanguage = z.infer<typeof supportedLanguageSchema>

/** The nullable projection at the Sanity boundary, before evidence validation. */
export interface SupportedLanguageInput {
  id?: string | null
  name?: string | null
  supportKind?: string | null
  sourceUrl?: string | null
}
export const normalizeSupportedLanguages = (
  rows: readonly (SupportedLanguageInput | null)[] | null | undefined,
): SupportedLanguage[] => {
  const facts = new Map<string, SupportedLanguage>()
  for (const row of rows ?? []) {
    const parsed = supportedLanguageSchema.safeParse(row)
    if (!parsed.success) continue
    const fact = {...parsed.data, sourceUrl: new URL(parsed.data.sourceUrl).href}
    const key = `${fact.id}:${fact.supportKind}`
    if (!facts.has(key)) facts.set(key, fact)
  }
  return [...facts.values()].sort((left, right) => left.id.localeCompare(right.id) || left.supportKind.localeCompare(right.supportKind))
}
