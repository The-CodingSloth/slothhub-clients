import {describe, expect, it} from 'vite-plus/test';
import type {ToolLookupArtifact} from '@slothhub/domain/tool-lookup';
import {z} from 'zod';
import {ResponseFormat} from '../constants.js';
import {computeContentHash, computeIndexContentHash} from '@slothhub/domain/public-feed-content-identity';
import {createFeedClient, type FeedResponsePayload} from '../services/feeds.js';
import type {AgentIndexFeed, AgentToolDetail, AgentToolDetailFeed, AgentToolsFeed} from '../types.js';
import {handleGetVisitUrl} from './handlers.js';

const tool: AgentToolDetail = {
  name: 'Example', slug: 'example', description: 'A catalog Tool',
  resourceKind: {value: 'app', label: 'App'},
  resourceIdentity: {kind: 'website', kindLabel: 'Website', canonicalUrl: 'https://example.com/', ctaLabel: 'Visit website'},
  platforms: ['web'], categories: [], tags: [], useCases: [], freshness: {isVerified: false},
  detailUrl: 'https://slothhub.dev/tool/example', visitUrl: 'https://slothhub.dev/go/example?surface=agent',
  keyFeatures: [], resourceLinks: [], agentInterfaces: [], alternativeTools: [],
};
const metadata = {version: '33.0.0', siteUrl: 'https://slothhub.dev', generatedAt: '2026-10-15T00:00:00.000Z', catalogRevision: `sha256:${'a'.repeat(64)}`};
const fixtures = (value: AgentToolDetail = tool, indexedDetail = true) => {
  const detailBase = {...metadata, data: value};
  const detail: AgentToolDetailFeed = {...detailBase, contentHash: computeContentHash(detailBase)};
  const toolsBase = {...metadata, data: {tools: [value]}};
  const tools: AgentToolsFeed = {...toolsBase, contentHash: computeContentHash(toolsBase)};
  const lookup: ToolLookupArtifact = {
    version: '5.0.0', complete: true, identityClaims: [],
    aliases: [{slug: 'old-example', sourceToolId: 'example', canonicalSlug: 'example'}],
    tools: [{name: value.name, slug: 'example', detailUrl: value.detailUrl, keys: [{namespace: 'slug', value: 'example'}]}],
  };
  const collectionHashes = {'/api/tools.json': computeContentHash(toolsBase), '/api/tool-lookup.json': computeContentHash(lookup)};
  const contentHashes = indexedDetail ? {...collectionHashes, '/api/tools/example.json': computeContentHash(detailBase)} : collectionHashes;
  const indexBase: AgentIndexFeed = {
    ...metadata, schemaUrl: 'https://slothhub.dev/api/schema.json',
    snapshots: {full: 'https://slothhub.dev/api/catalog.snapshot.json', ndjson: 'https://slothhub.dev/api/catalog.ndjson'},
    feeds: {tools: 'https://slothhub.dev/api/tools.json', toolLookup: 'https://slothhub.dev/api/tool-lookup.json', searchIndex: 'https://slothhub.dev/api/search-index.json', categories: 'https://slothhub.dev/api/categories.json', tags: 'https://slothhub.dev/api/tags.json', useCases: 'https://slothhub.dev/api/use-cases.json', stacks: 'https://slothhub.dev/api/stacks.json', best: 'https://slothhub.dev/api/best.json'},
    markdownArtifacts: {}, integrationHubUrl: 'https://slothhub.dev/agents', markdownHubUrl: 'https://slothhub.dev/agents.md',
    toolDetailUrlTemplate: 'https://slothhub.dev/api/tools/{slug}.json', citationGuidance: [], contentHashes,
  };
  const contentHash = computeIndexContentHash(indexBase);
  return {detail, tools, lookup, index: {...indexBase, contentHash, contentHashes: {...contentHashes, '/api/index.json': contentHash}}};
};
const request = {slug: 'example', response_format: ResponseFormat.JSON};
const expectedVisit = {slug: 'example', visitUrl: tool.visitUrl, detailUrl: tool.detailUrl,
  citationNote: 'Cite detailUrl as the source. visitUrl is a tracked outbound visit action only.'};

describe('visit URL catalog reads', () => {
  it.each(['cold', 'detail', 'tools', 'expired-tools'] as const)('loads only the necessary authenticated data with %s state', async (warm) => {
    const payloads = fixtures();
    const paths: string[] = [];
    let now = 0;
    const client = createFeedClient({cacheTtlMs: 10, now: () => now, fetchJson: async (url) => {
      const path = new URL(url).pathname;
      paths.push(path);
      if (path === '/api/index.json') return payloads.index;
      if (path === '/api/tools.json') return payloads.tools;
      if (path === '/api/tools/example.json') return payloads.detail;
      throw new Error(`Unexpected ${path}`);
    }});
    if (warm === 'detail') await client.toolDetail('example');
    if (warm === 'tools' || warm === 'expired-tools') await client.tools();
    paths.length = 0;
    if (warm === 'expired-tools') now = 11;
    const result = await handleGetVisitUrl(client, request);
    expect(result.structuredContent).toEqual(expectedVisit);
    expect(result.isError).toBeUndefined();
    expect(paths).toEqual(warm === 'cold' ? ['/api/index.json', '/api/tools/example.json']
      : warm === 'expired-tools' ? ['/api/index.json'] : []);
  });

  it.each(['old-example', ' example '])('preserves alias and normalized slug resolution for %s', async (slug) => {
    const payloads = fixtures();
    const paths: string[] = [];
    const client = createFeedClient({fetchJson: async (url) => {
      const path = new URL(url).pathname;
      paths.push(path);
      if (path === '/api/index.json') return payloads.index;
      if (path === '/api/tools.json') return payloads.tools;
      if (path === '/api/tool-lookup.json') return payloads.lookup;
      throw new Error(`Unexpected ${path}`);
    }});
    const result = await handleGetVisitUrl(client, {...request, slug});
    expect(result.structuredContent).toEqual(expectedVisit);
    expect(paths).toEqual(['/api/index.json', '/api/tools.json', '/api/tool-lookup.json']);
  });

  it.each([false, true])('retains the collection fallback without an authenticated detail route (noCache=%s)', async (noCache) => {
    const payloads = fixtures(tool, false);
    const paths: string[] = [];
    const client = createFeedClient({noCache, fetchJson: async (url) => {
      const path = new URL(url).pathname;
      paths.push(path);
      if (path === '/api/index.json') return payloads.index;
      if (path === '/api/tools.json') return payloads.tools;
      throw new Error(`Unexpected ${path}`);
    }});
    expect((await handleGetVisitUrl(client, request)).structuredContent).toEqual(expectedVisit);
    expect(paths).toEqual(['/api/index.json', '/api/tools.json']);
  });

  it('uses the new authenticated detail when the cached collection belongs to an older index', async () => {
    let payloads = fixtures();
    let now = 0;
    const paths: string[] = [];
    const client = createFeedClient({cacheTtlMs: 10, now: () => now, fetchJson: async (url) => {
      const path = new URL(url).pathname;
      paths.push(path);
      if (path === '/api/index.json') return payloads.index;
      if (path === '/api/tools.json') return payloads.tools;
      if (path === '/api/tools/example.json') return payloads.detail;
      throw new Error(`Unexpected ${path}`);
    }});
    await client.tools();
    paths.length = 0;
    now = 11;
    payloads = fixtures({...tool, name: 'Updated example'});
    const result = await handleGetVisitUrl(client, {...request, response_format: ResponseFormat.MARKDOWN});
    expect(result.content[0].text).toContain('# Visit URL for Updated example');
    expect(paths).toEqual(['/api/index.json', '/api/tools/example.json']);
  });

  it('does not disclose cached collection data when its fresh index fails validation', async () => {
    const payloads = fixtures();
    let now = 0;
    let broken = false;
    const paths: string[] = [];
    const client = createFeedClient({cacheTtlMs: 10, now: () => now, fetchJson: async (url) => {
      const path = new URL(url).pathname;
      paths.push(path);
      if (path === '/api/index.json') return broken ? {...payloads.index, contentHash: `sha256:${'0'.repeat(64)}`} : payloads.index;
      if (path === '/api/tools.json') return payloads.tools;
      throw new Error(`Unexpected ${path}`);
    }});
    await client.tools();
    paths.length = 0;
    broken = true;
    now = 11;
    const result = await handleGetVisitUrl(client, request);
    expect(result.structuredContent).toMatchObject({code: 'feed_load_error'});
    expect(result.isError).toBe(true);
    expect(paths).toEqual(['/api/index.json']);
  });

  it('retains the collection path for injected clients without the optional visit capability', async () => {
    const payloads = fixtures();
    const paths: string[] = [];
    const client = createFeedClient({fetchJson: async (url) => {
      const path = new URL(url).pathname;
      paths.push(path);
      if (path === '/api/index.json') return payloads.index;
      if (path === '/api/tools.json') return payloads.tools;
      throw new Error(`Unexpected ${path}`);
    }});
    const {visitTool: _optionalCapability, ...injectedClient} = client;
    expect((await handleGetVisitUrl(injectedClient, request)).structuredContent).toEqual(expectedVisit);
    expect(paths).toEqual(['/api/index.json', '/api/tools.json']);
  });

  it.each(['index', 'detail-hash', 'detail-slug', 'detail-404', 'detail-schema', 'detail-revision'] as const)('fails closed for invalid %s data', async (failure) => {
    const payloads = fixtures(failure === 'detail-slug' ? {...tool, slug: 'different'} : tool);
    const paths: string[] = [];
    const client = createFeedClient({fetchJson: async (url): Promise<FeedResponsePayload> => {
      const path = new URL(url).pathname;
      paths.push(path);
      if (path === '/api/index.json') return failure === 'index' ? {...payloads.index, contentHash: `sha256:${'0'.repeat(64)}`} : payloads.index;
      if (path === '/api/tools/example.json') {
        if (failure === 'detail-404') throw new Error('HTTP 404 Not Found');
        if (failure === 'detail-schema') return z.json().parse({...payloads.detail, data: {...tool, keyFeatures: null}});
        if (failure === 'detail-revision') return {...payloads.detail, catalogRevision: `sha256:${'b'.repeat(64)}`};
        return failure === 'detail-hash' ? {...payloads.detail, data: {...tool, name: 'Tampered'}} : payloads.detail;
      }
      if (path === '/api/tools.json') return payloads.tools;
      throw new Error(`Unexpected ${path}`);
    }});
    const result = await handleGetVisitUrl(client, request);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({code: 'feed_load_error'});
    expect(paths).not.toContain('/api/tools.json');
  });
});
