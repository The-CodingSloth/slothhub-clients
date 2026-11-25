import {describe, expect, it} from 'vite-plus/test';

import {
  resourceKindFilterSchema,
  listBestInputSchema,
  listCategoriesInputSchema,
  listMcpServersInputSchema,
  listStacksInputSchema,
  listTagsInputSchema,
  listUseCasesInputSchema,
} from './inputs.js';

const catalogListSchemas = [
  ['MCP servers', listMcpServersInputSchema],
  ['Tool Stacks', listStacksInputSchema],
  ['best-of lists', listBestInputSchema],
  ['categories', listCategoriesInputSchema],
  ['tags', listTagsInputSchema],
  ['use cases', listUseCasesInputSchema],
] as const;

describe('catalog list query input', () => {
  it.each(catalogListSchemas)(
    'counts %s query limits in Unicode code points',
    (_name, schema) => {
      expect(schema.safeParse({query: '😀'.repeat(200)}).success).toBe(true);

      const result = schema.safeParse({query: '😀'.repeat(201)});
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues[0]?.message).toBe(
        'agent_search_query_too_long: configured_limit=200 observed_value=201 ' +
        'recovery=Shorten the query to at most 200 characters.',
      );
    },
  );
});

it.each(['dataset', 'specification'])('accepts %s as an MCP resource-kind filter', (kind) => {
  expect(resourceKindFilterSchema.parse(kind)).toBe(kind);
});
