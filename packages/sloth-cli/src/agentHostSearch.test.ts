import {AGENT_SETUP_RECIPE_CONFIG_HOST_VALUES} from '@slothhub/domain/mcp-registry';
import {describe, expect, it, vi} from 'vite-plus/test';
import {runCli} from './cli.js';
import {indexFeed, searchIndexFeed} from './fixtures.js';
import type {FetchJson} from './feedClient.js';
import type {AgentSearchIndexFeed} from './types.js';

const hostFeed: AgentSearchIndexFeed = {
  ...searchIndexFeed,
  data: {
    ...searchIndexFeed.data,
    tools: searchIndexFeed.data.tools.map((tool, index) => ({
      ...tool,
      setupRecipeHosts: index === 0 ? ['cursor'] : [],
    })),
    filters: {
      ...searchIndexFeed.data.filters,
      setupRecipeHosts: [{value: 'cursor', label: 'Cursor', count: 1}],
    },
  },
};

const fetchFeed = (feed: AgentSearchIndexFeed): FetchJson => async (url) => {
  const path = new URL(url).pathname;
  if (path === '/api/index.json') return indexFeed;
  if (path === '/api/search-index.json') return feed;
  throw new Error(`Unexpected feed ${path}`);
};

describe('Agent Host search', () => {
  it('filters through the parsed feed and supports text and JSON output', async () => {
    const json = await runCli(['search', '--agent-host', 'cursor', '--json'], {fetchJson: fetchFeed(hostFeed)});
    expect(json.exitCode).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({count: 1, results: [{slug: 'figma'}]});
    const text = await runCli(['search', '--agent-host', 'cursor'], {fetchJson: fetchFeed(hostFeed)});
    expect(text).toMatchObject({exitCode: 0, stderr: ''});
    expect(text.stdout).toContain('Figma');
    expect(text.stdout).not.toContain('Linear');
  });

  it('explains the ready host in recommendation JSON and gives a copy-only setup next step', async () => {
    const json = await runCli(['recommend', '--for', 'design', '--agent-host', 'cursor', '--json'], {fetchJson: fetchFeed(hostFeed)});
    expect(json.exitCode).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({selected: {slug: 'figma', setupRecipeHosts: ['cursor']}});
    const text = await runCli(['recommend', '--for', 'design', '--agent-host', 'cursor'], {fetchJson: fetchFeed(hostFeed)});
    expect(text.stdout).toContain('Ready setup hosts: Cursor');
    expect(text.stdout).toContain('Next: slothhub setup --host cursor figma');
    const unknown = await runCli(['recommend', '--for', 'design'], {fetchJson: fetchFeed(searchIndexFeed)});
    expect(unknown.stdout).toContain('No ready host recipe recorded.');
    expect(unknown.stdout).not.toContain('Next: slothhub setup');
  });

  it.each(['jetbrains_ai_assistant', 'junie', 'warp', 'goose'] as const)('filters %s facts from Search Index 4 through the CLI parser', async (host) => {
    const feed: AgentSearchIndexFeed = {
      ...hostFeed, version: '17.0.0', data: {
        ...hostFeed.data,
        tools: hostFeed.data.tools.map((tool, index) => ({...tool, setupRecipeHosts: index === 0 ? [host] : []})),
        filters: {...hostFeed.data.filters, setupRecipeHosts: [{value: host, label: host, count: 1}]},
      },
    };
    const result = await runCli(['search', '--agent-host', host, '--json'], {fetchJson: fetchFeed(feed)});
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({count: 1, results: [{slug: 'figma'}]});
  });

  it.each(['search', 'recommend'])('reports missing host metadata for %s without inventing zero matches', async (command) => {
    const query = command === 'recommend' ? ['--for', 'design'] : [];
    const result = await runCli([command, ...query, '--agent-host', 'cursor', '--json'], {fetchJson: fetchFeed(searchIndexFeed)});
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      code: 'capability_unavailable',
      filter: 'agentHost',
      recovery: 'Use a newer search feed or omit --agent-host.',
    });
  });

  it('rejects an unsupported host before fetching the catalog', async () => {
    const fetchJson = vi.fn(fetchFeed(hostFeed));
    const result = await runCli(['search', '--agent-host', 'future-host', '--json'], {fetchJson});
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      code: 'agent_search_unsupported_filter_value',
      filter: 'agentHost',
      recovery: `Use a supported agentHost value: ${AGENT_SETUP_RECIPE_CONFIG_HOST_VALUES.join(', ')}.`,
    });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it.each(['search', 'recommend'])('reports an older host vocabulary for %s', async (command) => {
    const query = command === 'recommend' ? ['--for', 'design'] : [];
    const result = await runCli([command, ...query, '--agent-host', ' ZED ', '--json'], {fetchJson: fetchFeed(hostFeed)});
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({code: 'capability_unavailable', filter: 'agentHost'});
  });

  it('returns the normal empty result contract for a supported host in an empty catalog', async () => {
    const emptyFeed = {...hostFeed, data: {...hostFeed.data, tools: []}};
    const result = await runCli(['search', '--agent-host', 'cursor', '--json'], {fetchJson: fetchFeed(emptyFeed)});
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({query: '', count: 0, results: []});
  });

  it('advertises the flag in command help and completions without fetching', async () => {
    const fetchJson = vi.fn(fetchFeed(hostFeed));
    const help = await runCli(['search', '--help'], {fetchJson});
    expect(help.stdout).toContain('--agent-host <value>');
    expect(help.stdout).toContain('Setup Recipe');
    const completion = await runCli(['completion', 'bash'], {fetchJson});
    expect(completion.stdout).toContain('--agent-host');
    for (const host of AGENT_SETUP_RECIPE_CONFIG_HOST_VALUES) expect(completion.stdout).toContain(host);
    expect(fetchJson).not.toHaveBeenCalled();
  });
});
