import { CHARACTER_LIMIT, ResponseFormat } from '../constants.js';
import {AdvertisedCatalogFeedLimitError, InvalidAdvertisedCatalogUrlError} from '@slothhub/domain/advertised-catalog-feeds';
import {AgentSearchPayloadLimitError, type PublicAgentSearchFilters} from '@slothhub/domain/agent-search';
import {describeNetworkEnvironmentHint, redactNetworkEnvironmentSecrets, type NetworkEnvironmentHint} from '@slothhub/domain/network-environment';
import {isRuntimeString} from '@slothhub/domain/runtime-validation';
import {serializeTerminalSafeJson} from '@slothhub/domain/safe-diagnostic';
import {ToolLookupArtifactLimitError} from '@slothhub/domain/tool-lookup';
import {UnsupportedFeedVersionError} from '@slothhub/domain/feed-compatibility';
import {FeedHostBlockedError} from '@slothhub/domain/public-feed-http';
import {type JsonValue} from '@slothhub/domain/json-value';
import { FeedCapabilityUnavailableError, FeedTextPayloadLimitError } from '../services/feeds.js';
import {
  catalogResourceUri,
  isValidCatalogResourceSlug,
  BEST_RESOURCE_TEMPLATE_URI,
  STACK_RESOURCE_TEMPLATE_URI,
  TOOL_RESOURCE_TEMPLATE_URI,
  COMPARISON_RESOURCE_TEMPLATE_URI,
  ALTERNATIVES_RESOURCE_TEMPLATE_URI,
  type CatalogResourceKind,
} from '../resources/catalogResourceUri.js';

const JSON_MIME_TYPE = 'application/json';

export type CatalogResourceLink = {
  kind: CatalogResourceKind;
  slug: string;
  name: string;
};

export type ResourceLinkContent = {
  type: 'resource_link';
  uri: string;
  name: string;
  mimeType: typeof JSON_MIME_TYPE;
};

export type ToolContentResult<Structured extends object = object> = {
  content: [{ type: 'text'; text: string }, ...ResourceLinkContent[]];
  structuredContent?: Structured;
  isError?: boolean;
};

export type ToolErrorPayload = {
  host?: string;
  detailUrl?: string;
  supportedHosts?: readonly string[];
  code: string;
  message: string;
  suggestion?: string;
  recovery?: string;
  observedValue?: JsonValue;
  filter?: keyof PublicAgentSearchFilters;
  configuredLimit?: number;
  field?: string;
  configuredLimitBytes?: number;
  observedBytes?: number;
  observedCount?: number;
  supportedVersion?: string;
  observedVersion?: string;
  hint?: NetworkEnvironmentHint;
  httpStatus?: number;
  mitigation?: string;
};

type ToolErrorDetails = Omit<ToolErrorPayload, 'code' | 'message' | 'suggestion'>;

const FEED_LOAD_SUGGESTION =
  'Try slothhub_check_status to verify feed URLs, or set SLOTHHUB_BASE_URL.';

export const truncateText = (text: string): string => {
  if (text.length <= CHARACTER_LIMIT) {
    return text;
  }

  return `${text.slice(0, CHARACTER_LIMIT)}\n\n[Truncated. CHARACTER_LIMIT=${CHARACTER_LIMIT}, observed_characters=${text.length}. Read the complete structuredContent, or request response_format=json.]`;
};

export const formatToolResult = <Structured extends object>(
  responseFormat: ResponseFormat,
  markdown: string | (() => string),
  structured: Structured,
  resourceLinks: readonly CatalogResourceLink[] = [],
  allowedTemplates?: ReadonlySet<string>,
): ToolContentResult<Structured> => {
  const links: ResourceLinkContent[] = resourceLinks.flatMap((link) => {
    if (!isValidCatalogResourceSlug(link.slug)) return [];
    const templateUri = {
      tool: TOOL_RESOURCE_TEMPLATE_URI,
      stack: STACK_RESOURCE_TEMPLATE_URI,
      best: BEST_RESOURCE_TEMPLATE_URI,
      compare: COMPARISON_RESOURCE_TEMPLATE_URI,
      alternatives: ALTERNATIVES_RESOURCE_TEMPLATE_URI,
    }[link.kind];
    if (allowedTemplates && !allowedTemplates.has(templateUri)) return [];
    return [{
      type: 'resource_link',
      uri: catalogResourceUri(link.kind, link.slug),
      name: link.name,
      mimeType: JSON_MIME_TYPE,
    }];
  });
  if (responseFormat === ResponseFormat.JSON) {
    // Never slice JSON — truncation would make content[0].text unparseable.
    const text = serializeTerminalSafeJson(structured, 2);
    return {
      content: [{ type: 'text', text }, ...links],
      structuredContent: structured,
    };
  }

  return {
    content: [{ type: 'text', text: truncateText(isRuntimeString(markdown) ? markdown : markdown()) }, ...links],
    structuredContent: structured,
  };
};

export const toolError = (
  message: string,
  options: {
    code?: string;
    suggestion?: string;
    responseFormat?: ResponseFormat;
    details?: ToolErrorDetails;
  } = {}
): ToolContentResult<ToolErrorPayload> => {
  const code = options.code ?? 'tool_error';
  const suggestion = options.suggestion;
  const responseFormat = options.responseFormat ?? ResponseFormat.MARKDOWN;
  const structured: ToolErrorPayload = {
    ...options.details, code, message,
    ...(suggestion ? { suggestion } : undefined)
  };
  const text =
    responseFormat === ResponseFormat.JSON
      ? serializeTerminalSafeJson(structured, 2)
      : suggestion
        ? `${message} ${suggestion}`
        : message;

  return {
    isError: true,
    content: [{ type: 'text', text }],
    structuredContent: structured,
  };
};

export const feedLoadError = <ErrorValue>(
  operation: string,
  error: ErrorValue,
  responseFormat: ResponseFormat = ResponseFormat.MARKDOWN,
  suggestion = FEED_LOAD_SUGGESTION,
): ToolContentResult<ToolErrorPayload> => {
  if (error instanceof InvalidAdvertisedCatalogUrlError) {
    return toolError(error.message, {
      code: error.code,
      suggestion: error.recovery,
      responseFormat,
      details: {
        field: `${error.group}.${error.key}`,
        recovery: error.recovery,
      },
    });
  }
  if (error instanceof AdvertisedCatalogFeedLimitError) {
    return toolError(error.message, {
      code: error.code,
      suggestion: error.recovery,
      responseFormat,
      details: {
        configuredLimit: error.configuredLimit,
        observedCount: error.observedCount,
        recovery: error.recovery,
      },
    });
  }
  if (error instanceof UnsupportedFeedVersionError) {
    const recovery = 'Upgrade the MCP server with npm install -g slothhub-mcp-server@latest, then restart your MCP client.';
    return toolError(error.message, {
      code: error.code,
      suggestion: recovery,
      responseFormat,
      details: {
        supportedVersion: error.supportedVersion,
        observedVersion: error.observedVersion,
        recovery,
      },
    });
  }
  if (error instanceof FeedHostBlockedError) {
    return toolError(error.message, {
      code: error.code,
      suggestion: error.recovery,
      responseFormat,
      details: {httpStatus: error.httpStatus, mitigation: error.mitigation, recovery: error.recovery},
    });
  }
  if (error instanceof FeedTextPayloadLimitError) {
    return toolError(error.message, {code: error.code, suggestion: error.recovery, responseFormat, details: {configuredLimitBytes: error.configuredLimitBytes, observedBytes: error.observedBytes, recovery: error.recovery}});
  }
  if (error instanceof ToolLookupArtifactLimitError) {
    return toolError(error.message, {
      code: error.code,
      suggestion: error.recovery,
      responseFormat,
      details: {
        configuredLimit: error.configuredLimit,
        observedValue: error.observedValue,
        recovery: error.recovery,
      },
    });
  }
  if (error instanceof AgentSearchPayloadLimitError) {
    return toolError(error.message, {
      code: error.code,
      suggestion: error.recovery,
      responseFormat,
      details: {
        configuredLimitBytes: error.configuredLimitBytes,
        observedBytes: error.observedBytes,
        recovery: error.recovery,
      },
    });
  }
  if (error instanceof FeedCapabilityUnavailableError) {
    return toolError(error.message, {
      code: error.code,
      suggestion: error.recovery,
      responseFormat,
      details: {recovery: error.recovery},
    });
  }
  const detail = redactNetworkEnvironmentSecrets(
    error instanceof Error ? error.message : String(error),
    process.env,
  );
  const networkHint = describeNetworkEnvironmentHint(error, process.env);
  return toolError(`Error ${operation}: ${detail}.`, {
    code: 'feed_load_error',
    suggestion: networkHint ? `${suggestion} ${networkHint.message}` : suggestion,
    responseFormat,
    details: networkHint ? {hint: networkHint} : undefined,
  });
};

export const notFoundError = (
  resourceLabel: string,
  identifier: string,
  suggestion: string,
  responseFormat: ResponseFormat = ResponseFormat.MARKDOWN
): ToolContentResult<ToolErrorPayload> =>
  toolError(`${resourceLabel} not found: ${identifier}.`, {
    code: 'not_found',
    suggestion,
    responseFormat,
  });
