import {TOOL_LOOKUP_NAMESPACE_VALUES} from '@slothhub/domain/tool-lookup';
import {CLI_COMMAND_SPECS, CLI_FLAG_SPECS, isCliFlagRelevantToHelp} from './cliSpec.js';

const TOP_LEVEL_EXAMPLES = ['slothhub search "postgres hosting"', 'slothhub implement supabase --host claude_code', 'slothhub feedback missing-tool "No Rust HTTP clients are listed"'];
const COMMON_FLAGS = new Set(['--json', '--pricing', '--platform', '--category', '--kind', '--limit']);

export const helpText = (name?: string, subcommand?: string): string => {
  const command = CLI_COMMAND_SPECS.find((spec) => spec.name === name);
  const selected = command?.subcommands?.find((spec) => spec.name === subcommand) ?? command;
  const rows = selected ? selected.subcommands ?? [selected] : CLI_COMMAND_SPECS.filter((spec) => spec.name !== 'help');
  const width = Math.max(...rows.map((row) => row.usage.length));
  const renderRows = (more: boolean) => rows.filter((row) => Boolean(row.more) === more).map((row) => `  ${row.usage.padEnd(width)}  ${row.description}`);
  const options = CLI_FLAG_SPECS.filter((spec) => spec.kind !== 'help' && (command ? isCliFlagRelevantToHelp(spec, command.name, subcommand) : COMMON_FLAGS.has(spec.names[0])));
  const optionWidth = Math.max('--version'.length, ...options.map((row) => row.usage.length));
  const examples = selected ? selected.examples ?? [] : TOP_LEVEL_EXAMPLES;
  return [
    `Usage: slothhub ${selected?.usage ?? '<command>'} [options]`, '',
    ...(examples.length ? ['Examples:', ...examples.map((example) => `  ${example}`), ''] : []),
    'Commands:',
    ...(selected ? rows.map((row) => `  ${row.usage.padEnd(width)}  ${row.description}`) : renderRows(false)),
    ...(!selected ? ['', 'More commands:', ...renderRows(true)] : []), '',
    command ? 'Options:' : 'Common options:',
    ...options.map((row) => `  ${row.usage.padEnd(optionWidth)}  ${row.description}`),
    `  ${'--help'.padEnd(optionWidth)}  Show help for any command`,
    ...(!command ? [`  ${'--version'.padEnd(optionWidth)}  Print the CLI version`] : []), '',
    ...(command?.name === 'tool' ? ['Accepts a slug or namespace:value. Namespaces:', `  ${TOOL_LOOKUP_NAMESPACE_VALUES.join(', ')}`, ''] : []),
    ...(!command ? ['Run slothhub <command> --help for all command options.', 'Run slothhub tool --help for identifier namespaces.', ''] : []),
    'Exit codes: 0 success; 1 runtime failure; 2 invalid input; 3 not found; 4 confirmation required; 5 unavailable, retry later.',
    '--json failures: {"ok":false,"code":"...","message":"...","recovery":"..."}',
  ].join('\n') + '\n';
};
