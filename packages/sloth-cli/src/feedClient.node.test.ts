import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import {AgentSearchPayloadLimitError} from '@slothhub/domain/agent-search';
import {
  createFeedClient,
  defaultFetchJson,
  FEED_REQUEST_TIMEOUT_MS,
  FeedHttpStatusError,
  MAX_FEED_RESPONSE_BYTES,
  resolveBaseUrl,
} from './feedClient.js';
import {
  alternativesFeed,
  indexFeed,
  searchIndexFeed,
  toolDetailFeed,
  toolLookupArtifact,
} from './fixtures.js';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeContentHash, computeIndexContentHash } from '@slothhub/domain/public-feed-content-identity';
import {writePersistentCacheEntry} from './persistentFeedCache.js';
import {z} from 'zod';

describe('createFeedClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('honors operation cancellation before returning an in-run cache hit', async () => {
    const controller = new AbortController();
    const client = createFeedClient({signal: controller.signal, fetchJson: async () => indexFeed});
    await client.index();
    const reason = new DOMException('Operation cancelled', 'AbortError');
    controller.abort(reason);
    await expect(client.index()).rejects.toBe(reason);
  });

  it.each([
    {persistentCache: false, transport: 'http', mismatch: 'hash'},
    {persistentCache: false, transport: 'http', mismatch: 'revision'},
    {persistentCache: false, transport: 'injected', mismatch: 'hash'},
    {persistentCache: false, transport: 'injected', mismatch: 'revision'},
    {transport: 'injected', mismatch: 'hash'},
    {transport: 'injected', mismatch: 'revision'},
  ])('authenticates leaves independently of disk persistence ($transport, $mismatch, persistentCache=$persistentCache)', async ({persistentCache, transport, mismatch}) => {
    const revision = `sha256:${'a'.repeat(64)}`;
    const current = {...searchIndexFeed, catalogRevision: revision};
    const index = {...indexFeed, catalogRevision: revision,
      contentHashes: {'/api/search-index.json': computeContentHash(current)}};
    const changed = mismatch === 'hash'
      ? {...current, data: {...current.data, tools: []}}
      : {...current, catalogRevision: `sha256:${'b'.repeat(64)}`};
    const leaf = {...changed, contentHash: computeContentHash(changed)};
    const read = (url: string): object => url.endsWith('/api/index.json') ? index : leaf;
    if (transport === 'http') {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => new Response(JSON.stringify(read(input instanceof Request ? input.url : input.toString()))));
    }
    const client = createFeedClient({persistentCache,
      fetchJson: transport === 'injected' ? async (url) => read(url) : undefined});
    await expect(client.searchIndex()).rejects.toMatchObject({
      code: mismatch === 'hash' ? 'hash_mismatch' : 'revision_mismatch',
      path: '/api/search-index.json',
    });
  });

  it('removes offers that expire while the Tool feed remains in the in-run cache', async () => {
    vi.setSystemTime(new Date('2026-10-17T12:00:00Z'));
    const deal = {id: 'offer', title: 'Save 20%', description: 'Annual offer', discountPercent: 20,
      eligibility: 'New customers', termsSummary: 'Annual only', commercialDisclosure: 'Affiliate offer', sourceUrl: 'https://example.com/offer',
      verifiedAt: '2026-10-17T00:00:00Z', lastSourceCheckedAt: '2026-10-17T01:00:00Z', expiresAt: '2026-10-17T12:01:00Z'};
    const payload = {...toolDetailFeed, data: {...toolDetailFeed.data, deals: [deal]}};
    const source = {...payload, contentHash: computeContentHash(payload)};
    const fetchJson = vi.fn(async (url: string) => url.endsWith('/api/index.json') ? indexFeed : source);
    const client = createFeedClient({fetchJson, persistentCache: false});
    const before = await client.tool('figma');
    expect(before.data.deals).toEqual([deal]);
    vi.setSystemTime(new Date(deal.expiresAt));
    const after = await client.tool('figma');
    expect(after.data.deals).toEqual([]);
    expect(after.contentHash).toBe(computeContentHash(after));
    expect(before.contentHash).toBe(source.contentHash);
    expect(source.data.deals).toEqual([deal]);
    expect(before.data.deals).toEqual([deal]);
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it('uses the producer UTF-8 and LF golden content hash', () => {
    expect(
      computeContentHash({ data: { a: 'lower', 'é': 'accent\r\nline', Z: 'upper' } }),
    ).toBe(
      'sha256:8479ab6dcb78acbdba3f847b1d0db1eb748f7f60de0bf60cf6df1f446c69f80c',
    );
  });

  it('validates a buildAgentIndexFeed-shaped index with non-circular self-hash semantics', async () => {
    const leafHash = `sha256:${'7'.repeat(64)}`;
    const withoutSelf = {
      ...indexFeed,
      catalogRevision: `sha256:${'8'.repeat(64)}`,
      contentHashes: {'/api/tools/figma.json': leafHash},
    };
    const contentHash = computeIndexContentHash(withoutSelf);
    const index = {
      ...withoutSelf,
      contentHash,
      contentHashes: {
        ...withoutSelf.contentHashes,
        '/api/index.json': contentHash,
      },
    };
    expect(computeContentHash(index)).not.toBe(contentHash);

    await expect(
      createFeedClient({
        baseUrl: 'https://slothhub.dev',
        fetchJson: async () => index,
      }).index(),
    ).resolves.toEqual(index);
  });

  it('preserves the producer best-index field before validating the index hash', async () => {
    const withoutSelf = {
      ...indexFeed,
      markdownArtifacts: {
        ...indexFeed.markdownArtifacts,
        bestIndex: 'https://slothhub.dev/best.md',
      },
      contentHashes: {},
    };
    const contentHash = computeIndexContentHash(withoutSelf);
    const authenticatedIndex = {
      ...withoutSelf,
      contentHash,
      contentHashes: {'/api/index.json': contentHash},
    };

    await expect(
      createFeedClient({
        baseUrl: 'https://slothhub.dev',
        fetchJson: async () => authenticatedIndex,
      }).index(),
    ).resolves.toMatchObject({
      markdownArtifacts: {bestIndex: 'https://slothhub.dev/best.md'},
      contentHash,
    });
  });

  it('rejects a forged loopback envelope without caching it', async () => {
    const leaf = vi.fn()
      .mockResolvedValueOnce({...searchIndexFeed, siteUrl: 'http://localhost:4321'})
      .mockResolvedValueOnce(searchIndexFeed);
    const fetchJson = vi.fn(async (url: string): Promise<object> => url.endsWith('/api/index.json') ? indexFeed : leaf());
    const client = createFeedClient({baseUrl: 'https://preview.slothhub.dev', fetchJson});
    await expect(client.searchIndex()).rejects.toThrow('feed_origin_mismatch');
    await expect(client.searchIndex()).resolves.toMatchObject({siteUrl: searchIndexFeed.siteUrl});
    expect(fetchJson).toHaveBeenCalledTimes(3);
  });

  it('fetches static feeds from the configured base URL and caches them by default', async () => {
    const requestedUrls: string[] = [];
    const client = createFeedClient({
      baseUrl: 'https://preview.slothhub.dev/',
      fetchJson: async (url) => {
        requestedUrls.push(url);
        return url.endsWith('/api/index.json') ? indexFeed : searchIndexFeed;
      },
    });

    await client.searchIndex();
    await client.searchIndex();

    expect(requestedUrls).toEqual(['https://preview.slothhub.dev/api/index.json', 'https://preview.slothhub.dev/api/search-index.json']);
  });

  it('can bypass leaf caches for debugging while reusing the verified index', async () => {
    const requestedUrls: string[] = [];
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      noCache: true,
      fetchJson: async (url) => {
        requestedUrls.push(url);
        return url.endsWith('/api/index.json') ? indexFeed : searchIndexFeed;
      },
    });

    await client.searchIndex();
    await client.searchIndex();

    expect(requestedUrls).toEqual([
      'https://slothhub.dev/api/index.json',
      'https://slothhub.dev/api/search-index.json',
      'https://slothhub.dev/api/search-index.json',
    ]);
  });

  it('reuses an unchanged validated leaf across separate CLI clients', async () => {
    const cacheDirectory = await mkdtemp(join(tmpdir(), 'slothhub-cli-cache-'));
    const revision = `sha256:${'a'.repeat(64)}`;
    const hash = computeContentHash({ ...searchIndexFeed, catalogRevision: revision });
    const versionedIndex = {
      ...indexFeed,
      catalogRevision: revision,
      contentHashes: { '/api/search-index.json': hash },
    };
    const versionedSearch = {
      ...searchIndexFeed,
      catalogRevision: revision,
      contentHash: hash,
    };
    const requestedUrls: string[] = [];
    const fetchJson = async (url: string) => {
      requestedUrls.push(url);
      return url.endsWith('/api/index.json') ? versionedIndex : versionedSearch;
    };

    try {
      await createFeedClient({ baseUrl: 'https://slothhub.dev', fetchJson, cacheDirectory })
        .searchIndex();
      await createFeedClient({ baseUrl: 'https://slothhub.dev', fetchJson, cacheDirectory })
        .searchIndex();

      expect(requestedUrls).toEqual([
        'https://slothhub.dev/api/index.json',
        'https://slothhub.dev/api/search-index.json',
        'https://slothhub.dev/api/index.json',
      ]);
    } finally {
      await rm(cacheDirectory, { recursive: true, force: true });
    }
  });

  it('reuses a validated self-hashed Tool detail feed across separate CLI clients', async () => {
    const cacheDirectory = await mkdtemp(join(tmpdir(), 'slothhub-cli-detail-cache-'));
    const revision = `sha256:${'9'.repeat(64)}`;
    const contentHash = computeContentHash({...toolDetailFeed, catalogRevision: revision});
    const versionedIndex = {
      ...indexFeed,
      catalogRevision: revision,
      contentHashes: {'/api/tools/figma.json': contentHash},
    };
    const versionedDetail = {
      ...toolDetailFeed,
      catalogRevision: revision,
      contentHash,
    };
    let detailRequests = 0;
    const fetchJson = async (url: string) => {
      if (url.endsWith('/api/index.json')) return versionedIndex;
      detailRequests += 1;
      if (detailRequests > 1) throw new Error('detail route is offline');
      return versionedDetail;
    };

    try {
      await createFeedClient({baseUrl: 'https://slothhub.dev', fetchJson, cacheDirectory})
        .tool('figma');
      await expect(
        createFeedClient({baseUrl: 'https://slothhub.dev', fetchJson, cacheDirectory})
          .tool('figma'),
      ).resolves.toMatchObject({contentHash, catalogRevision: revision});
      expect(detailRequests).toBe(1);
    } finally {
      await rm(cacheDirectory, {recursive: true, force: true});
    }
  });

  it('keeps a valid cached detail usable when an unrelated cached entry is corrupt', async () => {
    const cacheDirectory = await mkdtemp(join(tmpdir(), 'slothhub-cli-isolated-cache-'));
    const contentHash = computeContentHash(toolDetailFeed);
    const detail = {...toolDetailFeed, contentHash};
    let detailRequests = 0;
    const fetchJson = async (url: string) => {
      if (url.endsWith('/api/index.json')) return {...indexFeed, contentHashes: {'/api/tools/figma.json': contentHash}};
      detailRequests += 1;
      return detail;
    };
    try {
      await createFeedClient({fetchJson, cacheDirectory}).tool('figma');
      await writeFile(join(cacheDirectory, 'feeds-v2', `${'f'.repeat(64)}.json`), JSON.stringify({
        version: 2, contentHash, storedAt: 42, payload: {},
      }));
      await expect(createFeedClient({fetchJson, cacheDirectory}).tool('figma')).resolves.toMatchObject({contentHash, data: {slug: 'figma'}});
      expect(detailRequests).toBe(1);
    } finally {
      await rm(cacheDirectory, {recursive: true, force: true});
    }
  });

  it('refetches a cached body whose embedded catalog revision disagrees with its cache metadata', async () => {
    const cacheDirectory = await mkdtemp(join(tmpdir(), 'slothhub-cli-cache-revision-'));
    const revision = `sha256:${'9'.repeat(64)}`;
    const contentHash = computeContentHash(toolDetailFeed);
    const detail = {...toolDetailFeed, contentHash, catalogRevision: revision};
    const requested: string[] = [];
    try {
      await writePersistentCacheEntry(cacheDirectory, 'https://slothhub.dev|/api/tools/figma.json|1', {
        contentHash, catalogRevision: revision, storedAt: new Date().toISOString(),
        payload: z.json().parse({...detail, catalogRevision: `sha256:${'8'.repeat(64)}`}),
      });
      const client = createFeedClient({baseUrl: 'https://slothhub.dev', cacheDirectory, fetchJson: async (url) => {
        requested.push(new URL(url).pathname);
        return url.endsWith('/api/index.json')
          ? {...indexFeed, catalogRevision: revision, contentHashes: {'/api/tools/figma.json': contentHash}}
          : detail;
      }});
      await expect(client.tool('figma')).resolves.toMatchObject({catalogRevision: revision});
      expect(requested).toEqual(['/api/index.json', '/api/tools/figma.json']);
    } finally {
      await rm(cacheDirectory, {recursive: true, force: true});
    }
  });

  it('does not persist or reuse an unindexed dynamic Tool detail from an old index', async () => {
    const cacheDirectory = await mkdtemp(join(tmpdir(), 'slothhub-cli-old-index-cache-'));
    const revision = `sha256:${'6'.repeat(64)}`;
    const contentHash = computeContentHash({...toolDetailFeed, catalogRevision: revision});
    const oldIndex = {...indexFeed, contentHashes: {}};
    const detail = {...toolDetailFeed, catalogRevision: revision, contentHash};
    let detailRequests = 0;
    const fetchJson = async (url: string) => {
      if (url.endsWith('/api/index.json')) return oldIndex;
      detailRequests += 1;
      return detail;
    };

    try {
      await createFeedClient({baseUrl: 'https://slothhub.dev', fetchJson, cacheDirectory})
        .tool('figma');
      await createFeedClient({baseUrl: 'https://slothhub.dev', fetchJson, cacheDirectory})
        .tool('figma');
      expect(detailRequests).toBe(2);
    } finally {
      await rm(cacheDirectory, {recursive: true, force: true});
    }
  });

  it('refetches after the index downgrades from an indexed detail to an unindexed route', async () => {
    const cacheDirectory = await mkdtemp(join(tmpdir(), 'slothhub-cli-downgrade-cache-'));
    const revision = `sha256:${'4'.repeat(64)}`;
    const body = {...toolDetailFeed, catalogRevision: revision};
    const contentHash = computeContentHash(body);
    const detail = {...body, contentHash};
    let indexed = true;
    let detailRequests = 0;
    const fetchJson = async (url: string) => {
      if (url.endsWith('/api/index.json')) {
        return {
          ...indexFeed,
          catalogRevision: revision,
          contentHashes: indexed
            ? {'/api/tools/figma.json': contentHash}
            : {},
        };
      }
      detailRequests += 1;
      return detail;
    };

    try {
      await createFeedClient({baseUrl: 'https://slothhub.dev', fetchJson, cacheDirectory})
        .tool('figma');
      indexed = false;
      await createFeedClient({baseUrl: 'https://slothhub.dev', fetchJson, cacheDirectory})
        .tool('figma');
      await createFeedClient({baseUrl: 'https://slothhub.dev', fetchJson, cacheDirectory})
        .tool('figma');
      expect(detailRequests).toBe(3);
    } finally {
      await rm(cacheDirectory, {recursive: true, force: true});
    }
  });

  it('fetches a changed Tool detail when its indexed route hash changes', async () => {
    const cacheDirectory = await mkdtemp(join(tmpdir(), 'slothhub-cli-changed-detail-cache-'));
    const revision = `sha256:${'5'.repeat(64)}`;
    const firstBody = {...toolDetailFeed, catalogRevision: revision};
    const changedBody = {
      ...toolDetailFeed,
      catalogRevision: revision,
      data: {...toolDetailFeed.data, platforms: ['cli']},
    };
    const firstHash = computeContentHash(firstBody);
    const changedHash = computeContentHash(changedBody);
    let generation = 0;
    let detailRequests = 0;
    const fetchJson = async (url: string) => {
      if (url.endsWith('/api/index.json')) {
        const hash = generation === 0 ? firstHash : changedHash;
        return {
          ...indexFeed,
          catalogRevision: revision,
          contentHashes: {'/api/tools/figma.json': hash},
        };
      }
      detailRequests += 1;
      const body = generation === 0 ? firstBody : changedBody;
      const contentHash = generation === 0 ? firstHash : changedHash;
      return {...body, contentHash};
    };

    try {
      await createFeedClient({baseUrl: 'https://slothhub.dev', fetchJson, cacheDirectory})
        .tool('figma');
      generation = 1;
      const changed = await createFeedClient({
        baseUrl: 'https://slothhub.dev',
        fetchJson,
        cacheDirectory,
      }).tool('figma');
      expect(changed.data.platforms).toEqual(['cli']);
      expect(detailRequests).toBe(2);
    } finally {
      await rm(cacheDirectory, {recursive: true, force: true});
    }
  });

  it('rejects a leaf that copies the indexed hash without matching its body', async () => {
    const cacheDirectory = await mkdtemp(join(tmpdir(), 'slothhub-cli-cache-'));
    const hash = `sha256:${'b'.repeat(64)}`;
    const fetchJson = async (url: string) =>
      url.endsWith('/api/index.json')
        ? { ...indexFeed, contentHashes: { '/api/search-index.json': hash } }
        : { ...searchIndexFeed, contentHash: hash, data: { ...searchIndexFeed.data, tools: [] } };

    try {
      await expect(
        createFeedClient({ baseUrl: 'https://slothhub.dev', fetchJson, cacheDirectory })
          .searchIndex(),
      ).rejects.toThrow('content hash');
    } finally {
      await rm(cacheDirectory, { recursive: true, force: true });
    }
  });

  it.each(['http', 'injected'] as const)('rejects an incorrect embedded hash even when the index authenticates the body (%s)', async (transport) => {
    const contentHash = computeContentHash(searchIndexFeed);
    const index = {...indexFeed, contentHashes: {'/api/search-index.json': contentHash}};
    const leaf = {...searchIndexFeed, contentHash: `sha256:${'0'.repeat(64)}`};
    const payloadFor = (url: string) => url.endsWith('/api/index.json') ? index : leaf;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => new Response(
      JSON.stringify(payloadFor(url instanceof Request ? url.url : url.toString())),
      {headers: {'content-type': 'application/json'}},
    ));
    const client = createFeedClient({
      noCache: true,
      fetchJson: transport === 'injected' ? async (url: string) => payloadFor(url) : undefined,
    });

    await expect(client.searchIndex()).rejects.toMatchObject({
      code: 'hash_mismatch',
      path: '/api/search-index.json',
      message: expect.stringContaining('Feed content hash is invalid'),
    });
  });

  it('verifies the exact Tool lookup projection against its indexed content hash', async () => {
    const expectedHash = computeContentHash(toolLookupArtifact);
    const fetchJson = async (url: string) =>
      url.endsWith('/api/index.json')
        ? {...indexFeed, contentHashes: {'/api/tool-lookup.json': expectedHash}}
        : {
            ...toolLookupArtifact,
            tools: toolLookupArtifact.tools.map((tool) => ({...tool, name: 'Tampered'})),
          };

    await expect(
      createFeedClient({baseUrl: 'https://slothhub.dev', fetchJson}).toolLookup(),
    ).rejects.toMatchObject({
      code: 'hash_mismatch',
      path: '/api/tool-lookup.json',
      message: expect.stringContaining('content hash does not match the index'),
    });
  });

  it('fails closed when an indexed Tool lookup projection returns 404', async () => {
    const expectedHash = computeContentHash(toolLookupArtifact);
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async (url) => {
        if (url.endsWith('/api/index.json')) {
          return {...indexFeed, contentHashes: {'/api/tool-lookup.json': expectedHash}};
        }
        throw new Error('HTTP 404 Not Found');
      },
    });

    await expect(client.toolLookup()).rejects.toMatchObject({
      code: 'transport',
      path: '/api/tool-lookup.json',
    });
  });

  it('fails closed when the current index advertises Tool lookup without its hash', async () => {
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async (url) => url.endsWith('/api/index.json')
        ? {...indexFeed, contentHashes: {'/api/search-index.json': `sha256:${'a'.repeat(64)}`}}
        : toolLookupArtifact,
    });

    await expect(client.toolLookup()).rejects.toMatchObject({
      code: 'schema_invalid',
      path: '/api/tool-lookup.json',
      message: expect.stringContaining('does not authenticate'),
    });
  });

  it('retains legacy Tool lookup absence when the index has no hash contract', async () => {
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async (url) => {
        if (url.endsWith('/api/index.json')) return indexFeed;
        throw new Error('HTTP 404 Not Found');
      },
    });

    await expect(client.toolLookup()).resolves.toBeNull();
  });

  it('distinguishes unsupported Tool lookup versions from malformed projections', async () => {
    const unsupported = {...toolLookupArtifact, version: '33.0.0'};
    const malformed = {...toolLookupArtifact, tools: 'not-an-array'};

    const clientFor = <Payload extends object>(payload: Payload) => createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async (url): Promise<object> => url.endsWith('/api/index.json')
        ? {...indexFeed, contentHashes: {'/api/tool-lookup.json': computeContentHash(payload)}}
        : payload,
    });

    await expect(clientFor(unsupported).toolLookup()).rejects.toMatchObject({
      code: 'unsupported_version',
      path: '/api/tool-lookup.json',
    });
    await expect(clientFor(malformed).toolLookup()).rejects.toMatchObject({
      code: 'schema_invalid',
      path: '/api/tool-lookup.json',
    });
  });

  it('preserves identity-claim limit diagnostics at the feed boundary', async () => {
    const oversizedLookup = {
      ...toolLookupArtifact,
      identityClaims: Array.from({length: 5_001}, (_, index) => ({
        namespace: 'npm_package' as const,
        value: `npm_package:retired-${index}`,
        disposition: 'retired' as const,
        sourceToolId: `retired-${index}`,
      })),
    };
    const expectedHash = computeContentHash(oversizedLookup);
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async (url) => url.endsWith('/api/index.json')
        ? {...indexFeed, contentHashes: {'/api/tool-lookup.json': expectedHash}}
        : oversizedLookup,
    });

    await expect(client.toolLookup()).rejects.toMatchObject({
      code: 'tool_lookup_identity_claim_limit_exceeded',
      configuredLimit: 5_000,
      observedValue: 5_001,
      recovery: expect.stringContaining('Reduce'),
    });
  });

  it('rejects a route-family feed from a different catalog revision', async () => {
    const indexRevision = `sha256:${'c'.repeat(64)}`;
    const staleRevision = `sha256:${'d'.repeat(64)}`;
    const fetchJson = async (url: string) =>
      url.endsWith('/api/index.json')
        ? { ...indexFeed, catalogRevision: indexRevision }
        : {
            ...searchIndexFeed,
            version: '33.0.0',
            catalogRevision: staleRevision,
            data: { tool: { slug: 'figma' } },
          };

    await expect(
      createFeedClient({ baseUrl: 'https://slothhub.dev', noCache: true, fetchJson })
        .tool('figma'),
    ).rejects.toThrow('catalog revision does not match');
  });

  it('rejects a route-family feed from a different revision with persistent caching', async () => {
    const cacheDirectory = await mkdtemp(join(tmpdir(), 'slothhub-cli-cache-'));
    const indexRevision = `sha256:${'e'.repeat(64)}`;
    const staleRevision = `sha256:${'f'.repeat(64)}`;
    const fetchJson = async (url: string) =>
      url.endsWith('/api/index.json')
        ? { ...indexFeed, catalogRevision: indexRevision }
        : {
            ...searchIndexFeed,
            version: '33.0.0',
            catalogRevision: staleRevision,
            data: { tool: { slug: 'figma' } },
          };

    try {
      await expect(
        createFeedClient({ baseUrl: 'https://slothhub.dev', fetchJson, cacheDirectory })
          .tool('figma'),
      ).rejects.toThrow('catalog revision does not match');
    } finally {
      await rm(cacheDirectory, { recursive: true, force: true });
    }
  });

  it('authenticates the advertised alternatives list for custom transports', async () => {
    const path = '/api/alternatives.json';
    const expectedHash = computeContentHash(alternativesFeed);
    const tamperedFeed = {
      ...alternativesFeed,
      data: {...alternativesFeed.data, sets: []},
    };
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      persistentCache: false,
      fetchJson: async (url) => new URL(url).pathname === '/api/index.json'
        ? {
            ...indexFeed,
            feeds: {...indexFeed.feeds, alternatives: `https://slothhub.dev${path}`},
            contentHashes: {[path]: expectedHash},
          }
        : tamperedFeed,
    });

    await expect(client.alternatives()).rejects.toMatchObject({
      code: 'hash_mismatch',
      path,
    });
  });

  it('authenticates alternatives through the persistent-cache path', async () => {
    const cacheDirectory = await mkdtemp(join(tmpdir(), 'slothhub-cli-alternatives-cache-'));
    const path = '/api/alternatives.json';
    const expectedHash = computeContentHash(alternativesFeed);
    try {
      await expect(createFeedClient({
        baseUrl: 'https://slothhub.dev',
        cacheDirectory,
        fetchJson: async (url) => new URL(url).pathname === '/api/index.json'
          ? {
              ...indexFeed,
              feeds: {...indexFeed.feeds, alternatives: `https://slothhub.dev${path}`},
              contentHashes: {[path]: expectedHash},
            }
          : {...alternativesFeed, data: {...alternativesFeed.data, sets: []}},
      }).alternatives()).rejects.toMatchObject({code: 'hash_mismatch', path});
    } finally {
      await rm(cacheDirectory, {recursive: true, force: true});
    }
  });

  it('reuses alternatives only while its indexed hash and revision match', async () => {
    const cacheDirectory = await mkdtemp(join(tmpdir(), 'slothhub-cli-alternatives-cache-'));
    const path = '/api/alternatives.json';
    const revisions = [`sha256:${'3'.repeat(64)}`, `sha256:${'4'.repeat(64)}`];
    const bodies = revisions.map((catalogRevision, index) => ({
      ...alternativesFeed,
      catalogRevision,
      data: {
        ...alternativesFeed.data,
        sets: index === 0
          ? alternativesFeed.data.sets
          : [...alternativesFeed.data.sets].reverse(),
      },
    }));
    const hashes = bodies.map(computeContentHash);
    let generation = 0;
    let leafRequests = 0;
    const fetchJson = async (url: string) => {
      if (new URL(url).pathname === '/api/index.json') {
        return {
          ...indexFeed,
          catalogRevision: revisions[generation],
          feeds: {...indexFeed.feeds, alternatives: `https://slothhub.dev${path}`},
          contentHashes: {[path]: hashes[generation]!},
        };
      }
      leafRequests += 1;
      return {...bodies[generation]!, contentHash: hashes[generation]};
    };

    try {
      await createFeedClient({baseUrl: 'https://slothhub.dev', cacheDirectory, fetchJson})
        .alternatives();
      await createFeedClient({baseUrl: 'https://slothhub.dev', cacheDirectory, fetchJson})
        .alternatives();
      generation = 1;
      const changed = await createFeedClient({
        baseUrl: 'https://slothhub.dev',
        cacheDirectory,
        fetchJson,
      }).alternatives();

      expect(changed.data.sets[0]?.slug).toBe('linear');
      expect(leafRequests).toBe(2);
    } finally {
      await rm(cacheDirectory, {recursive: true, force: true});
    }
  });

  it('fails closed when an authenticated index omits the fixed alternatives hash', async () => {
    const requestedPaths: string[] = [];
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      persistentCache: false,
      fetchJson: async (url) => {
        const path = new URL(url).pathname;
        requestedPaths.push(path);
        return path === '/api/index.json'
          ? {
              ...indexFeed,
              feeds: {
                ...indexFeed.feeds,
                alternatives: 'https://slothhub.dev/api/alternatives.json',
              },
              contentHashes: {
                '/api/search-index.json': computeContentHash(searchIndexFeed),
              },
            }
          : alternativesFeed;
      },
    });

    await expect(client.alternatives()).rejects.toMatchObject({
      code: 'schema_invalid',
      path: '/api/alternatives.json',
      message: expect.stringContaining('does not authenticate'),
    });
    expect(requestedPaths).toEqual(['/api/index.json']);
  });

  it.each([
    ['hostile', 'http://127.0.0.1/runtime'],
    ['non-canonical', ' https://example.com/docs '],
  ])(
    'rejects %s runtime requirements before writing them to the persistent cache',
    async (_label, url) => {
      const cacheDirectory = await mkdtemp(join(tmpdir(), 'slothhub-cli-cache-'));
      const hostileFeed = structuredClone(toolDetailFeed);
      hostileFeed.data.runtimeRequirements![0]!.evidence[0]!.url = url;
      const hash = computeContentHash(hostileFeed);
      const versionedIndex = {
        ...indexFeed,
        catalogRevision: hostileFeed.catalogRevision,
        contentHashes: {'/api/tools/figma.json': hash},
      };
      const fetchJson = async (url: string) =>
        url.endsWith('/api/index.json') ? versionedIndex : {...hostileFeed, contentHash: hash};

      try {
        await expect(
          createFeedClient({baseUrl: 'https://slothhub.dev', fetchJson, cacheDirectory})
            .tool('figma'),
        ).rejects.toThrow('evidence URL must be public HTTP(S)');
        await expect(readdir(join(cacheDirectory, 'feeds-v2'))).rejects.toMatchObject({code: 'ENOENT'});
      } finally {
        await rm(cacheDirectory, {recursive: true, force: true});
      }
    },
  );

  it('rejects canonical runtime evidence duplicates before caching', async () => {
    const cacheDirectory = await mkdtemp(join(tmpdir(), 'slothhub-cli-cache-'));
    const duplicateFeed = structuredClone(toolDetailFeed);
    const evidence = duplicateFeed.data.runtimeRequirements![0]!.evidence;
    evidence.push({
      ...evidence[0]!,
      title: 'Duplicate runtime support',
      url: evidence[0]!.url,
    });
    const hash = computeContentHash(duplicateFeed);
    const versionedIndex = {
      ...indexFeed,
      catalogRevision: duplicateFeed.catalogRevision,
      contentHashes: {'/api/tools/figma.json': hash},
    };
    const fetchJson = async (url: string) =>
      url.endsWith('/api/index.json') ? versionedIndex : {...duplicateFeed, contentHash: hash};

    try {
      await expect(
        createFeedClient({baseUrl: 'https://slothhub.dev', fetchJson, cacheDirectory})
          .tool('figma'),
      ).rejects.toThrow('evidence URLs must be unique within a row');
      await expect(readdir(join(cacheDirectory, 'feeds-v2'))).rejects.toMatchObject({code: 'ENOENT'});
    } finally {
      await rm(cacheDirectory, {recursive: true, force: true});
    }
  });

  it('turns non-2xx responses into actionable feed errors', async () => {
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async (url) => {
        if (url.endsWith('/api/index.json')) return indexFeed;
        throw new Error('HTTP 503 Service Unavailable');
      },
    });

    await expect(client.searchIndex()).rejects.toThrow(
      'Unable to load https://slothhub.dev/api/search-index.json: HTTP 503 Service Unavailable'
    );
  });

  it('exposes redirect status without following a Tool detail redirect', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 302,
        statusText: 'Found',
        headers: {location: '/api/tools/figma.json'},
      }),
    );

    const request = defaultFetchJson('https://slothhub.dev/api/tools/figma-design.json');
    await expect(request).rejects.toBeInstanceOf(FeedHttpStatusError);
    await expect(request).rejects.toMatchObject({statusCode: 302});
    expect(fetchMock).toHaveBeenCalledWith(
      'https://slothhub.dev/api/tools/figma-design.json',
      expect.objectContaining({redirect: 'manual'}),
    );
  });

  it('rejects oversized HTTP responses before parsing JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', {
        headers: { 'content-length': String(MAX_FEED_RESPONSE_BYTES + 1) },
      }),
    );

    await expect(defaultFetchJson('https://slothhub.dev/api/index.json')).rejects.toThrow(
      `feed_payload_too_large: configured_limit_bytes=${MAX_FEED_RESPONSE_BYTES} observed_bytes=${MAX_FEED_RESPONSE_BYTES + 1} recovery=Use a smaller public feed or narrow the requested catalog surface.`,
    );
  });

  it('throws a typed payload limit error for chunked overflow without content-length', async () => {
    const chunk = new Uint8Array(6 * 1024 * 1024);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(chunk);
          controller.enqueue(chunk);
          controller.close();
        },
      }),
    ));

    const request = defaultFetchJson('https://slothhub.dev/api/index.json');
    await expect(request).rejects.toBeInstanceOf(AgentSearchPayloadLimitError);
    await expect(request).rejects.toMatchObject({
      code: 'feed_payload_too_large',
      configuredLimitBytes: MAX_FEED_RESPONSE_BYTES,
      observedBytes: 12 * 1024 * 1024,
    });
  });

  it.each([
    'https://slothhub.com',
    'https://www.slothhub.com',
    'https://preview.slothhub.com',
    'https://slothub.com',
    'https://www.slothub.com',
    'https://preview.slothub.com',
    'https://slothtools.com',
    'https://www.slothtools.com',
    'https://preview.slothtools.com',
  ])('rejects an unowned catalog origin %s', (origin) => {
    expect(() => resolveBaseUrl(origin)).toThrow('Use https://slothhub.dev');
    expect(() => createFeedClient({baseUrl: origin})).toThrow('Use https://slothhub.dev');
  });

  it('defaults to the deployed production feed origin and rejects unsupported base URLs', () => {
    vi.stubEnv('SLOTHHUB_BASE_URL', undefined);
    expect(resolveBaseUrl()).toBe('https://slothhub.dev');
    expect(resolveBaseUrl('https://slothhub.dev')).toBe('https://slothhub.dev');
    expect(resolveBaseUrl('https://SLOTHHUB.DEV')).toBe('https://SLOTHHUB.DEV');
    expect(resolveBaseUrl('https://www.slothhub.dev')).toBe('https://www.slothhub.dev');
    expect(resolveBaseUrl('https://preview.slothhub.dev')).toBe('https://preview.slothhub.dev');
    expect(() => resolveBaseUrl('http://169.254.169.254')).toThrow('Use https://slothhub.dev');
    expect(() => resolveBaseUrl('http://slothhub.dev')).toThrow('Unsupported feed base URL');
    expect(() => resolveBaseUrl('https://slothhub.dev.evil.example')).toThrow('Unsupported feed base URL');
    expect(() => resolveBaseUrl('https://slothhub.dev.')).toThrow('Unsupported feed base URL');
  });

  it.each([
    'https://slothhub.dev',
    'https://SLOTHHUB.DEV',
    'https://www.slothhub.dev',
    'https://preview.slothhub.dev',
  ])('accepts the production origin and supported subdomains: %s', (origin) => {
    expect(resolveBaseUrl(origin)).toBe(origin);
  });

  it.each([
    'http://localhost:4321',
    'http://127.0.0.1:4321',
    'http://[::1]:4321',
  ])('accepts a local development feed origin: %s', (origin) => {
    expect(resolveBaseUrl(origin)).toBe(origin);
  });

  it.each([
    'http://slothhub.dev',
    'https://slothhub.dev.evil.example',
    'https://slothhub.dev.',
    'https://169.254.169.254',
    'https://192.168.1.1',
    'https://10.0.0.1',
    'https://[::1]',
    'https://internal.example',
  ])('rejects an unsupported production lookalike or private origin: %s', (origin) => {
    expect(() => resolveBaseUrl(origin)).toThrow('Unsupported feed base URL');
  });

  it('keeps base-URL allowlisting unchanged when proxy environment variables are set', () => {
    vi.stubEnv('SLOTHHUB_BASE_URL', undefined);
    vi.stubEnv('HTTPS_PROXY', 'http://user:pass@proxy.corp:8080');
    vi.stubEnv('HTTP_PROXY', 'http://proxy.corp:3128');
    vi.stubEnv('NODE_USE_ENV_PROXY', '1');

    expect(resolveBaseUrl()).toBe('https://slothhub.dev');
    expect(resolveBaseUrl('https://slothhub.dev/')).toBe('https://slothhub.dev');
    expect(() => resolveBaseUrl('http://proxy.corp:8080')).toThrow('Unsupported feed base URL');
    expect(() => resolveBaseUrl('http://169.254.169.254')).toThrow('Unsupported feed base URL');
    expect(() => resolveBaseUrl('https://attacker.vercel.app')).toThrow('Unsupported feed base URL');
  });

  it('aborts the default fetcher instead of hanging forever', async () => {
    const abortSignals: AbortSignal[] = [];
    // SAFETY: This controlled test double implements every collaborator operation exercised by the test.
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((async (_url, init) => {
      if (init?.signal) {
        abortSignals.push(init.signal);
      }

      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('This operation was aborted', 'AbortError'));
        });
      });
    }) as typeof fetch);

    const request = defaultFetchJson('https://slothhub.dev/api/index.json');
    const assertion = expect(request).rejects.toThrow(`Feed request timed out after ${FEED_REQUEST_TIMEOUT_MS}ms`);

    await vi.advanceTimersByTimeAsync(FEED_REQUEST_TIMEOUT_MS);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://slothhub.dev/api/index.json',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      })
    );
    expect(abortSignals[0]?.aborted).toBe(true);
    await assertion;
  });

  it('preserves operation cancellation instead of misclassifying it as a timeout', async () => {
    const controller = new AbortController();
    // SAFETY: This controlled test double implements every collaborator operation exercised by the test.
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Fetch aborted', 'AbortError'));
        }, {once: true});
      })) as typeof fetch);

    const request = defaultFetchJson('https://slothhub.dev/api/index.json', {
      signal: controller.signal,
    });
    const assertion = expect(request).rejects.toMatchObject({
      name: 'AbortError',
      message: 'Stopped by caller',
    });
    controller.abort(new DOMException('Stopped by caller', 'AbortError'));

    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the timeout active while parsing the response body', async () => {
    const jsonAbortSignals: AbortSignal[] = [];
    // SAFETY: This controlled test double implements every collaborator operation exercised by the test.
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((async (_url, init) => {
      if (init?.signal) {
        jsonAbortSignals.push(init.signal);
      }

      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener('abort', () => {
            controller.error(new DOMException('This operation was aborted', 'AbortError'));
          });
        },
      });
      return new Response(body);
    }) as typeof fetch);

    const request = defaultFetchJson('https://slothhub.dev/api/index.json');
    const assertion = expect(request).rejects.toThrow(`Feed request timed out after ${FEED_REQUEST_TIMEOUT_MS}ms`);

    await vi.advanceTimersByTimeAsync(FEED_REQUEST_TIMEOUT_MS);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(jsonAbortSignals[0]?.aborted).toBe(true);
    await assertion;
  });
});
