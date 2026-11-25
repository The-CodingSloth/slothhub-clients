import {
  ProtocolError,
  ProtocolErrorCode,
  type McpServer,
  type ReadResourceResult,
  type Resource} from '@modelcontextprotocol/server';

import {
  BEST_HUB_RESOURCE_URI,
  COMPARISONS_HUB_RESOURCE_URI,
  FEED_RESOURCES,
  STACKS_HUB_RESOURCE_URI,
  type FeedResourceId} from '../constants.js';
import {
  FeedCapabilityUnavailableError,
  FeedTextPayloadLimitError,
  type FeedClient} from '../services/feeds.js';
import type {AgentFeedPayload} from '../types.js';
import {HUB_UNAVAILABLE_RECOVERY} from './slugDiscovery.js';

const feedResourceUri = (id: FeedResourceId): string => `slothhub://feed/${id}`;

const loadFeedResourceJson = async (
  client: FeedClient,
  id: FeedResourceId,
  signal?: AbortSignal,
): Promise<AgentFeedPayload> => {
  switch (id) {
    case 'index':
      return client.index(signal);
    case 'search-index':
      return client.searchIndex(signal);
    case 'tools':
      return client.tools(signal);
    case 'stacks':
      return client.stacks(signal);
    case 'best':
      return client.best(signal);
    case 'categories':
      return client.categories(signal);
    case 'tags':
      return client.tags(signal);
    case 'use-cases':
      return client.useCases(signal);
    case 'alternatives':
      return client.alternatives(signal);
    default: {
      const _exhaustive: never = id;
      throw new Error(`Unknown feed resource: ${_exhaustive}`);
    }
  }
};

type MarkdownArtifactCapability =
  | 'stacksHubMarkdown'
  | 'bestHubMarkdown'
  | 'comparisonsHubMarkdown';

const readMarkdownArtifactResource = async (
  client: FeedClient,
  capability: MarkdownArtifactCapability,
  artifactLabel: string,
  unavailableRecovery: string,
  resourceUri: string,
  signal?: AbortSignal,
): Promise<ReadResourceResult> => {
  try {
    const load = client[capability];
    if (!load) {
      throw new FeedCapabilityUnavailableError(artifactLabel, {
        reason: 'the configured feed client does not implement this artifact',
        recovery: unavailableRecovery,
      });
    }
    return {
      contents: [{
        uri: resourceUri,
        mimeType: 'text/markdown',
        text: await load(signal),
      }],
    };
  } catch (error) {
    if (error instanceof FeedCapabilityUnavailableError) {
      throw new ProtocolError(ProtocolErrorCode.InvalidParams, error.message, {
        code: error.code,
        recovery: error.recovery,
      });
    }
    if (error instanceof FeedTextPayloadLimitError) {
      throw new ProtocolError(ProtocolErrorCode.InternalError, error.message, {
        code: error.code,
        configuredLimitBytes: error.configuredLimitBytes,
        observedBytes: error.observedBytes,
        recovery: error.recovery,
      });
    }
    throw error;
  }
};

/**
 * One static catalog resource: its registration facts (uri, name, metadata)
 * and its read callback. The row is the single source of truth for both
 * `registerResource` and the `resources/list` entry shape, so a registered
 * fixed resource is always listed and always in the SDK aggregate's
 * `{uri, name, ...metadata}` shape.
 */
type FixedResourceDescriptor = {
  uri: string;
  name: string;
  metadata: {
    title: string;
    description: string;
    mimeType: string;
  };
  read: (
    client: FeedClient,
    resourceUri: string,
    signal?: AbortSignal,
  ) => Promise<ReadResourceResult>;
};

const JSON_MIME_TYPE = 'application/json';

const FIXED_RESOURCES: FixedResourceDescriptor[] = [
  ...FEED_RESOURCES.map((feed): FixedResourceDescriptor => ({
    uri: feedResourceUri(feed.id),
    name: `slothhub_feed_${feed.id.replace(/-/g, '_')}`,
    metadata: {
      title: feed.title,
      description: feed.description,
      mimeType: JSON_MIME_TYPE,
    },
    read: async (client, resourceUri, signal) => ({
      contents: [
        {
          uri: resourceUri,
          mimeType: JSON_MIME_TYPE,
          text: JSON.stringify(await loadFeedResourceJson(client, feed.id, signal)),
        },
      ],
    }),
  })),
  {
    uri: STACKS_HUB_RESOURCE_URI,
    name: 'slothhub_artifact_stacks',
    metadata: {
      title: 'Tool Stacks directory',
      description: 'Markdown map of public Tool Stacks and their execution recipes',
      mimeType: 'text/markdown',
    },
    read: (client, resourceUri, signal) =>
      readMarkdownArtifactResource(
        client,
        'stacksHubMarkdown',
        'stacks markdown hub artifact',
        HUB_UNAVAILABLE_RECOVERY.stacks,
        resourceUri,
        signal,
      ),
  },
  {
    uri: BEST_HUB_RESOURCE_URI,
    name: 'slothhub_artifact_best',
    metadata: {
      title: 'Best-of lists directory',
      description: 'Markdown map of public editorial best-of lists and their detail artifacts',
      mimeType: 'text/markdown',
    },
    read: (client, resourceUri, signal) =>
      readMarkdownArtifactResource(
        client,
        'bestHubMarkdown',
        'best-of markdown hub artifact',
        HUB_UNAVAILABLE_RECOVERY.best,
        resourceUri,
        signal,
      ),
  },
  {
    uri: COMPARISONS_HUB_RESOURCE_URI,
    name: 'slothhub_artifact_comparisons',
    metadata: {
      title: 'Editorial comparisons directory',
      description: 'Markdown map of published editorial comparisons and their detail artifacts',
      mimeType: 'text/markdown',
    },
    read: (client, resourceUri, signal) =>
      readMarkdownArtifactResource(
        client,
        'comparisonsHubMarkdown',
        'comparisons markdown hub artifact',
        HUB_UNAVAILABLE_RECOVERY.comparisons,
        resourceUri,
        signal,
      ),
  },
];

/**
 * Register every allowed fixed resource and return the entries the paginated
 * `resources/list` handler should emit. Registration and listing share the
 * descriptor row, so they cannot drift apart.
 */
export const registerFixedResources = (
  server: McpServer,
  client: FeedClient,
  allowedResourceUris?: ReadonlySet<string>,
): Resource[] => {
  const listed: Resource[] = [];
  for (const resource of FIXED_RESOURCES) {
    if (allowedResourceUris && !allowedResourceUris.has(resource.uri)) continue;
    const {uri, name, metadata, read} = resource;
    server.registerResource(name, uri, metadata, (resourceUri, ctx) =>
      read(client, resourceUri.href, ctx.mcpReq.signal),
    );
    listed.push({uri, name, ...metadata});
  }
  return listed;
};
