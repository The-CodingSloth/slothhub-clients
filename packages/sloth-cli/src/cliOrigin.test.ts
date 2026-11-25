import {afterEach, describe, expect, it, vi} from 'vite-plus/test';

import {runCli} from './cli.js';
import {indexFeed} from './fixtures.js';

describe('CLI catalog origin', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    {environment: undefined, args: [], origin: 'https://slothhub.dev'},
    {environment: 'https://preview.slothhub.dev', args: [], origin: 'https://preview.slothhub.dev'},
    {
      environment: 'https://preview.slothhub.dev',
      args: ['--base-url', 'https://slothhub.dev/'],
      origin: 'https://slothhub.dev',
    },
  ])('doctor requests the resolved manifest at $origin', async ({environment, args, origin}) => {
    vi.stubEnv('SLOTHHUB_BASE_URL', environment);
    const fetchJson = vi.fn(async (url: string) => (
      new URL(url).pathname === '/api/index.json' ? indexFeed : {version: '33.0.0'}
    ));

    const result = await runCli(['doctor', ...args], {
      fetchJson,
      probeFetch: async () => new Response(null, {status: 200}),
    });

    expect(result.exitCode).toBe(0);
    expect(fetchJson.mock.calls[0]?.[0]).toBe(`${origin}/api/index.json`);
    expect(result.stdout).toContain(`Manifest: ${origin}/api/index.json`);
  });
});
