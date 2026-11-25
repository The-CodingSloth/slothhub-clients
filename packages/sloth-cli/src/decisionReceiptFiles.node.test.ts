import { mkdtemp, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { DECISION_RECEIPT_MAX_MARKDOWN_BYTES } from '@slothhub/domain/decision-receipt';
import {
  createDecisionReceiptFileIO,
  readDecisionReceiptSource,
  writeDecisionReceiptOutput,
} from './decisionReceiptFiles.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('decision receipt files', () => {
  it('publishes mode-0600 output atomically and refuses overwrite by default', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slothhub-receipt-'));
    directories.push(directory);
    const path = join(directory, 'receipt.md');

    await writeDecisionReceiptOutput(path, 'first\n', false);
    expect(await readFile(path, 'utf8')).toBe('first\n');
    expect((await stat(path)).mode & 0o777).toBe(0o600);

    await expect(writeDecisionReceiptOutput(path, 'second\n', false)).rejects.toThrow(/overwrite|force/i);
    expect(await readFile(path, 'utf8')).toBe('first\n');

    await writeDecisionReceiptOutput(path, 'second\n', true);
    expect(await readFile(path, 'utf8')).toBe('second\n');
  });

  it('rejects an oversized file before loading its contents', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slothhub-receipt-'));
    directories.push(directory);
    const path = join(directory, 'oversized.json');
    await writeFile(path, Buffer.alloc(DECISION_RECEIPT_MAX_MARKDOWN_BYTES + 1));

    await expect(readDecisionReceiptSource(path)).rejects.toThrow(/byte/i);
  });

  it('bounds stdin incrementally and rejects invalid UTF-8', async () => {
    // SAFETY: This negative-path fixture is deliberately outside the production contract and is rejected before use.
    const oversized = createDecisionReceiptFileIO({
      stdin: (async function* () {
        yield Buffer.alloc(DECISION_RECEIPT_MAX_MARKDOWN_BYTES);
        yield Buffer.from('x');
      })(),
    } as never);
    // SAFETY: This negative-path fixture is deliberately outside the production contract and is rejected before use.
    const invalidUtf8 = createDecisionReceiptFileIO({
      stdin: (async function* () {
        yield Buffer.from([0xc3, 0x28]);
      })(),
    } as never);

    await expect(oversized.readSource('-')).rejects.toThrow(/byte/i);
    await expect(invalidUtf8.readSource('-')).rejects.toThrow(/UTF-8/i);
  });

  it('rejects non-regular named sources through the opened handle', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slothhub-receipt-'));
    directories.push(directory);

    await expect(readDecisionReceiptSource(directory)).rejects.toThrow(/regular file/i);
  });

  it('opens a named source once, fstats that handle, and closes it after bounded reads', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const read = vi
      .fn()
      .mockImplementationOnce(async (buffer: Buffer) => {
        buffer.set(Buffer.from('{"ok":true}'));
        return { bytesRead: 11 };
      })
      .mockResolvedValue({ bytesRead: 0 });
    const open = vi.fn().mockResolvedValue({
      stat: vi.fn().mockResolvedValue({ isFile: () => true }),
      read,
      close,
    });
    // SAFETY: This negative-path fixture is deliberately outside the production contract and is rejected before use.
    const io = createDecisionReceiptFileIO({ open } as never);

    await expect(io.readSource('receipt.json')).resolves.toBe('{"ok":true}');
    expect(open).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes and removes the temporary file when writing fails', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const unlink = vi.fn().mockResolvedValue(undefined);
    // SAFETY: This negative-path fixture is deliberately outside the production contract and is rejected before use.
    const io = createDecisionReceiptFileIO({
      open: vi.fn().mockResolvedValue({
        writeFile: vi.fn().mockRejectedValue(new Error('disk full')),
        sync: vi.fn(),
        close,
      }),
      unlink,
      randomUUID: () => 'test-id',
    } as never);

    await expect(io.writeOutput('receipt.md', 'content', false)).rejects.toThrow('disk full');
    expect(close).toHaveBeenCalledTimes(1);
    expect(unlink).toHaveBeenCalledTimes(1);
  });

  it('does not publish output when closing the temporary file fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slothhub-receipt-'));
    directories.push(directory);
    const path = join(directory, 'receipt.md');
    await writeFile(path, 'existing\n');
    // SAFETY: This negative-path fixture is deliberately outside the production contract and is rejected before use.
    const io = createDecisionReceiptFileIO({
      open: async (temporaryPath: string, flags: string | number, mode?: number) => {
        const handle = await open(temporaryPath, flags, mode);
        return {
          writeFile: handle.writeFile.bind(handle),
          sync: handle.sync.bind(handle),
          close: async () => {
            await handle.close();
            throw new Error('close failed');
          },
        };
      },
      randomUUID: () => 'test-id',
    } as never);

    await expect(io.writeOutput(path, 'replacement\n', false)).rejects.toThrow('close failed');
    expect(await readFile(path, 'utf8')).toBe('existing\n');
    expect(await readdir(directory)).toEqual(['receipt.md']);
  });

  it('removes the temporary file and preserves the destination when linking fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slothhub-receipt-'));
    directories.push(directory);
    const path = join(directory, 'receipt.md');
    await writeFile(path, 'existing\n');
    const linkError = Object.assign(new Error('link denied'), { code: 'EACCES' });
    // SAFETY: This negative-path fixture is deliberately outside the production contract and is rejected before use.
    const io = createDecisionReceiptFileIO({
      link: vi.fn().mockRejectedValue(linkError),
      randomUUID: () => 'test-id',
    } as never);

    await expect(io.writeOutput(path, 'replacement\n', false)).rejects.toThrow('link denied');
    expect(await readFile(path, 'utf8')).toBe('existing\n');
    expect(await readdir(directory)).toEqual(['receipt.md']);
  });

  it('removes the temporary file and preserves the destination when forced rename fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slothhub-receipt-'));
    directories.push(directory);
    const path = join(directory, 'receipt.md');
    await writeFile(path, 'existing\n');
    // SAFETY: This negative-path fixture is deliberately outside the production contract and is rejected before use.
    const io = createDecisionReceiptFileIO({
      rename: vi.fn().mockRejectedValue(new Error('rename denied')),
      randomUUID: () => 'test-id',
    } as never);

    await expect(io.writeOutput(path, 'replacement\n', true)).rejects.toThrow('rename denied');
    expect(await readFile(path, 'utf8')).toBe('existing\n');
    expect(await readdir(directory)).toEqual(['receipt.md']);
  });

  it('does not turn successful publication into failure when temp cleanup fails', async () => {
    // SAFETY: This negative-path fixture is deliberately outside the production contract and is rejected before use.
    const io = createDecisionReceiptFileIO({
      open: vi.fn().mockResolvedValue({
        writeFile: vi.fn().mockResolvedValue(undefined),
        sync: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      }),
      link: vi.fn().mockResolvedValue(undefined),
      unlink: vi.fn().mockRejectedValue(new Error('cleanup denied')),
      randomUUID: () => 'test-id',
    } as never);

    await expect(io.writeOutput('receipt.md', 'content', false)).resolves.toBeUndefined();
  });
});
