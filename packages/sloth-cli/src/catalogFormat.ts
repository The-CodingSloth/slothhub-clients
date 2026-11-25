import {QUOTED_CATALOG_CONTENT_END, QUOTED_CATALOG_CONTENT_START, TOOL_CONTENT_POLICY_NOTICE} from '@slothhub/domain/catalog-content-policy';
import {renderToolEditionsMarkdown} from '@slothhub/domain/tool-editions';
import {summarizeFreeTierTerms, publicFreeTierTermsSchema} from '@slothhub/domain/tool-pricing-evidence';
import {summarizeToolPricingEvidence} from '@slothhub/domain/tool-pricing-evidence';
import {renderUiComponentMarkdown} from '@slothhub/domain/ui-component';
import {buildAgentHostInstallLink} from '@slothhub/domain/mcp-registry';
import {filterCurrentToolDeals, renderToolDealsMarkdown} from '@slothhub/domain/public-tool-deal';
import {renderToolPortabilityMarkdown} from '@slothhub/domain/tool-portability-markdown';
import {renderToolLifecycleMarkdown} from '@slothhub/domain/tool-lifecycle-markdown';
import {LANGUAGE_SUPPORT_KIND_LABELS} from '@slothhub/domain/supported-language';
import {renderToolFeatureDetailsMarkdown} from '@slothhub/domain/tool-feature-details-markdown';
import {renderToolDecisionContextText} from '@slothhub/domain/tool-decision-context-markdown';
import {buildPublishedToolDecisionSupport} from '@slothhub/domain/tool-decision-support';
import {buildRepositoryLastPushLabel, buildRepositoryObservationNotice} from '@slothhub/domain/repository-observation';
import {formatAgentSetupFacts, formatAgentReadiness, getAgentInterfaceKindLabel, type AgentInterfaceKind} from '@slothhub/domain/agent-interface';
import {getAgentSetupRecipeCliCommand, getAgentSetupRecipeCopyHint, getAgentSetupRecipeAlternateRemotesNotice, getAgentSetupRecipeHeadersNotice, getAgentSetupRecipeEnvironmentNotice, getAgentSetupRecipeHostLabel, getAgentSetupRecipeUnknownNotice, resolvePublicAgentSetupRecipeEntries, type PublicAgentSetupRecipeEntry} from '@slothhub/domain/mcp-registry';
import {getAgentSetupRecipeMergeInstructions} from '@slothhub/domain/agent-setup-recipe-hosts';
import {getResourceKindLabel, isResourceKind} from '@slothhub/domain/resource-kind';
import {getPublicHttpUrl} from '@slothhub/domain/url-safety';
import {safeDiagnostic} from '@slothhub/domain/safe-diagnostic';
import {MAX_PUBLIC_SOURCE_REFERENCES} from '@slothhub/domain/source-reference';
import {RESOURCE_LINK_KIND_LABELS} from '@slothhub/domain/published-tool-profile';
import {TOOL_FREE_TRIAL_AVAILABLE_VALUE, TOOL_FREE_TRIAL_LABEL, TOOL_TARGET_AUDIENCE_LABEL} from '@slothhub/domain/tool-fact-labels';
import {summarizePublicTrialTerms} from '@slothhub/domain/tool-trial-terms';
import {AGENT_SEARCH_MAX_RESULT_LIMIT, type PublicAgentSearchArticleResult} from '@slothhub/domain/agent-search';
import type {CliListPage} from './cliListPagination.js';

import type {AgentComparisonPairItem, AgentPublicComparisonFacts, AgentResourceKindReference, AgentSearchIndexTool, AgentTaxonomyReference, AgentToolDetail} from './types.js';

export interface CatalogSearchHit {
  tool: AgentSearchIndexTool;
  score: number;
}

export type CatalogSearchJsonHit = AgentSearchIndexTool & {
  agentInterfaceKinds: AgentInterfaceKind[];
  score: number;
};

export const formatSetupRecipeLines = (recipe: PublicAgentSetupRecipeEntry): string[] => {
  const hostLabel = getAgentSetupRecipeHostLabel(recipe.host);
  if (recipe.state === 'unknown') {
    return [getAgentSetupRecipeUnknownNotice(recipe.host, recipe.reason), ...(recipe.registryUrl ? [`MCP Registry: ${recipe.registryUrl}`] : [])];
  }
  const install = buildAgentHostInstallLink(recipe);
  const headersNotice = getAgentSetupRecipeHeadersNotice(recipe);
  const environmentNotice = getAgentSetupRecipeEnvironmentNotice(recipe);
  const cliCommand = getAgentSetupRecipeCliCommand(recipe);
  const alternatesNotice = getAgentSetupRecipeAlternateRemotesNotice(recipe);
  const instructions = getAgentSetupRecipeMergeInstructions(recipe.host);
  return [
    `${hostLabel} setup (${getAgentSetupRecipeCopyHint(recipe.host)} — review before running):`,
    ...recipe.entrySnippet.split('\n'),
    ...(instructions.standaloneHint ? [instructions.entryHint, instructions.standaloneHint, ...recipe.snippet.split('\n')] : []),
    ...('url' in install ? [`Add to ${hostLabel} (opens the app): ${install.url}. The editor asks before saving the server configuration.`] : []),
    ...(cliCommand && cliCommand !== recipe.entrySnippet ? [`Or run: ${cliCommand}`] : []),
    `From the official MCP Registry: ${recipe.registryName}` +
      ` v${recipe.version}, observed ${recipe.observedAt}.`,
    ...(headersNotice ? [headersNotice] : []),
    ...(environmentNotice ? [environmentNotice] : []),
    ...(alternatesNotice ? [alternatesNotice] : []),
  ];
};

const MISSING_KIND_LABEL = 'unknown';
const MISSING_KIND_VALUE = 'not specified';

const formatEnumLabel = (value: string): string => value.replaceAll('_', ' ');

export const stripTerminalControls = (value: string): string =>
  value
    .replace(/(?:\u001b\]|\u009d)[^\u0007\u001b]*(?:\u0007|\u001b\\)?/gu, '')
    .replace(/(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/gu, '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, '');

const renderCatalogLines = (lines: readonly string[]): string =>
  lines.map(stripTerminalControls).join('\n');

const optionalLine = (line: string | undefined): string[] => (line ? [line] : []);

const isTrackedVisitUrl = (value: string): boolean => {
  try {
    const pathname = new URL(value).pathname;
    return pathname === '/go' || pathname.startsWith('/go/');
  } catch {
    return value === '/go' || value.startsWith('/go/');
  }
};

export const formatComparisonFacts = (facts?: AgentPublicComparisonFacts): string[] => {
  if (!facts) return [];

  const lines: string[] = [];
  const groups: Array<[string, string[] | undefined]> = [
    ['Best for', facts.bestFor],
    ['Not best for', facts.notBestFor],
    ['Strengths', facts.strengths],
    ['Limitations', facts.limitations],
  ];
  for (const [label, items] of groups) {
    const values = (items ?? []).map(safeDiagnostic).filter(Boolean);
    if (values.length) lines.push(`${label}:`, ...values.map((value) => `- ${value}`));
  }

  const notes: Array<[string, string | undefined]> = [
    ['Pricing', facts.pricingNotes],
    ['Platforms', facts.platformNotes],
    ['Migration', facts.migrationNotes],
  ];
  for (const [label, note] of notes) {
    const value = safeDiagnostic(note ?? '');
    if (value) lines.push(`${label}: ${value}`);
  }
  if (lines.length && facts.lastReviewedAt) {
    lines.push(`Comparison facts reviewed: ${safeDiagnostic(facts.lastReviewedAt)}`);
  }
  return lines;
};

export const formatComparison = (pair: AgentComparisonPairItem): string => {
  const lines = [
    pair.title,
    ...(pair.description ? [pair.description] : []),
    `${pair.primary.name} vs ${pair.secondary.name}`,
    `URL: ${pair.pageUrl}`,
    `JSON: ${pair.jsonUrl}`,
  ];

  if (pair.featureRows?.length) {
    lines.push('', 'Feature rows:');
    for (const row of pair.featureRows) {
      lines.push(`- ${row.label}: ${row.primary} | ${row.secondary}`);
    }
  }

  const sides: Array<[string, AgentPublicComparisonFacts | undefined]> = [
    [pair.primary.name, pair.primaryComparisonFacts],
    [pair.secondary.name, pair.secondaryComparisonFacts],
  ];
  for (const [name, facts] of sides) {
    const factLines = formatComparisonFacts(facts);
    if (factLines.length) lines.push('', `${safeDiagnostic(name)} comparison notes:`, ...factLines);
  }

  if (pair.verdict) lines.push('', `Verdict: ${pair.verdict}`);
  if (pair.reviewedAt) lines.push(`Reviewed: ${pair.reviewedAt}`);
  const sources = (pair.sourceReferences ?? []).filter((source) => !isTrackedVisitUrl(source.url));
  if (sources.length) {
    lines.push('', 'Source references:', ...sources.map(
      (source) => `- ${safeDiagnostic(source.title ?? source.publisher ?? 'Reference')}: ${source.url}`,
    ));
  }

  return `${renderCatalogLines(lines)}\n`;
};

const uniqueKinds = (kinds: readonly AgentInterfaceKind[]): AgentInterfaceKind[] => [
  ...new Set(kinds),
];

const formatResourceKindLine = (
  resourceKind: AgentResourceKindReference | null | undefined,
): string => {
  const value = resourceKind?.value.trim() ?? '';
  const label = resourceKind?.label.trim() ?? '';

  if (!value && !label) {
    return `Resource kind: ${MISSING_KIND_LABEL} (${MISSING_KIND_VALUE})`;
  }

  const displayValue = value || MISSING_KIND_VALUE;
  const displayLabel =
    label || (isResourceKind(value) ? getResourceKindLabel(value) : MISSING_KIND_LABEL);

  return `Resource kind: ${displayLabel} (${displayValue})`;
};

const formatAgentInterfaceKindsLine = (
  kinds: readonly AgentInterfaceKind[] | null | undefined,
): string | undefined => {
  if (!kinds?.length) return undefined;

  const formatted = uniqueKinds(kinds)
    .map((kind) => `${getAgentInterfaceKindLabel(kind)} (${kind})`)
    .join(', ');

  return `Agent interface kinds: ${formatted}`;
};

const agentInterfaceKindsFromDetail = (
  tool: AgentToolDetail,
): readonly AgentInterfaceKind[] | undefined =>
  tool.agentInterfaces?.map((agentInterface) => agentInterface.kind);

const catalogKindLines = (
  resourceKind: AgentResourceKindReference | null | undefined,
  agentInterfaceKinds: readonly AgentInterfaceKind[] | null | undefined,
): string[] => [
  formatResourceKindLine(resourceKind),
  ...optionalLine(formatAgentInterfaceKindsLine(agentInterfaceKinds)),
];

export const formatTool = (tool: AgentToolDetail): string => {
  const pricingUrl = getPublicHttpUrl(tool.pricingDetails?.pricingUrl);
  const lines = [
    tool.name,
    TOOL_CONTENT_POLICY_NOTICE,
    QUOTED_CATALOG_CONTENT_START,
    tool.description,
    QUOTED_CATALOG_CONTENT_END,
    ...(tool.publisher ? [`Publisher: ${tool.publisher.name} — ${tool.publisher.profileUrl}`] : []),
    `Pricing: ${tool.pricing ?? 'Not listed'}`,
    ...(pricingUrl && !isTrackedVisitUrl(pricingUrl)
      ? [`Official pricing: ${pricingUrl}`]
      : []),
    ...(tool.pricingDetails?.startingPrice !== undefined
      ? [`Starting price: ${tool.pricingDetails.startingPrice}${tool.pricingDetails.currency ? ` ${tool.pricingDetails.currency}` : ''}`]
      : []),
    `Platforms: ${tool.platforms.join(', ') || 'unknown'}`,
    ...(tool.editions?.length ? [renderToolEditionsMarkdown(tool.editions)] : []),
    ...summarizeToolPricingEvidence(tool.pricingDetails),
    ...summarizeFreeTierTerms(publicFreeTierTermsSchema.safeParse(tool.pricingDetails?.freeTierTerms).data),
    ...catalogKindLines(tool.resourceKind, agentInterfaceKindsFromDetail(tool)),
    ...optionalLine(
      tool.targetAudience
        ? `${TOOL_TARGET_AUDIENCE_LABEL}: ${tool.targetAudience}`
        : undefined,
    ),
    ...optionalLine(
      tool.pricingDetails?.trialAvailability === 'available'
        ? `${TOOL_FREE_TRIAL_LABEL}: ${TOOL_FREE_TRIAL_AVAILABLE_VALUE}`
        : undefined,
    ),
    ...(tool.supportedLanguages ?? []).map((fact) => `Language: ${fact.name} (${fact.id}) — ${LANGUAGE_SUPPORT_KIND_LABELS[fact.supportKind]} — ${fact.sourceUrl}`),
    ...(tool.pricingDetails?.trialTerms ? summarizePublicTrialTerms(tool.pricingDetails.trialTerms) : []),
    `URL: ${tool.detailUrl}`,
    `Visit: ${tool.visitUrl}`,
    ...(tool.contentSignal ? [`Content-Signal: ${tool.contentSignal}`] : []),
    ...(tool.deals ? renderToolDealsMarkdown(filterCurrentToolDeals(tool.deals)).split('\n') : []),
  ];

  if (tool.pricingHistory) {
    const {latestValidatedChange} = tool.pricingHistory;
    lines.push(
      `Latest validated pricing change: ${formatEnumLabel(latestValidatedChange.previous)} → ${formatEnumLabel(latestValidatedChange.current)} (${latestValidatedChange.changedAt})`,
      `Pricing history: ${tool.pricingHistory.url}`,
    );
  }

  if (tool.resourceIdentity) {
    lines.push(
      `Identity: ${tool.resourceIdentity.kindLabel} — ${tool.resourceIdentity.canonicalUrl}`,
    );
    if (tool.resourceIdentity.registryId) {
      lines.push(`Registry ID: ${tool.resourceIdentity.registryId}`);
    }
  }

  const repositoryNotice = buildRepositoryObservationNotice(tool.repositoryObservation);
  if (repositoryNotice) {
    lines.push(`Repository notice: ${repositoryNotice}`);
  }

  const repositoryLastPush = buildRepositoryLastPushLabel(tool.repositoryObservation);
  if (repositoryLastPush) {
    lines.push(repositoryLastPush);
  }

  const taxonomyLine = (
    label: string,
    items: readonly AgentTaxonomyReference[] | undefined,
  ): string =>
    `${label}: ${
      items?.length
        ? items.map((item) => `${item.name} (${item.slug})`).join(', ')
        : 'none listed'
    }`;
  lines.push(
    taxonomyLine('Categories', tool.categories),
    taxonomyLine('Tags', tool.tags),
    taxonomyLine('Use cases', tool.useCases),
  );

  const freshness = tool.freshness;
  const destinations = freshness?.destinationHealth;
  const destinationStates = (
    [
      ['website', destinations?.website],
      ['affiliate URL', destinations?.affiliateUrl],
    ] as const
  ).flatMap(([label, entry]) =>
    entry
      ? [
          `${label}: ${entry.status ?? 'unknown'}${
            entry.status === 'dead' && entry.deadSince
              ? ` since ${entry.deadSince}`
              : ''
          }`,
        ]
      : [],
  );
  lines.push(
    `Verified: ${
      freshness?.isVerified
        ? `yes${freshness.verifiedAt ? ` (${freshness.verifiedAt})` : ''}`
        : 'no'
    }`,
    `Last checked: ${freshness?.lastCheckedAt ?? 'unknown'}`,
    `Destination health: ${
      destinationStates.length
        ? destinationStates.join('; ')
        : freshness?.hasDeadDestination
          ? 'a dead destination is flagged'
          : 'not probed'
    }`,
  );

  const keyFeatures = tool.keyFeatures ?? [];

  if (keyFeatures.length > 0) {
    lines.push('Features:', QUOTED_CATALOG_CONTENT_START, ...keyFeatures.map((feature) => `- ${feature}`), QUOTED_CATALOG_CONTENT_END);
  }
  if (tool.uiComponent) lines.push('', ...renderUiComponentMarkdown(tool.uiComponent).split('\n'));
  if (tool.keyFeatureDetails?.length) {
    lines.push('Feature examples:', QUOTED_CATALOG_CONTENT_START, ...renderToolFeatureDetailsMarkdown(tool.keyFeatureDetails).split('\n'), QUOTED_CATALOG_CONTENT_END);
  }

  const workflows = buildPublishedToolDecisionSupport({useCases: tool.useCases}).workflows;
  if (workflows.length > 0) {
    lines.push(
      'What people use it for:',
      'These are SlothHub workflow classifications, not claims about specific customers or adoption.',
      ...workflows.map((workflow) => `- ${workflow.name}: ${workflow.description}`),
    );
  }

  const decisionContext = renderToolDecisionContextText(tool);
  if (decisionContext) lines.push('', ...decisionContext.split('\n'));

  const comparisonFactLines = formatComparisonFacts(tool.comparisonFacts);
  if (comparisonFactLines.length) lines.push('Comparison facts:', ...comparisonFactLines);

  if (tool.resourceRelationships?.length) {
    lines.push('Related resources:');
    for (const relationship of tool.resourceRelationships) {
      lines.push(
        `- ${relationship.label}: ${relationship.target.name} (${relationship.target.resourceKind.label})`,
        `  Canonical: ${relationship.target.canonicalUrl}`,
        ...(relationship.evidenceUrl ? [`  Evidence: ${relationship.evidenceUrl}`] : []),
      );
    }
  }

  if (tool.portability) lines.push('', ...renderToolPortabilityMarkdown(tool.portability).split('\n'));
  if (tool.lifecycle) lines.push('', ...renderToolLifecycleMarkdown(tool.lifecycle).split('\n'));

  if (tool.productLimits?.length) {
    lines.push(
      'Product limits:',
      'Missing metrics are unknown, not unlimited. Conflicting sources remain explicit.',
    );
    for (const group of tool.productLimits) {
      const scopes = [
        group.planScope ? `plan: ${group.planScope}` : '',
        group.deploymentScope ? `deployment: ${group.deploymentScope}` : '',
      ].filter(Boolean);
      lines.push(
        `- ${group.metric}${scopes.length ? ` (${scopes.join(', ')})` : ''}`,
        ...(group.basis ? [`  Basis: ${formatEnumLabel(group.basis)}`] : []),
        ...(group.ambiguous ? ['  Ambiguous sourced set: yes'] : []),
      );
      for (const fact of group.facts) {
        lines.push(
          fact.state === 'bounded'
            ? `  - ${formatEnumLabel(fact.comparator)} ${fact.value} ${fact.unit}`
            : `  - ${formatEnumLabel(fact.state)}`,
          ...(fact.reviewedAt ? [`    Reviewed: ${fact.reviewedAt}`] : []),
          ...(fact.note ? [`    Note: ${fact.note}`] : []),
          ...fact.evidence.map(
            (source) => `    Evidence: ${source.title}: ${source.url} (checked ${source.checkedAt})`,
          ),
        );
      }
    }
  }

  if (tool.quickstarts?.length) {
    lines.push('Quickstarts:', QUOTED_CATALOG_CONTENT_START);
    for (const quickstart of tool.quickstarts) {
      lines.push(
        `- ${quickstart.label}`,
        `  Status: ${quickstart.statusLabel} (provenance only; not a safety claim)`,
        ...(quickstart.sourceLabel ? [`  Source: ${quickstart.sourceLabel}`] : []),
        ...(quickstart.command ? [`  Command: ${quickstart.command}`] : []),
        ...(quickstart.docsUrl ? [`  Docs: ${quickstart.docsUrl}`] : []),
        ...(quickstart.notice ? [`  Notice: ${quickstart.notice}`] : []),
      );
    }
    lines.push(QUOTED_CATALOG_CONTENT_END);
  }

  if (tool.agentReadiness) lines.push('Agent readiness (unknown is not a failure):', ...formatAgentReadiness(tool.agentReadiness));
  if (tool.agentInterfaces?.length) {
    lines.push('Agent interfaces:');
    for (const agentInterface of tool.agentInterfaces) {
      lines.push(
        `- ${agentInterface.label} (${formatEnumLabel(agentInterface.kind)})`,
        `  Status: ${formatEnumLabel(agentInterface.status)} (provenance only; not a safety claim)`,
        ...(agentInterface.source ? [`  Source: ${formatEnumLabel(agentInterface.source)}`] : []),
        ...(agentInterface.identifier ? [`  Identifier: ${agentInterface.identifier}`] : []),
        ...(agentInterface.installCommand ? [`  Install: ${agentInterface.installCommand}`] : []),
        ...(agentInterface.operatingSystem ? [`  OS: ${agentInterface.operatingSystem}`] : []),
        ...(agentInterface.downloadUrl ? [`  Download: ${agentInterface.downloadUrl}`] : []),
        ...(agentInterface.docsUrl ? [`  Docs: ${agentInterface.docsUrl}`] : []),
        ...(agentInterface.authRequirement ? [`  Auth: ${agentInterface.authRequirement}`] : []),
        ...(agentInterface.capabilitiesNote
          ? [`  Capabilities: ${agentInterface.capabilitiesNote}`]
          : []),
      );

      if (agentInterface.setupFacts) lines.push(...formatAgentSetupFacts(agentInterface.setupFacts).map((line) => `  ${line}`));
      for (const recipe of resolvePublicAgentSetupRecipeEntries(agentInterface)) {
        lines.push(...formatSetupRecipeLines(recipe));
      }

      const automation = agentInterface.automation;
      if (!automation) continue;

      lines.push(
        '  Automation safety facts:',
        ...(automation.nonInteractive
          ? [`  Non-interactive: ${formatEnumLabel(automation.nonInteractive)}`]
          : []),
        ...(automation.structuredOutput
          ? [`  Structured output: ${formatEnumLabel(automation.structuredOutput)}`]
          : []),
        ...(automation.dryRun ? [`  Dry run: ${formatEnumLabel(automation.dryRun)}`] : []),
        ...(automation.evidenceBasis
          ? [`  Evidence basis: ${formatEnumLabel(automation.evidenceBasis)}`]
          : []),
        ...(automation.sideEffects?.length
          ? [`  Side effects: ${automation.sideEffects.map(formatEnumLabel).join(', ')}`]
          : []),
        ...(automation.workspaceConcurrency
          ? [`  Workspace concurrency: ${formatEnumLabel(automation.workspaceConcurrency)}`]
          : []),
        ...(automation.isolationSupport?.length
          ? [`  Isolation support: ${automation.isolationSupport.map(formatEnumLabel).join(', ')}`]
          : []),
        `  Checked: ${automation.checkedAt}`,
        ...(automation.notes ? [`  Notes: ${automation.notes}`] : []),
        '  Evidence:',
        ...automation.evidenceReferences.map(
          (reference) =>
            `  - ${reference.title} (${formatEnumLabel(reference.sourceType)}): ${reference.url}${reference.checkedAt ? ` (checked ${reference.checkedAt})` : ''}${reference.note ? ` — ${reference.note}` : ''}`,
        ),
      );
    }
  }

  if (tool.runtimeRequirements?.length) {
    lines.push(
      'Runtime requirements:',
      ...tool.runtimeRequirements.flatMap((requirement) => {
        const range = [
          `environment ${requirement.environmentRange}`,
          ...(requirement.toolRange ? [`Tool ${requirement.toolRange}`] : []),
        ].join(' | ');
        return [
          `- ${requirement.subjectName} (${requirement.subjectKind}): ${requirement.status} | ${range}`,
          ...(requirement.note ? [`  Note: ${requirement.note}`] : []),
          ...requirement.evidence.map(
            (source) => `  Evidence: ${source.title}: ${source.url} (checked ${source.checkedAt})`,
          ),
          `  Reviewed: ${requirement.reviewedAt}`,
        ];
      }),
      'Constraints are opaque source text; SlothHub does not resolve or install them.',
    );
  }

  if (tool.resourceLinks) {
    const links = tool.resourceLinks.filter(
      (link) => !isTrackedVisitUrl(link.url),
    );
    lines.push(
      links.length === 0
        ? 'Resource links: none listed'
        : 'Resource links:',
    );
    for (const link of links) {
      lines.push(
        `- ${link.label} (${RESOURCE_LINK_KIND_LABELS[link.kind]}): ${link.url}`,
      );
    }
  }

  const sourceReferences = (tool.sourceReferences ?? []).filter(
    (reference) => !isTrackedVisitUrl(reference.url),
  );
  if (sourceReferences.length > 0) {
    lines.push('Source references:');
    for (const reference of sourceReferences.slice(
      0,
      MAX_PUBLIC_SOURCE_REFERENCES,
    )) {
      lines.push(
        `- ${reference.title} (${reference.sourceType}): ${reference.url}${reference.checkedAt ? ` — checked ${reference.checkedAt}` : ''}`,
      );
    }
    const remainder = sourceReferences.length - MAX_PUBLIC_SOURCE_REFERENCES;
    if (remainder > 0) {
      lines.push(`- … ${remainder} more source references in the JSON payload`);
    }
  }

  return `${renderCatalogLines(lines)}\n`;
};

const formatSearchHit = (tool: AgentSearchIndexTool): string =>
  renderCatalogLines([
    `${tool.name} (${tool.slug})`,
    tool.description,
    `Pricing: ${tool.pricing ?? 'Not listed'} | Platforms: ${tool.platforms.join(', ')}`,
    ...catalogKindLines(tool.resourceKind, tool.agentInterfaceKinds),
    ...(tool.supportedLanguages ?? []).map((fact) => `Language: ${fact.name} (${fact.id})`),
    tool.detailUrl,
  ]);

export const formatSearchResults = (results: readonly CatalogSearchHit[]): string => {
  if (results.length === 0) return 'No matching tools found.\n';

  return `${results.map(({tool}) => formatSearchHit(tool)).join('\n\n')}\n`;
};

export const toSearchJsonHit = (
  tool: AgentSearchIndexTool,
  score: number,
): CatalogSearchJsonHit => ({
  ...tool,
  agentInterfaceKinds: [...(tool.agentInterfaceKinds ?? [])],
  score,
});

export const formatArticleSearchResults = (
  page: CliListPage<PublicAgentSearchArticleResult>,
  limit: number,
): string => {
  if (page.total === 0) return '';
  return `\n${renderCatalogLines([
    'Articles (query matches; Tool filters do not apply)',
    `Showing ${page.count} of ${page.total} from offset ${page.offset}; limit=${limit}, configured_limit=${AGENT_SEARCH_MAX_RESULT_LIMIT}.`,
    ...page.items.flatMap((article) => [
      '', article.title, ...(article.excerpt ? [article.excerpt] : []), article.url,
    ]),
    ...(page.has_more ? [`More Articles available. Use --offset ${page.next_offset}.`] : []),
  ])}\n`;
};
