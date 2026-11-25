#!/usr/bin/env node
import { guardPipeErrors, runSlothhubBin } from '../binRuntime.js';
import { failForOutput, safeDiagnostic } from '../cliOutput.js';
import type { CliResult } from '../types.js';

guardPipeErrors(process.stdout);
guardPipeErrors(process.stderr);

const emit = (result: CliResult): void => {
  process.exitCode = result.exitCode;
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
};

try {
  emit(await runSlothhubBin(process.argv.slice(2), {
    writeStdout: (chunk) => new Promise<void>((resolve, reject) => {
      process.stdout.write(chunk, (error) => error ? reject(error) : resolve());
    }),
  }));
} catch (error) {
  // runCli already classifies expected failures; anything reaching here is an
  // unexpected bootstrap error — one sanitized line, never a stack trace.
  const message = safeDiagnostic(error instanceof Error ? error.message : String(error));
  emit(
    failForOutput(process.argv.slice(2).includes('--json'), {
      code: 'internal_error',
      message,
      recovery: 'Retry the command; if the failure persists, upgrade or reinstall the CLI.',
    }, `slothhub: ${message}\n`),
  );
}
