import type {RunCliDependencies} from './cli.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isRuntimeNumber, isRuntimeString } from '@slothhub/domain/runtime-validation';

import { failForOutput } from './cliOutput.js';
import type { CliResult } from './types.js';

export interface CliPackageManifest {
  version?: string;
  engines?: {node?: string};
}

// Source (`src/`) and bundled (`dist/bin/`) entry points resolve the manifest
// from different depths.
export const readCliPackageManifest = (): CliPackageManifest | undefined => {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDirectory, '..', 'package.json'),
    join(moduleDirectory, '..', '..', 'package.json'),
  ];

  for (const candidate of candidates) {
    try {
      // SAFETY: fields are re-validated with isRuntimeString at the read sites,
      // so a malformed manifest degrades to undefined rather than misreporting.
      return JSON.parse(readFileSync(candidate, 'utf8')) as CliPackageManifest;
    } catch {
      // Try the next candidate depth.
    }
  }

  return undefined;
};

const readCliEnginesRange = (): string | undefined => {
  const range = readCliPackageManifest()?.engines?.node;
  return isRuntimeString(range) && range.trim().length > 0 ? range.trim() : undefined;
};

const parseVersionTriple = (value: string): [number, number, number] | undefined => {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(value.trim());
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

// engines.node is declared as `>=x.y.z`; an unparseable range or runtime
// version fails open so a packaging quirk never blocks a supported runtime.
export const isSupportedNodeVersion = (current: string, enginesRange: string): boolean => {
  const requirement = />=\s*(\d+\.\d+\.\d+)/u.exec(enginesRange);
  const have = parseVersionTriple(current);
  const want = requirement ? parseVersionTriple(requirement[1]) : undefined;
  if (!have || !want) return true;
  for (let index = 0; index < 3; index += 1) {
    if (have[index] !== want[index]) return have[index] > want[index];
  }
  return true;
};

// One line naming only the requirement — never the current version or any
// other environment detail.
export const unsupportedNodeVersionMessage = (enginesRange: string): string =>
  `slothhub requires Node.js ${enginesRange}.\n`;

export interface SlothhubBinDependencies {
  nodeVersion?: string;
  writeStdout?: RunCliDependencies['writeStdout'];
  enginesRange?: string;
  loadCli?: () => Promise<{runCli: (args: string[], dependencies?: RunCliDependencies) => Promise<CliResult>}>;
}

// Keeping the CLI behind a lazy import guarantees an unsupported runtime
// exits before any command module — and therefore any fetch — can run.
export const runSlothhubBin = async (
  args: string[],
  dependencies: SlothhubBinDependencies = {},
): Promise<CliResult> => {
  const enginesRange = dependencies.enginesRange ?? readCliEnginesRange();
  const nodeVersion = dependencies.nodeVersion ?? process.versions.node;

  if (enginesRange && !isSupportedNodeVersion(nodeVersion, enginesRange)) {
    const message = unsupportedNodeVersionMessage(enginesRange);
    return failForOutput(
      args.includes('--json'),
      {
        code: 'unsupported_runtime',
        message: message.trimEnd(),
        recovery: 'Run slothhub on a supported Node.js version and retry.',
      },
      message,
    );
  }

  const loadCli = dependencies.loadCli ?? (() => import('./cli.js'));
  const { runCli } = await loadCli();
  return dependencies.writeStdout ? runCli(args, {writeStdout: dependencies.writeStdout}) : runCli(args);
};

// A broken pipe (`slothhub ... | head`) must not surface a stack trace. The
// intended exit code is already set before writes happen, so an EPIPE exits
// with it. Any other stream error still throws.
export const guardPipeErrors = (stream: NodeJS.WritableStream): void => {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE') throw error;
    process.exit(isRuntimeNumber(process.exitCode) ? process.exitCode : 0);
  });
};
