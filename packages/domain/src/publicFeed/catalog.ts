import { catalogSnapshotVersionSchema } from '../feedCompatibility.js';
import { getPublicToolSummaryTemporalIssues } from '../publishedToolFeedSchemas.js';
import { z } from 'zod';
import {
  bestItemSchema,
  feedEnvelope,
  parseFeed,
  searchIndexDataSchema,
  stacksItemSchema,
  taxonomyListItemSchema,
  toolSummarySchema,
} from './schemas.js';
const snapshotLinksSchema = z.object({
  schemaUrl: z.url(),
  snapshotUrl: z.url(),
  ndjsonUrl: z.url(),
});
const catalogDataSchema = z.object({
  tools: z.array(toolSummarySchema),
  searchIndex: searchIndexDataSchema,
  categories: z.array(taxonomyListItemSchema),
  tags: z.array(taxonomyListItemSchema),
  useCases: z.array(taxonomyListItemSchema),
  stacks: z.array(stacksItemSchema),
  best: z.array(bestItemSchema),
});
const catalogSnapshotSchema = feedEnvelope(catalogDataSchema, catalogSnapshotVersionSchema).and(
  snapshotLinksSchema,
);

export const catalogMetadataSchema = snapshotLinksSchema.extend({
  type: z.literal('metadata'),
  version: catalogSnapshotVersionSchema,
  siteUrl: z.url(),
  generatedAt: z.iso.datetime({ offset: true }),
  catalogRevision: z.string().optional(),
});
export const catalogRowSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tool'), data: toolSummarySchema }),
  z.object({ type: z.literal('category'), data: taxonomyListItemSchema }),
  z.object({ type: z.literal('tag'), data: taxonomyListItemSchema }),
  z.object({ type: z.literal('useCase'), data: taxonomyListItemSchema }),
  z.object({ type: z.literal('stack'), data: stacksItemSchema }),
  z.object({ type: z.literal('best'), data: bestItemSchema }),
]);
export type AgentCatalogSnapshot = z.infer<typeof catalogSnapshotSchema>;
export type CatalogMetadata = z.infer<typeof catalogMetadataSchema>;
export type CatalogRow = z.infer<typeof catalogRowSchema>;

// Reuse the owner policy for dated Tool evidence in every export container.
const validateTools = (
  tools: Array<
    z.infer<typeof toolSummarySchema> | z.infer<typeof searchIndexDataSchema>['tools'][number]
  >,
  generatedAt: string,
): void => {
  for (const tool of tools) {
    if (getPublicToolSummaryTemporalIssues(tool, new Date(generatedAt)).length > 0) {
      throw new Error(
        'Catalog contains invalid dated Tool evidence. Refresh the catalog and retry.',
      );
    }
  }
};

export const validateCatalogRow = (
  row: CatalogRow,
  metadata: Pick<CatalogMetadata, 'generatedAt' | 'siteUrl'>,
): void => {
  const { generatedAt } = metadata;
  switch (row.type) {
    case 'tool':
      validateTools([row.data], generatedAt);
      break;
    case 'stack':
      validateTools(
        row.data.tools.flatMap(({ tool }) => (tool ? [tool] : [])),
        generatedAt,
      );
      break;
    case 'best':
      validateTools(
        row.data.rankedTools.flatMap(({ tool }) => (tool ? [tool] : [])),
        generatedAt,
      );
      break;
    default:
      break;
  }
};
export const parseCatalogSnapshot = <Payload>(
  payload: Payload,
  path: string,
): AgentCatalogSnapshot => {
  const feed = parseFeed(catalogSnapshotSchema, payload, path);
  validateTools([...feed.data.tools, ...feed.data.searchIndex.tools], feed.generatedAt);
  feed.data.stacks.forEach((data) => validateCatalogRow({ type: 'stack', data }, feed));
  feed.data.best.forEach((data) => validateCatalogRow({ type: 'best', data }, feed));
  return feed;
};
