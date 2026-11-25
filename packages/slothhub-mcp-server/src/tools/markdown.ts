import {formatAgentSetupFacts, renderAgentReadinessMarkdown} from '@slothhub/domain/agent-interface';
import {QUOTED_CATALOG_CONTENT_END, QUOTED_CATALOG_CONTENT_START, TOOL_CONTENT_POLICY_NOTICE} from '@slothhub/domain/catalog-content-policy';
import {renderToolEditionsMarkdown} from '@slothhub/domain/tool-editions';
import {summarizeFreeTierTerms, publicFreeTierTermsSchema} from '@slothhub/domain/tool-pricing-evidence';
import {summarizeToolPricingEvidence} from '@slothhub/domain/tool-pricing-evidence';
import {renderUiComponentMarkdown} from '@slothhub/domain/ui-component';
import {buildAgentHostInstallLink} from '@slothhub/domain/mcp-registry';
import {renderToolPortabilityMarkdown} from '@slothhub/domain/tool-portability-markdown';
import {filterCurrentToolDeals, renderToolDealsMarkdown} from '@slothhub/domain/public-tool-deal';
import {renderToolLifecycleMarkdown} from '@slothhub/domain/tool-lifecycle-markdown';
import {LANGUAGE_SUPPORT_KIND_LABELS} from '@slothhub/domain/supported-language';
import {buildSafeMarkdownLink, encodeMarkdownUrl} from '@slothhub/domain/markdown-safety';
import {getPublicHttpUrl} from '@slothhub/domain/url-safety';
import {renderToolFeatureDetailsMarkdown} from '@slothhub/domain/tool-feature-details-markdown';
import {renderToolDecisionContextMarkdown} from '@slothhub/domain/tool-decision-context-markdown';
import {buildPublishedToolDecisionSupport} from '@slothhub/domain/tool-decision-support';
import {getAgentSetupRecipeCliCommand, getAgentSetupRecipeCopyHint, getAgentSetupRecipeAlternateRemotesNotice, getAgentSetupRecipeHeadersNotice, getAgentSetupRecipeEnvironmentNotice, getAgentSetupRecipeHostConfigFormat, getAgentSetupRecipeHostLabel, getAgentSetupRecipeUnknownNotice, resolvePublicAgentSetupRecipeEntries} from '@slothhub/domain/mcp-registry';
import {getAgentSetupRecipeMergeInstructions} from '@slothhub/domain/agent-setup-recipe-hosts';
import {MAX_PUBLIC_SOURCE_REFERENCES} from '@slothhub/domain/source-reference';
import {RESOURCE_LINK_KIND_LABELS} from '@slothhub/domain/published-tool-profile';
import {TOOL_FREE_TRIAL_AVAILABLE_VALUE, TOOL_FREE_TRIAL_LABEL, TOOL_TARGET_AUDIENCE_LABEL} from '@slothhub/domain/tool-fact-labels';
import {summarizePublicTrialTerms} from '@slothhub/domain/tool-trial-terms';
import {buildRepositoryLastPushLabel, buildRepositoryObservationNotice} from '@slothhub/domain/repository-observation';

import type {AgentTaxonomyReference, AgentToolDetail} from '../types.js';
import {escapeMarkdownText, formatEnumLabel, toMarkdownInlineCode, toMarkdownCodeBlock} from './markdownText.js';
export {escapeMarkdownText, toMarkdownInlineCode, toMarkdownCodeBlock} from './markdownText.js';

const isTrackedVisitUrl = (value: string): boolean => {
  try {
    const pathname = new URL(value).pathname;
    return pathname === '/go' || pathname.startsWith('/go/');
  } catch {
    return value === '/go' || value.startsWith('/go/');
  }
};

export const formatToolMarkdown = (tool: AgentToolDetail): string => {
  const pricingUrl = getPublicHttpUrl(tool.pricingDetails?.pricingUrl);
  const lines = [
    `# ${tool.name}`,
    '',
    TOOL_CONTENT_POLICY_NOTICE,
    '',
    QUOTED_CATALOG_CONTENT_START,
    tool.description,
    QUOTED_CATALOG_CONTENT_END,
    '',
    `- Slug: \`${tool.slug}\``,
    ...(tool.contentSignal ? [`- Content-Signal: ${tool.contentSignal}`] : []),
    ...(tool.publisher ? [`- Publisher: ${buildSafeMarkdownLink(tool.publisher.name, tool.publisher.profileUrl)} — editorial organization profile`] : []),
    `- Pricing: ${tool.pricing ?? 'Not listed'}`,
    ...(pricingUrl && !isTrackedVisitUrl(pricingUrl)
      ? [`- Official pricing: ${encodeMarkdownUrl(pricingUrl)}`]
      : []),
    ...(tool.pricingDetails?.startingPrice !== undefined
      ? [`- Starting price: ${tool.pricingDetails.startingPrice}${tool.pricingDetails.currency ? ` ${tool.pricingDetails.currency}` : ''}`]
      : []),
    `- Platforms: ${tool.platforms.join(', ') || 'unknown'}`,
    `- Resource kind: ${tool.resourceKind.label} (\`${tool.resourceKind.value}\`)`,
    `- Identity: ${escapeMarkdownText(tool.resourceIdentity.kindLabel)} — ${tool.resourceIdentity.canonicalUrl}`,
    ...(tool.resourceIdentity.registryId
      ? [`- Registry ID: ${toMarkdownInlineCode(tool.resourceIdentity.registryId)}`]
      : []),
    ...(tool.targetAudience
      ? [`- ${TOOL_TARGET_AUDIENCE_LABEL}: ${escapeMarkdownText(tool.targetAudience)}`]
      : []),
    ...(tool.editions?.length ? [renderToolEditionsMarkdown(tool.editions)] : []),
    ...summarizeToolPricingEvidence(tool.pricingDetails, escapeMarkdownText).map((line) => `- ${line}`),
    ...summarizeFreeTierTerms(publicFreeTierTermsSchema.safeParse(tool.pricingDetails?.freeTierTerms).data, escapeMarkdownText).map((line) => `- ${line}`),
    ...(tool.pricingDetails?.trialAvailability === 'available'
      ? [`- ${TOOL_FREE_TRIAL_LABEL}: ${TOOL_FREE_TRIAL_AVAILABLE_VALUE}`]
      : []),
    ...(tool.pricingDetails?.trialTerms
      ? summarizePublicTrialTerms(tool.pricingDetails.trialTerms, escapeMarkdownText).map((line) => `- ${line}`)
      : []),
    `- Cite: ${tool.detailUrl}`,
    `- Visit (tracked outbound, do not cite): ${tool.visitUrl}`,
  ];

  if (tool.pricingHistory) {
    const {latestValidatedChange} = tool.pricingHistory;
    lines.push(
      `- Latest validated pricing change: ${latestValidatedChange.previous} → ${latestValidatedChange.current} (${latestValidatedChange.changedAt})`,
      `- Pricing history: ${tool.pricingHistory.url}`,
    );
  }

  if (tool.resourceIdentity?.mcpRegistryUrl) {
    lines.push(`- MCP Registry: ${tool.resourceIdentity.mcpRegistryUrl}`);
  }

  const repositoryNotice = buildRepositoryObservationNotice(tool.repositoryObservation);
  if (repositoryNotice) {
    lines.push(`- Repository notice: ${repositoryNotice}`);
  }

  const repositoryLastPush = buildRepositoryLastPushLabel(tool.repositoryObservation);
  if (repositoryLastPush) {
    lines.push(`- ${repositoryLastPush}`);
  }

  const taxonomyLine = (
    label: string,
    items: AgentTaxonomyReference[],
  ): string =>
    `- ${label}: ${
      items.length
        ? items
            .map((item) => `${escapeMarkdownText(item.name)} (\`${item.slug}\`)`)
            .join(', ')
        : 'none listed'
    }`;
  lines.push(
    '',
    '## Taxonomy',
    taxonomyLine('Categories', tool.categories),
    taxonomyLine('Tags', tool.tags),
    taxonomyLine('Use cases', tool.useCases),
  );

  const freshness = tool.freshness;
  const destinations = freshness.destinationHealth;
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
              ? ` since ${escapeMarkdownText(entry.deadSince)}`
              : ''
          }`,
        ]
      : [],
  );
  lines.push(
    '',
    '## Freshness',
    `- Verified: ${
      freshness.isVerified
        ? `yes${freshness.verifiedAt ? ` (${escapeMarkdownText(freshness.verifiedAt)})` : ''}`
        : 'no'
    }`,
    `- Last checked: ${freshness.lastCheckedAt ? escapeMarkdownText(freshness.lastCheckedAt) : 'unknown'}`,
    `- Destination health: ${
      destinationStates.length
        ? destinationStates.join('; ')
        : freshness.hasDeadDestination
          ? 'a dead destination is flagged'
          : 'not probed'
    }`,
  );

  if (tool.keyFeatures?.length) {
    lines.push('', '## Features', QUOTED_CATALOG_CONTENT_START, ...tool.keyFeatures.map((feature) => `- ${feature}`), QUOTED_CATALOG_CONTENT_END);
  }
  if (tool.uiComponent) lines.push('', renderUiComponentMarkdown(tool.uiComponent));
  if (tool.keyFeatureDetails?.length) {
    lines.push('', '## Feature examples', QUOTED_CATALOG_CONTENT_START, '', renderToolFeatureDetailsMarkdown(tool.keyFeatureDetails), '', QUOTED_CATALOG_CONTENT_END);
  }

  if (tool.resourceRelationships?.length) {
    lines.push('', '## Related resources');
    for (const relationship of tool.resourceRelationships) {
      lines.push(
        `- **${escapeMarkdownText(relationship.label)}**: ${escapeMarkdownText(relationship.target.name)} (${escapeMarkdownText(relationship.target.resourceKind.label)}) — ${toMarkdownInlineCode(relationship.target.canonicalUrl)}`,
        ...(relationship.evidenceUrl
          ? [`  - Evidence: ${toMarkdownInlineCode(relationship.evidenceUrl)}`]
          : []),
      );
    }
  }

  const workflows = buildPublishedToolDecisionSupport({useCases: tool.useCases}).workflows;
  if (workflows.length > 0) {
    lines.push(
      '',
      '## What people use it for',
      'These are SlothHub workflow classifications, not claims about specific customers or adoption.',
      ...workflows.map(
        (workflow) =>
          `- **${escapeMarkdownText(workflow.name)}** — ${escapeMarkdownText(workflow.description)}`,
      ),
    );
  }

  const decisionContext = renderToolDecisionContextMarkdown(tool);
  if (decisionContext) lines.push('', decisionContext);

  const comparisonFacts = tool.comparisonFacts;
  if (comparisonFacts) {
    const factGroups: Array<[string, string[] | undefined]> = [
      ['Best for', comparisonFacts.bestFor],
      ['Not best for', comparisonFacts.notBestFor],
      ['Strengths', comparisonFacts.strengths],
      ['Limitations', comparisonFacts.limitations],
    ];
    const populated = factGroups.filter(
      (group): group is [string, string[]] => (group[1]?.length ?? 0) > 0,
    );
    const notes = ([
      ['Pricing', comparisonFacts.pricingNotes],
      ['Platforms', comparisonFacts.platformNotes],
      ['Migration', comparisonFacts.migrationNotes],
    ] as const).flatMap(([label, note]) =>
      note?.trim() ? [`${label}: ${escapeMarkdownText(note)}`] : [],
    );
    if (populated.length > 0 || notes.length > 0) {
      lines.push('', '## Comparison facts');
      for (const [label, items] of populated) {
        lines.push(
          `### ${label}`,
          ...items.map((item) => `- ${escapeMarkdownText(item)}`),
        );
      }
      lines.push(...notes);
      if (comparisonFacts.lastReviewedAt) {
        lines.push(
          `Comparison facts reviewed: ${comparisonFacts.lastReviewedAt}`,
        );
      }
    }
  }

  if (tool.supportedLanguages?.length) {
    lines.push('', '## Supported programming languages',
      ...tool.supportedLanguages.map((fact) => `- ${escapeMarkdownText(fact.name)} (${toMarkdownInlineCode(fact.id)}) — ${LANGUAGE_SUPPORT_KIND_LABELS[fact.supportKind]}: ${toMarkdownInlineCode(fact.sourceUrl)}`));
  }
  if (tool.runtimeRequirements?.length) {
    lines.push('', '## Runtime requirements');
    for (const requirement of tool.runtimeRequirements) {
      lines.push(
        `- **${escapeMarkdownText(requirement.subjectName)}** (${requirement.subjectKind}) — ${requirement.status}`,
        `  - Environment: ${toMarkdownInlineCode(requirement.environmentRange)}`,
        ...(requirement.toolRange
          ? [`  - Tool range: ${toMarkdownInlineCode(requirement.toolRange)}`]
          : []),
        ...(requirement.note ? [`  - Note: ${escapeMarkdownText(requirement.note)}`] : []),
        ...requirement.evidence.map((source) =>
          `  - Evidence: ${escapeMarkdownText(source.title)}: ${toMarkdownInlineCode(source.url)} (checked ${source.checkedAt})`),
        `  - Reviewed: ${requirement.reviewedAt}`,
      );
    }
    lines.push('', 'Constraints are opaque source text; SlothHub does not resolve or install them.');
  }

  if (tool.portability) lines.push('', renderToolPortabilityMarkdown(tool.portability));
  if (tool.lifecycle) lines.push('', renderToolLifecycleMarkdown(tool.lifecycle));

  if (tool.productLimits?.length) {
    lines.push(
      '',
      '## Product limits',
      'Missing metrics are unknown, not unlimited. Conflicting sources remain explicit.',
    );
    for (const group of tool.productLimits) {
      const scopes = [
        group.planScope ? `plan: ${toMarkdownInlineCode(group.planScope)}` : '',
        group.deploymentScope
          ? `deployment: ${toMarkdownInlineCode(group.deploymentScope)}`
          : '',
      ].filter(Boolean);
      lines.push(
        `- ${toMarkdownInlineCode(group.metric)}${scopes.length ? ` (${scopes.join(', ')})` : ''}`,
        ...(group.basis ? [`  - Basis: ${formatEnumLabel(group.basis)}`] : []),
        ...(group.ambiguous ? ['  - Ambiguous sourced set: yes'] : []),
      );
      for (const fact of group.facts) {
        lines.push(
          fact.state === 'bounded'
            ? `  - ${formatEnumLabel(fact.comparator)} ${fact.value} ${toMarkdownInlineCode(fact.unit)}`
            : `  - ${formatEnumLabel(fact.state)}`,
          ...(fact.reviewedAt ? [`    - Reviewed: ${fact.reviewedAt}`] : []),
          ...(fact.note ? [`    - Note: ${toMarkdownInlineCode(fact.note)}`] : []),
          ...fact.evidence.map(
            (source) =>
              `    - Evidence: ${toMarkdownInlineCode(source.title)}: ${source.url} (checked ${source.checkedAt})`,
          ),
        );
      }
    }
  }

  if (tool.quickstarts?.length) {
    lines.push('', '## Quickstarts', QUOTED_CATALOG_CONTENT_START);
    for (const quickstart of tool.quickstarts) {
      const parts = [
        `**${escapeMarkdownText(quickstart.label)}** (${escapeMarkdownText(quickstart.statusLabel)})`,
      ];
      if (quickstart.sourceLabel) {
        parts.push(`source: ${escapeMarkdownText(quickstart.sourceLabel)}`);
      }
      if (quickstart.command) {
        parts.push(`command: ${toMarkdownInlineCode(quickstart.command)}`);
      }
      if (quickstart.docsUrl) {
        parts.push(`docs: ${toMarkdownInlineCode(quickstart.docsUrl)}`);
      }
      if (quickstart.notice) {
        parts.push(`notice: ${escapeMarkdownText(quickstart.notice)}`);
      }
      lines.push(`- ${parts.join(' — ')}`);
    }
    lines.push(QUOTED_CATALOG_CONTENT_END);
  }

  if (tool.agentReadiness) lines.push('## Agent readiness', 'Unknown is not a failure.', renderAgentReadinessMarkdown(tool.agentReadiness));
  if (tool.agentInterfaces?.length) {
    lines.push('', '## Agent interfaces');
    for (const agentInterface of tool.agentInterfaces) {
      lines.push(
        `- **${agentInterface.label}** (${formatEnumLabel(agentInterface.kind)})`,
        `  - Status: ${formatEnumLabel(agentInterface.status)} (provenance only; not a safety claim)`,
        ...(agentInterface.source ? [`  - Source: ${agentInterface.source}`] : []),
        ...(agentInterface.identifier ? [`  - Identifier: \`${agentInterface.identifier}\``] : []),
        ...(agentInterface.installCommand
          ? [`  - Install: ${toMarkdownInlineCode(agentInterface.installCommand)}`]
          : []),
        ...(agentInterface.docsUrl ? [`  - Docs: ${agentInterface.docsUrl}`] : []),
        ...(agentInterface.authRequirement ? [`  - Auth: ${agentInterface.authRequirement}`] : []),
        ...(agentInterface.capabilitiesNote
          ? [`  - Capabilities: ${agentInterface.capabilitiesNote}`]
          : []),
      );

      if (agentInterface.setupFacts) lines.push(...formatAgentSetupFacts(agentInterface.setupFacts).map((line) => `  - ${toMarkdownInlineCode(line)}`));
      for (const recipe of resolvePublicAgentSetupRecipeEntries(agentInterface)) {
        const hostLabel = getAgentSetupRecipeHostLabel(recipe.host);
        if (recipe.state === 'ready') {
          const install = buildAgentHostInstallLink(recipe);
          const headersNotice = getAgentSetupRecipeHeadersNotice(recipe);
          const environmentNotice = getAgentSetupRecipeEnvironmentNotice(recipe);
          const cliCommand = getAgentSetupRecipeCliCommand(recipe);
          const alternatesNotice = getAgentSetupRecipeAlternateRemotesNotice(recipe);
          const instructions = getAgentSetupRecipeMergeInstructions(recipe.host);
          lines.push(
            `  ${hostLabel} setup (${getAgentSetupRecipeCopyHint(recipe.host)} — review before running):`,
            ...(getAgentSetupRecipeHostConfigFormat(recipe.host) === 'yaml'
              ? ['', ...toMarkdownCodeBlock(recipe.entrySnippet.trimEnd(), 'yaml').split('\n').map((line) => `  ${line}`), '']
              : recipe.entrySnippet.split('\n').map((snippetLine) => `    ${snippetLine}`)),
            ...(instructions.standaloneHint ? ['', instructions.entryHint, instructions.standaloneHint, ...toMarkdownCodeBlock(recipe.snippet.trimEnd(), 'yaml').split('\n'), ''] : []),
            ...('url' in install ? [`Add to ${hostLabel} (opens the app): ${install.url}. The editor asks before saving the server configuration.`] : []),
            ...(cliCommand && cliCommand !== recipe.entrySnippet ? [`  Or run: ${cliCommand}`] : []),
            `  From the official MCP Registry: ${recipe.registryName}` +
              ` v${recipe.version}, observed ${recipe.observedAt}.`,
            ...(headersNotice ? [`  ${headersNotice}`] : []),
            ...(environmentNotice ? [`  ${environmentNotice}`] : []),
            ...(alternatesNotice ? [`  ${alternatesNotice}`] : []),
          );
        } else {
          lines.push(
            `  ${getAgentSetupRecipeUnknownNotice(recipe.host, recipe.reason)}`,
            ...(recipe.registryUrl ? [`  MCP Registry: ${recipe.registryUrl}`] : []),
          );
        }
      }

      const automation = agentInterface.automation;
      if (!automation) continue;

      lines.push(
        '  - Automation safety facts:',
        ...(automation.nonInteractive
          ? [`    - Non-interactive: ${formatEnumLabel(automation.nonInteractive)}`]
          : []),
        ...(automation.structuredOutput
          ? [`    - Structured output: ${formatEnumLabel(automation.structuredOutput)}`]
          : []),
        ...(automation.dryRun ? [`    - Dry run: ${formatEnumLabel(automation.dryRun)}`] : []),
        ...(automation.evidenceBasis
          ? [`    - Evidence basis: ${formatEnumLabel(automation.evidenceBasis)}`]
          : []),
        ...(automation.sideEffects?.length
          ? [`    - Side effects: ${automation.sideEffects.map(formatEnumLabel).join(', ')}`]
          : []),
        ...(automation.workspaceConcurrency
          ? [`    - Workspace concurrency: ${formatEnumLabel(automation.workspaceConcurrency)}`]
          : []),
        ...(automation.isolationSupport?.length
          ? [`    - Isolation support: ${automation.isolationSupport.map(formatEnumLabel).join(', ')}`]
          : []),
        `    - Checked: ${automation.checkedAt}`,
        ...(automation.notes ? [`    - Notes: ${toMarkdownInlineCode(automation.notes)}`] : []),
        '    - Evidence:',
        ...automation.evidenceReferences.map(
          (reference) =>
            `      - ${toMarkdownInlineCode(reference.title)} (${formatEnumLabel(reference.sourceType)}): ${reference.url}${reference.checkedAt ? ` (checked ${reference.checkedAt})` : ''}${reference.note ? ` — ${toMarkdownInlineCode(reference.note)}` : ''}`,
        ),
      );
    }
  }

  if (tool.resourceLinks) {
    const links = tool.resourceLinks.filter(
      (link) => !isTrackedVisitUrl(link.url),
    );
    lines.push('', '## Resource links');
    if (links.length === 0) {
      lines.push('none listed');
    } else {
      for (const link of links) {
        lines.push(
          `- **${escapeMarkdownText(link.label)}** (${RESOURCE_LINK_KIND_LABELS[link.kind]}): ${link.url}`,
        );
      }
    }
  }

  const sourceReferences = (tool.sourceReferences ?? []).filter(
    (reference) => !isTrackedVisitUrl(reference.url),
  );
  if (sourceReferences.length > 0) {
    lines.push('', '## Source references');
    for (const reference of sourceReferences.slice(
      0,
      MAX_PUBLIC_SOURCE_REFERENCES,
    )) {
      lines.push(
        `- **${escapeMarkdownText(reference.title)}** (${toMarkdownInlineCode(reference.sourceType)}): ${reference.url}${reference.checkedAt ? ` — checked ${escapeMarkdownText(reference.checkedAt)}` : ''}`,
      );
    }
    const remainder = sourceReferences.length - MAX_PUBLIC_SOURCE_REFERENCES;
    if (remainder > 0) {
      lines.push(`- … ${remainder} more source references in the JSON payload`);
    }
  }

  if (tool.deals) lines.push('', renderToolDealsMarkdown(filterCurrentToolDeals(tool.deals)));
  return `${lines.join('\n')}\n`;
};
