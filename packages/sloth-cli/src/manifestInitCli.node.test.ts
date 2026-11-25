import { mkdtemp, readFile, rm, symlink, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import {parseProjectToolPinManifest, PROJECT_TOOL_PIN_MANIFEST_MAX_BYTES, type ProjectManifestCatalogTool} from '@slothhub/domain/project-tool-pin-manifest';
import {type ToolLookupArtifact} from '@slothhub/domain/tool-lookup';

import { runCli } from './cli.js';
import { computeContentHash, computeIndexContentHash } from '@slothhub/domain/public-feed-content-identity';
import type { FetchJson } from './feedClient.js';
import { indexFeed } from './fixtures.js';

const directories: string[] = [];
const makeDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'slothhub-manifest-init-'));
  directories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const catalogTool = (
  slug: string,
  name: string,
  overrides: Partial<ProjectManifestCatalogTool> = {},
): ProjectManifestCatalogTool => ({
  slug,
  detailUrl: `https://slothhub.dev/tool/${slug}`,
  snapshot: {
    name,
    resourceKind: 'app',
    resourceIdentity: { kind: 'website', url: `https://${slug}.example.com/` },
  },
  agentInterfaces: [],
  citations: [`https://slothhub.dev/tool/${slug}`, `https://${slug}.example.com/`],
  ...overrides,
});

const figmaCatalogTool = catalogTool('figma', 'Figma', {
  agentInterfaces: [{ kind: 'mcp_server', status: 'official', identifier: 'figma' }],
});
const linearCatalogTool = catalogTool('linear', 'Linear');

const lookupArtifact: ToolLookupArtifact = {
  version: '5.0.0',
  complete: true,
  tools: [
    {
      slug: 'figma',
      name: 'Figma',
      detailUrl: 'https://slothhub.dev/tool/figma',
      keys: [
        { namespace: 'slug', value: 'figma' },
        { namespace: 'display_name', value: 'figma' },
        { namespace: 'npm_package', value: 'npm_package:figma' },
      ],
    },
    {
      slug: 'linear',
      name: 'Linear',
      detailUrl: 'https://slothhub.dev/tool/linear',
      keys: [{ namespace: 'slug', value: 'linear' }],
    },
    {
      slug: 'ghost',
      name: 'Ghost',
      detailUrl: 'https://slothhub.dev/tool/ghost',
      keys: [{ namespace: 'slug', value: 'ghost' }],
    },
  ],
  aliases: [
    { slug: 'figma-design', sourceToolId: 'tool-figma-design', canonicalSlug: 'figma' },
  ],
  identityClaims: [
    {
      namespace: 'npm_package',
      value: 'npm_package:retired-figma',
      disposition: 'retired',
      sourceToolId: 'tool-retired-figma',
    },
  ],
};

interface ManifestToolsFeedFixture {
  version: string;
  siteUrl: string;
  generatedAt: string;
  catalogRevision: string;
  contentHash: string;
  data: { tools: ProjectManifestCatalogTool[] };
}

const manifestToolsFeed = (tools: ProjectManifestCatalogTool[]): ManifestToolsFeedFixture => ({
  version: '33.3.0',
  siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-07-08T00:00:00.000Z',
  catalogRevision: `sha256:${'a'.repeat(64)}`,
  contentHash: `sha256:${'b'.repeat(64)}`,
  data: { tools },
});

const authenticatedIndex = (
  catalog: ManifestToolsFeedFixture,
  lookup: ToolLookupArtifact,
  feeds: object = {
    ...indexFeed.feeds,
    projectManifestTools: 'https://slothhub.dev/api/project-manifest-tools.json',
  },
) => {
  const withoutSelf = {
    ...indexFeed,
    feeds,
    contentHashes: {
      '/api/tool-lookup.json': computeContentHash(lookup),
      '/api/project-manifest-tools.json': computeContentHash(catalog),
    },
  };
  const selfHash = computeIndexContentHash(withoutSelf);
  return {
    ...withoutSelf,
    contentHash: selfHash,
    contentHashes: { ...withoutSelf.contentHashes, '/api/index.json': selfHash },
  };
};

interface FetchFixtureOptions {
  catalog?: ManifestToolsFeedFixture;
  lookup?: ToolLookupArtifact;
  index?: object;
}

const fetchFor = ({ catalog, lookup, index }: FetchFixtureOptions): FetchJson => {
  const resolvedCatalog = catalog ?? manifestToolsFeed([figmaCatalogTool, linearCatalogTool]);
  const resolvedLookup = lookup ?? lookupArtifact;
  const resolvedIndex = index ?? authenticatedIndex(resolvedCatalog, resolvedLookup);
  return async (url) => {
    const path = new URL(url).pathname;
    if (path === '/api/index.json') return resolvedIndex;
    if (path === '/api/tool-lookup.json') return resolvedLookup;
    if (path === '/api/project-manifest-tools.json') return resolvedCatalog;
    throw new Error(`Unexpected feed ${path}`);
  };
};

const receiptLookup = (slugs: string[]): ToolLookupArtifact => ({
  version: '5.0.0',
  complete: true,
  tools: slugs.map((slug) => ({
    slug,
    name: slug,
    detailUrl: `https://slothhub.dev/tool/${slug}`,
    keys: [{ namespace: 'slug' as const, value: slug }],
  })),
  aliases: [],
  identityClaims: [],
});

const readWrittenManifest = async (directory: string, display: string) => {
  const raw = await readFile(join(directory, display), 'utf8');
  const parsed = parseProjectToolPinManifest(raw);
  return { raw, parsed };
};

describe('manifest init', () => {
  it('pins a component with manifest v4 and validates the written file offline', async () => {
    const directory = await makeDirectory();
    const catalog = manifestToolsFeed([catalogTool('button', 'Glass button', {
      snapshot: {name: 'Glass button', resourceKind: 'ui_component', resourceIdentity: {kind: 'website', url: 'https://button.example.com/'}},
    })]);
    const result = await runCli(['manifest', 'init', 'button', '--json'], {
      fetchJson: fetchFor({catalog, lookup: receiptLookup(['button'])}), workingDirectory: directory,
    });
    expect(result.exitCode).toBe(0);
    const {raw, parsed} = await readWrittenManifest(directory, 'slothhub.tools.json');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.value.version).toBe(4);
    expect(parsed.value.tools[0]?.snapshot.resourceKind).toBe('ui_component');
    const validated = await runCli(['manifest', 'validate', 'slothhub.tools.json', '--json'], {readTextFile: async () => raw});
    expect(validated.exitCode).toBe(0);
    expect(JSON.parse(validated.stdout)).toMatchObject({valid: true, version: 4, toolCount: 1});
  });
  it('never writes the current name beside an old-name manifest', async () => {
    const directory = await makeDirectory();
    await writeFile(join(directory, 'slothub.tools.json'), '{"kept": true}\n');
    const fetchJson = fetchFor({});
    for (const flags of [[], ['--force']]) {
      const result = await runCli(['manifest', 'init', 'figma', ...flags, '--json'], {fetchJson, workingDirectory: directory});
      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ok: false, code: 'EEXIST', recovery: expect.stringContaining('mv slothub.tools.json slothhub.tools.json')});
    }
    await expect(readFile(join(directory, 'slothhub.tools.json'), 'utf8')).rejects.toThrow();
    expect(await readFile(join(directory, 'slothub.tools.json'), 'utf8')).toBe('{"kept": true}\n');

    const elsewhere = await runCli(['manifest', 'init', 'figma', '--output', 'other.tools.json', '--json'], {fetchJson, workingDirectory: directory});
    expect(elsewhere.exitCode).toBe(0);
  });
  it('writes the default manifest file for resolved public Tool slugs', async () => {
    const directory = await makeDirectory();
    const result = await runCli(['manifest', 'init', 'figma', 'linear', '--json'], {
      fetchJson: fetchFor({}),
      workingDirectory: directory,
    });

    expect(result.exitCode).toBe(0);
    const summary = JSON.parse(result.stdout);
    expect(summary).toMatchObject({
      artifact: 'slothhub.project-tool-pin-manifest',
      version: 4,
      path: 'slothhub.tools.json',
      toolCount: 2,
      tools: ['figma', 'linear'],
      provenance: {
        catalogFeedVersion: '33.3.0',
        catalogGeneratedAt: '2026-07-08T00:00:00.000Z',
        catalogRevision: `sha256:${'a'.repeat(64)}`,
      },
    });
    expect(result.stderr).toBe('');

    const { parsed } = await readWrittenManifest(directory, 'slothhub.tools.json');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.producer.name).toBe('@slothhub/cli');
      expect(parsed.value.tools.map((tool) => tool.slug)).toEqual(['figma', 'linear']);
      expect(parsed.value.tools[0]?.agentInterfaces).toEqual([
        { kind: 'mcp_server', status: 'official', identifier: 'figma' },
      ]);
    }

    // The written file is accepted by `manifest validate`. The default bounded
    // reader depends on POSIX dev/ino comparison that this platform cannot
    // honour, so the file bytes are supplied through the injected reader; the
    // domain parser still validates the real on-disk manifest.
    const validated = await runCli(
      ['manifest', 'validate', join(directory, 'slothhub.tools.json'), '--json'],
      { readTextFile: (path) => readFile(path, 'utf8') },
    );
    expect(validated.exitCode).toBe(0);
    expect(JSON.parse(validated.stdout)).toMatchObject({ valid: true, toolCount: 2 });
  });

  it('deduplicates argv slugs and resolves aliases to the canonical Tool', async () => {
    const directory = await makeDirectory();
    const result = await runCli(
      ['manifest', 'init', 'figma', 'figma-design', 'FIGMA', '--output', 'pins.json'],
      { fetchJson: fetchFor({}), workingDirectory: directory },
    );

    expect(result.exitCode).toBe(0);
    const { parsed } = await readWrittenManifest(directory, 'pins.json');
    expect(parsed.ok && parsed.value.tools.map((tool) => tool.slug)).toEqual(['figma']);
    expect(result.stderr).toContain('Wrote pins.json with 1 pinned Tool.');
  });

  it('fails with a structured error that lists unknown slugs and writes nothing', async () => {
    const directory = await makeDirectory();
    const fetchJson = vi.fn(fetchFor({}));
    const result = await runCli(['manifest', 'init', 'figma', 'nope', 'gone', '--json'], {
      fetchJson,
      workingDirectory: directory,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    const envelope = JSON.parse(result.stdout);
    expect(envelope).toMatchObject({
      ok: false,
      code: 'unresolved_tools',
      unresolved: [
        { requested: 'nope', reason: 'unknown' },
        { requested: 'gone', reason: 'unknown' },
      ],
    });
    await expect(readFile(join(directory, 'slothhub.tools.json'), 'utf8')).rejects.toThrow();
  });

  it('lists invalid and retired references among unresolved slugs', async () => {
    const directory = await makeDirectory();
    const result = await runCli(['manifest', 'init', 'figma-design', 'Not A Slug!'], {
      fetchJson: fetchFor({}),
      workingDirectory: directory,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('unresolved_tools');
    expect(result.stderr).toContain('invalid_slug');
  });

  it('reports a resolved slug with no public manifest snapshot as unavailable', async () => {
    const directory = await makeDirectory();
    const result = await runCli(['manifest', 'init', 'figma', 'ghost', '--json'], {
      fetchJson: fetchFor({}),
      workingDirectory: directory,
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      code: 'unresolved_tools',
      unresolved: [{ requested: 'ghost', reason: 'unavailable' }],
    });
  });

  it('requires at least one slug or --from-inventory', async () => {
    const fetchJson = vi.fn();
    const result = await runCli(['manifest', 'init', '--json'], { fetchJson });

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('fails closed when the feed does not advertise Tool lookup or the manifest Tools artifact', async () => {
    const directory = await makeDirectory();
    const catalog = manifestToolsFeed([figmaCatalogTool]);
    const { toolLookup: _toolLookup, ...feedsWithoutLookup } = indexFeed.feeds;
    const noLookupIndex = authenticatedIndex(
      catalog,
      lookupArtifact,
      {
        ...feedsWithoutLookup,
        projectManifestTools: 'https://slothhub.dev/api/project-manifest-tools.json',
      },
    );
    const noLookup = await runCli(['manifest', 'init', 'figma'], {
      fetchJson: fetchFor({ index: noLookupIndex, catalog }),
      workingDirectory: directory,
    });
    expect(noLookup.exitCode).toBe(1);
    expect(noLookup.stderr).toContain('capability_unavailable');

    const noCatalogIndex = authenticatedIndex(
      catalog,
      lookupArtifact,
      { ...indexFeed.feeds },
    );
    const noCatalog = await runCli(['manifest', 'init', 'figma'], {
      fetchJson: fetchFor({ index: noCatalogIndex, catalog }),
      workingDirectory: directory,
    });
    expect(noCatalog.exitCode).toBe(1);
    expect(noCatalog.stderr).toContain('capability_unavailable');
    expect(noCatalog.stderr).toContain('project manifest Tools');
  });

  it('maps --from-inventory dependencies and reports unmapped ones without failing', async () => {
    const directory = await makeDirectory();
    const readInventorySource = vi.fn(async () => JSON.stringify({
      dependencies: { figma: '^1.0.0', 'unlisted-package': '2.0.0', 'retired-figma': '1.0.0' },
      devDependencies: { 'not a package': '*' },
    }));

    const result = await runCli(['manifest', 'init', '--from-inventory', 'package.json', '--json'], {
      fetchJson: fetchFor({}),
      readInventorySource,
      workingDirectory: directory,
    });

    expect(result.exitCode).toBe(0);
    const summary = JSON.parse(result.stdout);
    expect(summary.tools).toEqual(['figma']);
    // Report order follows the inventory sort: retired, unsupported, unknown.
    expect(summary.unmappedDependencies).toEqual([
      { name: 'retired-figma', state: 'retired' },
      { name: 'not a package', state: 'unsupported' },
      { name: 'unlisted-package', state: 'unknown' },
    ]);
    expect(readInventorySource).toHaveBeenCalledWith('package.json');
  });

  it('combines argv slugs with inventory matches and deduplicates across both', async () => {
    const directory = await makeDirectory();
    const result = await runCli(
      ['manifest', 'init', 'linear', '--from-inventory', 'package.json', '--json'],
      {
        fetchJson: fetchFor({}),
        readInventorySource: async () => JSON.stringify({ dependencies: { figma: '1' } }),
        workingDirectory: directory,
      },
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).tools).toEqual(['linear', 'figma']);
  });

  it('refuses when fewer than one public Tool resolves', async () => {
    const directory = await makeDirectory();
    const result = await runCli(['manifest', 'init', '--from-inventory', 'package.json', '--json'], {
      fetchJson: fetchFor({}),
      readInventorySource: async () => JSON.stringify({ dependencies: { 'unlisted-package': '2' } }),
      workingDirectory: directory,
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      code: 'no_resolved_tools',
      unmappedDependencies: [{ name: 'unlisted-package', state: 'unknown' }],
    });
    await expect(readFile(join(directory, 'slothhub.tools.json'), 'utf8')).rejects.toThrow();
  });

  it('propagates inventory input failures with their structured codes', async () => {
    const directory = await makeDirectory();
    const result = await runCli(['manifest', 'init', '--from-inventory', 'package.json', '--json'], {
      fetchJson: fetchFor({}),
      readInventorySource: async () => '{not json',
      workingDirectory: directory,
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, code: 'malformed_json' });
  });

  it('rejects absolute paths, .. escapes, directories, symlinks, and missing parents by name', async () => {
    const directory = await makeDirectory();
    const outside = await makeDirectory();
    const subDirectory = join(directory, 'existing-dir');
    await mkdir(subDirectory);
    await mkdir(join(outside, 'real-target'));
    await symlink(join(outside, 'real-target'), join(directory, 'linked-dir'), 'junction');
    await symlink(join(outside, 'real-target'), join(directory, 'linked-file'), 'junction');

    const cases: Array<{ output: string; code: string; exitCode: number }> = [
      { output: join(directory, 'absolute.json'), code: 'EINVAL', exitCode: 2 },
      { output: join('..', 'escape.json'), code: 'EINVAL', exitCode: 2 },
      { output: join('missing-dir', 'ok.json'), code: 'ENOENT', exitCode: 1 },
      { output: 'existing-dir', code: 'EISDIR', exitCode: 1 },
      { output: join('linked-dir', 'x.json'), code: 'ELOOP', exitCode: 1 },
      { output: 'linked-file', code: 'ELOOP', exitCode: 1 },
    ];

    for (const { output, code, exitCode } of cases) {
      const result = await runCli(['manifest', 'init', 'figma', '--output', output, '--json'], {
        fetchJson: fetchFor({}),
        workingDirectory: directory,
      });
      expect(result.exitCode, `--output ${output}`).toBe(exitCode);
      expect(JSON.parse(result.stdout), `--output ${output}`).toMatchObject({ ok: false, code });
    }
    await expect(readFile(join(outside, 'escape.json'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(directory, 'linked-dir', 'x.json'), 'utf8')).rejects.toThrow();
  });

  it('refuses an existing destination without --force and replaces it with --force', async () => {
    const directory = await makeDirectory();
    const output = join(directory, 'slothhub.tools.json');
    await writeFile(output, 'existing\n');

    const refused = await runCli(['manifest', 'init', 'figma', '--json'], {
      fetchJson: fetchFor({}),
      workingDirectory: directory,
    });
    expect(refused.exitCode).toBe(1);
    expect(JSON.parse(refused.stdout)).toMatchObject({ ok: false, code: 'EEXIST' });
    expect(await readFile(output, 'utf8')).toBe('existing\n');

    const forced = await runCli(['manifest', 'init', 'figma', '--force'], {
      fetchJson: fetchFor({}),
      workingDirectory: directory,
    });
    expect(forced.exitCode).toBe(0);
    const { parsed } = await readWrittenManifest(directory, 'slothhub.tools.json');
    expect(parsed.ok).toBe(true);
  });

  it('names a raced EEXIST from the atomic writer', async () => {
    const directory = await makeDirectory();
    const raced = await runCli(['manifest', 'init', 'figma', '--json'], {
      fetchJson: fetchFor({}),
      workingDirectory: directory,
      writeReceiptOutput: async () => {
        throw Object.assign(new Error('Refusing to overwrite existing file'), { code: 'EEXIST' });
      },
    });

    expect(raced.exitCode).toBe(1);
    expect(JSON.parse(raced.stdout)).toMatchObject({ ok: false, code: 'EEXIST' });
  });

  it('writes into a destination directory under the working directory', async () => {
    const directory = await makeDirectory();
    await mkdir(join(directory, 'sub'));

    const result = await runCli(['manifest', 'init', 'figma', '--output', join('sub', 'pins.json'), '--json'], {
      fetchJson: fetchFor({}),
      workingDirectory: directory,
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).path).toBe(join('sub', 'pins.json'));
    const { parsed } = await readWrittenManifest(directory, join('sub', 'pins.json'));
    expect(parsed.ok).toBe(true);
  });

  it('never publishes a partial manifest when serialization exceeds the byte limit', async () => {
    const directory = await makeDirectory();
    // Sixteen Agent Interfaces with long identifiers push the serialized
    // manifest past the 64 KiB cap while staying inside the per-Tool limit.
    const interfaces = Array.from({ length: 16 }, (_, index) => ({
      kind: 'mcp_server' as const,
      status: 'official' as const,
      identifier: `registry/entry-${index}-${'x'.repeat(170)}`,
    }));
    const oversized = Array.from({ length: 100 }, (_, index) =>
      catalogTool(`tool-${index}`, `Tool ${index}`, { agentInterfaces: interfaces }));
    const slugs = oversized.map((tool) => tool.slug);

    const result = await runCli(
      ['manifest', 'init', ...slugs, '--json'],
      {
        fetchJson: fetchFor({
          catalog: manifestToolsFeed(oversized),
          lookup: receiptLookup(slugs),
        }),
        workingDirectory: directory,
      },
    );

    expect(result.exitCode).toBe(1);
    const envelope = JSON.parse(result.stdout);
    expect(envelope).toMatchObject({
      ok: false,
      code: 'manifest_too_large',
      configuredLimitBytes: 65_536,
    });
    expect(envelope.observedBytes).toBeGreaterThan(65_536);
    await expect(readFile(join(directory, 'slothhub.tools.json'), 'utf8')).rejects.toThrow();
  });
});

describe('manifest init serialization receipts', () => {
  it.each([1, 100])('a %i-tool manifest serializes under the 64 KiB limit', async (count) => {
    const directory = await makeDirectory();
    // A representative public catalog row: one canonical citation and one
    // Agent Interface, matching the shape the project-manifest-tools feed
    // emits for a Tool with a single documented interface.
    const tools = Array.from({ length: count }, (_, index) =>
      catalogTool(`tool-${index}`, `Tool ${index}`, {
        agentInterfaces: [
          { kind: 'mcp_server', status: 'official', identifier: `registry/tool-${index}` },
        ],
        citations: [`https://slothhub.dev/tool/tool-${index}`],
      }));
    const slugs = tools.map((tool) => tool.slug);

    const result = await runCli(['manifest', 'init', ...slugs, '--json'], {
      fetchJson: fetchFor({
        catalog: manifestToolsFeed(tools),
        lookup: receiptLookup(slugs),
      }),
      workingDirectory: directory,
    });

    expect(result.exitCode).toBe(0);
    const { raw } = await readWrittenManifest(directory, 'slothhub.tools.json');
    const bytes = Buffer.byteLength(raw, 'utf8');
    expect(bytes).toBeLessThanOrEqual(PROJECT_TOOL_PIN_MANIFEST_MAX_BYTES);
    // Measured receipt values are recorded in upstream docs/measurements/manifest-init-serialization-*.
    console.info(`receipt: ${count}-tool manifest = ${bytes} bytes`);
  });

  it('rejects a selection beyond the 100-Tool limit with a named error', async () => {
    const directory = await makeDirectory();
    const tools = Array.from({ length: 101 }, (_, index) => catalogTool(`tool-${index}`, `Tool ${index}`));
    const slugs = tools.map((tool) => tool.slug);

    const result = await runCli(['manifest', 'init', ...slugs, '--json'], {
      fetchJson: fetchFor({
        catalog: manifestToolsFeed(tools),
        lookup: receiptLookup(slugs),
      }),
      workingDirectory: directory,
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      code: 'tool_limit_exceeded',
      configuredLimit: 100,
      observedValue: 101,
    });
  });
});
