import {getCachedToolLookupResolver, isValidToolPublicSlug, parseToolReferenceUrl} from '@slothhub/domain/tool-lookup';
import type {ToolLookupNamespace} from '@slothhub/domain/tool-lookup';

import {FeedRequestError, type FeedClient} from '../services/feeds.js';
import type {AgentToolDetail, AgentToolDetailFeed} from '../types.js';

export type PublicToolLookupInput = {
  slug: string;
  namespace?: ToolLookupNamespace;
};

export type PublicToolResolution =
  | {
      kind: 'resolved';
      tool: AgentToolDetail;
      canonicalSlug: string;
      generatedAt: string;
      siteUrl: string;
    }
  | {kind: 'retired'; namespace: string; slug: string}
  | {kind: 'not_found'; slug: string}
  | {kind: 'invalid_input'; message: string}
  | {kind: 'capability_unavailable'}
  | {kind: 'ambiguous'; candidates: string[]}
  | {kind: 'slug_mismatch'; expectedSlug: string; observedSlug: string};

export type PublicToolFailure = Exclude<PublicToolResolution, {kind: 'resolved'}>;

export type PublicToolFailureDescription = {
  code:
    | 'retired'
    | 'not_found'
    | 'invalid_input'
    | 'capability_unavailable'
    | 'ambiguous'
    | 'slug_mismatch';
  message: string;
  recovery: string;
};

export const describePublicToolFailure = (
  resolution: PublicToolFailure,
): PublicToolFailureDescription => {
  switch (resolution.kind) {
    case 'retired':
      return {
        code: 'retired',
        message: `Tool identity ${resolution.namespace}:${resolution.slug} is retired; no current public Tool exists.`,
        recovery: 'Search SlothHub for a current alternative.',
      };
    case 'not_found':
      return {
        code: 'not_found',
        message: `Tool not found: ${resolution.slug}.`,
        recovery: 'Use search to find a valid slug.',
      };
    case 'invalid_input':
      return {
        code: 'invalid_input',
        message: resolution.message,
        recovery: 'Use an allowlisted namespace with its native identifier format.',
      };
    case 'capability_unavailable':
      return {
        code: 'capability_unavailable',
        message: 'Exact Tool lookup is unavailable from this feed version.',
        recovery: 'Use a Sloth Hub slug or update the configured feed origin.',
      };
    case 'ambiguous':
      return {
        code: 'ambiguous',
        message: `Tool lookup is ambiguous: ${resolution.candidates.join(', ')}.`,
        recovery: 'Use a Sloth Hub slug or a more specific canonical identity key.',
      };
    case 'slug_mismatch':
      return {
        code: 'slug_mismatch',
        message: `tool_detail_slug_mismatch: expected=${resolution.expectedSlug} observed=${resolution.observedSlug}`,
        recovery:
          'The public Tool detail feed returned a different slug than requested. Retry once; if it persists, the catalog feed is inconsistent.',
      };
    default: {
      const _exhaustive: never = resolution;
      throw new Error(`Unhandled public Tool resolution: ${_exhaustive}`);
    }
  }
};

const isToolDetailNotFound = <ErrorValue>(
  error: ErrorValue,
  slug: string,
): boolean =>
  error instanceof FeedRequestError &&
  error.status === 404 &&
  error.path === `/api/tools/${encodeURIComponent(slug)}.json`;

export const resolvePublicTool = async (
  client: FeedClient,
  params: PublicToolLookupInput,
  signal?: AbortSignal,
): Promise<PublicToolResolution> => {
  let resolvedSlug = params.slug;
  let feed: AgentToolDetailFeed | undefined;

  // A pasted registry URL resolves to a namespaced key before slug checks apply.
  const urlLookup = params.namespace ? null : parseToolReferenceUrl(params.slug);
  const lookupNamespace = urlLookup?.namespace ?? params.namespace;
  const lookupValue = urlLookup?.value ?? params.slug;

  if (!lookupNamespace && !isValidToolPublicSlug(resolvedSlug)) {
    return {
      kind: 'invalid_input',
      message: 'Tool slug must use lowercase letters, numbers, and hyphens.',
    };
  }

  if (!lookupNamespace) {
    try {
      feed = await client.toolDetail(resolvedSlug, signal);
    } catch (error) {
      if (!isToolDetailNotFound(error, resolvedSlug)) throw error;
    }
  }

  if (!feed) {
    const artifact = await client.toolLookup(signal);
    if (!artifact) {
      if (lookupNamespace) {
        return {kind: 'capability_unavailable'};
      }
      return {kind: 'not_found', slug: params.slug};
    }

    const outcome = getCachedToolLookupResolver(artifact).resolve({
      namespace: lookupNamespace ?? 'slug',
      value: lookupValue,
    });

    switch (outcome.kind) {
      case 'resolved':
      case 'aliased':
        resolvedSlug = outcome.tool.slug;
        break;
      case 'retired':
        return {
          kind: 'retired',
          namespace: outcome.namespace,
          slug: params.slug,
        };
      case 'ambiguous':
        return {
          kind: 'ambiguous',
          candidates: outcome.candidates.map((candidate) => candidate.slug),
        };
      case 'invalid_input':
        return {kind: 'invalid_input', message: outcome.message};
      case 'capability_unavailable':
        return {kind: 'capability_unavailable'};
      case 'not_found':
        return {kind: 'not_found', slug: params.slug};
      default: {
        const _exhaustive: never = outcome;
        throw new Error(`Unhandled Tool lookup outcome: ${_exhaustive}`);
      }
    }

    try {
      feed = await client.toolDetail(resolvedSlug, signal);
    } catch (error) {
      if (isToolDetailNotFound(error, resolvedSlug)) {
        return {kind: 'not_found', slug: params.slug};
      }
      throw error;
    }
  }

  if (feed.data.slug !== resolvedSlug) {
    return {
      kind: 'slug_mismatch',
      expectedSlug: resolvedSlug,
      observedSlug: feed.data.slug,
    };
  }

  return {
    kind: 'resolved',
    tool: feed.data,
    canonicalSlug: resolvedSlug,
    generatedAt: feed.generatedAt,
    siteUrl: feed.siteUrl,
  };
};
