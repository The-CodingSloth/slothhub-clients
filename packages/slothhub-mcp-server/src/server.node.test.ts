import {handleWorkflow} from './tools/agentWorkflows.js';
import {recommendationInput, recommendationOutput, comparisonInput} from './schemas/agentWorkflows.js';
import {normalizePublicAgentInterfaces, type PublicAgentInterfaceAutomation} from '@slothhub/domain/agent-interface';
import {buildProjectToolPinManifest, serializeProjectToolPinManifest} from '@slothhub/domain/project-tool-pin-manifest';
import {serializeDecisionReceiptJson, type DecisionReceipt} from '@slothhub/domain/decision-receipt';
import {TOOL_LOOKUP_NAMESPACE_VALUES, ToolLookupArtifactLimitError} from '@slothhub/domain/tool-lookup';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import {ProtocolError, ResourceNotFoundError} from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vite-plus/test';
import * as publicToolLookup from './tools/publicToolLookup.js';
import {connectorFetchOutputSchema} from './tools/connectorRetrieval.js';

const readProtocolErrorCode = (error: ProtocolError): string | undefined => {
  const data = error.data;
  if (!data || typeof data !== 'object' || Array.isArray(data) || !('code' in data)) {
    return undefined;
  }
  return typeof data.code === 'string' ? data.code : undefined;
};

import { ResponseFormat, SERVER_INSTRUCTIONS, SERVER_VERSION } from './constants.js';
import {SLOTHHUB_TOOL_NAMES} from '@slothhub/domain/sloth-hub-tool-names';
import {
  authenticatedIndex,
  createMockFetch,
  indexFeed,
  readyCursorRecipe,
  sampleTool,
  searchFeed,
  stacksFeed,
  toolDetail,
  toolDetailFeed,
  toolsFeed,
  toolSummary,
} from './test/serverFeedFixtures.js';
import { createSlothHubMcpServer } from './index.js';
import {parseFeed} from './schemas/feedParser.js';
import {

  publicAgentInterfaceSchema,
  publicToolIntegrationSchema,
  searchIndexFeedSchema,
  toolDetailFeedSchema,
  toolsFeedSchema,
} from '@slothhub/domain/public-feed-mcp-schemas';
import {
  agentInterfaceKindFilterSchema,
  pricingFilterSchema,
  getToolInputSchema,
  listTagsInputSchema,
  listUseCasesInputSchema,
  platformFilterSchema,
  resourceKindFilterSchema,
  securityCapabilityFilterSchema,
  searchToolsInputSchema,
} from './schemas/inputs.js';
import {
  doctorOutputSchema,
  getBestListOutputSchema,
  getStackOutputSchema,
  getToolOutputSchema,
  getVisitUrlOutputSchema,
  listBestOutputSchema,
  listCategoriesOutputSchema,
  listMcpServersOutputSchema,
  listStacksOutputSchema,
  listTagsOutputSchema,
  listUseCasesOutputSchema,
  searchToolsOutputSchema,
} from './schemas/outputs.js';
import {
  createFeedClient,
  type FeedClient,
  type FeedResponsePayload,
  type FetchJson,
  type FetchText,
} from './services/feeds.js';
import { computeContentHash } from '@slothhub/domain/public-feed-content-identity';
import { matchesQueryText, paginateResults } from './services/search.js';
import { formatToolResult, toolError, truncateText } from './tools/format.js';
import {
  handleDoctor,
  handleGetBestList,
  handleGetStack,
  handleGetTool,
  handleGetVisitUrl,
  handleListBest,
  handleListCategories,
  handleListMcpServers,
  handleListStacks,
  handleListTags,
  handleListUseCases,
  handleSearchTools,
} from './tools/handlers.js';
import type {
  AgentSearchIndexFeed,
  AgentSearchIndexTool,
  AgentToolDetailFeed,
  AgentToolStackFeed,
} from './types.js';

type LegacySearchIndexTool = Omit<AgentSearchIndexTool, 'agentInterfaceKinds' | 'search'> & {
  agentInterfaceKinds?: AgentSearchIndexTool['agentInterfaceKinds'];
  search: Omit<AgentSearchIndexTool['search'], 'fields'> & {
    fields: Omit<NonNullable<AgentSearchIndexTool['search']['fields']>, 'agentInterfaceKinds'> & {
      agentInterfaceKinds?: NonNullable<AgentSearchIndexTool['search']['fields']>['agentInterfaceKinds'];
    };
  };
};

type LegacySearchIndexFeed = Omit<AgentSearchIndexFeed, 'data'> & {
  data: Omit<AgentSearchIndexFeed['data'], 'tools' | 'filters'> & {
    tools: LegacySearchIndexTool[];
    filters: Omit<AgentSearchIndexFeed['data']['filters'], 'agentInterfaceKinds'> & {
      agentInterfaceKinds?: AgentSearchIndexFeed['data']['filters']['agentInterfaceKinds'];
    };
  };
};


describe('input enums', () => {
  it('rejects invalid pricing with allowed values', () => {
    const result = pricingFilterSchema.safeParse('gratis');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('Allowed values');
      expect(result.error.issues[0]?.message).toContain('freemium');
    }
  });

  it('rejects invalid platform and resource_kind', () => {
    expect(platformFilterSchema.safeParse('browser').success).toBe(false);
    expect(resourceKindFilterSchema.safeParse('saas').success).toBe(false);
    expect(resourceKindFilterSchema.safeParse('mcp_server').success).toBe(true);
  });

  it('accepts valid search filters', () => {
    const parsed = searchToolsInputSchema.parse({
      pricing: 'free',
      platform: 'web',
      resource_kind: 'cli_tool',
      security_capability: 'sso_saml',
      agent_interface_kind: 'mcp_server',
      destination_health: 'healthy',
      verified: true,
      last_checked_after: '2026-07-14',
      response_format: ResponseFormat.JSON,
    });
    expect(parsed.pricing).toBe('free');
    expect(parsed.security_capability).toBe('sso_saml');
    expect(parsed.limit).toBe(20);
    expect(parsed.agent_interface_kind).toBe('mcp_server');
    expect(parsed.last_checked_after).toBe('2026-07-14');
  });

  it('defers invalid search freshness filters to the shared typed handler', () => {
    expect(searchToolsInputSchema.safeParse({destination_health: 'unknown'}).success).toBe(true);
    expect(searchToolsInputSchema.safeParse({verified: false}).success).toBe(true);
    expect(searchToolsInputSchema.safeParse({last_checked_after: '2026-02-30'}).success).toBe(true);
  });

  it('rejects unknown Agent Interface kinds', () => {
    expect(agentInterfaceKindFilterSchema.safeParse('mcp_server').success).toBe(true);
    expect(agentInterfaceKindFilterSchema.safeParse('future_kind').success).toBe(false);
  });

  it('validates compact public Integration facts and strips unknown private fields', () => {
    expect(
      publicToolIntegrationSchema.safeParse({
        slug: 'github',
        name: 'GitHub',
        status: 'native',
        checkedAt: '2026-07-20T00:00:00.000Z',
        sourceUrl: 'https://docs.example.com/github',
      }).success,
    ).toBe(true);
    const forwardCompatible = publicToolIntegrationSchema.safeParse({
        slug: 'github',
        name: 'GitHub',
        status: 'native',
        internalNotes: 'private',
      });
    expect(forwardCompatible.success).toBe(true);
    expect(forwardCompatible.success && forwardCompatible.data).not.toHaveProperty('internalNotes');
    expect(
      publicToolIntegrationSchema.safeParse({
        slug: 'github',
        name: 'GitHub',
        status: 'unsupported-by-prose',
      }).success,
    ).toBe(false);
  });

  it('rejects unknown security capability values', () => {
    expect(securityCapabilityFilterSchema.safeParse('future_capability').success).toBe(false);
  });

  it('rejects unknown and malformed list_tags params at the schema boundary', () => {
    expect(listTagsInputSchema.safeParse({ extra: true }).success).toBe(false);
    expect(listTagsInputSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(listTagsInputSchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(listTagsInputSchema.safeParse({ offset: -1 }).success).toBe(false);
    expect(listTagsInputSchema.safeParse({ query: 'x'.repeat(201) }).success).toBe(false);
    expect(listTagsInputSchema.safeParse({ response_format: 'xml' }).success).toBe(false);

    const parsed = listTagsInputSchema.parse({});
    expect(parsed.limit).toBe(20);
    expect(parsed.offset).toBe(0);
    expect(parsed.response_format).toBe(ResponseFormat.MARKDOWN);
  });

  it('rejects unknown and malformed list_use_cases params at the schema boundary', () => {
    expect(listUseCasesInputSchema.safeParse({ extra: true }).success).toBe(false);
    expect(listUseCasesInputSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(listUseCasesInputSchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(listUseCasesInputSchema.safeParse({ offset: -1 }).success).toBe(false);
    expect(listUseCasesInputSchema.safeParse({ query: 'x'.repeat(201) }).success).toBe(false);
    expect(listUseCasesInputSchema.safeParse({ response_format: 'xml' }).success).toBe(false);

    const parsed = listUseCasesInputSchema.parse({});
    expect(parsed.limit).toBe(20);
    expect(parsed.offset).toBe(0);
    expect(parsed.response_format).toBe(ResponseFormat.MARKDOWN);
  });
});

describe('paginateResults', () => {
  it('paginates results', () => {
    const page = paginateResults([1, 2, 3, 4, 5], 2, 2);
    expect(page).toEqual({
      items: [3, 4],
      total: 5,
      count: 2,
      offset: 2,
      has_more: true,
      next_offset: 4,
    });
  });
});

describe('format helpers', () => {
  it('truncates oversized text', () => {
    const text = 'x'.repeat(30_000);
    const truncated = truncateText(text);
    expect(truncated.length).toBeLessThan(text.length);
    expect(truncated).toContain('[Truncated.');
  });

  it('returns structuredContent for markdown and json', () => {
    const structured = { ok: true };
    const markdown = formatToolResult(ResponseFormat.MARKDOWN, '# Hi', structured);
    expect(markdown.content[0]?.text).toBe('# Hi');
    expect(markdown.structuredContent).toEqual(structured);

    const json = formatToolResult(ResponseFormat.JSON, '# Hi', structured);
    expect(json.content[0]?.text).toContain('"ok": true');
    expect(json.structuredContent).toEqual(structured);
  });

  it('keeps oversized json responses parseable', () => {
    const structured = {
      items: Array.from({ length: 2_000 }, (_, i) => ({
        id: i,
        name: `item-${i}`,
      })),
    };
    const json = formatToolResult(ResponseFormat.JSON, '# unused', structured);
    const text = json.content[0]?.text ?? '';
    expect(text.length).toBeGreaterThan(25_000);
    expect(JSON.parse(text)).toEqual(structured);
    expect(json.structuredContent).toEqual(structured);
  });

  it('still truncates oversized markdown responses', () => {
    const markdown = `# ${'x'.repeat(30_000)}`;
    const result = formatToolResult(ResponseFormat.MARKDOWN, markdown, {
      ok: true,
    });
    expect(result.content[0]?.text).toContain('[Truncated.');
    expect((result.content[0]?.text ?? '').length).toBeLessThan(markdown.length);
  });

  it('returns structured error payloads from toolError', () => {
    const result = toolError('Tool not found: missing.', {
      code: 'not_found',
      suggestion: 'Use search to find a valid slug.',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('search');
    expect(result.structuredContent).toEqual({
      code: 'not_found',
      message: 'Tool not found: missing.',
      suggestion: 'Use search to find a valid slug.',
    });
  });

  it('returns parseable JSON text for toolError when response_format is json', () => {
    const result = toolError('Tool not found: missing.', {
      code: 'not_found',
      suggestion: 'Use search to find a valid slug.',
      responseFormat: ResponseFormat.JSON,
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual({
      code: 'not_found',
      message: 'Tool not found: missing.',
      suggestion: 'Use search to find a valid slug.',
    });
  });
});

describe('constants', () => {
  it('derives SERVER_VERSION from package.json', () => {
    const packageJsonPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    // SAFETY: This test owns the fixture and supplies every member read through the asserted contract.
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      version: string;
    };
    expect(SERVER_VERSION).toBe(packageJson.version);
  });

  it('keeps MCP Registry metadata aligned with package ownership metadata', () => {
    const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
    // SAFETY: This test owns the fixture and supplies every member read through the asserted contract.
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      name: string;
      version: string;
      mcpName?: string;
      repository?: { url?: string; type?: string };
    };
    // SAFETY: This test owns the fixture and supplies every member read through the asserted contract.
    const serverJson = JSON.parse(readFileSync(join(packageRoot, 'server.json'), 'utf8')) as {
      $schema?: string;
      name?: string;
      repository?: { url?: string; source?: string };
      version?: string;
      packages?: Array<{
        registryType?: string;
        identifier?: string;
        version?: string;
        transport?: { type?: string };
        environmentVariables?: Array<{
          name?: string;
          description?: string;
          isRequired?: boolean;
          format?: string;
          isSecret?: boolean;
        }>;
      }>;
    };

    expect(packageJson.mcpName).toBe('io.github.The-CodingSloth/slothhub-mcp-server');
    expect(serverJson.$schema).toBe('https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json');
    expect(serverJson.name).toBe(packageJson.mcpName);
    expect(serverJson.version).toBe(packageJson.version);
    expect(serverJson.repository?.source).toBe('github');
    // The MCP Registry and npm provenance both name the source repository;
    // they must agree, and the repository must belong to the owner account.
    expect(serverJson.repository?.url).toMatch(/^https:\/\/github\.com\/The-CodingSloth\/[\w.-]+$/u);
    expect(packageJson.repository?.url).toBe(`${serverJson.repository?.url}.git`);

    expect(serverJson.packages).toEqual([
      {
        registryType: 'npm',
        identifier: packageJson.name,
        version: packageJson.version,
        transport: { type: 'stdio' },
        environmentVariables: [
          {
            name: 'SLOTHHUB_BASE_URL',
            description: 'Optional SlothHub site origin for local, preview, or production feed reads.',
            isRequired: false,
            format: 'string',
            isSecret: false,
          },
        ],
      },
    ]);
  });

  it('matches all tokens across fields and treats empty query as match-all', () => {
    expect(matchesQueryText(undefined, ['Design Stack'])).toBe(true);
    expect(matchesQueryText('design', ['Design Stack', 'workflow'])).toBe(true);
    expect(matchesQueryText('design mcp', ['Design Stack'])).toBe(false);
  });
});

describe('feed client and handlers', () => {

  it('uses three candidates by default and retains explicitly requested limits', async () => {
    const fetchJson = createMockFetch();
    const tools = Array.from({length: 4}, (_, index) => ({...sampleTool(), slug: `example-${index}`, supportedLanguages: [{id: 'python' as const, name: 'Python', supportKind: 'sdk_client' as const, sourceUrl: 'https://example.com/python'}]}));
    const client = createFeedClient({fetchJson: async (url) => url.endsWith('/api/search-index.json')
      ? {...searchFeed, data: {...searchFeed.data, tools, filters: {...searchFeed.data.filters, supportedLanguages: [{value: 'python', label: 'Python', count: 4}]}}}
      : fetchJson(url)});
    const result = await handleWorkflow(client, {kind: 'recommend', params: recommendationInput.parse({requirements: 'example', response_format: 'json'})});
    expect(result.structuredContent).toMatchObject({candidates: expect.arrayContaining([expect.objectContaining({slug: 'example-0'})])});
    expect(recommendationOutput.parse(result.structuredContent).candidates).toHaveLength(3);
    const filtered = await handleWorkflow(client, {kind: 'recommend', params: recommendationInput.parse({requirements: 'example', limit: 4, response_format: 'json'})});
    expect(filtered.isError).not.toBe(true);
    expect(recommendationOutput.parse(filtered.structuredContent).candidates).toHaveLength(4);
  });

  it('supports language filters advertised by the search feed', async () => {
    const fetchJson = createMockFetch();
    const client = createFeedClient({fetchJson: async (url) => url.endsWith('/api/search-index.json')
      ? {...searchFeed, data: {...searchFeed.data, tools: [{...sampleTool(), supportedLanguages: [{id: 'python', name: 'Python', supportKind: 'sdk_client', sourceUrl: 'https://example.com/python'}]}], filters: {...searchFeed.data.filters, supportedLanguages: [{value: 'python', label: 'Python', count: 1}]}}}
      : fetchJson(url)});
    const result = await handleWorkflow(client, {kind: 'recommend', params: recommendationInput.parse({requirements: 'example', languages: ['python'], response_format: 'json'})});
    expect(result.isError).not.toBe(true);
    expect(recommendationOutput.parse(result.structuredContent).candidates).toHaveLength(1);
  });

  it.each([['example-mcp', 'example-mcp'], ['example-mcp', 'example-server']])('rejects comparisons resolving to one Tool: %j', async (first, second) => {
    const result = await handleWorkflow(createFeedClient({fetchJson: createMockFetch()}), {kind: 'compare', params: comparisonInput.parse({slugs: [first, second], response_format: 'json'})});
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({code: 'invalid_input', observedCount: 1});
  });

  it('propagates cancellation rather than returning a feed-load failure', async () => {
    const controller = new AbortController();
    const reason = new DOMException('Test request cancelled', 'AbortError');
    const client = createFeedClient({fetchJson: createMockFetch()});
    vi.spyOn(client, 'searchIndex').mockImplementation(async () => {controller.abort(reason); throw reason;});
    await expect(handleWorkflow(client, {kind: 'recommend', params: recommendationInput.parse({requirements: 'example'})}, controller.signal)).rejects.toBe(reason);
  });

  it('starts independent comparison detail reads before waiting for their responses', async () => {
    let markFirstRead!: () => void;
    let releaseReads!: () => void;
    const firstRead = new Promise<void>((resolve) => {markFirstRead = resolve;});
    const readsReleased = new Promise<void>((resolve) => {releaseReads = resolve;});
    const started: string[] = [];
    const catalogFetch = createMockFetch();
    const fetchJson = async (url: string) => {
      if (url.endsWith('/api/tools/example-mcp.json') || url.endsWith('/api/tools/another-tool.json')) {
        started.push(url);
        markFirstRead();
        await readsReleased;
        const slug = url.endsWith('/another-tool.json') ? 'another-tool' : 'example-mcp';
        return {...toolDetailFeed, data: {...toolDetail, slug, detailUrl: `https://slothhub.dev/tool/${slug}`, visitUrl: `https://slothhub.dev/go/${slug}`}};
      }
      return catalogFetch(url);
    };
    const server = createSlothHubMcpServer({fetchJson, allowedToolNames: SLOTHHUB_TOOL_NAMES});
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({name: 'comparison-concurrency-test', version: '1.0.0'});
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const pending = client.callTool({name: 'slothhub_compare_tools', arguments: {slugs: ['example-mcp', 'another-tool'], response_format: 'json'}});
      await firstRead;
      await new Promise<void>((resolve) => setImmediate(resolve));
      const startedBeforeRelease = [...started];
      releaseReads();
      const result = await pending;
      expect(result.isError).not.toBe(true);
      expect(startedBeforeRelease).toEqual([
        'https://slothhub.dev/api/tools/example-mcp.json',
        'https://slothhub.dev/api/tools/another-tool.json',
      ]);
      expect(result.structuredContent).toMatchObject({tools: [expect.objectContaining({slug: 'example-mcp'}), expect.objectContaining({slug: 'another-tool'})]});
    } finally {
      releaseReads();
      await client.close();
      await server.close();
    }
  });

  it('serves guidance from the documented local HTTP catalog', async () => {
    const origin = 'http://localhost:4321';
    const pricingDetails: AgentToolDetailFeed['data']['pricingDetails'] = {
      currency: 'USD',
      plans: [{name: 'Pro', listPrice: 25, billing: 'per seat, billed annually', billingPeriod: 'month'}],
      usageAddOns: [{planName: 'Pro', unit: 'credit', rate: 2.5, billing: 'prepaid'}],
    };
    const licenseFacts: AgentToolDetailFeed['data']['licenseFacts'] = [{scope: 'resource', status: 'observed', spdxExpression: 'MIT', source: 'github',
      sourceUrl: 'https://example.com/LICENSE', checkedAt: '2026-11-17T12:00:00.000Z'}];
    const fetchJson = async (url: string) => {
      if (url.endsWith('/api/search-index.json')) return {...searchFeed, siteUrl: origin, data: {...searchFeed.data, tools: searchFeed.data.tools.map((tool) => ({...tool, detailUrl: `${origin}/tool/${tool.slug}`, visitUrl: `${origin}/go/${tool.slug}`}))}};
      const match = /\/api\/tools\/([^/]+)\.json$/u.exec(url);
      if (match?.[1]) return {...toolDetailFeed, siteUrl: origin, data: {...toolDetail, pricingDetails, licenseFacts, slug: match[1], detailUrl: `${origin}/tool/${match[1]}`, visitUrl: `${origin}/go/${match[1]}`}};
      throw new Error(`Unexpected local feed: ${url}`);
    };
    const client = createFeedClient({baseUrl: origin, indexFirst: false, fetchJson});
    const recommendation = await handleWorkflow(client, {kind: 'recommend', params: recommendationInput.parse({requirements: 'example', response_format: 'json'})});
    expect(recommendation.isError).not.toBe(true);
    expect(recommendation.structuredContent).toMatchObject({selected: {detailUrl: `${origin}/tool/example-mcp`}});
    const comparison = await handleWorkflow(client, {kind: 'compare', params: comparisonInput.parse({slugs: ['example-mcp', 'other-tool'], response_format: 'markdown'})});
    expect(comparison.isError).not.toBe(true);
    const comparisonText = comparison.content.map((item) => item.type === 'text' ? item.text : '').join('\n');
    expect(comparisonText).toContain('Pro — USD 25 / month');
    expect(comparisonText).toContain('USD 2.5 per credit');
    expect(comparisonText).toContain('MIT');
    const plan = await handleWorkflow(client, {kind: 'implement', params: {slug: 'example-mcp', response_format: ResponseFormat.JSON}});
    expect(plan.isError).not.toBe(true);
    const citations = await handleWorkflow(client, {kind: 'cite', params: {slug: 'example-mcp', response_format: ResponseFormat.JSON}});
    expect(citations.isError).not.toBe(true);
    expect(citations.structuredContent).toMatchObject({sources: expect.arrayContaining([expect.objectContaining({url: `${origin}/tool/example-mcp`})])});
  });

  it.each(['https://slothhub.dev', 'http://localhost:9999'])('rejects loopback citations from a different feed origin: %s', async (siteUrl) => {
    const client = createFeedClient({indexFirst: false, fetchJson: async () => ({...toolDetailFeed, siteUrl, data: {...toolDetail, detailUrl: 'http://localhost:4321/tool/example-mcp'}})});
    const result = await handleWorkflow(client, {kind: 'cite', params: {slug: 'example-mcp', response_format: ResponseFormat.JSON}});
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({code: 'feed_load_error'});
    expect(JSON.stringify(result.structuredContent)).not.toContain('http://localhost:4321/tool/example-mcp');
  });

  it.each(['recommend', 'compare', 'implement', 'cite'] as const)('rejects a forged loopback envelope from a remote transport for %s', async (kind) => {
    const origin = 'http://localhost:4321';
    const fetchJson = async (url: string) => url.endsWith('/api/search-index.json')
      ? {...searchFeed, siteUrl: origin, data: {...searchFeed.data, tools: searchFeed.data.tools.map((tool) => ({...tool, detailUrl: `${origin}/tool/${tool.slug}`}))}}
      : {...toolDetailFeed, siteUrl: origin, data: {...toolDetail, slug: url.endsWith('/other-tool.json') ? 'other-tool' : 'example-mcp', detailUrl: `${origin}/tool/${url.endsWith('/other-tool.json') ? 'other-tool' : 'example-mcp'}`}};
    const client = createFeedClient({baseUrl: 'https://preview.example.com', indexFirst: false, fetchJson});
    const request = kind === 'recommend' ? {kind, params: recommendationInput.parse({requirements: 'example', response_format: 'json'})}
      : kind === 'compare' ? {kind, params: comparisonInput.parse({slugs: ['example-mcp', 'other-tool'], response_format: 'json'})}
      : {kind, params: {slug: 'example-mcp', response_format: ResponseFormat.JSON}};
    const result = await handleWorkflow(client, request);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({code: 'feed_load_error'});
    expect(JSON.stringify(result.content)).toContain('feed_origin_mismatch');
  });

  it.each(['recommend', 'compare', 'implement'] as const)('binds %s loopback profiles to the feed origin', async (kind) => {
    const fetchJson = async (url: string) => url.endsWith('/api/search-index.json')
      ? {...searchFeed, data: {...searchFeed.data, tools: searchFeed.data.tools.map((tool) => ({...tool, detailUrl: `http://localhost:4321/tool/${tool.slug}`}))}}
      : {...toolDetailFeed, data: {...toolDetail, slug: url.endsWith('/other-tool.json') ? 'other-tool' : 'example-mcp', detailUrl: `http://localhost:4321/tool/${url.endsWith('/other-tool.json') ? 'other-tool' : 'example-mcp'}`}};
    const client = createFeedClient({indexFirst: false, fetchJson});
    const request = kind === 'recommend' ? {kind, params: recommendationInput.parse({requirements: 'example', response_format: 'json'})}
      : kind === 'compare' ? {kind, params: comparisonInput.parse({slugs: ['example-mcp', 'other-tool'], response_format: 'json'})}
      : {kind, params: {slug: 'example-mcp', response_format: ResponseFormat.JSON}};
    const result = await handleWorkflow(client, request);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({code: 'feed_load_error'});
  });

  it('preserves an invalid Tool lookup when optional stack retrieval fails', async () => {
    const client = createFeedClient({fetchJson: createMockFetch()});
    const stacks = vi.spyOn(client, 'stacks').mockRejectedValue(new Error('Stack feed unavailable'));
    const result = await handleWorkflow(client, {kind: 'implement', params: {slug: 'Invalid Tool slug!', stack: 'design-stack', response_format: ResponseFormat.JSON}});
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({code: 'invalid_input'});
    expect(stacks).toHaveBeenCalledOnce();
  });

  it.each([['missing', 'other-tool'], ['other-tool', 'missing']])('preserves known lookup failures alongside another failed comparison read: %j', async (first, second) => {
    const catalogFetch = createMockFetch();
    const client = createFeedClient({fetchJson: async (url) => {
      if (url.endsWith('/api/tools/other-tool.json')) throw new Error('Detail feed unavailable');
      return catalogFetch(url);
    }});
    const result = await handleWorkflow(client, {kind: 'compare', params: comparisonInput.parse({slugs: [first, second], response_format: 'json'})});
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({code: 'not_found'});
  });

  it('still reports a stack feed failure for an otherwise valid implementation request', async () => {
    const client = createFeedClient({fetchJson: createMockFetch()});
    vi.spyOn(client, 'stacks').mockRejectedValue(new Error('Stack feed unavailable'));
    const result = await handleWorkflow(client, {kind: 'implement', params: {slug: 'example-mcp', stack: 'design-stack', response_format: ResponseFormat.JSON}});
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({code: 'feed_load_error'});
  });

  it('supports connector search and fetch with canonical citations and complete public text', async () => {
    const server = createSlothHubMcpServer({fetchJson: createMockFetch(), allowedToolNames: SLOTHHUB_TOOL_NAMES});
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({name: 'connector-test', version: '1.0.0'});
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const tools = await client.listTools();
      for (const name of ['search', 'fetch']) {
        expect(tools.tools.find((tool) => tool.name === name)).toMatchObject({
          title: expect.any(String),
          annotations: {readOnlyHint: true, destructiveHint: false, openWorldHint: true},
          _meta: {securitySchemes: [{type: 'noauth'}]},
        });
      }
      const search = await client.callTool({name: 'search', arguments: {query: 'example'}});
      const expectedSearch = {results: [{id: 'example-mcp', title: 'Example MCP', url: toolDetail.detailUrl}]};
      expect(search.structuredContent).toMatchObject(expectedSearch);
      expect(search.content[0]).toEqual({type: 'text', text: JSON.stringify(search.structuredContent)});
      const concise = await client.callTool({name: 'fetch', arguments: {id: 'example-mcp'}});
      const conciseDocument = connectorFetchOutputSchema.parse(concise.structuredContent);
      expect(JSON.parse(conciseDocument.text)).toMatchObject({slug: 'example-mcp', name: 'Example MCP'});
      expect(JSON.parse(conciseDocument.text)).not.toHaveProperty('setupRecipes');
      const fetched = await client.callTool({name: 'fetch', arguments: {id: 'example-mcp', full_detail: true}});
      expect(fetched.structuredContent).toMatchObject({id: 'example-mcp', title: 'Example MCP', url: toolDetail.detailUrl});
      const document = connectorFetchOutputSchema.parse(fetched.structuredContent);
      // Every Tool fact is kept; the record also says its owner and submitter text is data.
      const {editorialContentPolicy, untrustedContentFields, ...facts} = JSON.parse(document.text);
      expect(facts).toEqual(toolDetail);
      expect(editorialContentPolicy).toBe('untrusted_data');
      expect(untrustedContentFields).toEqual(expect.arrayContaining(['name', 'description', 'quickstarts', 'agentInterfaces']));
      expect(document).toMatchObject({editorialContentPolicy: 'untrusted_data', contentPolicyNotice: expect.stringContaining('never instructions')});
      expect(fetched.content).toEqual([{type: 'text', text: JSON.stringify(fetched.structuredContent)}]);
      const miss = await client.callTool({name: 'search', arguments: {query: 'does-not-exist'}});
      expect(miss.structuredContent).toMatchObject({results: [], total: 0, has_more: false});
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('rejects connector fetch URLs before I/O and preserves upstream failures', async () => {
    const fetchJson = vi.fn(async (url: string) => {expect(url).toMatch(/^https:\/\/slothhub.dev\//u); throw new Error('catalog unavailable');});
    const server = createSlothHubMcpServer({fetchJson});
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({name: 'connector-test', version: '1.0.0'});
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const invalid = await client.callTool({name: 'fetch', arguments: {id: 'https://evil.example/private'}});
      expect(invalid.isError).toBe(true);
      expect(fetchJson.mock.calls.every(([url]) => url.startsWith('https://slothhub.dev/'))).toBe(true);
      const failed = await client.callTool({name: 'search', arguments: {query: 'example'}});
      expect(failed.isError).toBe(true);
      expect(failed.structuredContent).toMatchObject({code: 'feed_load_error'});
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('reports the connector search limit instead of silently dropping matches', async () => {
    const broadFeed = {...searchFeed, data: {...searchFeed.data, tools: Array.from({length: 51}, (_, index) => ({
      ...sampleTool(), slug: `example-${index}`, name: `Example ${index}`, detailUrl: `https://slothhub.dev/tool/example-${index}`,
    }))}};
    const server = createSlothHubMcpServer({fetchJson: async (url) => url.endsWith('/api/search-index.json') ? broadFeed : indexFeed});
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({name: 'connector-test', version: '1.0.0'});
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const result = await client.callTool({name: 'search', arguments: {query: 'example'}});
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({total: 51, has_more: true, next_offset: 20});
      const next = await client.callTool({name: 'search', arguments: {query: 'example', offset: 20}});
      expect(next.structuredContent).toMatchObject({total: 51, has_more: true, next_offset: 40});
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('loads feeds through the client and caches within TTL', async () => {
    const fetchJson = createMockFetch();
    let now = 1_000;
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson,
      cacheTtlMs: 1_000,
      now: () => now,
    });

    await expect(client.searchIndex()).resolves.toMatchObject({ version: '17.1.0' });
    await expect(client.tools()).resolves.toMatchObject({ version: '33.0.0' });
    expect(fetchJson).toHaveBeenCalledTimes(3);

    await client.searchIndex();
    expect(fetchJson).toHaveBeenCalledTimes(3);

    now = 3_000;
    await client.searchIndex();
    expect(fetchJson).toHaveBeenCalledTimes(5);
  });

  it('bounds MCP detail hydration concurrency', async () => {
    const tools = Array.from({ length: 12 }, (_, index) =>
      sampleTool({
        name: `MCP server ${index}`,
        slug: `mcp-server-${index}`,
        detailUrl: `https://slothhub.dev/tool/mcp-server-${index}`,
      }),
    );
    const feed: AgentSearchIndexFeed = {
      ...searchFeed,
      data: { ...searchFeed.data, tools },
    };
    let active = 0;
    let maxActive = 0;
    const toolDetail = vi.fn(async (slug: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      const index = Number(slug.slice('mcp-server-'.length));
      await new Promise((resolve) =>
        setTimeout(resolve, tools.length - index),
      );
      active -= 1;
      return {
        ...toolDetailFeed,
        data: { ...toolDetailFeed.data, slug },
      };
    });
    const unexpectedFeedRequest = async (): Promise<never> => {
      throw new Error('Unexpected feed request');
    };
    const client: FeedClient = {
      index: unexpectedFeedRequest,
      toolLookup: async () => null,
      searchIndex: vi.fn(async () => feed),
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

    const result = await handleListMcpServers(client, {
      limit: tools.length,
      offset: 0,
      response_format: ResponseFormat.JSON,
    });

    expect(result.isError).toBeUndefined();
    expect(toolDetail).toHaveBeenCalledTimes(tools.length);
    expect(maxActive).toBeLessThanOrEqual(4);
    const structured = listMcpServersOutputSchema.parse(result.structuredContent);
    expect(structured.mcp_servers.map((listing) => listing.slug)).toEqual(
      tools.map((tool) => tool.slug),
    );
  });

  it('rejects unsafe Tool detail slugs before constructing a feed URL', async () => {
    const fetchJson = vi.fn(async () => toolDetailFeed);
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson,
      indexFirst: false,
    });

    expect(() => client.toolDetail('../private')).toThrow('Invalid Tool slug');
    expect(() => client.toolDetail('UPPERCASE')).toThrow('Invalid Tool slug');
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('uses the producer UTF-8 and LF golden content hash', () => {
    expect(
      computeContentHash({ data: { a: 'lower', 'é': 'accent\r\nline', Z: 'upper' } }),
    ).toBe(
      'sha256:8479ab6dcb78acbdba3f847b1d0db1eb748f7f60de0bf60cf6df1f446c69f80c',
    );
  });

  it('refreshes the small index first and revalidates an expired unchanged leaf', async () => {
    const revision = `sha256:${'a'.repeat(64)}`;
    const searchFeedWithPublicFields = {
      ...searchFeed,
      catalogRevision: revision,
      data: {
        ...searchFeed.data,
        tools: searchFeed.data.tools.map((tool) => ({
          ...tool,
          _id: `tool-${tool.slug}`,
          visibility: 'featured' as const,
          logoUrl: `https://cdn.example.com/${tool.slug}.png`,
        })),
      },
    };
    const hash = computeContentHash(searchFeedWithPublicFields);
    const versionedIndex = authenticatedIndex(
      {'/api/search-index.json': hash},
      {catalogRevision: revision},
    );
    const versionedSearch = {
      ...searchFeedWithPublicFields,
      contentHash: hash,
    };
    const requestedUrls: string[] = [];
    const fetchJson = vi.fn(async (url: string) => {
      requestedUrls.push(url);
      return url.endsWith('/api/index.json') ? versionedIndex : versionedSearch;
    });
    let now = 1_000;
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson,
      cacheTtlMs: 1_000,
      now: () => now,
    });

    const first = await client.searchIndex();
    now = 3_000;
    const refreshed = await client.searchIndex();

    expect(first).toEqual(versionedSearch);
    expect(refreshed).toEqual(versionedSearch);

    expect(requestedUrls).toEqual([
      'https://slothhub.dev/api/index.json',
      'https://slothhub.dev/api/search-index.json',
      'https://slothhub.dev/api/index.json',
    ]);
  });

  it('verifies a legacy search feed before schema defaults are applied', async () => {
    // SAFETY: This test owns the fixture; pre-deprecation feeds always carried search.fields.
    const legacySearchFeed = structuredClone(searchFeed) as LegacySearchIndexFeed;
    delete legacySearchFeed.data.tools[0].agentInterfaceKinds;
    delete legacySearchFeed.data.tools[0].search.fields.agentInterfaceKinds;
    delete legacySearchFeed.data.filters.agentInterfaceKinds;
    const hash = computeContentHash(legacySearchFeed);
    legacySearchFeed.contentHash = hash;
    const fetchJson: FetchJson = vi.fn(async (url: string) => {
      const response = url.endsWith('/api/index.json')
        ? authenticatedIndex({'/api/search-index.json': hash})
        : legacySearchFeed;
      // SAFETY: This controlled test double implements every collaborator operation exercised by the test.
      return JSON.parse(JSON.stringify(response)) as FeedResponsePayload;
    });
    const client = createFeedClient({baseUrl: 'https://slothhub.dev', fetchJson});

    const parsed = await client.searchIndex();
    expect(parsed.data.tools[0]?.search?.fields?.agentInterfaceKinds).toEqual([]);
    expect(parsed.data.tools[0]).not.toHaveProperty('agentInterfaceKinds');
    expect(parsed.data.filters).not.toHaveProperty('agentInterfaceKinds');
  });

  it('rejects a leaf that copies the indexed hash without matching its body', async () => {
    const hash = `sha256:${'b'.repeat(64)}`;
    const fetchJson = vi.fn(async (url: string) =>
      url.endsWith('/api/index.json')
        ? authenticatedIndex({'/api/search-index.json': hash})
        : { ...searchFeed, contentHash: hash, data: { ...searchFeed.data, tools: [] } },
    );
    const client = createFeedClient({ baseUrl: 'https://slothhub.dev', fetchJson });

    await expect(client.searchIndex()).rejects.toThrow('content hash does not match');
  });

  it('rejects a leaf when an authenticated index omits its hash', async () => {
    const indexRevision = `sha256:${'c'.repeat(64)}`;
    const staleRevision = `sha256:${'d'.repeat(64)}`;
    const fetchJson = vi.fn(async (url: string) =>
      url.endsWith('/api/index.json')
        ? authenticatedIndex({}, {catalogRevision: indexRevision})
        : { ...searchFeed, catalogRevision: staleRevision },
    );
    const client = createFeedClient({ baseUrl: 'https://slothhub.dev', fetchJson });

    await expect(client.searchIndex()).rejects.toThrow('does not authenticate');
  });

  it('rejects malformed feed payloads', async () => {
    const fetchJson = vi.fn(async () => ({ version: '33.0.0' }));
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson,
      noCache: true,
    });

    await expect(client.index()).rejects.toThrow(/Invalid index feed shape/);
  });

  it('parses valid search and tools feeds', () => {
    expect(() => parseFeed(searchIndexFeedSchema, searchFeed, 'search-index')).not.toThrow();
    expect(() => parseFeed(toolsFeedSchema, toolsFeed, 'tools')).not.toThrow();
    expect(() => parseFeed(toolDetailFeedSchema, toolDetailFeed, 'Tool detail')).not.toThrow();
    for (const version of ['99.0.0', '1.01.0', '1.0.00', '1.not-semver']) {
      expect(() =>
        parseFeed(
          toolDetailFeedSchema,
          {...toolDetailFeed, version},
          'Tool detail',
        ),
      ).toThrow(/Invalid Tool detail feed/);
    }
  });

  it('accepts optional Article entries and rejects malformed ones', () => {
    const articles = [
      {
        title: 'Ship MCP servers safely',
        slug: 'ship-mcp-servers-safely',
        excerpt: 'A guide to publishing an MCP server agents can trust.',
        publishedAt: '2026-08-01T09:00:00.000Z',
        url: 'https://slothhub.dev/articles/ship-mcp-servers-safely',
      },
    ];

    const parsed = parseFeed(
      searchIndexFeedSchema,
      {
        ...searchFeed,
        version: '17.2.0',
        data: {...searchFeed.data, articles},
      },
      'search-index',
    );
    expect(parsed.data.articles).toEqual(articles);

    expect(() =>
      parseFeed(
        searchIndexFeedSchema,
        {
          ...searchFeed,
          version: '17.2.0',
          data: {...searchFeed.data, articles: [{title: 'Missing slug'}]},
        },
        'search-index',
      ),
    ).toThrow(/Invalid search-index feed/);

    expect(() =>
      parseFeed(
        searchIndexFeedSchema,
        {
          ...searchFeed,
          version: '17.2.0',
          data: {
            ...searchFeed.data,
            articles: [
              {
                title: 'Unsafe link',
                slug: 'unsafe-link',
                url: 'javascript:alert(1)',
              },
            ],
          },
        },
        'search-index',
      ),
    ).toThrow(/Invalid search-index feed/);
  });

  it('requires observed product envelopes to cite hands-on methodology', () => {
    const observedFeed = structuredClone(toolDetailFeed);
    observedFeed.data.productLimits![0]!.basis = 'observed_envelope';

    expect(() => parseFeed(toolDetailFeedSchema, observedFeed, 'Tool detail')).toThrow(
      /Observed envelopes/,
    );

    observedFeed.data.productLimits![0]!.facts[0]!.evidence[0]!.sourceType =
      'hands_on_test';
    expect(() => parseFeed(toolDetailFeedSchema, observedFeed, 'Tool detail')).not.toThrow();
  });

  it('requires a basis only for assertive product-limit groups', () => {
    const neutralFeed = structuredClone(toolDetailFeed);
    expect(() => parseFeed(toolDetailFeedSchema, neutralFeed, 'Tool detail')).not.toThrow();

    const misleadingFeed = structuredClone(neutralFeed);
    misleadingFeed.data.productLimits![1]!.basis = 'documented_limit';
    expect(() => parseFeed(toolDetailFeedSchema, misleadingFeed, 'Tool detail')).toThrow(
      /Non-assertive product-limit groups must not declare a basis/,
    );

    const missingBasisFeed = structuredClone(toolDetailFeed);
    Reflect.deleteProperty(missingBasisFeed.data.productLimits![0]!, 'basis');
    expect(() => parseFeed(toolDetailFeedSchema, missingBasisFeed, 'Tool detail')).toThrow(
      /Assertive product-limit groups require a basis/,
    );
  });

  it('requires vendor-claimed unlimited limits to cite official vendor evidence', () => {
    const claimedFeed = structuredClone(toolDetailFeed);
    const evidence = claimedFeed.data.productLimits![0]!.facts[0]!.evidence[0]!;
    claimedFeed.data.productLimits![0]!.facts = [
      {
        state: 'unlimited_claimed',
        evidence: [{...evidence, sourceType: 'hands_on_test'}],
        reviewedAt: '2026-07-22T00:00:00.000Z',
      },
    ];

    expect(() => parseFeed(toolDetailFeedSchema, claimedFeed, 'Tool detail')).toThrow(
      /official vendor evidence/,
    );

    claimedFeed.data.productLimits![0]!.facts[0]!.evidence[0]!.sourceType = 'pricing_page';
    expect(() => parseFeed(toolDetailFeedSchema, claimedFeed, 'Tool detail')).not.toThrow();
  });

  it('requires product-limit ambiguity and aggregate caps to match producer output', () => {
    const ambiguousFeed = structuredClone(toolDetailFeed);
    ambiguousFeed.data.productLimits![0]!.ambiguous = true;
    expect(() => parseFeed(toolDetailFeedSchema, ambiguousFeed, 'Tool detail')).toThrow(
      /Ambiguity/,
    );

    const oversizedFeed = structuredClone(toolDetailFeed);
    const fact = oversizedFeed.data.productLimits![0]!.facts[0]!;
    if (fact.state !== 'bounded') throw new Error('Expected bounded product-limit fixture');
    oversizedFeed.data.productLimits = [
      {
        ...oversizedFeed.data.productLimits![0]!,
        ambiguous: true,
        facts: Array.from({length: 13}, (_, index) => ({...fact, value: 60 + index})),
      },
      {
        ...oversizedFeed.data.productLimits![0]!,
        metric: 'Second metric',
        ambiguous: true,
        facts: Array.from({length: 12}, (_, index) => ({...fact, value: 73 + index})),
      },
    ];
    expect(() => parseFeed(toolDetailFeedSchema, oversizedFeed, 'Tool detail')).toThrow(
      /at most 24 total facts/,
    );
  });

  it('accepts a legacy full freshness object while stripping unsafe search fields', () => {
    const legacyFeed = {
      ...searchFeed,
      data: {
        ...searchFeed.data,
        tools: [
          {
            ...sampleTool(),
            freshness: {
              isVerified: true,
              releaseDate: '2026-01-01T00:00:00.000Z',
              verifiedAt: '2026-07-01T00:00:00.000Z',
              destinationHealth: {website: {lastError: 'private probe detail'}},
              hasDeadDestination: false,
            },
          },
        ],
      },
    };

    const parsed = parseFeed(searchIndexFeedSchema, legacyFeed, 'search-index');

    expect(parsed.data.tools[0]?.freshness).toEqual({
      verifiedAt: '2026-07-01T00:00:00.000Z',
      hasDeadDestination: false,
    });
  });

  it('searches and lists MCP servers via handlers', async () => {
    const fetchJson = createMockFetch();
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson,
    });

    const search = await handleSearchTools(client, {
      query: 'example',
      limit: 20,
      offset: 0,
      response_format: ResponseFormat.JSON,
    });
    expect(search.isError).toBeUndefined();
    const searchStructured = searchToolsOutputSchema.parse(search.structuredContent);
    expect(searchStructured.total).toBe(1);
    expect(searchStructured.results).toEqual([
      expect.objectContaining({ agentInterfaceKinds: [] }),
    ]);

    const bySecurityCapability = await handleSearchTools(client, {
      security_capability: 'sso_saml',
      limit: 20,
      offset: 0,
      response_format: ResponseFormat.JSON,
    });
    expect(bySecurityCapability.isError).toBeUndefined();
    expect(searchToolsOutputSchema.parse(bySecurityCapability.structuredContent).total).toBe(1);

    const tool = await handleGetTool(client, {
      slug: 'example-mcp',
      response_format: ResponseFormat.MARKDOWN,
    });
    expect(tool.content[0]?.text).toContain('Example MCP');
    expect(tool.content[0]?.text).toContain('Latest validated pricing change: paid → free');
    expect(tool.content[0]?.text).toContain('Pricing history: https://slothhub.dev/tool/example-mcp/updates');
    expect(tool.content[0]?.text).toContain('npx -y @example/mcp');
    expect(tool.content[0]?.text).toContain('Source: mcp_registry');
    expect(tool.content[0]?.text).toContain('Auth: none');
    expect(tool.content[0]?.text).toContain('Capabilities: Catalog search');
    expect(tool.content[0]?.text).toContain('## Runtime requirements');
    expect(tool.content[0]?.text).toContain('Node.js** (runtime) — unsupported');
    expect(tool.content[0]?.text).toContain('Runtime support: `https://example.com/runtime-support`');
    expect(fetchJson).toHaveBeenCalledWith(
      'https://slothhub.dev/api/tools/example-mcp.json',
      expect.objectContaining({signal: expect.any(AbortSignal)}),
    );
    expect(tool.content[0]?.text).toContain('## Product limits');
    expect(tool.content[0]?.text).toContain('## What people use it for');
    expect(tool.content[0]?.text).toContain('Find catalog Tools from an agent workflow');
    expect(tool.content[0]?.text).toContain('not claims about specific customers or adoption');
    expect(tool.content[0]?.text).toContain('## Tool fit guidance');
    expect(tool.content[0]?.text).toContain('Agents that need curated catalog data');

    expect(tool.content[0]?.text).toContain('API requests — sustained');
    expect(tool.content[0]?.text).toContain('at most 60 `requests/minute`');
    expect(tool.content[0]?.text).toContain('- `Seats`\n  - unknown');
    expect(tool.content[0]?.text).not.toContain('- `Seats`\n  - Basis:');
    expect(tool.content[0]?.text).toContain('Missing metrics are unknown, not unlimited.');
    expect(tool.content[0]?.text).toContain('## Quickstarts');
    expect(tool.content[0]?.text).toContain('- **Install package** (Official) — source: npm — command: `npm install example-cli`');
    expect(getToolOutputSchema.safeParse(tool.structuredContent).success).toBe(true);
    const toolAsJson = await handleGetTool(client, {
      slug: 'example-mcp',
      response_format: ResponseFormat.JSON,
    });
    expect(toolAsJson.isError).toBeUndefined();
    expect(
      getToolOutputSchema.parse(toolAsJson.structuredContent).tool.quickstarts,
    ).toEqual(toolDetailFeed.data.quickstarts);

    expect(
      getToolInputSchema.safeParse({
        slug: 'io.github.example/server',
        namespace: 'mcp_registry_server',
      }).success
    ).toBe(true);
    const toolByRegistryKey = await handleGetTool(client, {
      slug: 'io.github.example/server',
      namespace: 'mcp_registry_server',
      response_format: ResponseFormat.JSON,
    });
    expect(toolByRegistryKey.isError).toBeUndefined();
    expect(getToolOutputSchema.parse(toolByRegistryKey.structuredContent).tool).toMatchObject({slug: 'example-mcp'});

    const toolByPastedUrl = await handleGetTool(client, {
      slug: 'https://github.com/example/mcp-server',
      response_format: ResponseFormat.JSON,
    });
    expect(toolByPastedUrl.isError).toBeUndefined();
    expect(getToolOutputSchema.parse(toolByPastedUrl.structuredContent).tool).toMatchObject({slug: 'example-mcp'});

    const toolByHistoricalSlug = await handleGetTool(client, {
      slug: 'example-server',
      response_format: ResponseFormat.JSON,
    });
    expect(toolByHistoricalSlug.isError).toBeUndefined();
    expect(getToolOutputSchema.parse(toolByHistoricalSlug.structuredContent).tool).toMatchObject({slug: 'example-mcp'});

    const mcpList = await handleListMcpServers(client, {
      limit: 20,
      offset: 0,
      response_format: ResponseFormat.JSON,
    });
    const mcpListStructured = listMcpServersOutputSchema.parse(mcpList.structuredContent);
    expect(mcpListStructured.total).toBe(1);
    expect(mcpListStructured.mcp_servers).toEqual([
      expect.objectContaining({
        agentInterfaces: [
          expect.objectContaining({
            kind: 'mcp_server',
            installCommand: 'npx -y @example/mcp --label `unsafe`',
            docsUrl: 'https://docs.example.com/mcp',
          }),
        ],
      }),
    ]);

    const mcpListMarkdown = await handleListMcpServers(client, {
      limit: 20,
      offset: 0,
      response_format: ResponseFormat.MARKDOWN,
    });
    expect(mcpListMarkdown.content[0]?.text).toContain(
      'Install: `` npx -y @example/mcp --label `unsafe` ``',
    );
    expect(mcpListMarkdown.content[0]?.text).toContain('Docs: https://docs.example.com/mcp');

    const byCategory = await handleSearchTools(client, {
      category: 'developer-tools',
      limit: 20,
      offset: 0,
      response_format: ResponseFormat.JSON,
    });
    expect(byCategory.isError).toBeUndefined();
    expect(searchToolsOutputSchema.parse(byCategory.structuredContent).total).toBe(1);

    const doctor = await handleDoctor(
      client,
      { response_format: ResponseFormat.MARKDOWN },
      'https://slothhub.dev'
    );
    expect(doctor.content[0]?.text).toContain('Feed version: 33.0.0');
    expect(doctor.content[0]?.text).toContain('- ndjson: https://slothhub.dev/api/catalog.ndjson');
    expect(doctor.content[0]?.text).not.toContain('alternatives');
    expect(doctorOutputSchema.safeParse(doctor.structuredContent).success).toBe(true);
  });

  it('returns the advertised URL budget as a structured doctor error', async () => {
    const futureFeeds = Object.fromEntries(
      Array.from({length: 65 - Object.keys(indexFeed.feeds).length - Object.keys(indexFeed.snapshots ?? {}).length}, (_, index) => [
        `future-${index}`,
        `https://slothhub.dev/api/future-${index}.json`,
      ]),
    );
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async () => ({
        ...indexFeed,
        feeds: {...indexFeed.feeds, ...futureFeeds},
      }),
      noCache: true,
    });
    const doctor = await handleDoctor(
      client,
      {response_format: ResponseFormat.JSON},
      'https://slothhub.dev',
    );
    const markdown = await handleDoctor(
      client,
      {response_format: ResponseFormat.MARKDOWN},
      'https://slothhub.dev',
    );

    expect(doctor.isError).toBe(true);
    expect(JSON.parse(doctor.content[0]!.text)).toMatchObject({
      code: 'advertised_catalog_feed_limit_exceeded',
      configuredLimit: 64,
      observedCount: 65,
      recovery: expect.stringContaining('configured public URL limit'),
    });
    expect(doctor.structuredContent).toMatchObject({
      code: 'advertised_catalog_feed_limit_exceeded',
      observedCount: 65,
    });
    expect(markdown.content[0]?.text).toContain('advertised_catalog_feed_limit_exceeded');
    expect(markdown.content[0]?.text).toContain('configured_limit=64');
    expect(markdown.content[0]?.text).toContain('observed_count=65');
    expect(markdown.content[0]?.text).toContain('recovery=Use a catalog index');
  });

  it('rejects tracked advertised URLs without echoing them in MCP output', async () => {
    const trackedUrl = 'https://slothhub.dev/%67o/figma?surface=agent';
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async () => ({
        ...indexFeed,
        feeds: {...indexFeed.feeds, futureFeed: trackedUrl},
      }),
      noCache: true,
    });
    const json = await handleDoctor(
      client,
      {response_format: ResponseFormat.JSON},
      'https://slothhub.dev',
    );
    const markdown = await handleDoctor(
      client,
      {response_format: ResponseFormat.MARKDOWN},
      'https://slothhub.dev',
    );

    expect(JSON.parse(json.content[0]!.text)).toMatchObject({
      code: 'invalid_advertised_catalog_url',
      field: 'feeds.futureFeed',
    });
    expect(markdown.content[0]?.text).toContain('invalid_advertised_catalog_url');
    expect(`${json.content[0]?.text}${markdown.content[0]?.text}`).not.toContain('/%67o/');
  });

  it('escapes terminal controls in structured doctor error text', async () => {
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async () => ({
        ...indexFeed,
        feeds: {
          ...indexFeed.feeds,
          ['future\u009b31mfeed']: 'https://slothhub.dev/go/figma\u202eforged',
        },
      }),
      noCache: true,
    });
    const result = await handleDoctor(
      client,
      {response_format: ResponseFormat.JSON},
      'https://slothhub.dev',
    );

    expect(result.content[0]?.text).not.toMatch(
      /[\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/u,
    );
    expect(JSON.parse(result.content[0]!.text)).toEqual(result.structuredContent);
    expect(result.structuredContent).toMatchObject({field: 'feeds.future\u009b31mfeed'});
  });

  it('omits malformed or conflicting workflow descriptions from Tool Markdown', async () => {
    const malformedToolDetailFeed: AgentToolDetailFeed = {
      ...toolDetailFeed,
      data: {
        ...toolDetailFeed.data,
        useCases: [
          {
            name: 'Oversized workflow',
            slug: 'oversized-workflow',
            description: 'x'.repeat(201),
          },
          {
            name: 'Conflicting workflow',
            slug: 'conflicting-workflow',
            description: 'First description',
          },
          {
            name: 'Conflicting workflow',
            slug: 'conflicting-workflow',
            description: 'Second description',
          },
        ],
      },
    };
    const baseFetch = createMockFetch();
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async (url) =>
        url.endsWith('/api/tools/example-mcp.json') ? malformedToolDetailFeed : baseFetch(url),
    });

    const result = await handleGetTool(client, {
      slug: 'example-mcp',
      response_format: ResponseFormat.MARKDOWN,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).not.toContain('## What people use it for');
    expect(result.content[0]?.text).not.toContain('First description');
    expect(result.content[0]?.text).not.toContain('Second description');
  });

  it('serves canonical Tool and visit requests without touching a broken optional lookup artifact', async () => {
    const requestedPaths: string[] = [];
    const fetchJson = vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      requestedPaths.push(path);
      if (path === '/api/index.json') return indexFeed;
      if (path === '/api/tools/example-mcp.json') return toolDetailFeed;
      if (path === '/api/tools.json') return toolsFeed;
      if (path === '/api/tool-lookup.json') throw new Error('HTTP 503 Service Unavailable');
      throw new Error(`unexpected ${path}`);
    });
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson,
      noCache: true,
    });

    const tool = await handleGetTool(client, {
      slug: 'example-mcp',
      response_format: ResponseFormat.JSON,
    });
    const visit = await handleGetVisitUrl(client, {
      slug: 'example-mcp',
      response_format: ResponseFormat.JSON,
    });

    expect(tool.isError).toBeUndefined();
    expect(visit.isError).toBeUndefined();
    expect(requestedPaths).toEqual([
      '/api/index.json',
      '/api/tools/example-mcp.json',
      '/api/index.json',
      '/api/tools.json',
    ]);
  });

  it('keeps explicit namespaces lookup-first', async () => {
    const requestedPaths: string[] = [];
    const baseFetch = createMockFetch();
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async (url) => {
        requestedPaths.push(new URL(url).pathname);
        return baseFetch(url);
      },
    });

    const result = await handleGetTool(client, {
      slug: 'io.github.example/server',
      namespace: 'mcp_registry_server',
      response_format: ResponseFormat.JSON,
    });

    expect(result.isError).toBeUndefined();
    expect(requestedPaths).toEqual([
      '/api/index.json',
      '/api/tool-lookup.json',
      '/api/tools/example-mcp.json',
    ]);
  });

  it('publishes parsed automation facts in structured and inert Markdown Tool detail', async () => {
    expect(toolsFeed.data.tools[0]).not.toHaveProperty('agentInterfaces');
    const fetchJson = createMockFetch();
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson,
    });

    const markdown = await handleGetTool(client, {
      slug: 'example-mcp',
      response_format: ResponseFormat.MARKDOWN,
    });
    const json = await handleGetTool(client, {
      slug: 'example-mcp',
      response_format: ResponseFormat.JSON,
    });

    expect(markdown.content[0]?.text).toContain(
      'Status: official (provenance only; not a safety claim)',
    );
    expect(markdown.content[0]?.text).toContain('Non-interactive: yes');
    expect(markdown.content[0]?.text).toContain('Structured output: partial');
    expect(markdown.content[0]?.text).toContain('Dry run: no');
    expect(markdown.content[0]?.text).toContain('Workspace concurrency: requires isolation');
    expect(markdown.content[0]?.text).toContain('Isolation support: worktree, container');
    expect(markdown.content[0]?.text).toContain(
      '`Automation safety guide` (official docs): https://docs.example.com/automation-safety',
    );
    expect(markdown.content[0]?.text).toContain(
      'Install: `` npx -y @example/mcp --label `unsafe` ``',
    );
    expect(markdown.content[0]?.text).toContain(
      'Notes: ``Require `review` before <script>alert(1)</script>.``',
    );
    expect(markdown.content[0]?.text).toContain('## Related resources');
    expect(markdown.content[0]?.text).toContain(
      '**MCP server for**: Example app (App) — `https://example.app/![](https://attacker.example/pixel.png)`',
    );
    expect(markdown.content[0]?.text).not.toContain(
      '— https://example.app/![](https://attacker.example/pixel.png)',
    );
    expect(markdown.content[0]?.text).toContain(
      'Evidence: `https://evidence.example/relationship`',
    );
    expect(json.structuredContent).toMatchObject({
      tool: {
        resourceRelationships: [
          {
            kind: 'mcp_server_for',
            direction: 'outgoing',
            target: {slug: 'example-app'},
          },
        ],
        agentInterfaces: [
          {
            automation: {
              nonInteractive: 'yes',
              structuredOutput: 'partial',
              dryRun: 'no',
              evidenceBasis: 'documented',
              sideEffects: ['filesystem', 'network'],
              workspaceConcurrency: 'requires_isolation',
              isolationSupport: ['worktree', 'container'],
              checkedAt: '2026-07-20T00:00:00.000Z',
              notes: 'Require `review` before <script>alert(1)</script>.',
              evidenceReferences: [
                {
                  title: 'Automation safety guide',
                  url: 'https://docs.example.com/automation-safety',
                  sourceType: 'official_docs',
                  checkedAt: '2026-07-19T00:00:00.000Z',
                },
              ],
            },
          },
        ],
      },
    });
    expect(getToolOutputSchema.safeParse(json.structuredContent).success).toBe(true);
    expect(
      fetchJson.mock.calls.filter(([url]) => url.endsWith('/api/tools.json')),
    ).toHaveLength(0);
    expect(fetchJson).toHaveBeenCalledWith(
      'https://slothhub.dev/api/tools/example-mcp.json',
      { signal: expect.any(AbortSignal) },
    );
    expect(
      fetchJson.mock.calls.filter(([url]) =>
        url.endsWith('/api/tools/example-mcp.json'),
      ),
    ).toHaveLength(1);
  });

  it('shows decision context in get_tool while retaining the parsed facts in JSON', async () => {
    const detail: AgentToolDetailFeed = {...toolDetailFeed, data: {...toolDetailFeed.data,
      integrations: [{name: 'GitHub', slug: 'github', status: 'native', checkedAt: '2026-09-01T00:00:00.000Z', sourceUrl: 'https://github.com/features'}],
      securityPrivacyPosture: {securityCapabilities: [{label: 'SSO/SAML', capability: 'sso_saml', status: 'claimed', sourceUrl: 'https://example.com/security'}]},
      alternativeTools: [{...toolSummary, name: 'Alternative', slug: 'alternative', detailUrl: 'https://slothhub.dev/tool/alternative'}],
    }};
    const fetch = createMockFetch();
    const client = createFeedClient({baseUrl: 'https://slothhub.dev', fetchJson: async url =>
      url.endsWith('/api/tools/example-mcp.json') ? detail : fetch(url)});
    const markdown = await handleGetTool(client, {slug: 'example-mcp', response_format: ResponseFormat.MARKDOWN});
    const json = await handleGetTool(client, {slug: 'example-mcp', response_format: ResponseFormat.JSON});
    expect(markdown.isError).toBeUndefined();
    expect(markdown.content[0].text).toContain('GitHub (github): `native`');
    expect(markdown.content[0].text).toContain('SSO/SAML (`sso_saml`): `claimed`');
    expect(markdown.content[0].text).toContain('Alternative (alternative): `https://slothhub.dev/tool/alternative`');
    expect(json.structuredContent).toMatchObject({tool: {
      integrations: detail.data.integrations,
      securityPrivacyPosture: detail.data.securityPrivacyPosture,
      alternativeTools: detail.data.alternativeTools,
      fitGuidance: detail.data.fitGuidance,
    }});
  });

  it('retains and renders Cursor stdio metadata through the MCP feed parser', async () => {
    const agentInterfaces = normalizePublicAgentInterfaces([{
      kind: 'mcp_server', status: 'official', identifier: 'com.example/mcp',
      mcpRegistryObservation: {
        registryName: 'com.example/mcp', status: 'active', version: '1.0.0', observedAt: '2026-09-22T00:00:00.000Z', remotes: [],
        packages: [{registryType: 'npm', identifier: '@example/mcp', version: '1.0.0', transport: {type: 'stdio'}, environmentVariables: [{name: 'API_TOKEN', isSecret: true}]}],
      },
    }], {slug: 'example-mcp'});
    const parsed = parseFeed(toolDetailFeedSchema, {...toolDetailFeed, data: {...toolDetailFeed.data, agentInterfaces}}, 'Stdio fixture');
    expect(parsed.data.agentInterfaces?.[0]?.stdioSetupRecipe).toEqual(agentInterfaces[0]?.stdioSetupRecipe);
    const {formatToolMarkdown} = await import('./tools/markdown.js');
    const output = formatToolMarkdown(parsed.data);
    expect(output).toContain('"command": "npx"');
    expect(output).toContain('"@example/mcp@1.0.0"');
    expect(output).toContain('API_TOKEN (secret)');
    expect(output).not.toContain('Cursor setup: no confirmed');
  });


  const readyCodexRecipe = {
    state: 'ready' as const,
    host: 'codex_cli' as const,
    serverKey: 'example-mcp',
    url: 'https://mcp.example.com/sse',
    registryName: 'io.github.example/server',
    version: '1.4.0',
    observedAt: '2026-07-21T00:00:00.000Z',
    snippet:
      '[mcp_servers.example-mcp]\nurl = "https://mcp.example.com/sse"',
    entrySnippet:
      '[mcp_servers.example-mcp]\nurl = "https://mcp.example.com/sse"',
  };

  const readyVscodeRecipe = {
    ...readyCursorRecipe,
    host: 'vscode' as const,
    snippet: '{"servers":{"example-mcp":{"type":"http","url":"https://mcp.example.com/sse"}}}',
    entrySnippet: '{"example-mcp":{"type":"http","url":"https://mcp.example.com/sse"}}',
  };

  const readyClineRecipe = {
    ...readyCursorRecipe,
    host: 'cline' as const,
    snippet: '{"mcpServers":{"example-mcp":{"type":"streamableHttp","url":"https://mcp.example.com/sse"}}}',
    entrySnippet: '{"example-mcp":{"type":"streamableHttp","url":"https://mcp.example.com/sse"}}',
  };
  const readyGooseRecipe = {
    ...readyCursorRecipe,
    host: 'goose' as const,
    snippet: 'extensions:\n  example-mcp:\n    name: example-mcp\n    type: streamable_http\n    uri: https://mcp.example.com/sse\n    enabled: true\n',
    entrySnippet: '  example-mcp:\n    name: example-mcp\n    type: streamable_http\n    uri: https://mcp.example.com/sse\n    enabled: true\n',
  };

  const readyAmpRecipe = {
    ...readyCursorRecipe,
    host: 'amp' as const,
    snippet: '{"amp.mcpServers":{"example-mcp":{"url":"https://mcp.example.com/sse"}}}',
  };

  const readyContinueRecipe = {
    ...readyCursorRecipe,
    host: 'continue' as const,
    snippet: 'name: SlothHub example-mcp\nversion: 1.0.0\nschema: v1\nmcpServers:\n  - name: example-mcp\n    type: streamable-http\n    url: https://mcp.example.com/sse\n',
    entrySnippet: '- name: example-mcp\n  type: streamable-http\n  url: https://mcp.example.com/sse\n',
  };

  const recipeDetailFetch = async (url: string) =>
    url.endsWith('/api/tools/example-mcp.json')
      ? {
          ...toolDetailFeed,
          version: '33.0.0',
          data: {
            ...toolDetailFeed.data,
            agentInterfaces: toolDetailFeed.data.agentInterfaces!.map(
              (agentInterface) => ({
                ...agentInterface,
                setupRecipes: [
                  readyCursorRecipe,
                  readyCodexRecipe,
                  readyVscodeRecipe,
                  readyClineRecipe,
                  readyAmpRecipe,
                  readyContinueRecipe,
                  {...readyCursorRecipe, host: 'jetbrains_ai_assistant' as const},
                  {...readyCursorRecipe, host: 'junie' as const},
                  {...readyCursorRecipe, host: 'warp' as const},
                  readyGooseRecipe,
                  {state: 'unknown' as const, host: 'zed' as const},
                  {state: 'unknown' as const, host: 'claude_desktop' as const, registryUrl: 'https://registry.modelcontextprotocol.io/servers/io.github.example%2Fserver'},
                ],
              }),
            ),
          },
        }
      : createMockFetch()(url);

  it('prints ready per-host setup recipes in get_tool markdown and retains them in JSON', async () => {
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: recipeDetailFetch,
    });

    const markdown = await handleGetTool(client, {
      slug: 'example-mcp',
      response_format: ResponseFormat.MARKDOWN,
    });
    expect(markdown.content[0]?.text).toContain(
      'Cursor setup (merge into mcpServers in .cursor/mcp.json (project) or ~/.cursor/mcp.json (user) — review before running):',
    );
    expect(markdown.content[0]?.text).toContain('"example-mcp"');
    expect(markdown.content[0]?.text).toContain('Cline setup (merge into mcpServers in Configure MCP Servers (Cline IDE) or ~/.cline/mcp.json (CLI)');
    expect(markdown.content[0]?.text).toContain(readyClineRecipe.entrySnippet);
    expect(markdown.content[0]?.text).toContain('Continue setup (append to the mcpServers YAML list in .continue/mcpServers/ (workspace)');
    expect(markdown.content[0]?.text).toContain('  - name: example-mcp\n    type: streamable-http');
    expect(markdown.content[0]?.text).toContain('name: SlothHub example-mcp\nversion: 1.0.0\nschema: v1');
    expect(markdown.content[0]?.text).toContain('resolve duplicate server names');
    expect(markdown.content[0]?.text).toContain('choose an unused .yaml filename');
    expect(markdown.content[0]?.text).toContain('Amp setup (merge into amp.mcpServers in .amp/settings.json (workspace; approval required) or ~/.config/amp/settings.json (user)');
    expect(markdown.content[0]?.text).toContain(
      '"url": "https://mcp.example.com/sse"',
    );
    expect(markdown.content[0]?.text).not.toContain('"mcpServers":');
    expect(markdown.content[0]?.text).toContain(
      'Codex CLI setup (merge into mcp_servers in ~/.codex/config.toml (user) or .codex/config.toml (project)',
    );
    expect(markdown.content[0]?.text).toContain('[mcp_servers.example-mcp]');
    expect(markdown.content[0]?.text).toContain('Claude Desktop setup: no documented remote config snippet.');
    expect(markdown.content[0]?.text).toContain('https://registry.modelcontextprotocol.io/servers/io.github.example%2Fserver');
    expect(markdown.content[0]?.text).toContain(
      'VS Code setup (merge into servers in .vscode/mcp.json (workspace) — review before running):',
    );
    expect(markdown.content[0]?.text).toContain(
      'JetBrains AI Assistant setup (merge into mcpServers in Settings → Tools → AI Assistant → Model Context Protocol (MCP); select HTTP when adding a server — review before running):',
    );
    expect(markdown.content[0]?.text).toContain(
      'Junie setup (merge into mcpServers in .junie/mcp/mcp.json (project) or ~/.junie/mcp/mcp.json (user) — review before running):',
    );
    expect(markdown.content[0]?.text).toContain(
      'Warp setup (merge into mcpServers in .warp/.mcp.json (project, requires approval) or ~/.warp/.mcp.json (user) — review before running):',
    );
    expect(markdown.content[0]?.text).toContain('Goose setup (merge into extensions in ~/.config/goose/config.yaml');
    expect(markdown.content[0]?.text).toContain('  ```yaml\n    example-mcp:\n      name: example-mcp\n      type: streamable_http\n      uri: https://mcp.example.com/sse\n      enabled: true\n  ```');
    expect(markdown.content[0]?.text).toContain(
      'url = "https://mcp.example.com/sse"',
    );
    expect(markdown.content[0]?.text).toContain(
      'Or run: codex mcp add example-mcp --url https://mcp.example.com/sse',
    );
    expect(markdown.content[0]?.text).toContain(
      'From the official MCP Registry: io.github.example/server v1.4.0, observed 2026-07-21T00:00:00.000Z.',
    );
    expect(markdown.content[0]?.text).toContain(
      'Zed setup: no confirmed remote recipe in the official MCP Registry.',
    );

    const json = await handleGetTool(client, {
      slug: 'example-mcp',
      response_format: ResponseFormat.JSON,
    });
    expect(getToolOutputSchema.safeParse(json.structuredContent).success).toBe(true);
    expect(json.structuredContent).toMatchObject({
      tool: {
        agentInterfaces: [
          {
            setupRecipes: [
              {state: 'ready', host: 'cursor', serverKey: 'example-mcp'},
              {state: 'ready', host: 'codex_cli', serverKey: 'example-mcp'},
              {state: 'ready', host: 'vscode', serverKey: 'example-mcp'},
              {state: 'ready', host: 'cline', serverKey: 'example-mcp'},
              {state: 'ready', host: 'amp', serverKey: 'example-mcp'},
              {state: 'ready', host: 'continue', serverKey: 'example-mcp'},
              {state: 'ready', host: 'jetbrains_ai_assistant', serverKey: 'example-mcp'},
              {state: 'ready', host: 'junie', serverKey: 'example-mcp'},
              {state: 'ready', host: 'warp', serverKey: 'example-mcp'},
              readyGooseRecipe,
              {state: 'unknown', host: 'zed'},
              {state: 'unknown', host: 'claude_desktop', registryUrl: 'https://registry.modelcontextprotocol.io/servers/io.github.example%2Fserver'},
            ],
          },
        ],
      },
    });
  });

  it('discloses additional published remotes in get_tool markdown', async () => {
    const alternatedRecipe = {
      ...readyCursorRecipe,
      alternateUrls: ['https://eu.mcp.example.com/mcp'],
    };
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async (url: string) =>
        url.endsWith('/api/tools/example-mcp.json')
          ? {
              ...toolDetailFeed,
              data: {
                ...toolDetailFeed.data,
                agentInterfaces: toolDetailFeed.data.agentInterfaces!.map(
                  (agentInterface) => ({
                    ...agentInterface,
                    setupRecipes: [alternatedRecipe],
                  }),
                ),
              },
            }
          : createMockFetch()(url),
    });

    const markdown = await handleGetTool(client, {
      slug: 'example-mcp',
      response_format: ResponseFormat.MARKDOWN,
    });
    expect(markdown.content[0]?.text).toContain(
      'Other published remotes: https://eu.mcp.example.com/mcp',
    );
  });

  it('prints header placeholders and the no-secrets notice for authed remotes', async () => {
    const headeredRecipe = {
      ...readyCursorRecipe,
      headers: [{name: 'Authorization', isRequired: true, isSecret: true}],
      snippet:
        '{"mcpServers":{"example-mcp":{"url":"https://mcp.example.com/sse","headers":{"Authorization":"${AUTHORIZATION}"}}}}',
      entrySnippet:
        '{"example-mcp":{"url":"https://mcp.example.com/sse","headers":{"Authorization":"${AUTHORIZATION}"}}}',
    };
    const recipeFeed = structuredClone(toolDetailFeed);
    recipeFeed.data.agentInterfaces![0]!.setupRecipes = [headeredRecipe];
    const baseFetch = createMockFetch();
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async (url) =>
        url.endsWith('/api/tools/example-mcp.json') ? recipeFeed : baseFetch(url),
    });

    const markdown = await handleGetTool(client, {
      slug: 'example-mcp',
      response_format: ResponseFormat.MARKDOWN,
    });
    expect(markdown.content[0]?.text).toContain('"Authorization":"${AUTHORIZATION}"');
    expect(markdown.content[0]?.text).toContain(
      'Replace the Authorization placeholders with real header values',
    );
    expect(markdown.content[0]?.text).toContain('never secret values');

    const json = await handleGetTool(client, {
      slug: 'example-mcp',
      response_format: ResponseFormat.JSON,
    });
    expect(getToolOutputSchema.safeParse(json.structuredContent).success).toBe(true);
  });

  it('still prints setup recipes when the interface reports no automation block', async () => {
    const recipeFeed = structuredClone(toolDetailFeed);
    delete recipeFeed.data.agentInterfaces![0]!.automation;
    recipeFeed.data.agentInterfaces![0]!.setupRecipes = [readyCursorRecipe];
    const baseFetch = createMockFetch();
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async (url) =>
        url.endsWith('/api/tools/example-mcp.json') ? recipeFeed : baseFetch(url),
    });

    const markdown = await handleGetTool(client, {
      slug: 'example-mcp',
      response_format: ResponseFormat.MARKDOWN,
    });
    expect(markdown.content[0]?.text).toContain(
      'Cursor setup (merge into mcpServers in .cursor/mcp.json (project) or ~/.cursor/mcp.json (user) — review before running):',
    );
    expect(markdown.content[0]?.text).toContain(
      '"url": "https://mcp.example.com/sse"',
    );
    expect(markdown.content[0]?.text).not.toContain('Automation safety facts:');
  });

  it('names ready setup hosts in list_mcp_servers markdown while snippets stay on get_tool', async () => {
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: recipeDetailFetch,
    });

    const result = await handleListMcpServers(client, {
      limit: 20,
      offset: 0,
      response_format: ResponseFormat.MARKDOWN,
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('Cursor');
    expect(result.content[0]?.text).toContain('mcp.json');
    expect(result.content[0]?.text).not.toContain(
      '"url": "https://mcp.example.com/sse"',
    );
  });


  it('prints the observed Last GitHub push stamp in get_tool markdown', async () => {
    const baseFetch = createMockFetch();
    const observedFeed = structuredClone(toolDetailFeed);
    observedFeed.data.repositoryObservation = {
      status: 'ok',
      pushedAt: '2025-08-04T12:00:00.000Z',
      fetchedAt: '2026-09-13T06:00:00.000Z',
    };
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async (url) =>
        url.endsWith('/api/tools/example-mcp.json') ? observedFeed : baseFetch(url),
    });

    const markdown = await handleGetTool(client, {
      slug: 'example-mcp',
      response_format: ResponseFormat.MARKDOWN,
    });
    const json = await handleGetTool(client, {
      slug: 'example-mcp',
      response_format: ResponseFormat.JSON,
    });

    expect(markdown.content[0]?.text).toContain(
      '- Last GitHub push August 4, 2025 (observed September 13, 2026)',
    );
    expect(json.structuredContent).toMatchObject({
      tool: {
        repositoryObservation: {
          status: 'ok',
          pushedAt: '2025-08-04T12:00:00.000Z',
          fetchedAt: '2026-09-13T06:00:00.000Z',
        },
      },
    });
  });

  it('renders hostile automation evidence titles and notes as inert inline code', async () => {
    const baseFetch = createMockFetch();
    const hostileFeed = structuredClone(toolDetailFeed);
    const evidence = hostileFeed.data.agentInterfaces![0]!.automation!
      .evidenceReferences[0]!;
    evidence.title = 'Guide <script>alert(1)</script> [run](javascript:alert(1)) `tick`';
    evidence.note = '[private](file:///Users/example/secret) <script>alert(2)</script>';
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async (url) =>
        url.endsWith('/api/tools/example-mcp.json') ? hostileFeed : baseFetch(url),
    });

    const result = await handleGetTool(client, {
      slug: 'example-mcp',
      response_format: ResponseFormat.MARKDOWN,
    });

    expect(result.content[0]?.text).toContain(
      '`` Guide <script>alert(1)</script> [run](javascript:alert(1)) `tick` ``',
    );
    expect(result.content[0]?.text).toContain(
      '`[private](file:///Users/example/secret) <script>alert(2)</script>`',
    );
  });

  it('renders dense backticks without spreading every fence into function arguments', async () => {
    const denseFeed = structuredClone(toolDetailFeed);
    denseFeed.data.agentInterfaces![0]!.installCommand = '`x'.repeat(130_000);
    const baseFetch = createMockFetch();
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: (url) =>
        url.endsWith('/api/tools/example-mcp.json') ? Promise.resolve(denseFeed) : baseFetch(url),
    });

    const result = await handleGetTool(client, {
      slug: 'example-mcp',
      response_format: ResponseFormat.MARKDOWN,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('call fetch with the same slug as id and full_detail=true');
    expect(result.structuredContent).toMatchObject({tool: {agentInterfaces: denseFeed.data.agentInterfaces}});
  });

  it('rejects automation facts that exceed the public feed caps', () => {
    const automation = toolDetailFeed.data.agentInterfaces![0]!.automation!;
    const parseAutomation = (overrides: Partial<PublicAgentInterfaceAutomation>) =>
      publicAgentInterfaceSchema.safeParse({
        ...toolDetailFeed.data.agentInterfaces![0]!,
        automation: {...automation, ...overrides},
      }).success;

    expect(parseAutomation({notes: 'x'.repeat(281)})).toBe(false);
    expect(
      parseAutomation({sideEffects: ['filesystem', 'network', 'account', 'billing', 'destructive', 'network']}),
    ).toBe(false);
    expect(
      parseAutomation({isolationSupport: ['worktree', 'directory', 'container', 'none', 'unknown', 'worktree']}),
    ).toBe(false);
    expect(parseAutomation({evidenceReferences: []})).toBe(false);
    expect(
      parseAutomation({
        evidenceReferences: Array.from({length: 4}, () => automation.evidenceReferences[0]),
      }),
    ).toBe(false);
  });

  it('rejects duplicate automation arrays and contradictory isolation sentinels', () => {
    const agentInterface = toolDetailFeed.data.agentInterfaces![0]!;
    const automation = agentInterface.automation!;
    const parses = (overrides: Partial<PublicAgentInterfaceAutomation>) =>
      publicAgentInterfaceSchema.safeParse({
        ...agentInterface,
        automation: {...automation, ...overrides},
      }).success;

    expect(parses({sideEffects: ['network', 'network']})).toBe(false);
    expect(parses({isolationSupport: ['worktree', 'worktree']})).toBe(false);
    expect(parses({isolationSupport: ['worktree', 'none']})).toBe(false);
    expect(parses({isolationSupport: ['container', 'unknown']})).toBe(false);
    expect(parses({isolationSupport: ['none', 'unknown']})).toBe(false);
    expect(parses({isolationSupport: ['worktree', 'container']})).toBe(true);
    expect(parses({isolationSupport: ['none']})).toBe(true);
  });

  it('rejects non-ISO automation evidence dates', () => {
    const agentInterface = toolDetailFeed.data.agentInterfaces![0]!;
    const automation = agentInterface.automation!;

    for (const checkedAt of [
      'last Tuesday',
      '2026-07-20',
      '2026-07-20T00:00:00',
      'July 20, 2026 12:00 AM',
    ]) {
      expect(
        publicAgentInterfaceSchema.safeParse({
          ...agentInterface,
          automation: {...automation, checkedAt},
        }).success,
      ).toBe(false);
    }
    expect(
      publicAgentInterfaceSchema.safeParse({
        ...agentInterface,
        automation: {...automation, checkedAt: '2026-07-20T02:00:00+02:00'},
      }).success,
    ).toBe(true);
    expect(
      publicAgentInterfaceSchema.safeParse({
        ...agentInterface,
        automation: {
          ...automation,
          evidenceReferences: [
            {...automation.evidenceReferences[0]!, checkedAt: 'yesterday'},
          ],
        },
      }).success,
    ).toBe(false);
  });

  it('keeps internal fields and unsafe evidence URLs out of parsed structured output', () => {
    const agentInterface = toolDetailFeed.data.agentInterfaces![0]!;
    const automation = agentInterface.automation!;
    const parsed = publicAgentInterfaceSchema.parse({
      ...agentInterface,
      automation: {
        ...automation,
        evidenceReferenceKeys: ['private-source'],
        privatePath: '/Users/example/private-notes.md',
        evidenceReferences: [
          {...automation.evidenceReferences[0]!, internalNote: 'do not publish'},
        ],
      },
    });

    expect(parsed.automation).not.toHaveProperty('evidenceReferenceKeys');
    expect(parsed.automation).not.toHaveProperty('privatePath');
    expect(parsed.automation?.evidenceReferences[0]).not.toHaveProperty('internalNote');

    for (const url of [
      'javascript:alert(1)',
      'https://localhost/private',
      'https://user:password@example.com/private',
      'http://127.0.0.1/private',
    ]) {
      expect(
        publicAgentInterfaceSchema.safeParse({
          ...agentInterface,
          automation: {
            ...automation,
            evidenceReferences: [{...automation.evidenceReferences[0]!, url}],
          },
        }).success,
      ).toBe(false);
    }
  });

  it('reports security filtering as unavailable for older search feeds', async () => {
    const { securityCapabilities: _ignoredFilter, ...oldFilters } = searchFeed.data.filters;
    const oldFeed = {
      ...searchFeed,
      data: {
        ...searchFeed.data,
        tools: searchFeed.data.tools.map(({ securityCapabilities: _ignored, ...tool }) => tool),
        filters: oldFilters,
      },
    };
    const oldFeedHash = computeContentHash(oldFeed);
    oldFeed.contentHash = oldFeedHash;
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async (url) =>
        url.endsWith('/api/index.json')
          ? authenticatedIndex({'/api/search-index.json': oldFeedHash})
          : oldFeed,
    });

    const result = await handleSearchTools(client, {
      security_capability: 'sso_saml',
      limit: 20,
      offset: 0,
      response_format: ResponseFormat.JSON,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('capability_unavailable');
  });

  it('renders runtime requirement text as inert Markdown', async () => {
    const hostileToolDetailFeed = structuredClone(toolDetailFeed);
    const runtime = hostileToolDetailFeed.data.runtimeRequirements?.[0];
    if (!runtime) throw new Error('runtime requirement fixture is missing');
    runtime.subjectName = '<img src=x onerror=alert(1)>';
    runtime.environmentRange = '>=20 <23';
    runtime.toolRange = '`nightly`';
    runtime.note = '[click](javascript:alert(1))';
    runtime.evidence[0]!.title = '<script>alert(1)</script>';

    const fetchJson = vi.fn(async (url: string) => {
      if (url.endsWith('/api/index.json')) return indexFeed;
      if (url.endsWith('/api/tools/example-mcp.json')) return hostileToolDetailFeed;
      if (url.endsWith('/api/tools.json')) return toolsFeed;
      throw new Error(`unexpected ${url}`);
    });
    const client = createFeedClient({baseUrl: 'https://slothhub.dev', fetchJson});

    const result = await handleGetTool(client, {
      slug: 'example-mcp',
      response_format: ResponseFormat.MARKDOWN,
    });
    const markdown = result.content[0]?.text ?? '';

    expect(result.isError).toBeUndefined();
    expect(markdown).not.toContain('**<img src=x onerror=alert(1)>**');
    expect(markdown).not.toContain('Note: [click](javascript:alert(1))');
    expect(markdown).not.toContain('Evidence: <script>alert(1)</script>');
    expect(markdown).toContain('**\\<img src=x onerror=alert\\(1\\)\\>**');
    expect(markdown).toContain('Note: \\[click\\]\\(javascript:alert\\(1\\)\\)');
    expect(markdown).toContain('**\\<img src=x onerror=alert\\(1\\)\\>** (runtime) — unsupported');
    expect(markdown).toContain('Evidence: \\<script\\>alert\\(1\\)\\</script\\>: `https://example.com/runtime-support`');
    expect(markdown).toContain('Environment: `>=20 <23`');
    expect(markdown).toContain('Tool range: `` `nightly` ``');
  });

  it('lists stacks, best lists, and categories then loads detail', async () => {
    const fetchJson = createMockFetch();
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson,
    });

    const stacks = await handleListStacks(client, {
      query: 'design',
      limit: 20,
      offset: 0,
      response_format: ResponseFormat.JSON,
    });
    expect(stacks.isError).toBeUndefined();
    expect(listStacksOutputSchema.parse(stacks.structuredContent).total).toBe(1);

    const stack = await handleGetStack(client, {
      slug: 'design-stack',
      response_format: ResponseFormat.JSON,
    });
    expect(stack.isError).toBeUndefined();
    expect(getStackOutputSchema.parse(stack.structuredContent).stack).toMatchObject({
      slug: 'design-stack',
    });

    const bestList = await handleListBest(client, {
      query: 'mcp',
      limit: 20,
      offset: 0,
      response_format: ResponseFormat.JSON,
    });
    expect(listBestOutputSchema.parse(bestList.structuredContent).total).toBe(1);

    const best = await handleGetBestList(client, {
      slug: 'best-mcp-servers',
      response_format: ResponseFormat.JSON,
    });
    expect(getBestListOutputSchema.parse(best.structuredContent).best).toMatchObject({
      slug: 'best-mcp-servers',
    });

    const categories = await handleListCategories(client, {
      query: 'developer',
      limit: 20,
      offset: 0,
      response_format: ResponseFormat.JSON,
    });
    expect(listCategoriesOutputSchema.parse(categories.structuredContent).total).toBe(1);

    const visit = await handleGetVisitUrl(client, {
      slug: 'example-server',
      response_format: ResponseFormat.JSON,
    });
    const visitStructured = getVisitUrlOutputSchema.parse(visit.structuredContent);
    expect(visitStructured.visitUrl).toContain('/go/example-mcp');
    expect(visitStructured.detailUrl).toContain('/tool/example-mcp');
  });

  it('lists a valid tag with name, slug, count, and human URL', async () => {
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: createMockFetch(),
    });

    const listed = await handleListTags(client, {
      limit: 20,
      offset: 0,
      response_format: ResponseFormat.JSON,
    });
    expect(listed.isError).toBeUndefined();
    const structured = listTagsOutputSchema.parse(listed.structuredContent);
    expect(structured).toMatchObject({
      query: '',
      total: 1,
      count: 1,
      offset: 0,
      has_more: false,
    });
    expect(structured.tags).toEqual([
      {
        name: 'MCP',
        slug: 'mcp',
        url: 'https://slothhub.dev/tag/mcp',
        toolCount: 1,
      },
    ]);

    const markdown = await handleListTags(client, {
      query: 'mcp',
      limit: 20,
      offset: 0,
      response_format: ResponseFormat.MARKDOWN,
    });
    expect(markdown.content[0]?.text).toContain('## MCP (`mcp`)');
    expect(markdown.content[0]?.text).toContain('- Tools: 1');
    expect(markdown.content[0]?.text).toContain('- Cite: https://slothhub.dev/tag/mcp');
  });

  it('returns an empty tags page when the public feed has no tags', async () => {
    const baseFetch = createMockFetch();
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async (url) => {
        if (url.endsWith('/api/tags.json')) {
          return {
            version: '33.0.0',
            siteUrl: 'https://slothhub.dev',
            generatedAt: '2026-07-08T00:00:00.000Z',
            data: { tags: [] },
          };
        }
        return baseFetch(url);
      },
    });

    const listed = await handleListTags(client, {
      limit: 20,
      offset: 0,
      response_format: ResponseFormat.JSON,
    });
    expect(listed.isError).toBeUndefined();
    expect(listTagsOutputSchema.parse(listed.structuredContent)).toMatchObject({
      query: '',
      total: 0,
      count: 0,
      tags: [],
    });

    const markdown = await handleListTags(client, {
      limit: 20,
      offset: 0,
      response_format: ResponseFormat.MARKDOWN,
    });
    expect(markdown.content[0]?.text).toContain('Found 0 tags (showing 0).');
  });

  it('returns no tags when the query misses the catalog', async () => {
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: createMockFetch(),
    });

    const listed = await handleListTags(client, {
      query: 'no-such-tag',
      limit: 20,
      offset: 0,
      response_format: ResponseFormat.JSON,
    });
    expect(listed.isError).toBeUndefined();
    expect(listTagsOutputSchema.parse(listed.structuredContent)).toMatchObject({
      query: 'no-such-tag',
      total: 0,
      count: 0,
      tags: [],
    });
  });

  it('omits tool count from tag results when the feed does not include it', async () => {
    const baseFetch = createMockFetch();
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async (url) => {
        if (url.endsWith('/api/tags.json')) {
          return {
            version: '33.0.0',
            siteUrl: 'https://slothhub.dev',
            generatedAt: '2026-07-08T00:00:00.000Z',
            data: {
              tags: [
                {
                  name: 'CLI',
                  slug: 'cli',
                  url: 'https://slothhub.dev/tag/cli',
                },
              ],
            },
          };
        }
        return baseFetch(url);
      },
    });

    const listed = await handleListTags(client, {
      limit: 20,
      offset: 0,
      response_format: ResponseFormat.MARKDOWN,
    });
    const structured = listTagsOutputSchema.parse(listed.structuredContent);
    expect(structured.tags[0]).toEqual({
      name: 'CLI',
      slug: 'cli',
      url: 'https://slothhub.dev/tag/cli',
    });
    expect(listed.content[0]?.text).not.toContain('- Tools:');
    expect(listed.content[0]?.text).toContain('- Cite: https://slothhub.dev/tag/cli');
  });

  it('renders tag names as inert markdown instead of raw markup', async () => {
    const baseFetch = createMockFetch();
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async (url) => {
        if (url.endsWith('/api/tags.json')) {
          return {
            version: '33.0.0',
            siteUrl: 'https://slothhub.dev',
            generatedAt: '2026-07-08T00:00:00.000Z',
            data: {
              tags: [
                {
                  name: 'Click [here](javascript:alert(1))',
                  slug: 'click',
                  description: 'See <script>alert(1)</script>',
                  url: 'https://slothhub.dev/tag/click',
                  toolCount: 1,
                },
              ],
            },
          };
        }
        return baseFetch(url);
      },
    });

    const listed = await handleListTags(client, {
      limit: 20,
      offset: 0,
      response_format: ResponseFormat.MARKDOWN,
    });
    const markdown = listed.content[0]?.text ?? '';
    expect(markdown).not.toContain('[here](javascript:alert(1))');
    expect(markdown).not.toContain('<script>alert(1)</script>');
    expect(markdown).toContain('Click \\[here\\]\\(javascript:alert\\(1\\)\\)');
    expect(markdown).toContain('See \\<script\\>alert\\(1\\)\\</script\\>');
    expect(markdown).toContain('- Cite: https://slothhub.dev/tag/click');
  });

  it('lists a valid use case with name, slug, count, and human URL', async () => {
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: createMockFetch(),
    });

    const listed = await handleListUseCases(client, {
      limit: 20,
      offset: 0,
      response_format: ResponseFormat.JSON,
    });
    expect(listed.isError).toBeUndefined();
    const structured = listUseCasesOutputSchema.parse(listed.structuredContent);
    expect(structured).toMatchObject({
      query: '',
      total: 1,
      count: 1,
      offset: 0,
      has_more: false,
    });
    expect(structured.useCases).toEqual([
      {
        name: 'Agent tooling',
        slug: 'agent-tooling',
        url: 'https://slothhub.dev/use-cases/agent-tooling',
        toolCount: 1,
      },
    ]);
    expect(structured.useCases[0]).not.toHaveProperty('tools');

    const markdown = await handleListUseCases(client, {
      query: 'agent',
      limit: 20,
      offset: 0,
      response_format: ResponseFormat.MARKDOWN,
    });
    expect(markdown.content[0]?.text).toContain('## Agent tooling (`agent-tooling`)');
    expect(markdown.content[0]?.text).toContain('- Tools: 1');
    expect(markdown.content[0]?.text).toContain(
      '- Cite: https://slothhub.dev/use-cases/agent-tooling',
    );
  });

  it('returns an empty use cases page when the public feed has no use cases', async () => {
    const baseFetch = createMockFetch();
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async (url) => {
        if (url.endsWith('/api/use-cases.json')) {
          return {
            version: '33.0.0',
            siteUrl: 'https://slothhub.dev',
            generatedAt: '2026-07-08T00:00:00.000Z',
            data: { useCases: [] },
          };
        }
        return baseFetch(url);
      },
    });

    const listed = await handleListUseCases(client, {
      limit: 20,
      offset: 0,
      response_format: ResponseFormat.JSON,
    });
    expect(listed.isError).toBeUndefined();
    expect(listUseCasesOutputSchema.parse(listed.structuredContent)).toMatchObject({
      query: '',
      total: 0,
      count: 0,
      useCases: [],
    });

    const markdown = await handleListUseCases(client, {
      limit: 20,
      offset: 0,
      response_format: ResponseFormat.MARKDOWN,
    });
    expect(markdown.content[0]?.text).toContain('Found 0 use cases (showing 0).');
  });

  it('returns no use cases when the query misses the catalog', async () => {
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: createMockFetch(),
    });

    const listed = await handleListUseCases(client, {
      query: 'no-such-use-case',
      limit: 20,
      offset: 0,
      response_format: ResponseFormat.JSON,
    });
    expect(listed.isError).toBeUndefined();
    expect(listUseCasesOutputSchema.parse(listed.structuredContent)).toMatchObject({
      query: 'no-such-use-case',
      total: 0,
      count: 0,
      useCases: [],
    });
  });

  it('omits tool count from use case results when the feed does not include it', async () => {
    const baseFetch = createMockFetch();
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async (url) => {
        if (url.endsWith('/api/use-cases.json')) {
          return {
            version: '33.0.0',
            siteUrl: 'https://slothhub.dev',
            generatedAt: '2026-07-08T00:00:00.000Z',
            data: {
              useCases: [
                {
                  name: 'Local development',
                  slug: 'local-development',
                  url: 'https://slothhub.dev/use-cases/local-development',
                },
              ],
            },
          };
        }
        return baseFetch(url);
      },
    });

    const listed = await handleListUseCases(client, {
      limit: 20,
      offset: 0,
      response_format: ResponseFormat.MARKDOWN,
    });
    const structured = listUseCasesOutputSchema.parse(listed.structuredContent);
    expect(structured.useCases[0]).toEqual({
      name: 'Local development',
      slug: 'local-development',
      url: 'https://slothhub.dev/use-cases/local-development',
    });
    expect(listed.content[0]?.text).not.toContain('- Tools:');
    expect(listed.content[0]?.text).toContain(
      '- Cite: https://slothhub.dev/use-cases/local-development',
    );
  });

  it('returns Tool Stack recipes as labeled guidance without executing examples', async () => {
    const recipeFeed: AgentToolStackFeed = {
      ...stacksFeed,
      data: {
        stacks: stacksFeed.data.stacks.map((stack) => ({
          ...stack,
          recipe: {
            executionMode: 'guidance_only',
            title: 'Build this stack',
            reviewedAt: '2026-08-19T18:00:00.000Z',
            sourceReferences: [{
              title: 'Workflow docs',
              url: 'https://example.com/workflow',
              sourceType: 'official_docs',
            }],
            prerequisites: [{label: 'Review access'}],
            limitations: [{label: 'Example only'}],
            steps: [{
              kind: 'command',
              title: 'Inspect the handoff',
              instruction: 'Review this example command before using it.',
              example: 'echo $(date) \\\nprintf \'``` [handoff]\\n\'',
              language: 'shell',
              expectedOutput: 'A draft for human review.',
              relatedTool: {
                name: 'Figma',
                slug: 'figma',
                detailUrl: 'https://slothhub.dev/tool/figma',
                resourceLinks: [{
                  label: 'Official docs',
                  url: 'https://example.com/docs',
                  kind: 'official_docs',
                  isOfficial: true,
                }],
                agentInterfaces: [{
                  kind: 'cli',
                  status: 'official',
                  label: 'Figma CLI',
                  docsUrl: 'https://example.com/cli',
                }],
              },
              sourceReferences: [{
                title: 'Workflow docs',
                url: 'https://example.com/workflow',
                sourceType: 'official_docs',
              }],
            }, {
              kind: 'verification',
              title: 'Verify the draft',
              instruction: 'Confirm the draft is ready for human review.',
            }],
          },
        })),
      },
    };
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async (url) => url.endsWith('/api/stacks.json') ? recipeFeed : createMockFetch()(url),
    });

    const result = await handleGetStack(client, {
      slug: 'design-stack',
      response_format: ResponseFormat.MARKDOWN,
    });
    const markdown = result.content[0]?.text ?? '';

    expect(result.isError).toBeUndefined();
    expect(markdown).toContain('Guidance only — SlothHub does not run these examples.');
    expect(markdown).toContain('Example command:\n````shell\necho $(date) \\\nprintf \'``` [handoff]\\n\'\n````');
    expect(markdown).toContain('Expected: A draft for human review.');
    expect(markdown).toContain('Related Tool: Figma — https://slothhub.dev/tool/figma');
    expect(markdown).toContain('Source: Workflow docs — https://example.com/workflow');
    expect(markdown).toContain('Resource: Official docs — https://example.com/docs');
    expect(markdown).toContain('Agent Interface: Figma CLI — https://example.com/cli');
    expect(getStackOutputSchema.parse(result.structuredContent).stack.recipe?.steps[0]?.relatedTool)
      .toMatchObject({
        resourceLinks: [{label: 'Official docs'}],
        agentInterfaces: [{label: 'Figma CLI'}],
      });

    const malformedFeed = structuredClone(recipeFeed);
    malformedFeed.data.stacks[0]!.recipe!.steps[0]!.example = undefined;
    const malformedClient = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async (url) => url.endsWith('/api/stacks.json')
        ? malformedFeed
        : createMockFetch()(url),
    });
    const malformed = await handleGetStack(malformedClient, {
      slug: 'design-stack',
      response_format: ResponseFormat.MARKDOWN,
    });
    expect(malformed.isError).toBe(true);
    expect(malformed.content[0]?.text).toContain('Command and prompt recipe steps require an explicit example.');

    const unsafeFeed = structuredClone(recipeFeed);
    unsafeFeed.data.stacks[0]!.recipe!.steps[0]!.example = 'echo safe\u001b[31m';
    const unsafeClient = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async (url) => url.endsWith('/api/stacks.json')
        ? unsafeFeed
        : createMockFetch()(url),
    });
    const unsafe = await handleGetStack(unsafeClient, {
      slug: 'design-stack',
      response_format: ResponseFormat.MARKDOWN,
    });
    expect(unsafe.isError).toBe(true);
    expect(unsafe.content[0]?.text).toContain('exclude unsafe control or bidi characters');
  });

  it('marks stacks carrying a reviewed recipe in list results without recipe bodies', async () => {
    const recipeFeed: AgentToolStackFeed = {
      ...stacksFeed,
      data: {
        stacks: stacksFeed.data.stacks.map((stack) => ({
          ...stack,
          recipe: {
            executionMode: 'guidance_only',
            title: 'Build this stack',
            reviewedAt: '2026-08-19T18:00:00.000Z',
            sourceReferences: [{
              title: 'Workflow docs',
              url: 'https://example.com/workflow',
              sourceType: 'official_docs',
            }],
            prerequisites: [{label: 'Review access'}],
            limitations: [{label: 'Example only'}],
            steps: [{
              kind: 'verification',
              title: 'Verify the output',
              instruction: 'Confirm the setup works.',
            }],
          },
        })),
      },
    };
    const recipeClient = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async (url) => url.endsWith('/api/stacks.json')
        ? recipeFeed
        : createMockFetch()(url),
    });

    const json = await handleListStacks(recipeClient, {
      limit: 20,
      offset: 0,
      response_format: ResponseFormat.JSON,
    });
    expect(json.isError).toBeUndefined();
    const parsed = listStacksOutputSchema.parse(json.structuredContent);
    expect(parsed.stacks[0]).toMatchObject({slug: 'design-stack', recipeAvailable: true});
    expect(parsed.stacks[0]).not.toHaveProperty('recipe');
    expect(parsed.stacks[0]).not.toHaveProperty('recipeSteps');

    const markdown = await handleListStacks(recipeClient, {
      limit: 20,
      offset: 0,
      response_format: ResponseFormat.MARKDOWN,
    });
    expect(markdown.content[0]?.text).toContain('Execution recipe available');
    expect(markdown.content[0]?.text).not.toContain('Build this stack');

    const plainClient = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: createMockFetch(),
    });
    const plain = await handleListStacks(plainClient, {
      limit: 20,
      offset: 0,
      response_format: ResponseFormat.JSON,
    });
    const plainStacks = listStacksOutputSchema.parse(plain.structuredContent).stacks;
    expect(plainStacks[0]).not.toHaveProperty('recipeAvailable');
    expect(JSON.stringify(plainStacks[0])).not.toContain('recipeAvailable');
  });

  it('resolves a historical registry identity to the canonical Tool', async () => {
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: createMockFetch(),
    });

    const result = await handleGetTool(client, {
      slug: 'old-example-mcp',
      namespace: 'npm_package',
      response_format: ResponseFormat.JSON,
    });

    expect(result.isError).toBeUndefined();
    expect(getToolOutputSchema.parse(result.structuredContent).tool.slug).toBe('example-mcp');
  });

  it('resolves a transferred GitHub repository identity to the canonical Tool', async () => {
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: createMockFetch(),
    });

    const result = await handleGetTool(client, {
      slug: 'old-owner/old-example-mcp',
      namespace: 'github_repository',
      response_format: ResponseFormat.JSON,
    });

    expect(result.isError).toBeUndefined();
    expect(getToolOutputSchema.parse(result.structuredContent).tool.slug).toBe('example-mcp');
  });

  it('preserves a known retired registry identity as a structured error', async () => {
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: createMockFetch(),
    });

    const result = await handleGetTool(client, {
      slug: 'retired-example-mcp',
      namespace: 'npm_package',
      response_format: ResponseFormat.JSON,
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: 'retired',
      message: 'Tool identity npm_package:retired-example-mcp is retired; no current public Tool exists.',
      suggestion: 'Search SlothHub for a current alternative.',
    });
  });

  it('preserves Tool lookup identity-claim overflow as a structured MCP error', async () => {
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: async () => {
        throw new ToolLookupArtifactLimitError(5_001);
      },
    });

    const result = await handleGetTool(client, {
      slug: 'example',
      namespace: 'npm_package',
      response_format: ResponseFormat.JSON,
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: 'tool_lookup_identity_claim_limit_exceeded',
      configuredLimit: 5_000,
      observedValue: 5_001,
      recovery: expect.stringContaining('Reduce'),
    });
  });

  it('returns actionable errors for missing tools, stacks, and best lists', async () => {
    const fetchJson = createMockFetch();
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson,
    });

    const missingTool = await handleGetTool(client, {
      slug: 'missing',
      response_format: ResponseFormat.MARKDOWN,
    });
    expect(missingTool.isError).toBe(true);
    expect(missingTool.content[0]?.text).toContain('Tool not found');
    expect(missingTool.content[0]?.text).toContain('search');
    expect(missingTool.structuredContent).toMatchObject({ code: 'not_found' });

    const missingVisit = await handleGetVisitUrl(client, {
      slug: 'missing',
      response_format: ResponseFormat.MARKDOWN,
    });
    expect(missingVisit.isError).toBe(true);
    expect(missingVisit.content[0]?.text).toContain('search');

    const missingStack = await handleGetStack(client, {
      slug: 'missing-stack',
      response_format: ResponseFormat.MARKDOWN,
    });
    expect(missingStack.isError).toBe(true);
    expect(missingStack.content[0]?.text).toBe('Stack not found: missing-stack. Find a stack slug in resources/list (slothhub://stack/{slug} entries) or read slothhub://artifact/stacks.');

    const missingBest = await handleGetBestList(client, {
      slug: 'missing-best',
      response_format: ResponseFormat.MARKDOWN,
    });
    expect(missingBest.isError).toBe(true);
    expect(missingBest.content[0]?.text).toBe('Best list not found: missing-best. Find a list slug in resources/list (slothhub://best/{slug} entries) or read slothhub://artifact/best.');
  });

  it('routes invalid direct Tool slugs through lookup validation', async () => {
    const fetchJson = createMockFetch();
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson,
    });

    const result = await handleGetTool(client, {
      slug: '../private',
      response_format: ResponseFormat.JSON,
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: 'invalid_input' });
    expect(result.content[0]?.text).not.toContain('Error loading tool');

    const resultWithoutLookup = await handleGetTool(
      {...client, toolLookup: vi.fn(async () => null)},
      {
        slug: '../private',
        response_format: ResponseFormat.JSON,
      }
    );

    expect(resultWithoutLookup.isError).toBe(true);
    expect(resultWithoutLookup.structuredContent).toMatchObject({code: 'invalid_input'});
  });

  it('treats an absent optional alias artifact as the original not-found behavior', async () => {
    const fetchJson = createMockFetch();
    fetchJson.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/tool-lookup.json')) throw new Error('HTTP 404 Not Found');
      if (url.endsWith('/api/tools/missing.json')) throw new Error('HTTP 404 Not Found');
      if (url.endsWith('/api/index.json')) return indexFeed;
      if (url.endsWith('/api/tools.json')) return toolsFeed;
      throw new Error(`unexpected ${url}`);
    });
    const client = createFeedClient({baseUrl: 'https://slothhub.dev', fetchJson});

    const result = await handleGetTool(client, {
      slug: 'missing',
      response_format: ResponseFormat.MARKDOWN,
    });
    const visit = await handleGetVisitUrl(client, {
      slug: 'missing',
      response_format: ResponseFormat.MARKDOWN,
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({code: 'not_found'});
    expect(result.content[0]?.text).toContain('Tool not found');
    expect(result.content[0]?.text).not.toContain('Error loading tool');
    expect(visit.isError).toBe(true);
    expect(visit.structuredContent).toMatchObject({code: 'not_found'});
    expect(visit.content[0]?.text).not.toContain('Error loading visit URL');
  });

  it('does not misclassify an index 404 as a missing Tool detail', async () => {
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: vi.fn(async () => {
        throw new Error('HTTP 404 Not Found');
      }),
    });

    const result = await handleGetTool(client, {
      slug: 'example-mcp',
      response_format: ResponseFormat.JSON,
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({code: 'feed_load_error'});
    expect(result.content[0]?.text).not.toContain('Tool not found');
  });

  it('surfaces HTTP feed failures as tool errors', async () => {
    const fetchJson = vi.fn(async () => {
      throw new Error('HTTP 503 Service Unavailable');
    });
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson,
      noCache: true,
    });
    const result = await handleSearchTools(client, {
      limit: 20,
      offset: 0,
      response_format: ResponseFormat.MARKDOWN,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Error searching tools');
    expect(result.content[0]?.text).toContain('slothhub_check_status');
  });

  it('surfaces fetch timeouts as tool errors', async () => {
    const fetchJson = vi.fn(async () => {
      throw new Error('Request timed out after 15ms');
    });
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson,
      noCache: true,
      fetchTimeoutMs: 15,
    });
    const result = await handleListStacks(client, {
      limit: 20,
      offset: 0,
      response_format: ResponseFormat.MARKDOWN,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('timed out');
    expect(result.content[0]?.text).toContain('slothhub_check_status');
    expect(result.structuredContent).toMatchObject({ code: 'feed_load_error' });
  });

  it('surfaces feed failures from get_tool with doctor guidance', async () => {
    const fetchJson = vi.fn(async () => {
      throw new Error('HTTP 503 Service Unavailable');
    });
    const client = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson,
      noCache: true,
    });
    const result = await handleGetTool(client, {
      slug: 'example-mcp',
      response_format: ResponseFormat.MARKDOWN,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('slothhub_check_status');
    expect(result.structuredContent).toMatchObject({ code: 'feed_load_error' });
  });

  it('serves an empty stacks hub artifact without truncation or synthesis', async () => {
    const emptyHub = '# SlothHub Tool Stacks\n\nNo public Tool Stacks are published yet.\n';
    const baseClient = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: createMockFetch(),
    });
    const feedClient: FeedClient = {
      ...baseClient,
      stacksHubMarkdown: async () => emptyHub,
    };
    const server = createSlothHubMcpServer({feedClient});
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({name: 'test-client', version: '0.0.0'});
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const result = await client.readResource({uri: 'slothhub://artifact/stacks'});
      expect(result.contents[0]).toMatchObject({
        uri: 'slothhub://artifact/stacks',
        mimeType: 'text/markdown',
        text: emptyHub,
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('serves an empty best-of hub artifact without truncation or synthesis', async () => {
    const emptyHub =
      '# SlothHub Best-of lists\n\n_No public Best-of lists are published yet._\n';
    const baseClient = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: createMockFetch(),
    });
    const feedClient: FeedClient = {
      ...baseClient,
      bestHubMarkdown: async () => emptyHub,
    };
    const server = createSlothHubMcpServer({feedClient});
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({name: 'test-client', version: '0.0.0'});
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const result = await client.readResource({uri: 'slothhub://artifact/best'});
      expect(result.contents[0]).toMatchObject({
        uri: 'slothhub://artifact/best',
        mimeType: 'text/markdown',
        text: emptyHub,
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('omits workflow prompts when includePrompts is false', async () => {
    const fetchJson = createMockFetch();
    const server = createSlothHubMcpServer({
      baseUrl: 'https://slothhub.dev',
      fetchJson,
      includePrompts: false,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      expect(client.getServerCapabilities()?.prompts).toBeUndefined();
      const prompts = await client.listPrompts();
      expect(prompts.prompts).toEqual([]);
      await expect(
        client.getPrompt({
          name: 'slothhub_find_agent_skill',
          arguments: {},
        }),
      ).rejects.toThrow();
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('lists Tool, stack, best-of, comparison, and alternatives resource templates', async () => {
    const fetchJson = createMockFetch();
    const server = createSlothHubMcpServer({
      baseUrl: 'https://slothhub.dev',
      fetchJson,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const listed = await client.listResourceTemplates();
      expect(
        listed.resourceTemplates
          .map((template) => template.uriTemplate)
          .sort(),
      ).toEqual([
        'slothhub://alternatives/{slug}',
        'slothhub://best/{slug}',
        'slothhub://compare/{slug}',
        'slothhub://stack/{slug}',
        'slothhub://tool/{slug}',
      ]);
      expect(listed.resourceTemplates.map((template) => template.name).sort()).toEqual([
        'slothhub_alternatives',
        'slothhub_best',
        'slothhub_comparison',
        'slothhub_stack',
        'slothhub_tool',
      ]);
      expect(client.getServerVersion()).toMatchObject({
        name: 'slothhub-mcp-server',
        websiteUrl: 'https://slothhub.dev',
        icons: [
          {
            src: 'https://slothhub.dev/favicon.svg',
            mimeType: 'image/svg+xml',
            sizes: ['any'],
          },
        ],
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('reads a Tool resource as JSON and canonicalizes alias slugs', async () => {
    const fetchJson = createMockFetch();
    const server = createSlothHubMcpServer({
      baseUrl: 'https://slothhub.dev',
      fetchJson,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const direct = await client.readResource({
        uri: 'slothhub://tool/example-mcp',
      });
      const directContent = direct.contents[0];
      expect(directContent).toMatchObject({
        uri: 'slothhub://tool/example-mcp',
        mimeType: 'application/json',
        _meta: {
          title: 'Example MCP',
          lastModified: '2026-07-08T00:00:00.000Z',
        },
      });
      const directText =
        directContent && 'text' in directContent ? directContent.text : '';
      expect(JSON.parse(directText)).toMatchObject({slug: 'example-mcp'});

      const aliased = await client.readResource({
        uri: 'slothhub://tool/example-server',
      });
      expect(aliased.contents[0]).toMatchObject({
        uri: 'slothhub://tool/example-mcp',
        mimeType: 'application/json',
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('returns resource-not-found for an unknown Tool slug', async () => {
    const fetchJson = createMockFetch();
    const server = createSlothHubMcpServer({
      baseUrl: 'https://slothhub.dev',
      fetchJson,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      await expect(
        client.readResource({uri: 'slothhub://tool/missing-tool'}),
      ).rejects.toSatisfy((error: Error) => {
        return (
          ResourceNotFoundError.isInstance(error) &&
          error.uri === 'slothhub://tool/missing-tool'
        );
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('returns the structured retired error for a retired Tool resource', async () => {
    const fetchJson = createMockFetch();
    const resolveSpy = vi
      .spyOn(publicToolLookup, 'resolvePublicTool')
      .mockResolvedValue({
        kind: 'retired',
        namespace: 'slug',
        slug: 'retired-example-mcp',
      });
    const server = createSlothHubMcpServer({
      baseUrl: 'https://slothhub.dev',
      fetchJson,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      await expect(
        client.readResource({uri: 'slothhub://tool/retired-example-mcp'}),
      ).rejects.toSatisfy((error: Error) => {
        return ProtocolError.isInstance(error) && readProtocolErrorCode(error) === 'retired';
      });
    } finally {
      resolveSpy.mockRestore();
      await client.close();
      await server.close();
    }
  });

  it('rejects an invalid Tool resource slug before any feed fetch', async () => {
    const fetchJson = createMockFetch();
    const server = createSlothHubMcpServer({
      baseUrl: 'https://slothhub.dev',
      fetchJson,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      await expect(
        client.readResource({uri: 'slothhub://tool/Not-Valid'}),
      ).rejects.toSatisfy((error: Error) => {
        return (
          ProtocolError.isInstance(error) &&
          readProtocolErrorCode(error) === 'invalid_input'
        );
      });
      expect(fetchJson).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('points invalid stack and best slugs at their resource listings', async () => {
    const fetchJson = createMockFetch();
    const server = createSlothHubMcpServer({
      baseUrl: 'https://slothhub.dev',
      fetchJson,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      await expect(
        client.readResource({uri: 'slothhub://stack/Not-Valid'}),
      ).rejects.toSatisfy((error: Error) => {
        return (
          ProtocolError.isInstance(error) &&
          readProtocolErrorCode(error) === 'invalid_input' &&
          error.message.includes('recovery=Use a lowercase slug with letters, numbers, and hyphens. Find a stack slug in resources/list (slothhub://stack/{slug} entries) or read slothhub://artifact/stacks.')
        );
      });
      await expect(
        client.readResource({uri: 'slothhub://best/Not-Valid'}),
      ).rejects.toSatisfy((error: Error) => {
        return (
          ProtocolError.isInstance(error) &&
          readProtocolErrorCode(error) === 'invalid_input' &&
          error.message.includes('recovery=Use a lowercase slug with letters, numbers, and hyphens. Find a list slug in resources/list (slothhub://best/{slug} entries) or read slothhub://artifact/best.')
        );
      });
      expect(fetchJson).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('returns a distinct slug-mismatch error when Tool detail disagrees', async () => {
    const fetchJson = vi.fn(async (url: string) => {
      if (url.endsWith('/api/tools/example-mcp.json')) {
        return {
          ...toolDetailFeed,
          data: {...toolDetailFeed.data, slug: 'other-slug'},
        };
      }
      return createMockFetch()(url);
    });
    const feedClient = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson,
      noCache: true,
    });
    const result = await handleGetTool(feedClient, {
      slug: 'example-mcp',
      response_format: ResponseFormat.MARKDOWN,
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: 'slug_mismatch',
    });
    expect(result.content[0]?.text).toContain('tool_detail_slug_mismatch');
    expect(result.content[0]?.text).not.toContain('slothhub_check_status');
  });

  it('rethrows aborted stack listing instead of returning an empty page', async () => {
    const baseClient = createFeedClient({
      baseUrl: 'https://slothhub.dev',
      fetchJson: createMockFetch(),
    });
    const feedClient: FeedClient = {
      ...baseClient,
      stacks: async () => {
        const error = new Error('This operation was aborted');
        error.name = 'AbortError';
        throw error;
      },
    };
    const server = createSlothHubMcpServer({
      baseUrl: 'https://slothhub.dev',
      feedClient,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      await expect(client.listResources()).rejects.toThrow(/aborted/i);
    } finally {
      await client.close();
      await server.close();
    }
  });


it('offers complete recovery when all Tool sections exceed the Markdown display budget', async () => {
    const detail: AgentToolDetailFeed = {...toolDetailFeed, data: {...toolDetailFeed.data,

      agentInterfaces: [{...toolDetailFeed.data.agentInterfaces![0]!, installCommand: 'literal-argument '.repeat(2000)}],
      integrations: [{name: 'GitHub', slug: 'github', status: 'native', checkedAt: '2026-09-01T00:00:00.000Z', sourceUrl: 'https://github.com/features'}],
      alternativeTools: [{...toolSummary, name: 'Alternative', slug: 'alternative', detailUrl: 'https://slothhub.dev/tool/alternative'}],
    }};
    const fetch = createMockFetch();
    const client = createFeedClient({baseUrl: 'https://slothhub.dev', fetchJson: async url =>
      url.endsWith('/api/tools/example-mcp.json') ? detail : fetch(url)});
    const markdown = await handleGetTool(client, {slug: 'example-mcp', response_format: ResponseFormat.MARKDOWN});
    expect(markdown.content[0].text.length).toBeLessThan(25_000);
    expect(markdown.content[0].text).toContain('limit_characters=25000, observed_characters=');
    expect(markdown.content[0].text).toContain('call fetch with the same slug as id and full_detail=true');
    expect(getToolOutputSchema.parse(markdown.structuredContent).displayLimit).toMatchObject({code: 'tool_detail_display_limit_exceeded', configuredLimit: 25_000, observedCharacters: expect.any(Number)});
    expect(markdown.structuredContent).toMatchObject({tool: {agentInterfaces: detail.data.agentInterfaces, alternativeTools: detail.data.alternativeTools, }});
    const json = await handleGetTool(client, {slug: 'example-mcp', response_format: ResponseFormat.JSON});
    expect(JSON.parse(json.content[0].text)).toEqual(json.structuredContent);
    expect(json.structuredContent).toEqual(markdown.structuredContent);
  });
});
