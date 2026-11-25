import {Client, InMemoryTransport} from '@modelcontextprotocol/client';
import {ProtocolErrorCode, type ListResourcesResult} from '@modelcontextprotocol/server';
import {afterEach, describe, expect, it, vi} from 'vite-plus/test';

import {createSlothHubMcpServer, type SlothHubMcpServerOptions} from '../server.js';
import {createFeedClient, type FeedClient} from '../services/feeds.js';
import type {
  AgentCuratedListFeed,
  AgentToolStackFeed,
  AgentToolStackFeedItem,
  AgentCuratedListFeedItem,
} from '../types.js';

const envelope = {
  version: '33.0.0',
  siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-09-07T00:00:00.000Z',
};
// The comparison listing reads /api/compare.json beside stacks and best-of lists.
const emptyComparisons = {...envelope, data: {comparisonsUrl: 'https://slothhub.dev/compare', comparisons: []}};

const stackItem = (index: number): AgentToolStackFeedItem => ({
  name: `Stack ${index}`,
  slug: `stack-${index}`,
  url: `https://slothhub.dev/stacks/stack-${index}`,
  tags: [],
  tools: [],
});

const bestItem = (index: number): AgentCuratedListFeedItem => ({
  title: `Best ${index}`,
  slug: `best-${index}`,
  url: `https://slothhub.dev/best/best-${index}`,
  rankedTools: [],
});

const stacksFeed = (items: AgentToolStackFeedItem[]): AgentToolStackFeed => ({
  ...envelope,
  data: {stacks: items},
});

const bestFeed = (items: AgentCuratedListFeedItem[]): AgentCuratedListFeed => ({
  ...envelope,
  data: {best: items},
});

const collectionsFetchJson = (
  stacks: AgentToolStackFeed,
  best: AgentCuratedListFeed,
) =>
  vi.fn(async (url: string) =>
    url.endsWith('/api/compare.json') ? emptyComparisons : url.endsWith('/api/stacks.json') ? stacks : best,
  );

const connections: Array<{client: Client; closeServer: () => Promise<void>}> =
  [];

afterEach(async () => {
  await Promise.all(
    connections.splice(0).map(async ({client, closeServer}) => {
      await client.close();
      await closeServer();
    }),
  );
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const connect = async (
  feedClient: FeedClient,
  options: SlothHubMcpServerOptions = {},
) => {
  const server = createSlothHubMcpServer({feedClient, ...options});
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({name: 'resource-pagination-test', version: '0.0.0'});
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  connections.push({client, closeServer: () => server.close()});
  return client;
};

/**
 * One raw resources/list wire request. `client.listResources()` without a
 * cursor auto-aggregates every page (SDK `listMaxPages` walk), which is the
 * behavior callers want but hides page boundaries; `client.request` returns
 * the server's page and `nextCursor` verbatim.
 */
const listPage = (
  client: Client,
  cursor?: string,
): Promise<ListResourcesResult> =>
  client.request({
    method: 'resources/list',
    params: cursor === undefined ? {} : {cursor},
  });

const collectAllResources = async (client: Client) => {
  const uris: string[] = [];
  const cursors: Array<string | undefined> = [];
  let cursor: string | undefined;
  do {
    const page = await listPage(client, cursor);
    cursors.push(page.nextCursor);
    for (const resource of page.resources) {
      uris.push(resource.uri);
    }
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return {uris, cursors};
};

/** Serialized bytes an entry contributes to the page, including the array comma. */
const entryBytes = (entry: {uri: string}): number =>
  Buffer.byteLength(JSON.stringify(entry)) + 1;

describe('resources/list pagination', () => {
  it('auto-aggregates the merged inventory for an ordinary client.listResources call', async () => {
    const fetchJson = collectionsFetchJson(
      stacksFeed([stackItem(1), stackItem(2)]),
      bestFeed([bestItem(1)]),
    );
    const client = await connect(
      createFeedClient({fetchJson, indexFirst: false}),
    );

    const page = await client.listResources();

    const uris = page.resources.map(({uri}) => uri);
    expect(uris).toContain('slothhub://stack/stack-1');
    expect(uris).toContain('slothhub://stack/stack-2');
    expect(uris).toContain('slothhub://best/best-1');
    expect(uris).toContain('slothhub://feed/index');
    expect(page.nextCursor).toBeUndefined();
    // Sorted by stable resource URI across the merged inventory.
    expect(uris).toEqual([...uris].sort());
    // Tool resources keep their search-driven discovery policy.
    expect(uris.some((uri) => uri.startsWith('slothhub://tool/'))).toBe(false);
  });

  it('iterates pages to completion and delivers every eligible URI exactly once', async () => {
    const stacks = stacksFeed(
      Array.from({length: 6}, (_, index) => stackItem(index)),
    );
    const best = bestFeed(
      Array.from({length: 7}, (_, index) => bestItem(index)),
    );
    const fetchJson = collectionsFetchJson(stacks, best);

    // Calibrate the page budget from the real wire shape: first list everything,
    // then reconnect with a budget that fits exactly the first two entries.
    const sizing = await connect(
      createFeedClient({fetchJson, indexFirst: false}),
    );
    const all = await sizing.listResources();
    const budget =
      1024 + entryBytes(all.resources[0]) + entryBytes(all.resources[1]);

    const client = await connect(
      createFeedClient({fetchJson, indexFirst: false}),
      {resourceListPageBudgetBytes: budget},
    );

    const {uris, cursors} = await collectAllResources(client);

    expect(uris).toHaveLength(all.resources.length);
    expect(new Set(uris).size).toBe(uris.length);
    expect([...uris].sort()).toEqual(
      all.resources.map(({uri}) => uri).sort(),
    );
    // nextCursor appears on every page except the exhausted last one.
    expect(cursors.at(-1)).toBeUndefined();
    expect(cursors.slice(0, -1).every((cursor) => cursor !== undefined)).toBe(
      true,
    );
    expect(cursors.length).toBeGreaterThan(2);
  });

  it('splits a page exactly at the byte boundary and still ships an oversized entry alone', async () => {
    const stacks = stacksFeed(
      Array.from({length: 4}, (_, index) => stackItem(index)),
    );
    const fetchJson = collectionsFetchJson(stacks, bestFeed([]));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const sizing = await connect(
      createFeedClient({fetchJson, indexFirst: false}),
    );
    const all = await sizing.listResources();
    // Budget admits exactly the first entry.
    const exactOne = 1024 + entryBytes(all.resources[0]);

    const client = await connect(
      createFeedClient({fetchJson, indexFirst: false}),
      {resourceListPageBudgetBytes: exactOne},
    );
    const firstPage = await listPage(client);
    expect(firstPage.resources).toHaveLength(1);
    expect(firstPage.resources[0].uri).toBe(all.resources[0].uri);
    expect(firstPage.nextCursor).toBeDefined();

    const tight = await connect(
      createFeedClient({fetchJson, indexFirst: false}),
      {resourceListPageBudgetBytes: exactOne - 1},
    );
    // An entry larger than the whole page still ships alone so iteration
    // makes progress instead of wedging on an oversized listing.
    const tightPage = await listPage(tight);
    expect(tightPage.resources).toHaveLength(1);
    expect(tightPage.nextCursor).toBeDefined();
  });

  it('loads collections sequentially so feed-cache generation ordering is preserved', async () => {
    const requested: string[] = [];
    let resolveStacks!: (feed: AgentToolStackFeed) => void;
    const stacksReady = new Promise<AgentToolStackFeed>((done) => {
      resolveStacks = done;
    });
    const fetchJson = vi.fn((url: string) => {
      requested.push(url);
      return url.endsWith('/api/compare.json') ? Promise.resolve(emptyComparisons) : url.endsWith('/api/stacks.json')
        ? stacksReady
        : Promise.resolve(bestFeed([bestItem(1)]));
    });
    const client = await connect(
      createFeedClient({fetchJson, indexFirst: false}),
    );

    const pending = listPage(client);
    await vi.waitFor(() =>
      expect(
        requested.some((url) => url.endsWith('/api/stacks.json')),
      ).toBe(true),
    );
    expect(requested.some((url) => url.endsWith('/api/best.json'))).toBe(false);

    resolveStacks(stacksFeed([stackItem(1)]));
    await pending;
    expect(requested.some((url) => url.endsWith('/api/best.json'))).toBe(true);
  });

  it('rejects a stale cursor with invalid params and restart guidance after the catalog changes', async () => {
    let stacks = stacksFeed([stackItem(1), stackItem(2), stackItem(3)]);
    const best = bestFeed([bestItem(1)]);
    const fetchJson = vi.fn(async (url: string) =>
      url.endsWith('/api/compare.json') ? emptyComparisons : url.endsWith('/api/stacks.json') ? stacks : best,
    );
    const sizing = await connect(
      createFeedClient({fetchJson, indexFirst: false, noCache: true}),
    );
    const all = await sizing.listResources();
    const budget = 1024 + entryBytes(all.resources[0]);
    // One-entry pages log resource_list_item_over_budget for later items.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const client = await connect(
      createFeedClient({fetchJson, indexFirst: false, noCache: true}),
      {resourceListPageBudgetBytes: budget},
    );
    const first = await listPage(client);
    expect(first.nextCursor).toBeDefined();

    stacks = stacksFeed([stackItem(1), stackItem(2), stackItem(3), stackItem(4)]);
    await expect(
      listPage(client, first.nextCursor),
    ).rejects.toMatchObject({
      code: ProtocolErrorCode.InvalidParams,
      message: expect.stringContaining('stale_cursor'),
      data: {
        code: 'stale_cursor',
        recovery: expect.stringContaining('Restart resources/list'),
      },
    });

    // A fresh listing recovers completely.
    const {uris} = await collectAllResources(client);
    expect(uris).toContain('slothhub://stack/stack-4');
  });

  it.each([
    ['not base64url', 'not a cursor!!!'],
    ['base64url but not json', 'aGVsbG8'],
    [
      'json but wrong shape',
      Buffer.from('{"page":2}', 'utf8').toString('base64url'),
    ],
    [
      'foreign version',
      Buffer.from(
        JSON.stringify({v: 2, s: 'a'.repeat(64), o: 0}),
        'utf8',
      ).toString('base64url'),
    ],
    [
      'non-hex snapshot',
      Buffer.from(
        JSON.stringify({v: 1, s: 'not-a-hash', o: 0}),
        'utf8',
      ).toString('base64url'),
    ],
    [
      'negative offset',
      Buffer.from(
        JSON.stringify({v: 1, s: 'a'.repeat(64), o: -1}),
        'utf8',
      ).toString('base64url'),
    ],
    ['oversized', 'a'.repeat(600)],
  ])(
    'rejects a %s cursor before any feed fetch',
    async (_case, rawCursor) => {
      const fetchJson = collectionsFetchJson(
        stacksFeed([stackItem(1)]),
        bestFeed([]),
      );
      const client = await connect(
        createFeedClient({fetchJson, indexFirst: false}),
      );

      await expect(listPage(client, rawCursor)).rejects.toMatchObject({
        code: ProtocolErrorCode.InvalidParams,
        message: expect.stringContaining('invalid_cursor'),
        data: {
          code: 'invalid_cursor',
          recovery: 'Restart resources/list without a cursor.',
        },
      });
      expect(fetchJson).not.toHaveBeenCalled();
    },
  );

  it('reports an over-budget entry, emits it alone, and keeps paging', async () => {
    const giantName = 'g'.repeat(4000);
    const stacks = stacksFeed([
      {...stackItem(1), name: giantName},
      stackItem(2),
    ]);
    const fetchJson = collectionsFetchJson(stacks, bestFeed([bestItem(1)]));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = await connect(
      createFeedClient({fetchJson, indexFirst: false}),
      {resourceListPageBudgetBytes: 2048},
    );

    const {uris} = await collectAllResources(client);

    const giantUri = 'slothhub://stack/stack-1';
    expect(uris).toContain(giantUri);
    expect(uris).toContain('slothhub://stack/stack-2');
    expect(
      log.mock.calls.some(([message]) =>
        String(message).includes(
          `resource_list_item_over_budget: uri=${giantUri}`,
        ),
      ),
    ).toBe(true);
  });
});
