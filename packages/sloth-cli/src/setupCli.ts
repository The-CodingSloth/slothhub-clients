import {AGENT_SETUP_RECIPE_HOST_VALUES, isAgentSetupRecipeHost, getAgentSetupRecipeUnknownNotice, getAgentSetupRecipeHostConfigHint, isAgentSetupRecipeConfigHost, resolvePublicAgentSetupRecipeEntries, type AgentSetupRecipeUnknownReason} from '@slothhub/domain/mcp-registry';
import {isValidToolPublicSlug} from '@slothhub/domain/tool-lookup';
import {formatSetupRecipeLines, stripTerminalControls} from './catalogFormat.js';
import {failForOutput, jsonLine, ok, safeDiagnostic} from './cliOutput.js';
import {FeedClientError, type FeedClient} from './feedClient.js';
import type {AgentToolDetail, CliResult} from './types.js';

interface SetupCliRequest {
  host?: string;
  positionals: string[];
  json: boolean;
  baseUrl: string;
}

const UNKNOWN_REASON_MESSAGES = {
  missing_remotes: 'The Registry observation has no confirmed public remote.',
  sse_only: 'The Registry published SSE only; this host recipe needs streamable HTTP.',
  deprecated_registry: 'The Registry entry is deprecated or deleted.',
  no_recipe: 'The feed has no current recipe for this Agent Host.',
} satisfies Record<AgentSetupRecipeUnknownReason, string>;

export const runSetupCommand = async (
  client: Pick<FeedClient, 'tool'>,
  request: SetupCliRequest,
): Promise<CliResult> => {
  const [slug] = request.positionals;
  if (request.positionals.length !== 1 || !isValidToolPublicSlug(slug) || !request.host) {
    return failForOutput(request.json, {
      code: 'invalid_input',
      message: 'Usage: slothhub setup --host <agent-host> <slug>.',
      allowedHosts: AGENT_SETUP_RECIPE_HOST_VALUES,
      recovery: 'Pass one public Tool slug and a supported --host value.',
    });
  }

  const detailUrl = new URL(`/tool/${slug}`, request.baseUrl).href;
  const host = request.host;
  if (!isAgentSetupRecipeHost(host)) {
    const message = `Unknown Agent Host: ${safeDiagnostic(host)}.`;
    const recovery = `Choose --host from ${AGENT_SETUP_RECIPE_HOST_VALUES.join(', ')}. Review ${detailUrl}`;
    return failForOutput(request.json, {
      code: 'unknown_host', state: 'unknown', reason: 'unknown_host',
      host, slug, detailUrl, message, recovery,
      allowedHosts: AGENT_SETUP_RECIPE_HOST_VALUES,
    }, `unknown_host: ${message} Tool: ${slug}. ${recovery}\n`);
  }

  let tool: AgentToolDetail;
  try {
    ({data: tool} = await client.tool(slug));
  } catch (error) {
    if (!(error instanceof FeedClientError) || error.code !== 'transport' || error.httpStatus !== 404 || error.path !== `/api/tools/${slug}.json`) throw error;
    return failForOutput(request.json, {
      code: 'not_found', message: `Tool not found: ${slug}.`,
      recovery: 'Search SlothHub for a current public Tool slug and try again.',
    });
  }
  if (tool.slug !== slug) {
    throw new FeedClientError('schema_invalid', `/api/tools/${slug}.json`, 'Tool detail identity does not match the requested slug.');
  }
  const recipes = (tool.agentInterfaces ?? [])
    .filter((entry) => entry.kind === 'mcp_server' && entry.status !== 'deprecated')
    .flatMap(resolvePublicAgentSetupRecipeEntries)
    .filter((entry) => entry.host === host);
  const readyRecipes = recipes.filter((entry) => entry.state === 'ready');
  if (readyRecipes.length > 1) {
    const message = 'Several interfaces have a ready recipe for this host.';
    const recovery = `Open ${tool.detailUrl} to review the available interfaces and their documentation.`;
    return failForOutput(request.json, {
      code: 'ambiguous_recipe', host, slug, detailUrl: tool.detailUrl,
      observedCount: readyRecipes.length, message, recovery,
    }, `ambiguous_recipe: ${message} Host: ${host}. Tool: ${slug}. ${recovery}\n`);
  }
  const [recipe] = readyRecipes;
  if (!recipe) {
    const unavailable = recipes.find((entry) => entry.state === 'unknown');
    const reason = unavailable?.reason ?? 'no_recipe';
    const message = `${UNKNOWN_REASON_MESSAGES[reason]} ${getAgentSetupRecipeUnknownNotice(host, reason)}`;
    const recovery = `Review the Tool page for current setup documentation: ${tool.detailUrl}`;
    return failForOutput(request.json, {
      code: reason, state: 'unknown', reason, host, slug,
      detailUrl: tool.detailUrl, message, recovery,
    }, `${reason}: ${message} Host: ${host}. Tool: ${slug}. ${recovery}\n`);
  }

  const configHint = isAgentSetupRecipeConfigHost(host) ? getAgentSetupRecipeHostConfigHint(host) : undefined;
  if (request.json) return ok(jsonLine({host, slug, detailUrl: tool.detailUrl, recipe, configHint}));
  return ok([
    ...formatSetupRecipeLines(recipe),
    `Tool: ${tool.detailUrl}`,
  ].map(stripTerminalControls).join('\n') + '\n');
};
