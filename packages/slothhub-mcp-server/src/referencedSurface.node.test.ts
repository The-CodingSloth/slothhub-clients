import {Client, InMemoryTransport} from '@modelcontextprotocol/client';
import {afterEach, expect, it} from 'vite-plus/test';
import {z} from 'zod';

import {createSlothHubMcpServer} from './server.js';
import {createFeedClient, FeedRequestError, type FeedResponsePayload, type FetchJson} from './services/feeds.js';

// Prompts and recovery text are instructions to the calling agent. Each tool
// and resource they name must be one the connected server actually offers.
const TOOL_REFERENCE = /\bslothhub_[a-z_]+\b/gu;
const RESOURCE_REFERENCE = /slothhub:\/\/[a-z-]+\/[a-z{}-]+/gu;
const BROWSE_PROMPTS = ['slothhub_browse_stack', 'slothhub_browse_best', 'slothhub_browse_comparison', 'slothhub_browse_alternatives'];

const index = {
  ...{version: '33.0.0', siteUrl: 'https://slothhub.dev', generatedAt: '2026-09-22T00:00:00.000Z'},
  schemaUrl: 'https://slothhub.dev/api/schema.json',
  snapshots: {full: 'https://slothhub.dev/api/catalog.snapshot.json', ndjson: 'https://slothhub.dev/api/catalog.ndjson'},
  feeds: {
    tools: 'https://slothhub.dev/api/tools.json', searchIndex: 'https://slothhub.dev/api/search-index.json',
    categories: 'https://slothhub.dev/api/categories.json', tags: 'https://slothhub.dev/api/tags.json',
    useCases: 'https://slothhub.dev/api/use-cases.json', stacks: 'https://slothhub.dev/api/stacks.json',
    best: 'https://slothhub.dev/api/best.json',
    comparisons: 'https://slothhub.dev/api/compare.json', alternatives: 'https://slothhub.dev/api/alternatives.json',
  },
  // No Markdown hubs: reading them exercises the capability recovery text.
  markdownArtifacts: {},
  integrationHubUrl: 'https://slothhub.dev/agents', markdownHubUrl: 'https://slothhub.dev/agents.md',
  toolDetailUrlTemplate: 'https://slothhub.dev/api/tools/{slug}.json', citationGuidance: [],
};
const envelope = {version: '33.0.0', siteUrl: 'https://slothhub.dev', generatedAt: '2026-09-22T00:00:00.000Z'};
// One stack and one best list keep resources/list populated; every other feed is
// missing, so each lookup takes its not-found or failure path.
const collections = new Map<string, FeedResponsePayload>([
  ['/api/index.json', index],
  ['/api/stacks.json', {...envelope, data: {stacks: [{name: 'Design stack', slug: 'design-stack',
    url: 'https://slothhub.dev/stacks/design-stack', tags: [], tools: []}]}}],
  ['/api/best.json', {...envelope, data: {best: [{title: 'Best design tools', slug: 'design-tools',
    url: 'https://slothhub.dev/best/design-tools', rankedTools: []}]}}],
  ['/api/compare.json', {...envelope, data: {comparisonsUrl: 'https://slothhub.dev/compare', comparisons: []}}],
]);
const fetchJson: FetchJson = async (url) => {
  const body = collections.get(new URL(url).pathname);
  if (body) return body;
  throw new FeedRequestError(new URL(url).pathname, url, 'HTTP 404 Not Found');
};

const errorSchema = z.object({message: z.string(), data: z.json().optional()});
const closes: Array<() => Promise<void>> = [];
afterEach(async () => {await Promise.all(closes.splice(0).map((close) => close()));});

it('names only tools and resources the server offers in prompts and recovery text', async () => {
  const server = createSlothHubMcpServer({feedClient: createFeedClient({fetchJson})});
  const client = new Client({name: 'referenced-surface', version: '1'});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  closes.push(() => client.close(), () => server.close());

  const tools = new Set((await client.listTools()).tools.map(({name}) => name));
  const resources = new Set([
    ...(await client.listResources()).resources.map(({uri}) => uri),
    ...(await client.listResourceTemplates()).resourceTemplates.map(({uriTemplate}) => uriTemplate),
  ]);
  const promptTexts = new Map<string, string>();
  for (const prompt of (await client.listPrompts()).prompts) {
    const required = prompt.arguments?.some(({name, required}) => name === 'query' && required);
    const result = await client.getPrompt({name: prompt.name, arguments: required ? {query: 'design'} : {}});
    promptTexts.set(prompt.name, result.messages.map(({content}) => content.type === 'text' ? content.text : '').join('\n'));
  }

  const recoveryTexts: string[] = [];
  const collectRejection = async (read: Promise<object>) => {
    const error = errorSchema.parse(await read.then(() => {throw new Error('expected a rejected read');}, (rejected) => rejected));
    recoveryTexts.push(error.message, JSON.stringify(error.data ?? null));
  };
  for (const kind of ['tool', 'stack', 'best', 'compare', 'alternatives']) {
    await collectRejection(client.readResource({uri: `slothhub://${kind}/Not-Valid`}));
  }
  for (const uri of ['slothhub://artifact/stacks', 'slothhub://artifact/best', 'slothhub://artifact/compare']) {
    await collectRejection(client.readResource({uri}));
  }
  const missingAlternatives = await client.callTool({name: 'slothhub_get_alternatives', arguments: {slug: 'missing', response_format: 'json'}});
  expect(missingAlternatives.isError).toBe(true);
  recoveryTexts.push(JSON.stringify(missingAlternatives.content), JSON.stringify(missingAlternatives.structuredContent));
  const resourceDescriptions = (await client.listResourceTemplates()).resourceTemplates.map(({description}) => description ?? '');

  const texts = [...promptTexts.values(), ...recoveryTexts, ...resourceDescriptions];
  const named = (pattern: RegExp) => [...new Set(texts.flatMap((text) => text.match(pattern) ?? []))];
  expect(named(TOOL_REFERENCE).filter((name) => !tools.has(name))).toEqual([]);
  expect(named(RESOURCE_REFERENCE).filter((uri) => !resources.has(uri))).toEqual([]);
  // A browse prompt must say which registered collection to open, not leave the agent to guess.
  for (const name of BROWSE_PROMPTS) {
    const text = promptTexts.get(name) ?? '';
    expect((text.match(RESOURCE_REFERENCE) ?? []).filter((uri) => resources.has(uri)), name).not.toEqual([]);
  }
});
