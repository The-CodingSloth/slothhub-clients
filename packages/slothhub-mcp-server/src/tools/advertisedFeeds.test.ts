import {describe, expect, it} from 'vite-plus/test';

import {ResponseFormat} from '../constants.js';
import type {AgentIndexFeed} from '../types.js';
import {buildDoctorResult} from './advertisedFeeds.js';

const index = {
  version: '33.0.0',
  siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-08-29T00:00:00.000Z',
  schemaUrl: 'https://slothhub.dev/schema.json',
  citationGuidance: ['Cite Tool pages.'],
  snapshots: {
    full: 'https://slothhub.dev/api/catalog.snapshot.json',
    ndjson: 'https://slothhub.dev/api/catalog.ndjson',
    futureSnapshot: 'https://slothhub.dev/api/future.snapshot.json',
  },
  feeds: {
    tools: 'https://slothhub.dev/api/tools.json',
    searchIndex: 'https://slothhub.dev/api/search-index.json',
    categories: 'https://slothhub.dev/api/categories.json',
    tags: 'https://slothhub.dev/api/tags.json',
    useCases: 'https://slothhub.dev/api/use-cases.json',
    stacks: 'https://slothhub.dev/api/stacks.json',
    best: 'https://slothhub.dev/api/best.json',
    alternatives: 'https://slothhub.dev/api/alternatives.json',
    announcements: 'https://slothhub.dev/api/announcements.json',
    futureFeed: 'https://slothhub.dev/api/future.json',
  },
  markdownArtifacts: {},
  integrationHubUrl: 'https://slothhub.dev/agents',
  markdownHubUrl: 'https://slothhub.dev/agents.md',
  toolDetailUrlTemplate: 'https://slothhub.dev/api/tools/{slug}.json',
} satisfies AgentIndexFeed;

describe('MCP doctor projection', () => {
  it('renders every advertised feed and snapshot in markdown', () => {
    const result = buildDoctorResult(index, 'https://slothhub.dev/', ResponseFormat.MARKDOWN);
    expect(result.content[0]?.text).toContain('- futureFeed: https://slothhub.dev/api/future.json');
    expect(result.content[0]?.text).toContain('- futureSnapshot: https://slothhub.dev/api/future.snapshot.json');
    expect(result.content[0]?.text).not.toContain('/go/');
  });

  it('preserves later keys in JSON content and structured content', () => {
    const result = buildDoctorResult(index, 'https://slothhub.dev', ResponseFormat.JSON);
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({
      feeds: {futureFeed: 'https://slothhub.dev/api/future.json'},
      snapshots: {futureSnapshot: 'https://slothhub.dev/api/future.snapshot.json'},
    });
    expect(result.structuredContent).toMatchObject({
      feeds: {futureFeed: 'https://slothhub.dev/api/future.json'},
      snapshots: {futureSnapshot: 'https://slothhub.dev/api/future.snapshot.json'},
    });
  });

  it('neutralizes terminal control characters in human-readable fields', () => {
    const hostile = {
      ...index,
      siteUrl: 'https://slothhub.dev\nforged',
      feeds: {
        ...index.feeds,
        ['future\u009b31mfeed']: 'https://slothhub.dev/api/future.json\u2028forged',
      },
    };
    const result = buildDoctorResult(
      hostile,
      'https://slothhub.dev\u001b]52;c;payload\u0007',
      ResponseFormat.MARKDOWN,
    );
    expect(result.content[0]?.text).not.toMatch(
      /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u,
    );
    expect(result.content[0]?.text).toContain('future 31mfeed');
  });

  it('escapes terminal controls in JSON text while preserving structured values', () => {
    const hostile = {
      ...index,
      feeds: {
        ...index.feeds,
        ['future\u009b31mfeed']: 'https://slothhub.dev/api/future.json\u202eforged',
      },
    };
    const result = buildDoctorResult(hostile, 'https://slothhub.dev', ResponseFormat.JSON);

    expect(result.content[0]?.text).not.toMatch(
      /[\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/u,
    );
    expect(JSON.parse(result.content[0]!.text)).toEqual(result.structuredContent);
    expect(result.structuredContent).toMatchObject({
      feeds: {['future\u009b31mfeed']: 'https://slothhub.dev/api/future.json\u202eforged'},
    });
  });

  it.each([
    'https://slothhub.dev/go/figma?surface=agent',
    'https://slothhub.dev/%67o/figma?surface=agent',
  ])('rejects tracked advertised URL %s before rendering', (url) => {
    expect(() => buildDoctorResult({
      ...index,
      feeds: {...index.feeds, futureFeed: url},
    }, 'https://slothhub.dev', ResponseFormat.JSON)).toThrowError(
      expect.objectContaining({code: 'invalid_advertised_catalog_url'}),
    );
  });
});
