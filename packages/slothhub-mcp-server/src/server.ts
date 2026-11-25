import {registerAgentWorkflowTools} from './tools/agentWorkflows.js';
import {z} from 'zod';
import { McpServer } from '@modelcontextprotocol/server';

import {
  SERVER_INSTRUCTIONS,
  SERVER_NAME,
  SERVER_VERSION,
  resolveBaseUrl} from './constants.js';
import {registerWorkflowPrompts} from './prompts.js';
import {registerPromptCompletions} from './promptCompletions.js';
import {registerFixedResources} from './resources/fixed.js';
import {installPaginatedResourcesList} from './resources/pagination.js';
import {registerTemplateResources} from './resources/templates.js';
import {doctorInputSchema, getAlternativesInputSchema} from './schemas/inputs.js';
import {doctorOutputSchema} from './schemas/outputs.js';
import {
  createFeedClient,
  type FeedClient,
  type FetchText} from './services/feeds.js';
import {handleDoctor, handleGetAlternatives} from './tools/handlers.js';
import {registerConnectorTools, type SearchWithoutResultsHook} from './tools/connectorRetrieval.js';
import {registerGetComponentTool} from './tools/component.js';
import {registerImplementTool} from './tools/implement.js';
import {createHttpFeedbackSubmitter, registerFeedbackTool, type FeedbackSubmitter} from './tools/feedback.js';

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export interface SlothHubMcpServerOptions {
  baseUrl?: string;
  fetchJson?: NonNullable<Parameters<typeof createFeedClient>[0]>['fetchJson'];
  fetchText?: FetchText;
  /** Reuse an immutable feed client/cache while keeping MCP protocol state request-scoped. */
  feedClient?: FeedClient;
  /** Hosted only: record text searches that found nothing, for the missing-tool demand report. */
  onSearchWithoutResults?: SearchWithoutResultsHook;
  /** Where slothhub_submit_feedback sends reports; defaults to POST {baseUrl}/api/feedback. */
  submitFeedback?: FeedbackSubmitter;
  allowedToolNames?: readonly string[];
  allowedResourceUris?: readonly string[];
  allowedTemplates?: readonly string[];
  includePrompts?: boolean;
  includeCompletions?: boolean;
  /**
   * Serialized byte bound for one resources/list page.
   * Defaults to the shared 128 KiB budget in resources/pagination.ts.
   */
  resourceListPageBudgetBytes?: number;
}

export const createSlothHubMcpServer = (
  options: SlothHubMcpServerOptions = {},
): McpServer => {
  const baseUrl = resolveBaseUrl(options.baseUrl);
  const client =
    options.feedClient ??
    createFeedClient({
      baseUrl,
      fetchJson: options.fetchJson,
      fetchText: options.fetchText,
    });

  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      websiteUrl: baseUrl,
      icons: [
        {
          src: `${baseUrl}/favicon.svg`,
          mimeType: 'image/svg+xml',
          sizes: ['any'],
        },
      ],
    },
    {
      instructions: SERVER_INSTRUCTIONS,
      capabilities: {
        // SAFETY: The owner parser or adjacent runtime guard establishes each asserted property contract.
        tools: {
          listChanged: false as const
        },
        // SAFETY: The owner parser or adjacent runtime guard establishes each asserted property contract.
        resources: {
          listChanged: false as const
        },
        ...(!(options.includePrompts === false) ? { prompts: { listChanged: false } } : undefined)
      },
      cacheHints: {
        'server/discover': { ttlMs: 300_000, cacheScope: 'public' },
        'tools/list': { ttlMs: 300_000, cacheScope: 'public' },
        'prompts/list': { ttlMs: 300_000, cacheScope: 'public' },
        'resources/list': { ttlMs: 300_000, cacheScope: 'public' },
        'resources/templates/list': { ttlMs: 300_000, cacheScope: 'public' },
        'resources/read': { ttlMs: 60_000, cacheScope: 'public' },
      },
    },
  );

  const allowedToolNames = options.allowedToolNames
    ? new Set(options.allowedToolNames)
    : undefined;
  const allowedResourceUris = options.allowedResourceUris
    ? new Set(options.allowedResourceUris)
    : undefined;
  const allowedTemplates = options.allowedTemplates
    ? new Set(options.allowedTemplates)
    : undefined;
  const isToolAllowed = (name: string): boolean =>
    !allowedToolNames || allowedToolNames.has(name);

  registerConnectorTools(server, client, isToolAllowed, options.onSearchWithoutResults);
  registerAgentWorkflowTools(server, client, isToolAllowed);

  const fixedResourceEntries = registerFixedResources(
    server,
    client,
    allowedResourceUris,
  );
  const resourceListingSources = registerTemplateResources(
    server,
    client,
    allowedTemplates,
  );
  installPaginatedResourcesList(server, {
    fixed: fixedResourceEntries,
    sources: resourceListingSources,
    pageBudgetBytes: options.resourceListPageBudgetBytes,
  });
  if (options.includePrompts !== false) {
    registerWorkflowPrompts(server);
  }
  if (options.includeCompletions !== false) registerPromptCompletions(server, client, options.allowedTemplates, options.includePrompts !== false);

  if (isToolAllowed('slothhub_get_implementation_kit')) registerImplementTool(server, client);
  if (isToolAllowed('slothhub_get_component')) registerGetComponentTool(server, client);
  if (isToolAllowed('slothhub_submit_feedback')) registerFeedbackTool(server, options.submitFeedback ?? createHttpFeedbackSubmitter(baseUrl));
  if (isToolAllowed('slothhub_get_alternatives')) server.registerTool('slothhub_get_alternatives', {
    title: 'Get alternatives to a Tool',
    description: 'List the Tools SlothHub editors recommend instead of one Tool, each with the tradeoff that makes it a better or worse fit and a canonical citation. Use it when the user asks for something like X, cheaper than X, or open-source instead of X; pass the Tool slug from search. Tools without an editorial alternatives page return not_found; use search with similar filters instead.',
    inputSchema: getAlternativesInputSchema,
    // Feed parsing owns the complete Tool facts; discovery describes the envelope.
    outputSchema: z.object({alternatives: z.looseObject({
      slug: z.string(), sourceTool: z.looseObject({name: z.string(), slug: z.string(), detailUrl: z.string()}),
      alternatives: z.array(z.looseObject({name: z.string(), slug: z.string(), detailUrl: z.string()})),
    })}),
    annotations: readOnlyAnnotations,
  }, (params, ctx) => handleGetAlternatives(client, params, ctx.mcpReq.signal, allowedTemplates));
  if (isToolAllowed('slothhub_check_status')) server.registerTool('slothhub_check_status', {
    title: 'Check SlothHub connection status',
    description: 'Check that this server can reach the SlothHub catalog: each public feed it reads, its version and compatibility, and network problems such as a blocked host or proxy. Use it when another tool fails with feed_load_error, feed_host_blocked or unsupported_version; each problem comes with a recovery step. Takes no input.',
    inputSchema: doctorInputSchema,
    outputSchema: doctorOutputSchema,
    annotations: readOnlyAnnotations,
  }, (params, ctx) => handleDoctor(client, params, baseUrl, ctx.mcpReq.signal));
  return server;
};
