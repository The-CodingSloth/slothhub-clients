import {getAgentSetupRecipeCopyHint, getAgentSetupRecipeHostLabel, resolvePublicAgentSetupRecipeEntries} from '@slothhub/domain/mcp-registry';
import {isRuntimeNumber} from '@slothhub/domain/runtime-validation';
import {resolveToolAgentSkills} from '@slothhub/domain/agent-skill-source';
import type { z } from 'zod';
import {CHARACTER_LIMIT} from '../constants.js';
import {SLUG_DISCOVERY} from '../resources/slugDiscovery.js';
import {getCachedToolLookupResolver} from '@slothhub/domain/tool-lookup';
import {searchPublicAgentCatalog} from '@slothhub/domain/agent-search';
import {describePublicToolFailure, resolvePublicTool} from './publicToolLookup.js'

import type {
  getBestListInputSchema,
  getAlternativesInputSchema,
  getComparisonInputSchema,
  getStackInputSchema,
  getToolInputSchema,
  getVisitUrlInputSchema,
  doctorInputSchema,
  listAgentSkillsInputSchema,
  listAlternativesInputSchema,
  listBestInputSchema,
  listCategoriesInputSchema,
  listComparisonsInputSchema,
  listMcpServersInputSchema,
  listStacksInputSchema,
  listTagsInputSchema,
  listUseCasesInputSchema} from '../schemas/inputs.js';
import { FeedRequestError } from '../services/feeds.js';
import type { FeedClient } from '../services/feeds.js';
import {
  matchesQueryText,
  paginateResults} from '../services/search.js';
import type {
  AgentAlternativesDetail,
  AgentCategoryFeedItem,
  AgentComparisonFacts,
  AgentComparisonPairItem,
  AgentCuratedListFeedItem,
  AgentToolStackFeedItem,
  PublicAgentInterface} from '../types.js';
import {buildDoctorResult} from './advertisedFeeds.js';
import {
  feedLoadError,
  formatToolResult,
  notFoundError,
  toolError,
  type ToolContentResult} from './format.js';
import {
  escapeMarkdownText,
  formatToolMarkdown,
  toMarkdownCodeBlock,
  toMarkdownInlineCode} from './markdown.js';
import {formatTaxonomyListResult, toTaxonomyListItem} from './taxonomyList.js';

type GetToolInput = z.infer<typeof getToolInputSchema>;
type GetStackInput = z.infer<typeof getStackInputSchema>;
type GetBestInput = z.infer<typeof getBestListInputSchema>;
type GetVisitInput = z.infer<typeof getVisitUrlInputSchema>;
type DoctorInput = z.infer<typeof doctorInputSchema>;
type ListMcpInput = z.infer<typeof listMcpServersInputSchema>;
type ListStacksInput = z.infer<typeof listStacksInputSchema>;
type ListBestInput = z.infer<typeof listBestInputSchema>;
type ListCategoriesInput = z.infer<typeof listCategoriesInputSchema>;
type ListAgentSkillsInput = z.infer<typeof listAgentSkillsInputSchema>;
type ListAlternativesInput = z.infer<typeof listAlternativesInputSchema>;
type GetAlternativesInput = z.infer<typeof getAlternativesInputSchema>;
type ListComparisonsInput = z.infer<typeof listComparisonsInputSchema>;
type GetComparisonInput = z.infer<typeof getComparisonInputSchema>;
type ListTagsInput = z.infer<typeof listTagsInputSchema>;
type ListUseCasesInput = z.infer<typeof listUseCasesInputSchema>;

const formatStackMarkdown = (stack: AgentToolStackFeedItem): string => {
  const lines = [
    `# ${stack.name}`,
    ...(stack.description ? [stack.description, ''] : ['']),
    `- Cite: ${stack.url}`,
    '',
    '## Tools',
    ...stack.tools.map((item) => {
      const toolName = item.tool?.name ?? 'Unlisted tool';
      return `- **${item.role}**: ${toolName}${item.description ? ` — ${item.description}` : ''}${item.tool?.detailUrl ? ` (${item.tool.detailUrl})` : ''}`;
    }),
  ];

  if (stack.recipe) {
    lines.push(
      '',
      `## ${escapeMarkdownText(stack.recipe.title)}`,
      '',
      'Guidance only — SlothHub does not run these examples.',
      ...(stack.recipe.summary ? ['', escapeMarkdownText(stack.recipe.summary)] : []),
      '',
      `- Reviewed: ${stack.recipe.reviewedAt}`,
    );
    for (const source of stack.recipe.sourceReferences ?? []) {
      lines.push(`- Source: ${escapeMarkdownText(source.title)} — ${source.url}`);
    }
    if (stack.recipe.prerequisites) {
      lines.push('', '### Prerequisites');
      for (const item of stack.recipe.prerequisites) {
        lines.push(`- ${escapeMarkdownText(item.label)}${item.description ? ` — ${escapeMarkdownText(item.description)}` : ''}`);
        for (const source of item.sourceReferences ?? []) {
          lines.push(`  - Source: ${escapeMarkdownText(source.title)} — ${source.url}`);
        }
      }
    }
    lines.push('', '### Steps');
    stack.recipe.steps.forEach((step, index) => {
      lines.push(
        `${index + 1}. **${escapeMarkdownText(step.title)}** (${step.kind})`,
        `   ${escapeMarkdownText(step.instruction)}`,
      );
      if (step.example) {
        const label = step.kind === 'command' ? 'Example command' : 'Example prompt';
        lines.push(
          `   ${label}:`,
          toMarkdownCodeBlock(step.example, step.kind === 'command' ? step.language ?? 'shell' : 'text'),
        );
      }
      if (step.expectedOutput) lines.push(`   Expected: ${escapeMarkdownText(step.expectedOutput)}`);
      if (step.relatedTool) {
        lines.push(`   Related Tool: ${escapeMarkdownText(step.relatedTool.name)} — ${step.relatedTool.detailUrl}`);
        for (const resource of step.relatedTool.resourceLinks ?? []) {
          lines.push(`   Resource: ${escapeMarkdownText(resource.label)} — ${resource.url}`);
        }
        for (const agentInterface of step.relatedTool.agentInterfaces ?? []) {
          if (agentInterface.docsUrl) {
            lines.push(`   Agent Interface: ${escapeMarkdownText(agentInterface.label)} — ${agentInterface.docsUrl}`);
          }
        }
      }
      for (const source of step.sourceReferences ?? []) {
        lines.push(`   Source: ${escapeMarkdownText(source.title)} — ${source.url}`);
      }
    });
    if (stack.recipe.limitations) {
      lines.push('', '### Limitations');
      for (const item of stack.recipe.limitations) {
        lines.push(`- ${escapeMarkdownText(item.label)}${item.description ? ` — ${escapeMarkdownText(item.description)}` : ''}`);
        for (const source of item.sourceReferences ?? []) {
          lines.push(`  - Source: ${escapeMarkdownText(source.title)} — ${source.url}`);
        }
      }
    }
  }

  return `${lines.join('\n')}\n`;
};

const formatBestMarkdown = (list: AgentCuratedListFeedItem): string => {
  const lines = [
    `# ${list.title}`,
    ...(list.intro ? [list.intro, ''] : ['']),
    `- Cite: ${list.url}`,
    '',
    '## Ranked tools',
    ...list.rankedTools.map((item) => {
      const toolName = item.tool?.name ?? 'Unlisted tool';
      return `#${item.rank} ${toolName} — ${item.editorialBlurb}${item.tool?.detailUrl ? ` (${item.tool.detailUrl})` : ''}`;
    }),
  ];

  return `${lines.join('\n')}\n`;
};

export {handleSearchTools} from './searchHandler.js';

export const handleGetTool = async (
  client: FeedClient,
  params: GetToolInput,
  signal?: AbortSignal,
  allowedTemplates?: ReadonlySet<string>,
): Promise<ToolContentResult> => {
  try {
    const resolution = await resolvePublicTool(
      client,
      {slug: params.slug, namespace: params.namespace},
      signal,
    );

    if (resolution.kind === 'resolved') {
      const markdown = formatToolMarkdown(resolution.tool);
      const display = markdown.length <= CHARACTER_LIMIT ? markdown
        : `Tool detail display limit exceeded: limit_characters=${CHARACTER_LIMIT}, observed_characters=${markdown.length}. Read the complete structuredContent.tool, or call fetch with the same slug as id and full_detail=true. No Tool facts were removed from the structured data.`;
      return formatToolResult(params.response_format, display, {
        tool: resolution.tool,
        ...(markdown.length > CHARACTER_LIMIT ? {displayLimit: {
          code: 'tool_detail_display_limit_exceeded' as const,
          configuredLimit: CHARACTER_LIMIT,
          observedCharacters: markdown.length,
          recovery: 'Read structuredContent.tool or request response_format=json with the same slug.',
        }} : undefined),
      }, [{kind: 'tool', slug: resolution.tool.slug, name: resolution.tool.name}], allowedTemplates);
    }

    const failure = describePublicToolFailure(resolution);
    return toolError(failure.message, {
      code: failure.code,
      suggestion: failure.recovery,
      responseFormat: params.response_format,
    });
  } catch (error) {
    return feedLoadError('loading tool', error, params.response_format);
  }
};

export const handleGetStack = async (
  client: FeedClient,
  params: GetStackInput,
  signal?: AbortSignal,
  allowedTemplates?: ReadonlySet<string>,
): Promise<ToolContentResult> => {
  try {
    const feed = await client.stacks(signal);
    const stack = feed.data.stacks.find((item) => item.slug === params.slug);

    if (!stack) {
      return notFoundError(
        'Stack',
        params.slug,
        SLUG_DISCOVERY.stack,
        params.response_format,
      );
    }

    return formatToolResult(
      params.response_format,
      formatStackMarkdown(stack),
      {
        stack,
      },
      [{kind: 'stack', slug: stack.slug, name: stack.name}],
      allowedTemplates,
    );
  } catch (error) {
    return feedLoadError('loading stack', error, params.response_format);
  }
};

export const handleGetBestList = async (
  client: FeedClient,
  params: GetBestInput,
  signal?: AbortSignal,
  allowedTemplates?: ReadonlySet<string>,
): Promise<ToolContentResult> => {
  try {
    const feed = await client.best(signal);
    const list = feed.data.best.find((item) => item.slug === params.slug);

    if (!list) {
      return notFoundError(
        'Best list',
        params.slug,
        SLUG_DISCOVERY.best,
        params.response_format,
      );
    }

    return formatToolResult(params.response_format, formatBestMarkdown(list), {
      best: list,
    }, [{kind: 'best', slug: list.slug, name: list.title}], allowedTemplates);
  } catch (error) {
    return feedLoadError('loading best list', error, params.response_format);
  }
};

export const handleGetVisitUrl = async (
  client: FeedClient,
  params: GetVisitInput,
  signal?: AbortSignal,
): Promise<ToolContentResult> => {
  try {
    let resolvedSlug = params.slug;
    let tool = await client.visitTool?.(params.slug, signal);
    const feed = tool ? undefined : await client.tools(signal);
    tool ??= feed?.data.tools.find((item) => item.slug === params.slug);
    if (!tool) {
      const artifact = await client.toolLookup(signal);
      if (!artifact) {
        return notFoundError(
          'Tool',
          params.slug,
          'Use search to find a valid slug.',
          params.response_format,
        );
      }
      const outcome = getCachedToolLookupResolver(artifact).resolve({
        namespace: 'slug',
        value: params.slug,
      });
      if (outcome.kind === 'resolved' || outcome.kind === 'aliased') resolvedSlug = outcome.tool.slug;
      else if (outcome.kind === 'invalid_input') {
        return toolError(outcome.message, {
          code: 'invalid_input',
          suggestion: 'Use a lowercase Sloth Hub Tool slug.',
          responseFormat: params.response_format,
        });
      } else if (outcome.kind !== 'capability_unavailable') {
        return notFoundError(
          'Tool',
          params.slug,
          'Use search to find a valid slug.',
          params.response_format,
        );
      }
      tool = feed?.data.tools.find((item) => item.slug === resolvedSlug);
    }

    if (!tool) {
      return notFoundError(
        'Tool',
        params.slug,
        'Use search to find a valid slug.',
        params.response_format,
      );
    }

    const structured = {
      slug: tool.slug,
      visitUrl: tool.visitUrl,
      detailUrl: tool.detailUrl,
      citationNote:
        'Cite detailUrl as the source. visitUrl is a tracked outbound visit action only.',
    };

    const markdown = [
      `# Visit URL for ${tool.name}`,
      '',
      `- Visit (tracked): ${tool.visitUrl}`,
      `- Cite instead: ${tool.detailUrl}`,
      '',
      'Do not cite `/go/` visit URLs as sources.',
    ].join('\n');

    return formatToolResult(params.response_format, markdown, structured);
  } catch (error) {
    return feedLoadError('loading visit URL', error, params.response_format);
  }
};

export const handleDoctor = async (
  client: FeedClient,
  params: DoctorInput,
  baseUrl: string,
  signal?: AbortSignal,
): Promise<ToolContentResult> => {
  try {
    const feed = await client.index(signal);
    return buildDoctorResult(feed, baseUrl, params.response_format);
  } catch (error) {
    return feedLoadError('running doctor', error, params.response_format, 'Check network access and SLOTHHUB_BASE_URL.');
  }
};

interface McpServerListing {
  name: string;
  slug: string;
  description: string;
  detailUrl: string;
  mcpRegistryUrl?: string;
  registryId?: string;
  agentInterfaces: PublicAgentInterface[];
}

const MCP_DETAIL_HYDRATION_CONCURRENCY = 4;

const mapWithConcurrency = async <T, U>(
  items: readonly T[],
  concurrency: number,
  transform: (item: T) => Promise<U>,
): Promise<U[]> => {
  const results = new Array<U>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await transform(items[index]!);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      () => worker(),
    ),
  );
  return results;
};

export const handleListMcpServers = async (
  client: FeedClient,
  params: ListMcpInput,
  signal?: AbortSignal,
  allowedTemplates?: ReadonlySet<string>,
): Promise<ToolContentResult> => {
  try {
    const searchFeed = await client.searchIndex(signal);
    const scored = searchPublicAgentCatalog(searchFeed.data.tools, {
      query: params.query,
      resourceKind: 'mcp_server',
    });

    const listings: McpServerListing[] = scored.map(({ tool }) => {
      return (() => {
               const agentInterfaces = new Array<PublicAgentInterface>();
               return {
                 name: tool.name, slug: tool.slug, description: tool.description, detailUrl: tool.detailUrl,
                 ...(tool.resourceIdentity.mcpRegistryUrl ? { mcpRegistryUrl: tool.resourceIdentity.mcpRegistryUrl } : undefined),
                 ...(tool.resourceIdentity.registryId ? { registryId: tool.resourceIdentity.registryId } : undefined),
                 agentInterfaces
               };
             })();
    });

    const page = paginateResults(listings, params.limit, params.offset);
    const hydratedListings = await mapWithConcurrency(
      page.items,
      MCP_DETAIL_HYDRATION_CONCURRENCY,
      async (listing) => {
        const detailFeed = await client.toolDetail(listing.slug, signal);
        return {
          ...listing,
          agentInterfaces: (detailFeed.data.agentInterfaces ?? []).filter(
            (entry) => entry.kind === 'mcp_server',
          ),
        };
      },
    );
    const structured = {
      query: params.query ?? '', total: page.total, count: page.count, offset: page.offset, has_more: page.has_more,
      ...(page.next_offset !== undefined ? { next_offset: page.next_offset } : undefined),
      mcp_servers: hydratedListings
    };

    const lines = [
      '# MCP servers in Sloth Hub',
      '',
      `Found ${page.total} listings (showing ${page.count}).`,
      '',
    ];

    for (const listing of hydratedListings) {
      lines.push(
        `## ${escapeMarkdownText(listing.name)} (\`${listing.slug}\`)`,
        escapeMarkdownText(listing.description),
      );
      if (listing.mcpRegistryUrl) {
        lines.push(`- MCP Registry: ${listing.mcpRegistryUrl}`);
      }
      if (listing.registryId) {
        lines.push(`- Registry ID: \`${listing.registryId}\``);
      }
      for (const agentInterface of listing.agentInterfaces) {
        if (agentInterface.installCommand) {
          lines.push(
            `- Install: ${toMarkdownInlineCode(agentInterface.installCommand)}`,
          );
        }
        if (agentInterface.docsUrl) {
          lines.push(`- Docs: ${agentInterface.docsUrl}`);
        }
        const readyHosts = resolvePublicAgentSetupRecipeEntries(agentInterface)
          .filter((recipe) => recipe.state === 'ready')
          .map(
            (recipe) =>
              `${getAgentSetupRecipeHostLabel(recipe.host)} (${getAgentSetupRecipeCopyHint(recipe.host)})`,
          );
        if (readyHosts.length) {
          lines.push(
            `- Setup recipes: ${readyHosts.join(', ')} — copy-only setup via fetch with full_detail=true`,
          );
        }
      }
      lines.push(`- Cite: ${listing.detailUrl}`, '');
    }

    return formatToolResult(
      params.response_format,
      lines.join('\n'),
      structured,
      hydratedListings.map((listing) => ({kind: 'tool' as const, slug: listing.slug, name: listing.name})),
      allowedTemplates,
    );
  } catch (error) {
    return feedLoadError('listing MCP servers', error, params.response_format);
  }
};

interface AgentSkillListing {
  name: string;
  slug: string;
  description: string;
  detailUrl: string;
  agentInterfaces: PublicAgentInterface[];
}

export const handleListAgentSkills = async (
  client: FeedClient,
  params: ListAgentSkillsInput,
  signal?: AbortSignal,
): Promise<ToolContentResult> => {
  try {
    const searchFeed = await client.searchIndex(signal);
    const scored = searchPublicAgentCatalog(searchFeed.data.tools, {
      query: params.query,
      resourceKind: 'agent_skill',
    });

    const listings: AgentSkillListing[] = scored.map(({ tool }) => ({
      name: tool.name,
      slug: tool.slug,
      description: tool.description,
      detailUrl: tool.detailUrl,
      agentInterfaces: [],
    }));

    const page = paginateResults(listings, params.limit, params.offset);
    const hydratedListings = await mapWithConcurrency(
      page.items,
      MCP_DETAIL_HYDRATION_CONCURRENCY,
      async (listing) => {
        const detailFeed = await client.toolDetail(listing.slug, signal);
        return {
          ...listing,
          agentInterfaces: resolveToolAgentSkills({
            ...detailFeed.data,
            resourceKind: 'agent_skill',
            sourceReferences: detailFeed.data.sourceReferences?.map((entry) => ({...entry, visibility: 'public'})),
          }, detailFeed.data.agentInterfaces),
        };
      },
    );
    const structured = {
      query: params.query ?? '', total: page.total, count: page.count, offset: page.offset, has_more: page.has_more,
      ...(page.next_offset !== undefined ? { next_offset: page.next_offset } : undefined),
      agent_skills: hydratedListings
    };

    const lines = [
      '# Agent skills in Sloth Hub',
      '',
      `Found ${page.total} listings (showing ${page.count}).`,
      '',
    ];

    for (const listing of hydratedListings) {
      lines.push(
        `## ${escapeMarkdownText(listing.name)} (\`${listing.slug}\`)`,
        escapeMarkdownText(listing.description),
      );
      for (const agentInterface of listing.agentInterfaces) {
        if (agentInterface.identifier) {
          lines.push(
            `- Skill: ${toMarkdownInlineCode(agentInterface.identifier)}`,
          );
        }
        if (agentInterface.installCommand) {
          lines.push(
            `- Install: ${toMarkdownInlineCode(agentInterface.installCommand)}`,
          );
        }
        if (agentInterface.docsUrl) {
          lines.push(`- Docs: ${agentInterface.docsUrl}`);
        }
      }
      lines.push(`- Cite: ${listing.detailUrl}`, '');
    }

    return formatToolResult(
      params.response_format,
      lines.join('\n'),
      structured,
    );
  } catch (error) {
    return feedLoadError('listing agent skills', error, params.response_format);
  }
};

const formatComparisonFactsMarkdown = (
  facts: AgentComparisonFacts | undefined,
): string[] => {
  if (!facts) return [];
  const lines: string[] = [];
  const list = (label: string, items?: string[]) => {
    if (items?.length) {
      lines.push(
        `- ${label}: ${items.map((item) => escapeMarkdownText(item)).join('; ')}`,
      );
    }
  };
  list('Best for', facts.bestFor);
  list('Not best for', facts.notBestFor);
  list('Strengths', facts.strengths);
  list('Limitations', facts.limitations);
  if (facts.pricingNotes) {
    lines.push(`- Pricing: ${escapeMarkdownText(facts.pricingNotes)}`);
  }
  if (facts.platformNotes) {
    lines.push(`- Platforms: ${escapeMarkdownText(facts.platformNotes)}`);
  }
  if (facts.migrationNotes) {
    lines.push(`- Migration: ${escapeMarkdownText(facts.migrationNotes)}`);
  }
  return lines;
};

export const handleListAlternatives = async (
  client: FeedClient,
  params: ListAlternativesInput,
  signal?: AbortSignal,
  allowedTemplates?: ReadonlySet<string>,
): Promise<ToolContentResult> => {
  try {
    const feed = await client.alternatives(signal);
    const matched = feed.data.sets.filter((set) =>
      matchesQueryText(params.query, [set.name, set.slug]),
    );
    const page = paginateResults(matched, params.limit, params.offset);
    const sets = page.items.map((set) => ({
      name: set.name,
      slug: set.slug,
      detailUrl: set.detailUrl,
      alternativesUrl: set.alternativesUrl,
      alternativeCount: set.alternativeCount,
      markdownUrl: set.markdownUrl,
      jsonUrl: set.jsonUrl,
    }));

    const structured = {
      query: params.query ?? '',
      total: page.total,
      count: page.count,
      offset: page.offset,
      has_more: page.has_more,
      ...(page.next_offset !== undefined
        ? { next_offset: page.next_offset }
        : undefined),
      alternatives: sets,
    };

    const lines = [
      '# Alternatives in Sloth Hub',
      '',
      `Found ${page.total} alternative sets (showing ${page.count}).`,
      '',
    ];

    for (const set of sets) {
      lines.push(
        `## ${escapeMarkdownText(set.name)} (\`${set.slug}\`)`,
        `- Alternatives: ${set.alternativeCount}`,
        `- Cite: ${set.alternativesUrl}`,
        '',
      );
    }

    return formatToolResult(
      params.response_format,
      lines.join('\n'),
      structured,
      sets.map((set) => ({kind: 'alternatives', slug: set.slug, name: set.name})),
      allowedTemplates,
    );
  } catch (error) {
    return feedLoadError('listing alternatives', error, params.response_format);
  }
};

export const handleGetAlternatives = async (
  client: FeedClient,
  params: GetAlternativesInput,
  signal?: AbortSignal,
  allowedTemplates?: ReadonlySet<string>,
): Promise<ToolContentResult> => {
  try {
    const feed = await client.alternativesDetail(params.slug, signal);
    const set: AgentAlternativesDetail = feed.data;

    const lines = [
      `# Alternatives to ${escapeMarkdownText(set.name)} (\`${set.slug}\`)`,
      '',
      ...(set.description ? [escapeMarkdownText(set.description), ''] : []),
      `- Source tool: ${escapeMarkdownText(set.sourceTool.name)} (\`${set.sourceTool.slug}\`)`,
      `- Cite: ${set.alternativesUrl}`,
      '',
      `## ${set.alternativeCount} alternative${set.alternativeCount === 1 ? '' : 's'}`,
    ];

    for (const alternative of set.alternatives) {
      lines.push(
        '',
        `### ${escapeMarkdownText(alternative.name)} (\`${alternative.slug}\`)`,
        '',
        escapeMarkdownText(alternative.description),
        ...formatComparisonFactsMarkdown(alternative.comparisonFacts),
        `- Cite: ${alternative.detailUrl}`,
      );
    }

    const facts = formatComparisonFactsMarkdown(set.comparisonFacts);
    if (facts.length) {
      lines.push('', '## Set-level comparison notes', '', ...facts);
    }

    return formatToolResult(
      params.response_format,
      `${lines.join('\n')}\n`,
      { alternatives: set },
      [{kind: 'alternatives', slug: set.slug, name: set.name}],
      allowedTemplates,
    );
  } catch (error) {
    if (
      error instanceof FeedRequestError &&
      (error.status === 404 || error.message.includes('does not authenticate'))
    ) {
      return notFoundError(
        'Alternatives set',
        params.slug,
        SLUG_DISCOVERY.alternatives,
        params.response_format,
      );
    }
    return feedLoadError('loading alternatives', error, params.response_format);
  }
};

export const handleListComparisons = async (
  client: FeedClient,
  params: ListComparisonsInput,
  signal?: AbortSignal,
  allowedTemplates?: ReadonlySet<string>,
): Promise<ToolContentResult> => {
  try {
    const feed = await client.comparisons(signal);
    const matched = feed.data.comparisons.filter((pair) =>
      matchesQueryText(params.query, [pair.title, pair.slug]),
    );
    const page = paginateResults(matched, params.limit, params.offset);
    const comparisons = page.items.map((pair) => ({
      slug: pair.slug,
      title: pair.title,
      description: pair.description,
      pageUrl: pair.pageUrl,
      jsonUrl: pair.jsonUrl,
      markdownUrl: pair.markdownUrl,
      primary: { name: pair.primary.name, slug: pair.primary.slug },
      secondary: { name: pair.secondary.name, slug: pair.secondary.slug },
    }));

    const structured = {
      query: params.query ?? '',
      total: page.total,
      count: page.count,
      offset: page.offset,
      has_more: page.has_more,
      ...(page.next_offset !== undefined
        ? { next_offset: page.next_offset }
        : undefined),
      comparisons,
    };

    const lines = [
      '# Comparisons in Sloth Hub',
      '',
      `Found ${page.total} comparisons (showing ${page.count}).`,
      '',
    ];

    for (const pair of comparisons) {
      lines.push(
        `## ${escapeMarkdownText(pair.title)} (\`${pair.slug}\`)`,
        `- Pair: ${escapeMarkdownText(pair.primary.name)} vs ${escapeMarkdownText(pair.secondary.name)}`,
        `- Cite: ${pair.pageUrl}`,
        '',
      );
    }

    return formatToolResult(
      params.response_format,
      lines.join('\n'),
      structured,
      comparisons.map((pair) => ({kind: 'compare', slug: pair.slug, name: pair.title})),
      allowedTemplates,
    );
  } catch (error) {
    return feedLoadError('listing comparisons', error, params.response_format);
  }
};

export const handleGetComparison = async (
  client: FeedClient,
  params: GetComparisonInput,
  signal?: AbortSignal,
  allowedTemplates?: ReadonlySet<string>,
): Promise<ToolContentResult> => {
  try {
    const feed = await client.comparisonDetail(params.slug, signal);
    const pair: AgentComparisonPairItem = feed.data;

    const lines = [
      `# ${escapeMarkdownText(pair.title)} (\`${pair.slug}\`)`,
      '',
      ...(pair.description ? [escapeMarkdownText(pair.description), ''] : []),
      `- Pair: ${escapeMarkdownText(pair.primary.name)} (\`${pair.primary.slug}\`) vs ${escapeMarkdownText(pair.secondary.name)} (\`${pair.secondary.slug}\`)`,
      `- Cite: ${pair.pageUrl}`,
    ];

    if (pair.featureRows && pair.featureRows.length > 0) {
      lines.push('', '## Feature rows', '');
      for (const row of pair.featureRows) {
        lines.push(
          `- ${escapeMarkdownText(row.label)}: ${escapeMarkdownText(row.primary)} | ${escapeMarkdownText(row.secondary)}`,
        );
      }
    }

    const primaryFacts = formatComparisonFactsMarkdown(pair.primaryComparisonFacts);
    if (primaryFacts.length) {
      lines.push(
        '',
        `## ${escapeMarkdownText(pair.primary.name)} comparison notes`,
        '',
        ...primaryFacts,
      );
    }
    const secondaryFacts = formatComparisonFactsMarkdown(pair.secondaryComparisonFacts);
    if (secondaryFacts.length) {
      lines.push(
        '',
        `## ${escapeMarkdownText(pair.secondary.name)} comparison notes`,
        '',
        ...secondaryFacts,
      );
    }

    if (pair.verdict) {
      lines.push('', '## Verdict', '', escapeMarkdownText(pair.verdict));
    }
    if (pair.reviewedAt) {
      lines.push('', `- Reviewed: ${escapeMarkdownText(pair.reviewedAt)}`);
    }
    if (pair.sourceReferences?.length) {
      lines.push('', '## Source references', '');
      for (const source of pair.sourceReferences) {
        lines.push(
          `- Source: ${escapeMarkdownText(source.title ?? source.publisher ?? 'reference')} — ${source.url}`,
        );
      }
    }

    return formatToolResult(
      params.response_format,
      `${lines.join('\n')}\n`,
      { comparison: pair },
      [{kind: 'compare', slug: pair.slug, name: pair.title}],
      allowedTemplates,
    );
  } catch (error) {
    if (
      error instanceof FeedRequestError &&
      (error.status === 404 || error.message.includes('does not authenticate'))
    ) {
      return notFoundError(
        'Comparison',
        params.slug,
        SLUG_DISCOVERY.compare,
        params.response_format,
      );
    }
    return feedLoadError('loading comparison', error, params.response_format);
  }
};

export const handleListStacks = async (
  client: FeedClient,
  params: ListStacksInput,
  signal?: AbortSignal,
  allowedTemplates?: ReadonlySet<string>,
): Promise<ToolContentResult> => {
  try {
    const feed = await client.stacks(signal);
    const matched = feed.data.stacks.filter((stack) =>
      matchesQueryText(params.query, [
        stack.name,
        stack.slug,
        stack.description,
      ]),
    );
    const page = paginateResults(matched, params.limit, params.offset);
    const stacks = page.items.map((stack) => ({
      name: stack.name, slug: stack.slug,
      ...(stack.description ? { description: stack.description } : undefined),
      url: stack.url, toolCount: stack.tools.length,
      ...(stack.recipe ? { recipeAvailable: true as const } : undefined),
    }));

    const structured = {
      query: params.query ?? '', total: page.total, count: page.count, offset: page.offset, has_more: page.has_more,
      ...(page.next_offset !== undefined ? { next_offset: page.next_offset } : undefined),
      stacks
    };

    const lines = [
      '# Tool stacks',
      '',
      `Found ${page.total} stacks (showing ${page.count}).`,
      '',
      ...stacks.flatMap((stack) => [
        `## ${stack.name} (\`${stack.slug}\`)`,
        ...(stack.description ? [stack.description] : []),
        `- Tools: ${stack.toolCount}`,
        ...(stack.recipeAvailable ? ['- Execution recipe available'] : []),
        `- Cite: ${stack.url}`,
        '',
      ]),
    ];

    if (page.has_more) {
      lines.push(`More results available. Use offset=${page.next_offset}.`);
    }

    return formatToolResult(
      params.response_format,
      lines.join('\n'),
      structured,
      stacks.map((stack) => ({kind: 'stack' as const, slug: stack.slug, name: stack.name})),
      allowedTemplates,
    );
  } catch (error) {
    return feedLoadError('listing stacks', error, params.response_format);
  }
};

export const handleListBest = async (
  client: FeedClient,
  params: ListBestInput,
  signal?: AbortSignal,
  allowedTemplates?: ReadonlySet<string>,
): Promise<ToolContentResult> => {
  try {
    const feed = await client.best(signal);
    const matched = feed.data.best.filter((list) =>
      matchesQueryText(params.query, [list.title, list.slug, list.intro]),
    );
    const page = paginateResults(matched, params.limit, params.offset);
    const best = page.items.map((list) => ({
      title: list.title, slug: list.slug,
      ...(list.intro ? { intro: list.intro } : undefined),
      url: list.url, rankedCount: list.rankedTools.length
    }));

    const structured = {
      query: params.query ?? '', total: page.total, count: page.count, offset: page.offset, has_more: page.has_more,
      ...(page.next_offset !== undefined ? { next_offset: page.next_offset } : undefined),
      best
    };

    const lines = [
      '# Best-of lists',
      '',
      `Found ${page.total} lists (showing ${page.count}).`,
      '',
      ...best.flatMap((list) => [
        `## ${list.title} (\`${list.slug}\`)`,
        ...(list.intro ? [list.intro] : []),
        `- Ranked tools: ${list.rankedCount}`,
        `- Cite: ${list.url}`,
        '',
      ]),
    ];

    if (page.has_more) {
      lines.push(`More results available. Use offset=${page.next_offset}.`);
    }

    return formatToolResult(
      params.response_format,
      lines.join('\n'),
      structured,
      best.map((list) => ({kind: 'best' as const, slug: list.slug, name: list.title})),
      allowedTemplates,
    );
  } catch (error) {
    return feedLoadError(
      'listing best-of lists',
      error,
      params.response_format,
    );
  }
};

export const handleListCategories = async (
  client: FeedClient,
  params: ListCategoriesInput,
  signal?: AbortSignal,
): Promise<ToolContentResult> => {
  try {
    const feed = await client.categories(signal);
    const matched = feed.data.categories.filter((category) =>
      matchesQueryText(params.query, [
        category.name,
        category.slug,
        category.description,
      ]),
    );
    const page = paginateResults(matched, params.limit, params.offset);

    const structured = {
      query: params.query ?? '', total: page.total, count: page.count, offset: page.offset, has_more: page.has_more,
      ...(page.next_offset !== undefined ? { next_offset: page.next_offset } : undefined),
      categories: page.items
    };

    const lines = [
      '# Categories',
      '',
      `Found ${page.total} categories (showing ${page.count}).`,
      '',
      ...page.items.flatMap((category: AgentCategoryFeedItem) => [
        `## ${category.name} (\`${category.slug}\`)`,
        ...(category.description ? [category.description] : []),
        ...(isRuntimeNumber(category.toolCount)
          ? [`- Tools: ${category.toolCount}`]
          : []),
        ...(category.parentCategory
          ? [
              `- Parent: ${category.parentCategory.name} (\`${category.parentCategory.slug}\`)`,
            ]
          : []),
        `- Cite: ${category.url}`,
        '',
      ]),
    ];

    if (page.has_more) {
      lines.push(`More results available. Use offset=${page.next_offset}.`);
    }

    return formatToolResult(
      params.response_format,
      lines.join('\n'),
      structured,
    );
  } catch (error) {
    return feedLoadError('listing categories', error, params.response_format);
  }
};

export const handleListTags = async (
  client: FeedClient,
  params: ListTagsInput,
  signal?: AbortSignal,
): Promise<ToolContentResult> => {
  try {
    const feed = await client.tags(signal);
    return formatTaxonomyListResult(
      params,
      feed.data.tags.map(toTaxonomyListItem),
      {
        heading: 'Tags',
        noun: 'tags',
        collection: (pageItems) => ({ tags: pageItems }),
      },
    );
  } catch (error) {
    return feedLoadError('listing tags', error, params.response_format);
  }
};

export const handleListUseCases = async (
  client: FeedClient,
  params: ListUseCasesInput,
  signal?: AbortSignal,
): Promise<ToolContentResult> => {
  try {
    const feed = await client.useCases(signal);
    return formatTaxonomyListResult(
      params,
      feed.data.useCases.map(toTaxonomyListItem),
      {
        heading: 'Use cases',
        noun: 'use cases',
        collection: (pageItems) => ({ useCases: pageItems }),
      },
    );
  } catch (error) {
    return feedLoadError('listing use cases', error, params.response_format);
  }
};
