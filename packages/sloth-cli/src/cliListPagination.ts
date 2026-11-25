import {AGENT_SEARCH_MAX_RESULT_LIMIT, AgentSearchContractError, validatePublicAgentSearchRequest} from '@slothhub/domain/agent-search';

export interface CliListPaginationRequest {
  limit?: number;
  offset?: number;
  invalidLimit?: string;
  invalidOffset?: string;
  query?: string;
}

export interface CliListPage<Item> {
  total: number;
  count: number;
  offset: number;
  has_more: boolean;
  next_offset?: number;
  items: Item[];
}

// Receipt: MCP list tools default to DEFAULT_SEARCH_LIMIT=20 and share
// AGENT_SEARCH_MAX_RESULT_LIMIT=50 with search (domain receipt 2026-08-12).
export const DEFAULT_LIST_PAGE_LIMIT = 20;
export const LIST_PAGINATION_HELP_RECOVERY = 'See --help for supported options.';

export class ListOffsetError extends Error {
  readonly code = 'invalid_input' as const;
  readonly recovery = `Use --offset with a whole number of 0 or more. ${LIST_PAGINATION_HELP_RECOVERY}`;
  readonly observedValue: string | number;

  constructor(observedValue: string | number) {
    super(`Offset must be a whole number of 0 or more (observed ${String(observedValue)}).`);
    this.name = 'ListOffsetError';
    this.observedValue = observedValue;
  }
}

export const resolveCliListPagination = (
  request: CliListPaginationRequest,
): {limit: number; offset: number} => {
  if (request.invalidLimit !== undefined) {
    throw new AgentSearchContractError(
      'agent_search_result_limit_out_of_range',
      `Search result limit must be between 1 and ${AGENT_SEARCH_MAX_RESULT_LIMIT} (observed ${request.invalidLimit}).`,
      `Use a whole-number result limit between 1 and ${AGENT_SEARCH_MAX_RESULT_LIMIT}. ${LIST_PAGINATION_HELP_RECOVERY}`,
      request.invalidLimit,
      'limit',
      AGENT_SEARCH_MAX_RESULT_LIMIT,
    );
  }

  const limit = request.limit ?? DEFAULT_LIST_PAGE_LIMIT;
  try {
    validatePublicAgentSearchRequest(
      request.query === undefined ? {limit} : {query: request.query, limit},
    );
  } catch (error) {
    if (error instanceof AgentSearchContractError && error.code === 'agent_search_result_limit_out_of_range') {
      throw new AgentSearchContractError(
        error.code,
        error.message,
        `${error.recovery} ${LIST_PAGINATION_HELP_RECOVERY}`,
        error.observedValue,
        error.filter,
        error.configuredLimit,
      );
    }
    throw error;
  }

  if (request.invalidOffset !== undefined) {
    throw new ListOffsetError(request.invalidOffset);
  }

  const offset = request.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new ListOffsetError(offset);
  }

  return {limit, offset};
};

export const paginateListItems = <Item>(
  items: readonly Item[],
  limit: number,
  offset: number,
): CliListPage<Item> => {
  const pageItems = items.slice(offset, offset + limit);
  const hasMore = offset + pageItems.length < items.length;
  return {
    total: items.length,
    count: pageItems.length,
    offset,
    has_more: hasMore,
    ...(hasMore ? {next_offset: offset + pageItems.length} : undefined),
    items: pageItems,
  };
};
