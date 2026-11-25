import { z } from 'zod';
import {
  buildUniquePublicSourceReferenceMap,
  normalizePublicSourceReferenceUrl,
  type SourceReferenceInput,
} from './sourceReference.js';
import { MAX_PUBLIC_METADATA_NOTE_LENGTH } from './publicMetadata.js';
import { containsUnsafePublicTextCharacters } from './publicText.js';

export const FREE_TIER_COMMERCIAL_USE_VALUES = ['allowed', 'not_allowed', 'unknown'] as const;
export const FREE_TIER_OVERAGE_VALUES = [
  'hard_stop',
  'auto_bills',
  'spend_cap_available',
  'unknown',
] as const;
export const FREE_TIER_INACTIVITY_VALUES = ['yes', 'no', 'unknown'] as const;
const optionalText = z
  .string()
  .trim()
  .min(1)
  .nullish()
  .transform((value) => value ?? undefined);
const period = z
  .string()
  .trim()
  .min(1)
  .max(MAX_PUBLIC_METADATA_NOTE_LENGTH)
  .refine(
    (value) => !containsUnsafePublicTextCharacters(value),
    'Use plain text for the inactivity period.',
  );
export const freeTierTermsInputSchema = z
  .object({
    commercialUse: z
      .enum(FREE_TIER_COMMERCIAL_USE_VALUES)
      .nullish()
      .transform((value) => value ?? 'unknown'),
    commercialUseEvidenceReferenceKey: optionalText,
    overageBehavior: z
      .enum(FREE_TIER_OVERAGE_VALUES)
      .nullish()
      .transform((value) => value ?? 'unknown'),
    overageBehaviorEvidenceReferenceKey: optionalText,
    inactivityPause: z
      .enum(FREE_TIER_INACTIVITY_VALUES)
      .nullish()
      .transform((value) => value ?? 'unknown'),
    inactivityPausePeriod: period.nullish().transform((value) => value ?? undefined),
    inactivityPauseEvidenceReferenceKey: optionalText,
  })
  .superRefine((terms, ctx) => {
    for (const field of ['commercialUse', 'overageBehavior', 'inactivityPause'] as const) {
      const key = `${field}EvidenceReferenceKey` as const;
      if (terms[field] !== 'unknown' && !terms[key])
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `Choose a checked public source reference for ${field}.`,
        });
    }
    if (terms.inactivityPause === 'yes' && !terms.inactivityPausePeriod)
      ctx.addIssue({
        code: 'custom',
        path: ['inactivityPausePeriod'],
        message: 'Record the documented period before an inactive project is paused.',
      });
    if (terms.inactivityPause !== 'yes' && terms.inactivityPausePeriod)
      ctx.addIssue({
        code: 'custom',
        path: ['inactivityPausePeriod'],
        message: 'Set inactivity pause to Yes or clear its period.',
      });
  });
export const freeTierTermsSnapshotSchema = z.object({
  commercialUse: optionalText,
  commercialUseEvidenceReferenceKey: optionalText,
  overageBehavior: optionalText,
  overageBehaviorEvidenceReferenceKey: optionalText,
  inactivityPause: optionalText,
  inactivityPausePeriod: optionalText,
  inactivityPauseEvidenceReferenceKey: optionalText,
});
export type FreeTierTermsInput = z.input<typeof freeTierTermsSnapshotSchema>;
const evidenceSchema = z.object({
  title: z.string().min(1),
  url: z
    .string()
    .refine(
      (value) => normalizePublicSourceReferenceUrl(value) !== undefined,
      'Use a public HTTP URL.',
    ),
  checkedAt: z.iso.datetime({ offset: true }),
});
export const publicFreeTierTermsSchema = z
  .object({
    commercialUse: z.enum(FREE_TIER_COMMERCIAL_USE_VALUES),
    commercialUseEvidence: evidenceSchema.optional(),
    overageBehavior: z.enum(FREE_TIER_OVERAGE_VALUES),
    overageBehaviorEvidence: evidenceSchema.optional(),
    inactivityPause: z.enum(FREE_TIER_INACTIVITY_VALUES),
    inactivityPausePeriod: period.optional(),
    inactivityPauseEvidence: evidenceSchema.optional(),
  })
  .superRefine((terms, ctx) => {
    for (const field of ['commercialUse', 'overageBehavior', 'inactivityPause'] as const) {
      if (terms[field] !== 'unknown' && !terms[`${field}Evidence`])
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: 'A known free-tier term needs checked public evidence.',
        });
    }
    if (terms.inactivityPause === 'yes' && !terms.inactivityPausePeriod)
      ctx.addIssue({
        code: 'custom',
        path: ['inactivityPausePeriod'],
        message: 'A pause needs its documented period.',
      });
    if (terms.inactivityPause !== 'yes' && terms.inactivityPausePeriod)
      ctx.addIssue({
        code: 'custom',
        path: ['inactivityPausePeriod'],
        message: 'A period requires a documented pause.',
      });
  });
export type PublicFreeTierTerms = z.infer<typeof publicFreeTierTermsSchema>;
export const validateFreeTierTerms = (
  value: FreeTierTermsInput | null | undefined,
  sources: readonly SourceReferenceInput[] | null | undefined,
): true | string => {
  if (value == null) return true;
  const parsed = freeTierTermsInputSchema.safeParse(value);
  if (!parsed.success)
    return parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
  const references = buildUniquePublicSourceReferenceMap(sources);
  for (const field of ['commercialUse', 'overageBehavior', 'inactivityPause'] as const) {
    if (parsed.data[field] === 'unknown') continue;
    const key = parsed.data[`${field}EvidenceReferenceKey`];
    if (!key || !references.get(key)?.checkedAt)
      return `${field}: choose one unambiguous, checked public source reference. Private, missing and duplicate keys cannot support a free-tier claim.`;
  }
  return true;
};
export const normalizePublicFreeTierTerms = (
  value: FreeTierTermsInput | PublicFreeTierTerms | null | undefined,
  sources?: readonly SourceReferenceInput[] | null,
): PublicFreeTierTerms | undefined => {
  if (value == null) return undefined;
  const parsed = freeTierTermsInputSchema.safeParse(value);
  if (!parsed.success || validateFreeTierTerms(value, sources) !== true) return undefined;
  const references = buildUniquePublicSourceReferenceMap(sources);
  const { commercialUse, overageBehavior, inactivityPause, inactivityPausePeriod } = parsed.data;
  const result: PublicFreeTierTerms = {
    commercialUse,
    overageBehavior,
    inactivityPause,
    ...(inactivityPausePeriod ? { inactivityPausePeriod } : undefined),
  };
  for (const field of ['commercialUse', 'overageBehavior', 'inactivityPause'] as const) {
    if (parsed.data[field] === 'unknown') continue;
    const source = references.get(parsed.data[`${field}EvidenceReferenceKey`] ?? '');
    if (source?.checkedAt)
      result[`${field}Evidence`] = {
        title: source.title,
        url: source.url,
        checkedAt: source.checkedAt,
      };
  }
  return result;
};
export const FREE_TIER_TERM_LABELS = {
  commercialUse: {
    allowed: 'Free for commercial use',
    not_allowed: 'Commercial use not allowed',
    unknown: 'Commercial use unknown',
  },
  overageBehavior: {
    hard_stop: 'Hard spend cap: usage stops at the free limit',
    auto_bills: 'Overages bill automatically',
    spend_cap_available: 'Optional spend cap available',
    unknown: 'Overage behavior unknown',
  },
  inactivityPause: {
    yes: 'Inactive projects pause',
    no: 'No inactivity pause',
    unknown: 'Inactivity pause unknown',
  },
} as const;
export const summarizeFreeTierTerms = (
  value: PublicFreeTierTerms | null | undefined,
  render: (text: string) => string = (text) => text,
): string[] => {
  const parsed = publicFreeTierTermsSchema.safeParse(value);
  if (!parsed.success) return [];
  return (['commercialUse', 'overageBehavior', 'inactivityPause'] as const).map((field) => {
    const terms = parsed.data;
    const source = terms[`${field}Evidence`];
    const label =
      field === 'commercialUse'
        ? FREE_TIER_TERM_LABELS.commercialUse[terms.commercialUse]
        : field === 'overageBehavior'
          ? FREE_TIER_TERM_LABELS.overageBehavior[terms.overageBehavior]
          : FREE_TIER_TERM_LABELS.inactivityPause[terms.inactivityPause];
    return `Free tier: ${label}${field === 'inactivityPause' && terms.inactivityPausePeriod ? ` after ${render(terms.inactivityPausePeriod)}` : ''}${source ? ` (${source.url}, checked ${render(source.checkedAt)})` : ''}`;
  });
};
