import { describe, expect, it, vi } from 'vite-plus/test';
import type {ToolLookupArtifact} from '@slothhub/domain/tool-lookup';

import { createFeedClient, type FeedResponsePayload } from './feeds.js';
import type {AgentSearchIndexFeed} from '../types.js';
import {computeContentHash, computeIndexContentHash} from '@slothhub/domain/public-feed-content-identity';

const indexFeed = {
  version: '33.0.0',
  siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-07-15T00:00:00.000Z',
  schemaUrl: 'https://slothhub.dev/api/schema.json',
  snapshots: {
    full: 'https://slothhub.dev/api/catalog.snapshot.json',
    ndjson: 'https://slothhub.dev/api/catalog.ndjson',
  },
  feeds: {
    tools: 'https://slothhub.dev/api/tools.json',
    toolLookup: 'https://slothhub.dev/api/tool-lookup.json',
    searchIndex: 'https://slothhub.dev/api/search-index.json',
    categories: 'https://slothhub.dev/api/categories.json',
    tags: 'https://slothhub.dev/api/tags.json',
    useCases: 'https://slothhub.dev/api/use-cases.json',
    stacks: 'https://slothhub.dev/api/stacks.json',
    best: 'https://slothhub.dev/api/best.json',
  },
  markdownArtifacts: {
    stacksIndex: 'https://slothhub.dev/stacks.md',
    // As the site publishes it: the per-stack template, not the directory.
    stacks: 'https://slothhub.dev/stacks/{slug}.md',
    bestIndex: 'https://slothhub.dev/best.md',
  },
  integrationHubUrl: 'https://slothhub.dev/agents',
  markdownHubUrl: 'https://slothhub.dev/agents.md',
  toolDetailUrlTemplate: 'https://slothhub.dev/tool/{slug}',
  citationGuidance: ['Cite canonical pages', 'Do not cite /go/ visit URLs'],
};

describe('index version validation', () => {
  it('filters deals again when a cached Tool is read after offer expiry', async () => {
    let clock = Date.parse('2026-10-17T12:00:00Z');
    const deal = {id: 'offer', title: 'Save 20%', description: 'Annual offer', discountPercent: 20,
      eligibility: 'New customers', termsSummary: 'Annual only', commercialDisclosure: 'Affiliate offer', sourceUrl: 'https://example.com/offer',
      verifiedAt: '2026-10-17T00:00:00Z', lastSourceCheckedAt: '2026-10-17T01:00:00Z', expiresAt: '2026-10-17T12:01:00Z'};
    const payload = {...indexFeed, data: {name: 'Example', slug: 'example', description: 'Example tool',
      resourceKind: {value: 'app', label: 'App'},
      resourceIdentity: {kind: 'website', kindLabel: 'Website', canonicalUrl: 'https://example.com/', ctaLabel: 'Open site'},
      platforms: ['web'], categories: [], tags: [], useCases: [], freshness: {isVerified: false},
      detailUrl: 'https://slothhub.dev/tool/example', visitUrl: 'https://slothhub.dev/go/example', keyFeatures: [], deals: [deal]}};
    const source = {...payload, contentHash: computeContentHash(payload)};
    const fetchJson = vi.fn(async () => source);
    const client = createFeedClient({fetchJson, indexFirst: false, now: () => clock});
    const before = await client.toolDetail('example');
    expect(before.data.deals).toEqual([deal]);
    clock = Date.parse(deal.expiresAt);
    const after = await client.toolDetail('example');
    expect(after.data.deals).toEqual([]);
    expect(after.contentHash).toBe(computeContentHash(after));
    expect(before.contentHash).toBe(source.contentHash);
    expect(source.data.deals).toEqual([deal]);
    expect(before.data.deals).toEqual([deal]);
    expect(fetchJson).toHaveBeenCalledOnce();
  });
  it('rejects a malformed version even when the manifest is otherwise complete', async () => {
    const fetchJson = vi.fn(async () => ({...indexFeed, version: '2.0.0\u001b[31m'}));
    await expect(createFeedClient({fetchJson}).index()).rejects.toThrow('version');
    expect(fetchJson).toHaveBeenCalledOnce();
  });

  it('accepts compatible additive manifest fields', async () => {
    const fetchJson = vi.fn(async () => ({...indexFeed, version: '33.99.0', futureField: true}));
    await expect(createFeedClient({fetchJson}).index()).resolves.toMatchObject({version: '33.99.0'});
    expect(fetchJson).toHaveBeenCalledOnce();
  });

  it('preserves the producer best-index field before validating the index hash', async () => {
    const withoutSelf = {
      ...indexFeed,
      markdownArtifacts: {
        ...indexFeed.markdownArtifacts,
        bestIndex: 'https://slothhub.dev/best.md',
        futureIndex: 'https://slothhub.dev/future.md',
      },
      contentHashes: {},
    };
    const contentHash = computeIndexContentHash(withoutSelf);
    const authenticatedIndex = {
      ...withoutSelf,
      contentHash,
      contentHashes: {'/api/index.json': contentHash},
    };

    const parsed = await createFeedClient({
      fetchJson: async () => authenticatedIndex,
    }).index();
    expect(parsed).toMatchObject({
      markdownArtifacts: {bestIndex: 'https://slothhub.dev/best.md'},
      contentHash,
    });
    expect(parsed.markdownArtifacts).not.toHaveProperty('futureIndex');

    const tamperedIndex = {
      ...authenticatedIndex,
      markdownArtifacts: {
        ...authenticatedIndex.markdownArtifacts,
        futureIndex: 'https://slothhub.dev/tampered.md',
      },
    };
    await expect(
      createFeedClient({fetchJson: async () => tamperedIndex}).index(),
    ).rejects.toThrow('Public feed index content hash is invalid');
  });
});

describe('markdown artifact transport', () => {
  it('cancels an unread HTTP error body and permits a later retry', async () => {
    let cancelled = false;
    let requests = 0;
    vi.stubGlobal('fetch', async () => {
      requests += 1;
      return requests === 1 ? new Response(new ReadableStream<Uint8Array>({
        cancel() { cancelled = true; },
      }), {status: 503}) : new Response(JSON.stringify(indexFeed));
    });
    try {
      const client = createFeedClient();
      await expect(client.index()).rejects.toMatchObject({status: 503});
      expect(cancelled).toBe(true);
      await expect(client.index()).resolves.toMatchObject({version: indexFeed.version});
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects malformed UTF-8 instead of returning silently changed Markdown', async () => {
    vi.stubGlobal('fetch', async (url: string) => url.endsWith('/api/index.json')
      ? new Response(JSON.stringify(indexFeed))
      : new Response(new Uint8Array([0x23, 0x20, 0xff]), {headers: {'content-type': 'text/markdown'}}));
    try {
      await expect(createFeedClient().stacksHubMarkdown?.()).rejects.toThrow(/encoded data|encoding/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  const stalledResponse = (signal: AbortSignal): Response => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{'));
        signal.addEventListener(
          'abort',
          () => controller.error(new DOMException('The operation was aborted.', 'AbortError')),
          {once: true},
        );
      },
    });
    return new Response(stream, {headers: {'content-type': 'text/markdown'}});
  };

  it('fetches the canonical same-origin path and preserves its body', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/index.json')) return new Response(JSON.stringify(indexFeed));
      expect(url).toBe('https://slothhub.dev/stacks.md');
      expect(init?.headers).toMatchObject({accept: 'text/markdown, text/plain;q=0.9'});
      return new Response('# Agent interfaces');
    });
    vi.stubGlobal('fetch', fetch);
    try {
      await expect(createFeedClient().stacksHubMarkdown?.()).resolves.toBe('# Agent interfaces');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(['text/markdown; charset=utf-8', 'text/plain; charset=utf-8'])(
    'accepts supported artifact media type %s',
    async (contentType) => {
      vi.stubGlobal('fetch', vi.fn(async (url: string) =>
        url.endsWith('/api/index.json')
          ? new Response(JSON.stringify(indexFeed))
          : new Response('# Agent interfaces', {headers: {'content-type': contentType}}),
      ));
      try {
        await expect(createFeedClient().stacksHubMarkdown?.()).resolves.toBe('# Agent interfaces');
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it('rejects HTML fallbacks and cancels the response body', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.endsWith('/api/index.json')
        ? new Response(JSON.stringify(indexFeed))
        : new Response(stream, {headers: {'content-type': 'text/html'}}),
    ));
    try {
      await expect(createFeedClient().stacksHubMarkdown?.()).rejects.toThrow(/content type/i);
      expect(cancelled).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects an oversized markdown artifact explicitly', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.endsWith('/api/index.json')
        ? new Response(JSON.stringify(indexFeed))
        : new Response('oversized'),
    ));
    try {
      await expect(
        createFeedClient({maxMarkdownArtifactResponseBytes: 4}).stacksHubMarkdown?.(),
      ).rejects.toMatchObject({code: 'feed_text_payload_too_large', observedBytes: 9});
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reports the optional artifact capability as unavailable before fetching', async () => {
    const fetchJson = vi.fn(async () => ({
      ...indexFeed,
      markdownArtifacts: {},
    }));
    const fetchText = vi.fn(async () => '# should not fetch');
    await expect(
      createFeedClient({fetchJson, fetchText}).stacksHubMarkdown?.(),
    ).rejects.toMatchObject({code: 'capability_unavailable'});
    expect(fetchText).not.toHaveBeenCalled();
  });

  it('fetches the advertised stacks hub artifact and preserves its body', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/api/index.json')) return new Response(JSON.stringify(indexFeed));
      expect(url).toBe('https://slothhub.dev/stacks.md');
      return new Response('# SlothHub Tool Stacks', {
        headers: {'content-type': 'text/markdown; charset=utf-8'},
      });
    });
    vi.stubGlobal('fetch', fetch);
    try {
      await expect(createFeedClient().stacksHubMarkdown?.()).resolves.toBe('# SlothHub Tool Stacks');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reports the stacks hub capability as unavailable before fetching', async () => {
    const fetchJson = vi.fn(async () => ({
      ...indexFeed,
      markdownArtifacts: {},
    }));
    const fetchText = vi.fn(async () => '# should not fetch');
    await expect(
      createFeedClient({fetchJson, fetchText}).stacksHubMarkdown?.(),
    ).rejects.toMatchObject({code: 'capability_unavailable'});
    expect(fetchText).not.toHaveBeenCalled();
  });

  it('rejects a mismatched advertised stacks hub URL', async () => {
    const fetchJson = vi.fn(async () => ({
      ...indexFeed,
      markdownArtifacts: {
        ...indexFeed.markdownArtifacts,
        stacksIndex: 'https://mirror.example.com/stacks.md',
      },
    }));
    const fetchText = vi.fn(async () => '# should not fetch');
    await expect(
      createFeedClient({fetchJson, fetchText}).stacksHubMarkdown?.(),
    ).rejects.toThrow(/same-origin/);
    expect(fetchText).not.toHaveBeenCalled();
  });

  it('fetches the advertised best-of hub artifact and preserves its body', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/api/index.json')) return new Response(JSON.stringify(indexFeed));
      expect(url).toBe('https://slothhub.dev/best.md');
      return new Response('# SlothHub Best-of lists', {
        headers: {'content-type': 'text/markdown; charset=utf-8'},
      });
    });
    vi.stubGlobal('fetch', fetch);
    try {
      await expect(createFeedClient().bestHubMarkdown?.()).resolves.toBe('# SlothHub Best-of lists');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reports the best-of hub capability as unavailable before fetching', async () => {
    const fetchJson = vi.fn(async () => ({
      ...indexFeed,
      markdownArtifacts: {},
    }));
    const fetchText = vi.fn(async () => '# should not fetch');
    await expect(
      createFeedClient({fetchJson, fetchText}).bestHubMarkdown?.(),
    ).rejects.toMatchObject({code: 'capability_unavailable'});
    expect(fetchText).not.toHaveBeenCalled();
  });

  it('rejects a mismatched advertised best-of hub URL', async () => {
    const fetchJson = vi.fn(async () => ({
      ...indexFeed,
      markdownArtifacts: {
        ...indexFeed.markdownArtifacts,
        bestIndex: 'https://mirror.example.com/best.md',
      },
    }));
    const fetchText = vi.fn(async () => '# should not fetch');
    await expect(
      createFeedClient({fetchJson, fetchText}).bestHubMarkdown?.(),
    ).rejects.toThrow(/same-origin/);
    expect(fetchText).not.toHaveBeenCalled();
  });

  it('times out when JSON or markdown response bodies stall after headers', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) =>
      url.endsWith('/api/index.json')
        ? new Response(JSON.stringify(indexFeed))
        : stalledResponse(init.signal as AbortSignal),
    ));
    try {
      const client = createFeedClient({fetchTimeoutMs: 10});
      const jsonRejection = expect(client.searchIndex()).rejects.toThrow('Request timed out after 10ms');
      await vi.advanceTimersByTimeAsync(10);
      await jsonRejection;
      const markdownRejection = expect(client.stacksHubMarkdown?.()).rejects.toThrow('Request timed out after 10ms');
      await vi.advanceTimersByTimeAsync(10);
      await markdownRejection;
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('preserves a caller abort reason while a response body is pending', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) =>
      url.endsWith('/api/index.json')
        ? new Response(JSON.stringify(indexFeed))
        : stalledResponse(init.signal as AbortSignal),
    ));
    try {
      const controller = new AbortController();
      const reason = new Error('caller cancelled');
      const pending = createFeedClient().stacksHubMarkdown?.(controller.signal);
      await Promise.resolve();
      controller.abort(reason);
      await expect(pending).rejects.toBe(reason);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

const toolLookupArtifact = {
  version: '5.0.0',
  complete: true,
  tools: new Array<ToolLookupArtifact['tools'][number]>(),
  aliases: new Array<ToolLookupArtifact['aliases'][number]>(),
  identityClaims: new Array<ToolLookupArtifact['identityClaims'][number]>(),
} satisfies ToolLookupArtifact;

const searchIndexFeed = {
  version: '17.0.0',
  siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-07-15T00:00:00.000Z',
  data: {
    tools: new Array<AgentSearchIndexFeed['data']['tools'][number]>(),
    filters: {
      pricing: new Array<AgentSearchIndexFeed['data']['filters']['pricing'][number]>(),
      platforms: new Array<AgentSearchIndexFeed['data']['filters']['platforms'][number]>(),
      resourceKinds: new Array<AgentSearchIndexFeed['data']['filters']['resourceKinds'][number]>(),
      securityCapabilities: new Array<NonNullable<AgentSearchIndexFeed['data']['filters']['securityCapabilities']>[number]>(),
      agentInterfaceKinds: new Array<NonNullable<AgentSearchIndexFeed['data']['filters']['agentInterfaceKinds']>[number]>(),
      categories: new Array<AgentSearchIndexFeed['data']['filters']['categories'][number]>(),
      tags: new Array<AgentSearchIndexFeed['data']['filters']['tags'][number]>(),
      useCases: new Array<AgentSearchIndexFeed['data']['filters']['useCases'][number]>(),
    },
    queryContract: {},
  },
} satisfies AgentSearchIndexFeed;

describe('shared feed cache cancellation', () => {
  it('shares slow fills across the cache lifetime and grants a full lifetime after validation', async () => {
    let clock = 0;
    const releases: Array<() => void> = [];
    const fetchJson = vi.fn(() => new Promise<FeedResponsePayload>((resolve) => {
      releases.push(() => resolve(indexFeed));
    }));
    const client = createFeedClient({fetchJson, cacheTtlMs: 10, now: () => clock});
    const first = client.index();
    clock = 11;
    const second = client.index();
    releases.splice(0).forEach((release) => release());
    await expect(Promise.all([first, second])).resolves.toMatchObject([{version: '33.0.0'}, {version: '33.0.0'}]);
    expect(fetchJson).toHaveBeenCalledOnce();

    clock = 20;
    const cached = client.index();
    releases.splice(0).forEach((release) => release());
    await expect(cached).resolves.toMatchObject({version: '33.0.0'});
    expect(fetchJson).toHaveBeenCalledOnce();
  });

  it('coalesces every active feed even when simultaneous fills exceed the retained cache capacity', async () => {
    const releases: Array<() => void> = [];
    const fetchJson = vi.fn((url: string) => new Promise<FeedResponsePayload>((resolve) => {
      releases.push(() => resolve(url.endsWith('/api/index.json') ? indexFeed : searchIndexFeed));
    }));
    const client = createFeedClient({fetchJson, indexFirst: false, maxCacheEntries: 1});
    const readers = [client.index(), client.searchIndex(), client.index(), client.searchIndex()];
    releases.splice(0).forEach((release) => release());
    const results = await Promise.all(readers);
    expect(results[0]).toMatchObject({version: '33.0.0'});
    expect(results[1]).toMatchObject({data: searchIndexFeed.data});
    expect(results[2]).toEqual(results[0]);
    expect(results[3]).toEqual(results[1]);
    expect(fetchJson.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      '/api/index.json', '/api/search-index.json',
    ]);
  });

  it('rejects all shared readers of an invalid leaf and permits a fresh validated retry', async () => {
    const leaf = {...searchIndexFeed, contentHash: computeContentHash(searchIndexFeed)};
    const indexBase = {...indexFeed, contentHashes: {'/api/search-index.json': leaf.contentHash}};
    const selfHash = computeIndexContentHash(indexBase);
    const index = {...indexBase, contentHash: selfHash, contentHashes: {...indexBase.contentHashes, '/api/index.json': selfHash}};
    let valid = false;
    const fetchJson = vi.fn(async (url: string) => url.endsWith('/api/index.json')
      ? index : {...leaf, contentHash: valid ? leaf.contentHash : 'invalid-hash'});
    const client = createFeedClient({fetchJson});
    await Promise.all([
      expect(client.searchIndex()).rejects.toThrow('content hash'),
      expect(client.searchIndex()).rejects.toThrow('content hash'),
    ]);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    valid = true;
    await expect(client.searchIndex()).resolves.toMatchObject({contentHash: leaf.contentHash});
    expect(fetchJson).toHaveBeenCalledTimes(4);
  });

  it('keeps a newer authenticated fill cached when an older cohort finishes later', async () => {
    let clock = 0;
    const oldLeaf = {...searchIndexFeed, contentHash: computeContentHash(searchIndexFeed)};
    const nextPayload = {...searchIndexFeed, data: {...searchIndexFeed.data,
      filters: {...searchIndexFeed.data.filters, pricing: [{value: 'free', label: 'Free', count: 1}]}}};
    const newLeaf = {...nextPayload, contentHash: computeContentHash(nextPayload)};
    const indexed = (hash: string) => {
      const source = {...indexFeed, contentHashes: {'/api/search-index.json': hash}};
      const selfHash = computeIndexContentHash(source);
      return {...source, contentHash: selfHash, contentHashes: {...source.contentHashes, '/api/index.json': selfHash}};
    };
    const releases: Array<(payload: FeedResponsePayload) => void> = [];
    const fetchJson = vi.fn((url: string) => url.endsWith('/api/index.json')
      ? Promise.resolve(indexed(clock === 0 ? oldLeaf.contentHash : newLeaf.contentHash))
      : new Promise<FeedResponsePayload>((resolve) => releases.push(resolve)));
    const client = createFeedClient({fetchJson, cacheTtlMs: 10, now: () => clock});
    const older = client.searchIndex();
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    clock = 11;
    const newer = client.searchIndex();
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[1]?.(newLeaf);
    await expect(newer).resolves.toEqual(newLeaf);
    releases[0]?.(oldLeaf);
    await expect(older).resolves.toEqual(oldLeaf);
    await expect(client.searchIndex()).resolves.toEqual(newLeaf);
    expect(fetchJson).toHaveBeenCalledTimes(4);
  });

  it('shares authenticated leaf requests while preserving independent cancellation', async () => {
    const catalogRevision = 'performance-fixture';
    const leafBase = {...searchIndexFeed, catalogRevision};
    const leaf = {...leafBase, contentHash: computeContentHash(leafBase)};
    const indexBase = {...indexFeed, catalogRevision, contentHashes: {'/api/search-index.json': leaf.contentHash}};
    const selfHash = computeIndexContentHash(indexBase);
    const index = {...indexBase, contentHash: selfHash, contentHashes: {...indexBase.contentHashes, '/api/index.json': selfHash}};
    let finishLeaf: ((payload: FeedResponsePayload) => void) | undefined;
    const fetchJson = vi.fn((url: string) => {
      if (url.endsWith('/api/index.json')) return Promise.resolve(index);
      return new Promise<FeedResponsePayload>((resolve) => {finishLeaf = resolve;});
    });
    const client = createFeedClient({fetchJson});
    await client.index();
    const controller = new AbortController();
    const cancelled = client.searchIndex(controller.signal);
    const cancellation = expect(cancelled).rejects.toThrow('caller cancelled');
    const remaining = Array.from({length: 10}, () => client.searchIndex());
    await vi.waitFor(() => expect(finishLeaf).toBeDefined());
    controller.abort(new Error('caller cancelled'));
    await cancellation;
    expect(fetchJson).toHaveBeenCalledTimes(2);
    finishLeaf?.(leaf);
    const results = await Promise.all(remaining);
    expect(results).toHaveLength(10);
    expect(results.every((result) => result.contentHash === leaf.contentHash)).toBe(true);
    await expect(client.searchIndex()).resolves.toEqual(results[0]);
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it('rejects a lookup that does not match the authenticated public index cohort', async () => {
    const indexedLookup = {...toolLookupArtifact, tools: [{
      slug: 'alpha', name: 'Alpha', detailUrl: 'https://slothhub.dev/tool/alpha',
      keys: [{namespace: 'slug', value: 'alpha'}],
    }]};
    const withoutSelf = {
      ...indexFeed,
      contentHashes: {'/api/tool-lookup.json': computeContentHash(indexedLookup)},
    };
    const selfHash = computeIndexContentHash(withoutSelf);
    const authenticatedIndex = {
      ...withoutSelf,
      contentHash: selfHash,
      contentHashes: {...withoutSelf.contentHashes, '/api/index.json': selfHash},
    };
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async (url) => url.endsWith('/api/index.json')
        ? authenticatedIndex
        : toolLookupArtifact,
    });

    await expect(client.toolLookup()).rejects.toThrow('content hash does not match');
  });

  it('accepts an exact indexed lookup without requiring an embedded self-hash', async () => {
    const withoutSelf = {
      ...indexFeed,
      contentHashes: {'/api/tool-lookup.json': computeContentHash(toolLookupArtifact)},
    };
    const selfHash = computeIndexContentHash(withoutSelf);
    const authenticatedIndex = {
      ...withoutSelf,
      contentHash: selfHash,
      contentHashes: {...withoutSelf.contentHashes, '/api/index.json': selfHash},
    };
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async (url) => url.endsWith('/api/index.json')
        ? authenticatedIndex
        : toolLookupArtifact,
    });

    await expect(client.toolLookup()).resolves.toEqual(toolLookupArtifact);
  });

  it.each(['alternatives', 'alternativesDetail'] as const)(
    'reports capability_unavailable when the index omits feeds.alternatives (%s)',
    async (method) => {
      const fetchJson = vi.fn(async (url: string) => {
        if (url.endsWith('/api/index.json')) return indexFeed;
        throw new Error(`unexpected ${url}`);
      });
      const client = createFeedClient({baseUrl: 'https://slothhub.dev', fetchJson});

      const call =
        method === 'alternatives'
          ? client.alternatives()
          : client.alternativesDetail('example-tool');
      await expect(call).rejects.toMatchObject({code: 'capability_unavailable'});
      expect(fetchJson).toHaveBeenCalledTimes(1);
    },
  );

  it('loads the alternatives index and detail leaves an advertising index authenticates', async () => {
    const alternativesBase = {
      version: '33.0.0',
      siteUrl: 'https://slothhub.dev',
      generatedAt: '2026-07-15T00:00:00.000Z',
      data: {alternativesUrl: 'https://slothhub.dev/alternatives', sets: []},
    };
    const detailBase = {
      version: '33.0.0',
      siteUrl: 'https://slothhub.dev',
      generatedAt: '2026-07-15T00:00:00.000Z',
      data: {
        name: 'Example Tool',
        slug: 'example-tool',
        detailUrl: 'https://slothhub.dev/tool/example-tool',
        alternativesUrl: 'https://slothhub.dev/alternatives/example-tool',
        alternativeCount: 1,
        alternatives: [
          {
            name: 'Alternative Tool',
            slug: 'alternative-tool',
            description: 'An alternative',
            resourceKind: {value: 'app', label: 'App'},
            resourceIdentity: {
              kind: 'website',
              kindLabel: 'Website',
              canonicalUrl: 'https://alt.example.com/',
              ctaLabel: 'Open site',
            },
            pricing: 'free',
            platforms: ['web'],
            categories: [],
            tags: [],
            useCases: [],
            freshness: {isVerified: true, verifiedAt: '2026-07-01T00:00:00.000Z'},
            detailUrl: 'https://slothhub.dev/tool/alternative-tool',
            visitUrl: 'https://slothhub.dev/go/alternative-tool?surface=agent',
          },
        ],
        markdownUrl: 'https://slothhub.dev/alternatives/example-tool.md',
        jsonUrl: 'https://slothhub.dev/api/alternatives/example-tool.json',
        sourceTool: {
          name: 'Example Tool',
          slug: 'example-tool',
          description: 'A tool',
          resourceKind: {value: 'app', label: 'App'},
          resourceIdentity: {
            kind: 'website',
            kindLabel: 'Website',
            canonicalUrl: 'https://example.com/',
            ctaLabel: 'Open site',
          },
          pricing: 'free',
          platforms: ['web'],
          categories: [],
          tags: [],
          useCases: [],
          freshness: {isVerified: true, verifiedAt: '2026-07-01T00:00:00.000Z'},
          detailUrl: 'https://slothhub.dev/tool/example-tool',
          visitUrl: 'https://slothhub.dev/go/example-tool?surface=agent',
        },
      },
    };
    const alternativesPayload = {
      ...alternativesBase,
      contentHash: computeContentHash(alternativesBase),
    };
    const detailPayload = {
      ...detailBase,
      contentHash: computeContentHash(detailBase),
    };
    const withoutSelf = {
      ...indexFeed,
      feeds: {
        ...indexFeed.feeds,
        alternatives: 'https://slothhub.dev/api/alternatives.json',
      },
      alternativesDetailUrlTemplate:
        'https://slothhub.dev/api/alternatives/{slug}.json',
      contentHashes: {
        '/api/alternatives.json': computeContentHash(alternativesBase),
        '/api/alternatives/example-tool.json': computeContentHash(detailBase),
      },
    };
    const selfHash = computeIndexContentHash(withoutSelf);
    const authenticatedIndex = {
      ...withoutSelf,
      contentHash: selfHash,
      contentHashes: {...withoutSelf.contentHashes, '/api/index.json': selfHash},
    };
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async (url) => {
        if (url.endsWith('/api/index.json')) return authenticatedIndex;
        if (url.endsWith('/api/alternatives.json')) return alternativesPayload;
        if (url.endsWith('/api/alternatives/example-tool.json')) return detailPayload;
        throw new Error(`unexpected ${url}`);
      },
    });

    await expect(client.alternatives()).resolves.toEqual(alternativesPayload);
    await expect(client.alternativesDetail('example-tool')).resolves.toEqual(
      detailPayload,
    );
  });

  it('rejects a malformed alternatives detail slug before fetching', async () => {
    const fetchJson = vi.fn(async (url: string) => {
      if (url.endsWith('/api/index.json')) return indexFeed;
      throw new Error(`unexpected ${url}`);
    });
    const client = createFeedClient({baseUrl: 'https://slothhub.dev', fetchJson});

    await expect(
      client.alternativesDetail('../tools'),
    ).rejects.toThrow('Invalid alternatives slug');
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it.each(['comparisons', 'comparisonDetail'] as const)(
    'reports capability_unavailable when the index omits feeds.comparisons (%s)',
    async (method) => {
      const fetchJson = vi.fn(async (url: string) => {
        if (url.endsWith('/api/index.json')) return indexFeed;
        throw new Error(`unexpected ${url}`);
      });
      const client = createFeedClient({baseUrl: 'https://slothhub.dev', fetchJson});

      const call =
        method === 'comparisons'
          ? client.comparisons()
          : client.comparisonDetail('figma-vs-sketch');
      await expect(call).rejects.toMatchObject({code: 'capability_unavailable'});
      expect(fetchJson).toHaveBeenCalledTimes(1);
    },
  );

  it('loads the comparisons index and detail leaves an advertising index authenticates', async () => {
    const pairTool = (slug: string) => ({
      name: slug,
      slug,
      description: 'A tool',
      resourceKind: {value: 'app', label: 'App'},
      resourceIdentity: {
        kind: 'website',
        kindLabel: 'Website',
        canonicalUrl: `https://${slug}.example.com/`,
        ctaLabel: 'Open site',
      },
      pricing: 'free',
      platforms: ['web'],
      categories: [],
      tags: [],
      useCases: [],
      freshness: {isVerified: true, verifiedAt: '2026-07-01T00:00:00.000Z'},
      detailUrl: `https://slothhub.dev/tool/${slug}`,
      visitUrl: `https://slothhub.dev/go/${slug}?surface=agent`,
    });
    const comparisonsBase = {
      version: '33.0.0',
      siteUrl: 'https://slothhub.dev',
      generatedAt: '2026-07-15T00:00:00.000Z',
      data: {comparisonsUrl: 'https://slothhub.dev/compare', comparisons: []},
    };
    const detailBase = {
      version: '33.0.0',
      siteUrl: 'https://slothhub.dev',
      generatedAt: '2026-07-15T00:00:00.000Z',
      data: {
        slug: 'figma-vs-sketch',
        title: 'Figma vs Sketch',
        pageUrl: 'https://slothhub.dev/compare/figma-vs-sketch',
        jsonUrl: 'https://slothhub.dev/api/compare/figma-vs-sketch.json',
        markdownUrl: 'https://slothhub.dev/compare/figma-vs-sketch.md',
        primary: pairTool('figma'),
        secondary: pairTool('sketch'),
      },
    };
    const comparisonsPayload = {
      ...comparisonsBase,
      contentHash: computeContentHash(comparisonsBase),
    };
    const detailPayload = {
      ...detailBase,
      contentHash: computeContentHash(detailBase),
    };
    const withoutSelf = {
      ...indexFeed,
      feeds: {
        ...indexFeed.feeds,
        comparisons: 'https://slothhub.dev/api/compare.json',
      },
      comparisonDetailUrlTemplate:
        'https://slothhub.dev/api/compare/{slug}.json',
      contentHashes: {
        '/api/compare.json': computeContentHash(comparisonsBase),
        '/api/compare/figma-vs-sketch.json': computeContentHash(detailBase),
      },
    };
    const selfHash = computeIndexContentHash(withoutSelf);
    const authenticatedIndex = {
      ...withoutSelf,
      contentHash: selfHash,
      contentHashes: {...withoutSelf.contentHashes, '/api/index.json': selfHash},
    };
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async (url) => {
        if (url.endsWith('/api/index.json')) return authenticatedIndex;
        if (url.endsWith('/api/compare.json')) return comparisonsPayload;
        if (url.endsWith('/api/compare/figma-vs-sketch.json')) return detailPayload;
        throw new Error(`unexpected ${url}`);
      },
    });

    await expect(client.comparisons()).resolves.toEqual(comparisonsPayload);
    await expect(client.comparisonDetail('figma-vs-sketch')).resolves.toEqual(
      detailPayload,
    );
  });

  it('rejects a malformed comparison detail slug before fetching', async () => {
    const fetchJson = vi.fn(async (url: string) => {
      if (url.endsWith('/api/index.json')) return indexFeed;
      throw new Error(`unexpected ${url}`);
    });
    const client = createFeedClient({baseUrl: 'https://slothhub.dev', fetchJson});

    await expect(
      client.comparisonDetail('../tools'),
    ).rejects.toThrow('Invalid comparison slug');
    expect(fetchJson).not.toHaveBeenCalled();
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
    const withoutSelf = {
      ...indexFeed,
      contentHashes: {'/api/tool-lookup.json': computeContentHash(oversizedLookup)},
    };
    const selfHash = computeIndexContentHash(withoutSelf);
    const authenticatedIndex = {
      ...withoutSelf,
      contentHash: selfHash,
      contentHashes: {...withoutSelf.contentHashes, '/api/index.json': selfHash},
    };
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async (url) => url.endsWith('/api/index.json')
        ? authenticatedIndex
        : oversizedLookup,
    });

    await expect(client.toolLookup()).rejects.toMatchObject({
      code: 'tool_lookup_identity_claim_limit_exceeded',
      configuredLimit: 5_000,
      observedValue: 5_001,
      recovery: expect.stringContaining('Reduce'),
    });
  });

  it('fails closed when an indexed lookup projection returns 404', async () => {
    const withoutSelf = {
      ...indexFeed,
      contentHashes: {'/api/tool-lookup.json': computeContentHash(toolLookupArtifact)},
    };
    const selfHash = computeIndexContentHash(withoutSelf);
    const authenticatedIndex = {
      ...withoutSelf,
      contentHash: selfHash,
      contentHashes: {...withoutSelf.contentHashes, '/api/index.json': selfHash},
    };
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async (url) => {
        if (url.endsWith('/api/index.json')) return authenticatedIndex;
        throw new Error('HTTP 404 Not Found');
      },
    });

    await expect(client.toolLookup()).rejects.toMatchObject({
      path: '/api/tool-lookup.json',
      status: 404,
    });
  });

  it('retains legacy lookup absence when the index has no hash contract', async () => {
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async (url) => {
        if (url.endsWith('/api/index.json')) return indexFeed;
        throw new Error('HTTP 404 Not Found');
      },
    });

    await expect(client.toolLookup()).resolves.toBeNull();
  });

  it.each([false, true])('refreshes an unchanged lookup from its indexed hash (noCache=%s)', async (noCache) => {
    const withoutSelf = {
      ...indexFeed,
      contentHashes: {'/api/tool-lookup.json': computeContentHash(toolLookupArtifact)},
    };
    const contentHash = computeIndexContentHash(withoutSelf);
    let currentTime = 0;
    const fetchJson = vi.fn(async (url: string) => url.endsWith('/api/index.json')
      ? {...withoutSelf, contentHash, contentHashes: {...withoutSelf.contentHashes, '/api/index.json': contentHash}}
      : toolLookupArtifact);
    const client = createFeedClient({fetchJson, noCache, cacheTtlMs: 10, now: () => currentTime});

    const first = await client.toolLookup();
    currentTime = 11;
    const refreshed = await client.toolLookup();

    expect(refreshed).toEqual(first);
    if (!noCache) expect(refreshed).toBe(first);
    expect(fetchJson.mock.calls.filter(([url]) => url.endsWith('/api/index.json'))).toHaveLength(2);
    expect(fetchJson.mock.calls.filter(([url]) => url.endsWith('/api/tool-lookup.json'))).toHaveLength(noCache ? 2 : 1);
  });

  it('refetches an expired legacy lookup without an authenticated hash', async () => {
    let currentTime = 0;
    const fetchJson = vi.fn(async (url: string) => url.endsWith('/api/index.json') ? indexFeed : toolLookupArtifact);
    const client = createFeedClient({fetchJson, cacheTtlMs: 10, now: () => currentTime});
    await client.toolLookup();
    currentTime = 11;
    await client.toolLookup();
    expect(fetchJson.mock.calls.filter(([url]) => url.endsWith('/api/tool-lookup.json'))).toHaveLength(2);
  });

  it('refetches a cached lookup when a newer index authenticates another cohort', async () => {
    const nextLookup = {...toolLookupArtifact, tools: [{
      slug: 'alpha', name: 'Alpha', detailUrl: 'https://slothhub.dev/tool/alpha',
      keys: [{namespace: 'slug', value: 'alpha'}],
    }], aliases: [{
      slug: 'old-alpha', sourceToolId: 'tool-old-alpha', canonicalSlug: 'alpha',
    }]} satisfies ToolLookupArtifact;
    const indexed = (lookup: typeof toolLookupArtifact, generatedAt: string) => {
      const withoutSelf = {
        ...indexFeed,
        generatedAt,
        contentHashes: {'/api/tool-lookup.json': computeContentHash(lookup)},
      };
      const selfHash = computeIndexContentHash(withoutSelf);
      return {
        ...withoutSelf,
        contentHash: selfHash,
        contentHashes: {...withoutSelf.contentHashes, '/api/index.json': selfHash},
      };
    };
    let currentTime = 0;
    let indexRequest = 0;
    let lookupRequest = 0;
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      cacheTtlMs: 10,
      now: () => currentTime,
      fetchJson: async (url) => {
        if (url.endsWith('/api/index.json')) {
          indexRequest += 1;
          return indexRequest === 1
            ? indexed(toolLookupArtifact, '2026-07-15T00:00:00.000Z')
            : indexed(nextLookup, '2026-07-15T00:01:00.000Z');
        }
        lookupRequest += 1;
        return lookupRequest === 1 ? toolLookupArtifact : nextLookup;
      },
    });

    await expect(client.toolLookup()).resolves.toEqual(toolLookupArtifact);
    currentTime = 11;
    await expect(client.index()).resolves.toMatchObject({
      generatedAt: '2026-07-15T00:01:00.000Z',
    });
    currentTime = 12;
    await expect(client.toolLookup()).resolves.toEqual(nextLookup);
    expect(lookupRequest).toBe(2);
  });

  it('refetches a cached leaf after the index advances to another cohort', async () => {
    const firstHash = computeContentHash(searchIndexFeed);
    const firstSearchIndex = {...searchIndexFeed, contentHash: firstHash};
    const nextSearchPayload = {
      ...searchIndexFeed,
      generatedAt: '2026-07-15T00:01:00.000Z',
      data: {
        ...searchIndexFeed.data,
        filters: {
          ...searchIndexFeed.data.filters,
          pricing: [{value: 'free', label: 'Free', count: 1}],
        },
      },
    };
    const nextHash = computeContentHash(nextSearchPayload);
    const nextSearchIndex = {...nextSearchPayload, contentHash: nextHash};
    const indexed = (searchIndex: typeof searchIndexFeed, generatedAt: string) => {
      const withoutSelf = {
        ...indexFeed,
        generatedAt,
        contentHashes: {
          '/api/search-index.json': computeContentHash(searchIndex),
        },
      };
      const selfHash = computeIndexContentHash(withoutSelf);
      return {
        ...withoutSelf,
        contentHash: selfHash,
        contentHashes: {
          ...withoutSelf.contentHashes,
          '/api/index.json': selfHash,
        },
      };
    };
    let currentTime = 0;
    let indexRequest = 0;
    let searchRequest = 0;
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      cacheTtlMs: 10,
      now: () => currentTime,
      fetchJson: async (url) => {
        if (url.endsWith('/api/index.json')) {
          indexRequest += 1;
          const current = indexRequest === 1 ? firstSearchIndex : nextSearchIndex;
          if (indexRequest === 1) currentTime = 1;
          return indexed(current, current.generatedAt);
        }
        searchRequest += 1;
        return searchRequest === 1 ? firstSearchIndex : nextSearchIndex;
      },
    });

    await expect(client.searchIndex()).resolves.toEqual(firstSearchIndex);
    currentTime = 11;
    await expect(client.searchIndex()).resolves.toEqual(nextSearchIndex);
    expect(indexRequest).toBe(2);
    expect(searchRequest).toBe(2);
  });

  it('returns an authenticated parsed leaf without re-reading its source payload', async () => {
    const searchHash = computeContentHash(searchIndexFeed);
    let sourceDataReads = 0;
    const sourcePayload = {
      ...searchIndexFeed,
      contentHash: searchHash,
      get data() {
        sourceDataReads += 1;
        return searchIndexFeed.data;
      },
    };
    const withoutSelf = {
      ...indexFeed,
      contentHashes: {'/api/search-index.json': searchHash},
    };
    const selfHash = computeIndexContentHash(withoutSelf);
    const authenticatedIndex = {
      ...withoutSelf,
      contentHash: selfHash,
      contentHashes: {...withoutSelf.contentHashes, '/api/index.json': selfHash},
    };
    const fetchJson = vi.fn(async (url: string) =>
      url.endsWith('/api/index.json') ? authenticatedIndex : sourcePayload,
    );
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson,
    });

    await client.searchIndex();
    sourceDataReads = 0;
    await client.searchIndex();

    expect(sourceDataReads).toBe(0);
    expect(
      fetchJson.mock.calls.filter(([url]) => url.endsWith('/api/search-index.json')),
    ).toHaveLength(1);
  });

  it('rejects a self-hash mismatch before trusting indexed leaves', async () => {
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async () => ({
        ...indexFeed,
        contentHash: `sha256:${'0'.repeat(64)}`,
        contentHashes: {'/api/index.json': `sha256:${'0'.repeat(64)}`},
      }),
    });

    await expect(client.index()).rejects.toThrow('index content hash is invalid');
  });

  it('isolates concurrent waiters when one caller is cancelled', async () => {
    let resolveFetch: ((payload: FeedResponsePayload) => void) | undefined;
    const fetchJson = vi.fn(
      (_url: string, options?: { signal?: AbortSignal }) =>
        new Promise<FeedResponsePayload>((resolve) => {
          expect(options?.signal).toEqual(expect.any(AbortSignal));
          resolveFetch = resolve;
        }),
    );
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson,
    });
    const firstController = new AbortController();

    const first = client.index(firstController.signal);
    const second = client.index();
    firstController.abort(new Error('first caller cancelled'));

    await expect(first).rejects.toThrow('first caller cancelled');
    resolveFetch?.(indexFeed);
    await expect(second).resolves.toMatchObject({ version: '33.0.0' });
    expect(fetchJson).toHaveBeenCalledOnce();
    expect(
      fetchJson.mock.calls[0]?.[1]?.signal === firstController.signal,
    ).toBe(false);
  });

  it('starts a fresh fill when a new caller arrives immediately after the last waiter cancels', async () => {
    let resolveReplacement: ((payload: FeedResponsePayload) => void) | undefined;
    const fetchJson = vi.fn(
      (_url: string, options?: { signal?: AbortSignal }) => {
        if (fetchJson.mock.calls.length === 1) {
          return new Promise<FeedResponsePayload>((_resolve, reject) => {
            options?.signal?.addEventListener(
              'abort',
              () => reject(options.signal?.reason),
              { once: true },
            );
          });
        }
        return new Promise<FeedResponsePayload>((resolve) => {
          resolveReplacement = resolve;
        });
      },
    );
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson,
    });
    const firstController = new AbortController();
    const first = client.index(firstController.signal);
    const firstRejection = expect(first).rejects.toThrow('first cancelled');

    firstController.abort(new Error('first cancelled'));
    const replacement = client.index();

    await firstRejection;
    expect(fetchJson).toHaveBeenCalledTimes(2);
    resolveReplacement?.(indexFeed);
    await expect(replacement).resolves.toMatchObject({ version: '33.0.0' });
  });

  it('evicts settled entries when the configured cache bound is reached', async () => {
    const fetchJson = vi.fn(async (url: string) => {
      if (url.endsWith('/api/index.json')) return indexFeed;
      if (url.endsWith('/api/tool-lookup.json')) return toolLookupArtifact;
      throw new Error(`unexpected ${url}`);
    });
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson,
      maxCacheEntries: 1,
    });

    await client.index();
    await client.toolLookup();
    await client.index();

    expect(
      fetchJson.mock.calls.filter(([url]) => url.endsWith('/api/index.json')),
    ).toHaveLength(2);
  });

  it('touches cache hits before evicting the least-recently-used entry', async () => {
    const fetchJson = vi.fn(async (url: string) => {
      if (url.endsWith('/api/index.json')) return indexFeed;
      if (url.endsWith('/api/tool-lookup.json')) return toolLookupArtifact;
      if (url.endsWith('/api/search-index.json')) return searchIndexFeed;
      throw new Error(`unexpected ${url}`);
    });
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson,
      maxCacheEntries: 2,
    });

    await client.index();
    await client.toolLookup();
    await client.index();
    await client.searchIndex();
    await client.toolLookup();

    expect(
      fetchJson.mock.calls.filter(([url]) => url.endsWith('/api/index.json')),
    ).toHaveLength(1);
    expect(
      fetchJson.mock.calls.filter(([url]) =>
        url.endsWith('/api/tool-lookup.json'),
      ),
    ).toHaveLength(2);
  });

  it('does not evict in-flight fills when the retained cache is full', async () => {
    let resolveLookup: ((payload: FeedResponsePayload) => void) | undefined;
    let resolveSearch: ((payload: FeedResponsePayload) => void) | undefined;
    const leafSignals: AbortSignal[] = [];
    const fetchJson = vi.fn(
      (url: string, options?: { signal?: AbortSignal }) => {
        if (url.endsWith('/api/index.json')) {
          return Promise.resolve(indexFeed);
        }
        if (options?.signal) leafSignals.push(options.signal);
        if (url.endsWith('/api/tool-lookup.json')) {
          return new Promise<FeedResponsePayload>((resolve) => {
            resolveLookup = resolve;
          });
        }
        if (url.endsWith('/api/search-index.json')) {
          return new Promise<FeedResponsePayload>((resolve) => {
            resolveSearch = resolve;
          });
        }
        return Promise.reject(new Error(`unexpected ${url}`));
      },
    );
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson,
      maxCacheEntries: 1,
    });
    await client.index();

    const lookup = client.toolLookup();
    const search = client.searchIndex();
    await vi.waitFor(() => {
      expect(resolveLookup).toEqual(expect.any(Function));
      expect(resolveSearch).toEqual(expect.any(Function));
    });
    resolveLookup?.(toolLookupArtifact);
    resolveSearch?.(searchIndexFeed);

    await expect(Promise.all([lookup, search])).resolves.toHaveLength(2);
    expect(leafSignals).toHaveLength(2);
    expect(leafSignals.every((signal) => !signal.aborted)).toBe(true);
  });
});


it('reports an obsolete lookup artifact as unsupported before parsing its keys', async () => {
  const obsolete = {version: '4.0.0', complete: true, tools: [], aliases: [], identityClaims: []};
  const client = createFeedClient({
    baseUrl: 'https://slothhub.dev',
    fetchJson: async (url) => url.endsWith('/api/index.json') ? indexFeed : obsolete,
  });
  await expect(client.toolLookup()).rejects.toMatchObject({code: 'unsupported_version', observedVersion: '4.0.0'});
});
