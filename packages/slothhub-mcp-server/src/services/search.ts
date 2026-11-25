import {normalizePublicAgentSearchText, tokenizePublicAgentSearchText} from '@slothhub/domain/agent-search'

export const paginateResults = <T>(
  results: T[],
  limit: number,
  offset: number
) => {
  const total = results.length;
  const items = results.slice(offset, offset + limit);
  const has_more = offset + items.length < total;

  return {
    items, total, count: items.length, offset, has_more,
    ...(has_more ? { next_offset: offset + items.length } : undefined)
  };
};

/** Case-insensitive token match across one or more text fields. Empty query matches all. */
export const matchesQueryText = (
  query: string | undefined,
  fields: Array<string | undefined>
): boolean => {
  const queryTokens = tokenizePublicAgentSearchText(query);
  if (queryTokens.length === 0) {
    return true;
  }

  const haystack = normalizePublicAgentSearchText(fields.filter(Boolean).join(' '));
  return queryTokens.every((token) => haystack.includes(token));
};
