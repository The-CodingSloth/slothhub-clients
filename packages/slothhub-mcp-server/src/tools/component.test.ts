import {Client, InMemoryTransport} from '@modelcontextprotocol/client';
import {describe, expect, it, vi} from 'vite-plus/test';

import {CHARACTER_LIMIT, ResponseFormat} from '../constants.js';
import {createSlothHubMcpServer} from '../server.js';
import {createFeedClient} from '../services/feeds.js';
import type {AgentToolDetail, AgentToolDetailFeed} from '../types.js';
import {getComponentOutputSchema, handleGetComponent} from './component.js';

const SITE = 'https://slothhub.dev';
const component: AgentToolDetail = {
  name: 'Spectrum hero', slug: 'spectrum-hero', description: 'An animated gradient hero.',
  resourceKind: {value: 'ui_component', label: 'UI component'},
  resourceIdentity: {kind: 'website', kindLabel: 'Website', canonicalUrl: 'https://example.com/spectrum-hero', ctaLabel: 'Open site'},
  pricing: 'free', platforms: ['web'], categories: [], tags: [], useCases: [],
  detailUrl: `${SITE}/tool/spectrum-hero`, visitUrl: `${SITE}/go/spectrum-hero`,
  freshness: {isVerified: false}, alternativeTools: [],
  uiComponent: {
    sourceUrl: 'https://example.com/spectrum-hero', authorName: 'SlothHub', original: true,
    license: 'MIT', licenseUrl: 'https://example.com/LICENSE', frameworks: ['React', 'Tailwind CSS'],
    dependencies: ['motion', 'Tailwind CSS v4'], prompt: 'Render it at the top of the landing page.',
    previewImageUrl: 'https://cdn.sanity.io/images/project/production/hero.png', previewAlt: 'A gradient hero',
    apiReference: {exportName: 'SpectrumHero', props: [{name: 'title', type: 'string', description: 'Heading text.', required: true}]},
    accessibility: ['Respects reduced motion.'],
  },
  keyFeatures: ['Source'],
  keyFeatureDetails: [{kind: 'code', feature: 'Source', title: 'Source', summary: 'Files', files: [
    {filename: 'spectrum-hero.tsx', language: 'tsx', code: "import './spectrum-hero.css';\nexport const SpectrumHero = ({title}: {title: string}) => <h1>{title}</h1>;"},
    {filename: 'spectrum-hero.css', language: 'css', code: '.hero { color: red; }'},
    {filename: 'usage.tsx', language: 'tsx', code: '<SpectrumHero title="Hi" />'},
    {filename: 'LICENSE', language: 'text', code: 'MIT License\nCopyright (c) SlothHub'},
  ]}],
};
const indexFeed = {
  version: '33.0.0', siteUrl: SITE, generatedAt: '2026-11-17T00:00:00.000Z', schemaUrl: `${SITE}/api/schema.json`,
  snapshots: {full: `${SITE}/api/catalog.snapshot.json`, ndjson: `${SITE}/api/catalog.ndjson`}, markdownArtifacts: {},
  feeds: {
    tools: `${SITE}/api/tools.json`, searchIndex: `${SITE}/api/search-index.json`, categories: `${SITE}/api/categories.json`,
    tags: `${SITE}/api/tags.json`, useCases: `${SITE}/api/use-cases.json`, stacks: `${SITE}/api/stacks.json`, best: `${SITE}/api/best.json`,
  },
  integrationHubUrl: `${SITE}/agents`, markdownHubUrl: `${SITE}/agents.md`,
  toolDetailUrlTemplate: `${SITE}/api/tools/{slug}.json`, citationGuidance: ['Cite canonical pages.'],
};
const createClient = (detail: AgentToolDetail = component) => createFeedClient({baseUrl: SITE, fetchJson: vi.fn(async (url: string) => {
  if (url === `${SITE}/api/index.json`) return indexFeed;
  if (url === `${SITE}/api/tools/${detail.slug}.json`) {
    const feed: AgentToolDetailFeed = {version: '33.0.0', siteUrl: SITE, generatedAt: indexFeed.generatedAt, data: detail};
    return feed;
  }
  throw new Error('HTTP 404 Not Found');
})});
const call = async (params: {slug: string; file?: string}, detail?: AgentToolDetail) =>
  handleGetComponent(createClient(detail), {...params, response_format: ResponseFormat.JSON});

describe('slothhub_get_component', () => {
  it('hands an agent the files, license, dependencies and registry install command through a real MCP client', async () => {
    const server = createSlothHubMcpServer({feedClient: createClient()});
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({name: 'test', version: '1.0.0'});
    await client.connect(clientTransport);
    const result = await client.callTool({name: 'slothhub_get_component', arguments: {slug: 'spectrum-hero', response_format: 'json'}});
    expect(result.isError).toBeFalsy();
    const output = getComponentOutputSchema.parse(result.structuredContent);
    expect(output.install).toEqual({
      kind: 'slothhub_registry', namespacedName: '@slothhub/spectrum-hero',
      itemUrl: `${SITE}/r/spectrum-hero.json`, command: `npx shadcn@latest add ${SITE}/r/spectrum-hero.json`,
      componentsJsonRegistries: {'@slothhub': `${SITE}/r/{name}.json`},
    });
    expect(output.files.map(({path, role}) => [path, role])).toEqual([
      ['spectrum-hero.tsx', 'source'], ['spectrum-hero.css', 'source'], ['usage.tsx', 'usage'], ['LICENSE', 'notice'],
    ]);
    expect(output.dependencies).toEqual(['motion']);
    expect(output.otherRequirements).toEqual(['Tailwind CSS v4']);
    expect(output.license).toMatchObject({name: 'MIT', original: true});
    expect(output.apiReference?.exportName).toBe('SpectrumHero');
    expect(output.notes.accessibility).toEqual(['Respects reduced motion.']);
    await client.close();
  });

  it('returns one requested file and names the rest', async () => {
    const output = getComponentOutputSchema.parse((await call({slug: 'spectrum-hero', file: 'LICENSE'})).structuredContent);
    expect(output.files.map(({path}) => path)).toEqual(['LICENSE']);
    expect(output.omittedFiles).toEqual(['spectrum-hero.tsx', 'spectrum-hero.css', 'usage.tsx']);
  });

  it('fails explicitly for an unknown file, a non-component Tool and an oversized component', async () => {
    expect((await call({slug: 'spectrum-hero', file: 'missing.tsx'})).structuredContent).toMatchObject({code: 'unknown_file', field: 'file'});
    const {uiComponent: _uiComponent, ...tool} = component;
    expect((await call({slug: 'spectrum-hero'}, {...tool, resourceKind: {value: 'app', label: 'App'}})).structuredContent).toMatchObject({code: 'not_a_component'});
    const huge: AgentToolDetail = {...component, keyFeatureDetails: [{kind: 'code', feature: 'Source', title: 'Source', summary: 'Files', files: [
      {filename: 'spectrum-hero.tsx', language: 'tsx', code: `export const big = '${'x'.repeat(CHARACTER_LIMIT)}';`},
      {filename: 'LICENSE', language: 'text', code: 'MIT License'},
    ]}]};
    const tooLarge = await call({slug: 'spectrum-hero'}, huge);
    expect(tooLarge.structuredContent).toMatchObject({code: 'component_too_large', configuredLimit: CHARACTER_LIMIT});
    expect((await call({slug: 'spectrum-hero', file: 'LICENSE'}, huge)).isError).toBeFalsy();
  });

  it('points to the creator command and explains manual setup for components the registry cannot install', async () => {
    const upstream = await call({slug: 'spectrum-hero'}, {...component, quickstarts: [{kind: 'install_command', label: 'Install', status: 'official', statusLabel: 'Official', command: 'npx shadcn@latest add https://example.com/r/hero.json', commandLanguage: 'shell'}]});
    expect(getComponentOutputSchema.parse(upstream.structuredContent).install).toMatchObject({kind: 'upstream', command: 'npx shadcn@latest add https://example.com/r/hero.json'});
    const vue = await call({slug: 'spectrum-hero'}, {...component, uiComponent: component.uiComponent && {...component.uiComponent, frameworks: ['Vue']}});
    expect(getComponentOutputSchema.parse(vue.structuredContent).install).toMatchObject({kind: 'manual', reason: 'not_react'});
  });
});
