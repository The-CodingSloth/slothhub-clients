import {describe, expect, it} from 'vite-plus/test';
import type {FetchJson} from './feedClient.js';
import {runCli} from './cli.js';
import {indexFeed, toolDetailFeed} from './fixtures.js';
import type {AgentToolDetailFeed} from './types.js';

const componentFeed: AgentToolDetailFeed = {
  ...toolDetailFeed,
  data: {
    ...toolDetailFeed.data,
    name: 'Spectrum hero', slug: 'spectrum-hero', description: 'An animated gradient hero.',
    detailUrl: 'https://slothhub.dev/tool/spectrum-hero', visitUrl: 'https://slothhub.dev/go/spectrum-hero',
    resourceKind: {value: 'ui_component', label: 'UI component'},
    quickstarts: [],
    uiComponent: {
      sourceUrl: 'https://example.com/spectrum-hero', authorName: 'SlothHub', original: true,
      license: 'MIT', licenseUrl: 'https://example.com/LICENSE', frameworks: ['React'], dependencies: ['motion'],
      previewImageUrl: 'https://cdn.sanity.io/images/project/production/hero.png', previewAlt: 'A gradient hero',
    },
    keyFeatures: ['Source'],
    keyFeatureDetails: [{kind: 'code', feature: 'Source', title: 'Source', summary: 'Files', files: [
      {filename: 'spectrum-hero.tsx', language: 'tsx', code: 'export const SpectrumHero = () => {\n\treturn <h1>\u001b[31mHi</h1>;\n};'},
      {filename: 'LICENSE', language: 'text', code: 'MIT License'},
    ]}],
  },
};

const fetchJson: FetchJson = async (url) => {
  const path = new URL(url).pathname;
  if (path === '/api/index.json') return indexFeed;
  if (path === '/api/tools/spectrum-hero.json') return componentFeed;
  if (path === '/api/tools/figma.json') return toolDetailFeed;
  throw new Error(`HTTP 404 Not Found ${path}`);
};

describe('slothhub component', () => {
  it('prints the files, license and registry install command an agent needs', async () => {
    const result = await runCli(['component', 'spectrum-hero', '--json', '--no-cache'], {fetchJson});
    expect(result.exitCode).toBe(0);
    const handoff = JSON.parse(result.stdout);
    expect(handoff.install).toMatchObject({kind: 'slothhub_registry', command: `npx shadcn@latest add ${toolDetailFeed.siteUrl}/r/spectrum-hero.json`});
    expect(handoff.files.map(({path, role}: {path: string; role: string}) => [path, role])).toEqual([['spectrum-hero.tsx', 'source'], ['LICENSE', 'notice']]);
    expect(handoff.dependencies).toEqual(['motion']);
  });

  it('keeps code indentation readable in the terminal while dropping control sequences', async () => {
    const result = await runCli(['component', 'spectrum-hero', '--no-cache'], {fetchJson});
    expect(result.stdout).toContain('npx shadcn@latest add');
    expect(result.stdout).toContain('--- spectrum-hero.tsx (source) ---\nexport const SpectrumHero = () => {\n  return <h1>Hi</h1>;');
    expect(result.stdout).not.toContain('\u001b');
  });

  it('explains when a Tool is not a component', async () => {
    const result = await runCli(['component', 'figma', '--json', '--no-cache'], {fetchJson});
    expect(result.exitCode).not.toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ok: false, code: 'not_a_component'});
  });
});
