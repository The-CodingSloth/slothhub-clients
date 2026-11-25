import {fetchFeedResponse, readBoundedBytes} from '@slothhub/domain/public-feed-http';
import {assertLocalFeedTransportOrigin} from '@slothhub/domain/feed-origin';
import {PUBLIC_FEED_TIMEOUT_MS, PUBLIC_FEED_MAX_BYTES} from '@slothhub/domain/public-feed-transport';
import {filterCurrentToolDeals} from '@slothhub/domain/public-tool-deal';
import { parseCatalogSnapshot, type AgentCatalogSnapshot} from '@slothhub/domain/public-feed-catalog';
import {assertSupportedPublicFeedVersion, catalogFeedVersionSchema, UnsupportedFeedVersionError} from '@slothhub/domain/feed-compatibility';
import {hasRuntimeObjectType, isRuntimeString} from '@slothhub/domain/runtime-validation';
import {SLOTHHUB_PUBLIC_HOSTNAMES} from '@slothhub/domain/public-hostnames';
import type {JsonObject, JsonValue} from '@slothhub/domain/json-value';
import type {ProjectManifestToolsArtifact} from '@slothhub/domain/project-tool-pin-manifest';
import type {ToolLookupArtifact} from '@slothhub/domain/tool-lookup';
import {AgentSearchContractError, AgentSearchPayloadLimitError} from '@slothhub/domain/agent-search';
import {parseProjectManifestToolsArtifact} from '@slothhub/domain/project-tool-pin-manifest';
import {parseToolLookupArtifact, TOOL_LOOKUP_ARTIFACT_VERSION, ToolLookupArtifactLimitError} from '@slothhub/domain/tool-lookup';
import type {
  AgentFeedPayload,
  AgentAlternativesFeed,
  AgentAlternativesDetailFeed,
  AgentCategoriesFeed,
  AgentComparisonDetailFeed,
  AgentComparisonsFeed,
  AgentCuratedListFeed,
  AgentIndexFeed,
  AgentSearchIndexFeed,
  AgentTagsFeed,
  AgentToolDetailFeed,
  AgentToolStackFeed,
  AgentToolsFeed,
  AgentUseCasesFeed} from './types.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {z} from 'zod';
import { computeContentHash, computeIndexContentHash } from '@slothhub/domain/public-feed-content-identity';
import {
  parseBestFeed,
  parseAlternativesFeed,
  parseAlternativesDetailFeed,
  parseCategoriesFeed,
  parseComparisonDetailFeed,
  parseComparisonsFeed,
  parseIndexFeed,
  parseSearchIndexFeed,
  parseStacksFeed,
  parseTagsFeed,
  parseToolDetailFeed,
  parseToolsFeed,
  parseUseCasesFeed} from '@slothhub/domain/public-feed-schemas';
import {createAlternativesCatalog} from './alternativesCatalog.js';
import {FeedClientError} from './feedClientError.js';
import {readPersistentCacheEntry, writePersistentCacheEntry, type PersistentCacheEntry} from './persistentFeedCache.js';

export {MAX_PERSISTENT_CACHE_BYTES} from './persistentFeedCache.js';

export {
  FeedCapabilityUnavailableError,
  FeedClientError,
} from './feedClientError.js';
export type {FeedClientErrorCode} from './feedClientError.js';

type FeedJson = JsonValue;
type FeedObject = JsonObject;
export type FeedTransportPayload = object | string | number | boolean | null | undefined;
type CachedFeedResult = FeedJson | AgentFeedPayload | ToolLookupArtifact | ProjectManifestToolsArtifact;
type ParsedFeed<TFeed extends AgentFeedPayload> = {
  feed: TFeed;
  source: FeedObject;
};
interface AuthenticatedFeedJson {
  source: FeedObject;
  computedHash: string;
}
type FeedExpectation = {
  contentHash?: string;
  catalogRevision?: string;
};

export type FetchJson = (
  url: string,
  init?: {signal?: AbortSignal},
) => Promise<FeedTransportPayload>;

export class FeedRequestTimeoutError extends Error {
  readonly configuredMs: number;
  readonly observedMs: number;

  constructor(configuredMs: number, observedMs = configuredMs) {
    super(`Feed request timed out after ${observedMs}ms (configured deadline: ${configuredMs}ms)`);
    this.name = 'TimeoutError';
    this.configuredMs = configuredMs;
    this.observedMs = observedMs;
  }
}

export class FeedHttpStatusError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, statusText = '') {
    super(`HTTP ${statusCode} ${statusText}`.trim());
    this.name = 'FeedHttpStatusError';
    this.statusCode = statusCode;
  }
}

export interface FeedClientOptions {
  baseUrl?: string;
  noCache?: boolean;
  fetchJson?: FetchJson;
  fetchText?: FetchText;
  /** Abort every request owned by this client operation. */
  signal?: AbortSignal;
  /** Override the bounded OS cache directory. Primarily useful for tests. */
  cacheDirectory?: string;
  /** Disable cross-run disk persistence while retaining the in-run promise cache. */
  persistentCache?: boolean;
}

export type FetchText = (url: string, init?: {signal?: AbortSignal}) => Promise<string>;

export interface FeedClient {
  index: () => Promise<AgentIndexFeed>;
  catalog: () => Promise<AgentCatalogSnapshot>;
  toolLookup: () => Promise<ToolLookupArtifact | null>;
  projectManifestTools: () => Promise<ProjectManifestToolsArtifact | null>;
  searchIndex: () => Promise<AgentSearchIndexFeed>;
  tools: () => Promise<AgentToolsFeed>;
  tool: (slug: string) => Promise<AgentToolDetailFeed>;
  authenticatedJson: (
    path: string,
    expected: {contentHash: string; catalogRevision?: string},
  ) => Promise<FeedObject>;
  stacks: () => Promise<AgentToolStackFeed>;
  best: () => Promise<AgentCuratedListFeed>;
  comparisons: () => Promise<AgentComparisonsFeed>;
  comparison: (slug: string) => Promise<AgentComparisonDetailFeed>;
  categories: () => Promise<AgentCategoriesFeed>;
  tags: () => Promise<AgentTagsFeed>;
  useCases: () => Promise<AgentUseCasesFeed>;
  alternatives: () => Promise<AgentAlternativesFeed>;
  alternative: (slug: string) => Promise<AgentAlternativesDetailFeed>;
}

export const DEFAULT_BASE_URL = 'https://slothhub.dev';
export const FEED_REQUEST_TIMEOUT_MS = PUBLIC_FEED_TIMEOUT_MS;
export const MAX_FEED_RESPONSE_BYTES = PUBLIC_FEED_MAX_BYTES;
const feedJsonSchema = z.json();
const feedObjectSchema = z.record(z.string(), feedJsonSchema);

const parseTransportJson = <Payload,>(payload: Payload): FeedJson => {
  const serialized = JSON.stringify(payload);
  if (!isRuntimeString(serialized)) throw new Error('Feed payload is not JSON serializable');
  return feedJsonSchema.parse(JSON.parse(serialized));
};

export const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, '');

const LOCALHOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const ALLOWED_HTTPS_HOSTS = new Set(SLOTHHUB_PUBLIC_HOSTNAMES);

const isAllowedBaseUrl = (value: string): boolean => {
  try {
    const url = new URL(value);

    if (url.protocol === 'https:') {
      return ALLOWED_HTTPS_HOSTS.has(url.hostname);
    }

    return url.protocol === 'http:' && LOCALHOSTS.has(url.hostname);
  } catch {
    return false;
  }
};

export const resolveBaseUrl = (baseUrl?: string): string => {
  const resolved = normalizeBaseUrl(baseUrl ?? process.env.SLOTHHUB_BASE_URL ?? DEFAULT_BASE_URL);

  if (!isAllowedBaseUrl(resolved)) {
    throw new Error(
      'Unsupported feed base URL. Use https://slothhub.dev, its www or preview subdomain, or localhost for development.'
    );
  }

  return resolved;
};

const feedUrl = (baseUrl: string, path: string): string =>
  `${normalizeBaseUrl(baseUrl)}${path.startsWith('/') ? path : `/${path}`}`;

const isAbortError = <ErrorValue>(error: ErrorValue): boolean =>
  hasRuntimeObjectType(error) && error !== null && 'name' in error && error.name === 'AbortError';

const fetchFeedText = (url: string, init: {signal?: AbortSignal} | undefined, accept: string): Promise<string> =>
  fetchFeedResponse(url, init?.signal, {
    timeoutMs: FEED_REQUEST_TIMEOUT_MS, accept, userAgent: '@slothhub/cli', redirect: 'manual',
    statusError: (status, text) => new FeedHttpStatusError(status, text),
    timeoutError: () => new FeedRequestTimeoutError(FEED_REQUEST_TIMEOUT_MS),
    abortError: (signal) => signal.reason instanceof Error ? signal.reason : new DOMException('Feed request cancelled', 'AbortError'),
  }, async (response) => new TextDecoder('utf-8', {fatal: true}).decode(
    await readBoundedBytes(response, MAX_FEED_RESPONSE_BYTES, (observed) => new AgentSearchPayloadLimitError(MAX_FEED_RESPONSE_BYTES, observed)),
  ));

export const defaultFetchJson = async (
  url: string,
  init?: {signal?: AbortSignal},
): Promise<FeedJson> =>
  feedJsonSchema.parse(JSON.parse(await fetchFeedText(url, init, 'application/json')));
export const defaultFetchText: FetchText = (url, init) => fetchFeedText(url, init, 'text/markdown');

const feedTransportError = <ErrorValue,>(
  error: ErrorValue,
  path: string,
  url: string,
): FeedClientError => {
  const message = error instanceof Error ? error.message : String(error);
  return new FeedClientError(
    'transport',
    path,
    `Unable to load ${url}: ${message}`,
    {
      cause: error,
      ...(error instanceof FeedHttpStatusError
        ? {httpStatus: error.statusCode}
        : undefined),
    },
  );
};

export const defaultCacheDirectory = (): string => {
  const configured = process.env.XDG_CACHE_HOME;
  if (configured) return join(configured, 'slothhub');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'slothhub');
  return join(homedir(), '.cache', 'slothhub');
};

const feedObject = (payload: FeedJson, path: string): FeedObject => {
  const parsed = feedObjectSchema.safeParse(payload);
  if (!parsed.success) {
    throw new FeedClientError('schema_invalid', path, `Invalid feed shape for ${path}`);
  }
  assertSupportedPublicFeedVersion(parsed.data, path);
  return parsed.data;
};

const validateIndexVersion = (source: FeedObject, path: string): void => {
  if (path !== '/api/index.json') return;
  const version = 'version' in source ? source.version : undefined;
  if (!catalogFeedVersionSchema.safeParse(version).success) {
    throw new FeedClientError(
      'schema_invalid',
      path,
      'Public feed index version must be a supported semantic version.',
    );
  }
};

const validatedPayloadContentHash = (
  payload: FeedJson,
  path: string,
): string | undefined => {
  if (!payload || !hasRuntimeObjectType(payload) || Array.isArray(payload)) return undefined;
  const contentHash = 'contentHash' in payload ? payload.contentHash : undefined;
  const computedHash =
    path === '/api/index.json'
      ? computeIndexContentHash(payload)
      : computeContentHash(payload);
  return isRuntimeString(contentHash) &&
    /^sha256:[a-f0-9]{64}$/.test(contentHash) &&
    computedHash === contentHash
    ? contentHash
    : undefined;
};

const recordVersion = (payload: FeedJson): string | undefined =>
  payload && hasRuntimeObjectType(payload) && !Array.isArray(payload) && 'version' in payload &&
    isRuntimeString(payload.version)
    ? payload.version
    : undefined;

export const createFeedClient = (options: FeedClientOptions = {}): FeedClient => {
  const baseUrl = resolveBaseUrl(options.baseUrl);
  // The HTTP reader already parses JSON. Only injected transports need their
  // JSON serialization boundary; do not clone and validate HTTP JSON twice.
  const transport = options.fetchJson;
  const fetchJson = transport
    ? async (url: string, init?: {signal?: AbortSignal}): Promise<FeedJson> =>
      parseTransportJson(await transport(url, init))
    : defaultFetchJson;
  const cache = new Map<string, Promise<CachedFeedResult>>();
  const persistentCacheDirectory = options.noCache
    ? undefined
    : options.persistentCache === false
      ? undefined
      : options.cacheDirectory ?? (options.fetchJson ? undefined : defaultCacheDirectory());

  const fetchAndValidate = async <TFeed extends AgentFeedPayload>(
    path: string,
    parse: (payload: JsonValue, path: string) => TFeed,
    expected?: FeedExpectation,
  ): Promise<ParsedFeed<TFeed>> => {
    const {source, computedHash} = await fetchAuthenticatedJson(path, expected);
    const contentHash = 'contentHash' in source ? source.contentHash : undefined;
    let feed: TFeed;
    try {
      feed = parse(source, path);
    } catch (error) {
      throw new FeedClientError(
        'schema_invalid',
        path,
        error instanceof Error ? error.message : `Invalid feed shape for ${path}`,
        {cause: error},
      );
    }
    if (isRuntimeString(contentHash) && computedHash !== contentHash) {
      throw new FeedClientError(
        'hash_mismatch',
        path,
        `Feed content hash is invalid for ${path}`,
      );
    }
    return {feed, source};
  };

  async function fetchAuthenticatedJson(
    path: string,
    expected?: FeedExpectation,
  ): Promise<AuthenticatedFeedJson> {
    options.signal?.throwIfAborted();
    const url = feedUrl(baseUrl, path);
    const payload = await fetchJson(url, {signal: options.signal});
    options.signal?.throwIfAborted();
    const source = feedObject(payload, path);
    validateIndexVersion(source, path);
    const catalogRevision = 'catalogRevision' in source ? source.catalogRevision : undefined;
    if (expected?.catalogRevision && catalogRevision !== expected.catalogRevision) {
      throw new FeedClientError(
        'revision_mismatch',
        path,
        `Feed catalog revision does not match the index for ${path}`,
      );
    }
    const computedHash =
      path === '/api/index.json'
        ? computeIndexContentHash(source)
        : computeContentHash(source);
    if (
      expected?.contentHash &&
      computedHash !== expected.contentHash
    ) {
      throw new FeedClientError(
        'hash_mismatch',
        path,
        `Feed content hash does not match the index for ${path}`,
      );
    }
    // Preserve this request's digest for the embedded self-hash check as well
    // as the indexed hash check. Never reuse it across mutable feed objects.
    return {source, computedHash};
  }

  const load = async <TFeed extends AgentFeedPayload>(
    path: string,
    parsePayload: (payload: JsonValue, path: string) => TFeed,
    expected?: FeedExpectation,
  ): Promise<TFeed> => {
    options.signal?.throwIfAborted();
    const url = feedUrl(baseUrl, path);
    const parse = (payload: JsonValue, feedPath: string): TFeed => {
      const feed = parsePayload(payload, feedPath);
      assertLocalFeedTransportOrigin(feed.siteUrl, url);
      return feed;
    };
    const memoizeInRun = path === '/api/index.json' || !options.noCache;

    if (memoizeInRun && cache.has(url)) {
      // SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
      return cache.get(url) as Promise<TFeed>;
    }

    const request = (async () => {
      const index = path !== '/api/index.json' && !expected
        ? await load('/api/index.json', parseIndexFeed)
        : undefined;
      const expectation = expected ?? (index ? {
        contentHash: index.contentHashes?.[path],
        catalogRevision: index.catalogRevision,
      } : undefined);
      if (persistentCacheDirectory && path !== '/api/index.json') {
        const expectedHash = expectation?.contentHash;
        const expectedRevision = expectation?.catalogRevision;
        const cacheKey = `${baseUrl}|${path}|1`;
        const stored = await readPersistentCacheEntry(persistentCacheDirectory, cacheKey);
        options.signal?.throwIfAborted();
        const storedHash = stored
          ? validatedPayloadContentHash(stored.payload, path)
          : undefined;
        if (
          expectedHash &&
          storedHash &&
          stored?.contentHash === storedHash &&
          storedHash === expectedHash &&
          (!expectedRevision || stored.catalogRevision === expectedRevision)
        ) {
          try {
            const feed = parse(feedObject(stored.payload, path), path);
            // The canonical digest excludes revisions. Authenticate the body,
            // not just the disk wrapper, against this operation's fresh index.
            if (!expectedRevision || feed.catalogRevision === expectedRevision) return feed;
          } catch (error) {
            if (error instanceof UnsupportedFeedVersionError) throw error;
            // Hashes omit volatile metadata; a malformed cache body is a miss.
          }
        }

        const validated = await fetchAndValidate(path, parse, {
          contentHash: expectedHash,
          catalogRevision: expectedRevision,
        });
        const identity = validated.feed;
        if (expectedHash) {
          const cacheEntry: PersistentCacheEntry = {
            contentHash: expectedHash,
            ...(isRuntimeString(identity.catalogRevision) ? { catalogRevision: identity.catalogRevision } : undefined),
            storedAt: new Date().toISOString(), payload: validated.source
          };
          await writePersistentCacheEntry(
            persistentCacheDirectory,
            cacheKey,
            cacheEntry,
          ).catch(() => undefined);
        }
        options.signal?.throwIfAborted();
        return validated.feed;
      }
      return (await fetchAndValidate(path, parse, expectation)).feed;
    })().catch((error) => {
      cache.delete(url);
      if (
        isAbortError(error) ||
        error instanceof AgentSearchPayloadLimitError ||
        error instanceof FeedClientError ||
        error instanceof UnsupportedFeedVersionError
      ) throw error;
      throw feedTransportError(error, path, url);
    });

    if (memoizeInRun) {
      cache.set(url, request);
    }

    // SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
    return request as Promise<TFeed>;
  };

  // Index-advertised optional leaf artifacts share one flow: the public index
  // authenticates the leaf by content hash when it publishes hashes, an
  // unauthenticated or missing leaf degrades to null, and schema or transport
  // failures surface as named errors.
  const loadIndexedLeafArtifact = async <TArtifact extends CachedFeedResult>({
    path,
    advertised,
    unauthenticatedMessage,
    hashMismatchMessage,
    parseArtifact,
  }: {
    path: string;
    advertised: (index: AgentIndexFeed) => string | undefined;
    unauthenticatedMessage: string;
    hashMismatchMessage: string;
    parseArtifact: (payload: FeedJson, path: string) => TArtifact;
  }): Promise<TArtifact | null> => {
    const index = await load('/api/index.json', parseIndexFeed);
    if (!advertised(index)) return null;
    const expectedHash = index.contentHashes?.[path];
    if (index.contentHashes && !expectedHash) {
      throw new FeedClientError('schema_invalid', path, unauthenticatedMessage);
    }
    const url = feedUrl(baseUrl, path);
    if (!options.noCache && cache.has(url)) {
      // SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
      return cache.get(url) as Promise<TArtifact>;
    }
    const request = (async () => {
      const cacheKey = `${baseUrl}|${path}|1`;
      if (persistentCacheDirectory && expectedHash) {
        const stored = await readPersistentCacheEntry(persistentCacheDirectory, cacheKey);
        options.signal?.throwIfAborted();
        // Lookup has no embedded feed hash or catalog revision. Authenticate
        // the stored transport body against this operation's fresh index.
        if (
          stored?.contentHash === expectedHash &&
          (!index.catalogRevision || stored.catalogRevision === index.catalogRevision) &&
          computeContentHash(stored.payload) === expectedHash
        ) {
          try {
            return parseArtifact(stored.payload, path);
          } catch {
            // Canonical hashes omit volatile metadata. An invalid cached
            // artifact is a miss; the fresh response must still validate.
          }
        }
      }

      const payload = await fetchJson(url, {signal: options.signal});
      if (expectedHash && computeContentHash(payload) !== expectedHash) {
        throw new FeedClientError('hash_mismatch', path, hashMismatchMessage);
      }
      const artifact = parseArtifact(payload, path);
      if (persistentCacheDirectory && expectedHash) {
        await writePersistentCacheEntry(persistentCacheDirectory, cacheKey, {
          contentHash: expectedHash,
          ...(index.catalogRevision ? {catalogRevision: index.catalogRevision} : undefined),
          storedAt: new Date().toISOString(),
          payload,
        }).catch(() => undefined);
      }
      return artifact;
    })().catch((error) => {
      cache.delete(url);
      if (
        error instanceof AgentSearchPayloadLimitError ||
        error instanceof FeedClientError ||
        error instanceof ToolLookupArtifactLimitError ||
        error instanceof UnsupportedFeedVersionError
      ) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new FeedClientError(
        'transport',
        path,
        `Unable to load ${url}: ${message}`,
        {cause: error},
      );
    });
    if (!options.noCache) cache.set(url, request);
    try {
      return await request;
    } catch (error) {
      if (
        !expectedHash &&
        error instanceof Error &&
        /\b(?:HTTP )?404\b/.test(error.message)
      ) return null;
      throw error;
    }
  };

  const requireComparisonsFeed = async (): Promise<void> => {
    const index = await load('/api/index.json', parseIndexFeed);
    if (!index.feeds.comparisons) {
      throw new AgentSearchContractError(
        'capability_unavailable',
        'The public index does not advertise a comparisons feed.',
        'Use a newer catalog origin or --base-url, then retry. See --help for supported options.',
        'comparisons',
      );
    }
  };
  const alternativesCatalog = createAlternativesCatalog({
    baseUrl,
    loadIndex: () => load('/api/index.json', parseIndexFeed),
    loadList: (expected) => load(
      '/api/alternatives.json',
      parseAlternativesFeed,
      expected,
    ),
    loadDetail: (path, expected) => load(
      path,
      parseAlternativesDetailFeed,
      expected,
    ),
  });

  const loadExport = async <TFeed extends AgentFeedPayload>(
    path: string,
    parse: (payload: JsonValue, path: string) => TFeed,
  ): Promise<TFeed> => {
    const index = await load('/api/index.json', parseIndexFeed);
    return load(path, parse, {contentHash: index.contentHashes?.[path], catalogRevision: index.catalogRevision});
  };

  return {
    index: () => load('/api/index.json', parseIndexFeed),
    catalog: () => loadExport('/api/catalog.snapshot.json', parseCatalogSnapshot),
    toolLookup: () =>
      loadIndexedLeafArtifact<ToolLookupArtifact>({
        path: '/api/tool-lookup.json',
        advertised: (index) => index.feeds.toolLookup,
        unauthenticatedMessage:
          'The public index does not authenticate the advertised Tool lookup projection.',
        hashMismatchMessage: 'Tool lookup content hash does not match the index',
        parseArtifact: (payload, path) => {
          const version = recordVersion(payload);
          if (version !== undefined && version !== TOOL_LOOKUP_ARTIFACT_VERSION) {
            throw new FeedClientError(
              'unsupported_version',
              path,
              `Tool lookup version ${version} is unsupported.`,
            );
          }
          try {
            return parseToolLookupArtifact(payload);
          } catch (error) {
            if (error instanceof ToolLookupArtifactLimitError) throw error;
            throw new FeedClientError(
              'schema_invalid',
              path,
              'Tool lookup artifact is invalid.',
              {cause: error},
            );
          }
        },
      }),
    projectManifestTools: () =>
      loadIndexedLeafArtifact<ProjectManifestToolsArtifact>({
        path: '/api/project-manifest-tools.json',
        advertised: (index) => index.feeds.projectManifestTools,
        unauthenticatedMessage:
          'The public index does not authenticate the advertised project manifest Tools feed.',
        hashMismatchMessage:
          'Project manifest Tools content hash does not match the index',
        parseArtifact: (payload, path) => {
          const source = feedObject(payload, path);
          const parsed = parseProjectManifestToolsArtifact(JSON.stringify(source));
          if (!parsed.ok) {
            throw new FeedClientError(
              'schema_invalid',
              path,
              `Project manifest Tools artifact is invalid: ${parsed.reason}.`,
            );
          }
          return parsed.value;
        },
      }),
    searchIndex: () => load('/api/search-index.json', parseSearchIndexFeed),
    tools: () => load('/api/tools.json', parseToolsFeed),
    tool: async (slug: string) => {
      const feed = await load(`/api/tools/${encodeURIComponent(slug)}.json`, parseToolDetailFeed);
      if (!feed.data.deals) return feed;
      const deals = filterCurrentToolDeals(feed.data.deals);
      if (deals.length === feed.data.deals.length) return feed;
      const current = {...feed, data: {...feed.data, deals}};
      // The cached producer envelope remains intact; this digest identifies the current view.
      return feed.contentHash ? {...current, contentHash: computeContentHash(current)} : current;
    },
    authenticatedJson: async (path, expected) => (await fetchAuthenticatedJson(path, expected)).source,
    stacks: () => load('/api/stacks.json', parseStacksFeed),
    best: () => load('/api/best.json', parseBestFeed),
    comparisons: async () => {
      await requireComparisonsFeed();
      return load('/api/compare.json', parseComparisonsFeed);
    },
    comparison: async (slug: string) => {
      await requireComparisonsFeed();
      return load(`/api/compare/${encodeURIComponent(slug)}.json`, parseComparisonDetailFeed);
    },
    categories: () => load('/api/categories.json', parseCategoriesFeed),
    tags: () => load('/api/tags.json', parseTagsFeed),
    useCases: () => load('/api/use-cases.json', parseUseCasesFeed),
    alternatives: alternativesCatalog.list,
    alternative: alternativesCatalog.detail,
  };
};
