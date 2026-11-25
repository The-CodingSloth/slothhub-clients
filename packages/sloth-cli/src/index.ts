export { runCli } from './cli.js';
export {
  buildImplementationPlan,
  compareTools,
  getCitationResult,
  recommendTools,
} from './agentWorkflows.js';
export {
  createFeedClient,
  FeedClientError,
  FeedHttpStatusError,
} from './feedClient.js';
export type {
  FeedClient,
  FeedClientOptions,
  FetchJson,
} from './feedClient.js';
export {searchPublicAgentCatalog as searchTools} from '@slothhub/domain/agent-search'
export type {
  CitationResult,
  CitationSource,
  ComparisonResult,
  ImplementationPlanResult,
  RecommendationResult,
} from './agentWorkflows.js';
export type { CliResult } from './types.js';
export {
  parseProjectToolPinManifest,
  renderProjectToolPinManifest,
  type ProjectToolPinManifest,
} from '@slothhub/domain/project-tool-pin-manifest';

export type {RunCliDependencies} from './cli.js';
export type {CliOutputWriter} from './catalogStream.js';
