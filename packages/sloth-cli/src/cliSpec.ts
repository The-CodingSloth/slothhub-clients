import {AGENT_INTERFACE_KIND_VALUES} from '@slothhub/domain/agent-interface';
import {AGENT_SEARCH_INTEGRATION_CONNECTION_VALUES, AGENT_SEARCH_PLATFORM_VALUES, AGENT_SEARCH_PRICING_VALUES, type PublicAgentSearchFilters} from '@slothhub/domain/agent-search';
import {AGENT_SETUP_RECIPE_HOST_VALUES, AGENT_SETUP_RECIPE_CONFIG_HOST_VALUES} from '@slothhub/domain/mcp-registry';
import {RESOURCE_KIND_VALUES} from '@slothhub/domain/resource-kind';
import {PACKAGE_REGISTRY_VALUES} from '@slothhub/domain/registry-handoffs';
import {SECURITY_CAPABILITY_VALUES} from '@slothhub/domain/security-capability';
import {SOURCE_AVAILABILITY_FILTER_VALUES} from '@slothhub/domain/source-availability-filter';

/**
 * The CLI surface as one declarative table. `parseArgs`, `helpText()`, and
 * the shell-completion generators all read these rows so parsing, help, and
 * completions cannot drift apart.
 */

type CliFilterTarget = Exclude<
  keyof Omit<PublicAgentSearchFilters, 'query' | 'limit'>,
  'verified' | 'languages'
>;

type CliFlagSpecShared = {
  /** Canonical flag first; any aliases follow. */
  readonly names: readonly string[];
  /** Rendered usage fragment for the Options section, e.g. '--pricing <value>'. */
  readonly usage: string;
  readonly description: string;
  /** Closed value set completed after the flag; omit for free-form values. */
  readonly values?: readonly string[];
};

export type CliFlagSpec = CliFlagSpecShared &
  (
    | {readonly kind: 'boolean'; readonly target: 'json' | 'noCache' | 'force' | 'yes' | 'summary'}
    | {
        readonly kind: 'value';
        readonly target:
          | 'baseUrl'
          | 'host'
          | 'forText'
          | 'output'
          | 'fromInventory'
          | 'feedbackTool'
          | 'feedbackField'
          | 'evidenceUrl'
          | 'feedbackQuery'
          | 'reportedBy'
          | 'runSteps';
      }
    | {
        readonly kind: 'csv';
        readonly target:
          | 'requiredIntegrations'
          | 'requiredPlatforms'
          | 'requiredAgentInterfaceKinds';
      }
    | {
        readonly kind: 'number';
        readonly target: 'limit' | 'offset';
        readonly invalidTarget: 'invalidLimit' | 'invalidOffset';
      }
    | {readonly kind: 'language'; readonly target: 'languages'}
    | {readonly kind: 'filter'; readonly target: CliFilterTarget}
    | {readonly kind: 'filterBoolean'; readonly target: 'verified'}
    | {readonly kind: 'help'}
  );

export const CLI_FLAG_SPECS: readonly CliFlagSpec[] = [
  {names: ['--language'], kind: 'language', target: 'languages', usage: '--language <id>', description: 'Require recorded language support; repeat to match any selected ID (for example python or typescript)'},
  {
    names: ['--host'],
    kind: 'value',
    target: 'host',
    usage: '--host <agent-host>',
    description: `Agent Host for setup (${AGENT_SETUP_RECIPE_HOST_VALUES.join(', ')})`,
    values: AGENT_SETUP_RECIPE_HOST_VALUES,
  },
  {names: ['--run'], kind: 'value', target: 'runSteps', usage: '--run <steps>', description: 'Run these implement steps, for example 1 or 1,3, after confirmation'},
  {names: ['--yes'], kind: 'boolean', target: 'yes', usage: '--yes', description: 'Run implement steps without a confirmation prompt'},
  {names: ['--tool'], kind: 'value', target: 'feedbackTool', usage: '--tool <slug>', description: 'Tool the feedback is about'},
  {names: ['--field'], kind: 'value', target: 'feedbackField', usage: '--field <name>', description: 'Fact that is wrong, for example pricing'},
  {names: ['--evidence'], kind: 'value', target: 'evidenceUrl', usage: '--evidence <https-url>', description: 'Official source that shows the correct fact'},
  {names: ['--query'], kind: 'value', target: 'feedbackQuery', usage: '--query <text>', description: 'What you searched for (missing-tool)'},
  {names: ['--as'], kind: 'value', target: 'reportedBy', usage: '--as <human|agent>', description: 'Who is reporting (default human)', values: ['human', 'agent']},
  {
    names: ['--json'],
    kind: 'boolean',
    target: 'json',
    usage: '--json',
    description:
      'Emit parseable JSON',
  },
  {
    names: ['--summary'],
    kind: 'boolean',
    target: 'summary',
    usage: '--summary',
    description: 'With tool: decision facts only (pricing and billing, license, runtime, limits, agent interfaces); about 10 times smaller than full detail',
  },
  {
    names: ['--base-url'],
    kind: 'value',
    target: 'baseUrl',
    usage: '--base-url <url>',
    description: 'Use a local or preview SlothHub site',
  },
  {
    names: ['--for'],
    kind: 'value',
    target: 'forText',
    usage: '--for <text>',
    description: 'Requirements text for recommend',
  },
  {
    names: ['--no-cache'],
    kind: 'boolean',
    target: 'noCache',
    usage: '--no-cache',
    description: 'Bypass leaf caches; still verify the feed index',
  },
  {
    names: ['--pricing'],
    kind: 'filter',
    target: 'pricing',
    usage: '--pricing <value>',
    description: 'Filter search by pricing',
    values: AGENT_SEARCH_PRICING_VALUES,
  },
  {
    names: ['--platform'],
    kind: 'filter',
    target: 'platform',
    usage: '--platform <value>',
    description: 'Filter search by platform',
    values: AGENT_SEARCH_PLATFORM_VALUES,
  },
  {
    names: ['--category'],
    kind: 'filter',
    target: 'category',
    usage: '--category <slug>',
    description: 'Filter search by category',
  },
  {
    names: ['--tag'],
    kind: 'filter',
    target: 'tag',
    usage: '--tag <slug>',
    description: 'Filter search by tag',
  },
  {
    names: ['--use-case', '--useCase'],
    kind: 'filter',
    target: 'useCase',
    usage: '--use-case <slug>',
    description: 'Filter search by use case',
  },
  {
    names: ['--kind', '--resource-kind', '--resourceKind'],
    kind: 'filter',
    target: 'resourceKind',
    usage: '--kind <value>',
    description: 'Filter search by resource kind',
    values: RESOURCE_KIND_VALUES,
  },
  {
    names: ['--package-registry'],
    kind: 'filter',
    target: 'packageRegistry',
    usage: '--package-registry <v>',
    description: 'Filter by primary Resource Identity registry',
    values: PACKAGE_REGISTRY_VALUES,
  },
  {
    names: ['--security-capability', '--securityCapability'],
    kind: 'filter',
    target: 'securityCapability',
    usage: '--security-capability <v>',
    description: 'Filter by verified security capability',
    values: SECURITY_CAPABILITY_VALUES,
  },
  {
    names: ['--agent-interface-kind', '--agentInterfaceKind'],
    kind: 'filter',
    target: 'agentInterfaceKind',
    usage: '--agent-interface-kind <v>',
    description: 'Filter by agent interface kind',
    values: AGENT_INTERFACE_KIND_VALUES,
  },
  {
    names: ['--integration'],
    kind: 'filter',
    target: 'integration',
    usage: '--integration <slug-or-name>',
    description: 'Filter search by positive integration facts',
  },
  {
    names: ['--integration-connection', '--integrationConnection'],
    kind: 'filter',
    target: 'integrationConnection',
    usage: '--integration-connection native',
    description: 'Require a native integration connection',
    values: AGENT_SEARCH_INTEGRATION_CONNECTION_VALUES,
  },
  {
    names: ['--agent-host', '--agentHost'],
    kind: 'filter',
    target: 'agentHost',
    usage: '--agent-host <value>',
    description: 'Require a ready Setup Recipe for an Agent Host',
    values: AGENT_SETUP_RECIPE_CONFIG_HOST_VALUES,
  },
  {
    names: ['--source-availability', '--sourceAvailability'],
    kind: 'filter',
    target: 'sourceAvailability',
    usage: '--source-availability <value>',
    description: 'Filter by reviewed source availability (open_source for open-source Tools)',
    values: SOURCE_AVAILABILITY_FILTER_VALUES,
  },
  {
    names: ['--require-integration'],
    kind: 'csv',
    target: 'requiredIntegrations',
    usage: '--require-integration <slug[,slug]>',
    description: 'Require Integration evidence',
  },
  {
    names: ['--require-platform'],
    kind: 'csv',
    target: 'requiredPlatforms',
    usage: '--require-platform <value[,value]>',
    description: 'Require platform evidence',
    values: AGENT_SEARCH_PLATFORM_VALUES,
  },
  {
    names: ['--require-agent-interface'],
    kind: 'csv',
    target: 'requiredAgentInterfaceKinds',
    usage: '--require-agent-interface <kind[,kind]>',
    description: 'Require Agent Interface evidence',
    values: AGENT_INTERFACE_KIND_VALUES,
  },
  {
    names: ['--destination-health', '--destinationHealth'],
    kind: 'filter',
    target: 'destinationHealth',
    usage: '--destination-health healthy',
    description: 'Require a known healthy destination',
    values: ['healthy'],
  },
  {
    names: ['--verified'],
    kind: 'filterBoolean',
    target: 'verified',
    usage: '--verified',
    description: 'Require a valid human verification date',
  },
  {
    names: ['--last-checked-after', '--lastCheckedAfter'],
    kind: 'filter',
    target: 'lastCheckedAfter',
    usage: '--last-checked-after <YYYY-MM-DD>',
    description: 'Require an inclusive UTC check date',
  },
  {
    names: ['--limit'],
    kind: 'number',
    target: 'limit',
    invalidTarget: 'invalidLimit',
    usage: '--limit <n>',
    description: 'Maximum rows (1-50; list commands default to 20)',
  },
  {
    names: ['--offset'],
    kind: 'number',
    target: 'offset',
    invalidTarget: 'invalidOffset',
    usage: '--offset <n>',
    description: 'Rows to skip in search or list commands (default 0)',
  },
  {
    names: ['--from-inventory'],
    kind: 'value',
    target: 'fromInventory',
    usage: '--from-inventory <file|->',
    description: 'Map one package.json into manifest init selections',
  },
  {
    names: ['--output'],
    kind: 'value',
    target: 'output',
    usage: '--output <path>',
    description: 'Write receipt render or manifest init output atomically',
  },
  {
    names: ['--force'],
    kind: 'boolean',
    target: 'force',
    usage: '--force',
    description: 'Allow receipt render or manifest init output replacement',
  },
  {
    names: ['--help', '-h'],
    kind: 'help',
    usage: '--help',
    description: 'Show this help',
  },
];

/** Help follows the command that consumes each option, including action-specific writes. */
export const isCliFlagRelevantToHelp = (spec: CliFlagSpec, command: string, action?: string): boolean => {
  if (spec.kind === 'help') return false;
  if (spec.kind === 'filter' || spec.kind === 'filterBoolean' || spec.kind === 'language') {
    return ['search', 'recommend'].includes(command);
  }
  switch (spec.target) {
    case 'host': return command === 'setup' || command === 'feedback' || command === 'implement';
    case 'runSteps':
    case 'yes': return command === 'implement';
    case 'feedbackTool':
    case 'feedbackField':
    case 'evidenceUrl':
    case 'feedbackQuery':
    case 'reportedBy': return command === 'feedback';
    case 'forText': return command === 'recommend';
    case 'requiredIntegrations':
    case 'requiredPlatforms':
    case 'requiredAgentInterfaceKinds': return command === 'assembly';
    case 'fromInventory': return command === 'manifest' && (!action || action === 'init');
    case 'output':
    case 'force': return (command === 'receipt' && (!action || action === 'render')) || (command === 'manifest' && (!action || action === 'init'));
    case 'limit':
    case 'offset': return ['search', 'recommend', 'alternatives'].includes(command);
    default: return true;
  }
};

export const CLI_FLAG_BY_NAME: ReadonlyMap<string, CliFlagSpec> = new Map(
  CLI_FLAG_SPECS.flatMap((spec) =>
    spec.names.map((name) => [name, spec] as const),
  ),
);

export interface CliCommandSpec {
  readonly name: string;
  readonly more?: boolean;
  readonly usage: string;
  readonly description: string;
  /** Realistic invocations shown first in command help (clig.dev: lead with examples). */
  readonly examples?: readonly string[];
  /** Commands with subcommands list only the subcommand rows in help. */
  readonly subcommands?: readonly CliCommandSpec[];
}

export const CLI_COMMAND_SPECS: readonly CliCommandSpec[] = [
  {
    name: 'search',
    examples: ['slothhub search "postgres hosting"', 'slothhub search --kind mcp_server --pricing free', 'slothhub search "react hero" --kind ui_component --json'],
    usage: 'search [query]',
    description: 'Search Tools and indexed Articles',
  },
  {
    name: 'tool',
    examples: ['slothhub tool supabase', 'slothhub tool npm:zod --json'],
    usage: 'tool <slug|key>',
    description: 'Show Tool details and official sources by slug or namespace:value; add --summary for decision facts only',
  },
  {
    name: 'recommend',
    examples: ['slothhub recommend "auth for a Next.js app with SSO"', 'slothhub recommend "vector database" --pricing free --limit 3'],
    usage: 'recommend --for <r>',
    description: 'Recommend a tool for requirements',
  },
  {
    name: 'compare',
    examples: ['slothhub compare supabase neon', 'slothhub compare clerk workos --json'],
    usage: 'compare <tool...>',
    description: 'Compare tools with missing-data gaps',
  },
  {
    name: 'alternatives',
    examples: ['slothhub alternatives figma'],
    usage: 'alternatives [slug]',
    description: 'List sets or show alternatives for one Tool',
  },
  {
    name: 'setup',
    examples: ['slothhub setup --host cursor github-mcp-server'],
    usage: 'setup --host <agent-host> <slug>',
    description: 'Print one published Setup Recipe without installing or running it',
  },
  {
    name: 'implement',
    examples: ['slothhub implement zod', 'slothhub implement supabase --host claude_code', 'slothhub implement zod --run 1'],
    usage: 'implement <slug>',
    description: 'Print install commands, skills, host setup and examples; --run <steps> runs only allowlisted installs of packages this Tool names, after confirmation',
  },
  {
    name: 'component',
    examples: ['slothhub component spectrum-hero', 'slothhub component spectrum-hero --json'],
    usage: 'component <slug>',
    description: 'Print UI component files, license and install command without installing',
  },
  {
    name: 'feedback',
    examples: ['slothhub feedback missing-tool "No Rust HTTP clients are listed" --query "rust http client"', 'slothhub feedback wrong-fact "Dev seats cost $12 billed annually" --tool figma --field pricing --evidence https://www.figma.com/pricing/'],
    usage: 'feedback <kind> <message>',
    description: 'Send private feedback to the SlothHub team (wrong-fact, missing-tool, setup-worked, setup-failed, server-problem, suggestion)',
  },
  {
    name: 'doctor',
    examples: ['slothhub doctor', 'slothhub doctor --json'],
    usage: 'doctor',
    description: 'Show advertised catalog feed diagnostics',
  },
  {
    name: 'assembly',
    examples: ['slothhub assembly supabase vercel'],
    more: true,
    usage: 'assembly <tool...>',
    description: 'Check structured assembly evidence for 2-5 Tools',
  },
  {
    name: 'manifest',
    more: true,
    usage: 'manifest <action>',
    description: 'Create, validate, and render Project Tool pin manifests',
    subcommands: [
      {
        name: 'init',
        usage: 'manifest init <slug...>',
        description: 'Create a Project Tool pin manifest from public Tools',
      },
      {
        name: 'validate',
        usage: 'manifest validate [file]',
        description: 'Validate a Project Tool pin manifest offline',
      },
      {
        name: 'render',
        usage: 'manifest render [file]',
        description: 'Render a Project Tool pin manifest offline',
      },
    ],
  },
  {
    name: 'receipt',
    more: true,
    usage: 'receipt <action>',
    description: 'Validate and render decision receipts',
    subcommands: [
      {
        name: 'validate',
        usage: 'receipt validate <file|->',
        description: 'Validate a decision receipt offline',
      },
      {
        name: 'render',
        usage: 'receipt render <file|->',
        description: 'Render a decision receipt as Markdown',
      },
    ],
  },
  {
    name: 'completion',
    examples: ['slothhub completion zsh'],
    more: true,
    usage: 'completion <shell>',
    description: 'Print a static shell completion script (bash, zsh, fish, pwsh)',
  },
  {name: 'help', usage: 'help', description: 'Show this help'},
];
