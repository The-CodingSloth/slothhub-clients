import {parseToolDetailFeed, parseAlternativesDetailFeed} from '@slothhub/domain/public-feed-schemas';
import {describe, expect, it, vi} from 'vite-plus/test';
import {z} from 'zod';
import {runCli} from './cli.js';
import {createFeedClient} from './feedClient.js';
import {indexFeed, searchIndexFeed, toolDetailFeed, alternativesDetailFeed} from './fixtures.js';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {computeContentHash} from '@slothhub/domain/public-feed-content-identity';
import {writePersistentCacheEntry} from './persistentFeedCache.js';

describe('feed compatibility failures', () => {
  it('retains recorded checks, switching groups and cited reasons through catalog 30 readers', () => {
    const checkSummary = {methodologyPath: '/about#recorded-checks', sources: [{title: 'Docs', url: 'https://figma.com/docs'}], destinations: []};
    const detail = parseToolDetailFeed({...toolDetailFeed, version: '33.0.0', data: {...toolDetailFeed.data, checkSummary}}, '/api/tools/figma.json');
    expect(detail.data.checkSummary).toEqual(checkSummary);
    const switchingGroups = [{id: 'free_tier', label: 'Has a free tier', rule: 'Dated pricing evidence.', members: [{slug: 'linear', name: 'Linear', scope: 'Free plan', evidenceUrls: ['https://linear.app/pricing']}]}];
    const switchReason = {note: 'Compare the free plan.', sourceUrl: 'https://linear.app/pricing'};
    const alternatives = parseAlternativesDetailFeed({...alternativesDetailFeed, version: '33.0.0', data: {...alternativesDetailFeed.data, switchingGroups, alternatives: alternativesDetailFeed.data.alternatives.map((peer) => ({...peer, switchReason}))}}, '/api/alternatives/figma.json');
    expect(alternatives.data.switchingGroups).toEqual(switchingGroups);
    expect(alternatives.data.alternatives[0]?.switchReason).toEqual(switchReason);
  });

  it.each(['34.0.0'])('refuses unimplemented catalog major %s', async (version) => {
    const client = createFeedClient({fetchJson: async () => ({version}), noCache: true});
    await expect(client.tool('figma')).rejects.toMatchObject({code: 'unsupported_version', observedVersion: version});
  });

  it.each([false, true])('tells CLI callers to upgrade before parsing a future index (json=%s)', async (json) => {
    const fetchJson = vi.fn(async () => ({version: '99.0.0'}));
    const result = await runCli(['doctor', ...(json ? ['--json'] : [])], {fetchJson});
    expect(result.exitCode).toBe(1);
    if (json) {
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: false,
        code: 'unsupported_version', supportedVersion: '33.x', observedVersion: '99.0.0',
      });
      expect(result.stdout).toContain('npm install -g @slothhub/cli@latest');
    } else {
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('99.0.0');
      expect(result.stderr).toContain('33.x');
      expect(result.stderr).toContain('npm install -g @slothhub/cli@latest');
    }
    expect(fetchJson).toHaveBeenCalledOnce();
  });

  it('rejects a future detail before revision, hash, and runtime-requirement checks', async () => {
    const fetchJson = vi.fn(async (url: string) => url.endsWith('/api/index.json')
      ? {...indexFeed, catalogRevision: 'expected', contentHashes: {'/api/tools/figma.json': 'expected'}}
      : {version: '99.0.0', catalogRevision: 'different', data: {runtimeRequirements: 'invalid'}});
    const client = createFeedClient({fetchJson, noCache: true});
    await expect(client.tool('figma')).rejects.toMatchObject({code: 'unsupported_version', observedVersion: '99.0.0'});
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it('does not cache a rejected feed and accepts a compatible retry with unknown fields', async () => {
    const leaf = vi.fn()
      .mockResolvedValueOnce({version: '99.0.0'})
      .mockResolvedValueOnce({...toolDetailFeed, version: '33.99.0', futureField: {enabled: true}});
    const fetchJson = vi.fn(async (url: string): Promise<object> => url.endsWith('/api/index.json') ? indexFeed : leaf());
    const client = createFeedClient({fetchJson});
    await expect(client.tool('figma')).rejects.toMatchObject({code: 'unsupported_version'});
    await expect(client.tool('figma')).resolves.toMatchObject({version: '33.99.0'});
    expect(fetchJson).toHaveBeenCalledTimes(3);
  });

  it.each(['17.0.0', '17.2.0'])('accepts additive Search Index %s through the search command', async (version) => {
    const fetchJson = vi.fn(async (url: string) => url.endsWith('/api/index.json') ? indexFeed : {...searchIndexFeed, version, futureField: true});
    const result = await runCli(['search', '--json'], {fetchJson});
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toHaveProperty('results');
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it('still requires a query contract in an additive Search Index release', async () => {
    const {queryContract: _queryContract, ...data} = searchIndexFeed.data;
    const result = await runCli(['search', '--json'], {
      fetchJson: async (url) => url.endsWith('/api/index.json') ? indexFeed : {...searchIndexFeed, version: '17.2.0', data},
    });
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).code).toBe('schema_invalid');
  });

  it('does not mistake a version containing 404 for a missing Tool', async () => {
    const fetchJson = vi.fn(async () => ({version: '404.0.0'}));
    const result = await runCli(['tool', 'figma', '--json'], {fetchJson});
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({code: 'unsupported_version', observedVersion: '404.0.0'});
    expect(fetchJson).toHaveBeenCalledOnce();
  });

  it.each([['doctor', '0.9.0'], ['search', '1.9.0']])('points older catalogs to origin repair for %s', async (command, version) => {
    const fetchJson = vi.fn(async (url: string) => url.endsWith('/api/index.json') && command === 'search' ? indexFeed : {version});
    const result = await runCli([command!, '--json'], {fetchJson});
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      code: 'unsupported_version', observedVersion: version,
      recovery: expect.stringContaining('npm install -g'),
    });
    expect(result.stdout).toContain('npm install');
    expect(result.stdout).toContain('npm install');
    expect(fetchJson).toHaveBeenCalledTimes(command === 'search' ? 2 : 1);
  });

  it('reports an incompatible authenticated disk entry without fetching the leaf', async () => {
    const cacheDirectory = await mkdtemp(join(tmpdir(), 'slothhub-version-cache-'));
    const payload = {...toolDetailFeed, version: '99.0.0'};
    const contentHash = computeContentHash(payload);
    const path = '/api/tools/figma.json';
    const fetchJson = vi.fn(async () => ({...indexFeed, contentHashes: {[path]: contentHash}}));
    try {
      await writePersistentCacheEntry(cacheDirectory, `https://slothhub.dev|${path}|1`, {
        contentHash, storedAt: new Date().toISOString(), payload: z.json().parse({...payload, contentHash}),
      });
      await expect(createFeedClient({baseUrl: 'https://slothhub.dev', fetchJson, cacheDirectory}).tool('figma'))
        .rejects.toMatchObject({code: 'unsupported_version', observedVersion: '99.0.0'});
      expect(fetchJson).toHaveBeenCalledOnce();
    } finally {
      await rm(cacheDirectory, {recursive: true, force: true});
    }
  });

  it('keeps malformed index versions as schema failures without reflecting terminal controls', async () => {
    const result = await runCli(['doctor', '--json'], {
      fetchJson: async () => ({version: '\u001b]8;;https://hostile.test\u0007'}),
    });
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).code).toBe('schema_invalid');
    expect(result.stdout).not.toContain('hostile.test');
  });
});
