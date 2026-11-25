import {buildToolContentPolicyLabels} from '@slothhub/domain/catalog-content-policy';
import {type CliOutputWriter} from './catalogStream.js';
import {AdvertisedCatalogFeedLimitError, InvalidAdvertisedCatalogUrlError} from '@slothhub/domain/advertised-catalog-feeds';
import {describeNetworkEnvironmentHint, redactNetworkEnvironmentSecrets, summarizeNetworkEnvironment} from '@slothhub/domain/network-environment';
import {isRuntimeString} from '@slothhub/domain/runtime-validation';
import {UnsupportedFeedVersionError} from '@slothhub/domain/feed-compatibility';
import {FeedHostBlockedError} from '@slothhub/domain/public-feed-http';
import {toToolDecisionSummary} from '@slothhub/domain/tool-decision-summary';
import {AgentSearchContractError, AgentSearchPayloadLimitError, serializeAgentSearchContractError, type PublicAgentSearchFilters} from '@slothhub/domain/agent-search';
import {checkToolAssembly, parseToolAssemblyRequirements, serializeToolAssemblyReport, type ToolAssemblyReport} from '@slothhub/domain/tool-assembly';
import {getAgentInterfaceKindLabel} from '@slothhub/domain/agent-interface';
import {getCachedToolLookupResolver, isValidToolPublicSlug, parseExplicitToolLookupReference, ToolLookupArtifactLimitError} from '@slothhub/domain/tool-lookup';
import {parseProjectToolPinManifest, PROJECT_TOOL_PIN_MANIFEST_DEFAULT_FILENAME, PROJECT_TOOL_PIN_MANIFEST_MAX_BYTES, renderProjectToolPinManifest} from '@slothhub/domain/project-tool-pin-manifest';
import {renderToolDecisionContextText} from '@slothhub/domain/tool-decision-context-markdown';
import {inspectCatalogDiagnostics, type AdvertisedFeedFetch} from './advertisedFeeds.js';
import {
  FeedClientError,
  DEFAULT_BASE_URL,
  FeedRequestTimeoutError,
  createFeedClient,
  defaultCacheDirectory,
  normalizeBaseUrl,
  resolveBaseUrl,
  type FetchJson,
  type FetchText} from './feedClient.js';
import {
  compareTools,
  renderComparisonDecisionFacts,
  type ComparisonResult,
  MAX_COMPARE_TOOLS,
} from './agentWorkflows.js';
import type {AgentToolDetail, AgentToolDetailFeed, CliResult} from './types.js';
import {formatTool, stripTerminalControls} from './catalogFormat.js';
import {readBoundedUtf8File} from './decisionReceiptFiles.js';
import {
  runRecommendCommand,
  runSearchCommand,
  validateAgentSearchCliRequest} from './agentSearchCli.js';
import {
  failForOutput,
  ioFailureContract,
  jsonLine,
  ok,
  safeDiagnostic} from './cliOutput.js';

import {readCliPackageManifest} from './binRuntime.js';
import {runDecisionReceiptCommand} from './decisionReceiptCli.js';
import {runManifestInitCommand} from './manifestInitCli.js';
import {explicitManifestNotice, locateDefaultManifest, type LocatedManifest} from './manifestFile.js';
import {runAlternativesCommand} from './alternativesCli.js';
import {runSetupCommand} from './setupCli.js';
import {runComponentCommand} from './componentCli.js';
import {runFeedbackCommand, type PostFeedback} from './feedbackCli.js';
import {findClosestName} from '@slothhub/domain/tool-lookup-suggestions';
import {runImplementCommand, type Confirm, type RunCommand} from './implementCli.js';
import {CLI_COMMAND_SPECS, CLI_FLAG_BY_NAME} from './cliSpec.js';
import {helpText} from './cliHelp.js';
import {
  COMPLETION_SHELLS,
  isCompletionShell,
  renderShellCompletionScript} from './shellCompletion.js';

interface ParsedArgs {
  help?: boolean;
  command?: string;
  positionals: string[];
  json: boolean;
  noCache: boolean;
  summary: boolean;
  baseUrl?: string;
  host?: string;
  limit?: number;
  invalidLimit?: string;
  offset?: number;
  invalidOffset?: string;
  forText?: string;
  output?: string;
  force: boolean;
  fromInventory?: string;
  feedbackTool?: string;
  feedbackField?: string;
  evidenceUrl?: string;
  feedbackQuery?: string;
  reportedBy?: string;
  runSteps?: string;
  yes: boolean;
  requiredIntegrations: string[];
  requiredPlatforms: string[];
  requiredAgentInterfaceKinds: string[];
  errors: string[];
  filters: Omit<PublicAgentSearchFilters, 'query' | 'limit'>;
}

export interface RunCliDependencies {
  writeStdout?: CliOutputWriter;
  fetchResponse?: AdvertisedFeedFetch;
  fetchJson?: FetchJson;
  fetchText?: FetchText;
  probeFetch?: AdvertisedFeedFetch;
  readTextFile?: (path: string, maxBytes: number) => Promise<string>;
  readReceiptSource?: (path: string) => Promise<string>;
  readInventorySource?: (path: string) => Promise<string>;
  writeReceiptOutput?: (path: string, contents: string, force: boolean) => Promise<void>;
  workingDirectory?: string;
  /** Send feedback; defaults to POST {baseUrl}/api/feedback. */
  postFeedback?: PostFeedback;
  /** Run one implement step without a shell; tests inject a fake. */
  runCommand?: RunCommand;
  confirm?: Confirm;
  isInteractive?: boolean;
  platform?: NodeJS.Platform;
}

const hasFeedHttpStatus = <ErrorValue>(error: ErrorValue, status: number, path: string): boolean =>
  error instanceof FeedClientError &&
  error.code === 'transport' &&
  error.httpStatus === status && error.path === path;
const isAliasLeafResponse = (error: Error): boolean =>
  error instanceof FeedClientError &&
  error.code === 'transport' &&
  error.path.startsWith('/api/tools/') &&
  error.httpStatus !== undefined &&
  (error.httpStatus === 404 || (error.httpStatus >= 300 && error.httpStatus < 400));
const isNotFoundError = <ErrorValue>(error: ErrorValue): boolean =>
  error instanceof Error &&
  !(error instanceof UnsupportedFeedVersionError) &&
  !(error instanceof FeedClientError && error.path === '/api/index.json') &&
  ((error instanceof CliError && error.code === 'not_found') ||
    /\b(?:HTTP )?404\b/.test(error.message));
const MAX_COMPARE_REFERENCES = 32;
const RETIRED_TOOL_RECOVERY = 'Search SlothHub for a current alternative.';

class RetiredToolLookupError extends Error {
  readonly code = 'retired' as const;
  readonly recovery = RETIRED_TOOL_RECOVERY;

  constructor(reference: string) {
    super(`Tool identity ${reference} is retired; no current public Tool exists.`);
    this.name = 'RetiredToolLookupError';
  }
}

// Typed command failure: the code selects the documented exit code through
// cliExitCodeForError, so lookup errors stop collapsing into feed_load_error.
class CliError extends Error {
  readonly recovery?: string;

  constructor(
    readonly code: string,
    message: string,
    recovery?: string,
  ) {
    super(message);
    this.name = 'CliError';
    this.recovery = recovery;
  }
}

const NOT_FOUND_RECOVERY = 'Run slothhub search <query> to find a valid slug.';

const notFound = (message: string, recovery = 'Verify the slug and try again.'): CliError =>
  new CliError('not_found', message, recovery);

/** Suggest the closest command, never run it: a suggestion is not confirmation. */
interface UnknownCommandFailure {code: 'invalid_input'; message: string; recovery: string; suggestion?: string}
const unknownCommandFailure = (command: string): UnknownCommandFailure => {
  const suggestion = findClosestName(command, CLI_COMMAND_SPECS.map((spec) => spec.name));
  if (!suggestion) return {code: 'invalid_input', message: `Unknown command: ${safeDiagnostic(command)}.`, recovery: 'Run slothhub --help for supported commands.'};
  return {
    code: 'invalid_input', suggestion,
    message: `Unknown command: ${safeDiagnostic(command)}. Did you mean ${suggestion}?`,
    recovery: `Run slothhub ${suggestion} --help, or slothhub --help for all commands.`,
  };
};

const readPackageVersion = (): string => {
  const version = readCliPackageManifest()?.version;
  if (isRuntimeString(version)) return version;
  throw new Error('Unable to resolve @slothhub/cli package version.');
};

const parseValueFlag = (args: string[], index: number, flag: string, errors: string[]): string | undefined => {
  const value = args[index + 1];

  if (!value || value.startsWith('--')) {
    errors.push(`${flag} requires a value.`);
    return undefined;
  }

  return value;
};

const parseArgs = (args: string[]): ParsedArgs => {
  const parsed: ParsedArgs = {
    positionals: [],
    json: false,
    noCache: false,
    summary: false,
    force: false,
    yes: false,
    requiredIntegrations: [],
    requiredPlatforms: [],
    requiredAgentInterfaceKinds: [],
    errors: [],
    filters: {},
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const spec = CLI_FLAG_BY_NAME.get(arg);

    if (!spec) {
      if (arg.startsWith('--')) {
        parsed.errors.push(`Unknown flag: ${arg}. See --help for supported options.`);
      } else if (!parsed.command) {
        parsed.command = arg;
      } else {
        parsed.positionals.push(arg);
      }
      continue;
    }

    switch (spec.kind) {
      case 'boolean':
        parsed[spec.target] = true;
        break;
      case 'help':
        parsed.help = true;
        break;
      case 'filterBoolean':
        parsed.filters[spec.target] = true;
        break;
      case 'language': {
        const value = parseValueFlag(args, index, arg, parsed.errors);
        if (value) {
          parsed.filters.languages = [...new Set([...(parsed.filters.languages ?? []), value])];
          index += 1;
        }
        break;
      }
      case 'value':
      case 'filter': {
        const value = parseValueFlag(args, index, arg, parsed.errors);
        if (value) {
          if (spec.kind === 'value') parsed[spec.target] = value;
          else parsed.filters[spec.target] = value;
          index += 1;
        }
        break;
      }
      case 'csv': {
        const value = parseValueFlag(args, index, arg, parsed.errors);
        if (value) {
          parsed[spec.target].push(...value.split(','));
          index += 1;
        }
        break;
      }
      case 'number': {
        const rawValue = parseValueFlag(args, index, arg, parsed.errors);
        if (rawValue) {
          const value = Number(rawValue);
          if (Number.isFinite(value)) parsed[spec.target] = value;
          else parsed[spec.invalidTarget] = rawValue;
          index += 1;
        }
        break;
      }
    }
  }

  return parsed;
};

const formatComparisonFact = (fact: {
  state: string;
  comparator?: string;
  value?: number;
  unit?: string;
}): string =>
  fact.state === 'bounded'
    ? `${(fact.comparator ?? '').replaceAll('_', ' ')} ${fact.value} ${fact.unit}`
    : fact.state.replaceAll('_', ' ');

const formatComparison = (result: ComparisonResult): string =>
  [
    'Tool comparison',
    ...result.tools.map((tool) =>
      [
        '',
        `${tool.name} (${tool.slug})`,
        tool.description,
        `Pricing: ${tool.pricing ?? 'Not listed'}`,
        ...renderComparisonDecisionFacts(tool),
        `Resource kind: ${tool.resourceKind}`,
        `Platforms: ${tool.platforms.join(', ') || 'unknown'}`,
        `Agent interfaces: ${
          tool.agentInterfaceKinds.length > 0
            ? tool.agentInterfaceKinds.map(getAgentInterfaceKindLabel).join(', ')
            : 'unknown'
        }`,
        `Features: ${tool.keyFeatures.length > 0 ? tool.keyFeatures.join(', ') : 'unknown'}`,
        renderToolDecisionContextText(tool),
        ...(tool.integrations === undefined ? ['Integrations: unknown; no structured assessment recorded.'] : []),
        ...(tool.securityPrivacyPosture?.securityCapabilities === undefined ? ['Security capabilities: unknown; no structured assessment recorded.'] : []),
        tool.productLimits.state === 'listed'
          ? [
              'Product limits:',
              ...tool.productLimits.groups.map((group) => {
                const scopes = [
                  group.planScope ? `plan: ${group.planScope}` : '',
                  group.deploymentScope ? `deployment: ${group.deploymentScope}` : '',
                ]
                  .filter(Boolean)
                  .join(', ');
                return `- ${group.metric}${scopes ? ` (${scopes})` : ''}: ${group.facts
                  .map(formatComparisonFact)
                  .join('; ')}${group.ambiguous ? ' — ambiguous sources' : ''}`;
              }),
            ].join('\n')
          : 'Product limits: unknown',
        tool.runtimeRequirements.state === 'listed'
          ? [
              'Runtime requirements:',
              ...tool.runtimeRequirements.requirements.map(
                (requirement) =>
                  `- ${requirement.subjectName} (${requirement.subjectKind}): ${requirement.status} | environment ${requirement.environmentRange}${requirement.toolRange ? ` | Tool ${requirement.toolRange}` : ''}`,
              ),
            ].join('\n')
          : 'Runtime requirements: unknown',
        `Source: ${tool.detailUrl}`,
      ].join('\n')
    ),
    ...(result.gaps.length > 0 ? ['', 'Missing data:', ...result.gaps.map((gap) => `- ${gap}`)] : []),
  ].flatMap((line) => line.split('\n')).map(stripTerminalControls).join('\n') + '\n';

const formatToolAssembly = (report: ToolAssemblyReport): string =>
  [
    `Tool Assembly evidence (${report.identity})`,
    `Selected: ${report.selectedTools.map((tool) => `${tool.name} (${tool.slug})`).join(', ') || 'none resolved'}`,
    '',
    'Confirmed overlap:',
    ...(report.confirmedOverlap.length > 0
      ? report.confirmedOverlap.map((entry) => `- ${entry.label}: ${entry.reason}`)
      : ['- None. Missing evidence never becomes a positive claim.']),
    '',
    'Explicit conflicts:',
    ...(report.explicitConflicts.length > 0
      ? report.explicitConflicts.map((entry) => `- ${entry.label}: ${entry.reason}`)
      : ['- None found in structured negative facts.']),
    '',
    'Missing evidence:',
    ...(report.missingEvidence.length > 0
      ? report.missingEvidence.map((entry) => `- ${entry.label}: ${entry.reason}`)
      : ['- None in the evaluated facts.']),
    ...(report.unresolvedTools.length > 0
      ? [
          '',
          'Unresolved Tools:',
          ...report.unresolvedTools.map((tool) => `- ${tool.slug}: ${tool.reason}`),
        ]
      : []),
    '',
    report.disclaimer,
  ].join('\n') + '\n';


export const runCli = async (
  args: string[],
  dependencies: RunCliDependencies = {}
): Promise<CliResult> => {
  if (args.length === 1 && (args[0] === '--version' || args[0] === '-v')) {
    return ok(`${readPackageVersion()}\n`);
  }
  const parsed = parseArgs(args);
  if (parsed.errors.length > 0) {
    return failForOutput(parsed.json, {
      code: 'invalid_input',
      message: parsed.errors.join('\n'),
      recovery: 'Correct the command arguments and try again.',
    });
  }

  const requestedCommand = parsed.command === 'help' ? parsed.positionals[0] : parsed.command;
  if (requestedCommand && !CLI_COMMAND_SPECS.some((spec) => spec.name === requestedCommand)) {
    const failure = unknownCommandFailure(requestedCommand);
    return failForOutput(parsed.json, failure, `${failure.message} ${failure.recovery}\n`);
  }
  if (parsed.help || parsed.command === 'help') {
    return ok(helpText(
      parsed.command === 'help' ? parsed.positionals[0] : parsed.command,
      parsed.command === 'help' ? parsed.positionals[1] : parsed.positionals[0],
    ));
  }


  if (parsed.host && parsed.command !== 'setup' && parsed.command !== 'feedback' && parsed.command !== 'implement' && parsed.command !== 'help') {
    return failForOutput(parsed.json, {
      code: 'invalid_input',
      message: '--host is only supported by setup and feedback.',
      recovery: 'Use slothhub setup --host <agent-host> <slug>.',
    });
  }

  if (parsed.summary && parsed.command !== 'tool') {
    return failForOutput(parsed.json, {
      code: 'invalid_input',
      message: '--summary is only supported by tool.',
      recovery: 'Use slothhub tool <slug> --summary or remove --summary.',
    });
  }

  const isReceiptRender = parsed.command === 'receipt' && parsed.positionals[0] === 'render';
  const isManifestInit = parsed.command === 'manifest' && parsed.positionals[0] === 'init';
  if (parsed.output && !isReceiptRender && !isManifestInit) {
    return failForOutput(parsed.json, {
      code: 'invalid_input',
      message: '--output is only supported by receipt render and manifest init.',
      recovery: 'Remove --output or use receipt render or manifest init.',
    });
  }
  if (parsed.force && !isReceiptRender && !isManifestInit) {
    return failForOutput(parsed.json, {
      code: 'invalid_input',
      message: '--force is only supported by receipt render and manifest init.',
      recovery: 'Remove --force or use receipt render or manifest init.',
    });
  }
  if (parsed.fromInventory && !isManifestInit) {
    return failForOutput(parsed.json, {
      code: 'invalid_input',
      message: '--from-inventory is only supported by manifest init.',
      recovery: 'Remove --from-inventory or use manifest init.',
    });
  }

  if (parsed.command === 'completion') {
    const shell = parsed.positionals[0];
    if (parsed.positionals.length !== 1 || !isCompletionShell(shell)) {
      const message = `Usage: slothhub completion <${COMPLETION_SHELLS.join('|')}>.`;
      return failForOutput(parsed.json, {
        code: 'invalid_input',
        message,
        recovery: `Pass a supported shell: ${COMPLETION_SHELLS.join(', ')}.`,
      }, `${message}\n`);
    }
    return ok(renderShellCompletionScript(shell));
  }

  if (parsed.command === 'search' || parsed.command === 'recommend') {
    const query = parsed.command === 'search'
      ? parsed.positionals.join(' ').trim()
      : (parsed.forText ?? parsed.positionals.join(' ')).trim()
    try {
      validateAgentSearchCliRequest({
        filters: parsed.filters,
        invalidLimit: parsed.invalidLimit,
        json: parsed.json,
        query,
        limit: parsed.limit,
      });
    } catch (error) {
      if (error instanceof AgentSearchContractError) {
        const payload = serializeAgentSearchContractError(error);
        return failForOutput(
          parsed.json,
          payload,
          `${payload.code}: ${safeDiagnostic(payload.message)} ${safeDiagnostic(payload.recovery)}\n`,
        );
      }
      throw error;
    }
  }

  if (parsed.command === 'receipt') {
    return runDecisionReceiptCommand(
      {
        action: parsed.positionals[0],
        sourcePath: parsed.positionals[1],
        extraArguments: parsed.positionals.slice(2),
        json: parsed.json,
        output: parsed.output,
        force: parsed.force,
      },
      {
        readSource: dependencies.readReceiptSource,
        writeOutput: dependencies.writeReceiptOutput,
      },
    );
  }

  if (parsed.command === 'manifest' && parsed.positionals[0] !== 'init') {
    const [action, explicitPath, ...extra] = parsed.positionals;
    if ((action !== 'validate' && action !== 'render') || extra.length > 0) {
      const usage = `Usage: slothhub manifest <validate|render> [file] [--json]\n       slothhub manifest init <slug...> [--from-inventory <package.json|->] [--output ${PROJECT_TOOL_PIN_MANIFEST_DEFAULT_FILENAME}] [--force] [--json]\n`;
      return failForOutput(parsed.json, {
        code: 'invalid_input',
        message: 'Manifest requires validate [file], render [file], or init <slug...>.',
        recovery: 'Run slothhub manifest --help for the supported forms.',
      }, usage);
    }

    let located: LocatedManifest | null;
    try {
      located = explicitPath
        ? {path: explicitPath, display: explicitPath, notice: explicitManifestNotice(explicitPath)}
        : await locateDefaultManifest(dependencies.workingDirectory ?? process.cwd());
    } catch (error) {
      const message = safeDiagnostic(error instanceof Error ? error.message : error);
      return failForOutput(parsed.json, {
        ...ioFailureContract(error, 'source_unreadable', 'Pass the manifest path explicitly and try again.'),
        message: `Manifest lookup failed: ${message}${/[.!?]$/u.test(message) ? '' : '.'}`,
      });
    }
    if (!located) {
      const missing = {
        code: 'manifest_not_found',
        message: `No ${PROJECT_TOOL_PIN_MANIFEST_DEFAULT_FILENAME} in the working directory.`,
        recovery: 'Pass the manifest path, or create one with slothhub manifest init <slug...>.',
      };
      return failForOutput(parsed.json, missing, `manifest_not_found: ${missing.message} ${missing.recovery}\n`);
    }
    const notice = located.notice ? safeDiagnostic(located.notice) : undefined;
    const withNotice = (result: CliResult): CliResult => notice && !parsed.json
      ? {...result, stderr: `${result.stderr}${notice}\n`}
      : result;

    let raw: string;
    try {
      raw = await (dependencies.readTextFile ?? ((sourcePath, maxBytes) =>
        readBoundedUtf8File(sourcePath, maxBytes, 'Project Tool pin manifest')))(
        located.path,
        PROJECT_TOOL_PIN_MANIFEST_MAX_BYTES,
      );
    } catch (error) {
      const message = safeDiagnostic(error instanceof Error ? error.message : error);
      return failForOutput(parsed.json, {
        ...ioFailureContract(error, 'source_unreadable', 'Provide a readable regular file and try again.'),
        message: `Manifest read failed: ${message}${/[.!?]$/u.test(message) ? '' : '.'}`,
      });
    }

    const result = parseProjectToolPinManifest(raw);
    if (!result.ok) {
      return withNotice(failForOutput(parsed.json, {
        code: 'invalid_manifest',
        message: `Manifest validation failed: ${result.reason}.`,
        reason: result.reason,
        recovery: 'Fix the manifest contents and retry, or rebuild it with slothhub manifest init.',
        ...(notice ? {notice} : undefined),
      }));
    }
    // JSON output carries the rename advice as a field; text output prints it on stderr.
    const source = {path: located.display, ...(notice ? {notice} : undefined)};

    if (action === 'validate') {
      const summary = {
        artifact: result.value.artifact,
        valid: true,
        version: result.value.version,
        toolCount: result.value.tools.length,
      };
      return withNotice(ok(parsed.json
        ? jsonLine({...summary, ...source})
        : `Valid Project Tool pin manifest v${summary.version} with ${summary.toolCount} tool${summary.toolCount === 1 ? '' : 's'}.\n`));
    }

    const rendered = renderProjectToolPinManifest(result.value);
    return withNotice(ok(parsed.json
      ? jsonLine({artifact: result.value.artifact, version: result.value.version, rendered, ...source})
      : rendered));
  }

  let client: ReturnType<typeof createFeedClient>;

  try {
    client = createFeedClient({
      baseUrl: parsed.baseUrl,
      noCache: parsed.noCache,
      fetchJson: dependencies.fetchJson,
      fetchText: dependencies.fetchText,
    });
  } catch (error) {
    const message = safeDiagnostic(error instanceof Error ? error.message : String(error));
    return failForOutput(parsed.json, {
      code: 'invalid_input',
      message,
      recovery: 'Use a supported feed base URL and try again.',
    });
  }

  const resolveToolReference = async (reference: string | undefined): Promise<string> => {
    if (!reference) {
      throw new CliError('invalid_input', 'Tool slug is required.', 'Pass a public Tool slug or a supported namespace:value key.');
    }

    const explicitLookup = parseExplicitToolLookupReference(reference);
    if (explicitLookup.kind === 'invalid_input') {
      throw new CliError('invalid_input', explicitLookup.message, 'Use a public Tool slug or a supported namespace:value key.');
    }
    let artifact;
    try {
      artifact = await client.toolLookup();
    } catch (error) {
      if (
        explicitLookup.kind === 'not_explicit' &&
        (hasFeedHttpStatus(error, 404, '/api/tool-lookup.json') || isNotFoundError(error))
      ) {
        throw notFound(`Tool not found: ${reference}`, NOT_FOUND_RECOVERY);
      }
      throw error;
    }
    if (!artifact) {
      if (explicitLookup.kind === 'lookup') {
        throw new CliError(
          'capability_unavailable',
          'Exact Tool lookup is unavailable from this SlothHub feed version.',
          'Use the public Tool slug or retry against a current SlothHub feed.',
        );
      }
      return reference;
    }

    const outcome = getCachedToolLookupResolver(artifact).resolve(
      explicitLookup.kind === 'lookup'
        ? explicitLookup.input
        : {namespace: 'slug', value: reference},
    );
    if (outcome.kind === 'resolved' || outcome.kind === 'aliased') return outcome.tool.slug;
    if (outcome.kind === 'ambiguous') {
      throw new CliError(
        'ambiguous',
        `Tool lookup is ambiguous: ${outcome.candidates.map((candidate) => candidate.slug).join(', ')}`,
        'Use the exact public Tool slug instead of a shared alias.',
      );
    }
    if (outcome.kind === 'invalid_input') {
      throw new CliError('invalid_input', outcome.message, 'Use a public Tool slug or a supported namespace:value key.');
    }
    if (outcome.kind === 'capability_unavailable') {
      throw new CliError(
        'capability_unavailable',
        'Exact Tool lookup is unavailable from this SlothHub feed version.',
        'Use the public Tool slug or retry against a current SlothHub feed.',
      );
    }
    if (outcome.kind === 'retired' && explicitLookup.kind === 'lookup') {
      throw new RetiredToolLookupError(
        `${explicitLookup.input.namespace}:${explicitLookup.input.value.trim()}`,
      );
    }
    throw notFound(`Tool not found: ${reference}`, NOT_FOUND_RECOVERY);
  };

  const loadToolDetailFeed = async (reference: string | undefined): Promise<AgentToolDetailFeed> => {
    if (!reference) {
      throw new CliError('invalid_input', 'Tool slug is required.', 'Pass a public Tool slug or a supported namespace:value key.');
    }
    const loadExpectedTool = async (slug: string): Promise<AgentToolDetailFeed> => {
      const feed = await client.tool(slug);
      if (feed.data.slug !== slug) {
        throw new Error(
          `Tool detail identity mismatch: requested ${safeDiagnostic(slug)}, received ${safeDiagnostic(feed.data.slug)}.`,
        );
      }
      return feed;
    };
    const loadCanonicalTool = async (slug: string): Promise<AgentToolDetailFeed> => {
      try {
        return await loadExpectedTool(slug);
      } catch (error) {
        if (hasFeedHttpStatus(error, 404, `/api/tools/${slug}.json`)) throw notFound(`Tool not found: ${slug}`, NOT_FOUND_RECOVERY);
        throw error;
      }
    };
    const explicitLookup = parseExplicitToolLookupReference(reference);
    if (explicitLookup.kind === 'not_explicit') {
      try {
        return await loadExpectedTool(reference);
      } catch (error) {
        if (!(error instanceof Error) || !isAliasLeafResponse(error)) throw error;
        const slug = await resolveToolReference(reference);
        if (slug === reference) {
          if (hasFeedHttpStatus(error, 404, `/api/tools/${reference}.json`)) {
            throw notFound(`Tool not found: ${reference}`, NOT_FOUND_RECOVERY);
          }
          throw error;
        }
        return loadCanonicalTool(slug);
      }
    }
    return loadCanonicalTool(await resolveToolReference(reference));
  };

  const loadToolDetail = async (reference: string | undefined): Promise<AgentToolDetail> =>
    (await loadToolDetailFeed(reference)).data;

  // Error text must never echo environment values: proxy URLs can embed
  // credentials, and a configured base URL or cache path is private setup
  // detail. Redact the configured base URL (and its hostname) on top of the
  // shared proxy-value redaction before any message reaches an envelope.
  const redactCliErrorMessage = (message: string): string => {
    let sanitized = redactNetworkEnvironmentSecrets(message, process.env);
    const configuredBaseUrl = parsed.baseUrl ?? process.env.SLOTHHUB_BASE_URL;
    if (isRuntimeString(configuredBaseUrl)) {
      const candidates = new Set([configuredBaseUrl.trim(), normalizeBaseUrl(configuredBaseUrl)]);
      try {
        candidates.add(new URL(configuredBaseUrl).hostname);
      } catch {
        // A non-URL base value still gets redacted verbatim.
      }
      for (const candidate of candidates) {
        if (candidate.length >= 4) sanitized = sanitized.split(candidate).join('[redacted base URL]');
      }
    }
    // Absolute paths are private setup detail. The resolved cache directory is
    // redacted first because it contains the HOME/XDG values it derives from.
    for (const candidate of [
      defaultCacheDirectory(),
      process.env.XDG_CACHE_HOME,
      process.env.HOME,
      process.env.USERPROFILE,
    ]) {
      if (isRuntimeString(candidate) && candidate.length >= 4) {
        sanitized = sanitized.split(candidate).join('[redacted path]');
      }
    }
    return safeDiagnostic(sanitized);
  };

  try {
    if (!parsed.command || parsed.command === 'help' || parsed.command === '--help') {
      return ok(helpText());
    }

    if (parsed.command === 'manifest') {
      return await runManifestInitCommand(
        {
          references: parsed.positionals.slice(1),
          fromInventory: parsed.fromInventory,
          output: parsed.output,
          force: parsed.force,
          json: parsed.json,
        },
        {
          loadLookup: client.toolLookup,
          loadCatalogTools: client.projectManifestTools,
          readInventorySource: dependencies.readInventorySource,
          writeOutput: dependencies.writeReceiptOutput,
          workingDirectory: dependencies.workingDirectory,
          producerVersion: readPackageVersion(),
        },
      );
    }

    if (parsed.command === 'search') {
      const query = parsed.positionals.join(' ').trim();
      return await runSearchCommand(client, {
        filters: parsed.filters,
        json: parsed.json,
        limit: parsed.limit,
        offset: parsed.offset,
        invalidOffset: parsed.invalidOffset,
        query,
      });
    }

    if (parsed.command === 'alternatives') {
      return await runAlternativesCommand(client, {
        json: parsed.json,
        slug: parsed.positionals[0],
        extraArguments: parsed.positionals.slice(1),
        limit: parsed.limit,
        offset: parsed.offset,
        invalidLimit: parsed.invalidLimit,
        invalidOffset: parsed.invalidOffset,
      });
    }

    if (parsed.command === 'setup') {
      return await runSetupCommand(client, {
        host: parsed.host,
        positionals: parsed.positionals,
        json: parsed.json,
        baseUrl: resolveBaseUrl(parsed.baseUrl),
      });
    }

    if (parsed.command === 'implement') {
      return await runImplementCommand(client, {
        positionals: parsed.positionals, json: parsed.json, host: parsed.host, runSteps: parsed.runSteps, yes: parsed.yes,
        interactive: dependencies.isInteractive ?? Boolean(process.stdin.isTTY && process.stderr.isTTY),
        platform: dependencies.platform,
      }, dependencies.runCommand, dependencies.confirm);
    }

    if (parsed.command === 'feedback') {
      return await runFeedbackCommand({
        positionals: parsed.positionals, json: parsed.json, baseUrl: resolveBaseUrl(parsed.baseUrl), cliVersion: readPackageVersion(),
        toolSlug: parsed.feedbackTool, field: parsed.feedbackField, evidenceUrl: parsed.evidenceUrl,
        query: parsed.feedbackQuery, host: parsed.host, reportedBy: parsed.reportedBy,
      }, dependencies.postFeedback);
    }

    if (parsed.command === 'component') {
      return await runComponentCommand(client, {positionals: parsed.positionals, json: parsed.json});
    }

    if (parsed.command === 'tool') {
      const reference = parsed.positionals[0];
      const tool = await loadToolDetail(reference);

      // Label the record even when an older feed did not, so agents see the same policy everywhere.
      const labelled = <Detail extends object>(detail: Detail) => ({...buildToolContentPolicyLabels(new Set(Object.keys(detail))), ...detail});
      if (parsed.summary) return ok(jsonLine(labelled(toToolDecisionSummary(tool))));
      return ok(parsed.json ? jsonLine(labelled(tool)) : formatTool(tool));
    }

    if (parsed.command === 'recommend') {
      const requirements = (parsed.forText ?? parsed.positionals.join(' ')).trim();

      if (!requirements) {
        return failForOutput(parsed.json, {
          code: 'invalid_input',
          message: 'Recommendation requirements are required.',
          recovery: 'Use --for <text> or pass requirements as arguments.',
        }, 'Recommendation requirements are required. Use --for <text>.\n');
      }

      return await runRecommendCommand(client, {
        filters: parsed.filters,
        json: parsed.json,
        limit: parsed.limit,
        query: requirements,
      });
    }

    if (parsed.command === 'compare') {
      if (parsed.positionals.length > MAX_COMPARE_REFERENCES) {
        return failForOutput(parsed.json, {
          code: 'invalid_input',
          message: `Compare accepts at most ${MAX_COMPARE_REFERENCES} slug or alias references.`,
          configuredLimit: MAX_COMPARE_REFERENCES,
          observedValue: parsed.positionals.length,
          recovery: 'Pass fewer references.',
        });
      }

      const references = Array.from(new Set(parsed.positionals));
      const resolvedFeeds = await Promise.all(references.map((slug) => loadToolDetailFeed(slug)));
      const resolvedTools = resolvedFeeds.map((feed) => feed.data);
      const tools = Array.from(new Map(resolvedTools.map((tool) => [tool.slug, tool])).values());
      if (tools.length < 2) {
        return failForOutput(parsed.json, {
          code: 'invalid_input',
          message: 'Compare requires at least two distinct tools after resolving aliases.',
          recovery: 'Pass at least two different Tool slugs.',
        });
      }
      if (tools.length > MAX_COMPARE_TOOLS) {
        return failForOutput(parsed.json, {
          code: 'invalid_input',
          message: `Compare supports at most ${MAX_COMPARE_TOOLS} tools at a time.`,
          configuredLimit: MAX_COMPARE_TOOLS,
          observedValue: tools.length,
          recovery: 'Pass fewer Tools.',
        });
      }
      const comparison = compareTools(tools, new Map(resolvedFeeds.map((feed) => [feed.data.slug, feed.siteUrl])));

      return ok(parsed.json ? jsonLine(comparison) : formatComparison(comparison));
    }

    if (parsed.command === 'assembly') {
      const references = [
        ...new Set(
          parsed.positionals
            .map((reference) => reference.trim().toLowerCase())
            .filter(Boolean),
        ),
      ].sort();
      if (references.some((reference) => !isValidToolPublicSlug(reference))) {
        return failForOutput(parsed.json, {
          code: 'invalid_input',
          message: 'Assembly accepts public Tool slugs only.',
          recovery: 'Pass lowercase public Tool slugs, for example: slothhub assembly figma linear.',
        });
      }
      if (references.length < 2 || references.length > 5) {
        return failForOutput(parsed.json, {
          code: 'invalid_input',
          message: 'Assembly requires 2-5 unique Tool slugs after duplicates are removed.',
          recovery: 'Pass between two and five unique public Tool slugs.',
        });
      }

      // --require-* tokens are usage input: validate them before any feed I/O
      // so a bad flag wins over a transport failure.
      const validatedRequirements = parseToolAssemblyRequirements({
        integrations: parsed.requiredIntegrations,
        platforms: parsed.requiredPlatforms,
        agentInterfaceKinds: parsed.requiredAgentInterfaceKinds,
      });
      if (!validatedRequirements.ok) {
        return failForOutput(parsed.json, {
          code: 'invalid_input',
          message: validatedRequirements.errors.join(' '),
          recovery: 'Pass valid --require-integration, --require-platform, and --require-agent-interface values.',
        });
      }

      const selections = await Promise.all(
        references.map(async (reference) => {
          try {
            const tool = await loadToolDetail(reference);
            return { selectedSlug: tool.slug, tool };
          } catch (error) {
            if (isNotFoundError(error)) {
              return { selectedSlug: reference, tool: null };
            }
            throw error;
          }
        }),
      );
      const selectedSlugs = [
        ...new Set(selections.map(({ selectedSlug }) => selectedSlug)),
      ].sort();
      if (selectedSlugs.length < 2 || selectedSlugs.length > 5) {
        return failForOutput(parsed.json, {
          code: 'invalid_input',
          message: 'Assembly requires 2-5 unique Tool identities after resolving aliases.',
          recovery: 'Pass between two and five unique public Tool slugs.',
        });
      }
      let report: ReturnType<typeof checkToolAssembly>;
      try {
        report = checkToolAssembly({
          selectedSlugs,
          tools: selections
            .filter(
              (selection): selection is { selectedSlug: string; tool: AgentToolDetail } =>
                selection.tool !== null,
            )
            .map(({ tool }) => ({
              slug: tool.slug,
              name: tool.name,
              detailUrl: tool.detailUrl,
              platforms: tool.platforms,
              integrations: tool.integrations,
              agentInterfaces: tool.agentInterfaces,
            })),
          requirements: {
            integrations: parsed.requiredIntegrations,
            platforms: parsed.requiredPlatforms,
            agentInterfaceKinds: parsed.requiredAgentInterfaceKinds,
          },
        });
      } catch (error) {
        throw new CliError(
          'invalid_input',
          error instanceof Error ? error.message : String(error),
          'Pass valid --require-integration, --require-platform, and --require-agent-interface values.',
        );
      }

      return ok(parsed.json ? serializeToolAssemblyReport(report) : formatToolAssembly(report));
    }

    if (parsed.command === 'doctor') {
      const feed = await client.index();
      const diagnostics = await inspectCatalogDiagnostics(feed, {
        baseUrl: parsed.baseUrl,
        fetchResponse: dependencies.probeFetch,
      });

      const networkEnvironment = summarizeNetworkEnvironment(process.env);

      if (parsed.json) {
        return ok(jsonLine({...diagnostics.document, networkEnvironment}));
      }

      return ok(
        diagnostics.human +
        [
          `HTTPS_PROXY set: ${networkEnvironment.httpsProxy}`,
          `HTTP_PROXY set: ${networkEnvironment.httpProxy}`,
          `NO_PROXY set: ${networkEnvironment.noProxy}`,
          `Env proxy support enabled: ${networkEnvironment.envProxyEnabled}`,
          `NODE_EXTRA_CA_CERTS set: ${networkEnvironment.nodeExtraCaCerts}`,
        ].join('\n') + '\n'
      );
    }

    const failure = unknownCommandFailure(parsed.command);
    return failForOutput(parsed.json, failure, `${failure.message} ${failure.recovery}\n`);
  } catch (error) {
    // Computed once for the failure classes that can carry network context.
    const networkHint = describeNetworkEnvironmentHint(error, process.env);
    // A configured origin stays out of error text (see redactCliErrorMessage),
    // but the public default is not private and tells a new user what failed.
    const feedOriginConfigured = isRuntimeString(parsed.baseUrl ?? process.env.SLOTHHUB_BASE_URL);
    const feedOrigin = feedOriginConfigured ? '' : ` from ${DEFAULT_BASE_URL}`;
    const feedRecovery = feedOriginConfigured
      ? 'Check that the origin set by --base-url or SLOTHHUB_BASE_URL is reachable and serves SlothHub feeds, then try again.'
      : `Check that ${DEFAULT_BASE_URL} is reachable, or point the CLI at another SlothHub origin with --base-url <origin> or SLOTHHUB_BASE_URL, then try again.`;
    if (error instanceof UnsupportedFeedVersionError) {
      const recovery = 'Upgrade the CLI with npm install -g @slothhub/cli@latest, then retry.';
      return failForOutput(parsed.json, {
        code: error.code,
        message: error.message,
        supportedVersion: error.supportedVersion,
        observedVersion: error.observedVersion,
        recovery,
      }, `${error.message} ${recovery}\n`);
    }
    if (error instanceof CliError) {
      const message = safeDiagnostic(error.message);
      return failForOutput(parsed.json, {
        code: error.code,
        message,
        ...(error.recovery ? {recovery: error.recovery} : undefined),
      }, `${message}${error.recovery ? ` Recovery: ${error.recovery}` : ''}\n`);
    }
    if (error instanceof FeedRequestTimeoutError) {
      const message = safeDiagnostic(error.message);
      return failForOutput(parsed.json, {
        code: 'feed_timeout',
        message,
        configuredLimitMs: error.configuredMs,
        observedMs: error.observedMs,
        recovery: feedRecovery,
        ...(networkHint ? {hint: networkHint} : undefined),
      }, `feed_timeout: ${message}${networkHint ? ` ${networkHint.message}` : ''} Recovery: ${feedRecovery}\n`);
    }
    const hostBlocked = error instanceof FeedHostBlockedError ? error
      : error instanceof FeedClientError && error.cause instanceof FeedHostBlockedError ? error.cause : undefined;
    if (hostBlocked) {
      const path = error instanceof FeedClientError ? error.path : undefined;
      return failForOutput(parsed.json, {
        code: hostBlocked.code,
        message: hostBlocked.message,
        ...(path ? {path} : undefined),
        httpStatus: hostBlocked.httpStatus,
        mitigation: hostBlocked.mitigation,
        recovery: hostBlocked.recovery,
      }, `${hostBlocked.code}: ${hostBlocked.message} Recovery: ${hostBlocked.recovery}\n`);
    }
    if (error instanceof FeedClientError) {
      // Transport failures report the feed path only: the resolved URL and the
      // upstream cause can embed configured origins, proxy detail, or raw
      // response text. A wrapped deadline breach reports its bounded counts.
      const timeout = error.cause instanceof FeedRequestTimeoutError ? error.cause : undefined;
      const code = timeout ? 'feed_timeout' : error.code;
      const message = error.code === 'transport'
        ? `Unable to load feed ${error.path}${feedOrigin}${error.httpStatus ? ` (HTTP ${error.httpStatus})` : ''}.`
        : redactCliErrorMessage(error.message);
      const recovery = error.code === 'transport' || timeout
        ? feedRecovery
        : 'Verify the feed URL and availability, then try again.';
      return failForOutput(parsed.json, {
        code,
        message,
        path: error.path,
        recovery,
        ...(timeout
          ? {configuredLimitMs: timeout.configuredMs, observedMs: timeout.observedMs}
          : undefined),
        ...(networkHint ? {hint: networkHint} : undefined),
      }, `${code}: ${message}${networkHint ? ` ${networkHint.message}` : ''} Recovery: ${recovery}\n`);
    }
    if (error instanceof AgentSearchContractError) {
      const payload = serializeAgentSearchContractError(error);
      return failForOutput(
        parsed.json,
        payload,
        `${payload.code}: ${safeDiagnostic(payload.message)} ${safeDiagnostic(payload.recovery)}\n`,
      );
    }
    if (error instanceof AgentSearchPayloadLimitError) {
      const payload = {
        code: error.code,
        message: error.message,
        configuredLimitBytes: error.configuredLimitBytes,
        observedBytes: error.observedBytes,
        recovery: error.recovery,
      };
      return failForOutput(parsed.json, payload, `${payload.code}: ${payload.message}\n`);
    }
    if (error instanceof AdvertisedCatalogFeedLimitError) {
      const payload = {
        code: error.code,
        message: error.message,
        configuredLimit: error.configuredLimit,
        observedCount: error.observedCount,
        recovery: error.recovery,
      };
      return failForOutput(
        parsed.json,
        payload,
        `${payload.code}: ${safeDiagnostic(payload.message)}\n`,
      );
    }
    if (error instanceof InvalidAdvertisedCatalogUrlError) {
      const payload = {
        code: error.code,
        message: error.message,
        field: `${error.group}.${error.key}`,
        recovery: error.recovery,
      };
      return failForOutput(
        parsed.json,
        payload,
        `${payload.code}: ${safeDiagnostic(payload.message)} ${safeDiagnostic(payload.recovery)}\n`,
      );
    }
    if (error instanceof ToolLookupArtifactLimitError) {
      const payload = {
        code: error.code,
        message: error.message,
        configuredLimit: error.configuredLimit,
        observedValue: error.observedValue,
        recovery: error.recovery,
      };
      return failForOutput(parsed.json, payload, `${payload.code}: ${payload.message}\n`);
    }
    if (error instanceof RetiredToolLookupError) {
      const payload = {
        code: error.code,
        message: safeDiagnostic(error.message),
        recovery: error.recovery,
      };
      return failForOutput(
        parsed.json,
        payload,
        `${payload.code}: ${payload.message} Recovery: ${payload.recovery}\n`,
      );
    }
    const message = redactCliErrorMessage(error instanceof Error ? error.message : String(error));
    return failForOutput(parsed.json, {
      code: 'feed_load_error',
      message,
      recovery: 'Verify the feed URL and availability, then try again.',
      ...(networkHint ? {hint: networkHint} : undefined),
    }, `${message}${networkHint ? ` ${networkHint.message}` : ''}\n`);
  }
};
