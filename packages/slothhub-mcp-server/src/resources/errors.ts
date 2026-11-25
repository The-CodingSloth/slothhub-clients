import {
  ProtocolError,
  ProtocolErrorCode,
} from '@modelcontextprotocol/server';
import type {AgentSearchPayloadLimitError} from '@slothhub/domain/agent-search';

/** Structured `error.data` for catalog resource and resource-list failures. */
export type CatalogResourceErrorData = {
  code:
    | 'retired'
    | 'invalid_input'
    | 'invalid_cursor'
    | 'stale_cursor'
    | 'capability_unavailable'
    | 'feed_load_error'
    | 'ambiguous'
    | 'slug_mismatch';
  recovery: string;
  observedValue?: string | number;
} | Pick<AgentSearchPayloadLimitError,
  'code' | 'recovery' | 'configuredLimitBytes' | 'observedBytes'>;

/**
 * Reject a malformed, oversized, or foreign-version `resources/list` cursor
 * before any feed work: invalid params with a machine-readable code and the
 * recovery a client can act on.
 */
export const rejectInvalidCursor = (
  reason: string,
  observedValue?: string | number,
): never => {
  const recovery = 'Restart resources/list without a cursor.';
  throw new ProtocolError(
    ProtocolErrorCode.InvalidParams,
    `invalid_cursor: reason=${reason} recovery=${recovery}`,
    {
      code: 'invalid_cursor',
      ...(observedValue !== undefined ? {observedValue} : undefined),
      recovery,
    } satisfies CatalogResourceErrorData,
  );
};

/**
 * Reject a cursor whose snapshot no longer matches the current inventory: the
 * catalog changed mid-pagination, so continuing would skip or duplicate
 * entries. The client must restart iteration.
 */
export const rejectStaleCursor = (): never => {
  const recovery =
    'Restart resources/list without a cursor; the catalog changed while paging.';
  throw new ProtocolError(
    ProtocolErrorCode.InvalidParams,
    `stale_cursor: recovery=${recovery}`,
    {
      code: 'stale_cursor',
      recovery,
    } satisfies CatalogResourceErrorData,
  );
};
