import {AGENT_SEARCH_MAX_RESULT_LIMIT, AgentSearchContractError, serializeAgentSearchContractError, validatePublicAgentSearchRequest} from '@slothhub/domain/agent-search';

import {failForOutput, safeDiagnostic} from './cliOutput.js';
import type {CliResult} from './types.js';

export interface CatalogPaginationRequest {
  limit?: number;
  offset?: number;
  invalidLimit?: string;
  invalidOffset?: string;
}

export interface CatalogPagination {
  limit: number;
  offset: number;
}

export interface CatalogPage<TItem> {
  total: number;
  count: number;
  offset: number;
  hasMore: boolean;
  nextOffset?: number;
  items: TItem[];
}

// Receipt: MCP slothhub_list_categories defaults to 20 and shares the public
// search maximum of 50 (domain receipt 2026-08-12). Taxonomy and alternatives
// expose the same catalog-list contract so callers can reuse one paging model.
export const DEFAULT_CATALOG_PAGE_LIMIT = 20;
const HELP_RECOVERY = 'See --help for supported options.';

export class CatalogOffsetError extends Error {
  readonly code = 'invalid_input' as const;
  readonly recovery = `Use --offset with a whole number of 0 or more. ${HELP_RECOVERY}`;

  constructor(readonly observedValue: string | number) {
    super(`Offset must be a whole number of 0 or more (observed ${String(observedValue)}).`);
    this.name = 'CatalogOffsetError';
  }
}

export const resolveCatalogPagination = (
  request: CatalogPaginationRequest,
): CatalogPagination => {
  if (request.invalidLimit !== undefined) {
    throw new AgentSearchContractError(
      'agent_search_result_limit_out_of_range',
      `Search result limit must be between 1 and ${AGENT_SEARCH_MAX_RESULT_LIMIT} (observed ${request.invalidLimit}).`,
      `Use a whole-number result limit between 1 and ${AGENT_SEARCH_MAX_RESULT_LIMIT}. ${HELP_RECOVERY}`,
      request.invalidLimit,
      'limit',
      AGENT_SEARCH_MAX_RESULT_LIMIT,
    );
  }

  const limit = request.limit ?? DEFAULT_CATALOG_PAGE_LIMIT;
  try {
    validatePublicAgentSearchRequest({limit});
  } catch (error) {
    if (
      error instanceof AgentSearchContractError &&
      error.code === 'agent_search_result_limit_out_of_range'
    ) {
      throw new AgentSearchContractError(
        error.code,
        error.message,
        `${error.recovery} ${HELP_RECOVERY}`,
        error.observedValue,
        error.filter,
        error.configuredLimit,
      );
    }
    throw error;
  }

  if (request.invalidOffset !== undefined) {
    throw new CatalogOffsetError(request.invalidOffset);
  }
  const offset = request.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new CatalogOffsetError(offset);
  }
  return {limit, offset};
};

export const paginateCatalogItems = <TItem>(
  items: TItem[],
  limit: number,
  offset: number,
): CatalogPage<TItem> => {
  const pageItems = items.slice(offset, offset + limit);
  const hasMore = offset + pageItems.length < items.length;
  return {
    total: items.length,
    count: pageItems.length,
    offset,
    hasMore,
    ...(hasMore ? {nextOffset: offset + pageItems.length} : undefined),
    items: pageItems,
  };
};

export const catalogPaginationFailure = <ErrorValue>(
  error: ErrorValue,
  json: boolean,
): CliResult | undefined => {
  if (error instanceof AgentSearchContractError) {
    const payload = serializeAgentSearchContractError(error);
    return failForOutput(
      json,
      payload,
      `${safeDiagnostic(payload.code)}: ${safeDiagnostic(payload.message)} ${safeDiagnostic(payload.recovery)}\n`,
    );
  }
  if (error instanceof CatalogOffsetError) {
    const payload = {
      code: error.code,
      message: error.message,
      observedValue: error.observedValue,
      recovery: error.recovery,
    };
    return failForOutput(
      json,
      payload,
      `${safeDiagnostic(payload.message)} ${safeDiagnostic(payload.recovery)}\n`,
    );
  }
  return undefined;
};

export const appendCatalogContinuation = <TItem>(
  body: string,
  page: CatalogPage<TItem>,
): string => page.hasMore
  ? `${body}\nMore results available. Use --offset ${page.nextOffset}.\n`
  : body;
