import {describe, expect, it} from 'vite-plus/test';

import {runCli} from './cli.js';
import type {FetchJson} from './feedClient.js';
import {MAX_FEED_RESPONSE_BYTES} from './feedClient.js';
import {computeContentHash} from '@slothhub/domain/public-feed-content-identity';
import {
  alternativesDetailFeed,
  alternativesFeed,
  denseComparisonFacts,
  indexFeed,
} from './fixtures.js';

const withEmbeddedContentHash = (feed: typeof alternativesDetailFeed) => ({
  ...feed,
  contentHash: computeContentHash(feed),
});

const advertisedIndexFeed = {
  ...indexFeed,
  contentHashes: {
    '/api/alternatives.json': computeContentHash(alternativesFeed),
    '/api/alternatives/figma.json': alternativesDetailFeed.contentHash,
  },
  feeds: {
    ...indexFeed.feeds,
    alternatives: 'https://slothhub.dev/api/alternatives.json',
  },
};

const indexForAlternativesFeed = (feed: typeof alternativesFeed) => ({
  ...advertisedIndexFeed,
  contentHashes: {
    ...advertisedIndexFeed.contentHashes,
    '/api/alternatives.json': computeContentHash(feed),
  },
});

const fetchJson: FetchJson = async (url) => {
  const path = new URL(url).pathname;
  if (path === '/api/index.json') return advertisedIndexFeed;
  if (path === '/api/alternatives.json') return alternativesFeed;
  if (path === '/api/alternatives/figma.json') {
    return withEmbeddedContentHash(alternativesDetailFeed);
  }
  throw new Error(`Unexpected feed ${path}`);
};

const fetchDetail = (detail: typeof alternativesDetailFeed): FetchJson => {
  const feed = withEmbeddedContentHash(detail);
  return async (url) => {
    const path = new URL(url).pathname;
    if (path === '/api/index.json') return {
      ...advertisedIndexFeed,
      contentHashes: {...advertisedIndexFeed.contentHashes, '/api/alternatives/figma.json': feed.contentHash},
    };
    if (path === '/api/alternatives/figma.json') return feed;
    return fetchJson(url);
  };
};

describe('alternatives command', () => {
  it('lists a populated alternatives page with canonical URLs', async () => {
    const result = await runCli(['alternatives'], {fetchJson});

    expect(result).toMatchObject({exitCode: 0, stderr: ''});
    expect(result.stdout).toContain('Figma (figma)');
    expect(result.stdout).toContain('1 alternative');
    expect(result.stdout).toContain('https://slothhub.dev/tool/figma#alternatives-tools-heading');
    expect(result.stdout).not.toContain('/go/');
  });

  it('emits stable pagination metadata and citation-safe summaries in JSON', async () => {
    const result = await runCli(['alternatives', '--limit', '1', '--json'], {fetchJson});

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      total: 2,
      count: 1,
      offset: 0,
      hasMore: true,
      nextOffset: 1,
      alternatives: [
        {
          name: 'Figma',
          slug: 'figma',
          detailUrl: 'https://slothhub.dev/tool/figma',
          alternativesUrl: 'https://slothhub.dev/tool/figma#alternatives-tools-heading',
          alternativeCount: 1,
        },
      ],
    });
    expect(result.stdout).not.toContain('/go/');
  });

  it('returns the requested nonzero page', async () => {
    const result = await runCli(
      ['alternatives', '--limit', '1', '--offset', '1', '--json'],
      {fetchJson},
    );

    expect(JSON.parse(result.stdout)).toEqual({
      total: 2,
      count: 1,
      offset: 1,
      hasMore: false,
      alternatives: [
        {
          name: 'Linear',
          slug: 'linear',
          detailUrl: 'https://slothhub.dev/tool/linear',
          alternativesUrl: 'https://slothhub.dev/tool/linear#alternatives-tools-heading',
          alternativeCount: 1,
        },
      ],
    });
  });

  it('rejects invalid pagination before fetching any feed', async () => {
    const requested: string[] = [];
    const result = await runCli(['alternatives', '--limit', '51', '--json'], {
      fetchJson: async (url) => {
        requested.push(new URL(url).pathname);
        return fetchJson(url);
      },
    });

    expect(result).toMatchObject({exitCode: 2, stderr: ''});
    expect(JSON.parse(result.stdout)).toMatchObject({
      code: 'agent_search_result_limit_out_of_range',
      observedValue: 51,
      configuredLimit: 50,
      recovery: expect.stringContaining('--help'),
    });
    expect(requested).toEqual([]);
  });

  it('returns an actionable capability error when the index omits alternatives', async () => {
    const requested: string[] = [];
    const result = await runCli(['alternatives', '--json'], {
      fetchJson: async (url) => {
        requested.push(new URL(url).pathname);
        return indexFeed;
      },
    });

    expect(result).toMatchObject({exitCode: 1, stderr: ''});
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      code: 'capability_unavailable',
      message: 'This catalog does not advertise the alternatives feed.',
      recovery: 'Use a newer SlothHub catalog or run `slothhub doctor --json` to inspect available feeds.',
    });
    expect(requested).toEqual(['/api/index.json']);
  });

  it('fetches and renders one alternatives set from its detail feed', async () => {
    const requested: string[] = [];
    const result = await runCli(['alternatives', 'figma'], {
      fetchJson: async (url) => {
        requested.push(new URL(url).pathname);
        return fetchJson(url);
      },
    });

    expect(result).toMatchObject({exitCode: 0, stderr: ''});
    expect(result.stdout).toContain('Alternatives to Figma');
    expect(result.stdout).toContain('Source: https://slothhub.dev/tool/figma');
    expect(result.stdout).toContain('Linear (linear)');
    expect(result.stdout).toContain('https://slothhub.dev/tool/linear');
    expect(result.stdout).not.toContain('/go/');
    expect(requested).toEqual([
      '/api/index.json',
      '/api/alternatives/figma.json',
    ]);
  });

  it('emits citation-safe JSON for one alternatives set', async () => {
    const result = await runCli(['alternatives', 'figma', '--json'], {fetchJson});

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      name: 'Figma',
      slug: 'figma',
      description: 'Collaborative design platform',
      detailUrl: 'https://slothhub.dev/tool/figma',
      alternativesUrl: 'https://slothhub.dev/tool/figma#alternatives-tools-heading',
      alternativeCount: 1,
      alternatives: [
        {
          name: 'Linear',
          slug: 'linear',
          description: 'Issue tracking for product teams',
          pricing: 'paid',
          platforms: ['web'],
          detailUrl: 'https://slothhub.dev/tool/linear',
        },
      ],
      markdownUrl: 'https://slothhub.dev/alternatives/figma.md',
      jsonUrl: 'https://slothhub.dev/api/alternatives/figma.json',
      sourceTool: {
        name: 'Figma',
        slug: 'figma',
        description: 'Collaborative design platform',
        pricing: 'freemium',
        platforms: ['web', 'desktop'],
        detailUrl: 'https://slothhub.dev/tool/figma',
      },
    });
    expect(result.stdout).not.toContain('/go/');
  });

  it('preserves set and per-alternative facts in human and JSON detail output', async () => {
    const setFacts = {migrationNotes: 'Export designs before switching'};
    const toolFacts = {
      bestFor: ['Planning'],
      notBestFor: ['Drawing'],
      strengths: ['Quick triage'],
      limitations: ['Requires a network'],
      pricingNotes: 'Paid plans',
      platformNotes: 'Web',
      migrationNotes: 'Import tasks',
    };
    const load = fetchDetail({
      ...alternativesDetailFeed,
      data: {
        ...alternativesDetailFeed.data,
        comparisonFacts: setFacts,
        alternatives: alternativesDetailFeed.data.alternatives.map((tool) => ({...tool, comparisonFacts: toolFacts})),
      },
    });
    const human = await runCli(['alternatives', 'figma'], {fetchJson: load});
    const json = await runCli(['alternatives', 'figma', '--json'], {fetchJson: load});

    expect(human).toMatchObject({exitCode: 0, stderr: ''});
    expect(human.stdout).toContain('Migration: Export designs before switching\n\nLinear (linear)');
    expect(human.stdout).toContain('Best for:\n- Planning\nNot best for:\n- Drawing\nStrengths:\n- Quick triage\nLimitations:\n- Requires a network');
    expect(human.stdout).toContain('Pricing: Paid plans\nPlatforms: Web\nMigration: Import tasks');
    expect(json.exitCode).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({
      comparisonFacts: setFacts,
      alternatives: [{comparisonFacts: toolFacts}],
    });
    expect(human.stdout).not.toContain('/go/');
    expect(json.stdout).not.toContain('/go/');
  });

  it('prints dense Unicode set and alternative facts without an extra output cap', async () => {
    const detail = {...alternativesDetailFeed, data: {
      ...alternativesDetailFeed.data,
      comparisonFacts: denseComparisonFacts,
      alternatives: alternativesDetailFeed.data.alternatives.map((tool) => ({
        ...tool,
        name: '設計ツール 🦥',
        comparisonFacts: {...denseComparisonFacts, migrationNotes: '最後の移行メモ 🦥'},
      })),
    }};
    // The transport already rejects feeds above its byte budget; accepted facts stay complete.
    expect(Buffer.byteLength(JSON.stringify(detail))).toBeLessThan(MAX_FEED_RESPONSE_BYTES);
    const result = await runCli(['alternatives', 'figma'], {fetchJson: fetchDetail(detail)});

    expect(result).toMatchObject({exitCode: 0, stderr: ''});
    for (const value of Object.values(denseComparisonFacts).flat()) {
      expect(result.stdout).toContain(value.trim());
    }
    expect(result.stdout).toContain('設計ツール 🦥 (linear)');
    expect(result.stdout).toContain('Migration: 最後の移行メモ 🦥');
  });

  it('preserves comparison facts in detail JSON', async () => {
    const comparisonFacts = {
      bestFor: ['Design systems\nwith shared libraries'],
      pricingNotes: 'Free starter plan\nPaid organization plans',
      claimStandard: 'facts_only' as const,
    };
    const detail = withEmbeddedContentHash({
      ...alternativesDetailFeed,
      data: {...alternativesDetailFeed.data, comparisonFacts},
    });
    const result = await runCli(['alternatives', 'figma', '--json'], {
      fetchJson: async (url) => {
        const path = new URL(url).pathname;
        if (path === '/api/index.json') return {
          ...advertisedIndexFeed,
          contentHashes: {'/api/alternatives/figma.json': detail.contentHash},
        };
        if (path === '/api/alternatives/figma.json') return detail;
        throw new Error(`Unexpected feed ${path}`);
      },
    });

    expect(JSON.parse(result.stdout)).toMatchObject({comparisonFacts});
  });

  it('returns not_found with list recovery for an unknown slug', async () => {
    const requested: string[] = [];
    const result = await runCli(['alternatives', 'missing-tool', '--json'], {
      fetchJson: async (url) => {
        const path = new URL(url).pathname;
        requested.push(path);
        if (path === '/api/index.json') return advertisedIndexFeed;
        if (path === '/api/alternatives.json') return alternativesFeed;
        throw new Error('HTTP 404');
      },
    });

    expect(result).toMatchObject({exitCode: 3, stderr: ''});
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      code: 'not_found',
      message: 'Alternatives set not found: missing-tool.',
      recovery: 'Run `slothhub alternatives` to list available alternatives sets.',
    });
    expect(requested).toEqual(['/api/index.json', '/api/alternatives.json']);
  });

  it.each([
    ['omitted', undefined],
    ['empty', {}],
    [
      'unrelated',
      {'/api/search-index.json': '0'.repeat(64)},
    ],
  ])('preserves schema_invalid and authentication recovery when index hashes are %s', async (_, contentHashes) => {
    const requested: string[] = [];
    const result = await runCli(['alternatives', 'figma', '--json'], {
      fetchJson: async (url) => {
        requested.push(new URL(url).pathname);
        return {
          ...advertisedIndexFeed,
          contentHashes,
        };
      },
    });

    expect(result).toMatchObject({exitCode: 1, stderr: ''});
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      code: 'schema_invalid',
      path: '/api/alternatives/figma.json',
      message: expect.stringContaining('does not authenticate'),
      recovery: expect.stringContaining('slothhub doctor --json'),
    });
    expect(requested).toEqual(['/api/index.json']);
  });

  it('preserves compatibility guidance for malformed alternatives feeds', async () => {
    const malformedFeed = {...alternativesFeed, data: {sets: 'invalid'}};
    const result = await runCli(['alternatives', '--json'], {
      fetchJson: async (url) => new URL(url).pathname === '/api/index.json'
        ? {...advertisedIndexFeed, contentHashes: {'/api/alternatives.json': computeContentHash(malformedFeed)}}
        : malformedFeed,
    });

    expect(JSON.parse(result.stdout)).toMatchObject({
      code: 'schema_invalid',
      recovery: expect.stringContaining('/agents/feed-compatibility.md'),
    });
  });

  it('rejects malformed slugs before fetching any feed', async () => {
    const requested: string[] = [];
    const result = await runCli(['alternatives', '../figma', '--json'], {
      fetchJson: async (url) => {
        requested.push(new URL(url).pathname);
        return fetchJson(url);
      },
    });

    expect(result).toMatchObject({exitCode: 2, stderr: ''});
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      code: 'invalid_input',
      message: 'Alternatives slug must be a canonical public slug.',
      observedValue: '../figma',
      recovery: 'Run `slothhub alternatives` to list valid slugs.',
    });
    expect(requested).toEqual([]);
  });

  it('rejects an explicitly empty slug before fetching any feed', async () => {
    const requested: string[] = [];
    const result = await runCli(['alternatives', '', '--json'], {
      fetchJson: async (url) => {
        requested.push(new URL(url).pathname);
        return fetchJson(url);
      },
    });

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      code: 'invalid_input',
      observedValue: '',
    });
    expect(requested).toEqual([]);
  });

  it.each([
    ['--limit', '1'],
    ['--offset', '1'],
    ['--limit', 'nope'],
    ['--offset', 'nope'],
  ])('rejects detail pagination %s %s before fetching', async (flag, value) => {
    const requested: string[] = [];
    const result = await runCli(['alternatives', 'figma', flag, value, '--json'], {
      fetchJson: async (url) => {
        requested.push(new URL(url).pathname);
        return fetchJson(url);
      },
    });

    expect(result).toMatchObject({exitCode: 2, stderr: ''});
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      code: 'invalid_input',
      message: '--limit and --offset are only supported when listing alternatives.',
      recovery: 'Remove pagination flags when requesting one alternatives slug.',
    });
    expect(requested).toEqual([]);
  });

  it('rejects extra slugs before fetching', async () => {
    const requested: string[] = [];
    const result = await runCli(['alternatives', 'figma', 'linear', '--json'], {
      fetchJson: async (url) => {
        requested.push(new URL(url).pathname);
        return fetchJson(url);
      },
    });

    expect(result).toMatchObject({exitCode: 2, stderr: ''});
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      code: 'invalid_input',
      message: 'alternatives accepts at most one slug.',
      recovery: 'Run `slothhub alternatives` to list sets or pass one canonical slug.',
    });
    expect(requested).toEqual([]);
  });

  it('returns successful empty pages for empty feeds and overflow offsets', async () => {
    const emptyFeed = {
      ...alternativesFeed,
      data: {...alternativesFeed.data, sets: []},
    };
    const empty = await runCli(['alternatives'], {
      fetchJson: async (url) => {
        const path = new URL(url).pathname;
        if (path === '/api/index.json') return indexForAlternativesFeed(emptyFeed);
        if (path === '/api/alternatives.json') return emptyFeed;
        throw new Error(`Unexpected feed ${path}`);
      },
    });
    const overflowHuman = await runCli(['alternatives', '--offset', '99'], {fetchJson});
    const overflow = await runCli(['alternatives', '--offset', '99', '--json'], {fetchJson});

    expect(empty).toEqual({
      exitCode: 0,
      stdout: 'No alternatives found.\n',
      stderr: '',
    });
    expect(overflowHuman).toEqual({
      exitCode: 0,
      stdout: 'No alternatives at offset 99 (2 total). Retry with --offset 0.\n',
      stderr: '',
    });
    expect(JSON.parse(overflow.stdout)).toEqual({
      total: 2,
      count: 0,
      offset: 99,
      hasMore: false,
      alternatives: [],
    });
  });

  it('defaults list pagination to 20 and caps explicit limits at 50', async () => {
    const first = alternativesFeed.data.sets[0]!;
    const sets = Array.from({length: 21}, (_, index) => ({
      ...first,
      name: `Tool ${index}`,
      slug: `tool-${index}`,
      detailUrl: `https://slothhub.dev/tool/tool-${index}`,
      alternativesUrl: `https://slothhub.dev/tool/tool-${index}#alternatives-tools-heading`,
      markdownUrl: `https://slothhub.dev/alternatives/tool-${index}.md`,
      jsonUrl: `https://slothhub.dev/api/alternatives/tool-${index}.json`,
    }));
    const pagedFeed = {...alternativesFeed, data: {...alternativesFeed.data, sets}};
    const result = await runCli(['alternatives', '--json'], {
      fetchJson: async (url) => {
        const path = new URL(url).pathname;
        if (path === '/api/index.json') return indexForAlternativesFeed(pagedFeed);
        if (path === '/api/alternatives.json') return pagedFeed;
        throw new Error(`Unexpected feed ${path}`);
      },
    });

    expect(JSON.parse(result.stdout)).toMatchObject({
      total: 21,
      count: 20,
      offset: 0,
      hasMore: true,
      nextOffset: 20,
    });
  });

  it('announces the next offset when human output is truncated', async () => {
    const first = alternativesFeed.data.sets[0]!;
    const sets = Array.from({length: 21}, (_, index) => ({
      ...first,
      name: `Tool ${index}`,
      slug: `tool-${index}`,
      detailUrl: `https://slothhub.dev/tool/tool-${index}`,
      alternativesUrl: `https://slothhub.dev/tool/tool-${index}#alternatives-tools-heading`,
      markdownUrl: `https://slothhub.dev/alternatives/tool-${index}.md`,
      jsonUrl: `https://slothhub.dev/api/alternatives/tool-${index}.json`,
    }));
    const pagedFeed = {...alternativesFeed, data: {...alternativesFeed.data, sets}};
    const result = await runCli(['alternatives'], {
      fetchJson: async (url) => {
        const path = new URL(url).pathname;
        if (path === '/api/index.json') return indexForAlternativesFeed(pagedFeed);
        if (path === '/api/alternatives.json') return pagedFeed;
        throw new Error(`Unexpected feed ${path}`);
      },
    });

    expect(result.stdout).toContain('More results available. Use --offset 20.');
    expect(result.stdout).not.toContain('Tool 20 (tool-20)');
  });

  it.each(['-1', '1.5', 'nope'])('rejects invalid offset %s before fetching', async (offset) => {
    const requested: string[] = [];
    const result = await runCli(['alternatives', '--offset', offset, '--json'], {
      fetchJson: async (url) => {
        requested.push(new URL(url).pathname);
        return fetchJson(url);
      },
    });

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      code: 'invalid_input',
      observedValue: offset === 'nope' ? offset : Number(offset),
      recovery: expect.stringContaining('--help'),
    });
    expect(requested).toEqual([]);
  });

  it.each(['0', '-1', '1.5', 'nope'])(
    'rejects invalid limit %s before fetching',
    async (limit) => {
      const requested: string[] = [];
      const result = await runCli(['alternatives', '--limit', limit, '--json'], {
        fetchJson: async (url) => {
          requested.push(new URL(url).pathname);
          return fetchJson(url);
        },
      });

      expect(result.exitCode).toBe(2);
      expect(JSON.parse(result.stdout)).toMatchObject({
        code: 'agent_search_result_limit_out_of_range',
        observedValue: limit === 'nope' ? limit : Number(limit),
        recovery: expect.stringContaining('--help'),
      });
      expect(requested).toEqual([]);
    },
  );

  it.each(['--limit', '--offset'])(
    'sanitizes hostile %s diagnostics in human output',
    async (flag) => {
      const result = await runCli(
        ['alternatives', flag, '1\u001b]52;c;copied\u0007\u202e'],
        {fetchJson},
      );

      expect(result.exitCode).toBe(2);
      expect(result.stderr).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e]/u);
      expect(result.stderr).toContain('observed');
    },
  );

  it('keeps missing capability typed in detail mode', async () => {
    const result = await runCli(['alternatives', 'figma', '--json'], {
      fetchJson: async () => indexFeed,
    });

    expect(JSON.parse(result.stdout)).toMatchObject({
      code: 'capability_unavailable',
      recovery: expect.stringContaining('doctor'),
    });
  });

  it('does not misclassify an index 404 as an unknown alternatives slug', async () => {
    const result = await runCli(['alternatives', 'figma', '--json'], {
      fetchJson: async () => {
        throw new Error('HTTP 404');
      },
    });

    expect(result.exitCode).toBe(5);
    expect(JSON.parse(result.stdout)).toMatchObject({
      code: 'transport',
      message: expect.stringContaining('/api/index.json'),
      recovery: expect.stringContaining('doctor'),
    });
  });

  it.each([
    {
      expectedCode: 'hash_mismatch',
      detail: withEmbeddedContentHash({
        ...alternativesDetailFeed,
        data: {...alternativesDetailFeed.data, name: 'Tampered name'},
      }),
      index: advertisedIndexFeed,
    },
    {
      expectedCode: 'revision_mismatch',
      detail: withEmbeddedContentHash({
        ...alternativesDetailFeed,
        catalogRevision: `sha256:${'2'.repeat(64)}`,
      }),
      index: {
        ...advertisedIndexFeed,
        catalogRevision: `sha256:${'1'.repeat(64)}`,
        contentHashes: {
          ...advertisedIndexFeed.contentHashes,
          '/api/alternatives/figma.json': computeContentHash({
            ...alternativesDetailFeed,
            catalogRevision: `sha256:${'2'.repeat(64)}`,
          }),
        },
      },
    },
  ])('preserves $expectedCode as a machine-readable integrity failure', async ({
    expectedCode,
    detail,
    index,
  }) => {
    const result = await runCli(['alternatives', 'figma', '--json'], {
      fetchJson: async (url) => new URL(url).pathname === '/api/index.json' ? index : detail,
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      code: expectedCode,
      path: '/api/alternatives/figma.json',
      recovery: expect.stringContaining('doctor'),
    });
  });

  it('documents list and detail modes plus alternatives pagination in help', async () => {
    const result = await runCli(['alternatives', '--help'], {
      fetchJson: async () => {
        throw new Error('Help must not fetch feeds');
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('alternatives [slug]');
    expect(result.stdout).toContain('List sets or show alternatives for one Tool');
    expect(result.stdout).toContain('list commands default to 20');
    expect(result.stdout).toContain('list commands (default 0)');
  });
});
