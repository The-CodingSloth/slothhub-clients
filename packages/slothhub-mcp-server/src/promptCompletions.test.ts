import {Client, InMemoryTransport} from '@modelcontextprotocol/client';
import {afterEach, describe, expect, it, vi} from 'vite-plus/test';
import {createSlothHubMcpServer} from './server.js';
import {createFeedClient} from './services/feeds.js';
import type {AgentToolSummary, AgentAlternativesFeed, AgentComparisonsFeed} from './types.js';

const tool: AgentToolSummary = {
  name: 'Example MCP', slug: 'example-mcp', description: 'Example server',
  resourceKind: {value: 'mcp_server', label: 'MCP server'},
  resourceIdentity: {kind: 'website', kindLabel: 'Website', canonicalUrl: 'https://example.com/', ctaLabel: 'Open'},
  pricing: 'free', platforms: ['web'], categories: [], tags: [], useCases: [], freshness: {isVerified: false},
  detailUrl: 'https://slothhub.dev/tool/example-mcp', visitUrl: 'https://slothhub.dev/go/example-mcp',
};
const envelope = {version: '33.0.0', siteUrl: 'https://slothhub.dev', generatedAt: '2026-09-12T00:00:00.000Z'};

const connections: Array<{client: Client; close: () => Promise<void>}> = [];
afterEach(async () => {
  await Promise.all(connections.splice(0).map(async ({client, close}) => {
    await client.close(); await close();
  }));
});
const connect = async (feedClient = createFeedClient({indexFirst: false}), includeCompletions = true) => {
  const server = createSlothHubMcpServer({feedClient, includeCompletions});
  const [local, remote] = InMemoryTransport.createLinkedPair();
  const client = new Client({name: 'completion-test', version: '1.0.0'});
  await server.connect(remote); await client.connect(local);
  connections.push({client, close: () => server.close()});
  return client;
};
const complete = (client: Client, value: string, name = 'slothhub_discover_tool', argument = 'query') =>
  client.complete({ref: {type: 'ref/prompt', name}, argument: {name: argument, value}});

describe('stdio prompt completions', () => {
  it('suggests tools after reading the Tools resource without loading the search index', async () => {
    const fetchJson = vi.fn(async (_url: string) => ({...envelope, data: {tools: [tool]}}));
    const client = await connect(createFeedClient({indexFirst: false, fetchJson}));
    await client.readResource({uri: 'slothhub://feed/tools'});
    expect((await complete(client, '', 'slothhub_find_mcp_server')).completion.values).toEqual(['example-mcp']);
    expect((await client.complete({ref: {type: 'ref/resource', uri: 'slothhub://tool/{slug}'}, argument: {name: 'slug', value: 'example'}})).completion.values).toEqual(['example-mcp']);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(fetchJson.mock.calls[0]?.[0]).toBe('https://slothhub.dev/api/tools.json');
  });
  it('completes editorial prompts from cached feeds without fetching on cold or expired caches', async () => {
    const comparisons: AgentComparisonsFeed = {...envelope, data: {
      comparisonsUrl: 'https://slothhub.dev/compare',
      comparisons: [{title: 'Example versus Other', slug: 'example-vs-other', primary: tool, secondary: {...tool, slug: 'other'},
        pageUrl: 'https://slothhub.dev/compare/example-vs-other', jsonUrl: 'https://slothhub.dev/api/compare/example-vs-other.json',
        markdownUrl: 'https://slothhub.dev/compare/example-vs-other.md'}],
    }};
    const alternatives: AgentAlternativesFeed = {...envelope, data: {
      alternativesUrl: 'https://slothhub.dev/alternatives',
      sets: [{name: 'Example MCP', slug: 'example-mcp', detailUrl: tool.detailUrl, alternativeCount: 1, alternatives: [{...tool, slug: 'other'}],
        alternativesUrl: 'https://slothhub.dev/alternatives/example-mcp', jsonUrl: 'https://slothhub.dev/api/alternatives/example-mcp.json',
        markdownUrl: 'https://slothhub.dev/alternatives/example-mcp.md'}],
    }};
    const fetchJson = vi.fn(async (url: string) => url.endsWith('/api/compare.json') ? comparisons : alternatives);
    let now = 0;
    const feed = createFeedClient({indexFirst: false, fetchJson, now: () => now, cacheTtlMs: 1000});
    const client = await connect(feed);
    const prompts = [
      ['slothhub_browse_comparison', 'example-vs-other'],
      ['slothhub_browse_alternatives', 'example-mcp'],
    ] as const;
    for (const [name] of prompts) expect((await complete(client, '', name)).completion.values).toEqual([]);
    expect(fetchJson).not.toHaveBeenCalled();
    await Promise.all([feed.comparisons(), feed.alternatives()]);
    for (const [name, slug] of prompts) {
      expect((await complete(client, 'EXAMPLE', name)).completion).toEqual({values: [slug], total: 1, hasMore: false});
    }
    for (const [kind, slug] of [['compare', 'example-vs-other'], ['alternatives', 'example-mcp']]) {
      expect((await client.complete({ref: {type: 'ref/resource', uri: `slothhub://${kind}/{slug}`}, argument: {name: 'slug', value: 'EXAMPLE'}})).completion).toEqual({values: [slug], total: 1, hasMore: false});
    }
    now = 1001;
    for (const [name] of prompts) expect((await complete(client, '', name)).completion.values).toEqual([]);
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });
  it('never suggests noncanonical resource slugs from an otherwise valid feed', async () => {
    const slugs = ['', 'Bad Slug', 'UPPERCASE', 'a'.repeat(161), 'valid-slug'];
    const fetchJson = vi.fn(async () => ({version: '33.0.0', siteUrl: 'https://slothhub.dev', generatedAt: '2026-09-12T00:00:00.000Z', data: {stacks: slugs.map((slug) => ({name: 'Stack', slug, url: 'https://slothhub.dev/stacks/example', tags: [], tools: []}))}}));
    const feed = createFeedClient({indexFirst: false, fetchJson});
    await feed.stacks();
    const client = await connect(feed);
    expect((await client.complete({ref: {type: 'ref/resource', uri: 'slothhub://stack/{slug}'}, argument: {name: 'slug', value: ''}})).completion).toEqual({values: ['valid-slug'], total: 1, hasMore: false});
  });
  it('caps cached matches with metadata and never fetches, including cold cache and expired cache', async () => {
    const categories = Array.from({length: 125}, (_, i) => ({name: `Category ${i}`, slug: `category-${String(i).padStart(3, '0')}`, url: `https://slothhub.dev/category-${i}`}));
    const fetchJson = vi.fn(async () => ({version: '33.0.0', siteUrl: 'https://slothhub.dev', generatedAt: '2026-09-12T00:00:00.000Z', data: {categories}}));
    let now = 0;
    const feed = createFeedClient({indexFirst: false, fetchJson, now: () => now, cacheTtlMs: 1000});
    const client = await connect(feed);
    expect(client.getServerCapabilities()?.completions).toEqual({});
    expect((await complete(client, '')).completion.values).toEqual([]);
    expect(fetchJson).not.toHaveBeenCalled();
    await feed.categories();
    const result = (await complete(client, '')).completion;
    expect(result).toEqual({values: categories.slice(0, 100).map(({slug}) => slug), total: 125, hasMore: true});
    expect((await complete(client, 'CATEGORY-12')).completion.values).toHaveLength(5);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    now = 1001;
    expect((await complete(client, '')).completion.values).toEqual([]);
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });
  it('returns empty for unknown references and arguments', async () => {
    const client = await connect();
    expect((await complete(client, '', 'unknown')).completion.values).toEqual([]);
    expect((await complete(client, '', undefined, 'unknown')).completion.values).toEqual([]);
    expect((await client.complete({ref: {type: 'ref/resource', uri: 'slothhub://unknown/{slug}'}, argument: {name: 'slug', value: ''}})).completion.values).toEqual([]);
  });
  it('normalizes prefixes, deduplicates slugs, scopes kinds and templates, and reports limits without values', async () => {
    const feed = createFeedClient({indexFirst: false});
    feed.completionCandidates = () => ({
      tools: [{name: 'Café server', slug: 'cafe-server', resourceKind: 'mcp_server'}, {name: 'Code skill', slug: 'code-skill', resourceKind: 'agent_skill'}],
      categories: [{name: 'Café', slug: 'cafe-server'}], tags: [], useCases: [],
      stacks: [{name: 'Design stack', slug: 'design-stack'}], best: [{name: 'Design best', slug: 'design-best'}],
      comparisons: [], alternatives: [],
    });
    const client = await connect(feed);
    expect((await complete(client, 'CAFE\u0301')).completion).toEqual({values: ['cafe-server'], total: 1, hasMore: false});
    expect((await complete(client, '\u202eCAFE\u0301')).completion.values).toEqual(['cafe-server']);
    expect((await complete(client, '', 'slothhub_find_mcp_server')).completion.values).toEqual(['cafe-server']);
    expect((await complete(client, '', 'slothhub_find_agent_skill')).completion.values).toEqual(['code-skill']);
    expect((await complete(client, '', 'slothhub_browse_best')).completion.values).toEqual(['design-best']);
    expect((await client.complete({ref: {type: 'ref/resource', uri: 'slothhub://stack/{slug}'}, argument: {name: 'slug', value: 'DESIGN'}})).completion.values).toEqual(['design-stack']);
    await expect(complete(client, '😀'.repeat(200))).resolves.toBeDefined();
    await expect(complete(client, '😀'.repeat(201))).rejects.toThrow('limit_characters=200 actual_characters=201');
    await expect(complete(client, 'sensitive'.repeat(30))).rejects.not.toThrow('sensitive');
  });
  it('does not advertise completions when disabled for hosted use', async () => {
    const client = await connect(undefined, false);
    expect(client.getServerCapabilities()?.completions).toBeUndefined();
  });
  it('lets the SDK reject malformed completion params before the handler', async () => {
    const feed = createFeedClient({indexFirst: false});
    const candidates = vi.spyOn(feed, 'completionCandidates');
    const server = createSlothHubMcpServer({feedClient: feed});
    const [local, remote] = InMemoryTransport.createLinkedPair();
    await server.connect(remote);
    await local.start();
    try {
      const response = new Promise<number>((resolve) => {
        local.onmessage = (message) => {
          if ('error' in message) resolve(message.error.code);
        };
      });
      await local.send({jsonrpc: '2.0', id: 1, method: 'completion/complete', params: {}});
      // SDK 2.0.0 reports its schema rejection as InternalError before dispatch.
      expect(await response).toBe(-32603);
      expect(candidates).not.toHaveBeenCalled();
    } finally {await local.close(); await server.close();}
  });
});
