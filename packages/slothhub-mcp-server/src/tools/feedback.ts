import type {McpServer} from '@modelcontextprotocol/server';
import {
  CATALOG_FEEDBACK_KIND_VALUES,
  CATALOG_FEEDBACK_MESSAGE_MAX,
  CATALOG_FEEDBACK_MESSAGE_MIN,
  CATALOG_FEEDBACK_PATH,
  CATALOG_FEEDBACK_REPORTER_VALUES,
  catalogFeedbackResponseSchema,
  type CatalogFeedbackRequest,
  type CatalogFeedbackResult,
} from '@slothhub/domain/catalog-feedback';
import {z} from 'zod';

import {responseFormatSchema} from '../schemas/inputs.js';
import {formatToolResult, toolError, type ToolContentResult} from './format.js';

/** Hosted MCP submits in-process with the caller's IP; stdio posts to the configured site. */
export type FeedbackSubmitter = (request: CatalogFeedbackRequest, signal?: AbortSignal) => Promise<CatalogFeedbackResult>;

export const createHttpFeedbackSubmitter = (
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): FeedbackSubmitter => async (request, signal) => {
  const response = await fetchImpl(new URL(CATALOG_FEEDBACK_PATH, baseUrl), {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(request), signal, redirect: 'error',
  });
  return catalogFeedbackResponseSchema.parse(await response.json());
};

export const feedbackInputSchema = z.object({
  kind: z.enum(CATALOG_FEEDBACK_KIND_VALUES),
  message: z.string().describe(`What happened, ${CATALOG_FEEDBACK_MESSAGE_MIN}-${CATALOG_FEEDBACK_MESSAGE_MAX} characters. No personal data or secrets.`),
  tool_slug: z.string().optional().describe('The Tool the feedback is about, when there is one.'),
  field: z.string().optional().describe('The fact that is wrong, for example pricing or license.'),
  evidence_url: z.string().optional().describe('An official https source that shows the correct fact.'),
  query: z.string().optional().describe('For missing_tool: what you searched for.'),
  host: z.string().optional().describe('For setup_worked or setup_failed: the agent host, for example cursor.'),
  reported_by: z.enum(CATALOG_FEEDBACK_REPORTER_VALUES).default('agent').describe('human when relaying the user\'s own words.'),
  response_format: responseFormatSchema,
}).strict();

export const feedbackOutputSchema = z.object({received: z.literal(true), id: z.string(), status: z.literal('queued'), replayed: z.boolean()});

type FeedbackInput = z.infer<typeof feedbackInputSchema>;
export interface FeedbackClientInfo {name: string; version?: string}

export const handleFeedback = async (
  submit: FeedbackSubmitter,
  params: FeedbackInput,
  clientInfo: FeedbackClientInfo | undefined,
  signal?: AbortSignal,
): Promise<ToolContentResult> => {
  const request: CatalogFeedbackRequest = {
    requestId: globalThis.crypto.randomUUID(), kind: params.kind, reportedBy: params.reported_by, surface: 'mcp', message: params.message,
  };
  if (params.tool_slug) request.toolSlug = params.tool_slug;
  if (params.field) request.field = params.field;
  if (params.evidence_url) request.evidenceUrl = params.evidence_url;
  if (params.query) request.query = params.query;
  if (params.host) request.host = params.host;
  if (clientInfo) request.client = clientInfo;
  let result: CatalogFeedbackResult;
  try {
    result = await submit(request, signal);
  } catch {
    return toolError('feedback_unavailable: SlothHub could not record the feedback.', {
      code: 'feedback_unavailable', suggestion: 'Retry later, or use slothhub_check_status to check the configured site.', responseFormat: params.response_format,
    });
  }
  if (!result.ok) {
    const fields = result.failure.errors?.map(({field, message}) => `${field}: ${message}`).join('; ');
    return toolError(`${result.failure.code}: ${result.failure.message}${fields ? ` ${fields}` : ''}`, {
      code: result.failure.code,
      suggestion: result.failure.retryAfterSeconds !== undefined ? `Retry after ${result.failure.retryAfterSeconds} seconds.` : 'Fix the listed fields and send it again.',
      responseFormat: params.response_format,
    });
  }
  const {receipt} = result;
  return formatToolResult(params.response_format, `Feedback ${receipt.replayed ? 'was already' : 'is'} queued for the SlothHub team (id ${receipt.id}). It is private and reviewed before anything changes.`, receipt);
};

export const registerFeedbackTool = (server: McpServer, submit: FeedbackSubmitter): void => {
  server.registerTool('slothhub_submit_feedback', {
    title: 'Send feedback to SlothHub',
    description: `Tell the SlothHub team about a wrong or outdated fact, a missing tool, a setup recipe that worked or failed, a problem with this MCP server, or a suggestion. People and agents can both send it. Feedback goes to a private queue; the team reviews it and turns it into fixes. Nothing is published.

Send it when the user asks, when a fact you retrieved contradicts an official source (include evidence_url), when search finds nothing for a real tool (missing_tool with query), or after you try a setup recipe (setup_worked or setup_failed with tool_slug and host). Never include personal data, secrets, tokens or private code.`,
    inputSchema: feedbackInputSchema,
    outputSchema: feedbackOutputSchema,
    annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true},
  }, (params, ctx) => {
    const version = server.server.getClientVersion();
    return handleFeedback(submit, params, version ? {name: version.name, version: version.version} : undefined, ctx.mcpReq.signal);
  });
};
