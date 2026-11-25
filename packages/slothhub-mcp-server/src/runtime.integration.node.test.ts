import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {beforeAll, expect, inject, it} from 'vite-plus/test';

declare module 'vite-plus/test' {
  interface ProvidedContext {
    builtArtifactsReady: boolean;
  }
}

const packageDirectory = fileURLToPath(new URL('..', import.meta.url));

// Exercise the shipped ESM executable: source-level imports miss bundled CJS failures.
beforeAll(async () => {
  // Raw Vitest invocations still prepare fresh artifacts. The checked task
  // graph has already built them and must not restore the shared domain twice.
  if (inject('builtArtifactsReady') === true) return;
  const build = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build', '--silent'], {
    cwd: packageDirectory, stdio: 'inherit', shell: process.platform === 'win32',
  });
  await new Promise<void>((resolve, reject) => {
    build.on('error', reject);
    build.on('close', (code) => code === 0 ? resolve() : reject(new Error(`MCP build exited with status ${code}.`)));
  });
  // The full-suite build exceeded the default 10 s hook deadline on 2026-10-22.
  // Allow twice the production feed deadline for building the real executable.
}, 30_000);

it('initializes the built server over stdio and advertises its discovery tools', async () => {
  const client = new Client({name: 'runtime-test', version: '1.0.0'});
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../dist/index.js', import.meta.url))],
    cwd: packageDirectory,
  });
  try {
    await client.connect(transport);
    const result = await client.listTools();
    expect(result.tools.map((tool) => tool.name)).toContain('search');
    expect(client.getServerVersion()?.name).toBeTruthy();
  } finally {
    await client.close();
  }
});
