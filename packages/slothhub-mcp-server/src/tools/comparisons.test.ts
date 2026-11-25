import { describe, expect, it } from 'vite-plus/test';

import type {
  AgentComparisonDetailFeed,
  AgentComparisonFacts,
  AgentComparisonsFeed,
  AgentToolSummary,
} from '../types.js';
import { ResponseFormat } from '../constants.js';
import {
  FeedCapabilityUnavailableError,
  FeedRequestError,
  type FeedClient,
} from '../services/feeds.js';
import { getComparisonInputSchema } from '../schemas/inputs.js';
import {
  handleGetComparison,
  handleListComparisons,
} from './handlers.js';

const pairTool = (overrides: Partial<AgentToolSummary> = {}): AgentToolSummary => ({
  name: 'Pair Tool',
  slug: 'pair-tool',
  description: 'A catalog tool in a comparison pair',
  resourceKind: { value: 'app', label: 'App' },
  resourceIdentity: {
    kind: 'website',
    kindLabel: 'Website',
    canonicalUrl: 'https://pair.example.com/',
    ctaLabel: 'Open site',
  },
  pricing: 'free',
  platforms: ['web'],
  categories: [{ name: 'Design', slug: 'design' }],
  tags: [],
  useCases: [],
  freshness: { isVerified: true, verifiedAt: '2026-07-01T00:00:00.000Z' },
  detailUrl: 'https://slothhub.dev/tool/pair-tool',
  visitUrl: 'https://slothhub.dev/go/pair-tool?surface=agent',
  ...overrides,
});

const comparisonPair = (
  overrides: Partial<AgentComparisonsFeed['data']['comparisons'][number]> = {},
): AgentComparisonsFeed['data']['comparisons'][number] => ({
  slug: 'figma-vs-sketch',
  title: 'Figma vs Sketch',
  pageUrl: 'https://slothhub.dev/compare/figma-vs-sketch',
  jsonUrl: 'https://slothhub.dev/api/compare/figma-vs-sketch.json',
  markdownUrl: 'https://slothhub.dev/compare/figma-vs-sketch.md',
  primary: pairTool({ name: 'Figma', slug: 'figma' }),
  secondary: pairTool({ name: 'Sketch', slug: 'sketch' }),
  ...overrides,
});

const comparisonsFeed = (
  comparisons: AgentComparisonsFeed['data']['comparisons'] = [comparisonPair()],
): AgentComparisonsFeed => ({
  version: '33.0.0',
  siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-07-08T00:00:00.000Z',
  data: {
    comparisonsUrl: 'https://slothhub.dev/compare',
    comparisons,
  },
});

const detailFeed = (
  overrides: Partial<AgentComparisonDetailFeed['data']> = {},
): AgentComparisonDetailFeed => ({
  version: '33.0.0',
  siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-07-08T00:00:00.000Z',
  data: { ...comparisonPair(), ...overrides },
});

const asClient = (partial: Partial<FeedClient>): FeedClient =>
  // SAFETY: each test stubs only the FeedClient methods its handler under test
  // invokes; the assertion trades interface completeness for test isolation.
  partial as FeedClient;

const listClient = (feed: AgentComparisonsFeed = comparisonsFeed()) =>
  asClient({ comparisons: async () => feed });
const detailClient = (feed: AgentComparisonDetailFeed = detailFeed()) =>
  asClient({ comparisonDetail: async () => feed });

const listParams = {
  limit: 20,
  offset: 0,
  response_format: ResponseFormat.MARKDOWN,
};
const getParams = {
  slug: 'figma-vs-sketch',
  response_format: ResponseFormat.MARKDOWN,
};

describe('handleListComparisons', () => {
  it('lists pair summaries with stable pagination metadata', async () => {
    const result = await handleListComparisons(listClient(), listParams);
    expect(result.content).toContainEqual({type: 'resource_link', uri: 'slothhub://compare/figma-vs-sketch', name: 'Figma vs Sketch', mimeType: 'application/json'});
    const disallowed = await handleListComparisons(listClient(), listParams, undefined, new Set());
    expect(disallowed.content.filter((item) => item.type === 'resource_link')).toEqual([]);

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      query: '',
      total: 1,
      count: 1,
      offset: 0,
      has_more: false,
    });
    // SAFETY: handleListComparisons stamps this envelope shape; the assertion
    // narrows structuredContent to the summary fields this test reads.
    const comparisons = (
      result.structuredContent as {
        comparisons: Array<{
          slug: string;
          title: string;
          pageUrl: string;
          primary: { name: string; slug: string };
          secondary: { name: string; slug: string };
        }>;
      }
    ).comparisons;
    expect(comparisons[0]).toMatchObject({
      slug: 'figma-vs-sketch',
      title: 'Figma vs Sketch',
      pageUrl: 'https://slothhub.dev/compare/figma-vs-sketch',
      primary: { name: 'Figma', slug: 'figma' },
      secondary: { name: 'Sketch', slug: 'sketch' },
    });
    // List returns summaries — no nested Tool summaries or facts.
    expect(comparisons[0]?.primary).not.toHaveProperty('detailUrl');
    expect(comparisons[0]).not.toHaveProperty('verdict');
  });

  it('returns a valid empty result for an empty feed', async () => {
    const result = await handleListComparisons(
      listClient(comparisonsFeed([])),
      listParams,
    );

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      total: 0,
      count: 0,
      has_more: false,
      comparisons: [],
    });
  });

  it('filters pairs by query against title and slug', async () => {
    const comparisons = [
      comparisonPair(),
      comparisonPair({
        slug: 'notion-vs-obsidian',
        title: 'Notion vs Obsidian',
        primary: pairTool({ name: 'Notion', slug: 'notion' }),
        secondary: pairTool({ name: 'Obsidian', slug: 'obsidian' }),
      }),
    ];
    const result = await handleListComparisons(
      listClient(comparisonsFeed(comparisons)),
      { ...listParams, query: 'obsidian' },
    );

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      query: 'obsidian',
      total: 1,
      count: 1,
    });
  });

  it('surfaces capability_unavailable when the catalog lacks the feed', async () => {
    const client = {
      comparisons: async () => {
        throw new FeedCapabilityUnavailableError('comparisons feed', {
          reason: 'this catalog does not advertise /api/compare.json',
          recovery: 'Upgrade the catalog.',
        });
      },
    };
    const result = await handleListComparisons(asClient(client), listParams);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: 'capability_unavailable',
    });
  });

  it('escapes catalog-controlled titles in markdown', async () => {
    const hostile = comparisonsFeed([
      comparisonPair({ title: 'Evil <script>alert(1)</script> **bold**' }),
    ]);
    const result = await handleListComparisons(listClient(hostile), listParams);

    expect(result.isError).toBeFalsy();
    const markdown = result.content[0]?.text ?? '';
    expect(markdown).toContain('\\<script\\>');
    expect(markdown).not.toContain('**bold**');
  });
});

describe('handleGetComparison', () => {
  it('renders the pair with feature rows, facts, and verdict', async () => {
    const feed = detailFeed({
      description: 'Two design tools compared.',
      featureRows: [
        { label: 'Collaboration', primary: 'Real-time', secondary: 'Plugins' },
      ],
      primaryComparisonFacts: { strengths: ['Browser-first'], limitations: ['Offline gaps'] },
      secondaryComparisonFacts: { pricingNotes: 'One-time license' },
      verdict: 'Pick Figma for teams.',
      reviewedAt: '2026-08-01T00:00:00.000Z',
      sourceReferences: [{ title: 'Figma docs', url: 'https://help.figma.com' }],
    });
    const result = await handleGetComparison(detailClient(feed), getParams);

    expect(result.isError).toBeFalsy();
    const markdown = result.content[0]?.text ?? '';
    expect(markdown).toContain('# Figma vs Sketch');
    expect(markdown).toContain('Collaboration: Real-time | Plugins');
    expect(markdown).toContain('Strengths: Browser-first');
    expect(markdown).toContain('Pricing: One-time license');
    expect(markdown).toContain('Pick Figma for teams.');
    expect(markdown).toContain('Cite: https://slothhub.dev/compare/figma-vs-sketch');
    expect(markdown).toContain('Source: Figma docs — https://help.figma.com');
    expect(markdown).not.toContain('/go/');

    expect(result.structuredContent).toMatchObject({
      comparison: {
        slug: 'figma-vs-sketch',
        primary: { slug: 'figma' },
        secondary: { slug: 'sketch' },
        primaryComparisonFacts: { strengths: ['Browser-first'] },
        verdict: 'Pick Figma for teams.',
      },
    });
  });

  it('keeps omitted comparison facts absent instead of synthesizing empties', async () => {
    const result = await handleGetComparison(detailClient(), getParams);

    expect(result.isError).toBeFalsy();
    const markdown = result.content[0]?.text ?? '';
    expect(markdown).not.toContain('Strengths:');
    expect(markdown).not.toContain('Limitations:');
    // SAFETY: handleGetComparison wraps the feed pair under comparison; the
    // assertion narrows to the optional fact keys this test asserts absent.
    const structured = result.structuredContent as {
      comparison: { primaryComparisonFacts?: AgentComparisonFacts; secondaryComparisonFacts?: AgentComparisonFacts };
    };
    expect('primaryComparisonFacts' in structured.comparison).toBe(false);
    expect('secondaryComparisonFacts' in structured.comparison).toBe(false);
  });

  it('returns not_found for a missing slug (HTTP 404)', async () => {
    const client = {
      comparisonDetail: async () => {
        throw new FeedRequestError(
          '/api/compare/missing.json',
          'https://slothhub.dev/api/compare/missing.json',
          'HTTP 404 Not Found',
        );
      },
    };
    const result = await handleGetComparison(
      asClient(client),
      { slug: 'missing', response_format: ResponseFormat.JSON },
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: 'not_found',
      suggestion: 'Find a comparison slug in resources/list (slothhub://compare/{slug} entries) or read slothhub://artifact/compare; compare Tools directly with slothhub_compare_tools when no published comparison matches.',
    });
  });

  it('returns not_found when the detail path is not authenticated', async () => {
    const client = {
      comparisonDetail: async () => {
        throw new FeedRequestError(
          '/api/compare/missing.json',
          'https://slothhub.dev/api/compare/missing.json',
          'Public feed index does not authenticate /api/compare/missing.json',
        );
      },
    };
    const result = await handleGetComparison(asClient(client), getParams);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: 'not_found' });
  });

  it('maps other feed failures to feed_load_error, not not_found', async () => {
    const client = {
      comparisonDetail: async () => {
        throw new FeedRequestError(
          '/api/compare/figma-vs-sketch.json',
          'https://slothhub.dev/api/compare/figma-vs-sketch.json',
          'HTTP 500 Internal Server Error',
        );
      },
    };
    const result = await handleGetComparison(asClient(client), getParams);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: 'feed_load_error' });
  });

  it('escapes catalog-controlled text in the detail markdown', async () => {
    const feed = detailFeed({
      title: 'Tool <img src=x> vs Other',
      description: 'See [click](javascript:alert(1))',
      verdict: 'Pick `code` verdict',
    });
    const result = await handleGetComparison(detailClient(feed), getParams);

    expect(result.isError).toBeFalsy();
    const markdown = result.content[0]?.text ?? '';
    expect(markdown).toContain('\\<img');
    expect(markdown).toContain('\\[click\\]');
    expect(markdown).toContain('\\`code\\`');
  });
});

describe('getComparisonInputSchema', () => {
  it('rejects malformed slugs before any fetch', () => {
    for (const slug of ['', 'UPPER', '../etc', 'has space', 'slug.json', 'a/b']) {
      expect(
        getComparisonInputSchema.safeParse({ slug, response_format: 'json' }).success,
        `slug=${slug}`,
      ).toBe(false);
    }
  });

  it('accepts a canonical kebab-case pair slug', () => {
    expect(
      getComparisonInputSchema.safeParse({
        slug: 'figma-vs-sketch-2',
        response_format: 'json',
      }).success,
    ).toBe(true);
  });
});
