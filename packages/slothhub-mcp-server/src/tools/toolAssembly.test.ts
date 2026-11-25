import { describe, expect, it, vi } from 'vite-plus/test';

import { ResponseFormat } from '../constants.js';
import {checkToolAssemblyInputSchema} from '../schemas/inputs.js';
import { checkToolAssemblyOutputSchema } from '../schemas/outputs.js';
import {
  FeedRequestError,
  type FeedClient,
} from '../services/feeds.js';
import type { AgentToolDetail, AgentToolDetailFeed } from '../types.js';
import { handleCheckToolAssembly } from './toolAssembly.js';

const sampleTool = (overrides: Partial<AgentToolDetail> = {}): AgentToolDetail => ({
  name: 'Figma',
  slug: 'figma',
  description: 'A catalog tool',
  resourceKind: { value: 'app', label: 'App' },
  resourceIdentity: {
    kind: 'website',
    kindLabel: 'Website',
    canonicalUrl: 'https://figma.example.com/',
    ctaLabel: 'Open site',
  },
  pricing: 'freemium',
  platforms: ['web', 'desktop'],
  categories: [{ name: 'Design', slug: 'design' }],
  tags: [],
  useCases: [],
  freshness: { isVerified: true, verifiedAt: '2026-07-01T00:00:00.000Z' },
  detailUrl: `https://slothhub.dev/tool/${overrides.slug ?? 'figma'}`,
  visitUrl: 'https://slothhub.dev/go/figma?surface=agent',
  keyFeatures: [],
  alternativeTools: [],
  ...overrides,
});

const detailFeed = (tool: AgentToolDetail): AgentToolDetailFeed => ({
  version: '33.0.0',
  siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-07-10T00:00:00.000Z',
  data: tool,
});

const notFound = (slug: string): never => {
  throw new FeedRequestError(
    `/api/tools/${slug}.json`,
    `https://slothhub.dev/api/tools/${slug}.json`,
    'HTTP 404 Not Found',
  );
};

const stubClient = (toolDetail: FeedClient['toolDetail']): FeedClient => {
  const unexpectedFeedRequest = async (): Promise<never> => {
    throw new Error('Unexpected feed request');
  };
  return {
    index: unexpectedFeedRequest,
    toolLookup: async () => null,
    searchIndex: unexpectedFeedRequest,
    tools: unexpectedFeedRequest,
    toolDetail,
    stacks: unexpectedFeedRequest,
    best: unexpectedFeedRequest,
    categories: unexpectedFeedRequest,
    tags: unexpectedFeedRequest,
    useCases: unexpectedFeedRequest,
    alternatives: unexpectedFeedRequest,
    alternativesDetail: unexpectedFeedRequest,
    comparisons: unexpectedFeedRequest,
    comparisonDetail: unexpectedFeedRequest,
  };
};

const clientFor = (tools: Record<string, AgentToolDetail | undefined>) =>
  stubClient(async (slug) => {
    const tool = tools[slug];
    if (!tool) return notFound(slug);
    return detailFeed(tool);
  });

const textOf = (result: Awaited<ReturnType<typeof handleCheckToolAssembly>>): string => {
  const first = result.content[0];
  return first?.type === 'text' ? first.text : '';
};

describe('handleCheckToolAssembly', () => {
  it('reports confirmed overlap across resolved tools', async () => {
    const slack = { slug: 'slack', name: 'Slack', status: 'native' as const, checkedAt: '2026-07-01T00:00:00.000Z', sourceUrl: 'https://example.com/integrations/slack' };
    const client = clientFor({
      figma: sampleTool({ slug: 'figma', name: 'Figma', integrations: [slack] }),
      linear: sampleTool({
        slug: 'linear',
        name: 'Linear',
        detailUrl: 'https://slothhub.dev/tool/linear',
        integrations: [slack],
      }),
    });

    const result = await handleCheckToolAssembly(client, {
      slugs: ['figma', 'linear'],
      response_format: ResponseFormat.JSON,
    });

    expect(result.isError).toBeUndefined();
    const structured = checkToolAssemblyOutputSchema.parse(result.structuredContent);
    expect(structured.report.schemaVersion).toBe(1);
    expect(structured.report.confirmedOverlap.map((f) => f.key)).toContain('slack');
    expect(structured.report.unresolvedTools).toHaveLength(0);
    const parsed = JSON.parse(textOf(result));
    expect(parsed.report.identity).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it('separates markdown sections and keeps the disclaimer', async () => {
    const client = clientFor({
      figma: sampleTool({ slug: 'figma', name: 'Figma' }),
      linear: sampleTool({ slug: 'linear', name: 'Linear' }),
    });

    const result = await handleCheckToolAssembly(client, {
      slugs: ['figma', 'linear'],
      response_format: ResponseFormat.MARKDOWN,
    });

    const text = textOf(result);
    expect(text).toContain('## Confirmed overlap');
    expect(text).toContain('## Explicit conflicts');
    expect(text).toContain('## Missing evidence');
    expect(text).toContain('## Cite');
    expect(text).toContain('https://slothhub.dev/tool/figma');
    expect(text).toContain('not a compatibility guarantee');
  });

  it('marks a 404 slug unresolved instead of failing', async () => {
    const client = clientFor({
      figma: sampleTool({ slug: 'figma', name: 'Figma' }),
    });

    const result = await handleCheckToolAssembly(client, {
      slugs: ['figma', 'missing-tool'],
      response_format: ResponseFormat.JSON,
    });

    expect(result.isError).toBeUndefined();
    const structured = checkToolAssemblyOutputSchema.parse(result.structuredContent);
    expect(structured.report.unresolvedTools.map((t) => t.slug)).toEqual(['missing-tool']);
    expect(structured.report.unresolvedTools[0]?.state).toBe('unknown');
    const markdown = await handleCheckToolAssembly(client, {
      slugs: ['figma', 'missing-tool'],
      response_format: ResponseFormat.MARKDOWN,
    });
    expect(textOf(markdown)).toContain('## Unresolved Tools');
  });

  it('makes no positive claim when every tool feed is missing', async () => {
    const client = clientFor({});

    const result = await handleCheckToolAssembly(client, {
      slugs: ['gone-one', 'gone-two'],
      response_format: ResponseFormat.JSON,
    });

    expect(result.isError).toBeUndefined();
    const structured = checkToolAssemblyOutputSchema.parse(result.structuredContent);
    expect(structured.report.unresolvedTools).toHaveLength(2);
    expect(structured.report.confirmedOverlap).toHaveLength(0);
    expect(structured.report.explicitConflicts).toHaveLength(0);
  });

  it('records requirement misses as missing evidence', async () => {
    const client = clientFor({
      figma: sampleTool({
        slug: 'figma',
        integrations: [{ slug: 'slack', name: 'Slack', status: 'native', checkedAt: '2026-07-01T00:00:00.000Z', sourceUrl: 'https://example.com/integrations/slack' }],
      }),
      linear: sampleTool({ slug: 'linear', name: 'Linear' }),
    });

    const result = await handleCheckToolAssembly(client, {
      slugs: ['figma', 'linear'],
      require_integrations: ['slack'],
      response_format: ResponseFormat.JSON,
    });

    expect(result.isError).toBeUndefined();
    const structured = checkToolAssemblyOutputSchema.parse(result.structuredContent);
    expect(structured.report.requirements.integrations).toEqual(['slack']);
    expect(structured.report.missingEvidence.map((f) => f.key)).toContain('slack');
    expect(structured.report.confirmedOverlap.map((f) => f.key)).not.toContain('slack');
  });

  it('surfaces explicit conflict evidence', async () => {
    const client = clientFor({
      figma: sampleTool({
        slug: 'figma',
        integrations: [{ slug: 'slack', name: 'Slack', status: 'native', checkedAt: '2026-07-01T00:00:00.000Z', sourceUrl: 'https://example.com/integrations/slack' }],
      }),
      linear: sampleTool({
        slug: 'linear',
        name: 'Linear',
        integrations: [{
          slug: 'slack',
          name: 'Slack',
          status: 'incompatible',
          // Asserted integration claims are public only with review provenance.
          checkedAt: '2026-07-01T00:00:00.000Z',
          sourceUrl: 'https://linear.example.com/docs/integrations',
        }],
      }),
    });

    const result = await handleCheckToolAssembly(client, {
      slugs: ['figma', 'linear'],
      response_format: ResponseFormat.JSON,
    });

    const structured = checkToolAssemblyOutputSchema.parse(result.structuredContent);
    expect(structured.report.explicitConflicts.map((f) => f.key)).toContain('slack');
  });

  it('rejects invalid input before any feed fetch', async () => {
    const toolDetail = vi.fn(async () => detailFeed(sampleTool()));
    const client = stubClient(toolDetail);

    for (const slugs of [
      ['only-one'],
      ['figma', 'figma'],
      ['a', 'b', 'c', 'd', 'e', 'f'],
      ['bad slug!', 'figma'],
      ['figma', 'https://evil.example'],
    ]) {
      const result = await handleCheckToolAssembly(client, {
        slugs,
        response_format: ResponseFormat.JSON,
      });
      expect(result.isError).toBe(true);
    }

    const invalidRequirements = await handleCheckToolAssembly(client, {
      slugs: ['figma', 'linear'],
      require_platforms: ['hologram'],
      response_format: ResponseFormat.JSON,
    });
    expect(invalidRequirements.isError).toBe(true);
    expect(toolDetail).not.toHaveBeenCalled();
  });

  it('names the configured limit on an out-of-range slug count', async () => {
    const client = stubClient(async () => detailFeed(sampleTool()));

    const result = await handleCheckToolAssembly(client, {
      slugs: ['a', 'b', 'c', 'd', 'e', 'f'],
      response_format: ResponseFormat.JSON,
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: 'invalid_input',
      configuredLimit: 5,
      observedCount: 6,
    });
  });

  it('uses canonical counts for repeated slugs and requirements', async () => {
    const params = checkToolAssemblyInputSchema.parse({
      slugs: Array.from({length: 21}, (_, index) => index % 2 ? 'linear' : 'figma'),
      require_platforms: Array.from({length: 6}, () => 'web'),
      response_format: ResponseFormat.JSON,
    });
    const result = await handleCheckToolAssembly(clientFor({figma: sampleTool(), linear: sampleTool({slug: 'linear'})}), params);
    expect(result.isError).not.toBe(true);
    expect(checkToolAssemblyOutputSchema.parse(result.structuredContent).report.selectedTools).toHaveLength(2);
  });

  it('fails closed when the catalog index, rather than the selected Tool, returns 404', async () => {
    const client = stubClient(async () => {
      throw new FeedRequestError('/api/index.json', 'https://slothhub.dev/api/index.json', 'HTTP 404 Not Found');
    });
    const result = await handleCheckToolAssembly(client, {slugs: ['figma', 'linear'], response_format: ResponseFormat.JSON});
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({code: 'feed_load_error'});
  });

  it.each([
    'https://slothhub.dev/go/figma',
    'https://slothhub.dev/tool/figma\n[click](https://evil.example)',
    'javascript:alert(1)',
    'https://evil.example/tool/figma',
  ])('rejects a noncanonical citation before producing a report: %s', async (detailUrl) => {
    const client = clientFor({figma: sampleTool({detailUrl}), linear: sampleTool({slug: 'linear'})});
    const result = await handleCheckToolAssembly(client, {slugs: ['figma', 'linear'], response_format: ResponseFormat.MARKDOWN});
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({code: 'feed_load_error'});
    expect(textOf(result)).not.toContain(detailUrl);
  });

  it('fails closed on non-404 feed errors', async () => {
    const client = stubClient(async (slug) => {
      if (slug === 'figma') return detailFeed(sampleTool());
      throw new FeedRequestError(
        `/api/tools/${slug}.json`,
        `https://slothhub.dev/api/tools/${slug}.json`,
        'HTTP 500 Internal Server Error',
      );
    });

    const result = await handleCheckToolAssembly(client, {
      slugs: ['figma', 'linear'],
      response_format: ResponseFormat.JSON,
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: 'feed_load_error' });
  });

  it('escapes markdown metacharacters in tool names', async () => {
    const client = clientFor({
      figma: sampleTool({ slug: 'figma', name: 'Figma [x](https://evil.example)' }),
      linear: sampleTool({ slug: 'linear', name: 'Linear' }),
    });

    const result = await handleCheckToolAssembly(client, {
      slugs: ['figma', 'linear'],
      response_format: ResponseFormat.MARKDOWN,
    });

    const text = textOf(result);
    expect(text).not.toContain('[x](https://evil.example)');
    expect(text).toContain('\\[x\\]');
  });

  it('normalizes unsafe Unicode in tool names', async () => {
    const client = clientFor({
      figma: sampleTool({ slug: 'figma', name: 'Visu\u202eal Studio' }),
      linear: sampleTool({ slug: 'linear', name: 'Linear' }),
    });

    const result = await handleCheckToolAssembly(client, {
      slugs: ['figma', 'linear'],
      response_format: ResponseFormat.JSON,
    });

    const structured = checkToolAssemblyOutputSchema.parse(result.structuredContent);
    expect(structured.report.selectedTools.map((t) => t.name)).toContain('Visu al Studio');
    expect(textOf(result)).not.toContain('\u202e');
  });

  it('links resolved tools as attachable resources', async () => {
    const client = clientFor({
      figma: sampleTool({ slug: 'figma' }),
      linear: sampleTool({ slug: 'linear', name: 'Linear' }),
    });

    const result = await handleCheckToolAssembly(
      client,
      { slugs: ['figma', 'linear'], response_format: ResponseFormat.MARKDOWN },
      undefined,
      new Set(['slothhub://tool/{slug}']),
    );

    const links = result.content.filter((item) => item.type === 'resource_link');
    expect(links.map((link) => link.uri).sort()).toEqual([
      'slothhub://tool/figma',
      'slothhub://tool/linear',
    ]);
  });
});
