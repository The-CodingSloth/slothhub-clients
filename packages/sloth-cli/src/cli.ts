import {isRuntimeString} from '@slothhub/domain/runtime-validation';
import {readCliPackageManifest} from './binRuntime.js';
import {ok} from './cliOutput.js';
import type {RunCliDependencies} from './cliCommands.js';
import type {CliResult} from './types.js';

export type {RunCliDependencies} from './cliCommands.js';

// These invocations need no catalog, network, or command schemas. Keep the
// complete argument parser in charge of every other invocation.
export const runCli = async (
  args: string[],
  dependencies: RunCliDependencies = {},
): Promise<CliResult> => {
  if (args.length === 0 || (args.length === 1 && ['--help', '-h', 'help'].includes(args[0]!))) {
    const {helpText} = await import('./cliHelp.js');
    return ok(helpText());
  }
  if (args.length === 1 && ['--version', '-v'].includes(args[0]!)) {
    const version = readCliPackageManifest()?.version;
    if (!isRuntimeString(version)) throw new Error('Unable to resolve @slothhub/cli package version.');
    return ok(`${version}\n`);
  }
  const {runCli: runCommand} = await import('./cliCommands.js');
  return runCommand(args, dependencies);
};
