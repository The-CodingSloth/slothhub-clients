import {hasRuntimeObjectType, isRuntimeNumber, isRuntimeString} from '@slothhub/domain/runtime-validation';
import {safeDiagnostic, serializeTerminalSafeJson} from '@slothhub/domain/safe-diagnostic';

import type {
  AgentCuratedListFeedItem,
  AgentToolStackFeedItem,
  CliResult,
} from './types.js';

/**
 * Exit codes are a stable contract for scripts and agents (clig.dev; Arcjet's agent CLI notes):
 * 0 success, 1 other runtime failure, 2 invalid input, 3 not found, 4 confirmation required or
 * declined, 5 temporarily unavailable (network, timeout, rate limit) — retry later.
 */
export const CLI_EXIT_RUNTIME = 1;
export const CLI_EXIT_USAGE = 2;
export const CLI_EXIT_NOT_FOUND = 3;
export const CLI_EXIT_CONFIRMATION = 4;
export const CLI_EXIT_UNAVAILABLE = 5;

const CLI_NOT_FOUND_ERROR_CODES: ReadonlySet<string> = new Set(['not_found', 'retired']);
const CLI_CONFIRMATION_ERROR_CODES: ReadonlySet<string> = new Set(['confirmation_required', 'cancelled']);
// Only causes known to be temporary. feed_load_error is the catch-all for unclassified failures,
// which may be permanent local problems, so it stays a runtime failure (1).
const CLI_UNAVAILABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  'transport', 'feed_timeout', 'feedback_unavailable',
  'rate_limited', 'rate_limit_unavailable', 'service_unavailable',
]);

// Usage failures are argument-shape or environment problems the caller can fix
// without any catalog state; every other code — including an unsupported feed
// major, which callers resolve through the envelope recovery field — is a
// runtime condition.
const CLI_USAGE_ERROR_CODES: ReadonlySet<string> = new Set([
  'invalid_input',
  // implement --run refused a step under the runnable-command allowlist (was invalid_input).
  'step_not_runnable',
  'unknown_host',
  'invalid_ecosystem',
  'ecosystem_required',
  'unsupported_runtime',
  'agent_search_query_too_long',
  'agent_search_query_normalized_empty',
  'agent_search_result_limit_out_of_range',
  'agent_search_invalid_filter_value',
  'agent_search_unsupported_filter_value',
  'EINVAL',
]);

export const cliExitCodeForError = (code: string): number =>
  CLI_USAGE_ERROR_CODES.has(code) ? CLI_EXIT_USAGE
    : CLI_NOT_FOUND_ERROR_CODES.has(code) ? CLI_EXIT_NOT_FOUND
      : CLI_CONFIRMATION_ERROR_CODES.has(code) ? CLI_EXIT_CONFIRMATION
        : CLI_UNAVAILABLE_ERROR_CODES.has(code) ? CLI_EXIT_UNAVAILABLE
          : CLI_EXIT_RUNTIME;

export {safeDiagnostic};

export const ok = (stdout: string): CliResult => ({exitCode: 0, stdout, stderr: ''});

export interface IoFailureContract {
  code: string;
  configuredLimitBytes?: number;
  observedBytes?: number;
  recovery: string;
}

// File-IO failures carry an optional structured contract (code, byte limits,
// recovery) attached by the readers. This narrows it once so every command
// reports the same envelope fields and exit-code class.
export const ioFailureContract = <ErrorValue>(
  error: ErrorValue,
  fallbackCode: string,
  fallbackRecovery: string,
): IoFailureContract => {
  const fields = hasRuntimeObjectType(error) && error !== null ? error : undefined;
  const code =
    fields && 'code' in fields && isRuntimeString(fields.code) ? fields.code : fallbackCode;
  const configuredLimitBytes =
    fields && 'configuredLimitBytes' in fields && isRuntimeNumber(fields.configuredLimitBytes)
      ? fields.configuredLimitBytes
      : undefined;
  const observedBytes =
    fields && 'observedBytes' in fields && isRuntimeNumber(fields.observedBytes)
      ? fields.observedBytes
      : undefined;
  const recovery =
    fields && 'recovery' in fields && isRuntimeString(fields.recovery)
      ? fields.recovery
      : fallbackRecovery;
  return {
    code,
    recovery,
    ...(configuredLimitBytes !== undefined ? {configuredLimitBytes} : undefined),
    ...(observedBytes !== undefined ? {observedBytes} : undefined),
  };
};

export const jsonLine = <Value>(value: Value): string =>
  `${serializeTerminalSafeJson(value, 2)}\n`;

// --json failures are machine output: the envelope belongs on stdout, while
// human prose stays on stderr. When the human text is just the message, the
// caller can omit it; richer human output (usage blocks, recovery hints) is
// passed explicitly.
export const failForOutput = <Payload extends {code: string; message: string}>(
  json: boolean,
  payload: Payload,
  plainText = `${payload.message}\n`,
  exitCode = cliExitCodeForError(payload.code),
): CliResult =>
  json
    ? {exitCode, stdout: jsonLine({ok: false, ...payload}), stderr: ''}
    : {exitCode, stdout: '', stderr: plainText};

export const formatStack = (stack: AgentToolStackFeedItem): string => {
  const lines = [
    stack.name,
    ...(stack.description ? [stack.description] : []),
    `URL: ${stack.url}`,
    ...stack.tools.map((item) => {
      const toolName = item.tool?.name ?? 'Unlisted tool';
      return `${item.role}: ${toolName}${item.description ? ` - ${item.description}` : ''}`;
    }),
  ];

  if (stack.recipe) {
    lines.push(
      '',
      stack.recipe.title,
      'Guidance only — SlothHub does not run these examples.',
      ...(stack.recipe.summary ? [stack.recipe.summary] : []),
      `Reviewed: ${stack.recipe.reviewedAt}`,
    );
    for (const source of stack.recipe.sourceReferences ?? []) {
      lines.push(`Source: ${source.title} — ${source.url}`);
    }
    if (stack.recipe.prerequisites) {
      lines.push('Prerequisites:');
      for (const item of stack.recipe.prerequisites) {
        lines.push(`- ${item.label}${item.description ? ` — ${item.description}` : ''}`);
        for (const source of item.sourceReferences ?? []) {
          lines.push(`  Source: ${source.title} — ${source.url}`);
        }
      }
    }
    stack.recipe.steps.forEach((step, index) => {
      lines.push(`${index + 1}. ${step.title} (${step.kind})`, `   ${step.instruction}`);
      if (step.example) {
        const label = step.kind === 'command' ? 'Example command' : 'Example prompt';
        lines.push(`   ${label}: ${step.example}`);
      }
      if (step.expectedOutput) lines.push(`   Expected: ${step.expectedOutput}`);
      if (step.relatedTool) {
        lines.push(`   Related Tool: ${step.relatedTool.name} — ${step.relatedTool.detailUrl}`);
        for (const resource of step.relatedTool.resourceLinks ?? []) {
          lines.push(`   Resource: ${resource.label} — ${resource.url}`);
        }
        for (const agentInterface of step.relatedTool.agentInterfaces ?? []) {
          if (agentInterface.docsUrl) {
            lines.push(`   Agent Interface: ${agentInterface.label} — ${agentInterface.docsUrl}`);
          }
        }
      }
      for (const source of step.sourceReferences ?? []) {
        lines.push(`   Source: ${source.title} — ${source.url}`);
      }
    });
    if (stack.recipe.limitations) {
      lines.push('Limitations:');
      for (const item of stack.recipe.limitations) {
        lines.push(`- ${item.label}${item.description ? ` — ${item.description}` : ''}`);
        for (const source of item.sourceReferences ?? []) {
          lines.push(`  Source: ${source.title} — ${source.url}`);
        }
      }
    }
  }

  return `${lines.join('\n')}\n`;
};

export const formatBest = (list: AgentCuratedListFeedItem): string => {
  const lines = [
    list.title,
    ...(list.intro ? [list.intro] : []),
    `URL: ${list.url}`,
    ...list.rankedTools.map((item) => {
      const toolName = item.tool?.name ?? 'Unlisted tool';
      return `#${item.rank} ${toolName} - ${item.editorialBlurb}`;
    }),
  ];

  return `${lines.join('\n')}\n`;
};
