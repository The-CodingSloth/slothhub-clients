import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vite-plus/test';
import {z} from 'zod';
import type {JsonValue} from '@slothhub/domain/json-value';
import type {ProjectManifestToolsArtifact} from '@slothhub/domain/project-tool-pin-manifest';
import type {ToolLookupArtifact} from '@slothhub/domain/tool-lookup';
import {computeContentHash, computeIndexContentHash} from '@slothhub/domain/public-feed-content-identity';
import {createFeedClient, type FeedClient, type FeedClientOptions} from './feedClient.js';
import {indexFeed, toolDetailFeed, toolLookupArtifact} from './fixtures.js';
import type {AgentToolDetailFeed} from './types.js';

const revision = `sha256:${'a'.repeat(64)}`;
const manifest: ProjectManifestToolsArtifact = {
  version: '33.0.0', siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-10-15T00:00:00.000Z', catalogRevision: revision,
  contentHash: `sha256:${'b'.repeat(64)}`, data: {tools: []},
};
interface IndexedArtifactCase {
  name: string;
  path: string;
  payload: ToolLookupArtifact | ProjectManifestToolsArtifact | AgentToolDetailFeed;
  load: (client: FeedClient) => Promise<ToolLookupArtifact | ProjectManifestToolsArtifact | AgentToolDetailFeed | null>;
}
const cases: IndexedArtifactCase[] = [
  {name: 'Tool lookup', path: '/api/tool-lookup.json', payload: toolLookupArtifact, load: (client) => client.toolLookup()},
  {name: 'project manifest Tools', path: '/api/project-manifest-tools.json', payload: manifest, load: (client) => client.projectManifestTools()},
  {name: 'Tool detail', path: '/api/tools/figma.json', payload: {...toolDetailFeed, catalogRevision: revision,
    contentHash: computeContentHash(toolDetailFeed)}, load: (client) => client.tool('figma')},
];
const authenticatedIndex = (path: string, payload: IndexedArtifactCase['payload'], catalogRevision = revision) => {
  const source = {
    ...indexFeed, catalogRevision,
    feeds: {...indexFeed.feeds, projectManifestTools: 'https://slothhub.dev/api/project-manifest-tools.json'},
    contentHashes: {[path]: computeContentHash(payload)},
  };
  const contentHash = computeIndexContentHash(source);
  return {...source, contentHash, contentHashes: {...source.contentHashes, '/api/index.json': contentHash}};
};
const directories: string[] = [];
const persistedCacheSchema = z.object({version: z.number(),
  contentHash: z.string(), catalogRevision: z.string().optional(), storedAt: z.string(), payload: z.json(),
});
const corruptCachedPayloads = async (directory: string, payload: JsonValue) => {
  const cacheDirectory = join(directory, 'feeds-v2');
  for (const name of await readdir(cacheDirectory)) {
    if (!name.endsWith('.json')) continue;
    const path = join(cacheDirectory, name);
    const entry = persistedCacheSchema.parse(JSON.parse(await readFile(path, 'utf8')));
    await writeFile(path, JSON.stringify({...entry, payload}));
  }
};
const makeDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'slothhub-indexed-artifact-cache-'));
  directories.push(directory);
  return directory;
};
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {recursive: true, force: true})));
});

describe('authenticated indexed artifact disk reuse', () => {
  it.each(cases)('reuses $name across clients after fetching a fresh authenticated index', async ({path, payload, load}) => {
    const cacheDirectory = await makeDirectory();
    const requests: string[] = [];
    const fetchJson = async (url: string) => {
      requests.push(new URL(url).pathname);
      return url.endsWith('/api/index.json') ? authenticatedIndex(path, payload) : payload;
    };
    const first = await load(createFeedClient({fetchJson, cacheDirectory}));
    const second = await load(createFeedClient({fetchJson, cacheDirectory}));
    expect(second).toEqual(first);
    expect(requests).toEqual(['/api/index.json', path, '/api/index.json']);
  });

  it.each(cases)('refetches $name when its stored body is tampered with', async ({path, payload, load}) => {
    const cacheDirectory = await makeDirectory();
    const requests: string[] = [];
    const fetchJson = async (url: string) => {
      requests.push(new URL(url).pathname);
      return url.endsWith('/api/index.json') ? authenticatedIndex(path, payload) : payload;
    };
    await load(createFeedClient({fetchJson, cacheDirectory}));
    await corruptCachedPayloads(cacheDirectory, {version: 'tampered'});
    const recovered = await load(createFeedClient({fetchJson, cacheDirectory}));
    expect(recovered).not.toBeNull();
    expect(requests).toEqual(['/api/index.json', path, '/api/index.json', path]);
  });

  it.each(cases.flatMap((fixture) => ['healthy', 'invalid'].map((remoteState) => ({...fixture, remoteState}))))(
    'refetches $name with invalid cached metadata and validates the $remoteState remote artifact', async ({path, payload, load, remoteState}) => {
    const cacheDirectory = await makeDirectory();
    const corrupted = {...payload, generatedAt: 'not-a-date'};
    expect(computeContentHash(corrupted)).toBe(computeContentHash(payload));
    const requests: string[] = [];
    let remotePayload = payload;
    const fetchJson = async (url: string) => {
      requests.push(new URL(url).pathname);
      return url.endsWith('/api/index.json') ? authenticatedIndex(path, payload) : remotePayload;
    };
    const original = await load(createFeedClient({fetchJson, cacheDirectory}));
    await corruptCachedPayloads(cacheDirectory, z.json().parse(corrupted));
    remotePayload = remoteState === 'invalid' ? corrupted : payload;

    const result = load(createFeedClient({fetchJson, cacheDirectory}));
    if (remoteState === 'healthy') await expect(result).resolves.toEqual(original);
    else await expect(result).rejects.toMatchObject({code: 'schema_invalid', path});
    expect(requests).toEqual(['/api/index.json', path, '/api/index.json', path]);
  });

  it('does not reuse a lookup body after the authenticated hash changes', async () => {
    const cacheDirectory = await makeDirectory();
    let payload = toolLookupArtifact;
    const requests: string[] = [];
    const fetchJson = async (url: string) => {
      requests.push(new URL(url).pathname);
      return url.endsWith('/api/index.json') ? authenticatedIndex('/api/tool-lookup.json', payload) : payload;
    };
    await createFeedClient({fetchJson, cacheDirectory}).toolLookup();
    payload = {...toolLookupArtifact, tools: toolLookupArtifact.tools.map((tool) => ({...tool, name: 'Updated Figma'}))};
    const updated = await createFeedClient({fetchJson, cacheDirectory}).toolLookup();
    expect(updated?.tools[0]?.name).toBe('Updated Figma');
    expect(requests.filter((path) => path === '/api/tool-lookup.json')).toHaveLength(2);
  });

  it.each([
    {name: 'noCache', options: {noCache: true}},
    {name: 'disabled persistence', options: {persistentCache: false}},
  ])('honors $name for a previously persisted lookup', async ({options}) => {
    const cacheDirectory = await makeDirectory();
    const requests: string[] = [];
    const fetchJson = async (url: string) => {
      requests.push(new URL(url).pathname);
      return url.endsWith('/api/index.json') ? authenticatedIndex('/api/tool-lookup.json', toolLookupArtifact) : toolLookupArtifact;
    };
    const base: FeedClientOptions = {fetchJson, cacheDirectory};
    await createFeedClient(base).toolLookup();
    await createFeedClient({...base, ...options}).toolLookup();
    expect(requests.filter((path) => path === '/api/tool-lookup.json')).toHaveLength(2);
  });

  it('keeps persisted artifacts isolated by origin', async () => {
    const cacheDirectory = await makeDirectory();
    const requests: string[] = [];
    const fetchJson = async (url: string) => {
      requests.push(url);
      return url.endsWith('/api/index.json') ? authenticatedIndex('/api/tool-lookup.json', toolLookupArtifact) : toolLookupArtifact;
    };
    await createFeedClient({fetchJson, cacheDirectory, baseUrl: 'https://slothhub.dev'}).toolLookup();
    await createFeedClient({fetchJson, cacheDirectory, baseUrl: 'https://preview.slothhub.dev'}).toolLookup();
    expect(requests).toContain('https://preview.slothhub.dev/api/tool-lookup.json');
  });

  it('refetches a lookup when its index catalog revision changes', async () => {
    const cacheDirectory = await makeDirectory();
    let catalogRevision = revision;
    const requests: string[] = [];
    const fetchJson = async (url: string) => {
      requests.push(new URL(url).pathname);
      return url.endsWith('/api/index.json')
        ? authenticatedIndex('/api/tool-lookup.json', toolLookupArtifact, catalogRevision) : toolLookupArtifact;
    };
    await createFeedClient({fetchJson, cacheDirectory}).toolLookup();
    catalogRevision = `sha256:${'c'.repeat(64)}`;
    await expect(createFeedClient({fetchJson, cacheDirectory}).toolLookup()).resolves.not.toBeNull();
    expect(requests.filter((path) => path === '/api/tool-lookup.json')).toHaveLength(2);
  });

  it('requires a successful fresh index even when the lookup is persisted', async () => {
    const cacheDirectory = await makeDirectory();
    await createFeedClient({cacheDirectory, fetchJson: async (url) => url.endsWith('/api/index.json')
      ? authenticatedIndex('/api/tool-lookup.json', toolLookupArtifact) : toolLookupArtifact}).toolLookup();
    await expect(createFeedClient({cacheDirectory, fetchJson: async () => {
      throw new Error('HTTP 503 unavailable');
    }}).toolLookup()).rejects.toMatchObject({code: 'transport', path: '/api/index.json'});
  });

  it('fails closed when a fresh index no longer authenticates a persisted lookup', async () => {
    const cacheDirectory = await makeDirectory();
    const seed = async (url: string) => url.endsWith('/api/index.json')
      ? authenticatedIndex('/api/tool-lookup.json', toolLookupArtifact) : toolLookupArtifact;
    await createFeedClient({fetchJson: seed, cacheDirectory}).toolLookup();
    const requests: string[] = [];
    const client = createFeedClient({cacheDirectory, fetchJson: async (url) => {
      requests.push(new URL(url).pathname);
      return {...indexFeed, contentHashes: {}};
    }});
    await expect(client.toolLookup()).rejects.toMatchObject({code: 'schema_invalid', path: '/api/tool-lookup.json'});
    expect(requests).toEqual(['/api/index.json']);
  });
});
