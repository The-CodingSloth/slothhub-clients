import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vite-plus/test';

import {
  guardPipeErrors,
  isSupportedNodeVersion,
  runSlothhubBin,
  unsupportedNodeVersionMessage,
} from './binRuntime.js';

describe('slothhub bin runtime', () => {
  it('reads the installed manifest requirement before loading the CLI', async () => {
    const loadCli = vi.fn(async () => ({runCli: async () => ({exitCode: 0, stdout: 'unexpected', stderr: ''})}));
    const result = await runSlothhubBin(['search', 'design'], {nodeVersion: '0.0.0', loadCli});

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/^slothhub requires Node\.js >=\d+\.\d+\.\d+\.\n$/);
    expect(loadCli).not.toHaveBeenCalled();
  });

  it.each([
    ['22.12.0', true],
    ['22.13.1', true],
    ['23.0.0', true],
    ['22.11.9', false],
    ['20.19.0', false],
  ])('isSupportedNodeVersion(%s) === %s for >=22.12.0', (current, expected) => {
    expect(isSupportedNodeVersion(current, '>=22.12.0')).toBe(expected);
  });

  it('fails open when the engines range or runtime version cannot be parsed', () => {
    expect(isSupportedNodeVersion('not-a-version', '>=22.12.0')).toBe(true);
    expect(isSupportedNodeVersion('22.12.0', 'not-a-range')).toBe(true);
  });

  it('exits 2 with a one-line requirement and never loads the CLI on an old runtime', async () => {
    const loadCli = vi.fn();

    const result = await runSlothhubBin(['search', 'design'], {
      nodeVersion: '20.19.0',
      enginesRange: '>=22.12.0',
      loadCli,
    });

    expect(result).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: 'slothhub requires Node.js >=22.12.0.\n',
    });
    expect(loadCli).not.toHaveBeenCalled();
  });

  it('emits the same failure as a stdout envelope under --json', async () => {
    const loadCli = vi.fn();

    const result = await runSlothhubBin(['search', 'design', '--json'], {
      nodeVersion: '20.19.0',
      enginesRange: '>=22.12.0',
      loadCli,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      code: 'unsupported_runtime',
      message: 'slothhub requires Node.js >=22.12.0.',
      recovery: 'Run slothhub on a supported Node.js version and retry.',
    });
    expect(loadCli).not.toHaveBeenCalled();
  });

  it('delegates to runCli on a supported runtime', async () => {
    const runCli = vi.fn(async () => ({ exitCode: 0, stdout: 'ok\n', stderr: '' }));

    const result = await runSlothhubBin(['--version'], {
      nodeVersion: '22.12.0',
      enginesRange: '>=22.12.0',
      loadCli: async () => ({ runCli }),
    });

    expect(result).toEqual({ exitCode: 0, stdout: 'ok\n', stderr: '' });
    expect(runCli).toHaveBeenCalledWith(['--version']);
  });

  it('names only the requirement in the unsupported-runtime message', () => {
    const message = unsupportedNodeVersionMessage('>=22.12.0');

    expect(message).toBe('slothhub requires Node.js >=22.12.0.\n');
    expect(message).not.toContain(process.versions.node);
    expect(message.split('\n')).toHaveLength(2);
  });

  it('exits with the pending exit code when a stream closes early (EPIPE)', () => {
    const stream = new Writable({ write: (_chunk, _encoding, done) => done() });
    guardPipeErrors(stream);

    // SAFETY: process.exit returns `never`; the mock returns undefined so the
    // guarded handler can continue and the exit call can be asserted.
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
    const previousExitCode = process.exitCode;
    process.exitCode = 3;

    try {
      const broken = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
      stream.emit('error', broken);
      expect(exit).toHaveBeenCalledWith(3);
    } finally {
      exit.mockRestore();
      process.exitCode = previousExitCode;
    }
  });

  it('rethrows stream errors that are not EPIPE', () => {
    const stream = new Writable({ write: (_chunk, _encoding, done) => done() });
    guardPipeErrors(stream);

    const failure = Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    expect(() => stream.emit('error', failure)).toThrow('disk full');
  });
});
