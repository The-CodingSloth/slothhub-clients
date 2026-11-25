import { readFileSync } from 'node:fs';
import type { JsonObject } from '@slothhub/domain/json-value';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { runSlothhubBin } from './binRuntime.js';
import { runCli } from './cli.js';
import { FeedHostBlockedError } from '@slothhub/domain/public-feed-http';
import { FeedHttpStatusError, type FetchJson } from './feedClient.js';
import { indexFeed, toolLookupArtifact } from './fixtures.js';
import type { CliResult } from './types.js';

// SAFETY: The golden fixture is a maintained map from scenario key to the exact
// JSON failure envelope the CLI commits to; every member is asserted below.
const goldenEnvelopes = JSON.parse(
  readFileSync(new URL('./__fixtures__/cli-error-envelopes.golden.json', import.meta.url), 'utf8'),
) as Record<string, JsonObject>;

const noFetch: FetchJson = async () => {
  throw new Error('Feed access must not run for a usage failure');
};

const transportFailure: FetchJson = async () => {
  throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
};

// Vercel answers a challenged automated request with 403 and x-vercel-mitigated.
const hostBlocked: FetchJson = async () => {
  throw new FeedHostBlockedError(403, 'challenge');
};

const unsupportedVersionFeed: FetchJson = async () => ({ version: '99.0.0' });

const notFoundFeeds: FetchJson = async (url) => {
  const path = new URL(url).pathname;
  if (path === '/api/index.json') return indexFeed;
  if (path === '/api/tool-lookup.json') return toolLookupArtifact;
  throw new FeedHttpStatusError(404, 'Not Found');
};

// Each scenario maps a golden key to the invocation that must reproduce it and
// the exit code the taxonomy assigns. JSON envelopes land on stdout; stderr
// stays empty under --json.
const envelopeScenarios: ReadonlyArray<{
  key: keyof typeof goldenEnvelopes;
  run: () => Promise<CliResult> | CliResult | undefined;
  exitCode: number;
}> = [
  {
    key: 'usage.unknownCommand',
    run: () => runCli(['frobnicate', '--json'], { fetchJson: noFetch }),
    exitCode: 2,
  },
  {
    key: 'usage.unknownFlag',
    run: () => runCli(['categories', '--bogus', '--json'], { fetchJson: noFetch }),
    exitCode: 2,
  },
  {
    key: 'usage.missingToolArgument',
    run: () => runCli(['tool', '--json'], { fetchJson: noFetch }),
    exitCode: 2,
  },
  {
    key: 'usage.invalidLimit',
    run: () => runCli(['search', '--limit', '51', '--json'], { fetchJson: noFetch }),
    exitCode: 2,
  },
  {
    key: 'runtime.notFound',
    run: () => runCli(['tool', 'missing-tool', '--json'], { fetchJson: notFoundFeeds }),
    exitCode: 3,
  },
  {
    key: 'runtime.transport',
    run: () => runCli(['doctor', '--json'], { fetchJson: transportFailure }),
    exitCode: 5,
  },
  {
    key: 'runtime.hostBlocked',
    run: () => runCli(['search', 'postgres', '--json'], { fetchJson: hostBlocked }),
    exitCode: 1,
  },
  {
    key: 'runtime.unsupportedVersion',
    run: () => runCli(['doctor', '--json'], { fetchJson: unsupportedVersionFeed }),
    exitCode: 1,
  },
  {
    key: 'runtime.unsupportedNode',
    run: () =>
      runSlothhubBin(['tool', 'figma', '--json'], {
        nodeVersion: '20.0.0',
        enginesRange: '>=22.12.0',
        loadCli: async () => {
          throw new Error('Command modules must not load on an unsupported runtime');
        },
      }),
    exitCode: 2,
  },
];

// Proxy/TLS environment variables would attach a `hint` member to transport
// envelopes; the golden shape is asserted against a clean environment.
const NETWORK_ENVIRONMENT_VARIABLES = [
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'ALL_PROXY',
  'all_proxy',
  'NO_PROXY',
  'no_proxy',
  'NODE_USE_ENV_PROXY',
  'NODE_EXTRA_CA_CERTS',
  'SLOTHHUB_BASE_URL',
] as const;

describe('CLI error envelope contract', () => {
  beforeEach(() => {
    for (const name of NETWORK_ENVIRONMENT_VARIABLES) vi.stubEnv(name, undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ['tool', 'figma'],
    ['setup', 'figma', '--host', 'cursor'], ['compare', 'figma', 'linear'],
    ['assembly', 'figma', 'linear'], ['alternatives', 'figma'],
  ])('preserves a missing catalog index as a transport failure for %j', async (...args) => {
    const requested: string[] = [];
    const result = await runCli([...args, '--json'], {fetchJson: async (url) => {
      requested.push(new URL(url).pathname);
      throw new FeedHttpStatusError(404, 'Not Found');
    }});
    expect(result.exitCode).toBe(5);
    expect(JSON.parse(result.stdout)).toMatchObject({code: 'transport', path: '/api/index.json'});
    expect(requested).toEqual(['/api/index.json']);
  });

  it.each(envelopeScenarios)(
    'matches the golden envelope for $key (exit $exitCode)',
    async ({ key, run, exitCode }) => {
      const expected = goldenEnvelopes[key];
      expect(expected, `golden fixture is missing ${key}`).toBeDefined();

      const result = await run();

      expect(result?.exitCode).toBe(exitCode);
      expect(result?.stderr).toBe('');
      expect(JSON.parse(result?.stdout ?? '')).toEqual(expected);
    },
  );

  it('covers every committed golden envelope', () => {
    expect(envelopeScenarios.map((scenario) => scenario.key).sort()).toEqual(
      Object.keys(goldenEnvelopes).sort(),
    );
  });
});

describe('exit-code taxonomy', () => {
  it.each([
    { name: 'help', args: ['--help'], exitCode: 0 },
    { name: 'version', args: ['--version'], exitCode: 0 },
    { name: 'unknown command', args: ['frobnicate'], exitCode: 2 },
    { name: 'unknown flag', args: ['categories', '--bogus'], exitCode: 2 },
    { name: 'missing flag value', args: ['search', '--limit'], exitCode: 2 },
    { name: 'missing required argument', args: ['tool'], exitCode: 2 },
  ])('$name exits $exitCode with prose on stderr and empty stdout', async ({ args, exitCode }) => {
    const result = await runCli(args, { fetchJson: noFetch });

    expect(result.exitCode).toBe(exitCode);
    if (exitCode === 0) {
      expect(result.stderr).toBe('');
      expect(result.stdout).not.toBe('');
    } else {
      expect(result.stdout).toBe('');
      expect(result.stderr).not.toBe('');
    }
  });

  it.each([
    { name: 'not found', fetchJson: notFoundFeeds, args: ['tool', 'missing-tool'], exitCode: 3 },
    { name: 'transport failure', fetchJson: transportFailure, args: ['doctor'], exitCode: 5 },
    { name: 'unsupported feed version', fetchJson: unsupportedVersionFeed, args: ['doctor'], exitCode: 1 },
  ])('$name exits $exitCode in human mode', async ({ args, fetchJson, exitCode }) => {
    const result = await runCli(args, { fetchJson });

    expect(result.exitCode).toBe(exitCode);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toBe('');
  });

  it('detects --json anywhere in the argument list, including past an invalid flag', async () => {
    const result = await runCli(['frobnicate', '--bogus', '--json'], { fetchJson: noFetch });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, code: 'invalid_input' });
  });
});

it('suggests the closest command for a typo without running it', async () => {
  const result = await runCli(['serch', 'figma', '--json'], {fetchJson: async () => { throw new Error('no feed reads for a typo'); }});
  expect(result.exitCode).toBe(2);
  expect(JSON.parse(result.stdout)).toMatchObject({code: 'invalid_input', suggestion: 'search', message: 'Unknown command: serch. Did you mean search?'});
});

it('keeps unclassified failures out of the retry-later exit code', async () => {
  const {cliExitCodeForError} = await import('./cliOutput.js');
  expect(cliExitCodeForError('feed_load_error')).toBe(1);
  expect(cliExitCodeForError('feed_timeout')).toBe(5);
});
