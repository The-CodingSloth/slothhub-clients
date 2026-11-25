import {getAgentSetupRecipeHostLabel} from '@slothhub/domain/mcp-registry';
import {AGENT_SEARCH_MAX_RESULT_LIMIT, AgentSearchContractError, searchPublicAgentCatalogWithRecovery, searchPublicAgentArticles, validatePublicAgentSearchRequest, type PublicAgentSearchFilters, type PublicAgentSearchArticleResult} from '@slothhub/domain/agent-search';
import {createToolLookupResolver, parseToolSearchIdentifier} from '@slothhub/domain/tool-lookup';

import {recommendTools, type RecommendationResult} from './agentWorkflows.js';
import {formatArticleSearchResults, formatSearchResults, toSearchJsonHit, type CatalogSearchJsonHit} from './catalogFormat.js';
import {failForOutput, jsonLine, ok} from './cliOutput.js';
import {ListOffsetError, paginateListItems, resolveCliListPagination, type CliListPage} from './cliListPagination.js';
import {CLI_FLAG_SPECS} from './cliSpec.js';
import type {FeedClient} from './feedClient.js';
import type {AgentSearchIndexFeed, CliResult} from './types.js';

export interface AgentSearchCliRequest {
  filters: Omit<PublicAgentSearchFilters, 'query' | 'limit'>;
  json: boolean;
  limit?: number;
  invalidLimit?: string;
  offset?: number;
  invalidOffset?: string;
  query: string;
}

interface SearchCliOutput extends Partial<Omit<CliListPage<CatalogSearchJsonHit>, 'items' | 'count'>> {
  query: string;
  count: number;
  results: CatalogSearchJsonHit[];
  articles?: PublicAgentSearchArticleResult[];
  article_pagination?: Omit<CliListPage<PublicAgentSearchArticleResult>, 'items'> & {
    limit: number;
    configured_limit: number;
  };
}

const searchCapabilities = (feed: AgentSearchIndexFeed) => ({
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
});

const withCliCapabilityRecovery = <Result>(operation: () => Result): Result => {
  try {
    return operation();
  } catch (error) {
    if (error instanceof AgentSearchContractError && error.code === 'capability_unavailable') {
      const flag = CLI_FLAG_SPECS.find(
        (spec) => (spec.kind === 'filter' || spec.kind === 'language') && spec.target === error.filter,
      )?.names[0];
      if (flag) {
        throw new AgentSearchContractError(
          error.code,
          error.message,
          `Use a newer search feed or omit ${flag}.`,
          error.observedValue,
          error.filter,
        );
      }
    }
    throw error;
  }
};

const formatRecommendation = (result: RecommendationResult, requestedHost?: string): string => {
  if (!result.selected) {
    return [`No recommendation found for: ${result.requirements}`, ...result.caveats].join('\n') + '\n';
  }

  const hosts = result.selected.setupRecipeHosts ?? [];
  const selectedHost = hosts.find((host) => host === requestedHost?.toLowerCase());
  return [
    `Recommended: ${result.selected.name} (${result.selected.slug})`,
    result.selected.description,
    `Pricing: ${result.selected.pricing ?? 'Not listed'} | Platforms: ${result.selected.platforms.join(', ') || 'unknown'}`,
    hosts.length ? `Ready setup hosts: ${hosts.map(getAgentSetupRecipeHostLabel).join(', ')}` : 'No ready host recipe recorded.',
    ...(selectedHost ? [`Next: slothhub setup --host ${selectedHost} ${result.selected.slug}`] : []),
    'Reasons:',
    ...result.selected.reasons.map((reason) => `- ${reason}`),
    'Caveats:',
    ...[...result.selected.caveats, ...result.caveats].map((caveat) => `- ${caveat}`),
    `Source: ${result.selected.detailUrl}`,
  ].join('\n') + '\n';
};

export const validateAgentSearchCliRequest = (request: AgentSearchCliRequest): void => {
  if (request.invalidLimit !== undefined) {
    throw new AgentSearchContractError(
      'agent_search_result_limit_out_of_range',
      `Search result limit must be between 1 and ${AGENT_SEARCH_MAX_RESULT_LIMIT} (observed ${request.invalidLimit}).`,
      `Use a whole-number result limit between 1 and ${AGENT_SEARCH_MAX_RESULT_LIMIT}.`,
      request.invalidLimit,
      'limit',
      AGENT_SEARCH_MAX_RESULT_LIMIT,
    );
  }

  validatePublicAgentSearchRequest({
    ...request.filters,
    query: request.query,
    limit: request.limit,
  });
};

type SearchCliClient = Pick<FeedClient, 'searchIndex'> & {
  toolLookup?: FeedClient['toolLookup'];
};

const loadIdentifierLookupResolver = async (
  client: SearchCliClient,
  query: string,
) => {
  if (!client.toolLookup || parseToolSearchIdentifier(query).kind !== 'lookup') {
    return undefined;
  }
  try {
    const artifact = await client.toolLookup();
    return artifact ? createToolLookupResolver(artifact) : undefined;
  } catch {
    return undefined;
  }
};

export const runSearchCommand = async (
  client: SearchCliClient,
  request: AgentSearchCliRequest,
): Promise<CliResult> => {
  let pagination: {limit: number; offset: number};
  try {
    pagination = resolveCliListPagination({...request, limit: request.limit ?? AGENT_SEARCH_MAX_RESULT_LIMIT});
  } catch (error) {
    if (!(error instanceof ListOffsetError)) throw error;
    return failForOutput(request.json, {
      code: error.code, message: error.message, observedValue: error.observedValue, recovery: error.recovery,
    }, `${error.message} ${error.recovery}\n`);
  }
  const {limit, offset} = pagination;
  const [feed, lookupResolver] = await Promise.all([
    client.searchIndex(),
    loadIdentifierLookupResolver(client, request.query),
  ]);
  const {results, ...toolFeedback} = withCliCapabilityRecovery(() => searchPublicAgentCatalogWithRecovery(
    feed.data.tools,
    {...request.filters, query: request.query},
    searchCapabilities(feed),
    lookupResolver ? {lookupResolver} : undefined,
  ));
  // Keep the existing unbounded Tool default; Article pages reuse the measured
  // search cap. See upstream docs/measurements/search-index-articles-2026-09-14.md.
  const page = paginateListItems(results, request.limit ?? results.length, offset);
  const articlePage = paginateListItems(
    searchPublicAgentArticles(feed.data.articles ?? [], request.query), limit, offset,
  );
  const {items: articles, ...articlePagination} = articlePage;
  const feedback = articlePage.total > 0 ? {} : toolFeedback;
  const output: SearchCliOutput = {
    query: request.query,
    count: page.count,
    ...feedback,
    results: page.items.map(({tool, score}) => toSearchJsonHit(tool, score)),
  };
  // Preserve the established Tool-only JSON shape for older indexes unless
  // the caller explicitly opts into offset pagination.
  if (feed.data.articles !== undefined || request.offset !== undefined) {
    output.total = page.total;
    output.offset = page.offset;
    output.has_more = page.has_more;
    if (page.next_offset !== undefined) output.next_offset = page.next_offset;
  }
  if (feed.data.articles !== undefined) {
    output.articles = articles;
    output.article_pagination = {...articlePagination, limit, configured_limit: AGENT_SEARCH_MAX_RESULT_LIMIT};
  }

  return request.json
    ? ok(jsonLine(output))
    : ok([
        feedback.recovery
          ? [feedback.recovery.message, ...(feedback.handoffs ?? []).map(({label, href}) => `${label}: ${href}`)].join('\n') + '\n'
          : formatSearchResults(page.items),
        ...(page.has_more ? [`More Tools available. Use --offset ${page.next_offset}.\n`] : []),
        formatArticleSearchResults(articlePage, limit),
      ].join(''));
};

export const runRecommendCommand = async (
  client: Pick<FeedClient, 'searchIndex'>,
  request: AgentSearchCliRequest,
): Promise<CliResult> => {
  const feed = await client.searchIndex();
  const recommendation = withCliCapabilityRecovery(() => recommendTools(feed.data.tools, {
    siteUrl: feed.siteUrl,
    requirements: request.query,
    filters: request.filters,
    limit: request.limit,
    searchCapabilities: searchCapabilities(feed),
  }));

  return ok(request.json ? jsonLine(recommendation) : formatRecommendation(recommendation, request.filters.agentHost));
};
