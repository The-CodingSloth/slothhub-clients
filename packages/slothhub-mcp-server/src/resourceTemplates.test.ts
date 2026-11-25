import {Client, InMemoryTransport} from '@modelcontextprotocol/client';
import {ProtocolErrorCode} from '@modelcontextprotocol/server';
import {AgentSearchPayloadLimitError} from '@slothhub/domain/agent-search';
import {afterEach, describe, expect, it, vi} from 'vite-plus/test';

import {FEED_FETCH_TIMEOUT_MS, MAX_FEED_RESPONSE_BYTES} from './constants.js';
import {createSlothHubMcpServer} from './server.js';
import {createFeedClient} from './services/feeds.js';
import {computeContentHash, computeIndexContentHash} from '@slothhub/domain/public-feed-content-identity';
import type {AgentCuratedListFeed, AgentIndexFeed, AgentToolStackFeed} from './types.js';

const envelope = {
  version: '33.0.0',
  siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-09-07T00:00:00.000Z',
};
// The comparison listing reads /api/compare.json beside stacks and best-of lists.
const emptyComparisons = {...envelope, data: {comparisonsUrl: 'https://slothhub.dev/compare', comparisons: []}};
const stacks: AgentToolStackFeed = {
  ...envelope,
  data: {stacks: [{name: 'Design stack', slug: 'design-stack',
    url: 'https://slothhub.dev/stacks/design-stack', tags: [], tools: []}]},
};
const best: AgentCuratedListFeed = {
  ...envelope,
  data: {best: [{title: 'Best design tools', slug: 'design-tools',
    url: 'https://slothhub.dev/best/design-tools', rankedTools: []}]},
};
const collections = [
  {name: 'stacks', path: '/api/stacks.json', uri: 'slothhub://stack/design-stack',
    feed: stacks, empty: {...envelope, data: {stacks: []}}},
  {name: 'best', path: '/api/best.json', uri: 'slothhub://best/design-tools',
    feed: best, empty: {...envelope, data: {best: []}}},
] as const;

const connections: Array<{client: Client; closeServer: () => Promise<void>}> = [];

const signalEvent = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {resolve = done;});
  return {promise, resolve};
};

afterEach(async () => {
  await Promise.all(connections.splice(0).map(async ({client, closeServer}) => {
    await client.close();
    await closeServer();
  }));
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const connect = async (feedClient = createFeedClient({indexFirst: false})) => {
  const server = createSlothHubMcpServer({feedClient});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({name: 'resource-list-test', version: '0.0.0'});
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  connections.push({client, closeServer: () => server.close()});
  return client;
};

const authenticateFeed = <Feed extends AgentToolStackFeed | AgentCuratedListFeed>(feed: Feed) =>
  ({...feed, contentHash: computeContentHash(feed)});

const catalogIndex = (
  stackFeed: AgentToolStackFeed,
  bestFeed: AgentCuratedListFeed,
  catalogRevision = 'a',
): AgentIndexFeed => {
  const index: AgentIndexFeed = {
    ...envelope, catalogRevision,
    schemaUrl: 'https://slothhub.dev/api/schema.json',
    snapshots: {full: 'https://slothhub.dev/api/catalog.snapshot.json', ndjson: 'https://slothhub.dev/api/catalog.ndjson'},
    feeds: {
      tools: 'https://slothhub.dev/api/tools.json',
      searchIndex: 'https://slothhub.dev/api/search-index.json',
      categories: 'https://slothhub.dev/api/categories.json',
      tags: 'https://slothhub.dev/api/tags.json',
      useCases: 'https://slothhub.dev/api/use-cases.json',
      stacks: 'https://slothhub.dev/api/stacks.json',
      best: 'https://slothhub.dev/api/best.json',
    },
    contentHashes: {
      '/api/stacks.json': computeContentHash(stackFeed),
      '/api/best.json': computeContentHash(bestFeed),
    },
    markdownArtifacts: {},
    integrationHubUrl: 'https://slothhub.dev/agents',
    markdownHubUrl: 'https://slothhub.dev/agents.md',
    toolDetailUrlTemplate: 'https://slothhub.dev/api/tools/{slug}.json',
    citationGuidance: [],
  };
  const contentHash = computeIndexContentHash(index);
  return {...index, contentHash, contentHashes: {...index.contentHashes, '/api/index.json': contentHash}};
};

const healthyResponse = (url: string): Response =>
  Response.json(url.endsWith('/api/compare.json') ? emptyComparisons : url.endsWith('/api/stacks.json') ? stacks : best);

const expectFeedFailure = (request: ReturnType<Client['listResources']>) =>
  expect(request).rejects.toMatchObject({
    code: ProtocolErrorCode.InternalError,
    message: expect.stringContaining(
      'feed_load_error: listing resources: Collection feed unavailable. Retry resources/list.',
    ),
    data: {
      code: 'feed_load_error',
      recovery: 'Try slothhub_check_status to verify feed URLs, or set SLOTHHUB_BASE_URL.',
    },
  });

describe('registered collection resource lists', () => {
  it('does not let a rejected index refresh authorize cached completions and recovers on retry', async () => {
    const stackFeed = authenticateFeed({...stacks, catalogRevision: 'a'});
    const bestFeed = authenticateFeed({...best, catalogRevision: 'a'});
    const validIndex = catalogIndex(stackFeed, bestFeed);
    const invalidIndex = {...validIndex, citationGuidance: ['Changed without updating the self hash']};
    let now = 0;
    let rejectIndex = false;
    const fetchJson = vi.fn(async (url: string) => url.endsWith('/api/index.json') ? (rejectIndex ? invalidIndex : validIndex) : stackFeed);
    const feed = createFeedClient({fetchJson, now: () => now, cacheTtlMs: 1000});
    const client = await connect(feed);
    await feed.stacks();
    now = 500;
    await feed.stacks(); // Authenticated leaf TTL now extends beyond the index TTL.
    const completeStack = () => client.complete({ref: {type: 'ref/resource', uri: 'slothhub://stack/{slug}'}, argument: {name: 'slug', value: ''}});
    expect((await completeStack()).completion.values).toEqual(['design-stack']);
    now = 1001;
    rejectIndex = true;
    await expect(feed.index()).rejects.toThrow('Public feed index content hash is invalid');
    const requestCount = fetchJson.mock.calls.length;
    expect((await completeStack()).completion.values).toEqual([]);
    expect(fetchJson).toHaveBeenCalledTimes(requestCount);
    rejectIndex = false;
    await feed.index();
    expect((await completeStack()).completion.values).toEqual(['design-stack']);
    expect(fetchJson).toHaveBeenCalledTimes(requestCount + 1);
  });
  it('keeps fixed resources when both validated collections are empty', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) =>
      Response.json(String(input).endsWith('/api/compare.json') ? emptyComparisons : String(input).endsWith('/api/stacks.json')
        ? collections[0].empty : collections[1].empty));
    vi.stubGlobal('fetch', fetch);
    const client = await connect();

    const result = await client.listResources();

    expect(result.resources.length).toBeGreaterThan(0);
    expect(result.resources.every(({uri}) => uri.startsWith('slothhub://feed/') || uri === 'slothhub://artifact/interfaces' || uri === 'slothhub://artifact/stacks' || uri === 'slothhub://artifact/best' || uri === 'slothhub://artifact/compare')).toBe(true);
    expect(result.resources.some(({uri}) => uri === 'slothhub://feed/index')).toBe(true);
    // One request per listed collection: stacks, best-of lists and comparisons.
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('does not let a late old-index failure evict a newer validated index', async () => {
    const oldStack = authenticateFeed({...stacks, catalogRevision: 'a'});
    const oldBest = authenticateFeed({...best, catalogRevision: 'a'});
    const newStack = authenticateFeed({...stacks, catalogRevision: 'b'});
    const newBest = authenticateFeed({...best, catalogRevision: 'b'});
    const started = signalEvent();
    let finishOld!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {finishOld = resolve;});
    let indexRequests = 0;
    let bestRequests = 0;
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/index.json')) {
        indexRequests += 1;
        return Response.json(indexRequests === 1
          ? catalogIndex(oldStack, oldBest) : catalogIndex(newStack, newBest, 'b'));
      }
      if (url.endsWith('/api/stacks.json')) return Response.json(newStack);
      bestRequests += 1;
      if (bestRequests === 1) {
        started.resolve();
        return pending;
      }
      return Response.json(newBest);
    }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = await connect(createFeedClient());
    // Keep an old-index leaf read in flight while a separate list request
    // rejects the old index, then recovers with the new catalog.
    const oldFailure = expect(client.readResource({uri: collections[1].uri})).rejects.toThrow(/feed_load_error/);
    await started.promise;
    await expectFeedFailure(client.listResources());
    expect((await client.listResources()).resources.some(({uri}) => uri === collections[1].uri)).toBe(true);
    finishOld(Response.json(newBest));
    await oldFailure;
    await client.listResources();
    expect(indexRequests).toBe(2);
    expect(bestRequests).toBe(2);
  });

  describe.each(collections)('$name collection', (collection) => {
    it.each(['declared', 'streamed'] as const)('preserves the %s byte limit through the index-first SDK interface', async (lengthKind) => {
      const stackFeed = authenticateFeed({...stacks, catalogRevision: 'a'});
      const bestFeed = authenticateFeed({...best, catalogRevision: 'a'});
      const index = catalogIndex(stackFeed, bestFeed);
      const cancel = vi.fn();
      vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = String(input);
        if (url.endsWith('/api/index.json')) return Response.json(index);
        if (!url.endsWith(collection.path)) return Response.json(url.endsWith('/api/compare.json') ? emptyComparisons : url.endsWith('/api/stacks.json') ? stackFeed : bestFeed);
        if (lengthKind === 'declared') {
          return new Response('private upstream body', {headers: {'content-length': String(MAX_FEED_RESPONSE_BYTES + 1)}});
        }
        return new Response(new ReadableStream<Uint8Array>({start(controller) {
          controller.enqueue(new Uint8Array(MAX_FEED_RESPONSE_BYTES));
          controller.enqueue(new Uint8Array(1));
        }, cancel}));
      }));
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      const client = await connect(createFeedClient());
      const expected = new AgentSearchPayloadLimitError(MAX_FEED_RESPONSE_BYTES, MAX_FEED_RESPONSE_BYTES + 1);
      await expect(client.listResources()).rejects.toMatchObject({
        code: ProtocolErrorCode.InternalError,
        message: expected.message,
        data: {code: expected.code, configuredLimitBytes: MAX_FEED_RESPONSE_BYTES,
          observedBytes: MAX_FEED_RESPONSE_BYTES + 1, recovery: expected.recovery},
      });
      expect(log.mock.calls).toEqual([[`feed_list_error: ${collection.name}`]]);
      if (lengthKind === 'streamed') expect(cancel).toHaveBeenCalledOnce();
    });

    it('retains the authenticated index after an ordinary network failure', async () => {
      const stackFeed = authenticateFeed({...stacks, catalogRevision: 'a'});
      const bestFeed = authenticateFeed({...best, catalogRevision: 'a'});
      let failing = true;
      const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = String(input);
        if (url.endsWith('/api/index.json')) return Response.json(catalogIndex(stackFeed, bestFeed));
        if (failing && url.endsWith(collection.path)) throw new Error('network unavailable');
        return Response.json(url.endsWith('/api/compare.json') ? emptyComparisons : url.endsWith('/api/stacks.json') ? stackFeed : bestFeed);
      });
      vi.stubGlobal('fetch', fetch);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const client = await connect(createFeedClient());
      await expectFeedFailure(client.listResources());
      failing = false;
      expect((await client.listResources()).resources.some(({uri}) => uri === collection.uri)).toBe(true);
      expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/api/index.json'))).toHaveLength(1);
    });

    it.each(['hash', 'revision'] as const)('reloads the rejected source index after %s mismatch on an explicit retry', async (mismatch) => {
      const oldStack = authenticateFeed({...stacks, catalogRevision: 'a'});
      const oldBest = authenticateFeed({...best, catalogRevision: 'a'});
      const revision = mismatch === 'revision' ? 'b' : 'a';
      const newStack = authenticateFeed({...stacks, catalogRevision: revision,
        data: {stacks: stacks.data.stacks.map((item) => ({...item, name: 'Updated stack'}))}});
      const newBest = authenticateFeed({...best, catalogRevision: revision,
        data: {best: best.data.best.map((item) => ({...item, title: 'Updated best list'}))}});
      // For revision-only failure the index authenticates the new leaf hash but
      // still declares revision a. Hash-only failure keeps revision a throughout.
      const oldIndex = catalogIndex(
        mismatch === 'revision' && collection.name === 'stacks' ? newStack : oldStack,
        mismatch === 'revision' && collection.name === 'best' ? newBest : oldBest,
      );
      const newIndex = catalogIndex(newStack, newBest, revision);
      let recovered = false;
      const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = String(input);
        if (url.endsWith('/api/index.json')) return Response.json(recovered ? newIndex : oldIndex);
        if (recovered || url.endsWith(collection.path)) return Response.json(url.endsWith('/api/compare.json') ? emptyComparisons : url.endsWith('/api/stacks.json') ? newStack : newBest);
        return Response.json(url.endsWith('/api/compare.json') ? emptyComparisons : url.endsWith('/api/stacks.json') ? oldStack : oldBest);
      });
      vi.stubGlobal('fetch', fetch);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const client = await connect(createFeedClient());
      await expectFeedFailure(client.listResources());
      expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/api/index.json'))).toHaveLength(1);
      recovered = true;
      const result = await client.listResources();
      expect(result.resources).toEqual(expect.arrayContaining([
        expect.objectContaining({uri: collections[0].uri, name: 'Updated stack'}),
        expect.objectContaining({uri: collections[1].uri, name: 'Updated best list'}),
      ]));
      expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/api/index.json'))).toHaveLength(2);
    });

    it('returns no dynamic items for a validated empty collection', async () => {
      vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>(async (input) =>
        String(input).endsWith(collection.path)
          ? Response.json(collection.empty) : healthyResponse(String(input))));
      const client = await connect();
      const result = await client.listResources();
      expect(result.resources.some(({uri}) => uri === collection.uri)).toBe(false);
      const healthy = collections.find(({name}) => name !== collection.name)!;
      expect(result.resources.some(({uri}) => uri === healthy.uri)).toBe(true);
    });

    it.each(['network', 'http', 'json', 'schema', 'version', 'incompatible'] as const)(
      'rejects the entire list on %s failure and recovers on a new request',
      async (failure) => {
        const secret = 'private.example/token-secret catalog prose';
        let failing = true;
        const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
          if (!String(input).endsWith(collection.path) || !failing) {
            return healthyResponse(String(input));
          }
          switch (failure) {
            case 'network': throw new Error(`https://${secret}`);
            case 'http': return new Response(secret, {status: 503, statusText: secret});
            case 'json': return new Response(`invalid json ${secret}`);
            case 'schema': return Response.json({...envelope, data: secret});
            case 'version': return Response.json({...collection.feed, version: secret});
            case 'incompatible': return Response.json({...collection.feed, version: '99.0.0'});
          }
        });
        vi.stubGlobal('fetch', fetch);
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        const client = await connect();

        const request = client.listResources();
        await expectFeedFailure(request);
        await expect(request).rejects.not.toThrow(/private\.example|token-secret|catalog prose|https:\/\//);
        expect(log.mock.calls).toEqual([[`feed_list_error: ${collection.name}`]]);

        // A failed collection is evicted; the healthy collection may stay cached.
        failing = false;
        const result = await client.listResources();
        expect(result.resources.map(({uri}) => uri)).toEqual(expect.arrayContaining(
          ['slothhub://feed/index', ...collections.map(({uri}) => uri)],
        ));
        const attemptedUrls = fetch.mock.calls.map(([url]) => String(url));
        expect(attemptedUrls.filter((url) => url.endsWith(collection.path))).toHaveLength(2);
        const read = await client.readResource({uri: collection.uri});
        expect(read.contents[0]).toMatchObject({text: JSON.stringify(
          collection.name === 'stacks' ? stacks.data.stacks[0] : best.data.best[0],
        )});
        const fixed = await client.readResource({uri: `slothhub://feed/${collection.name}`});
        expect(fixed.contents[0]).toMatchObject({text: JSON.stringify(collection.feed)});
      },
    );

    it('reports the existing feed timeout as a protocol failure', async () => {
      const started = signalEvent();
      let failing = true;
      vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>(async (input, options) => {
        if (!String(input).endsWith(collection.path) || !failing) return healthyResponse(String(input));
        return new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), {once: true});
          started.resolve();
        });
      }));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const client = await connect();
      vi.useFakeTimers();
      const failure = expectFeedFailure(client.listResources());
      await started.promise;
      await vi.advanceTimersByTimeAsync(FEED_FETCH_TIMEOUT_MS);
      await failure;
      failing = false;
      expect((await client.listResources()).resources.some(({uri}) => uri === collection.uri)).toBe(true);
    });

    it('cancels pending upstream work without logging a feed failure and then recovers', async () => {
      const started = signalEvent();
      const aborted = signalEvent();
      let pending = true;
      vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>(async (input, options) => {
        if (!String(input).endsWith(collection.path) || !pending) return healthyResponse(String(input));
        return new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => {
            reject(options.signal?.reason);
            aborted.resolve();
          }, {once: true});
          started.resolve();
        });
      }));
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      const client = await connect();
      const controller = new AbortController();
      const reason = new Error('Caller cancelled resource discovery');
      const cancelled = expect(client.listResources(undefined, {signal: controller.signal})).rejects.toMatchObject({
        code: 'REQUEST_TIMEOUT',
        message: 'Error: Caller cancelled resource discovery',
      });
      await started.promise;
      controller.abort(reason);
      await cancelled;
      await aborted.promise;
      expect(log).not.toHaveBeenCalled();
      pending = false;
      expect((await client.listResources()).resources.some(({uri}) => uri === collection.uri)).toBe(true);
    });
  });
});
