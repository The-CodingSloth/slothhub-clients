import {AGENT_SEARCH_MAX_RESULT_LIMIT, AgentSearchContractError, searchPublicAgentArticles, searchPublicAgentCatalogWithRecovery, serializeAgentSearchContractError, validatePublicAgentSearchRequest} from '@slothhub/domain/agent-search'
import {getCachedToolLookupResolver, parseToolSearchIdentifier} from '@slothhub/domain/tool-lookup'
import type {AgentSearchRecovery, PublicAgentSearchArticleResult, PublicAgentSearchResult} from '@slothhub/domain/agent-search';
import type {RegistryHandoff} from '@slothhub/domain/registry-handoffs';
import type {z} from 'zod';

import type {searchToolsInputSchema} from '../schemas/inputs.js';
import type {searchToolsOutputSchema} from '../schemas/outputs.js';
import type {FeedClient} from '../services/feeds.js';
import type {AgentSearchIndexTool} from '../types.js';
import {paginateResults} from '../services/search.js';
import {escapeMarkdownText, toMarkdownInlineCode} from './markdownText.js';
import {
  feedLoadError,
  formatToolResult,
  toolError,
  type ToolContentResult,
} from './format.js';

type SearchInput = z.infer<typeof searchToolsInputSchema>;
type SearchOutput = z.infer<typeof searchToolsOutputSchema>;

type SearchFeedClient = Pick<FeedClient, 'searchIndex'> & {
  toolLookup?: FeedClient['toolLookup'];
};

const loadIdentifierLookupResolver = async (
  client: SearchFeedClient,
  query: string | undefined,
  signal?: AbortSignal,
) => {
  if (!client.toolLookup || parseToolSearchIdentifier(query).kind !== 'lookup') {
    return undefined;
  }
  try {
    const artifact = await client.toolLookup(signal);
    return artifact ? getCachedToolLookupResolver(artifact) : undefined;
  } catch (error) {
    if (signal?.aborted) throw error;
    return undefined;
  }
};

const formatSearchMarkdown = (
  query: string | undefined,
  page: ReturnType<typeof paginateResults<PublicAgentSearchResult<AgentSearchIndexTool>>>,
  articlePage: ReturnType<typeof paginateResults<PublicAgentSearchArticleResult>>,
  limit: number,
  recovery?: AgentSearchRecovery,
  handoffs: RegistryHandoff[] = [],
): string => {
  const lines = [
    `# Search results${query ? `: ${escapeMarkdownText(query)}` : ''}`,
    '',
    `Found ${page.total} tools (showing ${page.count} from offset ${page.offset}).`,
    '',
  ];
  if (recovery) lines.push(recovery.message, '', ...handoffs.map(({label, href}) => `- [${label}](${href})`), '');
  for (const {tool, score} of page.items) {
    lines.push(
      `## ${escapeMarkdownText(tool.name)} (${toMarkdownInlineCode(tool.slug)})`,
      escapeMarkdownText(tool.description),
      `- Pricing: ${escapeMarkdownText(tool.pricing ?? 'Not listed')}`,
      `- Platforms: ${escapeMarkdownText(tool.platforms.join(', ') || 'unknown')}`,
      `- Resource kind: ${escapeMarkdownText(tool.resourceKind.label)} (${toMarkdownInlineCode(tool.resourceKind.value)})`,
      ...(tool.supportedLanguages ?? []).map((fact) => `- Language: ${escapeMarkdownText(fact.name)} (${toMarkdownInlineCode(fact.id)})`),
      `- Cite: ${escapeMarkdownText(tool.detailUrl)}`,
      `- Score: ${score}`,
      '',
    );
  }
  if (page.has_more) lines.push(`More results available. Use offset=${page.next_offset}.`);
  if (articlePage.total > 0) {
    lines.push('', '## Articles', '',
      'Article matches use the query; Tool filters do not apply.',
      `Found ${articlePage.total} articles (showing ${articlePage.count} from offset ${articlePage.offset}; limit=${limit}, configured_limit=${AGENT_SEARCH_MAX_RESULT_LIMIT}).`, '');
    for (const article of articlePage.items) {
      lines.push(
        `### ${escapeMarkdownText(article.title)}`,
        ...(article.excerpt ? [escapeMarkdownText(article.excerpt)] : []),
        `- Cite: ${escapeMarkdownText(article.url)}`, '',
      );
    }
    if (articlePage.has_more) lines.push(`More articles available. Use offset=${articlePage.next_offset}.`);
  }
  return lines.join('\n');
};

export const toPublicSearchFilters = (params: SearchInput) => ({
  query: params.query,
  pricing: params.pricing,
  platform: params.platform,
  category: params.category,
  tag: params.tag,
  useCase: params.use_case,
  resourceKind: params.resource_kind,
  packageRegistry: params.package_registry,
  securityCapability: params.security_capability,
  agentInterfaceKind: params.agent_interface_kind,
  integration: params.integration,
  integrationConnection: params.integration_connection,
  agentHost: params.agent_host,
  sourceAvailability: params.source_availability,
  languages: params.languages,
  destinationHealth: params.destination_health,
  verified: params.verified,
  lastCheckedAfter: params.last_checked_after,
});

/** The Tool search's own outcome, before matching Articles suppress its recovery message. */
export interface ToolSearchOutcome {
  query: string;
  recoveryCode?: 'no_catalog_matches' | 'filters_excluded_matches';
}

export const handleSearchTools = async (
  client: SearchFeedClient,
  params: SearchInput,
  signal?: AbortSignal,
  allowedTemplates?: ReadonlySet<string>,
  onToolOutcome?: (outcome: ToolSearchOutcome) => void,
): Promise<ToolContentResult> => {
  try {
    const searchFilters = toPublicSearchFilters(params);
    validatePublicAgentSearchRequest({...searchFilters, limit: params.limit});
    const [feed, lookupResolver] = await Promise.all([
      client.searchIndex(signal),
      loadIdentifierLookupResolver(client, params.query, signal),
    ]);
    signal?.throwIfAborted();
    const capabilities = {
      supportedLanguagesAvailable: feed.data.filters.supportedLanguages !== undefined,
      agentInterfaceKindsAvailable: feed.data.filters.agentInterfaceKinds !== undefined,
      securityCapabilitiesAvailable: feed.data.filters.securityCapabilities !== undefined,
      integrationsAvailable: feed.data.filters.integrations !== undefined,
      sourceAvailabilityAvailable: feed.data.filters.sourceAvailability !== undefined,
      setupRecipeHosts: feed.data.filters.setupRecipeHosts?.map(({value}) => value),
      availableFilters: {
        categories: feed.data.filters.categories,
        tags: feed.data.filters.tags,
        useCases: feed.data.filters.useCases,
        integrations: feed.data.filters.integrations,
      },
    };
    const {results: scored, ...toolFeedback} = searchPublicAgentCatalogWithRecovery(
      feed.data.tools,
      searchFilters,
      capabilities,
      lookupResolver ? {lookupResolver} : undefined,
    );
    signal?.throwIfAborted();
    const outcome: ToolSearchOutcome = {query: params.query ?? ''};
    if (toolFeedback.recovery) outcome.recoveryCode = toolFeedback.recovery.code;
    onToolOutcome?.(outcome);
    const page = paginateResults(scored, params.limit, params.offset);
    const articlePage = paginateResults(
      searchPublicAgentArticles(feed.data.articles ?? [], params.query), params.limit, params.offset,
    );
    const {items: articles, ...articlePagination} = articlePage;
  const feedback = articlePage.total > 0 ? {} : toolFeedback;
    const structured: SearchOutput = {
      query: params.query ?? '', total: page.total, count: page.count, offset: page.offset, has_more: page.has_more,
      ...(page.next_offset !== undefined ? { next_offset: page.next_offset } : undefined),
      ...feedback,
      results: page.items.map(({ tool, score }) => ({
        name: tool.name,
        slug: tool.slug,
        description: tool.description,
        pricing: tool.pricing,
        platforms: tool.platforms,
        resourceKind: tool.resourceKind,
        agentInterfaceKinds: tool.agentInterfaceKinds ?? [],
        supportedLanguages: tool.supportedLanguages,
        detailUrl: tool.detailUrl,
        visitUrl: tool.visitUrl,
        score,
      })),
    };
    if (feed.data.articles !== undefined) {
      structured.articles = articles;
      structured.article_pagination = {...articlePagination, limit: params.limit, configured_limit: AGENT_SEARCH_MAX_RESULT_LIMIT};
    }

    return formatToolResult(
      params.response_format,
      () => formatSearchMarkdown(params.query, page, articlePage, params.limit, feedback.recovery, feedback.handoffs),
      structured,
      page.items.map(({tool}) => ({kind: 'tool' as const, slug: tool.slug, name: tool.name})),
      allowedTemplates,
    );
  } catch (error) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : error;
    if (error instanceof AgentSearchContractError) {
      const payload = serializeAgentSearchContractError(error);
      const {code, message, recovery, ...details} = payload;
      return toolError(message, {
        code,
        suggestion: recovery,
        responseFormat: params.response_format,
        details: {...details, recovery},
      });
    }
    return feedLoadError('searching tools', error, params.response_format);
  }
};
