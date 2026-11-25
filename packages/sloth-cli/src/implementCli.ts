import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {buildImplementationKit, formatRunnableArgv, unverifiedRunnablePackages, type ImplementationKit, type ImplementationKitStep, type RunnableCommand} from '@slothhub/domain/implementation-kit';
import {QUOTED_CATALOG_CONTENT_END, QUOTED_CATALOG_CONTENT_START, TOOL_CONTENT_POLICY_NOTICE} from '@slothhub/domain/catalog-content-policy';
import {AGENT_SETUP_RECIPE_HOST_VALUES, isAgentSetupRecipeHost} from '@slothhub/domain/mcp-registry';
import {isValidToolPublicSlug} from '@slothhub/domain/tool-lookup';
import {stripTerminalControls} from './catalogFormat.js';
import {failForOutput, jsonLine, ok} from './cliOutput.js';
import {FeedClientError, type FeedClient} from './feedClient.js';
import type {CliResult} from './types.js';

/** Runs one program with arguments, never through a shell; resolves its exit code. */
export type RunCommand = (program: string, args: string[]) => Promise<number>;
export type Confirm = (question: string) => Promise<boolean>;

export interface ImplementCliRequest {
  /** Defaults to process.platform; tests inject it. */
  platform?: NodeJS.Platform;
  positionals: string[];
  json: boolean;
  host?: string;
  runSteps?: string;
  yes: boolean;
  interactive: boolean;
}

export const defaultRunCommand: RunCommand = (program, args) => new Promise((resolve, reject) => {
  // Child output goes to stderr so --json stdout stays one parseable document.
  const child = spawn(program, args, {stdio: ['inherit', 2, 2], shell: false});
  child.once('error', reject);
  child.once('exit', (code) => resolve(code ?? 1));
});

export const defaultConfirm: Confirm = async (question) => {
  const readline = createInterface({input: process.stdin, output: process.stderr});
  try {
    return /^y(?:es)?$/iu.test((await readline.question(question)).trim());
  } finally {
    readline.close();
  }
};

const safe = stripTerminalControls;

export const formatImplementationKit = (kit: ImplementationKit): string => {
  const lines = [
    `Implement ${safe(kit.name)}`,
    TOOL_CONTENT_POLICY_NOTICE,
    safe(kit.description),
    `Cite: ${safe(kit.detailUrl)}`,
    '',
    ...(kit.steps.length ? ['Steps', QUOTED_CATALOG_CONTENT_START, ...kit.steps.flatMap((step) => [
      `  ${step.number}. ${safe(step.label)} (${safe(step.statusLabel)}${step.source ? `, ${safe(step.source)}` : ''})`,
      `     ${safe(step.command)}`,
      ...(step.notice ? [`     ${safe(step.notice)}`] : []),
      step.run.runnable ? `     Run it: slothhub implement ${kit.slug} --run ${step.number}` : `     Run it yourself (${step.run.code}): ${safe(step.run.reason)}`,
      ...(step.run.runnable ? unverifiedRunnablePackages(step.run).map((pkg) => `     Package link not verified (${pkg.link}): ${safe(pkg.name)} is named only by this listing's interface row.`) : []),
    ]), QUOTED_CATALOG_CONTENT_END] : ['No install commands are recorded; use the docs below.']),
    ...(kit.hostSetup ? ['', `${safe(kit.hostSetup.host)} setup${kit.hostSetup.configHint ? ` (${safe(kit.hostSetup.configHint)})` : ''}`, ...kit.hostSetup.entrySnippet.split('\n').map((line) => `  ${safe(line)}`)] : []),
    ...(kit.hostSetup?.notices.length ? kit.hostSetup.notices.map((notice) => `  ${safe(notice)}`) : []),
    ...(kit.hostSetupUnavailable ? ['', `No ready ${safe(kit.hostSetupUnavailable)} setup recipe is recorded; use the docs.`] : []),
    ...(kit.environment.names.length ? ['', `Environment variables (set locally): ${kit.environment.names.map(safe).join(', ')}`] : []),
    ...(kit.runtime.length ? ['', 'Runtime', ...kit.runtime.map((entry) => `  ${safe(entry.name)} ${safe(entry.environmentRange)}: ${safe(entry.status)}${entry.toolRange ? ` (Tool ${safe(entry.toolRange)})` : ''}${entry.note ? `. ${safe(entry.note)}` : ''}`)] : []),
    ...kit.examples.flatMap((example) => ['', `Example: ${safe(example.title)} (${safe(example.sourceUrl)})`, QUOTED_CATALOG_CONTENT_START,
      ...example.files.flatMap((file) => [...(file.filename ? [`--- ${safe(file.filename)} ---`] : []), ...file.code.split('\n').map((line) => safe(line.replaceAll('\t', '  ')))]), QUOTED_CATALOG_CONTENT_END]),
    ...(kit.docs.length ? ['', 'Docs', ...kit.docs.map(({label, url}) => `  ${safe(label)}: ${safe(url)}`)] : []),
    ...(kit.cautions.length ? ['', 'Cautions', ...kit.cautions.map((caution) => `  - ${safe(caution)}`)] : []),
  ];
  return `${lines.join('\n')}\n`;
};

type RunnableStep = ImplementationKitStep & {run: Extract<RunnableCommand, {runnable: true}>};
/** What the allowlist refused, for agents: the refusal code and the program, flag, package or argument it names. */
interface StepRefusalDetail {code: string; part?: string}
type StepRefusal = {code: 'invalid_input'; message: string} | {code: 'step_not_runnable'; message: string; step: number; refusal: StepRefusalDetail};

/** Parse "1,3" into the kit steps to run; every one must exist and pass the runnable-command allowlist. */
type StepSelection = {ok: true; steps: RunnableStep[]} | {ok: false; failure: StepRefusal};
const selectSteps = (kit: ImplementationKit, value: string): StepSelection => {
  const numbers = value.split(',').map((part) => Number(part.trim()));
  if (numbers.some((number) => !Number.isInteger(number))) return {ok: false, failure: {code: 'invalid_input', message: '--run takes step numbers such as 1 or 1,3.'}};
  const selected: RunnableStep[] = [];
  for (const number of new Set(numbers)) {
    const step = kit.steps.find((candidate) => candidate.number === number);
    if (!step) return {ok: false, failure: {code: 'invalid_input', message: `Step ${number} does not exist; this kit has ${kit.steps.length} step(s).`}};
    const {run} = step;
    if (!run.runnable) {
      const refusal: StepRefusalDetail = {code: run.code};
      if (run.part !== undefined) refusal.part = safe(run.part);
      return {ok: false, failure: {code: 'step_not_runnable', step: number, refusal, message: `Step ${number} cannot run automatically: ${safe(run.reason)}`}};
    }
    selected.push({...step, run});
  }
  return {ok: true, steps: selected};
};

/**
 * What the prompt shows is the argument vector that runs: the same `run` object, rendered
 * through the same terminal-safety function as every other line. The allowlist admits only
 * printable ASCII tokens without spaces, so the joined line cannot be read two ways.
 */
const shownArgv = (step: RunnableStep): string => safe(formatRunnableArgv(step.run));

export const runImplementCommand = async (
  client: Pick<FeedClient, 'tool'>,
  request: ImplementCliRequest,
  runCommand: RunCommand = defaultRunCommand,
  confirm: Confirm = defaultConfirm,
): Promise<CliResult> => {
  const [slug] = request.positionals;
  if (request.positionals.length !== 1 || !isValidToolPublicSlug(slug)) {
    return failForOutput(request.json, {code: 'invalid_input', message: 'Usage: slothhub implement <slug> [--host <agent-host>] [--run <steps>] [--yes].', recovery: 'Pass one public Tool slug from slothhub search.'});
  }
  if (request.host !== undefined && !isAgentSetupRecipeHost(request.host)) {
    return failForOutput(request.json, {code: 'unknown_host', message: `Unknown agent host: ${safe(request.host)}.`, allowedHosts: AGENT_SETUP_RECIPE_HOST_VALUES, recovery: `Choose --host from ${AGENT_SETUP_RECIPE_HOST_VALUES.join(', ')}.`});
  }
  let feed;
  try {
    feed = await client.tool(slug);
  } catch (error) {
    if (!(error instanceof FeedClientError) || error.code !== 'transport' || error.httpStatus !== 404 || error.path !== `/api/tools/${slug}.json`) throw error;
    return failForOutput(request.json, {code: 'not_found', message: `Tool not found: ${slug}.`, recovery: 'Search SlothHub for a current public Tool slug and try again.'});
  }
  if (feed.data.slug !== slug) {
    throw new FeedClientError('schema_invalid', `/api/tools/${slug}.json`, 'Tool detail identity does not match the requested slug.');
  }
  const host = request.host !== undefined && isAgentSetupRecipeHost(request.host) ? request.host : undefined;
  const kit = buildImplementationKit(feed.data, {siteUrl: feed.siteUrl, host});
  if (request.runSteps === undefined) return ok(request.json ? jsonLine(kit) : formatImplementationKit(kit));

  // Windows package managers are .cmd shims, which Node will only start through a shell; --run never uses one.
  if ((request.platform ?? process.platform) === 'win32') {
    return failForOutput(request.json, {code: 'unsupported_platform', message: '--run does not support Windows yet: npm, npx, pnpm and yarn are .cmd files that need a shell, and --run never uses one.', recovery: `Run slothhub implement ${slug} and copy the commands into your terminal.`});
  }
  const selection = selectSteps(kit, request.runSteps);
  if (!selection.ok) {
    const {failure} = selection;
    return failure.code === 'step_not_runnable'
      ? failForOutput(request.json, {...failure, recovery: `SlothHub only runs a plain install or run of this Tool's own registry package. Run slothhub implement ${slug} to read the command, then run it yourself if you trust it.`})
      : failForOutput(request.json, {...failure, recovery: `Run slothhub implement ${slug} to see the numbered steps.`});
  }
  const selected = selection.steps;
  const cwd = safe(process.cwd());
  const plan = selected.map((step) => `  ${step.number}. ${shownArgv(step)}`).join('\n');
  if (!request.yes) {
    if (!request.interactive) {
      return failForOutput(request.json, {
        code: 'confirmation_required', message: `These commands will run in ${cwd}:\n${plan}`,
        steps: selected.map((step) => ({number: step.number, argv: [step.run.program, ...step.run.args]})),
        recovery: 'Review them, then pass --yes to run without a prompt.',
      });
    }
    if (!(await confirm(`Run these commands in ${cwd}?\n${plan}\n[y/N] `))) {
      return failForOutput(request.json, {code: 'cancelled', message: 'Nothing was run.', recovery: 'Run the commands yourself, or confirm with y.'});
    }
  }
  const ran: {number: number; command: string; argv: string[]; exitCode: number}[] = [];
  for (const step of selected) {
    let exitCode: number;
    try {
      exitCode = await runCommand(step.run.program, step.run.args);
    } catch {
      return failForOutput(request.json, {code: 'command_failed', message: `Step ${step.number} could not start ${step.run.program}: ${shownArgv(step)}`, ran, recovery: `Install ${step.run.program} or run the command yourself, then run the remaining steps again.`});
    }
    ran.push({number: step.number, command: step.command, argv: [step.run.program, ...step.run.args], exitCode});
    if (exitCode !== 0) {
      return failForOutput(request.json, {code: 'command_failed', message: `Step ${step.number} exited with ${exitCode}: ${shownArgv(step)}`, ran, recovery: 'Read the output above, fix the cause, and run the remaining steps again.'});
    }
  }
  return ok(request.json ? jsonLine({slug, ran}) : `Ran ${ran.length} step(s) for ${safe(kit.name)}. Next: configure ${kit.environment.names.length ? kit.environment.names.map(safe).join(', ') : 'the Tool'} and follow ${safe(kit.detailUrl)}.\n`);
};
