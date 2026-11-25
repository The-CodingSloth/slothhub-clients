import type {SupportedLanguage} from './supportedLanguage.js';
import {validatePublicHttpUrl} from './urlSafety.js';

export const LANGUAGE_SUPPORT_KIND_VALUES = ['sdk_client', 'language_tooling'] as const;

export const isReadableProgrammingLanguageName = (value: string): boolean =>
  !/[\p{Cc}\p{Cf}]/u.test(value);

export const isValidLanguageSupportSource = (value: string): boolean =>
  value.startsWith('https://') && !/[\p{Cc}\p{Cf}<>`]/u.test(value) && validatePublicHttpUrl(value).success;

export const LANGUAGE_SUPPORT_KIND_LABELS = {
  sdk_client: 'SDK or client',
  language_tooling: 'Language-specific tooling',
} as const;

/** ANY selected language; no recorded evidence never means compatible. */
export const matchesSupportedLanguages = (
  facts: readonly SupportedLanguage[] | undefined,
  selected: readonly string[] | undefined,
): boolean => !selected?.length || (facts ?? []).some(({id}) => selected.includes(id));
