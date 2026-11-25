import {
  agentInterfaceSchema as sharedAgentInterfaceSchema,
  quickstartSchema as sharedQuickstartSchema,
  securityPrivacyPostureSchema as sharedSecurityPrivacyPostureSchema,
  toolSummarySchema as sharedToolSummarySchema,
  toolDetailSchema as sharedToolDetailSchema,
  searchIndexToolSchema as sharedSearchIndexToolSchema,
  searchIndexArticleSchema as sharedSearchIndexArticleSchema,
  toolStackRecipeStepSchema as sharedToolStackRecipeStepSchema,
  toolStackRecipeSchema as sharedToolStackRecipeSchema,
  stacksItemSchema as sharedStacksItemSchema,
  bestItemSchema as sharedBestItemSchema,
  comparisonPairItemSchema as sharedComparisonPairItemSchema,
  indexFeedSchema as sharedIndexFeedSchema,
} from './schemas.js';
// MCP validation profile retains the stricter evidence and origin rules of its public structured output.
import {
  searchFilterOptionSchema,
  taxonomyReferenceSchema,
  stringArraySchema as stringArray,
} from './schemas.js';

import {
  publicToolSwitchingGroupSchema,
  publicToolSwitchReasonSchema,
} from '../publishedToolFeedSchemas.js';

import { normalizePublicToolIntegrationFacts } from '../publicToolIntegrationFact.js';

import { catalogFeedVersionSchema, searchIndexVersionSchema } from '../feedCompatibility.js';
import {
  AGENT_AUTOMATION_CAPABILITY_VALUES,
  AGENT_AUTOMATION_EVIDENCE_BASIS_VALUES,
  AGENT_AUTOMATION_ISOLATION_SUPPORT_VALUES,
  AGENT_AUTOMATION_SIDE_EFFECT_VALUES,
  AGENT_AUTOMATION_WORKSPACE_CONCURRENCY_VALUES,
  AGENT_INTERFACE_KIND_VALUES,
  MAX_AGENT_AUTOMATION_EVIDENCE_REFERENCES,
  MAX_AGENT_AUTOMATION_NOTES_LENGTH,
  MAX_PUBLIC_AGENT_INTERFACES,
} from '../agentInterface.js';
import { fillAgentSetupRecipeEntrySnippets } from '../mcpRegistry.js';
import { INTEGRATION_STATUS_VALUES } from '../integrationStatus.js';
import { MAX_PUBLIC_TOOL_INTEGRATIONS } from '../publicToolIntegrationFact.js';
import {
  PRODUCT_LIMIT_BASIS_VALUES,
  PRODUCT_LIMIT_COMPARATOR_VALUES,
  PRODUCT_LIMIT_MAX_EVIDENCE,
  PRODUCT_LIMIT_MAX_FACTS,
  PRODUCT_LIMIT_MAX_METRIC_LENGTH,
  PRODUCT_LIMIT_MAX_NOTE_LENGTH,
  PRODUCT_LIMIT_MAX_SCOPE_LENGTH,
  PRODUCT_LIMIT_MAX_UNIT_LENGTH,
  PRODUCT_LIMIT_VENDOR_CLAIM_SOURCE_VALUES,
} from '../productLimits.js';
import { RESOURCE_LINK_KINDS } from '../publishedToolProfile.js';
import {
  MAX_PUBLIC_SOURCE_REFERENCE_NOTE_LENGTH,
  MAX_PUBLIC_SOURCE_REFERENCE_TITLE_LENGTH,
  MAX_PUBLIC_SOURCE_REFERENCE_URL_LENGTH,
  SOURCE_REFERENCE_TYPE_VALUES,
  normalizePublicSourceReferenceUrl,
} from '../sourceReference.js';
import {
  MAX_PUBLIC_ALTERNATIVE_NOTE_LENGTH,
  MAX_PUBLIC_METADATA_LABEL_LENGTH,
} from '../publicMetadata.js';
import { MAX_TOOL_DECISION_KEY_FEATURES } from '../toolDecisionSupport.js';
import { RESOURCE_KIND_VALUES } from '../resourceKind.js';
import {
  RUNTIME_REQUIREMENT_MAX_EVIDENCE,
  RUNTIME_REQUIREMENT_MAX_NOTE_LENGTH,
  RUNTIME_REQUIREMENT_MAX_ROWS,
  RUNTIME_REQUIREMENT_STATUS_VALUES,
  RUNTIME_REQUIREMENT_SUBJECT_KIND_VALUES,
  parsePublicRuntimeRequirements,
} from '../runtimeRequirements.js';

import {
  TOOL_ALTERNATE_NAME_MAX_ITEMS,
  TOOL_ALTERNATE_NAME_MAX_LENGTH,
} from '../searchIndexAliases.js';

import { isSafePublicText } from '../publicText.js';
import { isLocalFeedUrl } from '../feedOrigin.js';
import {
  publicToolFreshnessSchema as freshnessSchema,
  publicToolResourceIdentityReferenceSchema as resourceIdentitySchema,
} from '../publishedToolFeedSchemas.js';
import { parseAgentSearchQueryContract } from '../agentSearchQueryContract.js';
import { isValidToolPublicSlug } from '../toolLookup.js';
import { validateAbsoluteHttpUrl, validatePublicHttpUrl } from '../urlSafety.js';
import { z } from 'zod';
import { SECURITY_CAPABILITY_VALUES } from '../securityCapability.js';

import type {
  AgentAlternativesDetailFeed,
  AgentAlternativesFeed,
  AgentCategoriesFeed,
  AgentComparisonDetailFeed,
  AgentComparisonsFeed,
  AgentCuratedListFeed,
  AgentTagsFeed,
  AgentToolDetailFeed,
  AgentToolStackFeed,
  AgentUseCasesFeed,
} from './types.js';
import { normalizePublicToolFeedFreshness, toolProfileTemporalValidators } from './temporal.js';

const UNSAFE_CONTROL_OR_BIDI =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
const publicHttpUrlSchema = z
  .string()
  .min(1)
  .max(MAX_PUBLIC_SOURCE_REFERENCE_URL_LENGTH)
  .refine(
    (value) => normalizePublicSourceReferenceUrl(value) === value,
    'Evidence URL must be a canonical public http(s) URL without credentials or control characters',
  );
const firstPartyHttpUrlSchema = z
  .string()
  .min(1)
  .max(MAX_PUBLIC_SOURCE_REFERENCE_URL_LENGTH)
  .refine(
    (value) => validateAbsoluteHttpUrl(value).success && new URL(value).href === value,
    'Expected a canonical first-party http(s) URL without credentials or control characters',
  );
const CANONICAL_UTC_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const safeRuntimeText = (maxLength: number) =>
  z
    .string()
    .max(maxLength)
    .refine(
      (value) => value.trim().length > 0 && !UNSAFE_CONTROL_OR_BIDI.test(value),
      'Expected nonblank text without control or bidirectional formatting characters',
    );

const canonicalUtcDateTime = z.string().refine((value) => {
  if (!CANONICAL_UTC_DATE_TIME.test(value)) return false;
  const timestamp = Date.parse(value);
  const canonical = value.includes('.') ? value : value.replace('Z', '.000Z');
  return !Number.isNaN(timestamp) && new Date(timestamp).toISOString() === canonical;
}, 'Expected a canonical UTC date-time');

const safePublicTextSchema = (maxLength: number) =>
  z
    .string()
    .min(1)
    .max(maxLength)
    .refine(isSafePublicText, 'Public text must be trimmed and exclude control or bidi characters');

const safePublicTextValueSchema = z
  .string()
  .min(1)
  .refine(isSafePublicText, 'Public text must be trimmed and exclude control or bidi characters');

const publicSourceReferenceSchema = z.object({
  title: safePublicTextSchema(MAX_PUBLIC_SOURCE_REFERENCE_TITLE_LENGTH),
  url: publicHttpUrlSchema,
  sourceType: z.enum(SOURCE_REFERENCE_TYPE_VALUES),
  checkedAt: z.iso.datetime({ offset: true }).optional(),
  note: safePublicTextSchema(MAX_PUBLIC_SOURCE_REFERENCE_NOTE_LENGTH).optional(),
});

const productLimitEvidenceSchema = publicSourceReferenceSchema.extend({
  checkedAt: z.iso.datetime({ offset: true }),
});

const productLimitNoteSchema = safePublicTextSchema(PRODUCT_LIMIT_MAX_NOTE_LENGTH).optional();

const assertiveProductLimitEvidenceSchema = z
  .array(productLimitEvidenceSchema)
  .min(1)
  .max(PRODUCT_LIMIT_MAX_EVIDENCE);

const boundedProductLimitSchema = z
  .object({
    state: z.literal('bounded'),
    comparator: z.enum(PRODUCT_LIMIT_COMPARATOR_VALUES),
    value: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
    unit: safePublicTextSchema(PRODUCT_LIMIT_MAX_UNIT_LENGTH),
    note: productLimitNoteSchema,
    evidence: assertiveProductLimitEvidenceSchema,
    reviewedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const unlimitedClaimedProductLimitSchema = z
  .object({
    state: z.literal('unlimited_claimed'),
    note: productLimitNoteSchema,
    evidence: assertiveProductLimitEvidenceSchema,
    reviewedAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .superRefine((fact, context) => {
    if (
      !fact.evidence.some((reference) =>
        PRODUCT_LIMIT_VENDOR_CLAIM_SOURCE_VALUES.some(
          (sourceType) => sourceType === reference.sourceType,
        ),
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Vendor unlimited claims require official vendor evidence',
      });
    }
  });

const nonNumericProductLimitSchema = z
  .object({
    state: z.enum(['not_disclosed', 'unknown']),
    note: productLimitNoteSchema,
    evidence: z.array(productLimitEvidenceSchema).max(0),
  })
  .strict();

const productLimitVariantSchema = z.union([
  boundedProductLimitSchema,
  unlimitedClaimedProductLimitSchema,
  nonNumericProductLimitSchema,
]);

const productLimitGroupSchema = z
  .object({
    metric: safePublicTextSchema(PRODUCT_LIMIT_MAX_METRIC_LENGTH),
    planScope: safePublicTextSchema(PRODUCT_LIMIT_MAX_SCOPE_LENGTH).optional(),
    deploymentScope: safePublicTextSchema(PRODUCT_LIMIT_MAX_SCOPE_LENGTH).optional(),
    basis: z.enum(PRODUCT_LIMIT_BASIS_VALUES).optional(),
    ambiguous: z.boolean(),
    facts: z.array(productLimitVariantSchema).min(1).max(PRODUCT_LIMIT_MAX_FACTS),
  })
  .superRefine((group, context) => {
    const hasAssertiveFact = group.facts.some(
      (fact) => fact.state === 'bounded' || fact.state === 'unlimited_claimed',
    );
    const hasNonAssertiveFact = group.facts.some(
      (fact) => fact.state === 'not_disclosed' || fact.state === 'unknown',
    );
    if (hasAssertiveFact && group.basis === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Assertive product-limit groups require a basis',
      });
    }
    if (hasNonAssertiveFact && group.basis !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Non-assertive product-limit groups must not declare a basis',
      });
    }
    if (
      group.basis === 'observed_envelope' &&
      group.facts.some(
        (fact) =>
          fact.state !== 'bounded' ||
          !fact.evidence.some((reference) => reference.sourceType === 'hands_on_test'),
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Observed envelopes must be bounded and cite public hands-on methodology',
      });
    }
    if (group.ambiguous !== group.facts.length > 1) {
      context.addIssue({
        code: 'custom',
        message: 'Ambiguity must match whether multiple conflicting facts are present',
      });
    }
  });

const productLimitsSchema = z
  .array(productLimitGroupSchema)
  .max(PRODUCT_LIMIT_MAX_FACTS)
  .superRefine((groups, context) => {
    const totalFacts = groups.reduce((total, group) => total + group.facts.length, 0);
    if (totalFacts > PRODUCT_LIMIT_MAX_FACTS) {
      context.addIssue({
        code: 'custom',
        message: `Product limits must contain at most ${PRODUCT_LIMIT_MAX_FACTS} total facts`,
      });
    }
  });

export { publicToolFreshnessSchema as freshnessSchema } from '../publishedToolFeedSchemas.js';
export { publicToolResourceIdentityReferenceSchema as resourceIdentitySchema } from '../publishedToolFeedSchemas.js';

export const publicAgentInterfaceSchema = z.object({
  kind: sharedAgentInterfaceSchema['shape'].kind,
  status: sharedAgentInterfaceSchema['shape'].status,
  label: sharedAgentInterfaceSchema['shape'].label,
  source: sharedAgentInterfaceSchema['shape'].source,
  identifier: sharedAgentInterfaceSchema['shape'].identifier,
  docsUrl: sharedAgentInterfaceSchema['shape'].docsUrl,
  installCommand: sharedAgentInterfaceSchema['shape'].installCommand,
  authRequirement: sharedAgentInterfaceSchema['shape'].authRequirement,
  setupFacts: sharedAgentInterfaceSchema['shape'].setupFacts,
  checkedAt: sharedAgentInterfaceSchema['shape'].checkedAt,
  capabilitiesNote: sharedAgentInterfaceSchema['shape'].capabilitiesNote,
  setupRecipe: sharedAgentInterfaceSchema['shape'].setupRecipe,
  setupRecipes: sharedAgentInterfaceSchema['shape'].setupRecipes,
  stdioSetupRecipe: sharedAgentInterfaceSchema['shape'].stdioSetupRecipe,
  sseOnlyRemotes: sharedAgentInterfaceSchema['shape'].sseOnlyRemotes,
  automation: z
    .object({
      nonInteractive: z.enum(AGENT_AUTOMATION_CAPABILITY_VALUES).optional(),
      structuredOutput: z.enum(AGENT_AUTOMATION_CAPABILITY_VALUES).optional(),
      dryRun: z.enum(AGENT_AUTOMATION_CAPABILITY_VALUES).optional(),
      evidenceBasis: z.enum(AGENT_AUTOMATION_EVIDENCE_BASIS_VALUES).optional(),
      sideEffects: z
        .array(z.enum(AGENT_AUTOMATION_SIDE_EFFECT_VALUES))
        .max(AGENT_AUTOMATION_SIDE_EFFECT_VALUES.length)
        .refine((values) => new Set(values).size === values.length, 'Side effects must be unique')
        .optional(),
      workspaceConcurrency: z.enum(AGENT_AUTOMATION_WORKSPACE_CONCURRENCY_VALUES).optional(),
      isolationSupport: z
        .array(z.enum(AGENT_AUTOMATION_ISOLATION_SUPPORT_VALUES))
        .max(AGENT_AUTOMATION_ISOLATION_SUPPORT_VALUES.length)
        .refine(
          (values) => new Set(values).size === values.length,
          'Isolation support values must be unique',
        )
        .refine(
          (values) =>
            values.length <= 1 || (!values.includes('none') && !values.includes('unknown')),
          "Isolation support 'none' and 'unknown' cannot be combined with other values",
        )
        .optional(),
      checkedAt: z.iso.datetime({ offset: true }),
      notes: z.string().max(MAX_AGENT_AUTOMATION_NOTES_LENGTH).optional(),
      evidenceReferences: z
        .array(publicSourceReferenceSchema)
        .min(1)
        .max(MAX_AGENT_AUTOMATION_EVIDENCE_REFERENCES),
    })
    .optional(),
});

export const publicToolIntegrationSchema = z
  .object({
    slug: z.string().min(1).max(120),
    name: z.string().min(1).max(160),
    status: z.enum(INTEGRATION_STATUS_VALUES),
    extensionName: z.string().min(1).max(MAX_PUBLIC_METADATA_LABEL_LENGTH).optional(),
    checkedAt: z.iso.datetime({ offset: true }).optional(),
    sourceUrl: publicHttpUrlSchema.optional(),
  })
  .strip();

export const toolQuickstartSchema = z.object({
  kind: sharedQuickstartSchema['shape'].kind,
  label: safePublicTextValueSchema,
  status: sharedQuickstartSchema['shape'].status,
  statusLabel: safePublicTextValueSchema,
  command: safePublicTextSchema(500).optional(),
  commandLanguage: sharedQuickstartSchema['shape'].commandLanguage,
  docsUrl: sharedQuickstartSchema['shape'].docsUrl,
  source: sharedQuickstartSchema['shape'].source,
  sourceLabel: safePublicTextValueSchema.optional(),
  notice: safePublicTextValueSchema.optional(),
});

const securityPrivacyEvidenceSchema = z.object({
  label: z.string(),
  status: z.enum(['verified', 'claimed', 'unknown', 'not_applicable']),
  sourceUrl: z.string().optional(),
  sourceTitle: z.string().optional(),
  checkedAt: z.string().optional(),
  note: z.string().optional(),
});

export const securityPrivacyPostureSchema = z.object({
  trustCenterUrl: sharedSecurityPrivacyPostureSchema['shape'].trustCenterUrl,
  securityPageUrl: sharedSecurityPrivacyPostureSchema['shape'].securityPageUrl,
  privacyPolicyUrl: sharedSecurityPrivacyPostureSchema['shape'].privacyPolicyUrl,
  subprocessorsUrl: sharedSecurityPrivacyPostureSchema['shape'].subprocessorsUrl,
  dpaUrl: sharedSecurityPrivacyPostureSchema['shape'].dpaUrl,
  dataTrainingPolicyUrl: sharedSecurityPrivacyPostureSchema['shape'].dataTrainingPolicyUrl,
  dataTrainingPolicySummary: sharedSecurityPrivacyPostureSchema['shape'].dataTrainingPolicySummary,
  dataRetentionSummary: sharedSecurityPrivacyPostureSchema['shape'].dataRetentionSummary,
  dataResidencySummary: sharedSecurityPrivacyPostureSchema['shape'].dataResidencySummary,
  apiKeyPermissionsSummary: sharedSecurityPrivacyPostureSchema['shape'].apiKeyPermissionsSummary,
  complianceClaims: z
    .array(
      securityPrivacyEvidenceSchema.extend({
        standard: z.enum([
          'soc2_type_i',
          'soc2_type_ii',
          'iso_27001',
          'gdpr',
          'hipaa',
          'ccpa',
          'pci_dss',
          'other',
        ]),
      }),
    )
    .optional(),
  securityCapabilities: z
    .array(
      securityPrivacyEvidenceSchema.extend({
        capability: z.enum(SECURITY_CAPABILITY_VALUES),
      }),
    )
    .optional(),
});

const runtimeRequirementStructureSchema = z
  .object({
    subjectKind: z.enum(RUNTIME_REQUIREMENT_SUBJECT_KIND_VALUES),
    subjectName: safeRuntimeText(80),
    environmentRange: safeRuntimeText(120),
    toolRange: safeRuntimeText(120).optional(),
    status: z.enum(RUNTIME_REQUIREMENT_STATUS_VALUES),
    note: safeRuntimeText(RUNTIME_REQUIREMENT_MAX_NOTE_LENGTH).optional(),
    evidence: z
      .array(
        z
          .object({
            title: safeRuntimeText(160),
            url: publicHttpUrlSchema,
            checkedAt: canonicalUtcDateTime,
          })
          .strict(),
      )
      .max(RUNTIME_REQUIREMENT_MAX_EVIDENCE),
    reviewedAt: canonicalUtcDateTime,
  })
  .strict();

export const runtimeRequirementSchema = runtimeRequirementStructureSchema.superRefine(
  (requirement, context) => {
    const result = parsePublicRuntimeRequirements([requirement]);
    if (result.success) return;

    for (const issue of result.issues) {
      context.addIssue({
        code: 'custom',
        path: issue.path[0] === 0 ? issue.path.slice(1) : [...issue.path],
        message: issue.message,
      });
    }
  },
);

export const runtimeRequirementsSchema = z
  .array(runtimeRequirementStructureSchema)
  .max(RUNTIME_REQUIREMENT_MAX_ROWS)
  .superRefine((requirements, context) => {
    const result = parsePublicRuntimeRequirements(requirements);
    if (result.success) return;

    for (const issue of result.issues) {
      context.addIssue({
        code: 'custom',
        path: [...issue.path],
        message: issue.message,
      });
    }
  });

export const publicComparisonFactsSchema = z.object({
  bestFor: stringArray.optional(),
  notBestFor: stringArray.optional(),
  strengths: stringArray.optional(),
  limitations: stringArray.optional(),
  pricingNotes: z.string().optional(),
  platformNotes: z.string().optional(),
  migrationNotes: z.string().optional(),
  lastReviewedAt: z.string().optional(),
  reviewedBy: z.string().optional(),
  claimStandard: z.enum(['facts_only', 'balanced_editorial', 'needs_sources']).optional(),
  generationReadiness: z.enum(['ready', 'needs_editorial', 'do_not_generate']).optional(),
  editorialNotes: z.string().optional(),
});

export const toolSummarySchema = z.object({
  contentSignal: sharedToolSummarySchema['shape'].contentSignal,
  editions: sharedToolSummarySchema['shape'].editions,
  editionSummary: sharedToolSummarySchema['shape'].editionSummary,
  deployment: sharedToolSummarySchema['shape'].deployment,
  name: sharedToolSummarySchema['shape'].name,
  slug: sharedToolSummarySchema['shape'].slug,
  description: sharedToolSummarySchema['shape'].description,
  resourceKind: sharedToolSummarySchema['shape'].resourceKind,
  resourceIdentity: sharedToolSummarySchema['shape'].resourceIdentity,
  pricing: sharedToolSummarySchema['shape'].pricing,
  categories: sharedToolSummarySchema['shape'].categories,
  tags: sharedToolSummarySchema['shape'].tags,
  useCases: sharedToolSummarySchema['shape'].useCases,
  freshness: sharedToolSummarySchema['shape'].freshness,
  detailUrl: sharedToolSummarySchema['shape'].detailUrl,
  website: sharedToolSummarySchema['shape'].website,
  visitUrl: sharedToolSummarySchema['shape'].visitUrl,
  comparisonFacts: publicComparisonFactsSchema.optional(),
  platforms: z.array(z.string()),
});

const resourceLinkSchema = z.object({
  label: z.string(),
  url: z.string(),
  kind: z.enum(RESOURCE_LINK_KINDS),
  isOfficial: z.boolean(),
  checkedAt: z.string().optional(),
  note: z.string().optional(),
});

export const toolDetailSchema = toolSummarySchema.extend({
  editorialContentPolicy: sharedToolDetailSchema['shape'].editorialContentPolicy,
  untrustedContentFields: sharedToolDetailSchema['shape'].untrustedContentFields,
  deals: sharedToolDetailSchema['shape'].deals,
  excludedRegistryIdentities: sharedToolDetailSchema['shape'].excludedRegistryIdentities,
  licenseFacts: sharedToolDetailSchema['shape'].licenseFacts,
  _id: sharedToolDetailSchema['shape']._id,
  repositoryObservation: sharedToolDetailSchema['shape'].repositoryObservation,
  supportedLanguages: sharedToolDetailSchema['shape'].supportedLanguages,
  publicationMarker: sharedToolDetailSchema['shape'].publicationMarker,
  tagline: sharedToolDetailSchema['shape'].tagline,
  alternateNames: z
    .array(safePublicTextSchema(TOOL_ALTERNATE_NAME_MAX_LENGTH))
    .max(TOOL_ALTERNATE_NAME_MAX_ITEMS)
    .optional(),
  longDescription: sharedToolDetailSchema['shape'].longDescription,
  uiComponent: sharedToolDetailSchema['shape'].uiComponent,
  keyFeatureDetails: sharedToolDetailSchema['shape'].keyFeatureDetails,
  portability: sharedToolDetailSchema['shape'].portability,
  lifecycle: sharedToolDetailSchema['shape'].lifecycle,
  alternativeNotes: z
    .array(
      z
        .object({
          name: safePublicTextSchema(MAX_PUBLIC_METADATA_LABEL_LENGTH).optional(),
          slug: z
            .string()
            .refine(isValidToolPublicSlug, 'Expected a canonical public Tool slug.')
            .optional(),
          note: safePublicTextSchema(MAX_PUBLIC_ALTERNATIVE_NOTE_LENGTH),
          sourceUrl: z
            .string()
            .refine(
              (value) => value.startsWith('https://') && validatePublicHttpUrl(value).success,
              'Use a public HTTPS URL without credentials.',
            ),
        })
        .refine(
          (note) => note.name !== undefined || note.slug !== undefined,
          'Name the alternative by its tool name or slug.',
        ),
    )
    .optional(),
  targetAudience: sharedToolDetailSchema['shape'].targetAudience,
  fitGuidance: sharedToolDetailSchema['shape'].fitGuidance,

  pricingDetails: sharedToolDetailSchema['shape'].pricingDetails,
  resourceLinks: sharedToolDetailSchema['shape'].resourceLinks,
  resourceRelationships: sharedToolDetailSchema['shape'].resourceRelationships,
  sourceReferences: z.array(publicSourceReferenceSchema).optional(),
  agentReadiness: sharedToolDetailSchema['shape'].agentReadiness,
  checkSummary: sharedToolDetailSchema['shape'].checkSummary,
  runtimeRequirements: runtimeRequirementsSchema.optional(),
  publisher: sharedToolDetailSchema['shape'].publisher,
  productLimits: productLimitsSchema.optional(),
  securityPrivacyPosture: securityPrivacyPostureSchema.optional(),
  alternativeTools: z.array(toolSummarySchema).optional(),
  relatedTools: z.array(toolSummarySchema).optional(),
  integrations: z
    .array(publicToolIntegrationSchema)
    .max(MAX_PUBLIC_TOOL_INTEGRATIONS)
    .transform((facts) => normalizePublicToolIntegrationFacts(facts))
    .pipe(z.array(publicToolIntegrationSchema).max(MAX_PUBLIC_TOOL_INTEGRATIONS))
    .optional(),
  keyFeatures: z
    .array(safePublicTextSchema(MAX_PUBLIC_METADATA_LABEL_LENGTH))
    .max(MAX_TOOL_DECISION_KEY_FEATURES)
    .default([]),
  pricingHistory: z
    .object({
      url: firstPartyHttpUrlSchema,
      latestValidatedChange: z.object({
        previous: z.enum(['free', 'freemium', 'paid']),
        current: z.enum(['free', 'freemium', 'paid']),
        changedAt: canonicalUtcDateTime,
      }),
    })
    .optional(),
  agentInterfaces: z.array(publicAgentInterfaceSchema).max(MAX_PUBLIC_AGENT_INTERFACES).optional(),
  quickstarts: z.array(toolQuickstartSchema).optional(),
});

export const searchIndexToolSchema = toolSummarySchema.omit({ freshness: true }).extend({
  resourceKindIsFallback: sharedSearchIndexToolSchema['shape'].resourceKindIsFallback,
  supportedLanguages: sharedSearchIndexToolSchema['shape'].supportedLanguages,
  freshness: sharedSearchIndexToolSchema['shape'].freshness,
  agentInterfaceKinds: sharedSearchIndexToolSchema['shape'].agentInterfaceKinds,
  setupRecipeHosts: sharedSearchIndexToolSchema['shape'].setupRecipeHosts,
  tagline: sharedSearchIndexToolSchema['shape'].tagline,
  keyFeatures: sharedSearchIndexToolSchema['shape'].keyFeatures,
  securityCapabilities: sharedSearchIndexToolSchema['shape'].securityCapabilities,
  targetAudience: sharedSearchIndexToolSchema['shape'].targetAudience,
  _id: sharedSearchIndexToolSchema['shape']._id,
  visibility: sharedSearchIndexToolSchema['shape'].visibility,
  pricingDetails: sharedSearchIndexToolSchema['shape'].pricingDetails,
  logoUrl: sharedSearchIndexToolSchema['shape'].logoUrl,
  logoMarkUrl: sharedSearchIndexToolSchema['shape'].logoMarkUrl,
  logoDarkUrl: sharedSearchIndexToolSchema['shape'].logoDarkUrl,
  faviconUrl: sharedSearchIndexToolSchema['shape'].faviconUrl,
  logoTreatment: sharedSearchIndexToolSchema['shape'].logoTreatment,
  search: sharedSearchIndexToolSchema['shape'].search,
  integrations: z
    .array(publicToolIntegrationSchema)
    .max(MAX_PUBLIC_TOOL_INTEGRATIONS)
    .transform((facts) => normalizePublicToolIntegrationFacts(facts))
    .pipe(z.array(publicToolIntegrationSchema).max(MAX_PUBLIC_TOOL_INTEGRATIONS))
    .optional(),
});

const feedEnvelope = <T>(
  dataSchema: z.ZodType<T>,
  versionSchema: z.ZodType<string> = catalogFeedVersionSchema,
  validateAt?: (data: T, referenceTime: Date, context: z.RefinementCtx) => void,
) =>
  z
    .object({
      version: versionSchema,
      siteUrl: z.string(),
      generatedAt: z.iso.datetime({ offset: true }),
      catalogRevision: z.string().optional(),
      contentHash: z.string().optional(),
      data: dataSchema,
    })
    .superRefine((feed, context) => {
      validateAt?.(feed.data, new Date(feed.generatedAt), context);
    })
    .transform((feed) => ({
      ...feed,
      data: normalizePublicToolFeedFreshness(feed.data),
    }));

const uniqueSearchToolsSchema = z.array(searchIndexToolSchema).superRefine((tools, context) => {
  const seen = new Set<string>();
  tools.forEach((tool, index) => {
    if (seen.has(tool.slug)) {
      context.addIssue({
        code: 'custom',
        path: [index, 'slug'],
        message: 'Tool slugs must be unique.',
      });
    }
    seen.add(tool.slug);
  });
});

const searchIndexArticleSchema = z.object({
  title: safePublicTextValueSchema,
  slug: sharedSearchIndexArticleSchema['shape'].slug,
  excerpt: safePublicTextValueSchema.optional(),
  publishedAt: sharedSearchIndexArticleSchema['shape'].publishedAt,
  url: firstPartyHttpUrlSchema,
});

export const searchIndexFeedSchema = feedEnvelope(
  z.object({
    tools: uniqueSearchToolsSchema,
    articles: z.array(searchIndexArticleSchema).optional(),
    filters: z.object({
      pricing: z.array(searchFilterOptionSchema),
      platforms: z.array(searchFilterOptionSchema),
      resourceKinds: z.array(searchFilterOptionSchema),
      securityCapabilities: z.array(searchFilterOptionSchema).optional(),
      agentInterfaceKinds: z.array(searchFilterOptionSchema).optional(),
      integrations: z.array(searchFilterOptionSchema).optional(),
      supportedLanguages: z.array(searchFilterOptionSchema).optional(),
      setupRecipeHosts: z.array(searchFilterOptionSchema).optional(),
      sourceAvailability: z.array(searchFilterOptionSchema).optional(),
      categories: z.array(searchFilterOptionSchema),
      tags: z.array(searchFilterOptionSchema),
      useCases: z.array(searchFilterOptionSchema),
    }),
    queryContract: z.json().transform(parseAgentSearchQueryContract),
  }),
  searchIndexVersionSchema,
  toolProfileTemporalValidators.tools,
).superRefine((feed, context) => {
  for (const [index, article] of (feed.data.articles ?? []).entries()) {
    if (
      publicHttpUrlSchema.safeParse(article.url).success ||
      isLocalFeedUrl(article.url, feed.siteUrl)
    )
      continue;
    context.addIssue({
      code: 'custom',
      path: ['data', 'articles', index, 'url'],
      message: 'Article URL must be public or match the loopback HTTP catalog origin',
    });
  }
});

export const toolsFeedSchema = feedEnvelope(
  z.object({
    tools: z.array(toolSummarySchema),
  }),
  undefined,
  toolProfileTemporalValidators.tools,
);

export const toolDetailFeedSchema: z.ZodType<AgentToolDetailFeed> = feedEnvelope(
  toolDetailSchema.transform((detail) => ({
    ...detail,
    agentInterfaces: detail.agentInterfaces?.map(fillAgentSetupRecipeEntrySnippets),
  })),
  undefined,
  toolProfileTemporalValidators.toolDetail,
);

const toolStackRecipeGuidanceSchema = z.object({
  label: safePublicTextValueSchema,
  description: safePublicTextValueSchema.optional(),
  sourceReferences: z.array(publicSourceReferenceSchema).optional(),
});

const toolStackRecipeRelatedToolSchema = z.object({
  name: z.string(),
  slug: z.string(),
  detailUrl: z.string(),
  resourceLinks: z.array(resourceLinkSchema).optional(),
  agentInterfaces: z
    .array(
      publicAgentInterfaceSchema
        .pick({
          kind: true,
          status: true,
          label: true,
          docsUrl: true,
        })
        .required({ docsUrl: true }),
    )
    .optional(),
});

const toolStackRecipeStepSchema = z
  .object({
    kind: sharedToolStackRecipeStepSchema['shape'].kind,
    title: safePublicTextValueSchema,
    instruction: safePublicTextValueSchema,
    example: sharedToolStackRecipeStepSchema['shape'].example,
    language: safePublicTextValueSchema.optional(),
    expectedOutput: safePublicTextValueSchema.optional(),
    relatedTool: toolStackRecipeRelatedToolSchema.optional(),
    sourceReferences: z.array(publicSourceReferenceSchema).optional(),
  })
  .superRefine((step, context) => {
    if ((step.kind === 'command' || step.kind === 'prompt') && !step.example?.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['example'],
        message: 'Command and prompt recipe steps require an explicit example.',
      });
    }
  });

const toolStackRecipeSchema = z
  .object({
    executionMode: sharedToolStackRecipeSchema['shape'].executionMode,
    title: safePublicTextValueSchema,
    summary: safePublicTextValueSchema.optional(),
    reviewedAt: sharedToolStackRecipeSchema['shape'].reviewedAt,
    prerequisites: z.array(toolStackRecipeGuidanceSchema).min(1),
    limitations: z.array(toolStackRecipeGuidanceSchema).min(1),
    steps: z.array(toolStackRecipeStepSchema).min(1),
    sourceReferences: z.array(publicSourceReferenceSchema).min(1),
  })
  .superRefine((recipe, context) => {
    if (!recipe.steps.some((step) => step.kind === 'verification')) {
      context.addIssue({
        code: 'custom',
        path: ['steps'],
        message: 'Tool Stack recipes require a verification step.',
      });
    }
  });

export const stackItemSchema = z.object({
  name: sharedStacksItemSchema['shape'].name,
  slug: sharedStacksItemSchema['shape'].slug,
  description: sharedStacksItemSchema['shape'].description,
  publishedAt: sharedStacksItemSchema['shape'].publishedAt,
  editorialReview: sharedStacksItemSchema['shape'].editorialReview,
  url: sharedStacksItemSchema['shape'].url,
  author: sharedStacksItemSchema['shape'].author,
  tags: sharedStacksItemSchema['shape'].tags,
  categories: sharedStacksItemSchema['shape'].categories,
  recipe: toolStackRecipeSchema.optional(),
  tools: z.array(
    z.object({
      role: z.string(),
      description: z.string().optional(),
      sourceReferences: z.array(publicSourceReferenceSchema).optional(),
      tool: toolSummarySchema.optional(),
    }),
  ),
});

export const bestItemSchema = z.object({
  title: sharedBestItemSchema['shape'].title,
  slug: sharedBestItemSchema['shape'].slug,
  intro: sharedBestItemSchema['shape'].intro,
  conclusion: sharedBestItemSchema['shape'].conclusion,
  publishedAt: sharedBestItemSchema['shape'].publishedAt,
  editorialReview: sharedBestItemSchema['shape'].editorialReview,
  url: sharedBestItemSchema['shape'].url,
  relatedCategory: sharedBestItemSchema['shape'].relatedCategory,
  rankedTools: z.array(
    z.object({
      rank: z.number(),
      editorialBlurb: z.string(),
      sourceReferences: z.array(publicSourceReferenceSchema).optional(),
      tool: toolSummarySchema.optional(),
    }),
  ),
});

export const categoryItemSchema = z.object({
  name: z.string(),
  slug: z.string(),
  description: z.string().optional(),
  url: z.string(),
  toolCount: z.number().int().nonnegative().optional(),
  parentCategory: taxonomyReferenceSchema.optional(),
  featuredTools: z.array(toolSummarySchema).optional(),
});

// Explicit annotations avoid TS7056 declaration emit blowups from deep Zod inference.
export const stacksFeedSchema: z.ZodType<AgentToolStackFeed> = feedEnvelope(
  z.object({
    stacks: z.array(stackItemSchema),
  }),
  undefined,
  toolProfileTemporalValidators.stacks,
);

export const bestFeedSchema: z.ZodType<AgentCuratedListFeed> = feedEnvelope(
  z.object({
    best: z.array(bestItemSchema),
  }),
  undefined,
  toolProfileTemporalValidators.best,
);

export const categoriesFeedSchema: z.ZodType<AgentCategoriesFeed> = feedEnvelope(
  z.object({
    categories: z.array(categoryItemSchema),
  }),
  undefined,
  toolProfileTemporalValidators.categories,
);

export const taxonomyListItemSchema = z.object({
  name: z.string(),
  slug: z.string(),
  description: z.string().optional(),
  url: z.string(),
  toolCount: z.number().int().nonnegative().optional(),
});

export const tagsFeedSchema: z.ZodType<AgentTagsFeed> = feedEnvelope(
  z.object({
    tags: z.array(taxonomyListItemSchema),
  }),
);

export const useCasesFeedSchema: z.ZodType<AgentUseCasesFeed> = feedEnvelope(
  z.object({
    useCases: z.array(
      taxonomyListItemSchema.extend({
        tools: z.array(toolSummarySchema).optional(),
      }),
    ),
  }),
  undefined,
  toolProfileTemporalValidators.useCases,
);

const alternativeToolSummarySchema = toolSummarySchema.extend({
  switchReason: publicToolSwitchReasonSchema.optional(),
  agentInterfaceKinds: z.array(z.enum(AGENT_INTERFACE_KIND_VALUES)).optional(),
});

const alternativesSetItemSchema = z
  .object({
    name: z.string(),
    slug: z.string(),
    detailUrl: z.string(),
    alternativesUrl: z.string(),
    alternativeCount: z.number().int().min(1),
    alternatives: z.array(alternativeToolSummarySchema),
    switchingGroups: z.array(publicToolSwitchingGroupSchema).optional(),
    comparisonFacts: publicComparisonFactsSchema.optional(),
    markdownUrl: z.string(),
    jsonUrl: z.string(),
  })
  .refine((set) => set.alternativeCount === set.alternatives.length, {
    message: 'alternativeCount must equal the alternatives array length',
    path: ['alternativeCount'],
  });

export const alternativesFeedSchema: z.ZodType<AgentAlternativesFeed> = feedEnvelope(
  z.object({
    alternativesUrl: z.string(),
    sets: z.array(alternativesSetItemSchema),
  }),
  undefined,
  toolProfileTemporalValidators.alternativesIndex,
);

export const alternativesDetailFeedSchema: z.ZodType<AgentAlternativesDetailFeed> = feedEnvelope(
  alternativesSetItemSchema.extend({
    description: z.string().optional(),
    sourceTool: toolSummarySchema,
  }),
  undefined,
  toolProfileTemporalValidators.alternativesDetail,
);

const comparisonPairItemSchema = z.object({
  editorialContentPolicy: sharedComparisonPairItemSchema['shape'].editorialContentPolicy,
  slug: sharedComparisonPairItemSchema['shape'].slug,
  title: sharedComparisonPairItemSchema['shape'].title,
  description: sharedComparisonPairItemSchema['shape'].description,
  pageUrl: publicHttpUrlSchema,
  jsonUrl: publicHttpUrlSchema,
  markdownUrl: publicHttpUrlSchema,
  primary: toolSummarySchema,
  secondary: toolSummarySchema,
  verdict: sharedComparisonPairItemSchema['shape'].verdict,
  reviewedAt: sharedComparisonPairItemSchema['shape'].reviewedAt,
  primaryComparisonFacts: publicComparisonFactsSchema.optional(),
  secondaryComparisonFacts: publicComparisonFactsSchema.optional(),
  featureRows: z
    .array(
      z.object({
        label: z.string(),
        primary: z.string(),
        secondary: z.string(),
      }),
    )
    .optional(),
  sourceReferences: z
    .array(
      z.object({
        title: z.string().optional(),
        url: publicHttpUrlSchema,
        publisher: z.string().optional(),
        accessedAt: z.string().optional(),
      }),
    )
    .optional(),
});

export const comparisonsFeedSchema: z.ZodType<AgentComparisonsFeed> = feedEnvelope(
  z.object({
    comparisonsUrl: publicHttpUrlSchema,
    comparisons: z.array(comparisonPairItemSchema),
  }),
  undefined,
  toolProfileTemporalValidators.comparisonsIndex,
);

export const comparisonDetailFeedSchema: z.ZodType<AgentComparisonDetailFeed> = feedEnvelope(
  comparisonPairItemSchema,
  undefined,
  toolProfileTemporalValidators.comparisonsDetail,
);

export const indexFeedSchema = z.object({
  version: sharedIndexFeedSchema['shape'].version,
  siteUrl: sharedIndexFeedSchema['shape'].siteUrl,
  generatedAt: sharedIndexFeedSchema['shape'].generatedAt,
  catalogRevision: sharedIndexFeedSchema['shape'].catalogRevision,
  contentHash: sharedIndexFeedSchema['shape'].contentHash,
  contentHashes: sharedIndexFeedSchema['shape'].contentHashes,
  schemaUrl: sharedIndexFeedSchema['shape'].schemaUrl,
  compatibility: sharedIndexFeedSchema['shape'].compatibility,
  markdownArtifacts: sharedIndexFeedSchema['shape'].markdownArtifacts,
  integrationHubUrl: sharedIndexFeedSchema['shape'].integrationHubUrl,
  markdownHubUrl: sharedIndexFeedSchema['shape'].markdownHubUrl,
  toolDetailUrlTemplate: sharedIndexFeedSchema['shape'].toolDetailUrlTemplate,
  stackDetailUrlTemplate: sharedIndexFeedSchema['shape'].stackDetailUrlTemplate,
  bestDetailUrlTemplate: sharedIndexFeedSchema['shape'].bestDetailUrlTemplate,
  alternativesDetailUrlTemplate: sharedIndexFeedSchema['shape'].alternativesDetailUrlTemplate,
  comparisonDetailUrlTemplate: sharedIndexFeedSchema['shape'].comparisonDetailUrlTemplate,
  citationGuidance: sharedIndexFeedSchema['shape'].citationGuidance,
  artifacts: sharedIndexFeedSchema['shape'].artifacts,
  snapshots: z
    .object({
      full: z.string().min(1),
      ndjson: z.string().min(1),
    })
    .catchall(z.string().min(1)),
  feeds: z
    .object({
      tools: z.string().min(1),
      projectManifestTools: z.string().min(1).optional(),
      searchIndex: z.string().min(1),
      categories: z.string().min(1),
      tags: z.string().min(1),
      useCases: z.string().min(1),
      stacks: z.string().min(1),
      best: z.string().min(1),
      alternatives: z.string().min(1).optional(),
      comparisons: z.string().min(1).optional(),
      toolLookup: z.string().min(1).optional(),
    })
    .catchall(z.string().min(1)),
});

/** Re-export for callers that need allowed resource kinds in messages. */
export const KNOWN_RESOURCE_KINDS = RESOURCE_KIND_VALUES;
