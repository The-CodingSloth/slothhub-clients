import {isValidToolPublicSlug} from '@slothhub/domain/tool-lookup';

import {
  FeedCapabilityUnavailableError,
  FeedClientError,
  type FeedClient,
} from './feedClient.js';
import {failForOutput, jsonLine, ok, safeDiagnostic} from './cliOutput.js';
import {formatComparisonFacts} from './catalogFormat.js';
import {
  appendCatalogContinuation,
  catalogPaginationFailure,
  paginateCatalogItems,
  resolveCatalogPagination,
} from './catalogPagination.js';
import type {
  AgentAlternativesDetail,
  AgentAlternativesSetItem,
  AgentToolSummary,
  CliResult,
} from './types.js';

interface AlternativesListRequest {
  json: boolean;
  slug?: string;
  extraArguments: string[];
  limit?: number;
  offset?: number;
  invalidLimit?: string;
  invalidOffset?: string;
}

// Performance receipt (2026-08-28, Node 22, 5,000 JSON.parse iterations):
// the two-set contract fixture is 2,751 bytes / 0.0076 ms mean; a representative
// 50-set fixture is 65,205 bytes / 0.164 ms mean. Keep consuming the required
// static feed; MAX_FEED_RESPONSE_BYTES is the scaling tripwire for remeasurement.

const summarizeSet = (set: AgentAlternativesSetItem) => ({
  name: set.name,
  slug: set.slug,
  detailUrl: set.detailUrl,
  alternativesUrl: set.alternativesUrl,
  alternativeCount: set.alternativeCount,
});

const summarizeTool = (tool: AgentToolSummary) => ({
  name: tool.name,
  slug: tool.slug,
  description: tool.description,
  pricing: tool.pricing,
  platforms: tool.platforms,
  detailUrl: tool.detailUrl,
  ...(tool.comparisonFacts ? {comparisonFacts: tool.comparisonFacts} : undefined),
});

const projectDetail = (detail: AgentAlternativesDetail) => ({
  name: detail.name,
  slug: detail.slug,
  ...(detail.description ? {description: detail.description} : undefined),
  detailUrl: detail.detailUrl,
  alternativesUrl: detail.alternativesUrl,
  alternativeCount: detail.alternativeCount,
  alternatives: detail.alternatives.map(summarizeTool),
  ...(detail.comparisonFacts ? {comparisonFacts: detail.comparisonFacts} : undefined),
  markdownUrl: detail.markdownUrl,
  jsonUrl: detail.jsonUrl,
  sourceTool: summarizeTool(detail.sourceTool),
});

const formatDetail = (detail: AgentAlternativesDetail): string => {
  const lines = [
    `Alternatives to ${safeDiagnostic(detail.name)}`,
    ...(detail.description ? [safeDiagnostic(detail.description)] : []),
    `Source: ${safeDiagnostic(detail.detailUrl)}`,
    `Alternatives: ${safeDiagnostic(detail.alternativesUrl)}`,
    ...formatComparisonFacts(detail.comparisonFacts),
    '',
    ...detail.alternatives.flatMap((tool, index) => [
      `${safeDiagnostic(tool.name)} (${safeDiagnostic(tool.slug)})`,
      safeDiagnostic(tool.description),
      safeDiagnostic(tool.detailUrl),
      ...formatComparisonFacts(tool.comparisonFacts),
      ...(index < detail.alternatives.length - 1 ? [''] : []),
    ]),
  ];
  return `${lines.join('\n')}\n`;
};

const capabilityUnavailableResult = (
  error: FeedCapabilityUnavailableError,
  json: boolean,
): CliResult => {
  const payload = {
    code: error.code,
    message: error.message,
    recovery: error.recovery,
  };
  return failForOutput(
    json,
    payload,
    `${payload.code}: ${payload.message} Recovery: ${payload.recovery}\n`,
  );
};

const feedClientRecovery = (error: FeedClientError): string => {
  switch (error.code) {
    case 'hash_mismatch':
    case 'revision_mismatch':
      return 'Run `slothhub doctor --json` to inspect catalog feed authentication before retrying.';
    case 'schema_invalid':
      return 'Run `slothhub doctor --json` to inspect catalog feed authentication and check /agents/feed-compatibility.md on the catalog origin for schema compatibility before upgrading the CLI or reporting incompatible feed fields.';
    case 'unsupported_version':
      return 'Upgrade the SlothHub CLI, then run `slothhub doctor --json` to inspect catalog compatibility.';
    case 'not_found':
      return 'Run `slothhub alternatives` to list available alternatives sets.';
    case 'transport':
      return 'Run `slothhub doctor --json` to inspect feed availability, then retry.';
  }
};

const feedClientFailure = (
  error: FeedClientError,
  json: boolean,
): CliResult => {
  const payload = {
    code: error.code,
    path: error.path,
    message: safeDiagnostic(error.message),
    recovery: feedClientRecovery(error),
  };
  return failForOutput(
    json,
    payload,
    `${payload.code}: ${payload.message} Path: ${safeDiagnostic(payload.path)} Recovery: ${payload.recovery}\n`,
  );
};

export const runAlternativesCommand = async (
  client: Pick<FeedClient, 'alternatives' | 'alternative'>,
  request: AlternativesListRequest,
): Promise<CliResult> => {
  if (request.extraArguments.length > 0) {
    const payload = {
      code: 'invalid_input',
      message: 'alternatives accepts at most one slug.',
      recovery: 'Run `slothhub alternatives` to list sets or pass one canonical slug.',
    };
    return failForOutput(request.json, payload, `${payload.message} ${payload.recovery}\n`);
  }
  if (request.slug !== undefined) {
    if (
      request.limit !== undefined ||
      request.offset !== undefined ||
      request.invalidLimit !== undefined ||
      request.invalidOffset !== undefined
    ) {
      const payload = {
        code: 'invalid_input',
        message: '--limit and --offset are only supported when listing alternatives.',
        recovery: 'Remove pagination flags when requesting one alternatives slug.',
      };
      return failForOutput(request.json, payload, `${payload.message} ${payload.recovery}\n`);
    }
    if (!isValidToolPublicSlug(request.slug)) {
      const payload = {
        code: 'invalid_input',
        message: 'Alternatives slug must be a canonical public slug.',
        observedValue: request.slug,
        recovery: 'Run `slothhub alternatives` to list valid slugs.',
      };
      return failForOutput(
        request.json,
        payload,
        `${payload.message} ${payload.recovery}\n`,
      );
    }
    const detailPath = `/api/alternatives/${encodeURIComponent(request.slug)}.json`;
    try {
      const detail = (await client.alternative(request.slug)).data;
      return ok(request.json ? jsonLine(projectDetail(detail)) : formatDetail(detail));
    } catch (error) {
      if (error instanceof FeedCapabilityUnavailableError) {
        return capabilityUnavailableResult(error, request.json);
      }
      if (
        error instanceof FeedClientError &&
        error.path === detailPath &&
        (
          error.code === 'not_found' ||
          (
            error.code === 'transport' &&
            error.cause instanceof Error &&
            /\b(?:HTTP )?404\b/u.test(error.cause.message)
          )
        )
      ) {
        const payload = {
          code: 'not_found',
          message: `Alternatives set not found: ${request.slug}.`,
          recovery: 'Run `slothhub alternatives` to list available alternatives sets.',
        };
        return failForOutput(
          request.json,
          payload,
          `${payload.code}: ${payload.message} Recovery: ${payload.recovery}\n`,
        );
      }
      if (error instanceof FeedClientError) {
        return feedClientFailure(error, request.json);
      }
      throw error;
    }
  }

  let pagination: {limit: number; offset: number};
  try {
    pagination = resolveCatalogPagination(request);
  } catch (error) {
    const failure = catalogPaginationFailure(error, request.json);
    if (failure) return failure;
    throw error;
  }

  let feed;
  try {
    feed = await client.alternatives();
  } catch (error) {
    if (error instanceof FeedCapabilityUnavailableError) {
      return capabilityUnavailableResult(error, request.json);
    }
    if (error instanceof FeedClientError) {
      return feedClientFailure(error, request.json);
    }
    throw error;
  }
  const page = paginateCatalogItems(
    feed.data.sets,
    pagination.limit,
    pagination.offset,
  );

  if (request.json) {
    return ok(jsonLine({
      total: page.total,
      count: page.count,
      offset: page.offset,
      hasMore: page.hasMore,
      ...(page.nextOffset !== undefined ? {nextOffset: page.nextOffset} : undefined),
      alternatives: page.items.map(summarizeSet),
    }));
  }

  if (page.items.length === 0) {
    if (page.total === 0) return ok('No alternatives found.\n');
    const recoveryOffset = Math.floor((page.total - 1) / pagination.limit) * pagination.limit;
    return ok(
      `No alternatives at offset ${page.offset} (${page.total} total). ` +
      `Retry with --offset ${recoveryOffset}.\n`,
    );
  }

  const rows = page.items.map((set) => [
    `${safeDiagnostic(set.name)} (${safeDiagnostic(set.slug)})`,
    `${set.alternativeCount} ${set.alternativeCount === 1 ? 'alternative' : 'alternatives'}`,
    safeDiagnostic(set.alternativesUrl),
  ].join('\n'));
  const body = `${rows.join('\n\n')}\n`;
  return ok(appendCatalogContinuation(body, page));
};
