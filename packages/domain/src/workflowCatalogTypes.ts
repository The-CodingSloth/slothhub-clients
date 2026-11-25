import type {PublicAgentInterface} from './agentInterface.js';
import type {CatalogSearchFreshnessProjection} from './catalogFreshnessSearch.js';
import type {AgentSetupRecipeHost} from './mcpRegistry.js';
import type {PublicProductLimitGroup} from './productLimits.js';
import type {PublicToolIntegrationFact} from './publicToolIntegrationFact.js';
import type {ResourceLinkKind} from './publishedToolProfile.js';
import type {ResourceIdentityKind} from './resourceIdentity.js';
import type {PublicRuntimeRequirement} from './runtimeRequirements.js';
import type {SecurityCapability} from './securityCapability.js';
import type {PublicToolQuickstart} from './toolQuickstart.js';
import type {AgentPricingDetails} from './publicFeed/types.js';
import type {PublicToolLicenseFact} from './publicToolLicenseFacts.js';

/** Validated feed projections consumed by read-only CLI and MCP workflows. */
export interface WorkflowCatalogTool {
  name: string;
  slug: string;
  description: string;
  pricing?: string;
  resourceKind: { value: string; label: string };
  resourceIdentity: {
    kind: ResourceIdentityKind;
    canonicalUrl: string;
    docsUrl?: string;
    repositoryUrl?: string;
    packageUrl?: string;
    mcpRegistryUrl?: string;
    websiteUrl?: string;
  };
  platforms: string[];
  categories: Array<{ name: string; slug: string }>;
  tags: Array<{ name: string; slug: string }>;
  useCases: Array<{ name: string; slug: string }>;
  freshness: CatalogSearchFreshnessProjection;
  detailUrl: string;
  website?: string;
  keyFeatures?: string[];
  setupRecipeHosts?: AgentSetupRecipeHost[];
  agentInterfaceKinds?: AgentInterfaceKind[];
  securityCapabilities?: SecurityCapability[];
  search?: { text: string };
  integrations?: PublicToolIntegrationFact[];
}
import type { AgentInterfaceKind } from './agentInterface.js';
export interface WorkflowResourceLink {
  label: string;
  url: string;
  kind: ResourceLinkKind;
  isOfficial: boolean;
  note?: string;
  checkedAt?: string;
}
export interface WorkflowSecurityCapability {
  capability: SecurityCapability;
  label: string;
  status: 'verified' | 'claimed' | 'unknown' | 'not_applicable';
  sourceUrl?: string;
  sourceTitle?: string;
  checkedAt?: string;
  note?: string;
}
export interface WorkflowCatalogToolDetail extends WorkflowCatalogTool {
  targetAudience?: string;
  pricingDetails?: AgentPricingDetails;
  licenseFacts?: PublicToolLicenseFact[];
  resourceLinks?: WorkflowResourceLink[];
  agentInterfaces?: PublicAgentInterface[];
  runtimeRequirements?: PublicRuntimeRequirement[];
  productLimits?: PublicProductLimitGroup[];
  quickstarts?: PublicToolQuickstart[];
  securityPrivacyPosture?: {
    securityCapabilities?: WorkflowSecurityCapability[];
  };
}
export interface WorkflowCatalogStack {
  name: string;
  slug: string;
  url: string;
  tools: Array<{ role: string; description?: string; tool?: { slug: string } }>;
}
