import {
  DECISION_RECEIPT_JSON_BEGIN,
  DECISION_RECEIPT_MAX_JSON_BYTES,
  DECISION_RECEIPT_MAX_MARKDOWN_BYTES,
  parseDecisionReceiptArtifact,
  renderDecisionReceiptMarkdown,
} from '@slothhub/domain/decision-receipt';
import { z } from 'zod';

import { ResponseFormat } from '../constants.js';
import { decisionReceiptInputSchema } from '../schemas/inputs.js';
import {
  formatToolResult,
  toolError,
  type ToolContentResult,
  type ToolErrorPayload,
} from './format.js';

export type DecisionReceiptInput = z.infer<typeof decisionReceiptInputSchema>;

const utf8Bytes = (value: string): number =>
  new TextEncoder().encode(value).byteLength;

// Failure paths can carry caller-supplied key names and ids; keep terminal
// control and bidirectional characters inert, matching the CLI's escaping.
const terminalSafeInline = (value: string): string =>
  value.replace(
    /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu,
    (character) => `\\u{${character.codePointAt(0)!.toString(16).toUpperCase()}}`,
  );
const receiptError = (
  message: string,
  responseFormat: ResponseFormat,
): ToolContentResult<ToolErrorPayload> =>
  toolError(`Receipt validation failed: ${terminalSafeInline(message)}`, {
    code: 'invalid_receipt',
    responseFormat,
    suggestion:
      'Fix the receipt and retry. slothhub receipt validate <file> runs the same check locally.',
    details: { field: 'receipt' },
  });

const oversizedError = (
  message: string,
  responseFormat: ResponseFormat,
  details: Pick<
    ToolErrorPayload,
    'configuredLimitBytes' | 'observedBytes' | 'configuredLimit' | 'observedValue'
  >,
): ToolContentResult<ToolErrorPayload> =>
  toolError(message, {
    code: 'payload_too_large',
    responseFormat,
    suggestion: 'Shorten the receipt and retry.',
    details: { field: 'receipt', ...details },
  });

const PAYLOAD_LIMIT_MESSAGES = [
  'receipt byte limit exceeded',
  'Markdown byte limit',
];

const parseReceipt = (
  source: string,
  responseFormat: ResponseFormat,
):
  | { ok: true; value: ReturnType<typeof parseDecisionReceiptArtifact> }
  | { ok: false; error: ToolContentResult<ToolErrorPayload> } => {
  // Top-level bounds surface here so the error can name the configured limit
  // and observed value; deeper field limits stay with the domain parser.
  if (source.length > DECISION_RECEIPT_MAX_MARKDOWN_BYTES) {
    return {
      ok: false,
      error: oversizedError(
        'Receipt exceeds the markdown artifact limit.',
        responseFormat,
        {
          configuredLimit: DECISION_RECEIPT_MAX_MARKDOWN_BYTES,
          observedValue: source.length,
        },
      ),
    };
  }
  if (
    !source.includes(DECISION_RECEIPT_JSON_BEGIN) &&
    utf8Bytes(source) > DECISION_RECEIPT_MAX_JSON_BYTES
  ) {
    return {
      ok: false,
      error: oversizedError(
        'Receipt exceeds the JSON byte limit.',
        responseFormat,
        {
          configuredLimitBytes: DECISION_RECEIPT_MAX_JSON_BYTES,
          observedBytes: utf8Bytes(source),
        },
      ),
    };
  }

  try {
    return { ok: true, value: parseDecisionReceiptArtifact(source) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (PAYLOAD_LIMIT_MESSAGES.some((limit) => message.includes(limit))) {
      return {
        ok: false,
        error: oversizedError(
          terminalSafeInline(message),
          responseFormat,
          {},
        ),
      };
    }
    return { ok: false, error: receiptError(message, responseFormat) };
  }
};

export const handleValidateDecisionReceipt = (
  params: DecisionReceiptInput,
): ToolContentResult<
  | {
      valid: true;
      receiptId: string;
      schemaVersion: string;
      candidateCount: number;
    }
  | ToolErrorPayload
> => {
  const result = parseReceipt(params.receipt, params.response_format);
  if (!result.ok) return result.error;

  const summary = {
    valid: true as const,
    receiptId: result.value.receiptId,
    schemaVersion: result.value.schemaVersion,
    candidateCount: result.value.candidates.length,
  };
  return formatToolResult(
    params.response_format,
    `Valid decision receipt ${terminalSafeInline(summary.receiptId)} (schema ${summary.schemaVersion}).\n`,
    summary,
  );
};

export const handleRenderDecisionReceipt = (
  params: DecisionReceiptInput,
): ToolContentResult<
  | { receiptId: string; schemaVersion: string; rendered: string }
  | ToolErrorPayload
> => {
  const result = parseReceipt(params.receipt, params.response_format);
  if (!result.ok) return result.error;

  const rendered = renderDecisionReceiptMarkdown(result.value);
  const structured = {
    receiptId: result.value.receiptId,
    schemaVersion: result.value.schemaVersion,
    rendered,
  };

  if (params.response_format === ResponseFormat.JSON) {
    return {
      content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
      structuredContent: structured,
    };
  }
  // The rendered markdown is the deliverable: return it whole instead of
  // routing through the presentation truncation used for catalog listings.
  return {
    content: [{ type: 'text', text: rendered }],
    structuredContent: structured,
  };
};
