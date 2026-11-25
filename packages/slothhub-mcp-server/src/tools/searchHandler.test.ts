import {describe, expect, it, vi} from 'vite-plus/test'
import {AGENT_SETUP_RECIPE_CONFIG_HOST_VALUES} from '@slothhub/domain/mcp-registry';
import {AGENT_SEARCH_MAX_RESULT_LIMIT, AgentSearchPayloadLimitError, type PublicAgentSearchArticle} from '@slothhub/domain/agent-search';
import {FeedHostBlockedError} from '@slothhub/domain/public-feed-http';
import {Client, InMemoryTransport} from '@modelcontextprotocol/client'

import type {AgentSearchIndexTool} from '../types.js'
import {searchIndexFeedSchema} from '@slothhub/domain/public-feed-mcp-schemas'
import {CHARACTER_LIMIT, ResponseFormat} from '../constants.js'
import {searchToolsInputSchema} from '../schemas/inputs.js'
import {createFeedClient} from '../services/feeds.js'
import {handleSearchTools} from './handlers.js'
import type {ToolSearchOutcome} from './searchHandler.js'
import {createSlothHubMcpServer} from '../server.js'
import {searchToolsOutputSchema} from '../schemas/outputs.js'

const baseTool = {
  name: 'Complete',
  slug: 'complete',
  description: 'Workflow helper',
  pricing: 'free',
  platforms: ['web'],
  categories: [],
  tags: [],
  useCases: [],
  resourceKind: {value: 'app', label: 'App'},
  resourceIdentity: {
    kind: 'website',
    kindLabel: 'Website',
    canonicalUrl: 'https://example.com/',
    ctaLabel: 'Open website',
  },
  freshness: {},
  agentInterfaceKinds: [],
  detailUrl: 'https://slothhub.dev/tool/complete',
  visitUrl: 'https://slothhub.dev/go/complete?surface=agent',
  keyFeatures: [],
  search: {
    text: 'complete workflow helper',
    tokens: ['complete', 'workflow', 'helper'],
    fields: {
      name: 'Complete',
      description: 'Workflow helper',
      keyFeatures: [],
      platforms: ['web'],
      categories: [],
      tags: [],
      useCases: [],
      resourceKind: ['app'],
      agentInterfaceKinds: [],
    },
  },
} satisfies AgentSearchIndexTool

const feedWithTools = (tools: AgentSearchIndexTool[] = [baseTool], articles?: PublicAgentSearchArticle[], siteUrl = 'https://slothhub.dev') =>
  searchIndexFeedSchema.parse({
    version: '17.0.0',
    siteUrl,
    generatedAt: '2026-07-15T00:00:00.000Z',
    data: {
      tools,
      articles,
      filters: {
        pricing: [],
        platforms: [],
        resourceKinds: [],
        securityCapabilities: [],
        agentInterfaceKinds: [],
        setupRecipeHosts: AGENT_SETUP_RECIPE_CONFIG_HOST_VALUES.map((value) => ({value, label: value, count: 0})),
        categories: [{value: 'design', label: 'Design', count: 1}],
        tags: [{value: 'workflow', label: 'Workflow', count: 1}],
        useCases: [{value: 'automation', label: 'Automation', count: 1}],
      },
      queryContract: {},
    },
  })

const feedClient = (tools?: AgentSearchIndexTool[]) =>
  ({searchIndex: async () => feedWithTools(tools)})

describe('official registry recovery', () => {
  it('starts identifier lookup while the search index is still loading', async () => {
    const feed = feedWithTools()
    let resolveIndex!: (value: typeof feed) => void
    const pendingIndex = new Promise<typeof feed>((resolve) => {resolveIndex = resolve})
    const toolLookup = vi.fn(async () => null)
    const result = handleSearchTools({searchIndex: () => pendingIndex, toolLookup},
      searchToolsInputSchema.parse({query: 'npm_package:ajv'}))
    try {
      expect(toolLookup).toHaveBeenCalledOnce()
    } finally {
      resolveIndex(feed)
      await result
    }
  })

  it.each(['markdown', 'json'])('returns the same typed handoffs in %s on a true catalog miss', async (response_format) => {
    const client = {searchIndex: vi.fn(async () => feedWithTools())}
    const result = await handleSearchTools(client, searchToolsInputSchema.parse({query: 'unlisted-python-package', package_registry: 'pypi', response_format}))
    expect(result.isError).not.toBe(true)
    const parsed = searchToolsOutputSchema.parse(result.structuredContent)
    expect(parsed.handoffs).toEqual([{destination: 'pypi', label: 'Search PyPI', href: 'https://pypi.org/search/?q=unlisted-python-package'}])
    expect(parsed.recovery?.code).toBe('no_catalog_matches')
    expect(result.content[0]).toMatchObject({text: expect.stringContaining('https://pypi.org/search/?q=unlisted-python-package')})
    expect(client.searchIndex).toHaveBeenCalledTimes(1)
  })

  it('does not suggest registries when filters hide matching catalog tools', async () => {
    const result = await handleSearchTools(feedClient(), searchToolsInputSchema.parse({query: 'workflow', pricing: 'paid'}))
    const parsed = searchToolsOutputSchema.parse(result.structuredContent)
    expect(parsed.handoffs).toBeUndefined()
    expect(parsed.recovery?.code).toBe('filters_excluded_matches')
    expect(result.content[0]).toMatchObject({text: expect.stringContaining('Omit or change filters')})
  })

  it('does not mistake pagination past the last match for a catalog miss', async () => {
    const result = await handleSearchTools(feedClient(), searchToolsInputSchema.parse({query: 'workflow', offset: 10}))
    const parsed = searchToolsOutputSchema.parse(result.structuredContent)
    expect(parsed).toMatchObject({total: 1, count: 0})
    expect(parsed.handoffs).toBeUndefined()
    expect(parsed.recovery).toBeUndefined()
  })

  it('treats a resolved historical identifier hidden by filters as an existing catalog match', async () => {
    const client = {...feedClient([figmaSearchTool]), toolLookup: async () => toolLookupArtifact}
    const result = await handleSearchTools(client, searchToolsInputSchema.parse({
      query: 'github_repository:old-owner/old-figma', pricing: 'paid',
    }))
    const parsed = searchToolsOutputSchema.parse(result.structuredContent)
    expect(parsed.recovery?.code).toBe('filters_excluded_matches')
    expect(parsed.handoffs).toBeUndefined()
  })
})

const toolLookupArtifact = {
  version: '5.0.0' as const,
  complete: true as const,
  aliases: [],
  identityClaims: [
    {
      namespace: 'github_repository' as const,
      value: 'github_repository:old-owner/old-figma',
      disposition: 'aliased' as const,
      sourceToolId: 'tool-old-figma-repo',
      canonicalSlug: 'figma',
    },
  ],
  tools: [
    {
      slug: 'figma',
      name: 'Figma',
      detailUrl: 'https://slothhub.dev/tool/figma',
      keys: [
        {namespace: 'slug' as const, value: 'figma'},
        {namespace: 'github_repository' as const, value: 'github_repository:figma/design'},
      ],
    },
  ],
}

const figmaSearchTool: AgentSearchIndexTool = {
  ...baseTool,
  name: 'Figma',
  slug: 'figma',
  description: 'Collaborative design platform',
  detailUrl: 'https://slothhub.dev/tool/figma',
  visitUrl: 'https://slothhub.dev/go/figma?surface=agent',
  search: {
    text: 'figma collaborative design platform',
    tokens: ['figma', 'collaborative', 'design', 'platform'],
    fields: {...baseTool.search.fields, name: 'Figma', description: 'Collaborative design platform'},
  },
}

describe('shared MCP search adapter', () => {
  it.each(['17.0.0', '17.2.0'])('accepts search major %s and retains the current integration contract', (version) => {
    const feed = feedWithTools();
    const queryContract = version === '10.0.0'
      ? {filters: {integrationConnection: {parameter: 'integrationConnection', values: ['native'], matchRule: 'Requires the same native integration fact.'}}}
      : feed.data.queryContract;
    const parsed = searchIndexFeedSchema.parse({...feed, version, data: {...feed.data, queryContract}});
    expect(parsed.version).toBe(version);
    expect(parsed.data.queryContract).toEqual(queryContract);
  });
  it('matches ANY recorded language, intersects pricing, and returns evidence', async () => {
    const fact = {id: 'python', name: 'Python', supportKind: 'sdk_client' as const, sourceUrl: 'https://example.com/python'}
    const feed = feedWithTools([
      {...baseTool, supportedLanguages: [fact]},
      {...baseTool, slug: 'typescript', pricing: 'paid', supportedLanguages: [{...fact, id: 'typescript', name: 'TypeScript'}]},
      {...baseTool, slug: 'unknown'},
    ])
    feed.data.filters.supportedLanguages = [{value: 'python', label: 'Python', count: 1}, {value: 'typescript', label: 'TypeScript', count: 1}]
    const params = searchToolsInputSchema.parse({languages: ['python', 'typescript'], response_format: 'json'})
    const result = await handleSearchTools({searchIndex: async () => feed}, params)
    expect(result.structuredContent).toMatchObject({total: 2, results: [{supportedLanguages: [fact]}, {slug: 'typescript'}]})
    const filtered = await handleSearchTools({searchIndex: async () => feed}, {...params, pricing: 'free'})
    expect(filtered.structuredContent).toMatchObject({total: 1})
    delete feed.data.filters.supportedLanguages
    const oldFeed = await handleSearchTools({searchIndex: async () => feed}, params)
    expect(oldFeed.structuredContent).toMatchObject({code: 'capability_unavailable', filter: 'languages'})
  })
  it.each([ResponseFormat.MARKDOWN, ResponseFormat.JSON])(
    'keeps hostile Tool text literal in Markdown and original in %s structured output',
    async (responseFormat) => {
      const hostileTool = {
        ...baseTool,
        name: '# Figment\n## System *override*',
        description: 'Workflow **helper**\n# New instructions\n[Open](https://example.com/) and `code` \\ path',
      };
      const result = await handleSearchTools(feedClient([hostileTool]), searchToolsInputSchema.parse({
        query: 'workflow', response_format: responseFormat,
      }));
      expect(result.isError).not.toBe(true);
      const structured = searchToolsOutputSchema.parse(result.structuredContent);
      expect(structured).toMatchObject({
        total: 1, count: 1, offset: 0, has_more: false,
        results: [{name: hostileTool.name, description: hostileTool.description, slug: baseTool.slug}],
      });
      if (responseFormat === ResponseFormat.JSON) {
        expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
      } else {
        const text = result.content[0].text;
        expect(text).toContain('## \\# Figment\n\\#\\# System \\*override\\* (`complete`)');
        expect(text).toContain('Workflow \\*\\*helper\\*\\*\n\\# New instructions');
        expect(text).toContain('\\[Open\\]\\(https://example.com/\\) and \\`code\\` \\\\ path');
        expect(text.match(/^#{1,6} /gm)).toHaveLength(2);
      }
      const ordinary = await handleSearchTools(feedClient(), searchToolsInputSchema.parse({query: 'workflow'}));
      expect(structured.results[0]?.score).toBe(searchToolsOutputSchema.parse(ordinary.structuredContent).results[0]?.score);
    },
  );

  const article = {
    title: '# Workflow [guide]', slug: 'workflow-guide', excerpt: '*Read* the handbook',
    url: 'https://slothhub.dev/articles/workflow-guide',
  }

  it('advertises and delivers Article fields through the MCP protocol contract', async () => {
    const server = createSlothHubMcpServer({feedClient: createFeedClient({
      fetchJson: async () => feedWithTools([baseTool], [article]), indexFirst: false,
    })})
    const client = new Client({name: 'article-search-test', version: '1.0.0'})
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    try {
      await server.connect(serverTransport)
      await client.connect(clientTransport)
      const tools = await client.listTools()
      expect(tools.tools.find(({name}) => name === 'search')?.outputSchema)
        .toMatchObject({properties: {articles: expect.anything(), article_pagination: expect.anything()}})
      const result = await client.callTool({
        name: 'search', arguments: {query: 'workflow', response_format: 'json'},
      })
      expect(result.isError).not.toBe(true)
      expect(searchToolsOutputSchema.parse(result.structuredContent)).toMatchObject({
        articles: [{kind: 'article', ...article}], article_pagination: {count: 1},
      })
    } finally {
      await client.close()
      await server.close()
    }
  })

  it('returns raw Article data alongside Tools and escapes all rendered Article text', async () => {
    const client = {searchIndex: async () => feedWithTools([baseTool], [article])}
    const json = await handleSearchTools(client, searchToolsInputSchema.parse({
      query: 'workflow', response_format: ResponseFormat.JSON,
    }))
    expect(json.structuredContent).toMatchObject({
      count: 1, results: [{slug: 'complete'}], articles: [{kind: 'article', ...article}],
      article_pagination: {count: 1, total: 1, has_more: false, configured_limit: AGENT_SEARCH_MAX_RESULT_LIMIT},
    })
    expect(JSON.parse(json.content[0].text)).toEqual(json.structuredContent)

    const markdown = await handleSearchTools(client, searchToolsInputSchema.parse({query: 'workflow'}))
    const text = markdown.content[0].text
    expect(text.indexOf('## Articles')).toBeGreaterThan(text.indexOf('## Complete'))
    expect(text).toContain('### \\# Workflow \\[guide\\]')
    expect(text).toContain('\\*Read\\* the handbook')
    expect(text).toContain(article.url)
    expect(text).not.toContain('/go/workflow-guide')
    expect(markdown.structuredContent).toMatchObject({articles: [{title: article.title, excerpt: article.excerpt}]})
  })

  it('matches Article excerpts even when Tool-only filters exclude all Tools', async () => {
    const result = await handleSearchTools(
      {searchIndex: async () => feedWithTools([baseTool], [article])},
      searchToolsInputSchema.parse({query: 'handbook', pricing: 'paid', response_format: ResponseFormat.JSON}),
    )
    expect(result.structuredContent).toMatchObject({count: 0, articles: [{slug: article.slug}]})
  })

  it('paginates more than the configured cap of Article matches independently of Tools', async () => {
    const articles = Array.from({length: AGENT_SEARCH_MAX_RESULT_LIMIT + 1}, (_, index) => ({
      ...article, slug: `workflow-${index}`, url: `https://slothhub.dev/articles/workflow-${index}`,
    }))
    const client = {searchIndex: async () => feedWithTools([baseTool], articles)}
    const first = await handleSearchTools(client, searchToolsInputSchema.parse({
      query: 'workflow', limit: AGENT_SEARCH_MAX_RESULT_LIMIT,
    }))
    expect(first.structuredContent).toMatchObject({count: 1, article_pagination: {
      total: articles.length, count: AGENT_SEARCH_MAX_RESULT_LIMIT, has_more: true,
      next_offset: AGENT_SEARCH_MAX_RESULT_LIMIT, configured_limit: AGENT_SEARCH_MAX_RESULT_LIMIT,
    }})
    expect(first.content[0].text).toContain(`Use offset=${AGENT_SEARCH_MAX_RESULT_LIMIT}`)
    const next = await handleSearchTools(client, searchToolsInputSchema.parse({
      query: 'workflow', limit: AGENT_SEARCH_MAX_RESULT_LIMIT, offset: AGENT_SEARCH_MAX_RESULT_LIMIT,
      response_format: ResponseFormat.JSON,
    }))
    expect(next.structuredContent).toMatchObject({count: 0,
      articles: [{slug: `workflow-${AGENT_SEARCH_MAX_RESULT_LIMIT}`}],
      article_pagination: {count: 1, has_more: false},
    })
  })

  it('names the Markdown character limit while preserving full structured Article data', async () => {
    const largeArticle = {...article, excerpt: 'x'.repeat(CHARACTER_LIMIT)}
    const result = await handleSearchTools(
      {searchIndex: async () => feedWithTools([], [largeArticle])},
      searchToolsInputSchema.parse({query: 'workflow'}),
    )
    expect(result.content[0].text).toContain(`CHARACTER_LIMIT=${CHARACTER_LIMIT}`)
    expect(result.content[0].text).toContain('Read the complete structuredContent')
    expect(result.structuredContent).toMatchObject({articles: [{excerpt: largeArticle.excerpt}]})
  })

  it('keeps older indexes without Articles tools-only', async () => {
    const result = await handleSearchTools(feedClient(), searchToolsInputSchema.parse({query: 'workflow'}))
    expect(result.structuredContent).toMatchObject({count: 1, results: [{slug: 'complete'}]})
    expect(result.structuredContent).not.toHaveProperty('articles')
    expect(result.content[0].text).not.toContain('## Articles')
  })
  it.each(['cursor', 'jetbrains_ai_assistant', 'junie', 'warp', 'goose'] as const)('filters parsed ready %s facts and excludes empty or missing host arrays', async (host) => {
    const result = await handleSearchTools(feedClient([
      {...baseTool, setupRecipeHosts: [host]},
      {...baseTool, slug: 'empty-hosts', setupRecipeHosts: []},
      {...baseTool, slug: 'older-tool'},
      {...baseTool, slug: 'other-host', setupRecipeHosts: ['zed']},
    ]), searchToolsInputSchema.parse({agent_host: host, response_format: ResponseFormat.JSON}))
    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({total: 1, count: 1, results: [{slug: 'complete'}]})
  })

  it('rejects an unsupported host before reading any feed', async () => {
    const searchIndex = vi.fn(async () => feedWithTools())
    const result = await handleSearchTools({searchIndex}, searchToolsInputSchema.parse({
      agent_host: 'future-host', response_format: ResponseFormat.JSON,
    }))
    expect(result.structuredContent).toMatchObject({
      code: 'agent_search_unsupported_filter_value', filter: 'agentHost',
      recovery: `Use a supported agentHost value: ${AGENT_SETUP_RECIPE_CONFIG_HOST_VALUES.join(', ')}.`,
    })
    expect(searchIndex).not.toHaveBeenCalled()
  })

  it('keeps empty catalog search successful when the host facet is present', async () => {
    const result = await handleSearchTools(feedClient([]), searchToolsInputSchema.parse({
      agent_host: 'cursor', response_format: ResponseFormat.JSON,
    }))
    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({total: 0, count: 0, results: []})
  })

  it('rejects a requested host absent from an older feed vocabulary', async () => {
    const feed = feedWithTools()
    feed.data.filters.setupRecipeHosts = [{value: 'zed', label: 'Zed', count: 0}]
    const result = await handleSearchTools({searchIndex: async () => feed}, searchToolsInputSchema.parse({
      agent_host: ' CURSOR ', response_format: ResponseFormat.JSON,
    }))
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toMatchObject({code: 'capability_unavailable', filter: 'agentHost'})
  })

  it('rejects invalid host facts at the feed parser', () => {
    const feed = feedWithTools()
    expect(searchIndexFeedSchema.safeParse({
      ...feed, data: {...feed.data, tools: [{...baseTool, setupRecipeHosts: ['future-host']}]},
    }).success).toBe(false)
  })
  it('retains an unpriced guide through the new search feed and output schemas', async () => {
    const {pricing: _pricing, ...tool} = baseTool;
    const fetchJson = vi.fn(async () => ({
      ...feedWithTools([{...tool, resourceKind: {value: 'guide_or_website', label: 'Guide / website'}, platforms: []}]),
      version: '17.0.0',
    }));
    const client = createFeedClient({fetchJson, indexFirst: false});
    const result = await handleSearchTools(client, searchToolsInputSchema.parse({}));
    expect(result.isError).not.toBe(true);
    const output = searchToolsOutputSchema.parse(result.structuredContent);
    expect(output.results).toHaveLength(1);
    expect(output.results[0]?.pricing).toBeUndefined();
    expect(result.content[0]?.text).toContain('Pricing: Not listed');
    for (const pricing of ['free', 'freemium']) {
      const filtered = await handleSearchTools(client, searchToolsInputSchema.parse({pricing}));
      expect(filtered.structuredContent).toMatchObject({count: 0, results: []});
    }
  });

  it.each(['17.2.0', '17.2.1'])('accepts additive Search Index %s fields through the feed client', async (version) => {
    const fetchJson = vi.fn(async () => ({...feedWithTools(), version, futureField: true}));
    const result = await handleSearchTools(
      createFeedClient({fetchJson, indexFirst: false}),
      searchToolsInputSchema.parse({response_format: ResponseFormat.JSON, resource_kind: 'app'}),
    );
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({results: [expect.objectContaining({slug: 'complete'})]});
    expect(fetchJson).toHaveBeenCalledOnce();
  });

  it('accepts a 2.x Search Index without the deprecated tokens and fields projections', async () => {
    const {tokens: _tokens, fields: _fields, ...search} = baseTool.search;
    const client = {searchIndex: async () => feedWithTools([{...baseTool, search}]), toolLookup: async () => null};
    const result = await handleSearchTools(
      client,
      searchToolsInputSchema.parse({query: 'workflow', response_format: ResponseFormat.JSON}),
    );

    expect(result.isError).not.toBe(true);
    const structured = JSON.parse(result.content[0]!.text);
    expect(structured.results).toEqual([expect.objectContaining({slug: 'complete'})]);
  });

  it('pins a resolved registry identifier ahead of ordinary search ranking', async () => {
    const toolLookup = vi.fn(async () => toolLookupArtifact);
    const client = {
      searchIndex: async () => feedWithTools([figmaSearchTool]),
      toolLookup,
    };
    const result = await handleSearchTools(
      client,
      searchToolsInputSchema.parse({query: 'old-owner/old-figma', response_format: ResponseFormat.JSON}),
    );

    expect(result.isError).not.toBe(true);
    const structured = JSON.parse(result.content[0]!.text);
    expect(structured.results).toEqual([expect.objectContaining({slug: 'figma'})]);
    expect(toolLookup).toHaveBeenCalledOnce();
  });

  it('does not fetch the lookup artifact for ordinary search queries', async () => {
    const toolLookup = vi.fn(async () => toolLookupArtifact);
    const client = {searchIndex: async () => feedWithTools(), toolLookup};
    const result = await handleSearchTools(
      client,
      searchToolsInputSchema.parse({query: 'workflow', response_format: ResponseFormat.JSON}),
    );

    expect(result.isError).not.toBe(true);
    expect(toolLookup).not.toHaveBeenCalled();
  });

  it('uses a refreshed lookup artifact after a historical identity is retired', async () => {
    const params = searchToolsInputSchema.parse({query: 'old-owner/old-figma', response_format: ResponseFormat.JSON});
    const retired = {
      ...toolLookupArtifact,
      identityClaims: [{
        namespace: 'github_repository' as const,
        value: 'github_repository:old-owner/old-figma',
        disposition: 'retired' as const,
        sourceToolId: 'tool-old-figma-repo',
      }],
    };
    const toolLookup = vi.fn().mockResolvedValueOnce(toolLookupArtifact).mockResolvedValueOnce(toolLookupArtifact).mockResolvedValue(retired);
    const client = {searchIndex: async () => feedWithTools([figmaSearchTool]), toolLookup};
    for (let read = 0; read < 2; read += 1) {
      const result = await handleSearchTools(client, params);
      expect(searchToolsOutputSchema.parse(result.structuredContent).results.map(({slug}) => slug)).toEqual(['figma']);
    }
    const result = await handleSearchTools(client, params);
    expect(result.isError).not.toBe(true);
    expect(searchToolsOutputSchema.parse(result.structuredContent).results).toEqual([]);
  });

  it('falls through to normal ranking when the catalog has no lookup feed', async () => {
    const client = {searchIndex: async () => feedWithTools([figmaSearchTool]), toolLookup: async () => null};
    const result = await handleSearchTools(
      client,
      searchToolsInputSchema.parse({query: 'old-owner/old-figma', response_format: ResponseFormat.JSON}),
    );

    expect(result.isError).not.toBe(true);
    const structured = JSON.parse(result.content[0]!.text);
    expect(structured.results).toEqual([]);
  });

  it('tells agents when the site host blocked the feed request, with a recovery that is not a network fix', async () => {
    const result = await handleSearchTools(
      createFeedClient({fetchJson: async () => { throw new FeedHostBlockedError(403, 'challenge') }}),
      searchToolsInputSchema.parse({query: 'postgres', response_format: ResponseFormat.JSON}),
    );
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({code: 'feed_host_blocked', httpStatus: 403, mitigation: 'challenge',
      suggestion: expect.stringContaining('fewer parallel sessions')});
  });

  it('still requires a query contract in an additive Search Index release', async () => {
    const feed = feedWithTools();
    const {queryContract: _queryContract, ...data} = feed.data;
    const result = await handleSearchTools(
      createFeedClient({fetchJson: async () => ({...feed, version: '17.2.0', data}), indexFirst: false}),
      searchToolsInputSchema.parse({response_format: ResponseFormat.JSON}),
    );
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({code: 'feed_load_error'});
  });

  it('propagates cancellation instead of returning a feed error payload', async () => {
    const controller = new AbortController()
    const reason = new Error('request cancelled')
    controller.abort(reason)

    await expect(handleSearchTools(
      {searchIndex: async () => feedWithTools()},
      searchToolsInputSchema.parse({response_format: ResponseFormat.JSON}),
      controller.signal,
    )).rejects.toBe(reason)
  })

  it.each(['1.9.9', '2.01.0', '2.1.00', '99.0.0', '2.not-semver', '2.2.0\u001b[31m'])('rejects unsupported search-index version %s', (version) => {
    expect(searchIndexFeedSchema.safeParse({...feedWithTools(), version}).success).toBe(false)
  })

  it('rejects duplicate Tool slugs at the Search Index boundary', () => {
    const feed = feedWithTools()
    expect(searchIndexFeedSchema.safeParse({
      ...feed,
      data: {...feed.data, tools: [baseTool, baseTool]},
    }).success).toBe(false)
  })

  it.each([
    [{query: '\ud83e\udda5'.repeat(201)}, 'agent_search_query_too_long'],
    [{limit: 50.5}, 'agent_search_result_limit_out_of_range'],
    [{pricing: 'future'}, 'agent_search_unsupported_filter_value'],
    [{last_checked_after: '2026-02-30'}, 'agent_search_invalid_filter_value'],
    [{category: '///'}, 'agent_search_invalid_filter_value'],
    [{destination_health: null}, 'agent_search_invalid_filter_value'],
    [{verified: null}, 'agent_search_invalid_filter_value'],
    [{last_checked_after: null}, 'agent_search_invalid_filter_value'],
  ] as const)('rejects request-only MCP input before feed I/O %#', async (input, code) => {
    const searchIndex = vi.fn(async () => {
      throw new Error('feed must not be read')
    })
    const result = await handleSearchTools(
      {searchIndex},
      searchToolsInputSchema.parse({...input, response_format: ResponseFormat.JSON}),
    )

    expect(result.structuredContent).toMatchObject({code})
    expect(searchIndex).not.toHaveBeenCalled()
  })

  it('preserves streamed payload limit errors through the real feed client and handler', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(3))
        controller.enqueue(new Uint8Array(3))
        controller.close()
      },
    }))))
    try {
      const client = createFeedClient({
        baseUrl: 'https://slothhub.dev',
        indexFirst: false,
        maxResponseBytes: 4,
      })
      const result = await handleSearchTools(
        client,
        searchToolsInputSchema.parse({response_format: ResponseFormat.JSON}),
      )

      expect(result.structuredContent).toMatchObject({
        code: 'feed_payload_too_large',
        configuredLimitBytes: 4,
        observedBytes: 6,
        recovery: expect.stringContaining('smaller public feed'),
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('preserves missing Agent Interface capability metadata when parsing an older feed', () => {
    const {agentInterfaceKinds: _ignoredKinds, ...oldTool} = baseTool
    const parsed = searchIndexFeedSchema.parse({
      version: '17.0.0',
      siteUrl: 'https://slothhub.dev',
      generatedAt: '2026-07-15T00:00:00.000Z',
      data: {
        tools: [oldTool],
        filters: {
          pricing: [],
          platforms: [],
          resourceKinds: [],
          categories: [],
          tags: [],
          useCases: [],
        },
        queryContract: {},
      },
    })

    expect(parsed.data.filters.agentInterfaceKinds).toBeUndefined()
    expect(parsed.data.tools[0]?.agentInterfaceKinds).toBeUndefined()
  })

  it('preserves the shared search error code and details in MCP structured output', async () => {
    const feed = searchIndexFeedSchema.parse({
      version: '17.0.0',
      siteUrl: 'https://slothhub.dev',
      generatedAt: '2026-07-15T00:00:00.000Z',
      data: {
        tools: [baseTool],
        filters: {
          pricing: [],
          platforms: [],
          resourceKinds: [],
          agentInterfaceKinds: [],
          categories: [{value: 'design', label: 'Design', count: 1}],
          tags: [],
          useCases: [],
        },
        queryContract: {},
      },
    })
    const client = {searchIndex: async () => feed}
    const result = await handleSearchTools(
      client,
      searchToolsInputSchema.parse({
        category: 'retired-category',
        response_format: ResponseFormat.JSON,
      }),
    )

    expect(result.isError).toBe(true)
    expect(result.structuredContent).toMatchObject({
      code: 'agent_search_unsupported_filter_value',
      filter: 'category',
      observedValue: 'retired-category',
      suggestion: expect.stringContaining('supported category value'),
    })
  })

  it('validates static filters before reporting an unavailable feed capability', async () => {
    const feed = feedWithTools()
    delete feed.data.filters.securityCapabilities
    const result = await handleSearchTools(
      {searchIndex: async () => feed},
      searchToolsInputSchema.parse({
        security_capability: 'future_capability',
        response_format: ResponseFormat.JSON,
      }),
    )

    expect(result.structuredContent).toMatchObject({
      code: 'agent_search_unsupported_filter_value',
      filter: 'securityCapability',
    })
  })

  it.each([
    ['securityCapabilities', 'security_capability', 'sso_saml'],
    ['agentInterfaceKinds', 'agent_interface_kind', 'mcp_server'],
    ['integrations', 'integration', 'slack'],
    ['integrations', 'integration_connection', 'native'],
    ['setupRecipeHosts', 'agent_host', 'cursor'],
  ] as const)(
    'returns matching suggestion and recovery for an unavailable %s facet',
    async (facet, inputName, value) => {
      const feed = feedWithTools()
      delete feed.data.filters[facet]
      const result = await handleSearchTools(
        {searchIndex: async () => feed},
        searchToolsInputSchema.parse({
          [inputName]: value,
          response_format: ResponseFormat.JSON,
        }),
      )

      expect(result.structuredContent).toMatchObject({
        code: 'capability_unavailable',
        suggestion: expect.any(String),
        recovery: expect.any(String),
      })
      const structured = JSON.parse(result.content[0]!.text)
      expect(structured.recovery).toBe(structured.suggestion)
    },
  )

  it('applies integration and integration_connection over published feed facts', async () => {
    const nativeTool: AgentSearchIndexTool = {
      ...baseTool,
      slug: 'native-tool',
      integrations: [{slug: 'slack', name: 'Slack', status: 'native', checkedAt: '2026-07-01T00:00:00.000Z', sourceUrl: 'https://example.com/integrations/slack'}],
    }
    const apiTool: AgentSearchIndexTool = {
      ...baseTool,
      slug: 'api-tool',
      integrations: [{slug: 'slack', name: 'Slack', status: 'api', checkedAt: '2026-07-01T00:00:00.000Z', sourceUrl: 'https://example.com/integrations/slack'}],
    }
    const feed = feedWithTools([nativeTool, apiTool])
    feed.data.filters.integrations = [{value: 'slack', label: 'Slack', count: 2}]

    const broad = await handleSearchTools(
      {searchIndex: async () => feed},
      searchToolsInputSchema.parse({
        integration: 'slack',
        response_format: ResponseFormat.JSON,
      }),
    )
    expect(broad.structuredContent).toMatchObject({
      results: [{slug: 'native-tool'}, {slug: 'api-tool'}],
    })

    const native = await handleSearchTools(
      {searchIndex: async () => feed},
      searchToolsInputSchema.parse({
        integration: 'slack',
        integration_connection: 'native',
        response_format: ResponseFormat.JSON,
      }),
    )
    expect(native.structuredContent).toMatchObject({
      results: [{slug: 'native-tool'}],
    })
  })

  it('names MCP query and result limit failures with configured, observed, and recovery details', () => {
    expect(searchToolsInputSchema.safeParse({query: '\ud83e\udda5'.repeat(200)}).success).toBe(true)
    expect(searchToolsInputSchema.safeParse({query: '\ud83e\udda5'.repeat(201)}).success).toBe(true)
    expect(searchToolsInputSchema.safeParse({limit: 50.5}).success).toBe(true)
    expect(searchToolsInputSchema.safeParse({pricing: 'future'}).success).toBe(true)
    expect(searchToolsInputSchema.safeParse({destination_health: 'broken'}).success).toBe(true)
  })

  it.each([
    [
      {query: '\ud83e\udda5'.repeat(201)},
      {code: 'agent_search_query_too_long', filter: 'query', configuredLimit: 200, observedValue: 201},
    ],
    [
      {limit: 50.5},
      {code: 'agent_search_result_limit_out_of_range', filter: 'limit', configuredLimit: 50, observedValue: 50.5},
    ],
    [
      {pricing: 'future'},
      {code: 'agent_search_unsupported_filter_value', filter: 'pricing', observedValue: 'future'},
    ],
    [
      {category: '///'},
      {code: 'agent_search_invalid_filter_value', filter: 'category', observedValue: '///'},
    ],
    [
      {destination_health: 'broken', last_checked_after: '2026-08-08'},
      {code: 'agent_search_invalid_filter_value', filter: 'destinationHealth', observedValue: 'broken'},
    ],
  ] as const)('returns shared structured validation for MCP input %#', async (input, expected) => {
    const result = await handleSearchTools(feedClient(), searchToolsInputSchema.parse({
      ...input,
      limit: 'limit' in input ? input.limit : 20,
      offset: 0,
      response_format: ResponseFormat.JSON,
    }))

    expect(result.isError).toBe(true)
    expect(result.structuredContent).toMatchObject(expected)
    const structured = JSON.parse(result.content[0]!.text)
    expect(structured.recovery).toEqual(expect.any(String))
  })

  it('accepts exactly 200 astral query code points through the MCP handler', async () => {
    const result = await handleSearchTools(feedClient(), searchToolsInputSchema.parse({
      query: '\ud83e\udda5'.repeat(200),
      response_format: ResponseFormat.JSON,
    }))

    expect(result.isError).toBeUndefined()
  })

  it('keeps agentInterfaceKinds required in MCP results when an older Tool row omits it', async () => {
    const {agentInterfaceKinds: _ignored, ...olderTool} = baseTool
    const result = await handleSearchTools(
      feedClient([olderTool]),
      searchToolsInputSchema.parse({response_format: ResponseFormat.JSON}),
    )

    expect(result.isError).toBeUndefined()
    const structured = JSON.parse(result.content[0]!.text)
    expect(structured.results).toEqual([
      expect.objectContaining({agentInterfaceKinds: []}),
    ])
  })

  it('adapts typed feed payload overflow into a top-level MCP structured limit error', async () => {
    const client = {
      searchIndex: async () => {
        throw new AgentSearchPayloadLimitError(1024, 1025)
      },
    }
    const result = await handleSearchTools(
      client,
      searchToolsInputSchema.parse({response_format: ResponseFormat.JSON}),
    )

    expect(result.isError).toBe(true)
    expect(result.structuredContent).toMatchObject({
      code: 'feed_payload_too_large',
      configuredLimitBytes: 1024,
      observedBytes: 1025,
      recovery: expect.stringContaining('smaller public feed'),
      suggestion: expect.stringContaining('smaller public feed'),
    })
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({
      code: 'feed_payload_too_large',
    })
  })
})

it('searches a parsed localhost feed without fetching article pages', async () => {
  const article = {title: 'Workflow guide', slug: 'workflow-guide', url: 'http://localhost:4321/articles/workflow-guide'};
  const fetchJson = vi.fn(async () => feedWithTools([baseTool], [article], 'http://localhost:4321'));
  const client = createFeedClient({baseUrl: 'http://localhost:4321', fetchJson, indexFirst: false});
  const result = await handleSearchTools(client, searchToolsInputSchema.parse({query: 'workflow'}));
  expect(result.isError).not.toBe(true);
  expect(searchToolsOutputSchema.parse(result.structuredContent)).toMatchObject({count: 1, articles: [{...article, kind: 'article'}]});
  expect(fetchJson).toHaveBeenCalledOnce();
  expect(fetchJson.mock.calls[0]).toEqual(expect.arrayContaining(['http://localhost:4321/api/search-index.json']));
});

it.each(['javascript:alert(1)', 'data:text/plain,hello', 'https://user:secret@example.com/articles/guide'])(
  'rejects unsafe article URL %s at the feed boundary', (url) => {
    expect(() => feedWithTools([baseTool], [{title: 'Guide', slug: 'guide', url}])).toThrow('http(s) URL');
  },
);

it.each([
  ['https://slothhub.dev', 'http://127.0.0.1:3000/admin'],
  ['https://slothhub.dev', 'https://10.0.0.1/private'],
  ['http://localhost:4321', 'http://localhost:3000/admin'],
  ['http://localhost:4321', 'http://10.0.0.1/private'],
])('rejects article URL outside the public or local feed origin (%s, %s)', (siteUrl, url) => {
  const feed = feedWithTools();
  const result = searchIndexFeedSchema.safeParse({...feed, siteUrl, data: {...feed.data, articles: [{title: 'Guide', slug: 'guide', url}]}});
  expect(result.success).toBe(false);
  if (!result.success) expect(result.error.issues).toEqual(expect.arrayContaining([expect.objectContaining({path: ['data', 'articles', 0, 'url']})]));
});

describe('hosted search demand', () => {
  const report = async (params: Record<string, string | number>, articles?: PublicAgentSearchArticle[]) => {
    const {handleConnectorSearch, reportSearchWithoutResults} = await import('./connectorRetrieval.js')
    const hook = vi.fn(async () => undefined)
    let outcome: ToolSearchOutcome | undefined
    const client = {searchIndex: async () => feedWithTools([baseTool], articles), toolLookup: async () => null}
    await handleConnectorSearch(client, searchToolsInputSchema.parse(params), undefined, (observed) => { outcome = observed })
    await reportSearchWithoutResults(outcome, hook)
    return hook
  }

  it('records a text search that found nothing in the catalog', async () => {
    expect(await report({query: 'unlisted rust http client'})).toHaveBeenCalledWith('unlisted rust http client')
  })

  it('still records missing Tools when an Article matches the same words', async () => {
    const article = {title: 'Choosing a rust http client', slug: 'rust-http-clients', excerpt: 'A guide.', url: 'https://slothhub.dev/articles/rust-http-clients'}
    expect(await report({query: 'rust http client'}, [article])).toHaveBeenCalledWith('rust http client')
  })

  it.each([
    ['a search with matches', {query: 'workflow'}],
    ['matches hidden by filters', {query: 'workflow', pricing: 'paid'}],
    ['pagination past the last match', {query: 'workflow', offset: 10}],
  ])('ignores %s', async (_label, params) => {
    expect(await report(params)).not.toHaveBeenCalled()
  })
})
