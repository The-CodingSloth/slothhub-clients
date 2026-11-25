import {describe, expect, it, vi} from 'vite-plus/test';
import {parse} from 'yaml';
import {AGENT_SETUP_RECIPE_HOST_VALUES, type McpRegistryObservation} from '@slothhub/domain/mcp-registry';
import {normalizePublicAgentInterfaces} from '@slothhub/domain/agent-interface';
import {type JsonValue} from '@slothhub/domain/json-value';
import {runCli} from './cli.js';
import {FeedHttpStatusError, type FetchJson} from './feedClient.js';
import {indexFeed, toolDetailFeed} from './fixtures.js';
import type {AgentToolDetailFeed} from './types.js';

const observation = {
  registryName: 'io.example/figma', status: 'active', version: '1.2.3',
  observedAt: '2026-09-22T00:00:00.000Z',
  remotes: [{type: 'streamable-http', url: 'https://mcp.example.com/mcp'}],
} satisfies McpRegistryObservation;

const recipeFeed = (source: JsonValue = observation): AgentToolDetailFeed => ({
  ...toolDetailFeed,
  data: {
    ...toolDetailFeed.data,
    agentInterfaces: normalizePublicAgentInterfaces([{
      kind: 'mcp_server', status: 'official', identifier: 'io.example/figma',
      mcpRegistryObservation: source,
    }], {slug: 'figma'}),
  },
});

const feedFetch = (feed: AgentToolDetailFeed) => vi.fn<FetchJson>(async (url) => {
  if (new URL(url).pathname === '/api/index.json') return indexFeed;
  if (new URL(url).pathname !== '/api/tools/figma.json') throw new Error('Unexpected network request');
  return feed;
});

describe('slothhub setup', () => {
  it.each([false, true])('rejects several ready interfaces for one host instead of choosing the first (json=%s)', async (json) => {
    const feed = recipeFeed();
    feed.data.agentInterfaces = normalizePublicAgentInterfaces([
      {kind: 'mcp_server', status: 'official', identifier: 'io.example/first', mcpRegistryObservation: observation},
      {kind: 'mcp_server', status: 'official', identifier: 'io.example/second', mcpRegistryObservation: {...observation, registryName: 'io.example/second', remotes: [{type: 'streamable-http', url: 'https://second.example.com/mcp'}]}},
    ], {slug: 'figma'});
    const result = await runCli(['setup', 'figma', '--host', 'cursor', ...(json ? ['--json'] : [])], {fetchJson: feedFetch(feed)});
    expect(result.exitCode).toBe(1);
    if (json) {
      expect(JSON.parse(result.stdout)).toMatchObject({code: 'ambiguous_recipe', host: 'cursor', slug: 'figma', observedCount: 2, detailUrl: feed.data.detailUrl, recovery: expect.stringContaining('documentation')});
      expect(result.stdout).not.toContain('entrySnippet');
    } else {
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('ambiguous_recipe');
      expect(result.stderr).toContain(feed.data.detailUrl);
    }
  });

  it('names both Cursor configuration locations in text and JSON', async () => {
    const fetchJson = feedFetch(recipeFeed());
    const text = await runCli(['setup', 'figma', '--host', 'cursor'], {fetchJson});
    const json = await runCli(['setup', 'figma', '--host', 'cursor', '--json'], {fetchJson});
    expect(text.stdout).toContain('.cursor/mcp.json (project) or ~/.cursor/mcp.json (user)');
    expect(JSON.parse(json.stdout)).toMatchObject({configHint: '.cursor/mcp.json (project) or ~/.cursor/mcp.json (user)'});
  });
  it('prints Continue merge entries and complete standalone YAML from catalog 5', async () => {
    const feed = {...recipeFeed(), version: '33.0.0'};
    const fetchJson = feedFetch(feed);
    const result = await runCli(['setup', 'figma', '--host', 'continue'], {fetchJson});
    expect(result).toMatchObject({exitCode: 0, stderr: ''});
    expect(result.stdout).toContain('Continue setup (append to the mcpServers YAML list in .continue/mcpServers/ (workspace)');
    expect(result.stdout).toContain('- name: figma');
    expect(result.stdout).toContain('type: streamable-http');
    expect(result.stdout).toContain('name: SlothHub figma\nversion: 1.0.0\nschema: v1\nmcpServers:');
    expect(result.stdout).toContain('resolve duplicate server names');
    expect(result.stdout).toContain('choose an unused .yaml filename');
    expect(result.stdout).not.toContain('Cursor setup');
    expect(fetchJson).toHaveBeenCalledTimes(2);
    const json = await runCli(['setup', 'figma', '--host', 'continue', '--json'], {fetchJson});
    expect(JSON.parse(json.stdout)).toMatchObject({host: 'continue', recipe: {state: 'ready', host: 'continue', snippet: expect.stringContaining('schema: v1')}});
  });
  it('reads Amp from catalog 4 and preserves its literal merge root and approval guidance', async () => {
    const feed = {...recipeFeed(), version: '33.0.0'};
    const fetchJson = feedFetch(feed);
    const result = await runCli(['setup', 'figma', '--host', 'amp'], {fetchJson});
    expect(result).toMatchObject({exitCode: 0, stderr: ''});
    expect(result.stdout).toContain('Amp setup (merge into amp.mcpServers in .amp/settings.json (workspace; approval required) or ~/.config/amp/settings.json (user)');
    expect(result.stdout).toContain('"url": "https://mcp.example.com/mcp"');
    expect(fetchJson).toHaveBeenCalledTimes(2);
    const json = await runCli(['setup', 'figma', '--host', 'amp', '--json'], {fetchJson});
    expect(JSON.parse(json.stdout)).toMatchObject({host: 'amp', recipe: {state: 'ready', host: 'amp'}});
  });
  it('reads the Cline recipe from catalog 5 and prints its documented IDE and CLI locations', async () => {
    const feed = {...recipeFeed(), version: '33.0.0'};
    const fetchJson = feedFetch(feed);
    const result = await runCli(['setup', 'figma', '--host', 'cline'], {fetchJson});
    expect(result).toMatchObject({exitCode: 0, stderr: ''});
    expect(result.stdout).toContain('Cline setup (merge into mcpServers in Configure MCP Servers (Cline IDE) or ~/.cline/mcp.json (CLI)');
    expect(result.stdout).toContain('"type": "streamableHttp"');
    expect(fetchJson).toHaveBeenCalledTimes(2);
    const json = await runCli(['setup', 'figma', '--host', 'cline', '--json'], {fetchJson});
    expect(JSON.parse(json.stdout)).toMatchObject({host: 'cline', recipe: {state: 'ready', host: 'cline'}});
  });
  it('delivers Goose YAML with merge guidance through text and JSON output', async () => {
    const feed = {...recipeFeed(), version: '33.0.0'};
    const fetchJson = feedFetch(feed);
    const result = await runCli(['setup', 'figma', '--host', 'goose'], {fetchJson});
    expect(result).toMatchObject({exitCode: 0, stderr: ''});
    expect(result.stdout).toContain('Goose setup (merge into extensions in ~/.config/goose/config.yaml');
    expect(result.stdout).toContain('\n  figma:\n    name: figma\n    type: streamable_http\n    uri: https://mcp.example.com/mcp\n    enabled: true');
    const snippet = result.stdout.split('\n').filter((line) => line.startsWith('  ')).join('\n');
    expect(parse(`extensions:\n  existing:\n    enabled: true\n${snippet}`)).toMatchObject({extensions: {
      existing: {enabled: true},
      figma: {type: 'streamable_http', uri: 'https://mcp.example.com/mcp', enabled: true},
    }});
    expect(fetchJson).toHaveBeenCalledTimes(2);
    const json = await runCli(['setup', 'figma', '--host', 'goose', '--json'], {fetchJson});
    expect(json.exitCode).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({host: 'goose', recipe: feed.data.agentInterfaces?.[0]?.setupRecipes?.find((recipe) => recipe.host === 'goose')});
  });

  it.each([
    {host: 'jetbrains_ai_assistant', label: 'JetBrains AI Assistant', configHint: 'Settings → Tools → AI Assistant → Model Context Protocol (MCP); select HTTP when adding a server'},
    {host: 'junie', label: 'Junie', configHint: '.junie/mcp/mcp.json (project) or ~/.junie/mcp/mcp.json (user)'},
    {host: 'warp', label: 'Warp', configHint: '.warp/.mcp.json (project, requires approval) or ~/.warp/.mcp.json (user)'},
  ])('reads the new catalog major and prints $label guidance for the selected recipe', async ({host, label, configHint}) => {
    const feed = {...recipeFeed(), version: '33.0.0'};
    const fetchJson = feedFetch(feed);
    const result = await runCli(['setup', 'figma', '--host', host], {fetchJson});
    expect(result).toMatchObject({exitCode: 0, stderr: ''});
    expect(result.stdout).toContain(`${label} setup (merge into mcpServers in ${configHint}`);
    expect(result.stdout).toContain('"url": "https://mcp.example.com/mcp"');
    expect(result.stdout).toContain('io.example/figma v1.2.3');
    expect(fetchJson).toHaveBeenCalledTimes(2);
    const json = await runCli(['setup', 'figma', '--host', host, '--json'], {fetchJson});
    expect(json.exitCode).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({host, recipe: {state: 'ready', host}});
  });

  it('reports a missing Tool as not_found while keeping provider failures distinct', async () => {
    for (const [status, code] of [[404, 'not_found'], [503, 'transport']] as const) {
      const result = await runCli(['setup', '--host', 'cursor', 'missing', '--json'], {
        fetchJson: async (url) => {
          if (url.endsWith('/api/index.json')) return indexFeed;
          throw new FeedHttpStatusError(status);
        },
      });
      expect(result.exitCode).toBe(code === 'not_found' ? 3 : 5);
      expect(JSON.parse(result.stdout)).toMatchObject({code});
      if (status === 404) expect(JSON.parse(result.stdout).recovery).toContain('public Tool slug');
    }
  });
  it('returns only the selected published recipe and provenance through the detail feed parser', async () => {
    const feed = recipeFeed();
    const fetchJson = feedFetch(feed);
    const result = await runCli(['setup', '--host', 'cursor', 'figma', '--json'], {fetchJson});
    expect(result).toMatchObject({exitCode: 0, stderr: ''});
    expect(JSON.parse(result.stdout)).toEqual({
      host: 'cursor', slug: 'figma', detailUrl: feed.data.detailUrl,
      configHint: '.cursor/mcp.json (project) or ~/.cursor/mcp.json (user)',
      recipe: feed.data.agentInterfaces?.[0]?.setupRecipes?.[0],
    });
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(result.stdout).not.toContain('/go/');
  });

  it('prints merge guidance, the copy-only snippet and registry version for a human', async () => {
    const result = await runCli(['setup', 'figma', '--host', 'cursor'], {fetchJson: feedFetch(recipeFeed())});
    expect(result).toMatchObject({exitCode: 0, stderr: ''});
    expect(result.stdout).toContain('Cursor setup (merge into mcpServers in .cursor/mcp.json (project) or ~/.cursor/mcp.json (user) — review before running)');
    expect(result.stdout).toContain('"url": "https://mcp.example.com/mcp"');
    expect(result.stdout).toContain('io.example/figma v1.2.3');
    expect(result.stdout).toContain('Tool: https://slothhub.dev/tool/figma');
    expect(result.stdout).not.toContain('Gemini');
  });

  it.each([
    [null, 'missing_remotes'],
    [{...observation, status: 'deprecated' as const}, 'deprecated_registry'],
  ])('reports the published unknown reason %s', async (source, reason) => {
    for (const json of [false, true]) {
      const result = await runCli(['setup', 'figma', '--host', 'cursor', ...(json ? ['--json'] : [])], {
        fetchJson: feedFetch(recipeFeed(source)),
      });
      expect(result.exitCode).toBe(1);
      if (json) {
        expect(result.stderr).toBe('');
        expect(JSON.parse(result.stdout)).toMatchObject({
          ok: false, code: reason, reason, state: 'unknown', host: 'cursor', slug: 'figma',
          detailUrl: 'https://slothhub.dev/tool/figma',
        });
      } else {
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain(`${reason}:`);
        expect(result.stderr).toContain('Host: cursor. Tool: figma.');
        expect(result.stderr).toContain('https://slothhub.dev/tool/figma');
      }
    }
  });

  it('uses no_recipe for older unknown entries without inventing Registry facts', async () => {
    const feed = recipeFeed();
    feed.data.agentInterfaces![0]!.setupRecipes = [{state: 'unknown', host: 'cursor'}];
    const result = await runCli(['setup', 'figma', '--host', 'cursor', '--json'], {fetchJson: feedFetch(feed)});
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({code: 'no_recipe', reason: 'no_recipe'});
  });

  it('reads the legacy singular Cursor recipe without aliasing another host to it', async () => {
    const feed = recipeFeed();
    delete feed.data.agentInterfaces![0]!.setupRecipes;
    const result = await runCli(['setup', 'figma', '--host', 'cursor', '--json'], {fetchJson: feedFetch(feed)});
    expect(result.exitCode).toBe(0);
    const unavailable = await runCli(['setup', 'figma', '--host', 'zed', '--json'], {fetchJson: feedFetch(feed)});
    expect(unavailable.exitCode).toBe(1);
    expect(JSON.parse(unavailable.stdout)).toMatchObject({host: 'zed', code: 'no_recipe'});
  });

  it('skips deprecated interfaces and prefers a ready recipe over an earlier unknown entry', async () => {
    const feed = recipeFeed();
    const ready = feed.data.agentInterfaces![0]!;
    feed.data.agentInterfaces = [
      {...ready, status: 'deprecated'},
      {...ready, setupRecipes: [{state: 'unknown', host: 'cursor', reason: 'missing_remotes'}]},
      ready,
    ];
    expect((await runCli(['setup', 'figma', '--host', 'cursor'], {fetchJson: feedFetch(feed)})).exitCode).toBe(0);
    feed.data.agentInterfaces = [{...ready, status: 'deprecated'}];
    const retired = await runCli(['setup', 'figma', '--host', 'cursor', '--json'], {fetchJson: feedFetch(feed)});
    expect(JSON.parse(retired.stdout)).toMatchObject({code: 'no_recipe'});
  });

  it('rejects unknown hosts with the allowed list and a recovery URL before fetching', async () => {
    const fetchJson = feedFetch(recipeFeed());
    const result = await runCli(['setup', 'figma', '--host', 'emacs', '--json'], {fetchJson});
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      code: 'unknown_host', reason: 'unknown_host', host: 'emacs', slug: 'figma',
      allowedHosts: [...AGENT_SETUP_RECIPE_HOST_VALUES], detailUrl: expect.stringContaining('/tool/figma'),
    });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it.each([
    ['setup', 'figma'],
    ['setup', '--host', 'cursor'],
    ['setup', 'figma', 'extra', '--host', 'cursor'],
    ['setup', '../figma', '--host', 'cursor'],
    ['setup', 'figma', '--host', 'cursor', '--output', 'mcp.json'],
    ['tool', 'figma', '--host', 'cursor'],
  ])('rejects invalid arguments without fetching or writing: %j', async (...args) => {
    const fetchJson = feedFetch(recipeFeed());
    const writeReceiptOutput = vi.fn();
    const result = await runCli([...args, '--json'], {fetchJson, writeReceiptOutput});
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({code: 'invalid_input'});
    expect(fetchJson).not.toHaveBeenCalled();
    expect(writeReceiptOutput).not.toHaveBeenCalled();
  });

  it('preserves transport failures and rejects a mismatched Tool identity', async () => {
    const fetchJson: FetchJson = async () => { throw new Error('Connection failed'); };
    expect((await runCli(['setup', 'figma', '--host', 'cursor'], {fetchJson})).exitCode).toBe(5);
    const feed = recipeFeed();
    feed.data.slug = 'another-tool';
    const result = await runCli(['setup', 'figma', '--host', 'cursor', '--json'], {fetchJson: feedFetch(feed)});
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({code: 'schema_invalid'});
  });
});
