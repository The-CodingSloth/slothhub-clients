import {describe, expect, it, vi} from 'vite-plus/test'
import {AGENT_SEARCH_MAX_RESULT_LIMIT} from '@slothhub/domain/agent-search'

import {indexFeed, searchIndexFeed} from './fixtures.js'
import {runRecommendCommand, runSearchCommand} from './agentSearchCli.js'
import {runCli} from './cli.js'
import type {FetchJson} from './feedClient.js'

const request = {
  filters: {},
  json: true,
  query: 'design',
}

describe('agent search CLI adapter', () => {
  it.each(['npm_package:ajv', 'registry.example.com:5000/image', 'docker.gitea.com/gitea'])('starts identifier lookup while the search index is still loading: %s', async (query) => {
    let resolveIndex!: (feed: typeof searchIndexFeed) => void
    const pendingIndex = new Promise<typeof searchIndexFeed>((resolve) => {resolveIndex = resolve})
    const toolLookup = vi.fn(async () => null)
    const result = runSearchCommand({searchIndex: () => pendingIndex, toolLookup}, {
      ...request, query,
    })
    try {
      expect(toolLookup).toHaveBeenCalledOnce()
    } finally {
      resolveIndex(searchIndexFeed)
      await result
    }
  })

  it('parses the registry flag, advertises it, and only loads SlothHub feeds', async () => {
    const fetchJson: FetchJson = vi.fn(async (url) => {
      const parsed = new URL(url)
      expect(parsed.hostname).toBe(new URL(indexFeed.siteUrl).hostname)
      if (parsed.pathname === '/api/index.json') return indexFeed
      if (parsed.pathname === '/api/search-index.json') return searchIndexFeed
      throw new Error(`Unexpected request: ${url}`)
    })
    const result = await runCli(['search', 'unlisted-package', '--package-registry', 'pypi', '--json', '--no-cache', '--base-url', indexFeed.siteUrl], {fetchJson})
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout).handoffs[0].destination).toBe('pypi')
    expect((await runCli(['search', '--help'], {fetchJson})).stdout).toContain('--package-registry')
    expect((await runCli(['completion', 'bash'], {fetchJson})).stdout).toContain('--package-registry')
    const invalid = await runCli(['search', 'x', '--package-registry', 'evil', '--json'], {fetchJson})
    expect(invalid.exitCode).toBe(2)
    expect(JSON.parse(invalid.stdout)).toMatchObject({ok: false, code: 'agent_search_unsupported_filter_value', filter: 'packageRegistry'})
  })
  it.each([true, false])('prints official registry handoffs on a true miss (json=%s) without registry requests', async (json) => {
    const searchIndex = vi.fn(async () => searchIndexFeed)
    const result = await runSearchCommand({searchIndex}, {query: 'unlisted-python-package', json, filters: {packageRegistry: 'pypi'}})
    expect(result.exitCode).toBe(0)
    if (json) {
      expect(JSON.parse(result.stdout)).toMatchObject({count: 0, handoffs: [{destination: 'pypi', label: 'Search PyPI', href: 'https://pypi.org/search/?q=unlisted-python-package'}]})
    } else {
      expect(result.stdout).toContain('No SlothHub catalog matches')
      expect(result.stdout).toContain('Search PyPI: https://pypi.org/search/?q=unlisted-python-package')
    }
    expect(searchIndex).toHaveBeenCalledTimes(1)
  })

  it('returns filter recovery without external handoffs for an existing query', async () => {
    const result = await runSearchCommand({searchIndex: async () => searchIndexFeed}, {...request, filters: {packageRegistry: 'pypi'}})
    expect(JSON.parse(result.stdout)).toMatchObject({count: 0, recovery: {code: 'filters_excluded_matches'}})
    expect(JSON.parse(result.stdout).handoffs).toBeUndefined()
  })
  it('parses repeatable language flags and keeps evidence in search results', async () => {
    const feed = structuredClone(searchIndexFeed)
    feed.data.filters.supportedLanguages = [{value: 'python', label: 'Python', count: 1}]
    feed.data.tools[0].supportedLanguages = [{id: 'python', name: 'Python', supportKind: 'sdk_client', sourceUrl: 'https://example.com/python'}]
    const result = await runCli(['search', '--language', 'python', '--language', 'typescript', '--json', '--no-cache'], {
      fetchJson: async (url) => url.endsWith('/api/index.json') ? indexFeed : feed,
    })
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({count: 1, results: [{supportedLanguages: feed.data.tools[0].supportedLanguages}]})
    await expect(runSearchCommand({searchIndex: async () => searchIndexFeed}, {...request, filters: {languages: ['python']}})).rejects.toMatchObject({code: 'capability_unavailable', recovery: expect.stringContaining('--language')})
  })

  it.each(['nope', '-1', '1.5'])('reports offset %s as a usage error before fetching', async (offset) => {
    const fetchJson = vi.fn(async () => searchIndexFeed)
    const result = await runCli(['search', 'design', '--offset', offset, '--json'], {fetchJson})
    expect(result.exitCode).toBe(2)
    expect(JSON.parse(result.stdout)).toMatchObject({code: 'invalid_input', recovery: expect.stringContaining('--offset')})
    expect(fetchJson).not.toHaveBeenCalled()
  })
  const article = {
    title: 'Design systems', slug: 'design-systems',
    excerpt: 'How teams choose tools', url: 'https://slothhub.dev/articles/design-systems',
  }

  it('returns Articles beside Tool results and prints them after Tools', async () => {
    const client = {searchIndex: async () => ({
      ...searchIndexFeed, data: {...searchIndexFeed.data, articles: [article]},
    })}
    const json = await runSearchCommand(client, request)
    expect(JSON.parse(json.stdout)).toMatchObject({
      count: 1, results: [{slug: 'figma'}],
      articles: [{kind: 'article', ...article}],
      article_pagination: {total: 1, count: 1, has_more: false, configured_limit: AGENT_SEARCH_MAX_RESULT_LIMIT},
    })
    const text = await runSearchCommand(client, {...request, json: false})
    expect(text.stdout.indexOf('Articles')).toBeGreaterThan(text.stdout.indexOf('Figma'))
    expect(text.stdout).toContain(article.url)
    expect(text.stdout).toContain(article.excerpt)
    expect(text.stdout).not.toContain('/go/design-systems')
  })

  it('matches excerpts independently of Tool facets', async () => {
    const result = await runSearchCommand({searchIndex: async () => ({
      ...searchIndexFeed, data: {...searchIndexFeed.data, articles: [article]},
    })}, {...request, query: 'teams', filters: {pricing: 'free'}})
    expect(JSON.parse(result.stdout)).toMatchObject({count: 0, articles: [{slug: article.slug}]})
    expect(JSON.parse(result.stdout).handoffs).toBeUndefined()
    expect(JSON.parse(result.stdout).recovery).toBeUndefined()
  })

  it('pages Articles independently at the existing search cap', async () => {
    const articles = Array.from({length: AGENT_SEARCH_MAX_RESULT_LIMIT + 1}, (_, index) => ({
      ...article, slug: `design-${index}`, url: `https://slothhub.dev/articles/design-${index}`,
    }))
    const client = {searchIndex: async () => ({...searchIndexFeed, data: {...searchIndexFeed.data, articles}})}
    const first = JSON.parse((await runSearchCommand(client, request)).stdout)
    expect(first.articles).toHaveLength(AGENT_SEARCH_MAX_RESULT_LIMIT)
    expect(first.article_pagination).toMatchObject({
      count: AGENT_SEARCH_MAX_RESULT_LIMIT, total: articles.length, has_more: true,
      next_offset: AGENT_SEARCH_MAX_RESULT_LIMIT, configured_limit: AGENT_SEARCH_MAX_RESULT_LIMIT,
    })
    const next = JSON.parse((await runSearchCommand(client, {...request, offset: AGENT_SEARCH_MAX_RESULT_LIMIT})).stdout)
    expect(next.articles).toEqual([expect.objectContaining({slug: `design-${AGENT_SEARCH_MAX_RESULT_LIMIT}`})])
    expect(next.article_pagination.has_more).toBe(false)
    const text = await runSearchCommand(client, {...request, json: false, limit: 1})
    expect(text.stdout).toContain(`configured_limit=${AGENT_SEARCH_MAX_RESULT_LIMIT}`)
    expect(text.stdout).toContain('Use --offset 1')
  })

  it('wires --limit and --offset through the public command without fetching Articles', async () => {
    const result = await runCli(['search', 'design', '--limit', '1', '--offset', '1', '--json', '--no-cache'], {
      fetchJson: async (url) => {
        const path = new URL(url).pathname
        if (path === '/api/index.json') return indexFeed
        if (path === '/api/search-index.json') return {
          ...searchIndexFeed,
          data: {...searchIndexFeed.data, articles: [article, {...article, slug: 'second', url: 'https://slothhub.dev/articles/second'}]},
        }
        throw new Error(`Unexpected request: ${path}`)
      },
    })
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      articles: [{slug: 'second'}], article_pagination: {offset: 1, count: 1, has_more: false},
    })
  })

  it('renders deterministic domain search results as CLI JSON', async () => {
    const result = await runSearchCommand(
      {searchIndex: async () => searchIndexFeed},
      request,
    )

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).not.toHaveProperty('articles')
    expect(JSON.parse(result.stdout)).toMatchObject({
      query: 'design',
      count: 1,
      results: [{
        slug: 'figma',
        score: expect.any(Number),
        resourceKind: {value: 'app', label: 'App'},
        agentInterfaceKinds: ['mcp_server'],
      }],
    })
  })

  it.each([
    ['securityCapabilities', 'securityCapability', 'sso_saml'],
    ['agentInterfaceKinds', 'agentInterfaceKind', 'mcp_server'],
    ['integrations', 'integration', 'github'],
    ['integrations', 'integrationConnection', 'native'],
  ] as const)('surfaces a missing %s feed capability as a domain contract error', async (
    facet,
    filter,
    value,
  ) => {
    const feed = structuredClone(searchIndexFeed)
    delete feed.data.filters[facet]

    await expect(runSearchCommand(
      {searchIndex: async () => feed},
      {...request, filters: {[filter]: value}},
    )).rejects.toMatchObject({
      code: 'capability_unavailable',
      filter,
      observedValue: value,
    })
  })

  it('applies integration and native connection filters over feed facts', async () => {
    const feed = structuredClone(searchIndexFeed)
    feed.data.filters.integrations = [{value: 'github', label: 'GitHub', count: 2}]

    const broad = await runSearchCommand(
      {searchIndex: async () => feed},
      {...request, query: '', filters: {integration: 'github'}},
    )
    expect(JSON.parse(broad.stdout)).toMatchObject({
      count: 2,
      results: [{slug: 'figma'}, {slug: 'linear'}],
    })

    const native = await runSearchCommand(
      {searchIndex: async () => feed},
      {...request, query: '', filters: {integration: 'github', integrationConnection: 'native'}},
    )
    expect(JSON.parse(native.stdout)).toMatchObject({
      count: 1,
      results: [{slug: 'figma'}],
    })
  })

  it('uses the same capability-aware search path for recommendations', async () => {
    const feed = structuredClone(searchIndexFeed)
    delete feed.data.filters.securityCapabilities

    await expect(runRecommendCommand(
      {searchIndex: async () => feed},
      {...request, filters: {securityCapability: 'sso_saml'}},
    )).rejects.toMatchObject({code: 'capability_unavailable'})
  })
})
