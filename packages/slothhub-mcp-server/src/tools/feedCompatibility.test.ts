import {afterEach, beforeEach, describe, expect, it, vi} from 'vite-plus/test';
import {ResponseFormat} from '../constants.js';
import {createFeedClient} from '../services/feeds.js';
import {handleDoctor, handleSearchTools} from './handlers.js';
import {doctorInputSchema, searchToolsInputSchema} from '../schemas/inputs.js';

describe('MCP feed compatibility', () => {
  it.each([ResponseFormat.JSON, ResponseFormat.MARKDOWN])('gives direct recovery for ordinary doctor failures (%s)', async (response_format) => {
    const fetchJson = vi.fn(async () => {throw new Error('HTTP 503 Service Unavailable');});
    const result = await handleDoctor(createFeedClient({fetchJson}), doctorInputSchema.parse({response_format}), 'https://slothhub.dev');
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({code: 'feed_load_error', suggestion: 'Check network access and SLOTHHUB_BASE_URL.'});
    expect(result.content[0]?.text).not.toContain('Try slothhub_check_status');
    expect(fetchJson).toHaveBeenCalledOnce();
  });

  it.each([['0.9.0', true], ['1.9.0', false]] as const)('directs older feed %s to catalog repair', async (version, indexFirst) => {
    const fetchJson = vi.fn(async () => ({version}));
    const result = await handleSearchTools(createFeedClient({fetchJson, indexFirst}), searchToolsInputSchema.parse({response_format: ResponseFormat.JSON}));
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({code: 'unsupported_version', recovery: expect.stringContaining('npm install -g')});
    expect(result.content[0]?.text).toContain('npm install');
    expect(result.content[0]?.text).toContain('npm install');
    expect(fetchJson).toHaveBeenCalledOnce();
  });

  it('keeps upgrade guidance when doctor diagnoses a future index', async () => {
    const fetchJson = vi.fn(async () => ({version: '99.0.0'}));
    const result = await handleDoctor(
      createFeedClient({fetchJson}),
      doctorInputSchema.parse({response_format: ResponseFormat.JSON}),
      'https://slothhub.dev',
    );
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: 'unsupported_version', supportedVersion: '33.x', observedVersion: '99.0.0',
      recovery: expect.stringContaining('npm install -g slothhub-mcp-server@latest'),
    });
    expect(fetchJson).toHaveBeenCalledOnce();
  });

  it.each([ResponseFormat.JSON, ResponseFormat.MARKDOWN])('returns an actionable tool failure for a future index (%s)', async (response_format) => {
    const fetchJson = vi.fn(async () => ({version: '99.0.0'}));
    const client = createFeedClient({fetchJson});
    const result = await handleSearchTools(client, searchToolsInputSchema.parse({response_format}));
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: 'unsupported_version',
      supportedVersion: '33.x',
      observedVersion: '99.0.0',
      recovery: expect.stringContaining('npm install -g slothhub-mcp-server@latest'),
    });
    expect(result.content[0]?.text).toContain('99.0.0');
    expect(result.content[0]?.text).not.toContain('feed shape');
    expect(fetchJson).toHaveBeenCalledOnce();
  });

  it('checks Search Index major independently and evicts rejected requests', async () => {
    const fetchJson = vi.fn(async () => ({version: '99.0.0'}));
    const client = createFeedClient({fetchJson, indexFirst: false});
    await expect(client.searchIndex()).rejects.toMatchObject({code: 'unsupported_version', supportedVersion: '17.x'});
    await expect(client.searchIndex()).rejects.toMatchObject({code: 'unsupported_version'});
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });
});

describe('network environment diagnostics', () => {
  // Each case declares its own proxy/CA setup instead of inheriting the shell's.
  beforeEach(() => {
    for (const name of [
      'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy',
      'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy',
      'NODE_USE_ENV_PROXY', 'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS',
    ]) vi.stubEnv(name, undefined);
  });

  const indexFeed = {
    version: '33.0.0',
    siteUrl: 'https://slothhub.dev',
    generatedAt: '2026-07-15T00:00:00.000Z',
    schemaUrl: 'https://slothhub.dev/api/schema.json',
    snapshots: {
      full: 'https://slothhub.dev/api/catalog.snapshot.json',
      ndjson: 'https://slothhub.dev/api/catalog.ndjson',
    },
    feeds: {
      tools: 'https://slothhub.dev/api/tools.json',
      toolLookup: 'https://slothhub.dev/api/tool-lookup.json',
      searchIndex: 'https://slothhub.dev/api/search-index.json',
      categories: 'https://slothhub.dev/api/categories.json',
      tags: 'https://slothhub.dev/api/tags.json',
      useCases: 'https://slothhub.dev/api/use-cases.json',
      stacks: 'https://slothhub.dev/api/stacks.json',
      best: 'https://slothhub.dev/api/best.json',
    },
    markdownArtifacts: {
      agentInterfaces: 'https://slothhub.dev/interfaces.md',
    },
    integrationHubUrl: 'https://slothhub.dev/agents',
    markdownHubUrl: 'https://slothhub.dev/agents.md',
    toolDetailUrlTemplate: 'https://slothhub.dev/tool/{slug}',
    citationGuidance: ['Cite canonical pages', 'Do not cite /go/ visit URLs'],
  };

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([ResponseFormat.JSON, ResponseFormat.MARKDOWN])(
    'hints proxy_env_not_enabled when proxy env is set but ignored (%s)',
    async (response_format) => {
      vi.stubEnv('HTTPS_PROXY', 'http://user:pass@proxy.corp:8080');
      vi.stubEnv('NODE_USE_ENV_PROXY', undefined);
      const fetchJson = vi.fn(async () => {
        throw new TypeError('fetch failed', {cause: {code: 'ENOTFOUND'}});
      });

      const result = await handleDoctor(
        createFeedClient({fetchJson}),
        doctorInputSchema.parse({response_format}),
        'https://slothhub.dev',
      );

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        code: 'feed_load_error',
        hint: {code: 'proxy_env_not_enabled', variables: ['NODE_USE_ENV_PROXY']},
      });
      const serialized = JSON.stringify(result.structuredContent) + result.content[0]?.text;
      expect(serialized).not.toContain('proxy.corp');
      expect(serialized).not.toContain('user:pass');
      expect(serialized).toContain('NODE_USE_ENV_PROXY=1');
    },
  );

  it('adds no hint when NODE_USE_ENV_PROXY already enables proxy support', async () => {
    vi.stubEnv('HTTPS_PROXY', 'http://proxy.corp:8080');
    vi.stubEnv('NODE_USE_ENV_PROXY', '1');
    const fetchJson = vi.fn(async () => {
      throw new TypeError('fetch failed', {cause: {code: 'ENOTFOUND'}});
    });

    const result = await handleDoctor(
      createFeedClient({fetchJson}),
      doctorInputSchema.parse({response_format: ResponseFormat.JSON}),
      'https://slothhub.dev',
    );

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.structuredContent)).not.toContain('proxy_env_not_enabled');
  });

  it('redacts a malformed proxy URL echoed by the transport error', async () => {
    const malformed = 'ht!tp://bad proxy host%%';
    vi.stubEnv('HTTPS_PROXY', malformed);
    vi.stubEnv('NODE_USE_ENV_PROXY', '1');
    const fetchJson = vi.fn(async () => {
      throw new TypeError('fetch failed: "' + malformed + '" is not a valid URL');
    });

    const result = await handleDoctor(
      createFeedClient({fetchJson}),
      doctorInputSchema.parse({response_format: ResponseFormat.JSON}),
      'https://slothhub.dev',
    );

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.structuredContent)).not.toContain('bad proxy host');
    expect(result.content[0]?.text).not.toContain('bad proxy host');
    expect(result.content[0]?.text).toContain('[redacted proxy value]');
  });

  it('reports proxy environment presence as booleans only in doctor output', async () => {
    vi.stubEnv('HTTPS_PROXY', 'http://user:pass@proxy.corp:8080');
    vi.stubEnv('HTTP_PROXY', undefined);
    vi.stubEnv('NO_PROXY', 'localhost,.internal');
    vi.stubEnv('NODE_USE_ENV_PROXY', undefined);
    vi.stubEnv('NODE_EXTRA_CA_CERTS', undefined);
    const fetchJson = vi.fn(async () => indexFeed);

    const result = await handleDoctor(
      createFeedClient({fetchJson}),
      doctorInputSchema.parse({response_format: ResponseFormat.JSON}),
      'https://slothhub.dev',
    );

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      networkEnvironment: {
        httpsProxy: true,
        httpProxy: false,
        noProxy: true,
        envProxyEnabled: false,
        nodeExtraCaCerts: false,
      },
    });
    const serialized = JSON.stringify(result.structuredContent) + result.content[0]?.text;
    expect(serialized).not.toContain('proxy.corp');
    expect(serialized).not.toContain('.internal');
  });
});
