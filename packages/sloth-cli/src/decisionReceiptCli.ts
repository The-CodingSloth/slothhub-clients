import {
  parseDecisionReceiptArtifact,
  renderDecisionReceiptMarkdown,
  serializeDecisionReceiptJson,
} from '@slothhub/domain/decision-receipt';
import {failForOutput, ioFailureContract, ok} from './cliOutput.js';
import {
  readDecisionReceiptSource,
  writeDecisionReceiptOutput,
} from './decisionReceiptFiles.js';
import type {CliResult} from './types.js';

export type DecisionReceiptCliRequest = {
  action: string | undefined;
  sourcePath: string | undefined;
  extraArguments: string[];
  json: boolean;
  output: string | undefined;
  force: boolean;
};

export type DecisionReceiptCliDependencies = {
  readSource?: (path: string) => Promise<string>;
  writeOutput?: (path: string, contents: string, force: boolean) => Promise<void>;
};

const terminalSafeInline = (value: string): string =>
  value.replace(
    /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu,
    (character) => `\\u{${character.codePointAt(0)!.toString(16).toUpperCase()}}`,
  );

export const runDecisionReceiptCommand = async (
  request: DecisionReceiptCliRequest,
  dependencies: DecisionReceiptCliDependencies = {},
): Promise<CliResult> => {
  const {action, sourcePath} = request;
  if (action !== 'validate' && action !== 'render') {
    return failForOutput(request.json, {
      code: 'invalid_input',
      message: 'Receipt command requires validate or render.',
      recovery: 'Run slothhub receipt <validate|render> <file|->.',
    });
  }
  if (!sourcePath) {
    return failForOutput(request.json, {
      code: 'invalid_input',
      message: `Receipt ${action} requires a file path or - for stdin.`,
      recovery: `Run slothhub receipt ${action} <file|->.`,
    });
  }
  if (request.extraArguments.length > 0) {
    return failForOutput(request.json, {
      code: 'invalid_input',
      message: `Receipt ${action} received unexpected arguments.`,
      recovery: `Run slothhub receipt ${action} <file|->.`,
    });
  }
  if (action === 'render' && request.force && !request.output) {
    return failForOutput(request.json, {
      code: 'invalid_input',
      message: '--force requires --output.',
      recovery: 'Add --output <path> or remove --force.',
    });
  }
  if (action === 'render' && request.json) {
    return failForOutput(true, {
      code: 'invalid_input',
      message: '--json is not supported by receipt render.',
      recovery: 'Remove --json to render Markdown.',
    });
  }

  const readSource = dependencies.readSource ?? readDecisionReceiptSource;
  const writeOutput = dependencies.writeOutput ?? writeDecisionReceiptOutput;

  let rawReceipt: string;
  try {
    rawReceipt = await readSource(sourcePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failForOutput(
      request.json,
      {
        ...ioFailureContract(
          error,
          'source_unreadable',
          'Provide a readable receipt file or - for stdin.',
        ),
        message,
      },
      `${terminalSafeInline(message)}\n`,
    );
  }

  let receipt: ReturnType<typeof parseDecisionReceiptArtifact>;
  try {
    receipt = parseDecisionReceiptArtifact(rawReceipt);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failForOutput(
      request.json,
      {
        code: 'invalid_receipt',
        message,
        recovery: 'Provide a valid decision receipt artifact.',
      },
      `${terminalSafeInline(message)}\n`,
    );
  }

  if (action === 'validate') {
    return ok(
      request.json
        ? serializeDecisionReceiptJson(receipt)
        : `Valid decision receipt ${terminalSafeInline(receipt.receiptId)} (schema ${receipt.schemaVersion}).\n`,
    );
  }

  const markdown = renderDecisionReceiptMarkdown(receipt);
  if (!request.output) return ok(markdown);
  try {
    await writeOutput(request.output, markdown, request.force);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failForOutput(
      request.json,
      {
        ...ioFailureContract(
          error,
          'output_write_failed',
          'Choose a writable --output path, or pass --force to replace an existing file.',
        ),
        message,
      },
      `${terminalSafeInline(message)}\n`,
    );
  }
  return {
    exitCode: 0,
    stdout: '',
    stderr: `Wrote ${terminalSafeInline(request.output)}\n`,
  };
};
