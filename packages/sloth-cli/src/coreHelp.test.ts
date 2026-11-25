import {expect, it} from 'vite-plus/test';
import {runCli} from './cli.js';

it('keeps discovery help compact and moves detailed filters and identifiers to command help', async () => {
  const root = (await runCli(['--help'])).stdout;
  expect(root).toContain('More commands:');
  expect(root).not.toContain('--package-registry');
  expect(root).not.toContain('homebrew_formula');
  expect((await runCli(['search', '--help'])).stdout).toContain('--package-registry');
  expect((await runCli(['tool', '--help'])).stdout).toContain('homebrew_formula');
});

it.each(['open', 'feeds', 'mcp-servers', 'skills', 'catalog', 'categories', 'tags', 'use-cases', 'comparisons', 'best', 'stack', 'implement', 'cite', 'handoff', 'inventory'])(
  'rejects removed %s without loading catalog data', async (command) => {
    const result = await runCli([command, '--json'], {fetchJson: async () => { throw new Error('Unexpected catalog read'); }});
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ok: false, code: 'invalid_input'});
  },
);
