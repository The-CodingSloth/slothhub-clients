import { describe, expect, it } from 'vite-plus/test';

import type {
  AgentAlternativesDetailFeed,
  AgentAlternativesFeed,
  AgentToolSummary,
} from '../types.js';
import {alternativesDetailFeedSchema} from '@slothhub/domain/public-feed-mcp-schemas';
import { ResponseFormat } from '../constants.js';
import { FeedCapabilityUnavailableError, FeedRequestError } from '../services/feeds.js';
import { getAlternativesInputSchema } from '../schemas/inputs.js';
import {
  handleGetAlternatives,
  handleListAlternatives,
} from './handlers.js';

const altTool = (overrides: Partial<AgentToolSummary> = {}): AgentToolSummary => ({
  name: 'Alternative Tool',
  slug: 'alternative-tool',
  description: 'An alternative for catalogs',
  resourceKind: { value: 'app', label: 'App' },
  resourceIdentity: {
    kind: 'website',
    kindLabel: 'Website',
    canonicalUrl: 'https://alt.example.com/',
    ctaLabel: 'Open site',
  },
  pricing: 'free',
  platforms: ['web'],
  categories: [{ name: 'Design', slug: 'design' }],
  tags: [],
  useCases: [],
  freshness: { isVerified: true, verifiedAt: '2026-07-01T00:00:00.000Z' },
  detailUrl: 'https://slothhub.dev/tool/alternative-tool',
  visitUrl: 'https://slothhub.dev/go/alternative-tool?surface=agent',
  ...overrides,
});

const alternativesFeed = (
  sets: AgentAlternativesFeed['data']['sets'] = [
    {
      name: 'Example Tool',
      slug: 'example-tool',
      detailUrl: 'https://slothhub.dev/tool/example-tool',
      alternativesUrl: 'https://slothhub.dev/alternatives/example-tool',
      alternativeCount: 1,
      alternatives: [altTool()],
      markdownUrl: 'https://slothhub.dev/alternatives/example-tool.md',
      jsonUrl: 'https://slothhub.dev/api/alternatives/example-tool.json',
    },
  ],
): AgentAlternativesFeed => ({
  version: '33.0.0',
  siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-07-08T00:00:00.000Z',
  data: {
    alternativesUrl: 'https://slothhub.dev/alternatives',
    sets,
  },
});

const detailFeed = (
  overrides: Partial<AgentAlternativesDetailFeed['data']> = {},
): AgentAlternativesDetailFeed => ({
  version: '33.0.0',
  siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-07-08T00:00:00.000Z',
  data: {
    name: 'Example Tool',
    slug: 'example-tool',
    detailUrl: 'https://slothhub.dev/tool/example-tool',
    alternativesUrl: 'https://slothhub.dev/alternatives/example-tool',
    alternativeCount: 1,
    alternatives: [altTool()],
    markdownUrl: 'https://slothhub.dev/alternatives/example-tool.md',
    jsonUrl: 'https://slothhub.dev/api/alternatives/example-tool.json',
    description: 'A catalog mainstay.',
    sourceTool: altTool({
      name: 'Example Tool',
      slug: 'example-tool',
      detailUrl: 'https://slothhub.dev/tool/example-tool',
    }),
    ...overrides,
  },
});

const listClient = (feed: AgentAlternativesFeed = alternativesFeed()) => ({
  alternatives: async () => feed,
});
const detailClient = (feed: AgentAlternativesDetailFeed = detailFeed()) => ({
  alternativesDetail: async () => feed,
});

const listParams = {
  limit: 20,
  offset: 0,
  response_format: ResponseFormat.MARKDOWN,
};
const getParams = {
  slug: 'example-tool',
  response_format: ResponseFormat.MARKDOWN,
};

describe('Alternative interface facts parsing', () => {
  it.each([undefined, ['mcp_server', 'cli']])('retains old and new alternative summaries: %j', (agentInterfaceKinds) => {
    const feed = detailFeed();
    const payload = {...feed, data: {...feed.data,
      alternatives: feed.data.alternatives.map((tool) => ({...tool, agentInterfaceKinds})),
    }};
    expect(alternativesDetailFeedSchema.parse(payload).data.alternatives[0]?.agentInterfaceKinds).toEqual(agentInterfaceKinds);
    expect(alternativesDetailFeedSchema.safeParse({...payload, data: {...payload.data,
      alternatives: payload.data.alternatives.map((tool) => ({...tool, agentInterfaceKinds: ['invented_kind']})),
    }}).success).toBe(false);
  });
});

describe('handleListAlternatives', () => {
  it('lists set summaries with stable pagination metadata', async () => {
    const result = await handleListAlternatives(listClient() as never, listParams);
    expect(result.content).toContainEqual({type: 'resource_link', uri: 'slothhub://alternatives/example-tool', name: 'Example Tool', mimeType: 'application/json'});

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      query: '',
      total: 1,
      count: 1,
      offset: 0,
      has_more: false,
    });
    const sets = (result.structuredContent as Record<string, unknown>)
      .alternatives as Array<Record<string, unknown>>;
    expect(sets[0]).toMatchObject({
      name: 'Example Tool',
      slug: 'example-tool',
      alternativesUrl: 'https://slothhub.dev/alternatives/example-tool',
      alternativeCount: 1,
    });
    // List returns summaries — no nested alternative sets.
    expect(sets[0]).not.toHaveProperty('alternatives');
  });

  it('returns a valid empty result for an empty feed', async () => {
    const result = await handleListAlternatives(
      listClient(alternativesFeed([])) as never,
      listParams,
    );

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      total: 0,
      count: 0,
      has_more: false,
      alternatives: [],
    });
  });

  it('filters sets by query and paginates', async () => {
    const sets = [
      ...alternativesFeed().data.sets,
      {
        name: 'Figma',
        slug: 'figma',
        detailUrl: 'https://slothhub.dev/tool/figma',
        alternativesUrl: 'https://slothhub.dev/alternatives/figma',
        alternativeCount: 4,
        alternatives: [altTool()],
        markdownUrl: 'https://slothhub.dev/alternatives/figma.md',
        jsonUrl: 'https://slothhub.dev/api/alternatives/figma.json',
      },
      {
        name: 'Sketch',
        slug: 'sketch',
        detailUrl: 'https://slothhub.dev/tool/sketch',
        alternativesUrl: 'https://slothhub.dev/alternatives/sketch',
        alternativeCount: 2,
        alternatives: [altTool()],
        markdownUrl: 'https://slothhub.dev/alternatives/sketch.md',
        jsonUrl: 'https://slothhub.dev/api/alternatives/sketch.json',
      },
    ];
    const result = await handleListAlternatives(
      listClient(alternativesFeed(sets)) as never,
      { ...listParams, query: 'fig' },
    );

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      query: 'fig',
      total: 1,
      count: 1,
    });
  });

  it('surfaces capability_unavailable when the catalog lacks the feed', async () => {
    const client = {
      alternatives: async () => {
        throw new FeedCapabilityUnavailableError('alternatives feed', {
          reason: 'this catalog does not advertise /api/alternatives.json',
          recovery: 'Upgrade the catalog.',
        });
      },
    };
    const result = await handleListAlternatives(client as never, listParams);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: 'capability_unavailable',
    });
  });

  it('escapes catalog-controlled set names in markdown', async () => {
    const hostile = alternativesFeed([
      {
        ...alternativesFeed().data.sets[0]!,
        name: 'Evil <script>alert(1)</script> **bold**',
      },
    ]);
    const result = await handleListAlternatives(listClient(hostile) as never, listParams);

    expect(result.isError).toBeFalsy();
    const markdown = result.content[0]?.text ?? '';
    expect(markdown).toContain('\\<script\\>');
    expect(markdown).not.toContain('**bold**');
  });
});

describe('handleGetAlternatives', () => {
  it('renders the set with alternatives and comparison facts', async () => {
    const feed = detailFeed({
      comparisonFacts: {
        strengths: ['Open source', 'Self-hostable'],
        limitations: ['No mobile app'],
      },
      alternatives: [
        altTool({
          comparisonFacts: { strengths: ['Cheaper'], pricingNotes: 'Free tier' },
        }),
      ],
    });
    const result = await handleGetAlternatives(detailClient(feed) as never, getParams);

    expect(result.isError).toBeFalsy();
    const markdown = result.content[0]?.text ?? '';
    expect(markdown).toContain('# Alternatives to Example Tool');
    expect(markdown).toContain('Strengths: Open source; Self-hostable');
    expect(markdown).toContain('Strengths: Cheaper');
    expect(markdown).toContain('Pricing: Free tier');
    expect(markdown).toContain('Cite: https://slothhub.dev/alternatives/example-tool');
    expect(markdown).not.toContain('/go/');

    expect(result.structuredContent).toMatchObject({
      alternatives: {
        slug: 'example-tool',
        sourceTool: { slug: 'example-tool' },
        comparisonFacts: { strengths: ['Open source', 'Self-hostable'] },
      },
    });
  });

  it('keeps omitted comparison facts absent instead of synthesizing empties', async () => {
    const result = await handleGetAlternatives(detailClient() as never, getParams);

    expect(result.isError).toBeFalsy();
    const markdown = result.content[0]?.text ?? '';
    expect(markdown).not.toContain('Strengths:');
    expect(markdown).not.toContain('Limitations:');
    const structured = result.structuredContent as {
      alternatives: { comparisonFacts?: unknown; alternatives: Array<{ comparisonFacts?: unknown }> };
    };
    expect('comparisonFacts' in structured.alternatives).toBe(false);
    expect('comparisonFacts' in (structured.alternatives.alternatives[0] ?? {})).toBe(false);
  });

  it('returns not_found for a missing slug (HTTP 404)', async () => {
    const client = {
      alternativesDetail: async () => {
        throw new FeedRequestError(
          '/api/alternatives/missing.json',
          'https://slothhub.dev/api/alternatives/missing.json',
          'HTTP 404 Not Found',
        );
      },
    };
    const result = await handleGetAlternatives(
      client as never,
      { slug: 'missing', response_format: ResponseFormat.JSON },
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: 'not_found',
      suggestion: 'Alternatives use the source Tool slug (slothhub://alternatives/{slug}). Check the slug with search; a Tool with no published alternatives set has none to return.',
    });
  });

  it('returns not_found when the detail path is not authenticated', async () => {
    const client = {
      alternativesDetail: async () => {
        throw new FeedRequestError(
          '/api/alternatives/missing.json',
          'https://slothhub.dev/api/alternatives/missing.json',
          'Public feed index does not authenticate /api/alternatives/missing.json',
        );
      },
    };
    const result = await handleGetAlternatives(client as never, getParams);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: 'not_found' });
  });

  it('maps other feed failures to feed_load_error, not not_found', async () => {
    const client = {
      alternativesDetail: async () => {
        throw new FeedRequestError(
          '/api/alternatives/example-tool.json',
          'https://slothhub.dev/api/alternatives/example-tool.json',
          'HTTP 500 Internal Server Error',
        );
      },
    };
    const result = await handleGetAlternatives(client as never, getParams);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: 'feed_load_error' });
  });

  it('escapes catalog-controlled text in the detail markdown', async () => {
    const feed = detailFeed({
      name: 'Tool <img src=x>',
      description: 'See [click](javascript:alert(1))',
      alternatives: [altTool({ name: 'Alt `code` name' })],
    });
    const result = await handleGetAlternatives(detailClient(feed) as never, getParams);

    expect(result.isError).toBeFalsy();
    const markdown = result.content[0]?.text ?? '';
    expect(markdown).toContain('\\<img');
    expect(markdown).toContain('\\[click\\]');
    expect(markdown).toContain('\\`code\\`');
  });
});

describe('getAlternativesInputSchema', () => {
  it('rejects malformed slugs before any fetch', () => {
    for (const slug of ['', 'UPPER', '../etc', 'has space', 'slug.json', 'a/b']) {
      expect(
        getAlternativesInputSchema.safeParse({ slug, response_format: 'json' }).success,
        `slug=${slug}`,
      ).toBe(false);
    }
  });

  it('accepts a canonical kebab-case slug', () => {
    expect(
      getAlternativesInputSchema.safeParse({
        slug: 'figma-alternatives-2',
        response_format: 'json',
      }).success,
    ).toBe(true);
  });
});
