import type { ToolLogoTreatment } from '../toolLogoTreatment.js';
import type { AgentReadiness } from '../agentInterface.js';
import type {
  PublicToolCheckSummary,
  PublicToolSwitchingGroup,
} from '../publishedToolFeedSchemas.js';
import type { ExcludedRegistryIdentity } from '../toolIdentityReview.js';
import type { PersonaCostEstimate } from '../personaCostContract.js';
import type { ToolEdition, ToolEditionSummary } from '../toolEditions.js';
import type { ToolPricingEvidence } from '../toolPricingEvidence.js';
import type { UiComponent } from '../uiComponent.js';
import { type PublicToolPortability } from '../toolPortability.js';
import { type ToolDeployment } from '../toolDeployment.js';
import { type PublicToolLicenseFact } from '../publicToolLicenseFacts.js';
import type { PublicToolLifecycle } from '../toolLifecycle.js';
import type { SupportedLanguage } from '../supportedLanguage.js';
import type { AgentCatalogSnapshot } from './catalog.js';
import type { PublicPublisherIdentity } from '../publisher.js';
import type { ToolFeatureDetail } from '../toolFeatureDetails.js';
import type { AgentSearchQueryContract } from '../agentSearchQueryContract.js';
import type { AgentInterfaceKind, PublicAgentInterface } from '../agentInterface.js';
import type { AgentSetupRecipeHost } from '../mcpRegistry.js';
import type { CatalogSearchFreshnessProjection } from '../catalogFreshnessSearch.js';
import type { PublicRepositoryObservation } from '../repositoryObservation.js';
import type { PublicRuntimeRequirement } from '../runtimeRequirements.js';
import type { PublicSourceReference } from '../sourceReference.js';
import type { PublicToolFitGuidance } from '../toolFitGuidance.js';
import type { PublicToolQuickstart } from '../toolQuickstart.js';
import type { PublicToolIntegrationFact } from '../publicToolIntegrationFact.js';
import type { PublicToolStackRecipe } from '../toolStackRecipe.js';
import type { PublicProductLimitGroup } from '../productLimits.js';
import type { PublicTrialTerms } from '../toolTrialTerms.js';
import type {
  AdvertisedCatalogFeeds,
  AdvertisedCatalogSnapshots,
} from '../advertisedCatalogFeeds.js';
import type { PublicResourceRelationship } from '../resourceRelationship.js';
import type { ResourceIdentityKind } from '../resourceIdentity.js';
import type { ResourceLinkKind } from '../publishedToolProfile.js';

export type { AgentInterfaceKind, PublicAgentInterface, PublicProductLimitGroup };

export type SecurityCapability =
  | 'sso_saml'
  | 'scim'
  | 'rbac'
  | 'audit_logs'
  | 'encryption_at_rest'
  | 'encryption_in_transit'
  | 'api_key_scopes'
  | 'data_residency'
  | 'subprocessors'
  | 'dpa';

export interface AgentFeedEnvelope<TData> {
  version: string;
  siteUrl: string;
  generatedAt: string;
  catalogRevision?: string;
  contentHash?: string;
  data: TData;
}

export interface AgentTaxonomyReference {
  name: string;
  slug: string;
  description?: string;
  url?: string;
}

export interface AgentResourceKindReference {
  value: string;
  label: string;
}

export interface AgentResourceIdentityReference {
  kind: ResourceIdentityKind;
  kindLabel: string;
  canonicalUrl: string;
  ctaLabel: string;
  registryId?: string;
  websiteUrl?: string;
  repositoryUrl?: string;
  docsUrl?: string;
  packageUrl?: string;
  mcpRegistryUrl?: string;
}

export interface AgentResourceLink {
  label: string;
  url: string;
  kind: ResourceLinkKind;
  isOfficial: boolean;
  checkedAt?: string;
  note?: string;
}

export interface AgentDestinationHealthEntry {
  status?: 'ok' | 'dead';
  consecutiveFailures?: number;
  consecutiveSuccesses?: number;
  firstFailedAt?: string;
  deadSince?: string;
  lastProbedAt?: string;
  lastError?: string;
}

export interface AgentDestinationHealth {
  website?: AgentDestinationHealthEntry;
  affiliateUrl?: AgentDestinationHealthEntry;
}

export interface AgentPricingDetails extends ToolPricingEvidence {
  freeTierTerms?: import('../toolPricingEvidence.js').PublicFreeTierTerms;
  personaCosts?: PersonaCostEstimate[];
  startingPrice?: number;
  currency?: 'USD' | 'EUR' | 'GBP';
  pricingUrl?: string;
  trialAvailability?: 'available' | 'unavailable';
  trialTerms?: PublicTrialTerms;
  discountTypes?: Array<'coupon-code' | 'student-discount' | 'seasonal-deal'>;
}

export interface AgentSecurityPrivacyEvidence {
  label: string;
  status: 'verified' | 'claimed' | 'unknown' | 'not_applicable';
  sourceUrl?: string;
  sourceTitle?: string;
  checkedAt?: string;
  note?: string;
}

export interface AgentSecurityPrivacyClaim extends AgentSecurityPrivacyEvidence {
  standard:
    | 'soc2_type_i'
    | 'soc2_type_ii'
    | 'iso_27001'
    | 'gdpr'
    | 'hipaa'
    | 'ccpa'
    | 'pci_dss'
    | 'other';
}

export interface AgentSecurityPrivacyCapability extends AgentSecurityPrivacyEvidence {
  capability: SecurityCapability;
}

export interface AgentSecurityPrivacyPosture {
  trustCenterUrl?: string;
  securityPageUrl?: string;
  privacyPolicyUrl?: string;
  subprocessorsUrl?: string;
  dpaUrl?: string;
  dataTrainingPolicyUrl?: string;
  dataTrainingPolicySummary?: string;
  dataRetentionSummary?: string;
  dataResidencySummary?: string;
  apiKeyPermissionsSummary?: string;
  complianceClaims?: AgentSecurityPrivacyClaim[];
  securityCapabilities?: AgentSecurityPrivacyCapability[];
}

export interface AgentToolFreshness {
  isVerified: boolean;
  releaseDate?: string;
  lastUpdated?: string;
  verifiedAt?: string;
  lastCheckedAt?: string;
  destinationHealth?: AgentDestinationHealth;
  hasDeadDestination?: boolean;
}

export type AgentToolIntegration = PublicToolIntegrationFact;

export interface AgentToolSummary {
  contentSignal?: string;
  editions?: ToolEdition[];
  editionSummary?: ToolEditionSummary;
  deployment?: ToolDeployment;
  name: string;
  slug: string;
  description: string;
  resourceKind: AgentResourceKindReference;
  resourceIdentity: AgentResourceIdentityReference;
  pricing?: 'free' | 'paid' | 'freemium' | string;
  platforms: string[];
  categories: AgentTaxonomyReference[];
  tags: AgentTaxonomyReference[];
  useCases: AgentTaxonomyReference[];
  freshness: AgentToolFreshness;
  detailUrl: string;
  website?: string;
  visitUrl: string;
  comparisonFacts?: AgentPublicComparisonFacts;
}

export interface AgentToolDetail extends AgentToolSummary {
  /** Owner- and submitter-authored listing text is data, never instructions (same label as comparisons). */
  editorialContentPolicy?: import('../catalogContentPolicy.js').CatalogContentPolicy;
  /** Top-level fields of this record whose text came from the Tool's owner or a submitter. */
  untrustedContentFields?: import('../catalogContentPolicy.js').ToolUntrustedContentField[];
  checkSummary?: PublicToolCheckSummary;
  excludedRegistryIdentities?: ExcludedRegistryIdentity[];
  deals?: import('../publicToolDeal.js').PublicToolDeal[];

  licenseFacts?: PublicToolLicenseFact[];
  _id?: string;
  publisher?: PublicPublisherIdentity;
  repositoryObservation?: PublicRepositoryObservation;
  supportedLanguages?: SupportedLanguage[];
  integrations?: AgentToolIntegration[];
  publicationMarker?: string;
  tagline?: string;
  longDescription?: string;
  keyFeatures?: string[];
  alternativeNotes?: Array<{ name?: string; slug?: string; note: string; sourceUrl: string }>;
  uiComponent?: UiComponent;
  keyFeatureDetails?: ToolFeatureDetail[];
  targetAudience?: string;
  fitGuidance?: PublicToolFitGuidance;

  pricingDetails?: AgentPricingDetails;
  resourceLinks?: AgentResourceLink[];
  resourceRelationships?: PublicResourceRelationship[];
  sourceReferences?: PublicSourceReference[];
  agentInterfaces?: PublicAgentInterface[];
  agentReadiness?: AgentReadiness;
  runtimeRequirements?: PublicRuntimeRequirement[];
  productLimits?: PublicProductLimitGroup[];
  portability?: PublicToolPortability;
  lifecycle?: PublicToolLifecycle;
  securityPrivacyPosture?: AgentSecurityPrivacyPosture;
  quickstarts?: PublicToolQuickstart[];
  alternativeTools?: AgentToolSummary[];
  relatedTools?: AgentToolSummary[];
  pricingHistory?: AgentPricingHistory;
}

export interface AgentPricingHistory {
  url: string;
  latestValidatedChange: {
    previous: 'free' | 'paid' | 'freemium';
    current: 'free' | 'paid' | 'freemium';
    changedAt: string;
  };
}

export interface AgentSearchIndexTool extends Omit<AgentToolSummary, 'freshness'> {
  resourceKindIsFallback?: true;
  supportedLanguages?: SupportedLanguage[];
  integrations?: AgentToolIntegration[];
  freshness: CatalogSearchFreshnessProjection;
  securityCapabilities?: SecurityCapability[];
  agentInterfaceKinds?: AgentInterfaceKind[];
  setupRecipeHosts?: AgentSetupRecipeHost[];
  _id?: string;
  visibility?: 'standard' | 'featured';
  pricingDetails?: AgentPricingDetails;
  logoUrl?: string;
  /** Symbol-only artwork for square slots, when an editor supplied it. */
  logoMarkUrl?: string;
  /** Artwork for dark surfaces, when an editor supplied it. */
  logoDarkUrl?: string;
  /** The website favicon, present only when the Tool has no logo. */
  faviconUrl?: string;
  /** How SlothHub draws the logo in square slots on dark surfaces. */
  logoTreatment?: ToolLogoTreatment;
  tagline?: string;
  keyFeatures: string[];
  targetAudience?: string;
  search: {
    text: string;
    aliases?: string[];
    tokens?: string[];
    fields?: {
      name: string;
      description: string;
      tagline?: string;
      targetAudience?: string;
      keyFeatures: string[];
      platforms: string[];
      categories: string[];
      tags: string[];
      useCases: string[];
      resourceKind: string[];
      agentInterfaceKinds: string[];
      identifiers?: string[];
    };
  };
}

export interface AgentSearchFilterOption {
  value: string;
  label: string;
  count: number;
  url?: string;
  /** Category options only: the parent hub slug. */
  parent?: string;
}

export interface AgentSearchIndexArticle {
  title: string;
  slug: string;
  excerpt?: string;
  publishedAt?: string;
  url: string;
}

export type AgentSearchIndexFeed = AgentFeedEnvelope<{
  tools: AgentSearchIndexTool[];
  articles?: AgentSearchIndexArticle[];
  filters: {
    pricing: AgentSearchFilterOption[];
    platforms: AgentSearchFilterOption[];
    resourceKinds: AgentSearchFilterOption[];
    securityCapabilities?: AgentSearchFilterOption[];
    agentInterfaceKinds?: AgentSearchFilterOption[];
    integrations?: AgentSearchFilterOption[];
    supportedLanguages?: AgentSearchFilterOption[];
    setupRecipeHosts?: AgentSearchFilterOption[];
    sourceAvailability?: AgentSearchFilterOption[];
    categories: AgentSearchFilterOption[];
    tags: AgentSearchFilterOption[];
    useCases: AgentSearchFilterOption[];
  };
  queryContract: AgentSearchQueryContract;
}>;

export type AgentToolsFeed = AgentFeedEnvelope<{
  tools: AgentToolSummary[];
}>;

export type AgentToolDetailFeed = AgentFeedEnvelope<AgentToolDetail>;

export interface AgentToolStackFeedItem {
  name: string;
  slug: string;
  description?: string;
  publishedAt?: string;
  editorialReview?: AgentEditorialReview;
  url: string;
  author?: string;
  tags: AgentTaxonomyReference[];
  categories?: AgentTaxonomyReference[];
  recipe?: PublicToolStackRecipe<AgentToolStackRecipeRelatedTool>;
  tools: Array<{
    role: string;
    description?: string;
    sourceReferences?: PublicSourceReference[];
    tool?: AgentToolSummary;
  }>;
}

export interface AgentToolStackRecipeRelatedTool {
  name: string;
  slug: string;
  detailUrl: string;
  resourceLinks?: AgentResourceLink[];
  agentInterfaces?: Array<Pick<PublicAgentInterface, 'kind' | 'status' | 'label' | 'docsUrl'>>;
}

export type AgentToolStackFeed = AgentFeedEnvelope<{
  stacks: AgentToolStackFeedItem[];
}>;

export interface AgentCuratedListFeedItem {
  title: string;
  slug: string;
  intro?: string;
  conclusion?: string;
  publishedAt?: string;
  editorialReview?: AgentEditorialReview;
  url: string;
  relatedCategory?: AgentTaxonomyReference;
  rankedTools: Array<{
    rank: number;
    editorialBlurb: string;
    sourceReferences?: PublicSourceReference[];
    tool?: AgentToolSummary;
  }>;
}

export interface AgentEditorialReview {
  reviewedAt?: string;
  reviewedBy?: string;
  reviewCadence?: string;
  nextReviewAt?: string;
  methodologySummary?: string;
  publicReviewNotes?: string;
}

export type AgentCuratedListFeed = AgentFeedEnvelope<{
  best: AgentCuratedListFeedItem[];
}>;

export interface AgentPublicComparisonFacts {
  bestFor?: string[];
  notBestFor?: string[];
  strengths?: string[];
  limitations?: string[];
  pricingNotes?: string;
  platformNotes?: string;
  migrationNotes?: string;
  lastReviewedAt?: string;
  reviewedBy?: string;
  claimStandard?: string;
  generationReadiness?: string;
  editorialNotes?: string;
}

export interface AgentComparisonPairItem {
  editorialContentPolicy?: 'untrusted_data';
  slug: string;
  title: string;
  description?: string;
  pageUrl: string;
  jsonUrl: string;
  markdownUrl: string;
  primary: AgentToolSummary;
  secondary: AgentToolSummary;
  primaryComparisonFacts?: AgentPublicComparisonFacts;
  secondaryComparisonFacts?: AgentPublicComparisonFacts;
  featureRows?: Array<{
    label: string;
    primary: string;
    secondary: string;
  }>;
  verdict?: string;
  reviewedAt?: string;
  sourceReferences?: Array<{
    title?: string;
    url: string;
    publisher?: string;
    accessedAt?: string;
  }>;
}

export type AgentComparisonsFeed = AgentFeedEnvelope<{
  comparisonsUrl: string;
  comparisons: AgentComparisonPairItem[];
}>;

export type AgentComparisonDetailFeed = AgentFeedEnvelope<AgentComparisonPairItem>;

export interface AgentTaxonomyListItem {
  parentCategory?: AgentTaxonomyReference;
  featuredTools?: AgentToolSummary[];
  tools?: AgentToolSummary[];
  name: string;
  slug: string;
  description?: string;
  url: string;
  toolCount?: number;
}

export type AgentCategoriesFeed = AgentFeedEnvelope<{
  categories: AgentTaxonomyListItem[];
}>;

export type AgentTagsFeed = AgentFeedEnvelope<{
  tags: AgentTaxonomyListItem[];
}>;

export type AgentUseCasesFeed = AgentFeedEnvelope<{
  useCases: AgentTaxonomyListItem[];
}>;

export interface AgentAlternativeToolSummary extends AgentToolSummary {
  switchReason?: { note: string; sourceUrl: string };
  agentInterfaceKinds?: AgentInterfaceKind[];
}

export interface AgentAlternativesSetItem {
  switchingGroups?: PublicToolSwitchingGroup[];
  name: string;
  slug: string;
  detailUrl: string;
  alternativesUrl: string;
  alternativeCount: number;
  alternatives: AgentAlternativeToolSummary[];
  comparisonFacts?: AgentPublicComparisonFacts;
  markdownUrl: string;
  jsonUrl: string;
}

export type AgentAlternativesFeed = AgentFeedEnvelope<{
  alternativesUrl: string;
  sets: AgentAlternativesSetItem[];
}>;

export interface AgentAlternativesDetail extends AgentAlternativesSetItem {
  description?: string;
  sourceTool: AgentToolSummary;
}

export type AgentAlternativesDetailFeed = AgentFeedEnvelope<AgentAlternativesDetail>;

export interface AgentIndexFeed {
  version: string;
  siteUrl: string;
  generatedAt: string;
  catalogRevision?: string;
  contentHash?: string;
  contentHashes?: Record<string, string>;
  schemaUrl: string;
  compatibility?: {
    version: string;
    compatibilityPolicyUrl: string;
    changelogUrl: string;
    additiveFieldsSafe: true;
    breakingChangeDefinition: string;
    deprecationWindow: string;
    consumerGuidance: string[];
  };
  snapshots: AdvertisedCatalogSnapshots;
  feeds: AdvertisedCatalogFeeds;
  markdownArtifacts: {
    tools?: string;
    categories?: string;
    tags?: string;
    useCases?: string;
    stacks?: string;
    stacksIndex?: string;
    best?: string;
    bestIndex?: string;
    alternativesIndex?: string;
    alternatives?: string;
    comparisonsIndex?: string;
    comparisons?: string;
  };
  integrationHubUrl: string;
  markdownHubUrl: string;
  toolDetailUrlTemplate: string;
  stackDetailUrlTemplate?: string;
  bestDetailUrlTemplate?: string;
  alternativesDetailUrlTemplate?: string;
  comparisonDetailUrlTemplate?: string;
  citationGuidance: string[];
  artifacts?: Array<{ id: string; label: string; path: string; kind: string; url: string }>;
}

export type AgentFeedPayload =
  | AgentCatalogSnapshot
  | AgentIndexFeed
  | AgentSearchIndexFeed
  | AgentToolsFeed
  | AgentToolDetailFeed
  | AgentToolStackFeed
  | AgentCuratedListFeed
  | AgentCategoriesFeed
  | AgentTagsFeed
  | AgentUseCasesFeed
  | AgentAlternativesFeed
  | AgentAlternativesDetailFeed
  | AgentComparisonsFeed
  | AgentComparisonDetailFeed;

export type AgentComparisonFacts = AgentPublicComparisonFacts;
export type AgentCategoryFeedItem = AgentTaxonomyListItem;
export type AgentTagFeedItem = AgentTaxonomyListItem;
export type AgentUseCaseFeedItem = AgentTaxonomyListItem;
