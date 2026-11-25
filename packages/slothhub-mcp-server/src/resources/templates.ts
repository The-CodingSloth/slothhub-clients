import {buildToolContentPolicyLabels} from '@slothhub/domain/catalog-content-policy';
import {
  ProtocolError,
  ProtocolErrorCode,
  ResourceNotFoundError,
  ResourceTemplate,
  type McpServer,
  type ReadResourceResult,
  type Resource,
  type Variables,
} from '@modelcontextprotocol/server';
import {AgentSearchPayloadLimitError} from '@slothhub/domain/agent-search';

import {
  FeedCapabilityUnavailableError,
  FeedRequestError,
  type FeedClient,
} from '../services/feeds.js';
import {
  describePublicToolFailure,
  resolvePublicTool,
} from '../tools/publicToolLookup.js';
import type {
  AgentAlternativesDetail,
  AgentComparisonPairItem,
  AgentCuratedListFeedItem,
  AgentToolDetail,
  AgentToolStackFeedItem,
} from '../types.js';
import {
  ALTERNATIVES_RESOURCE_TEMPLATE_URI,
  BEST_RESOURCE_TEMPLATE_NAME,
  BEST_RESOURCE_TEMPLATE_URI,
  catalogResourceUri,
  COMPARISON_RESOURCE_TEMPLATE_URI,
  isValidCatalogResourceSlug,
  STACK_RESOURCE_TEMPLATE_NAME,
  STACK_RESOURCE_TEMPLATE_URI,
  TOOL_RESOURCE_TEMPLATE_NAME,
  TOOL_RESOURCE_TEMPLATE_URI,
  toIsoLastModified,
  type CatalogResourceKind,
} from './catalogResourceUri.js';
import type {CatalogResourceErrorData} from './errors.js';
import type {CatalogResourceListingSource} from './pagination.js';
import {SLUG_DISCOVERY} from './slugDiscovery.js';

const JSON_MIME_TYPE = 'application/json';


const FEED_LIST_ERROR_LABEL = {
  stack: 'stacks',
  best: 'best',
} as const;

const readRequestedSlug = (variables: Variables): string | undefined => {
  const slug = variables.slug;
  return typeof slug === 'string' ? slug : undefined;
};

const requireCatalogSlug = (
  variables: Variables,
  kind: CatalogResourceKind,
): string => {
  const slug = readRequestedSlug(variables);
  if (slug && isValidCatalogResourceSlug(slug)) return slug;
  return rejectInvalidSlug(slug ?? '', kind);
};

const rejectInvalidSlug = (
  observedValue: string,
  kind: CatalogResourceKind,
): never => {
  const recovery =
    `Use a lowercase slug with letters, numbers, and hyphens. ${SLUG_DISCOVERY[kind]}`;
  throw new ProtocolError(
    ProtocolErrorCode.InvalidParams,
    `invalid_slug: observed_value=${observedValue} recovery=${recovery}`,
    {
      code: 'invalid_input',
      observedValue,
      recovery,
    } satisfies CatalogResourceErrorData,
  );
};

const rejectFeedFailure = (operation: string, error: Error): never => {
  if (error instanceof ProtocolError || error instanceof ResourceNotFoundError) {
    throw error;
  }
  if (error instanceof FeedCapabilityUnavailableError) {
    throw new ProtocolError(
      ProtocolErrorCode.InvalidParams,
      error.message,
      {
        code: 'capability_unavailable',
        recovery: error.recovery,
      } satisfies CatalogResourceErrorData,
    );
  }
  if (error instanceof AgentSearchPayloadLimitError) {
    throw new ProtocolError(ProtocolErrorCode.InternalError, error.message, {
      code: error.code,
      configuredLimitBytes: error.configuredLimitBytes,
      observedBytes: error.observedBytes,
      recovery: error.recovery,
    } satisfies CatalogResourceErrorData);
  }
  const recovery = 'Try slothhub_check_status to verify feed URLs, or set SLOTHHUB_BASE_URL.';
  throw new ProtocolError(
    ProtocolErrorCode.InternalError,
    `feed_load_error: ${operation}: ${error.message} recovery=${recovery}`,
    {
      code: 'feed_load_error',
      recovery,
    } satisfies CatalogResourceErrorData,
  );
};

type CatalogResourceContentsMeta = {
  title?: string;
  lastModified?: string;
};

const jsonResourceContents = (
  uri: string,
  title: string,
  payload: AgentToolDetail | AgentToolStackFeedItem | AgentCuratedListFeedItem | AgentComparisonPairItem | AgentAlternativesDetail,
  lastModified: string | undefined,
): ReadResourceResult => {
  // SDK 2.0 ResourceContents persist uri, mimeType, text, and _meta only.
  // title / lastModified therefore travel in _meta rather than annotations.
  const meta: CatalogResourceContentsMeta = {
    ...(title ? {title} : undefined),
    ...(lastModified ? {lastModified} : undefined),
  };
  return {
    contents: [
      {
        uri,
        mimeType: JSON_MIME_TYPE,
        text: JSON.stringify(payload),
        ...(meta.title || meta.lastModified ? {_meta: meta} : undefined),
      },
    ],
  };
};

const asError = <ErrorValue>(error: ErrorValue): Error =>
  error instanceof Error ? error : new Error('Feed request failed');

const isAbortFailure = <ErrorValue>(
  error: ErrorValue,
  signal?: AbortSignal,
): boolean => {
  if (signal?.aborted) return true;
  return error instanceof Error && error.name === 'AbortError';
};

const readToolResource = async (
  client: FeedClient,
  requestedUri: string,
  variables: Variables,
  signal?: AbortSignal,
): Promise<ReadResourceResult> => {
  const slug = requireCatalogSlug(variables, 'tool');
  try {
    const resolution = await resolvePublicTool(client, {slug}, signal);
    if (resolution.kind === 'resolved') {
      return jsonResourceContents(
        catalogResourceUri('tool', resolution.canonicalSlug),
        resolution.tool.name,
        {...buildToolContentPolicyLabels(new Set(Object.keys(resolution.tool))), ...resolution.tool},
        toIsoLastModified(resolution.generatedAt),
      );
    }

    const failure = describePublicToolFailure(resolution);
    switch (failure.code) {
      case 'not_found':
        throw new ResourceNotFoundError(requestedUri);
      case 'invalid_input':
        return rejectInvalidSlug(slug, 'tool');
      default:
        throw new ProtocolError(
          ProtocolErrorCode.InvalidParams,
          failure.message,
          {
            code: failure.code,
            recovery: failure.recovery,
          } satisfies CatalogResourceErrorData,
        );
    }
  } catch (error) {
    return rejectFeedFailure('loading tool', asError(error));
  }
};

const readEditorialResource = async (
  client: FeedClient,
  kind: 'compare' | 'alternatives',
  requestedUri: string,
  variables: Variables,
  signal?: AbortSignal,
): Promise<ReadResourceResult> => {
  const slug = requireCatalogSlug(variables, kind);
  try {
    const feed = kind === 'compare'
      ? await client.comparisonDetail(slug, signal)
      : await client.alternativesDetail(slug, signal);
    if (feed.data.slug !== slug) {
      throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'slug_mismatch: Detail does not match the requested resource.', {
        code: 'slug_mismatch',
        recovery: SLUG_DISCOVERY[kind],
      } satisfies CatalogResourceErrorData);
    }
    return jsonResourceContents(
      catalogResourceUri(kind, slug),
      'title' in feed.data ? feed.data.title : `Alternatives to ${feed.data.name}`,
      feed.data,
      toIsoLastModified(feed.generatedAt),
    );
  } catch (error) {
    if (error instanceof FeedRequestError &&
      (error.status === 404 || error.message.includes('does not authenticate'))) {
      throw new ResourceNotFoundError(requestedUri);
    }
    return rejectFeedFailure(`loading ${kind}`, asError(error));
  }
};

type CatalogCollectionItem = AgentToolStackFeedItem | AgentCuratedListFeedItem;

type CatalogCollectionDescriptor<Item extends CatalogCollectionItem> = {
  kind: 'stack' | 'best';
  operation: string;
  /**
   * Template metadata spread into every listed entry, mirroring the SDK's
   * high-level aggregate merge (`{...template.metadata, ...resource}`).
   */
  metadata: {
    title: string;
    description: string;
    mimeType: string;
  };
  load: (
    client: FeedClient,
    signal?: AbortSignal,
  ) => Promise<{items: readonly Item[]; generatedAt: string}>;
  titleOf: (item: Item) => string;
};

const STACK_COLLECTION: CatalogCollectionDescriptor<AgentToolStackFeedItem> = {
  kind: 'stack',
  operation: 'loading stack',
  metadata: {
    title: 'Sloth Hub stack',
    description:
      'Published Tool Stack JSON for one slug. resources/list pages through every published stack.',
    mimeType: JSON_MIME_TYPE,
  },
  load: async (client, signal) => {
    const feed = await client.stacks(signal);
    return {items: feed.data.stacks, generatedAt: feed.generatedAt};
  },
  titleOf: (item) => item.name,
};

const BEST_COLLECTION: CatalogCollectionDescriptor<AgentCuratedListFeedItem> = {
  kind: 'best',
  operation: 'loading best list',
  metadata: {
    title: 'Sloth Hub best-of list',
    description:
      'Editorial best-of list JSON for one slug. resources/list pages through every published list.',
    mimeType: JSON_MIME_TYPE,
  },
  load: async (client, signal) => {
    const feed = await client.best(signal);
    return {items: feed.data.best, generatedAt: feed.generatedAt};
  },
  titleOf: (item) => item.title,
};

const listCollectionEntries = async <Item extends CatalogCollectionItem>(
  client: FeedClient,
  collection: CatalogCollectionDescriptor<Item>,
  signal?: AbortSignal,
): Promise<Resource[]> => {
  try {
    const feed = await collection.load(client, signal);
    return feed.items.map((item) => {
      const lastModified = toIsoLastModified(
        item.publishedAt ?? feed.generatedAt,
      );
      return {
        ...collection.metadata,
        uri: catalogResourceUri(collection.kind, item.slug),
        name: collection.titleOf(item),
        ...(lastModified ? {annotations: {lastModified}} : undefined),
      };
    });
  } catch (error) {
    if (isAbortFailure(error, signal)) throw error;
    console.error(`feed_list_error: ${FEED_LIST_ERROR_LABEL[collection.kind]}`);
    // Feed errors can contain private URLs or invalid upstream content. Keep the
    // protocol failure bounded, and let the SDK reject the whole resource list.
    return rejectFeedFailure(
      'listing resources',
      error instanceof AgentSearchPayloadLimitError
        ? error
        : new Error('Collection feed unavailable. Retry resources/list.'),
    );
  }
};

const COMPARISON_LISTING_METADATA = {
  title: 'Sloth Hub comparison',
  description:
    'Published editorial comparison JSON for one pair slug. resources/list pages through every published comparison.',
  mimeType: JSON_MIME_TYPE,
};

/**
 * Comparison entries for the paginated resources/list, read from the same
 * /api/compare.json feed as the retired list tool. The index may omit the
 * comparisons feed (it is optional, unlike stacks and best), so an absent
 * feed lists no comparisons instead of failing the whole inventory.
 */
const listComparisonEntries = async (
  client: FeedClient,
  signal?: AbortSignal,
): Promise<Resource[]> => {
  try {
    const feed = await client.comparisons(signal);
    const lastModified = toIsoLastModified(feed.generatedAt);
    return feed.data.comparisons.map((pair) => ({
      ...COMPARISON_LISTING_METADATA,
      uri: catalogResourceUri('compare', pair.slug),
      name: pair.title,
      ...(lastModified ? {annotations: {lastModified}} : undefined),
    }));
  } catch (error) {
    if (isAbortFailure(error, signal)) throw error;
    if (error instanceof FeedCapabilityUnavailableError) return [];
    console.error('feed_list_error: comparisons');
    return rejectFeedFailure(
      'listing resources',
      error instanceof AgentSearchPayloadLimitError
        ? error
        : new Error('Collection feed unavailable. Retry resources/list.'),
    );
  }
};

const readCollectionResource = async <Item extends CatalogCollectionItem>(
  client: FeedClient,
  collection: CatalogCollectionDescriptor<Item>,
  requestedUri: string,
  variables: Variables,
  signal?: AbortSignal,
): Promise<ReadResourceResult> => {
  const slug = requireCatalogSlug(variables, collection.kind);
  try {
    const feed = await collection.load(client, signal);
    const item = feed.items.find((entry) => entry.slug === slug);
    if (!item) {
      throw new ResourceNotFoundError(requestedUri);
    }
    return jsonResourceContents(
      catalogResourceUri(collection.kind, item.slug),
      collection.titleOf(item),
      item,
      toIsoLastModified(item.publishedAt ?? feed.generatedAt),
    );
  } catch (error) {
    return rejectFeedFailure(collection.operation, asError(error));
  }
};

/**
 * Register the catalog URI templates and return the collections that
 * contribute to `resources/list`. Templates keep `list: undefined`: the SDK's
 * aggregate handler cannot express cursors, so
 * `installPaginatedResourcesList` owns the merged listing and callers must
 * install it for these sources to be listed.
 */
export const registerTemplateResources = (
  server: McpServer,
  client: FeedClient,
  allowedTemplates?: ReadonlySet<string>,
): CatalogResourceListingSource[] => {
  const isTemplateAllowed = (uri: string): boolean =>
    !allowedTemplates || allowedTemplates.has(uri);
  const listingSources: CatalogResourceListingSource[] = [];

  for (const resource of [
    {kind: 'compare', uri: COMPARISON_RESOURCE_TEMPLATE_URI, name: 'slothhub_comparison',
      title: COMPARISON_LISTING_METADATA.title, description: COMPARISON_LISTING_METADATA.description},
    {kind: 'alternatives', uri: ALTERNATIVES_RESOURCE_TEMPLATE_URI, name: 'slothhub_alternatives',
      title: 'Sloth Hub alternatives', description: `Published alternatives JSON for one source Tool slug; slothhub_get_alternatives returns the same set. ${SLUG_DISCOVERY.alternatives}`},
  ] as const) {
    if (!isTemplateAllowed(resource.uri)) continue;
    server.registerResource(
      resource.name,
      new ResourceTemplate(resource.uri, {list: undefined}),
      {title: resource.title, description: resource.description, mimeType: JSON_MIME_TYPE},
      async (uri, variables, ctx) =>
        readEditorialResource(client, resource.kind, uri.href, variables, ctx.mcpReq.signal),
    );
  }

  if (isTemplateAllowed(TOOL_RESOURCE_TEMPLATE_URI)) {
    // No list callback: enumerating ~1k Tools approaches the hosted 256 KiB
    // resources/list buffer. Discover Tools with search instead.
    server.registerResource(
      TOOL_RESOURCE_TEMPLATE_NAME,
      new ResourceTemplate(TOOL_RESOURCE_TEMPLATE_URI, {list: undefined}),
      {
        title: 'Sloth Hub tool',
        description:
          'Public Tool detail JSON for one catalog slug. Alias slugs return the canonical slothhub://tool/{slug} URI.',
        mimeType: JSON_MIME_TYPE,
      },
      async (uri, variables, ctx) =>
        readToolResource(client, uri.href, variables, ctx.mcpReq.signal),
    );
  }

  if (isTemplateAllowed(STACK_RESOURCE_TEMPLATE_URI)) {
    server.registerResource(
      STACK_RESOURCE_TEMPLATE_NAME,
      new ResourceTemplate(STACK_RESOURCE_TEMPLATE_URI, {list: undefined}),
      STACK_COLLECTION.metadata,
      async (uri, variables, ctx) =>
        readCollectionResource(
          client,
          STACK_COLLECTION,
          uri.href,
          variables,
          ctx.mcpReq.signal,
        ),
    );
    listingSources.push((signal) =>
      listCollectionEntries(client, STACK_COLLECTION, signal),
    );
  }

  if (isTemplateAllowed(BEST_RESOURCE_TEMPLATE_URI)) {
    server.registerResource(
      BEST_RESOURCE_TEMPLATE_NAME,
      new ResourceTemplate(BEST_RESOURCE_TEMPLATE_URI, {list: undefined}),
      BEST_COLLECTION.metadata,
      async (uri, variables, ctx) =>
        readCollectionResource(
          client,
          BEST_COLLECTION,
          uri.href,
          variables,
          ctx.mcpReq.signal,
        ),
    );
    listingSources.push((signal) =>
      listCollectionEntries(client, BEST_COLLECTION, signal),
    );
  }

  if (isTemplateAllowed(COMPARISON_RESOURCE_TEMPLATE_URI)) {
    listingSources.push((signal) => listComparisonEntries(client, signal));
  }

  return listingSources;
};
