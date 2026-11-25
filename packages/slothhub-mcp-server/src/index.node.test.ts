import type {serveStdio as StdioServerStarter} from '@modelcontextprotocol/server/stdio';
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const serveStdio = vi.fn((
      _factory: Parameters<typeof StdioServerStarter>[0],
    ): ReturnType<typeof StdioServerStarter> => ({
      close: vi.fn(async () => undefined),
    }));

import { isDirectExecution, main } from './index.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('stdio entry point', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('serves a SlothHub server factory through the SDK v2 stdio entry', async () => {
    await main(serveStdio);

    expect(serveStdio).toHaveBeenCalledOnce();
    const factory = serveStdio.mock.calls[0]?.[0];
    expect(factory).toEqual(expect.any(Function));
  });

  it('recognizes an npm-style symlink to the real built entry path', () => {
    const directory = mkdtempSync(join(tmpdir(), 'slothhub-mcp-bin-'));
    temporaryDirectories.push(directory);
    const realEntry = realpathSync(
      fileURLToPath(new URL('./index.ts', import.meta.url)),
    );
    const linkedEntry = join(directory, 'slothhub-mcp-server');
    symlinkSync(realEntry, linkedEntry);

    expect(isDirectExecution(pathToFileURL(realEntry).href, linkedEntry)).toBe(
      true,
    );
  });

  it('does not treat an unrelated or missing process entry as direct execution', () => {
    expect(isDirectExecution(import.meta.url, undefined)).toBe(false);
    expect(isDirectExecution(import.meta.url, '/missing/entry.js')).toBe(false);
  });
});
