import {AGENT_SEARCH_TOKEN_RULE} from './agentSearchQueryContract.js';
import {isValidToolPublicSlug} from './toolLookup.js';
import {normalizePublicHostname} from './urlSafety.js';
import {getCanonicalToolDetailUrl, getSafeCitationUrl} from './publicAgentUrl.js';
import {getSearchableAgentInterfaceKinds, type AgentInterfaceKind} from './agentInterface.js';
import {searchPublicAgentCatalogWithCapabilities, type PublicAgentSearchCatalogCapabilities, type PublicAgentSearchFilters} from './agentSearch.js';
import type {AgentSetupRecipeHost} from './agentSetupRecipeHosts.js';
import {isPublishedEditorialVerificationTimestamp} from './publishedToolProfile.js';
import type {WorkflowCatalogTool as AgentToolSummary, WorkflowCatalogTool as AgentSearchIndexTool, WorkflowCatalogToolDetail as AgentToolDetail, WorkflowCatalogStack as AgentToolStackFeedItem, WorkflowResourceLink as AgentResourceLink, WorkflowSecurityCapability as AgentSecurityPrivacyCapability} from './workflowCatalogTypes.js';
import type {PublicToolIntegrationFact as AgentToolIntegration} from './publicToolIntegrationFact.js';
import type {PublicProductLimitGroup} from './productLimits.js';
import type {PublicRuntimeRequirement} from './runtimeRequirements.js';
import {getToolLicenseFactLabel, getToolLicenseFactScopeLabel, type PublicToolLicenseFact} from './publicToolLicenseFacts.js';
import type {PublicToolQuickstart} from './toolQuickstart.js';

// Preserve the published CLI comparison envelope; receipt: upstream docs/measurements/agent-workflows-install-links-2026-10-16.md.
export const MAX_COMPARE_TOOLS = 8;
export const DEFAULT_RECOMMENDATION_LIMIT = 3;

export interface CitationSource {
  label: string;
  url: string;
  kind: string;
  usage: 'citation' | 'implementation_reference' | 'visit_action';
  isOfficial?: boolean;
  note?: string;
}

export interface WorkflowToolSummary {
  setupRecipeHosts?: AgentSetupRecipeHost[];
  name: string;
  slug: string;
  description: string;
  pricing?: string;
  platforms: string[];
  categories: string[];
  useCases: string[];
  resourceKind: string;
  detailUrl: string;
  website?: string;
}

export interface RecommendedTool extends WorkflowToolSummary {
  score: number;
  reasons: string[];
  caveats: string[];
  citations: CitationSource[];
}

export interface RecommendationResult {
  requirements: string;
  selected?: RecommendedTool;
  candidates: RecommendedTool[];
  criteria: string[];
  caveats: string[];
}

export interface ComparisonProductLimitFact {
  state: string;
  comparator?: string;
  value?: number;
  unit?: string;
}

export interface ComparisonProductLimitGroup {
  metric: string;
  planScope?: string;
  deploymentScope?: string;
  ambiguous: boolean;
  facts: ComparisonProductLimitFact[];
}

export interface ComparisonRuntimeRequirement {
  subjectName: string;
  subjectKind: string;
  environmentRange: string;
  toolRange?: string;
  status: string;
}

export interface ComparisonTool extends WorkflowToolSummary {
  integrations?: AgentToolIntegration[];
  securityPrivacyPosture?: {securityCapabilities?: AgentSecurityPrivacyCapability[]};
  keyFeatures: string[];
  agentInterfaceKinds: AgentInterfaceKind[];
  targetAudience?: string;
  officialResources: CitationSource[];
  productLimits: {
    state: 'listed' | 'unknown';
    groups: ComparisonProductLimitGroup[];
  };
  runtimeRequirements: {
    state: 'listed' | 'unknown';
    requirements: ComparisonRuntimeRequirement[];
  };
  /** Plan prices and billing cadence; sources, terms and estimates stay in Tool detail. */
  pricingPlans?: ComparisonPricing;
  licenses?: ComparisonLicense[];
}

export interface ComparisonPricing {
  currency?: string;
  pricingUrl?: string;
  trialAvailability?: 'available' | 'unavailable';
  plans: Array<{name: string; priceType?: string; listPrice?: number; billing: string; billingPeriod?: string}>;
  usageAddOns: Array<{planName?: string; unit: string; rate: number; billing: string}>;
}

export interface ComparisonLicense {
  scope: string;
  status: PublicToolLicenseFact['status'];
  license: string;
  sourceUrl?: string;
}

const comparisonAmountPeriods = new Map([
  ['month', ' / month'], ['year', ' / year'], ['one_time', ' (one-time)'], ['usage', ' (usage-based)'],
])

export const renderComparisonDecisionFacts = (tool: Pick<ComparisonTool, 'pricingPlans' | 'licenses'>): string[] => {
  const pricing = tool.pricingPlans
  const currency = pricing?.currency ? pricing.currency + ' ' : ''
  const rows = (pricing?.plans ?? []).map((plan) => {
    const period = comparisonAmountPeriods.get(plan.billingPeriod ?? '') ?? ''
    const amount = plan.priceType === 'custom' ? 'Custom price'
      : plan.listPrice === undefined ? 'Price unlisted' : currency + plan.listPrice + period
    return 'Plan: ' + plan.name + ' — ' + amount + (plan.billing ? ' (' + plan.billing + ')' : '')
  })
  for (const addOn of pricing?.usageAddOns ?? []) {
    const plan = addOn.planName ? addOn.planName + ' — ' : ''
    rows.push('Usage add-on: ' + plan + currency + addOn.rate + ' per ' + addOn.unit + ' (' + addOn.billing + ')')
  }
  if (pricing?.trialAvailability) {
    rows.push(pricing.trialAvailability === 'available' ? 'Trial: Available' : 'Trial: Unavailable')
  }
  for (const fact of tool.licenses ?? []) {
    rows.push('License (' + fact.scope + '): ' + fact.license)
  }
  return rows
}

export interface ComparisonResult {
  tools: ComparisonTool[];
  criteria: string[];
  gaps: string[];
  citations: CitationSource[];
}

export interface ImplementationPlanStep {
  title: string;
  detail: string;
  sourceUrl: string;
  sourceLabel: string;
}

export interface ImplementationPlanResult {
  tool: WorkflowToolSummary;
  stack?: {
    name: string;
    slug: string;
    url?: string;
    role?: string;
  };
  quickstarts?: PublicToolQuickstart[];
  steps: ImplementationPlanStep[];
  caveats: string[];
  citations: CitationSource[];
}

export interface CitationResult {
  tool: WorkflowToolSummary;
  sources: CitationSource[];
}

const arrayOf = <T>(items: readonly T[] | null | undefined): T[] =>
  Array.isArray(items) ? [...items] : [];
const toNames = (items: Array<{ name: string }> | null | undefined): string[] =>
  arrayOf(items).map((item) => item.name);
type PublicToolSummary = AgentToolSummary | AgentSearchIndexTool;

const isSafeCitationUrl = (value: string | undefined): value is string => {
  return getSafeCitationUrl(value) !== undefined;
};

/** Local profile links are first-party navigation, never external setup citations. */
const getLocalToolProfileUrl = (tool: PublicToolSummary, siteUrl?: string): string | undefined => {
  if (!siteUrl) return undefined;
  try {
    const url = new URL(tool.detailUrl);
    const hostname = normalizePublicHostname(url.hostname);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '::1'].includes(hostname) ||
        url.username || url.password || url.search || url.hash || url.href !== tool.detailUrl ||
        !isValidToolPublicSlug(tool.slug) || url.pathname !== `/tool/${encodeURIComponent(tool.slug)}`) return undefined;
    if (siteUrl) {
      const site = new URL(siteUrl);
      if (site.origin !== url.origin || site.pathname !== '/' || site.search || site.hash || site.username || site.password) return undefined;
    }
    return url.href;
  } catch { return undefined; }
};

const requireToolProfileUrl = (tool: PublicToolSummary, siteUrl?: string): string => {
  const url = getSafeCitationUrl(tool.detailUrl) ?? getLocalToolProfileUrl(tool, siteUrl);
  if (!url) throw new Error(`Unsafe citation URL for ${tool.name} profile: ${tool.detailUrl}`);
  return url;
};

const summarizeTool = (tool: PublicToolSummary, siteUrl?: string): WorkflowToolSummary => ({
  name: tool.name, slug: tool.slug, description: tool.description, pricing: tool.pricing, platforms: arrayOf(tool.platforms), categories: toNames(tool.categories), useCases: toNames(tool.useCases), resourceKind: tool.resourceKind?.label ?? 'Unknown', detailUrl: requireToolProfileUrl(tool, siteUrl),
  ...(isSafeCitationUrl(tool.website) ? { website: tool.website } : undefined)
});

const canonicalSource = (tool: PublicToolSummary, siteUrl?: string): CitationSource => ({
  label: `${tool.name} profile`,
  url: requireToolProfileUrl(tool, siteUrl),
  kind: 'slothhub_tool_profile',
  usage: 'citation',
  isOfficial: true,
});

const officialSourceFromResourceLink = (link: AgentResourceLink): CitationSource | undefined => {
  const safeUrl = link.isOfficial ? getSafeCitationUrl(link.url) : undefined;
  if (!safeUrl) return undefined;

  return {
    label: link.label,
    url: safeUrl,
    kind: link.kind,
    usage: 'implementation_reference',
    isOfficial: true,
    ...(link.note ? {note: link.note} : undefined),
  };
};

const pushIdentitySource = (
  sources: CitationSource[],
  tool: AgentToolDetail,
  label: string,
  url: string | undefined,
  kind: string
): void => {
  const safeUrl = getSafeCitationUrl(url);
  if (!safeUrl || sources.some((source) => source.url === safeUrl)) return;

  sources.push({
    label: `${tool.name} ${label}`,
    url: safeUrl,
    kind,
    usage: 'implementation_reference',
    isOfficial: true,
  });
};

const sourceFromIdentity = (tool: AgentToolDetail): CitationSource[] => {
  const sources: CitationSource[] = [];

  pushIdentitySource(sources, tool, 'canonical source', tool.resourceIdentity.canonicalUrl, 'resource_identity_canonical');
  pushIdentitySource(sources, tool, 'docs', tool.resourceIdentity.docsUrl, 'resource_identity_docs');
  pushIdentitySource(sources, tool, 'repository', tool.resourceIdentity.repositoryUrl, 'resource_identity_repository');
  pushIdentitySource(sources, tool, 'package', tool.resourceIdentity.packageUrl, 'resource_identity_package');
  pushIdentitySource(sources, tool, 'MCP registry entry', tool.resourceIdentity.mcpRegistryUrl, 'resource_identity_mcp_registry');
  pushIdentitySource(sources, tool, 'website', tool.resourceIdentity.websiteUrl, 'resource_identity_website');

  return sources;
};

const originFromToolDetailUrl = (detailUrl: string): string | undefined => {
  try {
    return new URL(detailUrl).origin;
  } catch {
    return undefined;
  }
};

export const getCitationResult = (
  tool: AgentToolDetail,
  siteUrl = getSafeCitationUrl(tool.detailUrl) ? originFromToolDetailUrl(tool.detailUrl) : undefined,
): CitationResult => {
  const detailUrl = siteUrl ? getCanonicalToolDetailUrl(tool, siteUrl) ?? getLocalToolProfileUrl(tool, siteUrl) : undefined;
  if (!detailUrl) throw new Error('Unsafe canonical Tool detail URL.');

  const resourceSources = arrayOf(tool.resourceLinks)
    .map(officialSourceFromResourceLink)
    .filter((source): source is CitationSource => Boolean(source));
  const seenUrls = new Set<string>();
  const sources = [
    {...canonicalSource(tool, siteUrl), url: detailUrl},
    ...sourceFromIdentity(tool),
    ...resourceSources,
  ]
    .filter((source) => {
      if (seenUrls.has(source.url)) return false;
      seenUrls.add(source.url);
      return true;
    });

  return {
    tool: summarizeTool(tool, siteUrl),
    sources,
  };
};

const recommendReasons = (tool: AgentSearchIndexTool): string[] => {
  const reasons = [`Matches ${(tool.resourceKind?.label ?? 'tool').toLowerCase()} catalog text and taxonomy.`];

  if (arrayOf(tool.categories).length > 0) {
    reasons.push(`Category fit: ${toNames(tool.categories).join(', ')}.`);
  }

  if (arrayOf(tool.useCases).length > 0) {
    reasons.push(`Use-case fit: ${toNames(tool.useCases).join(', ')}.`);
  }

  if (arrayOf(tool.keyFeatures).length > 0) {
    reasons.push(`Known features: ${arrayOf(tool.keyFeatures).slice(0, 3).join(', ')}.`);
  }

  return reasons;
};

const caveatsForTool = (tool: PublicToolSummary): string[] => {
  const caveats: string[] = [];

  const freshness = tool.freshness;
  const verified = isPublishedEditorialVerificationTimestamp(freshness?.verifiedAt);
  if (!verified) {
    caveats.push(`${tool.name} is not marked verified in the public feed.`);
  }

  if (freshness?.hasDeadDestination) {
    caveats.push(`${tool.name} has a destination health warning.`);
  }

  return caveats;
};

export const recommendTools = (
  tools: AgentSearchIndexTool[],
  options: {
    siteUrl?: string;
    requirements: string;
    filters?: Omit<PublicAgentSearchFilters, 'query' | 'limit'>;
    limit?: number;
    searchCapabilities: PublicAgentSearchCatalogCapabilities;
  }
): RecommendationResult => {
  const limit = options.limit ?? DEFAULT_RECOMMENDATION_LIMIT;
  // Search preserves input order for equal scores. Establish recommendation
  // ties before search applies the limit, without changing browse/search order.
  const orderedTools = [...tools].sort((left, right) =>
    left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0);
  const results = searchPublicAgentCatalogWithCapabilities(
    orderedTools,
    {...options.filters, query: options.requirements, limit},
    options.searchCapabilities,
  );
  const candidates = results.map(({ tool, score }) => ({
    ...summarizeTool(tool, options.siteUrl),
    setupRecipeHosts: [...(tool.setupRecipeHosts ?? [])],
    score,
    reasons: recommendReasons(tool),
    caveats: caveatsForTool(tool),
    citations: [canonicalSource(tool, options.siteUrl)],
  }));
  const criteria = [
    AGENT_SEARCH_TOKEN_RULE,
    'Ranking prefers greater meaningful-token coverage, then name/slug, taxonomy, description, and remaining search text.',
    'Equal relevance scores are ordered by slug before applying the result limit.',
    'Citations use canonical SlothHub detail URLs, not tracked /go/ URLs.',
  ];
  const caveats = candidates.length > 0
    ? ['Recommendations are grounded in public feed metadata and may need official docs before implementation.']
    : ['No public feed match found for the supplied requirements.'];

  return {
    requirements: options.requirements,
    ...(candidates[0] ? { selected: candidates[0] } : undefined),
    candidates, criteria, caveats
  };
};

// Compact compare projection: metric + scope + fact state only. Evidence
// URLs, notes, and review timestamps stay on the Tool detail output so the
// compare payload stays small; ambiguous groups keep every conflicting fact.
const compactProductLimitGroups = (
  groups: readonly PublicProductLimitGroup[] | undefined,
): ComparisonProductLimitGroup[] =>
  arrayOf(groups).map((group) => ({
    metric: group.metric,
    ...(group.planScope ? {planScope: group.planScope} : undefined),
    ...(group.deploymentScope ? {deploymentScope: group.deploymentScope} : undefined),
    ambiguous: group.ambiguous,
    facts: group.facts.map((fact) => ({
      state: fact.state,
      ...(fact.state === 'bounded'
        ? {comparator: fact.comparator, value: fact.value, unit: fact.unit}
        : undefined),
    })),
  }));

const compactRuntimeRequirements = (
  requirements: readonly PublicRuntimeRequirement[] | undefined,
): ComparisonRuntimeRequirement[] =>
  arrayOf(requirements).map((requirement) => ({
    subjectName: requirement.subjectName,
    subjectKind: requirement.subjectKind,
    environmentRange: requirement.environmentRange,
    ...(requirement.toolRange ? {toolRange: requirement.toolRange} : undefined),
    status: requirement.status,
  }));

export const compareTools = (tools: AgentToolDetail[], siteUrlsBySlug?: ReadonlyMap<string, string>): ComparisonResult => {
  const comparisonTools = tools.map((tool) => {
    const productLimitGroups = compactProductLimitGroups(tool.productLimits);
    const runtimeRequirements = compactRuntimeRequirements(tool.runtimeRequirements);
    const comparison: ComparisonTool = {
      ...summarizeTool(tool, siteUrlsBySlug?.get(tool.slug)), keyFeatures: arrayOf(tool.keyFeatures),
      agentInterfaceKinds: getSearchableAgentInterfaceKinds(
        tool.agentInterfaces,
        tool.resourceIdentity,
      ),
      ...(tool.targetAudience ? { targetAudience: tool.targetAudience } : undefined),
      officialResources: arrayOf(tool.resourceLinks)
        .map(officialSourceFromResourceLink)
        .filter((source): source is CitationSource => Boolean(source)),
      productLimits: {
        state: productLimitGroups.length > 0 ? ('listed' as const) : ('unknown' as const),
        groups: productLimitGroups,
      },
      runtimeRequirements: {
        state: runtimeRequirements.length > 0 ? ('listed' as const) : ('unknown' as const),
        requirements: runtimeRequirements,
      },
    };
    const pricing = tool.pricingDetails;
    if (pricing && (pricing.plans?.length || pricing.usageAddOns?.length || pricing.trialAvailability)) {
      comparison.pricingPlans = {
        currency: pricing.currency, pricingUrl: getSafeCitationUrl(pricing.pricingUrl), trialAvailability: pricing.trialAvailability,
        plans: (pricing.plans ?? []).map(({name, priceType, listPrice, billing, billingPeriod}) => ({name, priceType, listPrice, billing, billingPeriod})),
        usageAddOns: (pricing.usageAddOns ?? []).map(({planName, unit, rate, billing}) => ({planName, unit, rate, billing})),
      };
    }
    if (tool.licenseFacts?.length) {
      comparison.licenses = tool.licenseFacts.map((fact) => ({
        scope: getToolLicenseFactScopeLabel(fact), status: fact.status, license: getToolLicenseFactLabel(fact),
        sourceUrl: getSafeCitationUrl(fact.sourceUrl),
      }));
    }
    if (tool.integrations !== undefined) {
      comparison.integrations = tool.integrations.map(({sourceUrl, ...fact}) => {
        const safeSource = getSafeCitationUrl(sourceUrl);
        const integration: AgentToolIntegration = {...fact};
        if (safeSource) integration.sourceUrl = safeSource;
        return integration;
      });
    }
    if (tool.securityPrivacyPosture?.securityCapabilities !== undefined) {
      comparison.securityPrivacyPosture = {
        securityCapabilities: tool.securityPrivacyPosture.securityCapabilities.map(({sourceUrl, ...fact}) => {
          const safeSource = getSafeCitationUrl(sourceUrl);
          const capability: AgentSecurityPrivacyCapability = {...fact};
          if (safeSource) capability.sourceUrl = safeSource;
          return capability;
        }),
      };
    }
    return comparison;
  });
  const gaps = tools.flatMap((tool, index) => {
    const toolGaps: string[] = [];

    if (arrayOf(tool.keyFeatures).length === 0) {
      toolGaps.push(`${tool.name} has no key features in the public detail feed.`);
    }

    if (arrayOf(tool.resourceLinks).length === 0) {
      toolGaps.push(`${tool.name} has no public resource links in the public detail feed.`);
    }
    if (!tool.pricingDetails?.plans?.length) {
      toolGaps.push(`${tool.name} plan prices are unknown: no pricing plans are recorded.`);
    }
    if (tool.integrations === undefined) {
      toolGaps.push(`${tool.name} integrations are unknown: no structured assessment is recorded.`);
    }
    if (tool.securityPrivacyPosture?.securityCapabilities === undefined) {
      toolGaps.push(`${tool.name} security capabilities are unknown: no structured assessment is recorded.`);
    }

    if (!tool.resourceKind?.value?.trim()) {
      toolGaps.push(`${tool.name} has no resource kind in the public detail feed.`);
    }

    if ((comparisonTools[index]?.agentInterfaceKinds.length ?? 0) === 0) {
      toolGaps.push(`${tool.name} has no agent interface kinds in the public detail feed.`);
    }

    return toolGaps;
  });

  return {
    tools: comparisonTools,
    criteria: [
      'Pricing',
      ...(comparisonTools.some((tool) => tool.pricingPlans) ? ['Pricing plans and billing'] : []),
      ...(comparisonTools.some((tool) => tool.licenses) ? ['License'] : []),
      'Resource kind',
      'Platforms',
      ...(comparisonTools.some((tool) => tool.agentInterfaceKinds.length > 0)
        ? ['Agent interfaces']
        : []),
      'Categories',
      'Use cases',
      'Key features',
      'Official implementation resources',
      'Integrations',
      'Security capabilities',
      ...(comparisonTools.some((tool) => tool.productLimits.state === 'listed')
        ? ['Product limits']
        : []),
      ...(comparisonTools.some((tool) => tool.runtimeRequirements.state === 'listed')
        ? ['Runtime requirements']
        : []),
    ],
    gaps,
    citations: tools.map((tool) => canonicalSource(tool, siteUrlsBySlug?.get(tool.slug))),
  };
};

const implementationSources = (tool: AgentToolDetail): CitationSource[] => [
  ...arrayOf(tool.resourceLinks)
    .map(officialSourceFromResourceLink)
    .filter((source): source is CitationSource => Boolean(source)),
  ...sourceFromIdentity(tool),
];

export const buildImplementationPlan = (
  tool: AgentToolDetail,
  stack?: AgentToolStackFeedItem,
  siteUrl?: string,
): ImplementationPlanResult => {
  const sources = implementationSources(tool);
  const omittedSources: string[] = [];
  const primarySource = sources[0];
  const stackTool = stack?.tools.find((item) => item.tool?.slug === tool.slug);

  if (stack && !stackTool) {
    throw new Error(`${tool.name} is not part of the ${stack.name} tool stack.`);
  }

  const stackUrl = getSafeCitationUrl(stack?.url);
  if (stack && !stackUrl) omittedSources.push(`${stack.name} stack URL is not a safe HTTPS citation; use the Tool profile and verify the stack documentation before implementation.`);

  const citations = [
    canonicalSource(tool, siteUrl),
    ...(stack && stackUrl ? [{ label: stack.name, url: stackUrl, kind: 'tool_stack', usage: 'citation' as const }] : []),
    ...sources,
  ];
  const steps: ImplementationPlanStep[] = [
    {
      title: 'Confirm fit from the SlothHub profile',
      detail: `Review ${tool.name}'s category, pricing, platform, freshness, and caveats before changing a project.`,
      sourceUrl: tool.detailUrl,
      sourceLabel: `${tool.name} profile`,
    },
  ];

  for (const requirement of tool.runtimeRequirements ?? []) {
    const evidence = requirement.evidence.flatMap((source): CitationSource[] => {
      const url = getSafeCitationUrl(source.url);
      if (!url) {
        omittedSources.push(`${source.title} evidence for ${requirement.subjectName} is not a safe HTTPS citation; verify official runtime documentation before installing.`);
        return [];
      }
      return [{
        label: source.title,
        url,
        kind: 'runtime_requirement',
        usage: 'implementation_reference',
        note: `Source checked ${source.checkedAt}; requirement reviewed ${requirement.reviewedAt}.`,
      }];
    });
    citations.push(...evidence);
    const source = evidence[0] ?? canonicalSource(tool, siteUrl);
    steps.push({
      title: `Review ${requirement.subjectName} requirement`,
      detail: [
        `${requirement.subjectName}: ${requirement.environmentRange} (${requirement.status}).`,
        requirement.toolRange ? `Tool version scope: ${requirement.toolRange}.` : 'Tool version scope is not recorded.',
        requirement.note,
        `Editor reviewed ${requirement.reviewedAt}.`,
        'Check this requirement against the project; version ranges are recorded text, not a resolved compatibility result.',
      ].filter(Boolean).join(' '),
      sourceUrl: source.url,
      sourceLabel: source.label,
    });
  }

  if (stack) {
    steps.push({
      title: `Place ${tool.name} in the ${stack.name} workflow`,
      detail: stackTool?.description
        ? `${stackTool.role}: ${stackTool.description}`
        : `Use the stack page to understand where ${tool.name} fits before implementation.`,
      sourceUrl: stackUrl ?? tool.detailUrl,
      sourceLabel: stackUrl ? stack.name : canonicalSource(tool, siteUrl).label,
    });
  }

  for (const source of sources) {
    const link = tool.resourceLinks?.find((resource) => resource.url === source.url);
    steps.push({
      title: `Open ${source.label}`,
      detail: [
        'Use this official resource for tool-specific setup, configuration, and integration steps. Its presence does not establish compatibility with this project.',
        source.note,
        link?.checkedAt ? `Link checked ${link.checkedAt}.` : 'Link review date is not recorded.',
      ].filter(Boolean).join(' '),
      sourceUrl: source.url,
      sourceLabel: source.label,
    });
  }

  for (const agentInterface of tool.agentInterfaces ?? []) {
    if (agentInterface.status !== 'official') continue;
    const docsUrl = getSafeCitationUrl(agentInterface.docsUrl);
    if (agentInterface.docsUrl && !docsUrl) omittedSources.push(`${agentInterface.label} setup documentation is not a safe HTTPS citation; verify official documentation before installing.`);
    const sourceUrl = docsUrl ?? canonicalSource(tool, siteUrl).url;
    if (docsUrl) citations.push({label: agentInterface.label, url: sourceUrl, kind: 'interface_docs', usage: 'implementation_reference', isOfficial: true});
    steps.push({
      title: `Review ${agentInterface.label} setup`,
      detail: [
        agentInterface.identifier ? `Interface identity: ${agentInterface.identifier}.` : undefined,
        agentInterface.authRequirement ? `Authentication: ${agentInterface.authRequirement}.` : 'Authentication requirements are not recorded.',
        agentInterface.checkedAt ? `Interface checked ${agentInterface.checkedAt}.` : 'Interface review date is not recorded.',
        !docsUrl ? 'Official setup docs are not recorded; verify them before installing.'
          : 'Use the official documentation for setup; only published quickstarts supply copy-only commands.',
        'Confirm the package version and project prerequisites in the linked documentation; commands do not establish compatibility or completed setup.',
      ].filter(Boolean).join(' '),
      sourceUrl,
      sourceLabel: agentInterface.label,
    });
  }

  const quickstarts = (tool.quickstarts ?? []).map(({docsUrl, command, ...quickstart}) => {
    const safeDocsUrl = getSafeCitationUrl(docsUrl);
    if (docsUrl && !safeDocsUrl) omittedSources.push(`${quickstart.label} setup documentation is not a safe HTTPS citation; retrieve official documentation before running its command.`);
    return {...quickstart, ...(!docsUrl || safeDocsUrl ? {command} : undefined), ...(safeDocsUrl ? {docsUrl: safeDocsUrl} : undefined)};
  });

  for (const quickstart of quickstarts) {
    if (quickstart.status !== 'official' || !quickstart.docsUrl) continue;
    const sourceUrl = getSafeCitationUrl(quickstart.docsUrl);
    if (!sourceUrl) {
      omittedSources.push(`${quickstart.label} setup documentation is not a safe HTTPS citation; retrieve official documentation before running its command.`);
      continue;
    }
    citations.push({label: quickstart.label, url: sourceUrl, kind: 'quickstart_docs', usage: 'implementation_reference', isOfficial: true});
    steps.push({
      title: `Review ${quickstart.label}`,
      detail: [
        quickstart.command ? `Recorded quickstart (${quickstart.commandLanguage ?? 'shell'}; review before running): ${quickstart.command}` : 'Follow the linked official quickstart.',
        quickstart.notice,
        'Verify installation, initialization and application behavior separately; a recorded command is not evidence that a project works.',
      ].filter(Boolean).join(' '),
      sourceUrl,
      sourceLabel: quickstart.label,
    });
  }

  const caveats = [
    ...omittedSources,
    ...(!quickstarts.some((entry) => entry.status === 'official' && entry.docsUrl) ? ['No verified quickstart is recorded; use the official resources for setup.'] : []),
    'No install or configuration commands are inferred when the public feed does not provide them.',
    ...(tool.quickstarts ?? []).filter((quickstart) => quickstart.status === 'official' && !quickstart.docsUrl)
      .map((quickstart) => `${quickstart.label} has no official setup docs recorded; retrieve version-specific documentation before running its command.`),
    ...((tool.runtimeRequirements ?? []).length === 0
      ? ['No runtime requirements are recorded; check version-specific official documentation before installing.']
      : []),
    ...(primarySource
      ? []
      : [`${tool.name} has no official implementation resource in the public feed; use official documentation before making changes.`]),
  ];

  let stackSummary: ImplementationPlanResult['stack']
  if (stack) {
    stackSummary = {
      name: stack.name,
      slug: stack.slug,
    }
    if (stackUrl) stackSummary.url = stackUrl
    if (stackTool?.role) stackSummary.role = stackTool.role
  }

  const plan: ImplementationPlanResult = {
    tool: summarizeTool(tool, siteUrl),
    ...(stackSummary ? { stack: stackSummary } : undefined),
    steps,
    caveats,
    citations
  }
  if (quickstarts.length > 0) plan.quickstarts = quickstarts.map((entry) => ({...entry}));
  return plan;
};
