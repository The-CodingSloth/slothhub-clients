import {listAdvertisedCatalogFeeds} from '@slothhub/domain/advertised-catalog-feeds';
import {safeDiagnostic} from '@slothhub/domain/safe-diagnostic';
import {summarizeNetworkEnvironment} from '@slothhub/domain/network-environment';

import {ResponseFormat} from '../constants.js';
import type {AgentIndexFeed} from '../types.js';
import {formatToolResult, type ToolContentResult} from './format.js';

export const buildDoctorResult = (
  feed: AgentIndexFeed,
  baseUrl: string,
  responseFormat: ResponseFormat,
): ToolContentResult => {
  const structured = {
    version: feed.version,
    siteUrl: feed.siteUrl,
    generatedAt: feed.generatedAt,
    baseUrl,
    schemaUrl: feed.schemaUrl,
    feeds: feed.feeds,
    snapshots: feed.snapshots,
    citationGuidance: feed.citationGuidance,
    networkEnvironment: summarizeNetworkEnvironment(process.env),
  };
  const lines = [
    '# Sloth Hub feed diagnostics',
    '',
    `- Feed version: ${safeDiagnostic(feed.version)}`,
    `- Site URL: ${safeDiagnostic(feed.siteUrl)}`,
    `- Generated: ${safeDiagnostic(feed.generatedAt)}`,
    `- Base URL: ${safeDiagnostic(baseUrl)}`,
    `- Schema: ${safeDiagnostic(feed.schemaUrl)}`,
    `- Manifest: ${safeDiagnostic(baseUrl.replace(/\/+$/, ''))}/api/index.json`,
  ];
  const advertised = listAdvertisedCatalogFeeds(feed);

  for (const group of ['feeds', 'snapshots'] as const) {
    const items = advertised.filter((item) => item.group === group);
    if (items.length === 0) continue;
    lines.push('', group === 'feeds' ? 'Feeds:' : 'Snapshots:');
    for (const item of items) {
      lines.push(`- ${safeDiagnostic(item.key)}: ${safeDiagnostic(item.url)}`);
    }
  }

  return formatToolResult(responseFormat, lines.join('\n'), structured);
};
