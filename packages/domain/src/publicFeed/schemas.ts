import { isRuntimeString } from '../runtimeValidation.js';
import {CATALOG_CONTENT_POLICY, TOOL_UNTRUSTED_CONTENT_FIELDS} from '../catalogContentPolicy.js';
import { agentReadinessSchema, agentSetupFactsSchema } from '../agentInterface.js';

import { publicFreeTierTermsSchema } from '../toolPricingEvidence.js';
import {
  publicToolCheckSummarySchema,
  publicToolSwitchingGroupSchema,
  publicToolSwitchReasonSchema,
} from '../publishedToolFeedSchemas.js';
import { excludedRegistryIdentitySchema } from '../toolIdentityReview.js';
import { toolPricingEvidenceSchema } from '../toolPricingEvidence.js';
import { personaCostEstimateSchema } from '../personaCostContract.js';
import { toolEditionsSchema, toolEditionSummarySchema } from '../toolEditions.js';
import { uiComponentSchema } from '../uiComponent.js';
import { publicToolDealSchema } from '../publicToolDeal.js';
import { contentSignalSchema } from '../contentSignals.js';
import { publicToolPortabilitySchema } from '../toolPortability.js';
import { toolDeploymentSchema } from '../toolDeployment.js';
import { publicToolLicenseFactSchema } from '../publicToolLicenseFacts.js';
import { publicToolLifecycleSchema } from '../toolLifecycle.js';
import { supportedLanguageSchema } from '../supportedLanguage.js';
import { normalizePublicToolIntegrationFacts } from '../publicToolIntegrationFact.js';
import { publicPublisherIdentitySchema } from '../publisher.js';
import { toolFeaturePublicDetailSchema } from '../toolFeatureDetails.js';
import { catalogFeedVersionSchema, searchIndexVersionSchema } from '../feedCompatibility.js';
import {
  AGENT_AUTOMATION_CAPABILITY_VALUES,
  AGENT_AUTOMATION_EVIDENCE_BASIS_VALUES,
  AGENT_AUTOMATION_ISOLATION_SUPPORT_VALUES,
  AGENT_AUTOMATION_SIDE_EFFECT_VALUES,
  AGENT_AUTOMATION_WORKSPACE_CONCURRENCY_VALUES,
  AGENT_INTERFACE_KIND_VALUES,
  AGENT_INTERFACE_SOURCE_VALUES,
  AGENT_INTERFACE_STATUS_VALUES,
} from '../agentInterface.js';
import {
  AGENT_SETUP_RECIPE_HOST_VALUES,
  fillAgentSetupRecipeEntrySnippets,
} from '../mcpRegistry.js';
import { INTEGRATION_STATUS_VALUES } from '../integrationStatus.js';
import { TOOL_LOGO_TREATMENTS } from '../toolLogoTreatment.js';
import {
  MAX_PUBLIC_SOURCE_REFERENCE_URL_LENGTH,
  SOURCE_REFERENCE_TYPE_VALUES,
  normalizePublicSourceReferenceUrl,
} from '../sourceReference.js';
import {
  PRODUCT_LIMIT_BASIS_VALUES,
  PRODUCT_LIMIT_COMPARATOR_VALUES,
  PRODUCT_LIMIT_MAX_FACTS,
  PRODUCT_LIMIT_VENDOR_CLAIM_SOURCE_VALUES,
} from '../productLimits.js';
import {
  MAX_PUBLIC_ALTERNATIVE_NOTE_LENGTH,
  MAX_PUBLIC_METADATA_LABEL_LENGTH,
} from '../publicMetadata.js';
import { MAX_TOOL_DECISION_KEY_FEATURES } from '../toolDecisionSupport.js';
import { RESOURCE_KIND_VALUES } from '../resourceKind.js';
import {
  RESOURCE_RELATIONSHIP_DIRECTION_VALUES,
  RESOURCE_RELATIONSHIP_KIND_VALUES,
  getResourceRelationshipLabel,
} from '../resourceRelationship.js';
import {
  RUNTIME_REQUIREMENT_STATUS_VALUES,
  RUNTIME_REQUIREMENT_SUBJECT_KIND_VALUES,
  parsePublicRuntimeRequirements,
} from '../runtimeRequirements.js';
import {
  TOOL_QUICKSTART_COMMAND_LANGUAGE_VALUES,
  TOOL_QUICKSTART_KIND_VALUES,
} from '../toolQuickstart.js';
import {
  TOOL_STACK_RECIPE_STEP_KINDS,
  isSafePublicToolStackRecipeExample,
} from '../toolStackRecipe.js';
import {
  TOOL_ALTERNATE_NAME_MAX_ITEMS,
  TOOL_ALTERNATE_NAME_MAX_LENGTH,
} from '../searchIndexAliases.js';
import {
  TOOL_TRIAL_CARD_REQUIREMENT_VALUES,
  TOOL_TRIAL_ELIGIBILITY_VALUES,
  TOOL_TRIAL_END_BEHAVIOR_VALUES,
  TRIAL_TERMS_MAX_DURATION_LENGTH,
  TRIAL_TERMS_MAX_EVIDENCE,
  TRIAL_TERMS_MAX_NAME_LENGTH,
  TRIAL_TERMS_MAX_NOTE_LENGTH,
} from '../toolTrialTerms.js';
import { containsUnsafePublicTextCharacters, isSafePublicText } from '../publicText.js';
import {
  publicAgentSetupRecipeEntrySchema,
  publicStdioSetupRecipeSchema,
  publicAgentSetupRecipeSchema,
  getPublicToolDetailTemporalIssues,
  getPublicToolSummaryTemporalIssues,
  publicRepositoryObservationSchema,
  publicToolFreshnessSchema as freshnessSchema,

  publicToolFitGuidanceSchema,
  publicToolResourceIdentityReferenceSchema as resourceIdentitySchema,
  publicToolResourceLinkSchema as resourceLinkSchema,
  publicToolResourceLinksSchema as resourceLinksSchema,
  normalizePublicToolFeedFreshness,
  type PublicToolFeedTemporalIssue,
} from '../publishedToolFeedSchemas.js';
import { isValidToolPublicSlug } from '../toolLookup.js';
import { parseAgentSearchQueryContract } from '../agentSearchQueryContract.js';
import { validateAbsoluteHttpUrl, validatePublicHttpUrl } from '../urlSafety.js';
import { SECURITY_CAPABILITY_VALUES } from '../securityCapability.js';
import { z } from 'zod';

import type {
  AgentCategoriesFeed,
  AgentAlternativesFeed,
  AgentAlternativesDetailFeed,
  AgentComparisonDetailFeed,
  AgentComparisonsFeed,
  AgentCuratedListFeed,
  AgentIndexFeed,
  AgentSearchIndexFeed,
  AgentTagsFeed,
  AgentToolDetailFeed,
  AgentToolStackFeed,
  AgentToolsFeed,
  AgentUseCasesFeed,
} from './types.js';

export const stringArraySchema = z.array(z.string());
const canonicalUtcDateTime = z.iso.datetime({ offset: false });
const firstPartyHttpUrlSchema = z
  .string()
  .max(MAX_PUBLIC_SOURCE_REFERENCE_URL_LENGTH)
  .refine(
    (value) => validateAbsoluteHttpUrl(value).success && new URL(value).href === value,
    'Expected a canonical first-party http(s) URL without credentials or control characters',
  );

const safePublicTextValueSchema = z
  .string()
  .min(1)
  .refine(isSafePublicText, 'Public text must be trimmed and exclude control or bidi characters');

const safePublicTextSchema = (maxLength: number) => safePublicTextValueSchema.max(maxLength);

const safeMultilinePublicTextValueSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      value.trim() === value &&
      value.split(/\r\n|\n|\r/u).every((line) => !containsUnsafePublicTextCharacters(line)),
    'Public prose must be trimmed and exclude control or bidi characters other than line breaks',
  );
const publicComparisonFactsSchema = z.object({
  bestFor: z.array(safeMultilinePublicTextValueSchema).optional(),
  notBestFor: z.array(safeMultilinePublicTextValueSchema).optional(),
  strengths: z.array(safeMultilinePublicTextValueSchema).optional(),
  limitations: z.array(safeMultilinePublicTextValueSchema).optional(),
  pricingNotes: safeMultilinePublicTextValueSchema.optional(),
  platformNotes: safeMultilinePublicTextValueSchema.optional(),
  migrationNotes: safeMultilinePublicTextValueSchema.optional(),
  lastReviewedAt: safePublicTextValueSchema.optional(),
  reviewedBy: safePublicTextValueSchema.optional(),
  claimStandard: z.enum(['facts_only', 'balanced_editorial', 'needs_sources']).optional(),
  generationReadiness: z.enum(['ready', 'needs_editorial', 'do_not_generate']).optional(),
  editorialNotes: safeMultilinePublicTextValueSchema.optional(),
});
const publicResourceUrlSchema = z
  .string()
  .refine(
    (value) => normalizePublicSourceReferenceUrl(value) === value,
    'Resource URL must be a canonical public http(s) URL without credentials or control characters',
  );

const recipePublicHttpUrlSchema = z
  .string()
  .refine(
    (value) => validatePublicHttpUrl(value).success,
    'Recipe links must use a public HTTP or HTTPS URL',
  );

const sourceReferenceSchema = z.object({
  title: z.string(),
  url: z.url(),
  sourceType: z.enum(SOURCE_REFERENCE_TYPE_VALUES),
  checkedAt: z.string().optional(),
  note: z.string().optional(),
});

const runtimeRequirementStructureSchema = z
  .object({
    subjectKind: z.enum(RUNTIME_REQUIREMENT_SUBJECT_KIND_VALUES),
    subjectName: z.string().min(1),
    environmentRange: z.string().min(1),
    toolRange: z.string().min(1).optional(),
    status: z.enum(RUNTIME_REQUIREMENT_STATUS_VALUES),
    note: z.string().min(1).optional(),
    evidence: z.array(
      z
        .object({
          title: z.string().min(1),
          url: z.string(),
          checkedAt: z.string(),
        })
        .strict(),
    ),
    reviewedAt: z.string(),
  })
  .strict();

export const runtimeRequirementsSchema = z
  .array(runtimeRequirementStructureSchema)
  .superRefine((requirements, context) => {
    const parsed = parsePublicRuntimeRequirements(requirements);
    if (parsed.success) return;
    for (const issue of parsed.issues) {
      context.addIssue({
        code: 'custom',
        path: [...issue.path],
        message: issue.message,
      });
    }
  });

const productLimitEvidenceSchema = sourceReferenceSchema.extend({ checkedAt: z.string() });
const assertiveProductLimitEvidenceSchema = z.array(productLimitEvidenceSchema).min(1);

const productLimitVariantSchema = z.union([
  z
    .object({
      state: z.literal('bounded'),
      comparator: z.enum(PRODUCT_LIMIT_COMPARATOR_VALUES),
      value: z.number().finite().nonnegative(),
      unit: z.string().min(1),
      note: z.string().optional(),
      evidence: assertiveProductLimitEvidenceSchema,
      reviewedAt: z.string(),
    })
    .strict(),
  z
    .object({
      state: z.literal('unlimited_claimed'),
      note: z.string().optional(),
      evidence: assertiveProductLimitEvidenceSchema,
      reviewedAt: z.string(),
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
    }),
  z
    .object({
      state: z.enum(['not_disclosed', 'unknown']),
      note: z.string().optional(),
      evidence: z.array(productLimitEvidenceSchema).max(0),
    })
    .strict(),
]);

const productLimitGroupSchema = z
  .object({
    metric: z.string().min(1),
    planScope: z.string().optional(),
    deploymentScope: z.string().optional(),
    basis: z.enum(PRODUCT_LIMIT_BASIS_VALUES).optional(),
    ambiguous: z.boolean(),
    facts: z.array(productLimitVariantSchema).min(1),
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
    if (groups.reduce((total, group) => total + group.facts.length, 0) > PRODUCT_LIMIT_MAX_FACTS) {
      context.addIssue({
        code: 'custom',
        message: `Product limits must contain at most ${PRODUCT_LIMIT_MAX_FACTS} total facts`,
      });
    }
  });

export const taxonomyReferenceSchema = z.object({
  name: z.string(),
  slug: z.string(),
  description: z.string().optional(),
  url: z.string().optional(),
});

export const resourceKindReferenceSchema = z.object({
  value: z.string(),
  label: z.string(),
});

export const searchFreshnessSchema = z.object({
  hasDeadDestination: z.boolean().optional(),
  verifiedAt: z.iso.datetime({ offset: true }).optional(),
  lastCheckedAt: z.iso.datetime({ offset: true }).optional(),
});

export const trialTermsSchema = z
  .object({
    planName: safePublicTextSchema(TRIAL_TERMS_MAX_NAME_LENGTH).optional(),
    eligibility: z.enum(TOOL_TRIAL_ELIGIBILITY_VALUES).optional(),
    eligibilityNote: safePublicTextSchema(TRIAL_TERMS_MAX_NOTE_LENGTH).optional(),
    duration: safePublicTextSchema(TRIAL_TERMS_MAX_DURATION_LENGTH).optional(),
    cardRequirement: z.enum(TOOL_TRIAL_CARD_REQUIREMENT_VALUES).optional(),
    endBehavior: z.enum(TOOL_TRIAL_END_BEHAVIOR_VALUES).optional(),
    endNote: safePublicTextSchema(TRIAL_TERMS_MAX_NOTE_LENGTH).optional(),
    evidence: z.array(productLimitEvidenceSchema).min(1).max(TRIAL_TERMS_MAX_EVIDENCE),
    reviewedAt: z.iso.datetime({ offset: true }),
  })
  .refine(
    (terms) =>
      Boolean(
        terms.planName ||
        terms.eligibility ||
        terms.eligibilityNote ||
        terms.duration ||
        terms.cardRequirement ||
        terms.endBehavior ||
        terms.endNote,
      ),
    { message: 'Trial terms need at least one visitor-facing detail' },
  );

export const pricingDetailsSchema = toolPricingEvidenceSchema.safeExtend({
  personaCosts: z.array(personaCostEstimateSchema).optional(),
  startingPrice: z.number().optional(),
  currency: z.enum(['USD', 'EUR', 'GBP']).optional(),
  pricingUrl: z.string().optional(),
  trialAvailability: z.enum(['available', 'unavailable']).optional(),
  freeTierTerms: publicFreeTierTermsSchema.optional(),
  trialTerms: trialTermsSchema.optional(),
  discountTypes: z.array(z.enum(['coupon-code', 'student-discount', 'seasonal-deal'])).optional(),
});

const toolIntegrationSchema = z
  .object({
    slug: z.string(),
    name: z.string(),
    status: z.enum(INTEGRATION_STATUS_VALUES),
    extensionName: z.string().optional(),
    checkedAt: z.string().optional(),
    sourceUrl: z.string().optional(),
  })
  .strip();

export const agentInterfaceSchema = z.object({
  kind: z.enum(AGENT_INTERFACE_KIND_VALUES),
  status: z.enum(AGENT_INTERFACE_STATUS_VALUES),
  label: z.string(),
  source: z.enum(AGENT_INTERFACE_SOURCE_VALUES).optional(),
  identifier: z.string().optional(),
  docsUrl: z.string().optional(),
  installCommand: z.string().optional(),
  operatingSystem: z.enum(['macos', 'windows', 'linux']).optional(),
  downloadUrl: z.string().optional(),
  authRequirement: z.string().optional(),
  setupFacts: agentSetupFactsSchema.optional(),
  checkedAt: z.string().optional(),
  capabilitiesNote: z.string().optional(),
  setupRecipe: publicAgentSetupRecipeSchema.optional(),
  setupRecipes: z.array(publicAgentSetupRecipeEntrySchema).optional(),
  stdioSetupRecipe: publicStdioSetupRecipeSchema.optional(),
  sseOnlyRemotes: z.literal(true).optional(),
  automation: z
    .object({
      nonInteractive: z.enum(AGENT_AUTOMATION_CAPABILITY_VALUES).optional(),
      structuredOutput: z.enum(AGENT_AUTOMATION_CAPABILITY_VALUES).optional(),
      dryRun: z.enum(AGENT_AUTOMATION_CAPABILITY_VALUES).optional(),
      evidenceBasis: z.enum(AGENT_AUTOMATION_EVIDENCE_BASIS_VALUES).optional(),
      sideEffects: z.array(z.enum(AGENT_AUTOMATION_SIDE_EFFECT_VALUES)).optional(),
      workspaceConcurrency: z.enum(AGENT_AUTOMATION_WORKSPACE_CONCURRENCY_VALUES).optional(),
      isolationSupport: z.array(z.enum(AGENT_AUTOMATION_ISOLATION_SUPPORT_VALUES)).optional(),
      checkedAt: z.string(),
      notes: z.string().optional(),
      evidenceReferences: z.array(sourceReferenceSchema),
    })
    .optional(),
});

export const toolFitGuidanceSchema = publicToolFitGuidanceSchema;

const resourceRelationshipSchema = z
  .object({
    kind: z.enum(RESOURCE_RELATIONSHIP_KIND_VALUES),
    direction: z.enum(RESOURCE_RELATIONSHIP_DIRECTION_VALUES),
    label: safePublicTextValueSchema,
    target: z
      .object({
        id: z.string().min(1),
        name: safePublicTextValueSchema,
        slug: z.string().min(1),
        canonicalUrl: publicResourceUrlSchema,
        resourceKind: resourceKindReferenceSchema.extend({ value: z.enum(RESOURCE_KIND_VALUES) }),
      })
      .strict(),
    evidenceUrl: publicResourceUrlSchema.optional(),
  })
  .strict()
  .superRefine((relationship, context) => {
    if (
      relationship.label !== getResourceRelationshipLabel(relationship.kind, relationship.direction)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['label'],
        message: 'Relationship label must match its kind and direction',
      });
    }
  });

export const quickstartSchema = z.object({
  kind: z.enum(TOOL_QUICKSTART_KIND_VALUES),
  label: safePublicTextValueSchema,
  status: z.enum(AGENT_INTERFACE_STATUS_VALUES),
  statusLabel: safePublicTextValueSchema,
  command: safePublicTextSchema(500).optional(),
  commandLanguage: z.enum(TOOL_QUICKSTART_COMMAND_LANGUAGE_VALUES).optional(),
  docsUrl: z.string().optional(),
  source: z.enum(AGENT_INTERFACE_SOURCE_VALUES).optional(),
  sourceLabel: safePublicTextValueSchema.optional(),
  notice: safePublicTextValueSchema.optional(),
});

const securityEvidenceSchema = z.object({
  label: z.string(),
  status: z.enum(['verified', 'claimed', 'unknown', 'not_applicable']),
  sourceUrl: z.string().optional(),
  sourceTitle: z.string().optional(),
  checkedAt: z.string().optional(),
  note: z.string().optional(),
});

export const securityPrivacyPostureSchema = z.object({
  trustCenterUrl: z.string().optional(),
  securityPageUrl: z.string().optional(),
  privacyPolicyUrl: z.string().optional(),
  subprocessorsUrl: z.string().optional(),
  dpaUrl: z.string().optional(),
  dataTrainingPolicyUrl: z.string().optional(),
  dataTrainingPolicySummary: z.string().optional(),
  dataRetentionSummary: z.string().optional(),
  dataResidencySummary: z.string().optional(),
  apiKeyPermissionsSummary: z.string().optional(),
  complianceClaims: z
    .array(
      securityEvidenceSchema.extend({
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
      securityEvidenceSchema.extend({
        capability: z.enum(SECURITY_CAPABILITY_VALUES),
      }),
    )
    .optional(),
});

export const toolSummarySchema = z.object({
  contentSignal: contentSignalSchema.optional(),
  editions: toolEditionsSchema.optional(),
  editionSummary: toolEditionSummarySchema.optional(),
  deployment: toolDeploymentSchema.optional(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  resourceKind: resourceKindReferenceSchema,
  resourceIdentity: resourceIdentitySchema,
  pricing: z.string().optional(),
  platforms: stringArraySchema,
  categories: z.array(taxonomyReferenceSchema),
  tags: z.array(taxonomyReferenceSchema),
  useCases: z.array(taxonomyReferenceSchema),
  freshness: freshnessSchema,
  detailUrl: z.string(),
  website: z.string().optional(),
  visitUrl: z.string(),
  comparisonFacts: publicComparisonFactsSchema.optional(),
});

export const toolDetailSchema = toolSummarySchema.extend({
  editorialContentPolicy: z.literal(CATALOG_CONTENT_POLICY).optional(),
  untrustedContentFields: z.array(z.enum(TOOL_UNTRUSTED_CONTENT_FIELDS)).optional(),
  deals: z.array(publicToolDealSchema).optional(),
  excludedRegistryIdentities: z.array(excludedRegistryIdentitySchema).optional(),
  licenseFacts: z.array(publicToolLicenseFactSchema).optional(),
  _id: z.string().optional(),
  publisher: publicPublisherIdentitySchema.optional(),
  repositoryObservation: publicRepositoryObservationSchema.optional(),
  supportedLanguages: z.array(supportedLanguageSchema).optional(),
  integrations: z
    .array(toolIntegrationSchema)
    .transform((facts) => normalizePublicToolIntegrationFacts(facts).map((fact) => ({ ...fact })))
    .optional(),
  publicationMarker: z.string().optional(),
  tagline: z.string().optional(),
  alternateNames: z
    .array(safePublicTextSchema(TOOL_ALTERNATE_NAME_MAX_LENGTH))
    .max(TOOL_ALTERNATE_NAME_MAX_ITEMS)
    .optional(),
  longDescription: z.string().optional(),
  uiComponent: uiComponentSchema.optional(),
  keyFeatureDetails: z.array(toolFeaturePublicDetailSchema).optional(),
  portability: publicToolPortabilitySchema.optional(),
  lifecycle: publicToolLifecycleSchema.optional(),
  keyFeatures: z
    .array(safePublicTextSchema(MAX_PUBLIC_METADATA_LABEL_LENGTH))
    .max(MAX_TOOL_DECISION_KEY_FEATURES)
    .optional(),
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
  targetAudience: z.string().optional(),
  fitGuidance: toolFitGuidanceSchema.optional(),

  pricingDetails: pricingDetailsSchema.optional(),
  pricingHistory: z
    .object({
      url: firstPartyHttpUrlSchema,
      latestValidatedChange: z.object({
        previous: z.enum(['free', 'paid', 'freemium']),
        current: z.enum(['free', 'paid', 'freemium']),
        changedAt: canonicalUtcDateTime,
      }),
    })
    .optional(),
  resourceLinks: resourceLinksSchema.optional(),
  resourceRelationships: z.array(resourceRelationshipSchema).optional(),
  sourceReferences: z.array(sourceReferenceSchema).optional(),
  agentReadiness: agentReadinessSchema.optional(),
  checkSummary: publicToolCheckSummarySchema.optional(),
  agentInterfaces: z.array(agentInterfaceSchema).optional(),
  runtimeRequirements: runtimeRequirementsSchema.optional(),
  productLimits: productLimitsSchema.optional(),
  securityPrivacyPosture: securityPrivacyPostureSchema.optional(),
  quickstarts: z.array(quickstartSchema).optional(),
  alternativeTools: z.array(toolSummarySchema).optional(),
  relatedTools: z.array(toolSummarySchema).optional(),
});

const addTemporalIssues = (
  issues: PublicToolFeedTemporalIssue[],
  context: z.RefinementCtx,
): void => {
  issues.forEach((issue) =>
    context.addIssue({
      code: 'custom',
      path: ['data', ...issue.path],
      message: issue.message,
    }),
  );
};

export const searchIndexToolSchema = toolSummarySchema.omit({ freshness: true }).extend({
  slug: z.string().refine(isValidToolPublicSlug, 'Tool slug must be a safe public identifier'),
  resourceKindIsFallback: z.literal(true).optional(),
  supportedLanguages: z.array(supportedLanguageSchema).optional(),
  integrations: z
    .array(toolIntegrationSchema)
    .transform((facts) => normalizePublicToolIntegrationFacts(facts).map((fact) => ({ ...fact })))
    .optional(),
  freshness: searchFreshnessSchema,
  securityCapabilities: z.array(z.enum(SECURITY_CAPABILITY_VALUES)).optional(),
  agentInterfaceKinds: z.array(z.enum(AGENT_INTERFACE_KIND_VALUES)).optional(),
  setupRecipeHosts: z.array(z.enum(AGENT_SETUP_RECIPE_HOST_VALUES)).optional(),
  _id: z.string().optional(),
  visibility: z.enum(['standard', 'featured']).optional(),
  pricingDetails: pricingDetailsSchema.optional(),
  logoUrl: z.string().optional(),
  logoMarkUrl: z.string().optional(),
  logoDarkUrl: z.string().optional(),
  faviconUrl: z.string().optional(),
  logoTreatment: z.enum(TOOL_LOGO_TREATMENTS).optional(),
  tagline: z.string().optional(),
  keyFeatures: stringArraySchema.default([]),
  targetAudience: z.string().optional(),
  search: z.object({
    text: z.string(),
    aliases: stringArraySchema.optional(),
    tokens: stringArraySchema.optional(),
    fields: z
      .object({
        name: z.string(),
        description: z.string(),
        tagline: z.string().optional(),
        targetAudience: z.string().optional(),
        keyFeatures: stringArraySchema,
        platforms: stringArraySchema,
        categories: stringArraySchema,
        tags: stringArraySchema,
        useCases: stringArraySchema,
        resourceKind: stringArraySchema,
        agentInterfaceKinds: stringArraySchema.default([]),
        identifiers: stringArraySchema.optional(),
      })
      .optional(),
  }),
});

export const searchFilterOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  count: z.number(),
  url: z.string().optional(),
  /** Category options only: the parent hub slug. Hub counts include their subcategories. */
  parent: z.string().optional(),
});

const searchQueryContractSchema = z.json().transform(parseAgentSearchQueryContract);

export const feedEnvelope = <Output>(
  dataSchema: z.ZodType<Output>,
  versionSchema: z.ZodType<string> = catalogFeedVersionSchema,
  validateAt?: (data: Output, referenceTime: Date, context: z.RefinementCtx) => void,
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

export const toolsFeedSchema = feedEnvelope(
  z.object({ tools: z.array(toolSummarySchema) }),
  undefined,
  (data, referenceTime, context) =>
    data.tools.forEach((tool, index) =>
      addTemporalIssues(
        getPublicToolSummaryTemporalIssues(tool, referenceTime, ['tools', index]),
        context,
      ),
    ),
);
export const toolDetailFeedSchema = feedEnvelope(
  toolDetailSchema.transform((detail) => ({
    ...detail,
    agentInterfaces: detail.agentInterfaces?.map(fillAgentSetupRecipeEntrySnippets),
  })),
  undefined,
  (data, referenceTime, context) =>
    addTemporalIssues(getPublicToolDetailTemporalIssues(data, referenceTime), context),
);
export const uniqueSearchToolsSchema = z
  .array(searchIndexToolSchema)
  .superRefine((tools, context) => {
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

export const searchIndexArticleSchema = z.object({
  title: safePublicTextValueSchema,
  slug: z.string().min(1),
  excerpt: safePublicTextValueSchema.optional(),
  publishedAt: z.string().optional(),
  url: z
    .string()
    .min(1)
    .refine(
      (value) => validateAbsoluteHttpUrl(value).success,
      'Article URLs must be absolute http(s) addresses without credentials',
    ),
});

export const searchIndexDataSchema = z.object({
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
  queryContract: searchQueryContractSchema,
});

export const searchIndexFeedSchema = feedEnvelope(
  searchIndexDataSchema,
  searchIndexVersionSchema,
  (data, referenceTime, context) => {
    data.tools.forEach((tool, index) =>
      addTemporalIssues(
        getPublicToolSummaryTemporalIssues(tool, referenceTime, ['tools', index]),
        context,
      ),
    );
  },
);

export const editorialReviewSchema = z.object({
  reviewedAt: z.string().optional(),
  reviewedBy: z.string().optional(),
  reviewCadence: z.string().optional(),
  nextReviewAt: z.string().optional(),
  methodologySummary: z.string().optional(),
  publicReviewNotes: z.string().optional(),
});

const toolStackRecipeSourceReferenceSchema = sourceReferenceSchema.extend({
  title: safePublicTextValueSchema,
  url: recipePublicHttpUrlSchema,
  note: safePublicTextValueSchema.optional(),
});

const toolStackRecipeGuidanceSchema = z.object({
  label: safePublicTextValueSchema,
  description: safePublicTextValueSchema.optional(),
  sourceReferences: z.array(toolStackRecipeSourceReferenceSchema).optional(),
});

const toolStackRecipeRelatedToolSchema = z.object({
  name: safePublicTextValueSchema,
  slug: z.string(),
  detailUrl: recipePublicHttpUrlSchema,
  resourceLinks: z
    .array(
      resourceLinkSchema.extend({
        label: safePublicTextValueSchema,
        url: recipePublicHttpUrlSchema,
        note: safePublicTextValueSchema.optional(),
      }),
    )
    .optional(),
  agentInterfaces: z
    .array(
      agentInterfaceSchema
        .pick({
          kind: true,
          status: true,
          label: true,
          docsUrl: true,
        })
        .required({ docsUrl: true })
        .extend({
          label: safePublicTextValueSchema,
          docsUrl: recipePublicHttpUrlSchema,
        }),
    )
    .optional(),
});

export const toolStackRecipeStepSchema = z
  .object({
    kind: z.enum(TOOL_STACK_RECIPE_STEP_KINDS),
    title: safePublicTextValueSchema,
    instruction: safePublicTextValueSchema,
    example: z
      .string()
      .refine(
        isSafePublicToolStackRecipeExample,
        'Recipe examples must use normalized line endings and exclude unsafe control or bidi characters.',
      )
      .optional(),
    language: safePublicTextValueSchema.optional(),
    expectedOutput: safePublicTextValueSchema.optional(),
    relatedTool: toolStackRecipeRelatedToolSchema.optional(),
    sourceReferences: z.array(toolStackRecipeSourceReferenceSchema).optional(),
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

export const toolStackRecipeSchema = z
  .object({
    executionMode: z.literal('guidance_only'),
    title: safePublicTextValueSchema,
    summary: safePublicTextValueSchema.optional(),
    reviewedAt: z.iso.datetime({ offset: true }),
    prerequisites: z.array(toolStackRecipeGuidanceSchema).min(1),
    limitations: z.array(toolStackRecipeGuidanceSchema).min(1),
    steps: z.array(toolStackRecipeStepSchema).min(1),
    sourceReferences: z.array(toolStackRecipeSourceReferenceSchema).min(1),
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

export const stacksItemSchema = z.object({
  name: z.string(),
  slug: z.string(),
  description: z.string().optional(),
  publishedAt: z.string().optional(),
  editorialReview: editorialReviewSchema.optional(),
  url: z.string(),
  author: z.string().optional(),
  tags: z.array(taxonomyReferenceSchema).default([]),
  categories: z.array(taxonomyReferenceSchema).optional(),
  recipe: toolStackRecipeSchema.optional(),
  tools: z.array(
    z.object({
      role: z.string(),
      description: z.string().optional(),
      sourceReferences: z.array(sourceReferenceSchema).optional(),
      tool: toolSummarySchema.optional(),
    }),
  ),
});

export const stacksFeedSchema = feedEnvelope(
  z.object({
    stacks: z.array(stacksItemSchema),
  }),
  undefined,
  (data, referenceTime, context) => {
    data.stacks.forEach((stack, stackIndex) =>
      stack.tools.forEach(({ tool }, toolIndex) => {
        if (tool) {
          addTemporalIssues(
            getPublicToolSummaryTemporalIssues(tool, referenceTime, [
              'stacks',
              stackIndex,
              'tools',
              toolIndex,
              'tool',
            ]),
            context,
          );
        }
      }),
    );
  },
);

const publicHttpUrlSchema = z
  .string()
  .min(1)
  .refine(
    (value) => validateAbsoluteHttpUrl(value).success,
    'Taxonomy URLs must be absolute http(s) addresses without credentials',
  );

const alternativesCitationUrlSchema = z
  .string()
  .min(1)
  .refine((value) => {
    if (!validateAbsoluteHttpUrl(value).success) return false;
    return !new URL(value).pathname.startsWith('/go/');
  }, 'Alternatives citation URLs must be absolute http(s) addresses without credentials and must not use tracked /go/ destinations');

const toolPublicSlugSchema = safePublicTextValueSchema.refine(
  isValidToolPublicSlug,
  'Expected a canonical public Tool slug.',
);

const alternativesToolSummarySchema = toolSummarySchema.extend({
  switchReason: publicToolSwitchReasonSchema.optional(),
  agentInterfaceKinds: z.array(z.enum(AGENT_INTERFACE_KIND_VALUES)).optional(),
  name: safePublicTextValueSchema,
  slug: toolPublicSlugSchema,
  description: safeMultilinePublicTextValueSchema,
  pricing: safePublicTextValueSchema.optional(),
  platforms: z.array(safePublicTextValueSchema),
  detailUrl: alternativesCitationUrlSchema,
});

interface AlternativesCitationBase {
  origin: string;
  pathPrefix: string;
}

interface AlternativesCitationSet {
  slug: string;
  detailUrl: string;
  alternativesUrl: string;
  markdownUrl: string;
  jsonUrl: string;
  alternatives: Array<{ slug: string; detailUrl: string }>;
}

const isCanonicalCitation = (
  value: string,
  base: AlternativesCitationBase,
  pathname: string,
  hash = '',
): boolean => {
  const url = new URL(value);
  return (
    url.origin === base.origin &&
    url.pathname === `${base.pathPrefix}${pathname}` &&
    url.search.length === 0 &&
    url.hash === hash
  );
};

const validateAlternativesSetCitations = (
  set: AlternativesCitationSet,
  base: AlternativesCitationBase,
  context: z.RefinementCtx,
  path: Array<string | number>,
): void => {
  const citations: Array<{ path: string; value: string; pathname: string; hash?: string }> = [
    { path: 'detailUrl', value: set.detailUrl, pathname: `/tool/${encodeURIComponent(set.slug)}` },
    {
      path: 'alternativesUrl',
      value: set.alternativesUrl,
      pathname: `/tool/${encodeURIComponent(set.slug)}`,
      hash: '#alternatives-tools-heading',
    },
    {
      path: 'markdownUrl',
      value: set.markdownUrl,
      pathname: `/alternatives/${encodeURIComponent(set.slug)}.md`,
    },
    {
      path: 'jsonUrl',
      value: set.jsonUrl,
      pathname: `/api/alternatives/${encodeURIComponent(set.slug)}.json`,
    },
  ];
  citations.forEach((citation) => {
    if (!isCanonicalCitation(citation.value, base, citation.pathname, citation.hash)) {
      context.addIssue({
        code: 'custom',
        path: [...path, citation.path],
        message: 'Alternatives URLs must be canonical citations on the feed origin.',
      });
    }
  });
  set.alternatives.forEach((tool, index) => {
    if (!isCanonicalCitation(tool.detailUrl, base, `/tool/${encodeURIComponent(tool.slug)}`)) {
      context.addIssue({
        code: 'custom',
        path: [...path, 'alternatives', index, 'detailUrl'],
        message: 'Alternative Tool detail URLs must be canonical citations on the feed origin.',
      });
    }
  });
};

const alternativesCitationBase = (
  siteUrl: string,
  context: z.RefinementCtx,
): AlternativesCitationBase | undefined => {
  if (!validateAbsoluteHttpUrl(siteUrl).success) {
    context.addIssue({
      code: 'custom',
      path: ['siteUrl'],
      message: 'Alternatives siteUrl must be an absolute http(s) base URL without credentials.',
    });
    return undefined;
  }
  const url = new URL(siteUrl);
  if (url.search.length > 0 || url.hash.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['siteUrl'],
      message: 'Alternatives siteUrl must identify a canonical base URL.',
    });
    return undefined;
  }
  return {
    origin: url.origin,
    pathPrefix: url.pathname === '/' ? '' : url.pathname.replace(/\/+$/u, ''),
  };
};

export const taxonomyListItemSchema = z.object({
  name: safePublicTextValueSchema,
  slug: safePublicTextValueSchema,
  description: z
    .string()
    .refine(
      (value) => value.length === 0 || isSafePublicText(value),
      'Public text must be trimmed and exclude control or bidi characters',
    )
    .optional(),
  url: publicHttpUrlSchema,
  toolCount: z.number().int().nonnegative().optional(),
});

export const categoriesFeedSchema = feedEnvelope(
  z.object({
    categories: z.array(
      taxonomyListItemSchema.extend({
        parentCategory: taxonomyReferenceSchema.optional(),
        featuredTools: z.array(toolSummarySchema).optional(),
      }),
    ),
  }),
);

export const tagsFeedSchema = feedEnvelope(
  z.object({
    tags: z.array(taxonomyListItemSchema),
  }),
);

export const useCasesFeedSchema = feedEnvelope(
  z.object({
    useCases: z.array(
      taxonomyListItemSchema.extend({ tools: z.array(toolSummarySchema).optional() }),
    ),
  }),
);

const alternativesSetItemSchema = z
  .object({
    name: safePublicTextValueSchema,
    slug: toolPublicSlugSchema,
    detailUrl: alternativesCitationUrlSchema,
    alternativesUrl: alternativesCitationUrlSchema,
    alternativeCount: z.number().int().positive(),
    alternatives: z.array(alternativesToolSummarySchema),
    switchingGroups: z.array(publicToolSwitchingGroupSchema).optional(),
    comparisonFacts: publicComparisonFactsSchema.optional(),
    markdownUrl: alternativesCitationUrlSchema,
    jsonUrl: alternativesCitationUrlSchema,
  })
  .superRefine((set, context) => {
    if (set.alternativeCount !== set.alternatives.length) {
      context.addIssue({
        code: 'custom',
        path: ['alternativeCount'],
        message: 'alternativeCount must match alternatives length',
      });
    }
    const slugs = new Set<string>();
    set.alternatives.forEach((tool, index) => {
      if (tool.slug === set.slug) {
        context.addIssue({
          code: 'custom',
          path: ['alternatives', index, 'slug'],
          message: 'Alternatives must not include the source Tool.',
        });
      }
      if (slugs.has(tool.slug)) {
        context.addIssue({
          code: 'custom',
          path: ['alternatives', index, 'slug'],
          message: 'Alternative slugs must be unique',
        });
      }
      slugs.add(tool.slug);
    });
  });

export const alternativesFeedSchema = feedEnvelope(
  z.object({
    alternativesUrl: alternativesCitationUrlSchema,
    sets: z.array(alternativesSetItemSchema),
  }),
).superRefine((feed, context) => {
  const base = alternativesCitationBase(feed.siteUrl, context);
  if (!base) return;
  if (!isCanonicalCitation(feed.data.alternativesUrl, base, '/all')) {
    context.addIssue({
      code: 'custom',
      path: ['data', 'alternativesUrl'],
      message: 'Alternatives index URL must be a canonical citation on the feed origin.',
    });
  }
  const seen = new Set<string>();
  feed.data.sets.forEach((set, index) => {
    if (seen.has(set.slug)) {
      context.addIssue({
        code: 'custom',
        path: ['data', 'sets', index, 'slug'],
        message: 'Alternatives set slugs must be unique.',
      });
    }
    seen.add(set.slug);
    validateAlternativesSetCitations(set, base, context, ['data', 'sets', index]);
  });
});

export const alternativesDetailFeedSchema = feedEnvelope(
  alternativesSetItemSchema.extend({
    description: safeMultilinePublicTextValueSchema.optional(),
    sourceTool: alternativesToolSummarySchema,
  }),
).superRefine((feed, context) => {
  if (!isRuntimeString(feed.contentHash) || feed.contentHash.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['contentHash'],
      message: 'Alternatives detail feed must include an embedded content hash.',
    });
  }
  const base = alternativesCitationBase(feed.siteUrl, context);
  if (!base) return;
  validateAlternativesSetCitations(feed.data, base, context, ['data']);
  if (
    !isCanonicalCitation(
      feed.data.sourceTool.detailUrl,
      base,
      `/tool/${encodeURIComponent(feed.data.sourceTool.slug)}`,
    )
  ) {
    context.addIssue({
      code: 'custom',
      path: ['data', 'sourceTool', 'detailUrl'],
      message: 'Source Tool detail URL must be a canonical citation on the feed origin.',
    });
  }
});

export const bestItemSchema = z.object({
  title: z.string(),
  slug: z.string(),
  intro: z.string().optional(),
  conclusion: z.string().optional(),
  publishedAt: z.string().optional(),
  editorialReview: editorialReviewSchema.optional(),
  url: z.string(),
  relatedCategory: taxonomyReferenceSchema.optional(),
  rankedTools: z.array(
    z.object({
      rank: z.number(),
      editorialBlurb: z.string(),
      sourceReferences: z.array(sourceReferenceSchema).optional(),
      tool: toolSummarySchema.optional(),
    }),
  ),
});

export const bestFeedSchema = feedEnvelope(
  z.object({
    best: z.array(bestItemSchema),
  }),
  undefined,
  (data, referenceTime, context) => {
    data.best.forEach((list, listIndex) =>
      list.rankedTools.forEach(({ tool }, toolIndex) => {
        if (tool) {
          addTemporalIssues(
            getPublicToolSummaryTemporalIssues(tool, referenceTime, [
              'best',
              listIndex,
              'rankedTools',
              toolIndex,
              'tool',
            ]),
            context,
          );
        }
      }),
    );
  },
);

const comparisonFactsSchema = z.object({
  bestFor: z.array(z.string()).optional(),
  notBestFor: z.array(z.string()).optional(),
  strengths: z.array(z.string()).optional(),
  limitations: z.array(z.string()).optional(),
  pricingNotes: z.string().optional(),
  platformNotes: z.string().optional(),
  migrationNotes: z.string().optional(),
  lastReviewedAt: z.string().optional(),
  reviewedBy: z.string().optional(),
  claimStandard: z.string().optional(),
  generationReadiness: z.string().optional(),
  editorialNotes: z.string().optional(),
});

export const comparisonPairItemSchema = z.object({
  editorialContentPolicy: z.literal('untrusted_data').optional(),
  slug: z.string(),
  title: z.string(),
  description: z.string().optional(),
  pageUrl: publicHttpUrlSchema,
  jsonUrl: publicHttpUrlSchema,
  markdownUrl: publicHttpUrlSchema,
  primary: toolSummarySchema,
  secondary: toolSummarySchema,
  primaryComparisonFacts: comparisonFactsSchema.optional(),
  secondaryComparisonFacts: comparisonFactsSchema.optional(),
  featureRows: z
    .array(
      z.object({
        label: z.string(),
        primary: z.string(),
        secondary: z.string(),
      }),
    )
    .optional(),
  verdict: z.string().optional(),
  reviewedAt: z.string().optional(),
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

export const comparisonsFeedSchema = feedEnvelope(
  z.object({
    comparisonsUrl: publicHttpUrlSchema,
    comparisons: z.array(comparisonPairItemSchema),
  }),
  undefined,
  (data, referenceTime, context) => {
    data.comparisons.forEach((pair, pairIndex) => {
      addTemporalIssues(
        getPublicToolSummaryTemporalIssues(pair.primary, referenceTime, [
          'comparisons',
          pairIndex,
          'primary',
        ]),
        context,
      );
      addTemporalIssues(
        getPublicToolSummaryTemporalIssues(pair.secondary, referenceTime, [
          'comparisons',
          pairIndex,
          'secondary',
        ]),
        context,
      );
    });
  },
);

export const comparisonDetailFeedSchema = feedEnvelope(
  comparisonPairItemSchema,
  undefined,
  (data, referenceTime, context) => {
    addTemporalIssues(
      getPublicToolSummaryTemporalIssues(data.primary, referenceTime, ['primary']),
      context,
    );
    addTemporalIssues(
      getPublicToolSummaryTemporalIssues(data.secondary, referenceTime, ['secondary']),
      context,
    );
  },
);

export const indexFeedSchema = z.object({
  version: catalogFeedVersionSchema,
  siteUrl: z.string(),
  generatedAt: z.string(),
  catalogRevision: z.string().optional(),
  contentHash: z.string().optional(),
  contentHashes: z.record(z.string(), z.string()).optional(),
  schemaUrl: z.string(),
  compatibility: z
    .object({
      version: z.string(),
      compatibilityPolicyUrl: z.string(),
      changelogUrl: z.string(),
      additiveFieldsSafe: z.literal(true),
      breakingChangeDefinition: z.string(),
      deprecationWindow: z.string(),
      consumerGuidance: stringArraySchema,
    })
    .optional(),
  snapshots: z
    .object({ full: z.string().min(1), ndjson: z.string().min(1) })
    .catchall(z.string().min(1)),
  feeds: z
    .object({
      tools: z.string().min(1),
      projectManifestTools: z.string().min(1).optional(),
      toolLookup: z.string().min(1).optional(),
      searchIndex: z.string().min(1),
      categories: z.string().min(1),
      tags: z.string().min(1),
      useCases: z.string().min(1),
      stacks: z.string().min(1),
      best: z.string().min(1),
      alternatives: z.string().min(1).optional(),
      comparisons: z.string().min(1).optional(),
    })
    .catchall(z.string().min(1)),
  markdownArtifacts: z.object({
    agentInterfaces: z.string().optional(),
    tools: z.string().optional(),
    categories: z.string().optional(),
    tags: z.string().optional(),
    useCases: z.string().optional(),
    stacks: z.string().optional(),
    stacksIndex: z.string().optional(),
    best: z.string().optional(),
    bestIndex: z.string().optional(),
    alternativesIndex: z.string().optional(),
    alternatives: z.string().optional(),
    comparisonsIndex: z.string().optional(),
    comparisons: z.string().optional(),
  }),
  integrationHubUrl: z.string(),
  markdownHubUrl: z.string(),
  toolDetailUrlTemplate: z.string(),
  stackDetailUrlTemplate: z.string().optional(),
  bestDetailUrlTemplate: z.string().optional(),
  alternativesDetailUrlTemplate: z.string().optional(),
  comparisonDetailUrlTemplate: z.string().optional(),
  citationGuidance: stringArraySchema,
  artifacts: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        path: z.string(),
        kind: z.string(),
        url: z.string(),
      }),
    )
    .optional(),
});

export const parseFeed = <Output, Payload>(
  schema: z.ZodType<Output>,
  payload: Payload,
  path: string,
): Output => {
  const result = schema.safeParse(payload);
  if (result.success) return result.data;
  const details = result.error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  throw new Error(
    `Invalid feed shape for ${path} (${result.error.issues.length} issue(s)): ${details}. Check the feed URL and /api/schema.json.`,
  );
};

export const parseIndexFeed = <Payload>(payload: Payload, path: string): AgentIndexFeed =>
  parseFeed(indexFeedSchema, payload, path);
export const parseSearchIndexFeed = <Payload>(
  payload: Payload,
  path: string,
): AgentSearchIndexFeed => parseFeed(searchIndexFeedSchema, payload, path);
export const parseToolsFeed = <Payload>(payload: Payload, path: string): AgentToolsFeed =>
  parseFeed(toolsFeedSchema, payload, path);
export const parseToolDetailFeed = <Payload>(
  payload: Payload,
  path: string,
): AgentToolDetailFeed => {
  const result = toolDetailFeedSchema.safeParse(payload);
  if (result.success) return result.data;
  const runtimeIssue = result.error.issues.find(
    (issue) => issue.path[0] === 'data' && issue.path[1] === 'runtimeRequirements',
  );
  if (runtimeIssue) {
    throw new Error(`Invalid runtime requirements in ${path}: ${runtimeIssue.message}`);
  }
  return parseFeed(toolDetailFeedSchema, payload, path);
};
export const parseStacksFeed = <Payload>(payload: Payload, path: string): AgentToolStackFeed =>
  parseFeed(stacksFeedSchema, payload, path);
export const parseBestFeed = <Payload>(payload: Payload, path: string): AgentCuratedListFeed =>
  parseFeed(bestFeedSchema, payload, path);
export const parseCategoriesFeed = <Payload>(payload: Payload, path: string): AgentCategoriesFeed =>
  parseFeed(categoriesFeedSchema, payload, path);
export const parseTagsFeed = <Payload>(payload: Payload, path: string): AgentTagsFeed =>
  parseFeed(tagsFeedSchema, payload, path);
export const parseUseCasesFeed = <Payload>(payload: Payload, path: string): AgentUseCasesFeed =>
  parseFeed(useCasesFeedSchema, payload, path);
export const parseAlternativesFeed = <Payload>(
  payload: Payload,
  path: string,
): AgentAlternativesFeed => parseFeed(alternativesFeedSchema, payload, path);
export const parseAlternativesDetailFeed = <Payload>(
  payload: Payload,
  path: string,
): AgentAlternativesDetailFeed => parseFeed(alternativesDetailFeedSchema, payload, path);
export const parseComparisonsFeed = <Payload>(
  payload: Payload,
  path: string,
): AgentComparisonsFeed => parseFeed(comparisonsFeedSchema, payload, path);
export const parseComparisonDetailFeed = <Payload>(
  payload: Payload,
  path: string,
): AgentComparisonDetailFeed => parseFeed(comparisonDetailFeedSchema, payload, path);

export {
  runtimeRequirementStructureSchema as runtimeRequirementSchema,
  quickstartSchema as toolQuickstartSchema,
  toolIntegrationSchema as publicToolIntegrationSchema,
};

export {
  publicComparisonFactsSchema,
  agentInterfaceSchema as publicAgentInterfaceSchema,
  stacksItemSchema as stackItemSchema,
};
export const categoryItemSchema = taxonomyListItemSchema.extend({
  parentCategory: taxonomyReferenceSchema.optional(),
  featuredTools: z.array(toolSummarySchema).optional(),
});
