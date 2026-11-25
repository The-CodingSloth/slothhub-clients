import {afterEach, describe, expect, it, vi} from 'vite-plus/test';

import {inspectCatalogDiagnostics, type AdvertisedFeedFetch} from './advertisedFeeds.js';
import {FEED_REQUEST_TIMEOUT_MS, MAX_FEED_RESPONSE_BYTES} from './feedClient.js';
import {indexFeed} from './fixtures.js';
import type {AgentIndexFeed} from './types.js';

const singleFeedIndex = (
  key: string,
  url: string,
  siteUrl = 'https://slothhub.dev',
): AgentIndexFeed => ({
  ...indexFeed,
  siteUrl,
  snapshots: {
    ...indexFeed.snapshots,
    ...(key === 'full' || key === 'ndjson' ? {[key]: url} : undefined),
  },
  feeds: {
    ...indexFeed.feeds,
    ...(key === 'full' || key === 'ndjson' ? undefined : {[key]: url}),
  },
});

const inspect = (
  index: AgentIndexFeed,
  options: {baseUrl?: string; fetchResponse?: AdvertisedFeedFetch} = {},
) => inspectCatalogDiagnostics(index, {
  baseUrl: options.baseUrl ?? 'https://slothhub.dev',
  fetchResponse: options.fetchResponse,
});

describe('advertised catalog diagnostics', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('classifies missing and failed advertised feeds without returning payloads', async () => {
    const minimal = singleFeedIndex(
      'alternatives',
      'https://slothhub.dev/api/alternatives.json',
    );
    const diagnostics = await inspect({
      ...minimal,
      feeds: {
        ...minimal.feeds,
        announcements: 'https://slothhub.dev/api/announcements.json',
        futureFeed: 'https://slothhub.dev/api/future.json',
      },
      snapshots: {
        full: 'https://slothhub.dev/api/catalog.snapshot.json',
        ndjson: 'https://slothhub.dev/api/catalog.ndjson',
      },
    }, {
      fetchResponse: async (url) => {
        if (url.endsWith('/alternatives.json')) return new Response(null, {status: 404});
        if (url.endsWith('/announcements.json')) {
          return new Response(null, {status: 503, statusText: 'Service Unavailable'});
        }
        return new Response(null, {status: 200});
      },
    });

    expect(diagnostics.document.statuses.filter(({key}) =>
      ['alternatives', 'announcements', 'futureFeed', 'full', 'ndjson'].includes(key),
    )).toEqual([
      expect.objectContaining({group: 'feeds', key: 'alternatives', status: 'unavailable'}),
      expect.objectContaining({group: 'feeds', key: 'announcements', status: 'error'}),
      expect.objectContaining({group: 'feeds', key: 'futureFeed', status: 'ok'}),
      expect.objectContaining({group: 'snapshots', key: 'full', status: 'ok'}),
      expect.objectContaining({group: 'snapshots', key: 'ndjson', status: 'ok'}),
    ]);
    expect(diagnostics.human).toContain(
      '- alternatives: unavailable https://slothhub.dev/api/alternatives.json',
    );
    expect(diagnostics.human).toContain(
      '- announcements: error (HTTP 503 Service Unavailable) https://slothhub.dev/api/announcements.json',
    );
  });

  it('bounds concurrent probes while preserving advertised order', async () => {
    const fullIndex: AgentIndexFeed = {
      ...indexFeed,
      feeds: {
        ...indexFeed.feeds,
        projectManifestTools: 'https://slothhub.dev/api/project-manifest-tools.json',
        alternatives: 'https://slothhub.dev/api/alternatives.json',
        comparisons: 'https://slothhub.dev/api/comparisons.json',
        announcements: 'https://slothhub.dev/api/announcements.json',
      },
    };
    let active = 0;
    let peak = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 0));
      active -= 1;
      return new Response(null, {status: 200});
    });

    const diagnostics = await inspect(fullIndex);
    expect(peak).toBe(4);
    expect(diagnostics.document.statuses.map(({group, key}) => `${group}.${key}`)).toEqual([
      'feeds.tools',
      'feeds.toolLookup',
      'feeds.searchIndex',
      'feeds.categories',
      'feeds.tags',
      'feeds.useCases',
      'feeds.stacks',
      'feeds.best',
      'feeds.projectManifestTools',
      'feeds.alternatives',
      'feeds.comparisons',
      'feeds.announcements',
      'snapshots.full',
      'snapshots.ndjson',
    ]);
  });

  it.each([405, 501])('falls back from HEAD %i to GET and cancels the body', async (status) => {
    const cancel = vi.fn();
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      if (init?.method === 'HEAD') {
        return new Response(null, {status});
      }
      return new Response(new ReadableStream({cancel}), {status: 200});
    });

    const diagnostics = await inspect(
      singleFeedIndex('ndjson', 'https://slothhub.dev/api/catalog.ndjson'),
    );
    expect(diagnostics.document.statuses.find(({key}) => key === 'ndjson')).toMatchObject({status: 'ok'});
    expect(fetch).toHaveBeenCalledWith(
      'https://slothhub.dev/api/catalog.ndjson',
      expect.objectContaining({method: 'HEAD', redirect: 'error'}),
    );
    expect(fetch).toHaveBeenCalledWith(
      'https://slothhub.dev/api/catalog.ndjson',
      expect.objectContaining({method: 'GET', redirect: 'error'}),
    );
    expect(cancel).toHaveBeenCalled();
  });

  it('does not apply the JSON body cap to a successful HEAD-only snapshot probe', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: {'content-length': String(MAX_FEED_RESPONSE_BYTES + 1)},
      }),
    );

    const diagnostics = await inspect(
      singleFeedIndex('full', 'https://slothhub.dev/api/catalog.snapshot.json'),
    );
    expect(diagnostics.document.statuses.find(({key}) => key === 'full')).toMatchObject({status: 'ok'});
  });

  it.each([
    'http://localhost:4321/admin',
    'http://127.0.0.1/private',
    'http://10.0.0.1/private',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/private',
    'https://attacker.example/rebinding-target',
  ])('does not probe unsafe advertised URL %s from a remote catalog', async (url) => {
    const fetchResponse = vi.fn<AdvertisedFeedFetch>(async () => new Response(null, {status: 200}));
    const diagnostics = await inspect(singleFeedIndex('futureFeed', url), {fetchResponse});
    expect(diagnostics.document.statuses.find(({key}) => key === 'futureFeed')).toMatchObject({status: 'error'});
    expect(fetchResponse.mock.calls.some(([calledUrl]) => calledUrl === url)).toBe(false);
  });

  it.each([
    'javascript:alert(1)',
    'https://user:password@example.com/private',
    'https://slothhub.dev/go/figma?surface=agent',
    'https://slothhub.dev/%67o/figma?surface=agent',
  ])('rejects malformed or tracked advertised URL %s before diagnostics are rendered', async (url) => {
    await expect(inspect(singleFeedIndex('futureFeed', url))).rejects.toMatchObject({
      code: 'invalid_advertised_catalog_url',
      group: 'feeds',
      key: 'futureFeed',
    });
  });

  it('permits only same-origin loopback feeds for local catalog development', async () => {
    const local = singleFeedIndex(
      'localFeed',
      'http://localhost:4321/api/tools.json',
      'http://localhost:4321',
    );
    const fetchResponse = vi.fn<AdvertisedFeedFetch>(async () => new Response(null, {status: 200}));
    const diagnostics = await inspect({
      ...local,
      feeds: {...local.feeds, otherPort: 'http://localhost:9000/private'},
    }, {
      baseUrl: 'http://localhost:4321',
      fetchResponse,
    });

    expect(diagnostics.document.statuses.find(({key}) => key === 'localFeed')).toMatchObject({status: 'ok'});
    expect(diagnostics.document.statuses.find(({key}) => key === 'otherPort')).toMatchObject({status: 'error'});
    expect(fetchResponse).toHaveBeenCalledOnce();
  });

  it('does not let a remote index site URL authorize a loopback destination', async () => {
    const loopbackUrl = 'http://127.0.0.1:9000/private';
    const fetchResponse = vi.fn<AdvertisedFeedFetch>(async () => new Response(null, {status: 200}));
    const diagnostics = await inspect(
      singleFeedIndex('futureFeed', loopbackUrl, 'http://127.0.0.1:9000'),
      {baseUrl: 'https://preview.slothhub.dev', fetchResponse},
    );

    expect(diagnostics.document.statuses.find(({key}) => key === 'futureFeed')).toMatchObject({
      status: 'error',
      detail: 'advertised URL is not a public catalog feed',
    });
    expect(fetchResponse.mock.calls.some(([calledUrl]) => calledUrl === loopbackUrl)).toBe(false);
  });

  it('rejects redirects instead of following an advertised feed to another origin', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: {location: 'http://169.254.169.254/latest/meta-data'},
      }),
    );

    const diagnostics = await inspect(
      singleFeedIndex('futureFeed', 'https://slothhub.dev/api/future.json'),
    );
    expect(diagnostics.document.statuses.find(({key}) => key === 'futureFeed')).toMatchObject({status: 'error', detail: 'HTTP 302'});
    expect(fetch).toHaveBeenCalledWith(
      'https://slothhub.dev/api/future.json',
      expect.objectContaining({redirect: 'error'}),
    );
  });

  it('honors the shared feed request timeout', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('This operation was aborted', 'AbortError')),
          {once: true},
        );
      }),
    );

    const request = inspect(
      singleFeedIndex('alternatives', 'https://slothhub.dev/api/alternatives.json'),
    );
    await vi.runAllTimersAsync();
    const diagnostics = await request;
    expect(diagnostics.document.statuses.find(({key}) => key === 'alternatives')).toMatchObject({
      status: 'error',
      detail: `timed out after ${FEED_REQUEST_TIMEOUT_MS}ms (configured deadline: ${FEED_REQUEST_TIMEOUT_MS}ms)`,
    });
  });

  it('times out and aborts a non-cooperative injected transport', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchResponse: AdvertisedFeedFetch = async (_url, init) => {
      if (!init.signal) throw new Error('Expected an internal abort signal');
      signal = init.signal;
      return await new Promise<Response>(() => undefined);
    };
    const request = inspect(
      singleFeedIndex('futureFeed', 'https://slothhub.dev/api/future.json'),
      {fetchResponse},
    );

    await vi.runAllTimersAsync();
    const diagnostics = await request;
    expect(diagnostics.document.statuses.find(({key}) => key === 'futureFeed')).toMatchObject({
      status: 'error',
      detail: expect.stringContaining('timed out'),
    });
    expect(signal?.aborted).toBe(true);
  });

  it('keeps the HTTP classification when response body cancellation fails', async () => {
    const diagnostics = await inspect(
      singleFeedIndex('futureFeed', 'https://slothhub.dev/api/future.json'),
      {
        fetchResponse: async () => new Response(new ReadableStream({
          cancel: () => {
            throw new Error('cancel failed');
          },
        }), {status: 404}),
      },
    );

    expect(diagnostics.document.statuses.find(({key}) => key === 'futureFeed')).toMatchObject({
      status: 'unavailable',
    });
  });

  it('builds one JSON document and the matching terminal-safe human view', async () => {
    const minimal = singleFeedIndex('tools', 'https://slothhub.dev/api/tools.json');
    const diagnostics = await inspect({
      ...minimal,
      version: '1.0.0\u001b]52;c;payload\u0007',
      generatedAt: '2026-08-29\nforged',
      feeds: {
        ...minimal.feeds,
        ['future\u009b31mfeed']: 'https://slothhub.dev/api/future.json\u2028forged',
      },
    }, {
      fetchResponse: async (url) => {
        if (url.includes('future')) throw new Error('failed\rforged');
        return new Response(null, {status: 200});
      },
    });

    expect(diagnostics.document.feeds.tools).toBe('https://slothhub.dev/api/tools.json');
    expect(diagnostics.document.statuses.find(({key}) => key === 'future\u009b31mfeed')).toMatchObject({status: 'error'});
    expect(diagnostics.human).not.toMatch(
      /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u,
    );
    expect(diagnostics.human).toContain('future 31mfeed');
    expect(diagnostics.human).toContain('failed forged');
    expect(JSON.stringify(diagnostics.document)).not.toContain('/go/');
  });
});
