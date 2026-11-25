import {McpServer, ProtocolError, ProtocolErrorCode} from '@modelcontextprotocol/server';
import {AGENT_SEARCH_MAX_QUERY_CHARACTERS} from '@slothhub/domain/agent-search';
import {SLOTHHUB_PROMPT_NAMES} from '@slothhub/domain/sloth-hub-prompt-names';

import {stripUnsafePromptArgumentCharacters} from './prompts.js';
import type {FeedClient} from './services/feeds.js';
import {isValidCatalogResourceSlug, CATALOG_RESOURCE_TEMPLATE_URIS, TOOL_RESOURCE_TEMPLATE_URI, STACK_RESOURCE_TEMPLATE_URI, BEST_RESOURCE_TEMPLATE_URI, COMPARISON_RESOURCE_TEMPLATE_URI, ALTERNATIVES_RESOURCE_TEMPLATE_URI} from './resources/catalogResourceUri.js';

const normalize = (value: string): string => value.normalize('NFC').toLowerCase();

/** MCP completion responses permit at most 100 values; total preserves the full match count. */
export const registerPromptCompletions = (server: McpServer, client: FeedClient, allowedTemplates: readonly string[] = CATALOG_RESOURCE_TEMPLATE_URIS, includePrompts = true): void => {
  server.server.registerCapabilities({completions: {}});
  // The SDK's completable handler throws and echoes unknown references. This small
  // protocol adapter instead implements our empty-result contract without private SDK hooks.
  server.server.setRequestHandler('completion/complete', (request) => {
    const empty = {completion: {values: [], total: 0, hasMore: false}};
    const {ref, argument} = request.params;
    if (ref.type === 'ref/prompt') {
      if (!includePrompts || argument.name !== 'query' || !SLOTHHUB_PROMPT_NAMES.some((name) => name === ref.name)) return empty;
    } else if (argument.name !== 'slug' || !allowedTemplates.includes(ref.uri)) return empty;
    const observed = Array.from(argument.value).length;
    if (observed > AGENT_SEARCH_MAX_QUERY_CHARACTERS) {
      throw new ProtocolError(ProtocolErrorCode.InvalidParams,
        `completion_argument_too_large: limit_characters=${AGENT_SEARCH_MAX_QUERY_CHARACTERS} actual_characters=${observed} recovery=Shorten the argument to at most ${AGENT_SEARCH_MAX_QUERY_CHARACTERS} characters.`);
    }
    const snapshot = client.completionCandidates?.();
    if (!snapshot) return empty;
    let candidates;
    switch (ref.type === 'ref/prompt' ? ref.name : ref.uri) {
      case 'slothhub_discover_tool':
        candidates = [...snapshot.tools, ...snapshot.categories, ...snapshot.tags, ...snapshot.useCases];
        break;
      case 'slothhub_find_mcp_server':
        candidates = snapshot.tools.filter((tool) => tool.resourceKind === 'mcp_server');
        break;
      case 'slothhub_find_agent_skill':
        candidates = snapshot.tools.filter((tool) => tool.resourceKind === 'agent_skill');
        break;
      case 'slothhub_browse_stack': candidates = snapshot.stacks; break;
      case 'slothhub_browse_best': candidates = snapshot.best; break;
      case 'slothhub_browse_comparison': candidates = snapshot.comparisons; break;
      case 'slothhub_browse_alternatives': candidates = snapshot.alternatives; break;
      case TOOL_RESOURCE_TEMPLATE_URI: candidates = snapshot.tools; break;
      case STACK_RESOURCE_TEMPLATE_URI: candidates = snapshot.stacks; break;
      case BEST_RESOURCE_TEMPLATE_URI: candidates = snapshot.best; break;
      case COMPARISON_RESOURCE_TEMPLATE_URI: candidates = snapshot.comparisons; break;
      case ALTERNATIVES_RESOURCE_TEMPLATE_URI: candidates = snapshot.alternatives; break;
      default: return empty;
    }
    const prefix = normalize(stripUnsafePromptArgumentCharacters(argument.value));
    const values = [...new Set(candidates
      .filter(({name, slug}) => isValidCatalogResourceSlug(slug) &&
        (normalize(name).startsWith(prefix) || normalize(slug).startsWith(prefix)))
      .map(({slug}) => slug))].sort();
    return {completion: {values: values.slice(0, 100), total: values.length, hasMore: values.length > 100}};
  });
};
