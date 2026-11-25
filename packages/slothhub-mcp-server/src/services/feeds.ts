import {parseFeed} from '../schemas/feedParser.js';
import {HUB_UNAVAILABLE_RECOVERY} from '../resources/slugDiscovery.js';
import {FeedHostBlockedError, fetchFeedResponse, readBoundedBytes} from '@slothhub/domain/public-feed-http';
import {assertLocalFeedTransportOrigin} from '@slothhub/domain/feed-origin';
import {assertSupportedFeedVersion, assertSupportedPublicFeedVersion, UnsupportedFeedVersionError} from '@slothhub/domain/feed-compatibility';
import {TOOL_LOOKUP_ARTIFACT_VERSION} from '@slothhub/domain/tool-lookup';
import {hasRuntimeObjectType, isRuntimeString} from '@slothhub/domain/runtime-validation';
import {filterCurrentToolDeals} from '@slothhub/domain/public-tool-deal';
import type {JsonValue} from '@slothhub/domain/json-value'
import {z} from 'zod';
import {
  FEED_CACHE_TTL_MS,
  FEED_FETCH_TIMEOUT_MS,
  MAX_FEED_RESPONSE_BYTES,
  MAX_MARKDOWN_ARTIFACT_RESPONSE_BYTES,
  resolveBaseUrl} from '../constants.js';
import {
  alternativesDetailFeedSchema,
  alternativesFeedSchema,
  bestFeedSchema,
  categoriesFeedSchema,
  comparisonDetailFeedSchema,
  comparisonsFeedSchema,
  indexFeedSchema,

  searchIndexFeedSchema,
  stacksFeedSchema,
  tagsFeedSchema,
  toolDetailFeedSchema,
  toolsFeedSchema,
  useCasesFeedSchema} from '@slothhub/domain/public-feed-mcp-schemas';
import {AgentSearchPayloadLimitError} from '@slothhub/domain/agent-search';
import {parseToolLookupArtifact, ToolLookupArtifactLimitError, type ToolLookupArtifact} from '@slothhub/domain/tool-lookup';
import type {
  AgentFeedPayload,
  AgentAlternativesDetailFeed,
  AgentAlternativesFeed,
  AgentCategoriesFeed,
  AgentComparisonDetailFeed,
  AgentComparisonsFeed,
  AgentCuratedListFeed,
  AgentIndexFeed,
  AgentSearchIndexFeed,
  AgentTagsFeed,
  AgentToolSummary,
  AgentToolDetailFeed,
  AgentToolStackFeed,
  AgentToolsFeed,
  AgentUseCasesFeed} from '../types.js';
import { computeContentHash, computeIndexContentHash } from '@slothhub/domain/public-feed-content-identity';

export interface FetchJsonOptions {
  signal?: AbortSignal;
}

export type FeedResponsePayload = JsonValue | AgentFeedPayload | ToolLookupArtifact;
const feedJsonSchema = z.json();

export type FetchJson = (
  url: string,
  options?: FetchJsonOptions,
) => Promise<FeedResponsePayload>;

export type FetchText = (
  url: string,
  options?: FetchJsonOptions,
) => Promise<string>;

const hashableFeedPayload = (payload: FeedResponsePayload, path: string): object => {
  if (!payload || !hasRuntimeObjectType(payload) || Array.isArray(payload)) {
    throw new Error(`Invalid feed shape for ${path}`);
  }
  return payload;
};

export class FeedRequestError extends Error {
  readonly path: string;
  readonly status?: number;

  constructor(path: string, url: string, message: string, options?: ErrorOptions) {
    super(`Unable to load ${url}: ${message}`, options);
    this.name = 'FeedRequestError';
    this.path = path;
    const status = /\bHTTP\s+(\d{3})\b/u.exec(message)?.[1];
    this.status = status ? Number(status) : undefined;
  }
}

export class FeedCapabilityUnavailableError extends Error {
  readonly name = 'FeedCapabilityUnavailableError';
  readonly code = 'capability_unavailable';
  readonly recovery: string;

  constructor(
    readonly capability: string,
    details: {
      reason: string;
      recovery: string;
    } = {
      reason: `${capability} is not advertised by this catalog`,
      recovery: 'Upgrade the catalog or browse its website.',
    },
  ) {
    super(
      `capability_unavailable: ${details.reason}. recovery=${details.recovery}`,
    );
    this.recovery = details.recovery;
  }
}

const FEED_TEXT_PAYLOAD_RECOVERY =
  'Retry after the catalog publishes a smaller Markdown artifact, or use search for discovery.';

export class FeedTextPayloadLimitError extends Error {
  readonly name = 'FeedTextPayloadLimitError';
  readonly code = 'feed_text_payload_too_large';
  readonly recovery = FEED_TEXT_PAYLOAD_RECOVERY;

  constructor(
    readonly path: string,
    readonly configuredLimitBytes: number,
    readonly observedBytes: number,
  ) {
    super(`feed_text_payload_too_large: path=${path} configured_limit_bytes=${configuredLimitBytes} observed_bytes=${observedBytes} recovery=${FEED_TEXT_PAYLOAD_RECOVERY}`);
  }
}

export interface FeedClientOptions {
  baseUrl?: string;
  noCache?: boolean;
  /** Override cache TTL in ms. Ignored when `noCache` is true. */
  cacheTtlMs?: number;
  /** Maximum settled feed entries retained by this client. */
  maxCacheEntries?: number;
  /** Override fetch timeout in ms. Defaults to FEED_FETCH_TIMEOUT_MS. */
  fetchTimeoutMs?: number;
  /** Maximum bytes accepted from a default HTTP feed fetch. */
  maxResponseBytes?: number;
  fetchJson?: FetchJson;
  fetchText?: FetchText;
  /** Maximum bytes accepted from the interfaces markdown artifact. */
  maxMarkdownArtifactResponseBytes?: number;
  /** Disable index-first synchronization only for offline fixtures and tests. */
  indexFirst?: boolean;
  /** Injectable clock for tests. */
  now?: () => number;
}

export interface FeedClient {
  index: (signal?: AbortSignal) => Promise<AgentIndexFeed>;
  toolLookup: (signal?: AbortSignal) => Promise<ToolLookupArtifact | null>;
  searchIndex: (signal?: AbortSignal) => Promise<AgentSearchIndexFeed>;
  tools: (signal?: AbortSignal) => Promise<AgentToolsFeed>;
  toolDetail: (
    slug: string,
    signal?: AbortSignal,
  ) => Promise<AgentToolDetailFeed>;
  /** Prefer an eligible collection cache or an index-authenticated individual Tool. */
  visitTool?: (slug: string, signal?: AbortSignal) => Promise<ToolVisitDetails | undefined>;
  stacks: (signal?: AbortSignal) => Promise<AgentToolStackFeed>;
  best: (signal?: AbortSignal) => Promise<AgentCuratedListFeed>;
  categories: (signal?: AbortSignal) => Promise<AgentCategoriesFeed>;
  tags: (signal?: AbortSignal) => Promise<AgentTagsFeed>;
  useCases: (signal?: AbortSignal) => Promise<AgentUseCasesFeed>;
  alternatives: (signal?: AbortSignal) => Promise<AgentAlternativesFeed>;
  alternativesDetail: (
    slug: string,
    signal?: AbortSignal,
  ) => Promise<AgentAlternativesDetailFeed>;
  comparisons: (signal?: AbortSignal) => Promise<AgentComparisonsFeed>;
  comparisonDetail: (
    slug: string,
    signal?: AbortSignal,
  ) => Promise<AgentComparisonDetailFeed>;
  stacksHubMarkdown?: (signal?: AbortSignal) => Promise<string>;
  bestHubMarkdown?: (signal?: AbortSignal) => Promise<string>;
  comparisonsHubMarkdown?: (signal?: AbortSignal) => Promise<string>;
  /** Read eligible cached suggestions without fetching. Injected clients may omit this capability. */
  completionCandidates?: () => CompletionCandidates;
}

export type ToolVisitDetails = Pick<AgentToolSummary, 'name' | 'slug' | 'visitUrl' | 'detailUrl'>;

export interface CompletionCandidate { name: string; slug: string; resourceKind?: string }
export interface CompletionCandidates {
  tools: readonly CompletionCandidate[];
  categories: readonly CompletionCandidate[];
  tags: readonly CompletionCandidate[];
  useCases: readonly CompletionCandidate[];
  stacks: readonly CompletionCandidate[];
  best: readonly CompletionCandidate[];
  comparisons: readonly CompletionCandidate[];
  alternatives: readonly CompletionCandidate[];
}


type CacheEntry = {
  expiresAt: number;
  promise: Promise<AgentFeedPayload | ToolLookupArtifact>;
  controller: AbortController;
  waiters: number;
  settled: boolean;
  abandon: () => void;
  value?: AgentFeedPayload | ToolLookupArtifact;
  contentHash?: string;
  catalogRevision?: string;
};

const DEFAULT_MAX_FEED_CACHE_ENTRIES = 64;

const abortReason = (signal: AbortSignal): Error =>
  signal.reason instanceof Error ? signal.reason : new Error('Request aborted');

const waitForCacheEntry = <T>(
  entry: CacheEntry,
  signal?: AbortSignal,
): Promise<T> => {
  signal?.throwIfAborted();
  entry.waiters += 1;

  return new Promise<T>((resolve, reject) => {
    let finished = false;
    const finish = (): boolean => {
      if (finished) return false;
      finished = true;
      signal?.removeEventListener('abort', onAbort);
      entry.waiters -= 1;
      if (entry.waiters === 0 && !entry.settled) {
        entry.abandon();
      }
      return true;
    };
    const onAbort = (): void => {
      if (finish()) reject(abortReason(signal!));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    // SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
    void (entry.promise as Promise<T>).then(
      (value) => {
        if (finish()) resolve(value);
      },
      (error) => {
        if (finish()) reject(error);
      },
    );
  });
};

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

const feedUrl = (baseUrl: string, path: string): string =>
  `${trimTrailingSlash(baseUrl)}${path.startsWith('/') ? path : `/${path}`}`;

const TOOL_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const toolDetailPath = (slug: string): string => {
  if (slug.length > 160 || !TOOL_SLUG_PATTERN.test(slug)) {
    throw new Error('Invalid Tool slug for detail feed');
  }

  return `/api/tools/${encodeURIComponent(slug)}.json`;
};

const alternativesDetailPath = (slug: string): string => {
  if (slug.length > 160 || !TOOL_SLUG_PATTERN.test(slug)) {
    throw new Error('Invalid alternatives slug for detail feed');
  }

  return `/api/alternatives/${encodeURIComponent(slug)}.json`;
};

const assertAlternativesCapability = (index: AgentIndexFeed): void => {
  if (!index.feeds.alternatives) {
    throw new FeedCapabilityUnavailableError('alternatives feed', {
      reason: 'this catalog does not advertise /api/alternatives.json',
      recovery: 'Upgrade the catalog or browse its public alternatives pages.',
    });
  }
};

const comparisonDetailPath = (slug: string): string => {
  if (slug.length > 160 || !TOOL_SLUG_PATTERN.test(slug)) {
    throw new Error('Invalid comparison slug for detail feed');
  }

  return `/api/compare/${encodeURIComponent(slug)}.json`;
};

const assertComparisonsCapability = (index: AgentIndexFeed): void => {
  if (!index.feeds.comparisons) {
    throw new FeedCapabilityUnavailableError('comparisons feed', {
      reason: 'this catalog does not advertise /api/compare.json',
      recovery: 'Upgrade the catalog or browse its public comparison pages.',
    });
  }
};

const readBoundedJson = async (
  response: Response,
  maxBytes: number,
): Promise<FeedResponsePayload> =>
  feedJsonSchema.parse(
    JSON.parse(
      new TextDecoder('utf-8', {fatal: true}).decode(
        await readBoundedBytes(response, maxBytes, (observedBytes) =>
          new AgentSearchPayloadLimitError(maxBytes, observedBytes),
        ),
      ),
    ),
  );

const readBoundedText = async (
  response: Response,
  maxBytes: number,
  path: string,
): Promise<string> => {
  return new TextDecoder('utf-8', {fatal: true}).decode(
    await readBoundedBytes(response, maxBytes, (observedBytes) =>
      new FeedTextPayloadLimitError(path, maxBytes, observedBytes),
    ),
  );
};

const createDefaultFetch = (timeoutMs: number, accept: string) =>
  <T>(url: string, options: FetchJsonOptions | undefined, read: (response: Response) => Promise<T>): Promise<T> =>
    fetchFeedResponse(url, options?.signal, {
      timeoutMs, accept, userAgent: 'slothhub-mcp-server', redirect: 'error',
      statusError: (status, text) => new Error(`HTTP ${status} ${text}`.trim()),
      timeoutError: () => new Error(`Request timed out after ${timeoutMs}ms`),
      abortError: (signal) => signal.reason instanceof Error ? signal.reason : new Error('Request aborted'),
    }, read);

const createDefaultFetchJson = (
  timeoutMs: number,
  maxResponseBytes: number,
): FetchJson => {
  const fetchResponse = createDefaultFetch(timeoutMs, 'application/json');
  return async (url, options) =>
    fetchResponse(url, options, (response) => readBoundedJson(response, maxResponseBytes));
};

const createDefaultFetchText = (
  timeoutMs: number,
  maxResponseBytes: number,
): FetchText => async (url, options) => {
  const fetchResponse = createDefaultFetch(
    timeoutMs,
    'text/markdown, text/plain;q=0.9',
  );
  return fetchResponse(url, options, async (response) => {
    const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (mediaType !== 'text/markdown' && mediaType !== 'text/plain') {
      await response.body?.cancel();
      throw new Error(`Unexpected markdown artifact content type: ${mediaType ?? 'missing'}`);
    }
    return readBoundedText(response, maxResponseBytes, new URL(url).pathname);
  });
};

export const createFeedClient = (
  options: FeedClientOptions = {},
): FeedClient => {
  const baseUrl = resolveBaseUrl(options.baseUrl);
  const fetchTimeoutMs = options.fetchTimeoutMs ?? FEED_FETCH_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? MAX_FEED_RESPONSE_BYTES;
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw new Error('maxResponseBytes must be a positive integer');
  }
  const fetchJson =
    options.fetchJson ??
    createDefaultFetchJson(fetchTimeoutMs, maxResponseBytes);
  const fetchText =
    options.fetchText ??
    createDefaultFetchText(
      fetchTimeoutMs,
      options.maxMarkdownArtifactResponseBytes ?? MAX_MARKDOWN_ARTIFACT_RESPONSE_BYTES,
    );
  const cacheTtlMs = options.cacheTtlMs ?? FEED_CACHE_TTL_MS;
  const maxCacheEntries =
    options.maxCacheEntries ?? DEFAULT_MAX_FEED_CACHE_ENTRIES;
  if (!Number.isInteger(maxCacheEntries) || maxCacheEntries < 1) {
    throw new Error('maxCacheEntries must be a positive integer');
  }
  const now = options.now ?? Date.now;
  // Active fills belong to their waiters, not the retention budget or TTL for
  // validated values. Bursts must still share downloads after that budget fills.
  const pending = new Map<string, CacheEntry>();
  const cache = new Map<string, CacheEntry>();
  const cachedFeed = (path: string): AgentFeedPayload | ToolLookupArtifact | undefined => {
    if (options.noCache) return undefined;
    const entry = cache.get(feedUrl(baseUrl, path));
    if (!entry || !entry.settled || entry.expiresAt <= now() || !entry.value) return undefined;
    if (options.indexFirst !== false) {
      const index = cache.get(feedUrl(baseUrl, '/api/index.json'));
      if (!index?.settled || index.expiresAt <= now() || !index.value || !('feeds' in index.value)) return undefined;
      const hash = index.value.contentHashes?.[path];
      if (index.value.contentHashes && (!hash || hash !== entry.contentHash)) return undefined;
      if (index.value.catalogRevision && index.value.catalogRevision !== entry.catalogRevision) return undefined;
    }
    return entry.value;
  };
  const completionCandidates = (): CompletionCandidates => {
    const toolFeeds = [cachedFeed('/api/search-index.json'), cachedFeed('/api/tools.json')];
    const categories = cachedFeed('/api/categories.json');
    const tags = cachedFeed('/api/tags.json');
    const useCases = cachedFeed('/api/use-cases.json');
    const stacks = cachedFeed('/api/stacks.json');
    const best = cachedFeed('/api/best.json');
    const comparisons = cachedFeed('/api/compare.json');
    const alternatives = cachedFeed('/api/alternatives.json');
    return {
      tools: toolFeeds.flatMap((feed) => feed && 'data' in feed && 'tools' in feed.data
        ? feed.data.tools.map(({name, slug, resourceKind}) => ({name, slug, resourceKind: resourceKind?.value})) : []),
      categories: categories && 'data' in categories && 'categories' in categories.data ? categories.data.categories : [],
      tags: tags && 'data' in tags && 'tags' in tags.data ? tags.data.tags : [],
      useCases: useCases && 'data' in useCases && 'useCases' in useCases.data ? useCases.data.useCases : [],
      stacks: stacks && 'data' in stacks && 'stacks' in stacks.data ? stacks.data.stacks : [],
      best: best && 'data' in best && 'best' in best.data ? best.data.best.map(({title, slug}) => ({name: title, slug})) : [],
      comparisons: comparisons && 'data' in comparisons && 'comparisons' in comparisons.data ? comparisons.data.comparisons.map(({title, slug}) => ({name: title, slug})) : [],
      alternatives: alternatives && 'data' in alternatives && 'sets' in alternatives.data ? alternatives.data.sets : [],
    };
  };
  const getCached = (url: string, currentTime: number): CacheEntry | undefined => {
    const entry = cache.get(url);
    if (entry && entry.expiresAt > currentTime) {
      cache.delete(url);
      cache.set(url, entry);
    }
    return entry;
  };
  const setCached = (
    url: string,
    entry: CacheEntry,
  ): void => {
    // Retain bounded stale values so a fresh authenticated index can validate
    // unchanged leaves. Active fills are tracked separately until validation.
    cache.delete(url);
    while (cache.size >= maxCacheEntries) {
      const evictableUrl = cache.keys().next().value;
      if (!evictableUrl) return;
      cache.delete(evictableUrl);
    }
    cache.set(url, entry);
  };

  const readIdentity = (payload: FeedResponsePayload) => {
    if (!payload || !hasRuntimeObjectType(payload) || Array.isArray(payload)) {
      return {};
    }
    return {
      contentHash:
        'contentHash' in payload && isRuntimeString(payload.contentHash)
          ? payload.contentHash
          : undefined,
      catalogRevision:
        'catalogRevision' in payload && isRuntimeString(payload.catalogRevision)
          ? payload.catalogRevision
          : undefined,
    };
  };

  const loadDirect = async <TFeed extends AgentFeedPayload | ToolLookupArtifact>(
    path: string,
    parse: (payload: FeedResponsePayload) => TFeed,
    expected?: {
      contentHash?: string;
      catalogRevision?: string;
      embeddedContentHash?: boolean;
      sourceIndex?: AgentIndexFeed;
    },
    signal?: AbortSignal,
  ): Promise<TFeed> => {
    signal?.throwIfAborted();
    const url = feedUrl(baseUrl, path);
    const currentTime = now();

    if (!options.noCache) {
      const active = pending.get(url);
      if (active && active.contentHash === expected?.contentHash &&
          active.catalogRevision === expected?.catalogRevision) {
        return waitForCacheEntry<TFeed>(active, signal);
      }
      const cached = getCached(url, currentTime);
      if (cached) {
        const hashMatches =
          !expected?.contentHash || cached.contentHash === expected.contentHash;
        const revisionMatches = !expected?.catalogRevision ||
          cached.catalogRevision === expected.catalogRevision;
        // A fresh authenticated index can renew an unchanged, validated leaf,
        // including lookup artifacts that do not embed a catalog revision.
        const authenticatedValue = expected?.contentHash && cached.settled && cached.value;
        if (hashMatches && revisionMatches && (cached.expiresAt > currentTime || authenticatedValue)) {
          if (authenticatedValue) {
            cached.expiresAt = currentTime + cacheTtlMs;
            setCached(url, cached);
          }
          return waitForCacheEntry<TFeed>(cached, signal);
        }
        cache.delete(url);
      }
    }

    const controller = new AbortController();
    let entry: CacheEntry;
    const fetchSignal = options.noCache ? signal : controller.signal;
    const request = (
      fetchSignal ? fetchJson(url, { signal: fetchSignal }) : fetchJson(url)
    )
      .then((payload) => {
        fetchSignal?.throwIfAborted();
        // Tool lookup has its own independent artifact contract.
        if (path !== '/api/tool-lookup.json') {
          assertSupportedPublicFeedVersion(payload, path);
        }
        const parsed = parse(payload);
        if ('siteUrl' in parsed) assertLocalFeedTransportOrigin(parsed.siteUrl, url);
        const identity = readIdentity(parsed);
        const hashMismatch = expected?.contentHash &&
          ((expected.embeddedContentHash !== false && identity.contentHash !== expected.contentHash) ||
            computeContentHash(hashableFeedPayload(payload, path)) !== expected.contentHash);
        const revisionMismatch = expected?.catalogRevision &&
          identity.catalogRevision !== expected.catalogRevision;
        if (hashMismatch || revisionMismatch) {
          // A later request must reload this index, but a late failure from an
          // older request must not evict a newer index already in the cache.
          const indexUrl = feedUrl(baseUrl, '/api/index.json');
          if (expected?.sourceIndex && cache.get(indexUrl)?.value === expected.sourceIndex) {
            cache.delete(indexUrl);
          }
          throw new Error(
            `Feed ${hashMismatch ? 'content hash' : 'catalog revision'} does not match the index for ${path}`,
          );
        }
        entry.value = parsed;
        entry.contentHash = expected?.contentHash ?? identity.contentHash;
        entry.catalogRevision = identity.catalogRevision;
        entry.expiresAt = now() + cacheTtlMs;
        return parsed;
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (cache.get(url) === entry) cache.delete(url);
        if (
          error instanceof AgentSearchPayloadLimitError ||
          error instanceof ToolLookupArtifactLimitError ||
          error instanceof UnsupportedFeedVersionError ||
          error instanceof FeedHostBlockedError
        ) throw error;
        throw new FeedRequestError(path, url, message, {cause: error});
      })
      .finally(() => {
        entry.settled = true;
        if (pending.get(url) === entry) {
          pending.delete(url);
          if (entry.value && !controller.signal.aborted) setCached(url, entry);
        }
      });

    entry = {
      expiresAt: currentTime + cacheTtlMs,
      // Pending readers must match the same expected cohort to share a fill.
      // The value is published only after its hash and revision are validated.
      contentHash: expected?.contentHash,
      catalogRevision: expected?.catalogRevision,
      promise: request,
      controller,
      waiters: 0,
      settled: false,
      abandon: () => {
        if (entry.settled) return;
        entry.settled = true;
        if (pending.get(url) === entry) pending.delete(url);
        controller.abort(new Error('All feed waiters cancelled'));
      },
    };
    if (!options.noCache) {
      pending.set(url, entry);
    }

    return options.noCache ? request : waitForCacheEntry<TFeed>(entry, signal);
  };

  const loadIndex = (signal?: AbortSignal): Promise<AgentIndexFeed> => loadDirect(
    '/api/index.json',
    (payload) => {
      const index = parseFeed(indexFeedSchema, payload, 'index');
      // Authenticate before loadDirect publishes the parsed value to its cache.
      // Its failure handler evicts only this request's entry, preserving newer loads.
      if ((index.contentHash || index.contentHashes) && (
        !index.contentHash ||
        !index.contentHashes?.['/api/index.json'] ||
        index.contentHashes['/api/index.json'] !== index.contentHash ||
        computeIndexContentHash(payload) !== index.contentHash
      )) {
        throw new Error('Public feed index content hash is invalid');
      }
      return index;
    },
    undefined,
    signal,
  );

  const loadLeaf = async <TFeed extends AgentFeedPayload>(
    path: string,
    parse: (payload: FeedResponsePayload) => TFeed,
    signal?: AbortSignal,
  ): Promise<TFeed> => {
    signal?.throwIfAborted();
    if (options.indexFirst === false)
      return loadDirect(path, parse, undefined, signal);
    const expectedLeaf = (index: AgentIndexFeed): string | undefined => {
      const expectedHash = index.contentHashes?.[path];
      if (index.contentHashes && !expectedHash) {
        throw new FeedRequestError(
          path,
          feedUrl(baseUrl, path),
          `Public feed index does not authenticate ${path}`,
        );
      }
      return expectedHash;
    };
    const index = await loadIndex(signal);
    const expectedHash = expectedLeaf(index);
    return loadDirect(
      path,
      parse,
      {
        contentHash: expectedHash,
        catalogRevision: index.catalogRevision,
        sourceIndex: index,
      },
      signal,
    );
  };

  // Markdown hub artifacts share one contract: the index must advertise the
  // fixed same-origin path under its registry key before any fetch happens.
  const markdownArtifact =
    (
      path: string,
      indexKey: keyof AgentIndexFeed['markdownArtifacts'],
      artifactLabel: string,
      unavailableRecovery: string,
    ) =>
    async (signal?: AbortSignal): Promise<string> => {
      const index = await loadIndex(signal);
      const advertisedUrl = index.markdownArtifacts[indexKey];
      if (!advertisedUrl) {
        throw new FeedCapabilityUnavailableError(artifactLabel, {
          reason: `this catalog does not advertise markdownArtifacts.${indexKey}`,
          recovery: unavailableRecovery,
        });
      }
      const expectedUrl = feedUrl(baseUrl, path);
      if (advertisedUrl !== expectedUrl) {
        throw new FeedRequestError(
          path,
          expectedUrl,
          `Public feed index must advertise the fixed same-origin URL ${expectedUrl}`,
        );
      }
      return fetchText(expectedUrl, {signal});
    };

  const loadTools = (signal?: AbortSignal): Promise<AgentToolsFeed> => loadLeaf(
    '/api/tools.json',
    (payload) => parseFeed(toolsFeedSchema, payload, 'tools'),
    signal,
  );

  return {
    completionCandidates,
    index: loadIndex,
    visitTool: async (slug, signal) => {
      // Legacy/offline and no-cache reads retain their original collection
      // path, including one index lookup per request when caching is disabled.
      if (options.noCache || options.indexFirst === false || slug.length > 160 || !TOOL_SLUG_PATTERN.test(slug)) return undefined;
      const index = await loadIndex(signal);
      const collection = cache.get(feedUrl(baseUrl, '/api/tools.json'));
      const collectionHash = index.contentHashes?.['/api/tools.json'];
      if (
        collection?.settled && collection.value &&
        (!index.contentHashes || (collectionHash && collection.contentHash === collectionHash)) &&
        (!index.catalogRevision || collection.catalogRevision === index.catalogRevision) &&
        'data' in collection.value && 'tools' in collection.value.data &&
        collection.value.data.tools.some((tool) => tool.slug === slug)
      ) {
        // The existing loader renews unchanged authenticated stale values and
        // enforces expiry for legacy indexes; this check never extends a TTL.
        return (await loadTools(signal)).data.tools.find((tool) => tool.slug === slug);
      }

      const path = toolDetailPath(slug);
      const contentHash = index.contentHashes?.[path];
      if (!contentHash) return undefined;
      const detail = await loadDirect(
        path,
        (payload) => parseFeed(toolDetailFeedSchema, payload, `Tool detail '${slug}'`),
        {contentHash, catalogRevision: index.catalogRevision, sourceIndex: index},
        signal,
      );
      if (detail.data.slug !== slug) {
        throw new FeedRequestError(path, feedUrl(baseUrl, path), `Tool detail slug mismatch: expected=${slug}, observed=${detail.data.slug}`);
      }
      return detail.data;
    },
    toolLookup: async (signal) => {
      const index = await loadIndex(signal);
      if (!index.feeds.toolLookup) return null;
      const expectedHash = index.contentHashes?.['/api/tool-lookup.json'];
      if (index.contentHashes && !expectedHash) {
        throw new FeedRequestError(
          '/api/tool-lookup.json',
          feedUrl(baseUrl, '/api/tool-lookup.json'),
          'Public feed index does not authenticate the Tool lookup projection',
        );
      }
      try {
        return await loadDirect(
          '/api/tool-lookup.json',
          (payload) => {
            assertSupportedFeedVersion(payload, [TOOL_LOOKUP_ARTIFACT_VERSION.split('.')[0]!]);
            return parseToolLookupArtifact(payload);
          },
          expectedHash ? {contentHash: expectedHash, embeddedContentHash: false, sourceIndex: index} : undefined,
          signal,
        );
      } catch (error) {
        if (!expectedHash && error instanceof FeedRequestError && error.status === 404) {
          return null;
        }
        throw error;
      }
    },
    searchIndex: (signal) =>
      loadLeaf(
        '/api/search-index.json',
        (payload) =>
          parseFeed(
            searchIndexFeedSchema,
            payload,
            'search-index',
          ),
        signal,
      ),
    tools: loadTools,
    toolDetail: (slug, signal) => {
      const path = toolDetailPath(slug);
      return loadLeaf(
        path,
        (payload) =>
          parseFeed(
            toolDetailFeedSchema,
            payload,
            `Tool detail '${slug}'`,
          ),
        signal,
      ).then((feed) => {
        if (!feed.data.deals) return feed;
        const deals = filterCurrentToolDeals(feed.data.deals, new Date(now()));
        if (deals.length === feed.data.deals.length) return feed;
        const current = {...feed, data: {...feed.data, deals}};
        // The cached producer envelope remains intact; this digest identifies the current view.
        return feed.contentHash ? {...current, contentHash: computeContentHash(current)} : current;
      });
    },
    stacks: (signal) =>
      loadLeaf(
        '/api/stacks.json',
        (payload) =>
          parseFeed(stacksFeedSchema, payload, 'stacks'),
        signal,
      ),
    best: (signal) =>
      loadLeaf(
        '/api/best.json',
        (payload) =>
          parseFeed(bestFeedSchema, payload, 'best'),
        signal,
      ),
    categories: (signal) =>
      loadLeaf(
        '/api/categories.json',
        (payload) =>
          parseFeed(
            categoriesFeedSchema,
            payload,
            'categories',
          ),
        signal,
      ),
    tags: (signal) =>
      loadLeaf(
        '/api/tags.json',
        (payload) =>
          parseFeed(tagsFeedSchema, payload, 'tags'),
        signal,
      ),
    useCases: (signal) =>
      loadLeaf(
        '/api/use-cases.json',
        (payload) =>
          parseFeed(
            useCasesFeedSchema,
            payload,
            'use-cases',
          ),
        signal,
      ),
    alternatives: async (signal) => {
      const path = '/api/alternatives.json';
      if (options.indexFirst !== false) {
        assertAlternativesCapability(await loadIndex(signal));
      }
      return loadLeaf(
        path,
        (payload) =>
          parseFeed(alternativesFeedSchema, payload, 'alternatives'),
        signal,
      );
    },
    alternativesDetail: async (slug, signal) => {
      const path = alternativesDetailPath(slug);
      if (options.indexFirst !== false) {
        assertAlternativesCapability(await loadIndex(signal));
      }
      return loadLeaf(
        path,
        (payload) =>
          parseFeed(
            alternativesDetailFeedSchema,
            payload,
            `alternatives '${slug}'`,
          ),
        signal,
      );
    },
    comparisons: async (signal) => {
      const path = '/api/compare.json';
      if (options.indexFirst !== false) {
        assertComparisonsCapability(await loadIndex(signal));
      }
      return loadLeaf(
        path,
        (payload) =>
          parseFeed(comparisonsFeedSchema, payload, 'comparisons'),
        signal,
      );
    },
    comparisonDetail: async (slug, signal) => {
      const path = comparisonDetailPath(slug);
      if (options.indexFirst !== false) {
        assertComparisonsCapability(await loadIndex(signal));
      }
      return loadLeaf(
        path,
        (payload) =>
          parseFeed(
            comparisonDetailFeedSchema,
            payload,
            `comparison '${slug}'`,
          ),
        signal,
      );
    },
    stacksHubMarkdown: markdownArtifact(
      '/stacks.md',
      // `stacks` is the per-stack template; the directory is advertised as `stacksIndex`.
      'stacksIndex',
      'stacks markdown hub artifact',
      HUB_UNAVAILABLE_RECOVERY.stacks,
    ),
    bestHubMarkdown: markdownArtifact(
      '/best.md',
      'bestIndex',
      'best-of markdown hub artifact',
      HUB_UNAVAILABLE_RECOVERY.best,
    ),
    comparisonsHubMarkdown: markdownArtifact(
      '/compare.md',
      'comparisonsIndex',
      'comparisons markdown hub artifact',
      HUB_UNAVAILABLE_RECOVERY.comparisons,
    ),
  };
};
