import { parseCatalogSnapshot} from '@slothhub/domain/public-feed-catalog';
import {bestFeed, categoriesFeed, indexFeed, searchIndexFeed, stacksFeed, tagsFeed, toolsFeed, useCasesFeed} from './fixtures.js';
import type {AgentCatalogSnapshot, CatalogMetadata, CatalogRow} from '@slothhub/domain/public-feed-catalog';

const metadata = {version: '20.0.0', siteUrl: indexFeed.siteUrl, generatedAt: '2026-09-22T00:00:00.000Z'};
export const catalogExportFeed: AgentCatalogSnapshot = parseCatalogSnapshot({
  ...metadata,
  schemaUrl: indexFeed.schemaUrl,
  snapshotUrl: indexFeed.snapshots.full,
  ndjsonUrl: indexFeed.snapshots.ndjson,
  data: {
    tools: toolsFeed.data.tools,
    searchIndex: searchIndexFeed.data,
    categories: categoriesFeed.data.categories,
    tags: tagsFeed.data.tags,
    useCases: useCasesFeed.data.useCases,
    stacks: stacksFeed.data.stacks,
    best: bestFeed.data.best,
  },
}, '/api/catalog.snapshot.json');
export const catalogMetadata: CatalogMetadata = {
  type: 'metadata', ...metadata, schemaUrl: indexFeed.schemaUrl,
  snapshotUrl: indexFeed.snapshots.full, ndjsonUrl: indexFeed.snapshots.ndjson,
};
export const catalogRows: CatalogRow[] = [
  ...catalogExportFeed.data.tools.map((data): CatalogRow => ({type: 'tool', data})),
  ...catalogExportFeed.data.categories.map((data): CatalogRow => ({type: 'category', data})),
  ...catalogExportFeed.data.tags.map((data): CatalogRow => ({type: 'tag', data})),
  ...catalogExportFeed.data.useCases.map((data): CatalogRow => ({type: 'useCase', data})),
  ...catalogExportFeed.data.stacks.map((data): CatalogRow => ({type: 'stack', data})),
  ...catalogExportFeed.data.best.map((data): CatalogRow => ({type: 'best', data})),
];
export const catalogNdjson = [catalogMetadata, ...catalogRows].map((row) => JSON.stringify(row)).join('\n') + '\n';
