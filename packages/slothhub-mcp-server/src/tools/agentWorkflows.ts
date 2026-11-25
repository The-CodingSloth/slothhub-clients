import type { McpServer } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import {
  buildImplementationPlan,
  compareTools,
  renderComparisonDecisionFacts,
  getCitationResult,
  recommendTools,
} from '@slothhub/domain/agent-workflows';
import {
  AgentSearchContractError,
  serializeAgentSearchContractError,
} from '@slothhub/domain/agent-search';
import { getToolInputSchema } from '../schemas/inputs.js';
import {
  recommendationOutput,
  comparisonOutput,
  recommendationInput,
  comparisonInput,
  planInput,
} from '../schemas/agentWorkflows.js';
import type { FeedClient } from '../services/feeds.js';
import type {AgentToolDetail} from '../types.js';
import {
  feedLoadError,
  formatToolResult,
  toolError,
  type ToolContentResult,
} from './format.js';
import {
  describePublicToolFailure,
  resolvePublicTool,
} from './publicToolLookup.js';
import { escapeMarkdownText } from './markdownText.js';

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

type WorkflowRequest =
  | { kind: 'recommend'; params: z.infer<typeof recommendationInput> }
  | { kind: 'compare'; params: z.infer<typeof comparisonInput> }
  | { kind: 'implement'; params: z.infer<typeof planInput> }
  | { kind: 'cite'; params: z.infer<typeof getToolInputSchema> };

export const handleWorkflow = async (
  client: FeedClient,
  request: WorkflowRequest,
  signal?: AbortSignal,
): Promise<ToolContentResult> => {
  const format = request.params.response_format;
  try {
    if (request.kind === 'recommend') {
      const feed = await client.searchIndex(signal);
      const params = request.params;
      const result = recommendTools(feed.data.tools, {
        siteUrl: feed.siteUrl,
        requirements: params.requirements,
        limit: params.limit,
        filters: {
          pricing: params.pricing,
          platform: params.platform,
          category: params.category,
          tag: params.tag,
          useCase: params.use_case,
          resourceKind: params.resource_kind,
          packageRegistry: params.package_registry,
          agentInterfaceKind: params.agent_interface_kind,
          securityCapability: params.security_capability,
          agentHost: params.agent_host,
          sourceAvailability: params.source_availability,
          languages: params.languages,
          integration: params.integration,
          integrationConnection: params.integration_connection,
          destinationHealth: params.destination_health,
          verified: params.verified,
          lastCheckedAfter: params.last_checked_after,
        },
        searchCapabilities: {
          supportedLanguagesAvailable:
            feed.data.filters.supportedLanguages !== undefined,
          agentInterfaceKindsAvailable:
            feed.data.filters.agentInterfaceKinds !== undefined,
          securityCapabilitiesAvailable:
            feed.data.filters.securityCapabilities !== undefined,
          integrationsAvailable: feed.data.filters.integrations !== undefined,
          sourceAvailabilityAvailable: feed.data.filters.sourceAvailability !== undefined,
          setupRecipeHosts: feed.data.filters.setupRecipeHosts?.map(
            ({ value }) => value,
          ),
          availableFilters: feed.data.filters,
        },
      });
      const markdown = [
        '# Recommendations',
        ...result.candidates.flatMap((tool) => [
          `## ${escapeMarkdownText(tool.name)}`,
          ...tool.reasons.map(escapeMarkdownText),
          ...tool.caveats.map(escapeMarkdownText),
          `Cite: ${tool.detailUrl}`,
        ]),
        '## Criteria',
        ...result.criteria.map(escapeMarkdownText),
        ...result.caveats.map(escapeMarkdownText),
      ].join('\n\n');
      return formatToolResult(format, markdown, result);
    }
    const slugs =
      request.kind === 'compare' ? request.params.slugs : [request.params.slug];
    if (request.kind === 'compare' && new Set(slugs).size !== slugs.length) {
      return toolError('invalid_input: Pass distinct Tool slugs.', {code: 'invalid_input', suggestion: 'Remove duplicate slugs and choose at least two distinct Tools.', responseFormat: format, details: {observedCount: new Set(slugs).size}});
    }
    // Attach rejection handling immediately, even when a lookup failure returns early.
    const stackRequest = request.kind === 'implement' && request.params.stack
      ? Promise.allSettled([client.stacks(signal)]) : undefined;
    const resolutions = await Promise.allSettled(slugs.map((slug) => resolvePublicTool(client, {
      slug,
      namespace: request.kind !== 'compare' ? request.params.namespace : undefined,
    }, signal)));
    signal?.throwIfAborted();
    const tools: AgentToolDetail[] = [];
    const toolOrigins = new Map<string, string>();
    for (const outcome of resolutions) {
      if (outcome.status === 'rejected') continue;
      const resolution = outcome.value;
      if (resolution.kind !== 'resolved') {
        const failure = describePublicToolFailure(resolution);
        return toolError(failure.message, {
          code: failure.code,
          suggestion: failure.recovery,
          responseFormat: format,
        });
      }
      if (!tools.some((tool) => tool.slug === resolution.canonicalSlug)) {
        tools.push(resolution.tool);
        toolOrigins.set(resolution.canonicalSlug, resolution.siteUrl);
      }
    }
    const failedLookup = resolutions.find((outcome) => outcome.status === 'rejected');
    if (failedLookup?.status === 'rejected') throw failedLookup.reason;
    if (request.kind === 'compare') {
      if (tools.length < 2) {
        const recovery = 'Choose at least two different Tools; use search to find their canonical slugs.';
        return toolError(`Comparison requires at least two distinct Tools after resolving aliases (observed ${tools.length}).`, {code: 'invalid_input', suggestion: recovery, responseFormat: format, details: {observedCount: tools.length, recovery}});
      }
      const result = compareTools(tools, toolOrigins);
      const markdown = [
        '# Tool comparison',
        ...result.tools.flatMap((tool) => [
          `## ${escapeMarkdownText(tool.name)}`,
          escapeMarkdownText(tool.description),
          `Pricing: ${escapeMarkdownText(tool.pricing ?? 'Unknown')}`,
          ...renderComparisonDecisionFacts(tool).map(escapeMarkdownText),
          `Resource kind: ${escapeMarkdownText(tool.resourceKind)}`,
          `Platforms: ${escapeMarkdownText(tool.platforms.join(', ') || 'Unknown')}`,
          `Categories: ${escapeMarkdownText(tool.categories.join(', ') || 'Unknown')}`,
          `Use cases: ${escapeMarkdownText(tool.useCases.join(', ') || 'Unknown')}`,
          `Agent interfaces: ${escapeMarkdownText(tool.agentInterfaceKinds.join(', ') || 'Unknown')}`,
          ...tool.keyFeatures.map(escapeMarkdownText),
          ...tool.officialResources.map(
            (item) =>
              `Official resource: ${escapeMarkdownText(item.label)} — ${item.url}`,
          ),
          ...(tool.integrations?.map((item) =>
            escapeMarkdownText(`Integration: ${item.name} (${item.status})`),
          ) ?? ['Integrations: unknown']),
          ...(tool.securityPrivacyPosture?.securityCapabilities?.map((item) =>
            escapeMarkdownText(
              `Security capability: ${item.label} (${item.status})`,
            ),
          ) ?? ['Security capabilities: unknown']),
          `Product limits: ${tool.productLimits.state}`,
          ...tool.productLimits.groups.map((group) =>
            escapeMarkdownText(
              `${group.metric}. Plan: ${group.planScope ?? 'unknown'}; deployment: ${group.deploymentScope ?? 'unknown'}; ${group.facts.map((fact) => [fact.state, fact.comparator, fact.value, fact.unit].filter((part) => part !== undefined).join(' ')).join('; ')}${group.ambiguous ? ' (conflicting evidence)' : ''}`,
            ),
          ),
          `Runtime requirements: ${tool.runtimeRequirements.state}`,
          ...tool.runtimeRequirements.requirements.map((item) =>
            escapeMarkdownText(
              `${item.subjectName}: ${item.environmentRange} (${item.status}); Tool version scope: ${item.toolRange ?? 'unknown'}`,
            ),
          ),
          `Cite: ${tool.detailUrl}`,
        ]),
        '## Criteria',
        ...result.criteria.map(escapeMarkdownText),
        '## Missing data',
        ...result.gaps.map(escapeMarkdownText),
      ].join('\n\n');
      return formatToolResult(format, markdown, result);
    }
    const tool = tools[0];
    if (!tool) throw new Error('No resolved Tool.');
    if (request.kind === 'cite') {
      const result = getCitationResult(tool, toolOrigins.get(tool.slug));
      return formatToolResult(
        format,
        result.sources
          .map((source) => `${escapeMarkdownText(source.label)}: ${source.url}`)
          .join('\n'),
        result,
      );
    }
    const stackOutcome = stackRequest ? (await stackRequest)[0] : undefined;
    if (stackOutcome?.status === 'rejected') throw stackOutcome.reason;
    const stack = stackOutcome?.status === 'fulfilled'
      ? stackOutcome.value.data.stacks.find((item) => item.slug === request.params.stack) : undefined;
    if (request.params.stack && !stack)
      return toolError('Stack not found.', {
        code: 'not_found',
        suggestion: 'Use resources/list to choose a published stack.',
        responseFormat: format,
      });
    if (stack && !stack.tools.some((item) => item.tool?.slug === tool.slug))
      return toolError('The Tool is not part of this stack.', {
        code: 'invalid_input',
        suggestion: 'Choose a Tool in the stack or omit stack.',
        responseFormat: format,
      });
    const result = buildImplementationPlan(tool, stack, toolOrigins.get(tool.slug));
    const markdown = [
      `# Implementation plan for ${escapeMarkdownText(tool.name)}`,
      ...result.steps.flatMap((step) => [
        `## ${escapeMarkdownText(step.title)}`,
        escapeMarkdownText(step.detail),
        `Source: ${step.sourceUrl}`,
      ]),
      ...(result.quickstarts?.length
        ? [
            '## Quickstarts (copy only)',
            ...result.quickstarts.flatMap((item) => [
              escapeMarkdownText(
                `${item.label} (${item.kind}; ${item.status}${item.source ? `; source ${item.source}` : ''})`,
              ),
              ...(item.command ? [escapeMarkdownText(item.command)] : []),
              ...(item.docsUrl ? [`Source: ${item.docsUrl}`] : []),
              ...(item.notice ? [escapeMarkdownText(item.notice)] : []),
            ]),
          ]
        : []),
      ...result.caveats.map(escapeMarkdownText),
    ].join('\n\n');
    return formatToolResult(format, markdown, result);
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof AgentSearchContractError) {
      const { code, message, ...details } =
        serializeAgentSearchContractError(error);
      return toolError(message, {
        code,
        responseFormat: format,
        suggestion: error.recovery,
        details,
      });
    }
    return feedLoadError('loading agent workflow', error, format);
  }
};

export const registerAgentWorkflowTools = (
  server: McpServer,
  client: FeedClient,
  isAllowed: (name: string) => boolean,
): void => {
  if (isAllowed('slothhub_recommend_tools'))
    server.registerTool(
      'slothhub_recommend_tools',
      {
        title: 'Recommend Tools',
        description:
          'Rank public catalog Tools for requirements using the same grounded matching as slothhub recommend. Returns reasons, caveats, criteria and canonical citations. Read-only; no compatibility or installation is inferred.',
        inputSchema: recommendationInput,
        outputSchema: recommendationOutput,
        annotations,
      },
      (params, ctx) =>
        handleWorkflow(
          client,
          { kind: 'recommend', params },
          ctx.mcpReq.signal,
        ),
    );
  if (isAllowed('slothhub_compare_tools'))
    server.registerTool(
      'slothhub_compare_tools',
      {
        title: 'Compare Tools',
        description:
          'Compare public Tool facts for public slugs or canonical registry URLs. Missing data stays unknown. Equivalent to slothhub compare; does not create an editorial comparison.',
        inputSchema: comparisonInput,
        outputSchema: comparisonOutput,
        annotations,
      },
      (params, ctx) =>
        handleWorkflow(client, { kind: 'compare', params }, ctx.mcpReq.signal),
    );
};
