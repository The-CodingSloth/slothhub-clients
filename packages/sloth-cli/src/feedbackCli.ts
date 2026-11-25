import {randomUUID} from 'node:crypto';
import {
  CATALOG_FEEDBACK_KIND_VALUES,
  CATALOG_FEEDBACK_PATH,
  catalogFeedbackRequestSchema,
  catalogFeedbackResponseSchema,
  type CatalogFeedbackKind,
  type CatalogFeedbackResult,
} from '@slothhub/domain/catalog-feedback';
import {failForOutput, jsonLine, ok} from './cliOutput.js';
import type {CliResult} from './types.js';

export type PostFeedback = (url: string, body: string) => Promise<CatalogFeedbackResult>;

export interface FeedbackCliRequest {
  positionals: string[];
  json: boolean;
  baseUrl: string;
  cliVersion: string;
  toolSlug?: string;
  field?: string;
  evidenceUrl?: string;
  query?: string;
  host?: string;
  reportedBy?: string;
}

/** Commands use hyphens (wrong-fact); the contract uses underscores (wrong_fact). */
const CLI_KINDS = CATALOG_FEEDBACK_KIND_VALUES.map((kind) => kind.replaceAll('_', '-'));
const toKind = (value: string | undefined): CatalogFeedbackKind | undefined =>
  CATALOG_FEEDBACK_KIND_VALUES.find((kind) => kind === value?.replaceAll('-', '_'));

const defaultPostFeedback: PostFeedback = async (url, body) => {
  const response = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body, redirect: 'error'});
  return catalogFeedbackResponseSchema.parse(await response.json());
};

export const runFeedbackCommand = async (request: FeedbackCliRequest, post: PostFeedback = defaultPostFeedback): Promise<CliResult> => {
  const [kindArgument, ...words] = request.positionals;
  const kind = toKind(kindArgument);
  if (!kind || words.length === 0) {
    return failForOutput(request.json, {
      code: 'invalid_input', message: 'Usage: slothhub feedback <kind> <message>.',
      allowedKinds: CLI_KINDS, recovery: `Choose a kind from ${CLI_KINDS.join(', ')} and describe what happened.`,
    });
  }
  const parsed = catalogFeedbackRequestSchema.safeParse({
    requestId: randomUUID(), kind, surface: 'cli', reportedBy: request.reportedBy ?? 'human', message: words.join(' '),
    client: {name: 'slothhub-cli', version: request.cliVersion},
    ...Object.fromEntries(Object.entries({toolSlug: request.toolSlug, field: request.field, evidenceUrl: request.evidenceUrl, query: request.query, host: request.host}).filter(([, value]) => value !== undefined)),
  });
  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => ({field: issue.path.join('.'), message: issue.message}));
    return failForOutput(request.json, {
      code: 'invalid_input', message: `Feedback is not valid: ${errors.map(({field, message}) => `${field}: ${message}`).join('; ')}`,
      errors, recovery: 'Fix the listed fields and send it again.',
    });
  }
  let result: CatalogFeedbackResult;
  try {
    result = await post(new URL(CATALOG_FEEDBACK_PATH, request.baseUrl).href, JSON.stringify(parsed.data));
  } catch {
    return failForOutput(request.json, {
      code: 'feedback_unavailable', message: 'SlothHub could not record the feedback.',
      recovery: 'Retry later, or run slothhub doctor to check the configured site.',
    });
  }
  if (!result.ok) {
    return failForOutput(request.json, {
      ...result.failure,
      recovery: result.failure.retryAfterSeconds !== undefined ? `Retry after ${result.failure.retryAfterSeconds} seconds.` : 'Fix the listed fields and send it again.',
    });
  }
  return ok(request.json
    ? jsonLine(result.receipt)
    : `Thanks. Your feedback is queued for the SlothHub team (id ${result.receipt.id}). It is private and reviewed before anything changes.\n`);
};
