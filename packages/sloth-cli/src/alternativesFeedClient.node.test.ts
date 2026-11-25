import {describe, expect, it} from 'vite-plus/test';

import {computeContentHash} from '@slothhub/domain/public-feed-content-identity';
import {createFeedClient} from './feedClient.js';
import type {FeedTransportPayload} from './feedClient.js';
import {alternativesDetailFeed, alternativesFeed, indexFeed} from './fixtures.js';
import type {AgentIndexFeed} from './types.js';

const withEmbeddedContentHash = (feed: typeof alternativesDetailFeed) => ({
  ...feed,
  contentHash: computeContentHash(feed),
});

const DETAIL_PATH = '/api/alternatives/figma.json';

const indexWithAlternatives = (
  siteUrl = 'https://slothhub.dev',
  detailContentHash = alternativesDetailFeed.contentHash,
) => ({
  ...indexFeed,
  siteUrl,
  contentHashes: {[DETAIL_PATH]: detailContentHash},
  feeds: {
    ...indexFeed.feeds,
    alternatives: `${siteUrl}/api/alternatives.json`,
  },
});

const createDetailClient = (
  detail: FeedTransportPayload,
  index: AgentIndexFeed = indexWithAlternatives(
    'https://slothhub.dev',
    computeContentHash(detail),
  ),
  baseUrl = 'https://slothhub.dev',
) => createFeedClient({
  baseUrl,
  persistentCache: false,
  fetchJson: async (url) => new URL(url).pathname.endsWith('/api/index.json')
    ? index
    : detail,
});

describe('alternatives detail FeedClient', () => {
  it('preserves caller cancellation instead of reporting a transport failure', async () => {
    const controller = new AbortController();
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      signal: controller.signal,
      persistentCache: false,
      fetchJson: async (_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('This operation was aborted', 'AbortError'));
        });
      }),
    });

    const request = client.alternatives();
    controller.abort();

    await expect(request).rejects.toMatchObject({name: 'AbortError'});
  });

  it('fails before fetching a detail when the index omits its hash map', async () => {
    const requestedPaths: string[] = [];
    const index = {...indexWithAlternatives(), contentHashes: undefined};
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      persistentCache: false,
      fetchJson: async (url) => {
        const path = new URL(url).pathname;
        requestedPaths.push(path);
        if (path === '/api/index.json') return index;
        if (path === '/api/alternatives.json') return alternativesFeed;
        return alternativesDetailFeed;
      },
    });

    await expect(client.alternative('figma')).rejects.toMatchObject({
      code: 'schema_invalid',
      path: DETAIL_PATH,
      message: expect.stringContaining('does not authenticate'),
    });
    expect(requestedPaths).toEqual(['/api/index.json']);
  });

  it('fails stale indexes closed when their authenticated list contains the selected slug', async () => {
    const requestedPaths: string[] = [];
    const index = {
      ...indexWithAlternatives(),
      contentHashes: {
        '/api/alternatives.json': computeContentHash(alternativesFeed),
      },
    };
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      persistentCache: false,
      fetchJson: async (url) => {
        const path = new URL(url).pathname;
        requestedPaths.push(path);
        if (path === '/api/index.json') return index;
        if (path === '/api/alternatives.json') return alternativesFeed;
        return alternativesDetailFeed;
      },
    });

    await expect(client.alternative('figma')).rejects.toMatchObject({
      code: 'schema_invalid',
      path: DETAIL_PATH,
      message: expect.stringContaining('does not authenticate'),
    });
    expect(requestedPaths).toEqual(['/api/index.json', '/api/alternatives.json']);
  });

  it('returns typed not_found before fetching a detail absent from the index', async () => {
    const requestedPaths: string[] = [];
    const index = {
      ...indexWithAlternatives(),
      contentHashes: {'/api/alternatives.json': computeContentHash(alternativesFeed)},
    };
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      persistentCache: false,
      fetchJson: async (url) => {
        const path = new URL(url).pathname;
        requestedPaths.push(path);
        if (path === '/api/index.json') return index;
        if (path === '/api/alternatives.json') return alternativesFeed;
        return alternativesDetailFeed;
      },
    });

    const missingPath = '/api/alternatives/missing-tool.json';
    await expect(client.alternative('missing-tool')).rejects.toMatchObject({
      code: 'not_found',
      path: missingPath,
      message: expect.stringContaining('does not advertise'),
    });
    expect(requestedPaths).toEqual(['/api/index.json', '/api/alternatives.json']);
  });

  it('rejects a recomputed attacker self-hash that differs from the indexed hash', async () => {
    const original = withEmbeddedContentHash(alternativesDetailFeed);
    const tamperedBody = {
      ...alternativesDetailFeed,
      data: {
        ...alternativesDetailFeed.data,
        description: 'Attacker-controlled description',
        sourceTool: {
          ...alternativesDetailFeed.data.sourceTool,
          description: 'Attacker-controlled description',
        },
      },
    };
    const tampered = withEmbeddedContentHash(tamperedBody);
    const index = {
      ...indexWithAlternatives(),
      contentHashes: {[DETAIL_PATH]: original.contentHash},
    };

    await expect(createDetailClient(tampered, index).alternative('figma')).rejects.toMatchObject({
      code: 'hash_mismatch',
      path: DETAIL_PATH,
      message: expect.stringContaining('does not match the index'),
    });
  });

  it('binds responses to the index revision and requested slug', async () => {
    const indexRevision = `sha256:${'1'.repeat(64)}`;
    const staleRevision = `sha256:${'2'.repeat(64)}`;
    const staleDetail = withEmbeddedContentHash({
      ...alternativesDetailFeed,
      catalogRevision: staleRevision,
    });
    const staleIndex = {
      ...indexWithAlternatives('https://slothhub.dev', staleDetail.contentHash),
      catalogRevision: indexRevision,
    };
    await expect(createDetailClient(staleDetail, staleIndex).alternative('figma')).rejects.toMatchObject({
      code: 'revision_mismatch',
      path: '/api/alternatives/figma.json',
    });
    const mismatchedDetail = withEmbeddedContentHash({
      ...alternativesDetailFeed,
      catalogRevision: indexRevision,
    });
    const mismatchedPath = '/api/alternatives/linear.json';
    const mismatchedIndex = {
      ...indexWithAlternatives(),
      catalogRevision: indexRevision,
      contentHashes: {[mismatchedPath]: mismatchedDetail.contentHash},
    };
    await expect(createDetailClient(mismatchedDetail, mismatchedIndex).alternative('linear')).rejects.toMatchObject({
      code: 'schema_invalid',
      path: mismatchedPath,
      message: expect.stringContaining('requested slug'),
    });
  });

  it('requires and verifies the embedded content hash', async () => {
    const published = withEmbeddedContentHash(alternativesDetailFeed);

    await expect(createDetailClient({
      ...alternativesDetailFeed,
      contentHash: undefined,
    }).alternative('figma')).rejects.toMatchObject({
      code: 'schema_invalid',
      path: '/api/alternatives/figma.json',
      message: expect.stringContaining('embedded content hash'),
    });
    await expect(createDetailClient(published).alternative('figma')).resolves.toMatchObject({
      data: {slug: 'figma'},
    });
    await expect(createDetailClient({
      ...published,
      data: {...published.data, name: 'Changed after publication'},
    }).alternative('figma')).rejects.toMatchObject({
      code: 'hash_mismatch',
      path: '/api/alternatives/figma.json',
    });
  });

  it('rejects a source Tool identity that disagrees', async () => {
    const detail = withEmbeddedContentHash({
      ...alternativesDetailFeed,
      data: {
        ...alternativesDetailFeed.data,
        sourceTool: {...alternativesDetailFeed.data.sourceTool, slug: 'linear'},
      },
    });

    await expect(createDetailClient(detail).alternative('figma')).rejects.toMatchObject({
      code: 'schema_invalid',
      path: '/api/alternatives/figma.json',
    });
  });

  it('rejects internally consistent citations on an untrusted feed origin', async () => {
    const evilOrigin = 'https://evil.example';
    const data = {
      ...alternativesDetailFeed.data,
      detailUrl: `${evilOrigin}/tool/figma`,
      alternativesUrl: `${evilOrigin}/tool/figma#alternatives-tools-heading`,
      markdownUrl: `${evilOrigin}/alternatives/figma.md`,
      jsonUrl: `${evilOrigin}/api/alternatives/figma.json`,
      alternatives: alternativesDetailFeed.data.alternatives.map((tool) => ({
        ...tool,
        detailUrl: `${evilOrigin}/tool/${tool.slug}`,
      })),
      sourceTool: {
        ...alternativesDetailFeed.data.sourceTool,
        detailUrl: `${evilOrigin}/tool/figma`,
      },
    };
    const detail = withEmbeddedContentHash({
      ...alternativesDetailFeed,
      siteUrl: evilOrigin,
      data,
    });

    await expect(createDetailClient(detail).alternative('figma')).rejects.toMatchObject({
      code: 'schema_invalid',
      path: '/api/alternatives/figma.json',
      message: expect.stringContaining('trusted catalog origin'),
    });
  });

  it('accepts producer-normalized multiline descriptions', async () => {
    const detail = withEmbeddedContentHash({
      ...alternativesDetailFeed,
      data: {
        ...alternativesDetailFeed.data,
        description: 'Collaborative design\nfor product teams',
        sourceTool: {
          ...alternativesDetailFeed.data.sourceTool,
          description: 'Collaborative design for product teams',
        },
      },
    });

    await expect(createDetailClient(detail).alternative('figma')).resolves.toMatchObject({
      data: {description: 'Collaborative design\nfor product teams'},
    });
  });

  it.each([
    {baseUrl: 'http://localhost:4321/catalog', transport: 'http://localhost:4321/catalog'},
    {baseUrl: 'https://slothhub.dev', transport: 'https://slothhub.dev'},
    {baseUrl: 'https://slothhub.dev', transport: 'https://preview.slothhub.dev'},
  ])('accepts catalog citations at $baseUrl through $transport', async ({baseUrl, transport}) => {
    const set = alternativesDetailFeed.data;
    const detail = withEmbeddedContentHash({
      ...alternativesDetailFeed,
      siteUrl: baseUrl,
      data: {
        ...set,
        detailUrl: `${baseUrl}/tool/${set.slug}`,
        alternativesUrl: `${baseUrl}/tool/${set.slug}#alternatives-tools-heading`,
        markdownUrl: `${baseUrl}/alternatives/${set.slug}.md`,
        jsonUrl: `${baseUrl}/api/alternatives/${set.slug}.json`,
        alternatives: set.alternatives.map((tool) => ({
          ...tool,
          detailUrl: `${baseUrl}/tool/${tool.slug}`,
        })),
        sourceTool: {
          ...set.sourceTool,
          detailUrl: `${baseUrl}/tool/${set.sourceTool.slug}`,
        },
      },
    });

    await expect(createDetailClient(
      detail,
      indexWithAlternatives(baseUrl, detail.contentHash),
      transport,
    ).alternative('figma')).resolves.toMatchObject({
      data: {detailUrl: `${baseUrl}/tool/figma`},
    });
  });

  it('rejects production impersonation through an unrelated Vercel tenant', () => {
    const previewBase = 'https://issue-590-preview.vercel.app';

    expect(() => createDetailClient(
      withEmbeddedContentHash(alternativesDetailFeed),
      indexWithAlternatives(),
      previewBase,
    )).toThrow('Unsupported feed base URL');
  });

  it.each([
    'https://slothhub.dev',
    'https://www.slothhub.dev',
    'https://preview.slothhub.dev',
  ])('accepts production-canonical citations through first-party transport %s', async (transport) => {
    await expect(createDetailClient(
      withEmbeddedContentHash(alternativesDetailFeed),
      indexWithAlternatives(),
      transport,
    ).alternative('figma')).resolves.toMatchObject({
      siteUrl: 'https://slothhub.dev',
      data: {detailUrl: 'https://slothhub.dev/tool/figma'},
    });
  });

  it('requires local development catalogs to use their local citation base', async () => {
    await expect(createDetailClient(
      withEmbeddedContentHash(alternativesDetailFeed),
      indexWithAlternatives(),
      'http://localhost:4321',
    ).alternative('figma')).rejects.toMatchObject({
      code: 'schema_invalid',
      path: '/api/alternatives/figma.json',
      message: expect.stringContaining('trusted alternatives citation base'),
    });
  });

  it('rejects a malformed index citation base at the earliest boundary', async () => {
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      persistentCache: false,
      fetchJson: async () => indexWithAlternatives('not a URL'),
    });

    await expect(client.alternatives()).rejects.toMatchObject({
      code: 'schema_invalid',
      path: '/api/index.json',
      message: expect.stringContaining('Invalid URL'),
    });
  });

  it.each([
    'https://slothhub.dev/preview',
    'https://slothhub.dev/%67o',
    'https://slothhub.dev?catalog=preview',
    'https://slothhub.dev#preview',
    'https://publisher@slothhub.dev',
  ])('rejects noncanonical production index base %s through a preview transport', async (siteUrl) => {
    const requestedPaths: string[] = [];
    const previewBase = 'https://preview.slothhub.dev';
    const client = createFeedClient({
      baseUrl: previewBase,
      persistentCache: false,
      fetchJson: async (url) => {
        const path = new URL(url).pathname;
        requestedPaths.push(path);
        if (path === '/api/index.json') return indexWithAlternatives(siteUrl);
        throw new Error(`Unexpected leaf request ${path}`);
      },
    });

    await expect(client.alternative('figma')).rejects.toMatchObject({
      code: 'schema_invalid',
      path: '/api/alternatives/figma.json',
      message: expect.stringContaining('trusted alternatives citation base'),
    });
    expect(requestedPaths).toEqual(['/api/index.json']);
  });

  it.each([
    ['name', {...alternativesDetailFeed.data, name: 'Wrong name'}],
    ['detail URL', {...alternativesDetailFeed.data, detailUrl: 'https://slothhub.dev/tool/linear'}],
    ['source detail URL', {
      ...alternativesDetailFeed.data,
      sourceTool: {
        ...alternativesDetailFeed.data.sourceTool,
        detailUrl: 'https://slothhub.dev/tool/linear',
      },
    }],
    ['description', {...alternativesDetailFeed.data, description: 'Wrong description'}],
  ])('rejects contradictory %s identity', async (_label, data) => {
    const detail = withEmbeddedContentHash({...alternativesDetailFeed, data});

    await expect(createDetailClient(detail).alternative('figma')).rejects.toMatchObject({
      code: 'schema_invalid',
      path: '/api/alternatives/figma.json',
      message: expect.stringMatching(/identity|canonical citation/u),
    });
  });
});
