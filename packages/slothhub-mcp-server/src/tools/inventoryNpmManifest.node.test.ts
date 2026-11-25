import {mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {NPM_MANIFEST_INVENTORY_MAX_BYTES} from '@slothhub/domain/npm-manifest-inventory';
import {type ToolLookupArtifact} from '@slothhub/domain/tool-lookup';
import {describe, expect, it} from 'vite-plus/test';

import {ResponseFormat} from '../constants.js';
import type {FeedClient} from '../services/feeds.js';
import {handleInventoryNpmManifest} from './inventoryNpmManifest.js';
import {inventoryNpmManifestOutputSchema} from '../schemas/outputs.js';

const unexpectedFeedRequest = async (): Promise<never> => {
  throw new Error('Unexpected feed request');
};

const clientWithLookup = (
  loadLookup: () => Promise<ToolLookupArtifact | null>,
): FeedClient => ({
  index: unexpectedFeedRequest,
  toolLookup: loadLookup,
  searchIndex: unexpectedFeedRequest,
  tools: unexpectedFeedRequest,
  toolDetail: unexpectedFeedRequest,
  stacks: unexpectedFeedRequest,
  best: unexpectedFeedRequest,
  categories: unexpectedFeedRequest,
  tags: unexpectedFeedRequest,
  useCases: unexpectedFeedRequest,
  alternatives: unexpectedFeedRequest,
  alternativesDetail: unexpectedFeedRequest,
  comparisons: unexpectedFeedRequest,
  comparisonDetail: unexpectedFeedRequest,
});

const lookupArtifact: ToolLookupArtifact = {
  version: '5.0.0',
  complete: true,
  aliases: [],
  identityClaims: [],
  tools: [
    {
      slug: 'react',
      name: 'React',
      detailUrl: 'https://slothhub.dev/tool/react',
      keys: [
        {namespace: 'slug', value: 'react'},
        {namespace: 'npm_package', value: 'npm_package:react'},
      ],
    },
  ],
};

const withTempDir = async (
  run: (directory: string) => Promise<void>,
): Promise<void> => {
  const directory = await mkdtemp(join(tmpdir(), 'sloth-inventory-'));
  await run(directory);
};

describe('handleInventoryNpmManifest', () => {
  it('maps populated dependency maps to public Tool identities', async () => {
    const result = await handleInventoryNpmManifest(
      clientWithLookup(async () => lookupArtifact),
      {
        manifest: JSON.stringify({
          dependencies: {react: '^19.0.0', 'left-pad': '1.3.0'},
          devDependencies: {vitest: '^3.0.0'},
        }),
        response_format: ResponseFormat.JSON,
      },
    );

    expect(result.isError).toBeUndefined();
    const report = inventoryNpmManifestOutputSchema.parse(result.structuredContent);
    expect(report.artifact).toBe('slothhub.workspace-dependency-inventory');
    expect(report.lookupVersion).toBe('5.0.0');
    expect(report.summary).toEqual({
      total: 3,
      matched: 1,
      aliased: 0,
      retired: 0,
      unknown: 2,
      unsupported: 0,
      capabilityUnavailable: 0,
    });
    const react = report.dependencies.find((entry) => entry.name === 'react');
    expect(react).toMatchObject({
      state: 'matched',
      declaredIn: ['dependencies'],
      tool: {slug: 'react'},
    });
    const vitest = report.dependencies.find((entry) => entry.name === 'vitest');
    expect(vitest).toMatchObject({state: 'unknown', declaredIn: ['devDependencies']});
  });

  it('reports an empty dependency set without failing', async () => {
    const result = await handleInventoryNpmManifest(
      clientWithLookup(async () => lookupArtifact),
      {manifest: '{"name":"empty"}', response_format: ResponseFormat.JSON},
    );

    expect(result.isError).toBeUndefined();
    const report = inventoryNpmManifestOutputSchema.parse(result.structuredContent);
    expect(report.summary.total).toBe(0);
    expect(report.dependencies).toEqual([]);
  });

  it('marks unknown package names without claiming they are absent from npm', async () => {
    const result = await handleInventoryNpmManifest(
      clientWithLookup(async () => lookupArtifact),
      {
        manifest: '{"dependencies":{"definitely-not-a-sloth-tool":"1.0.0"}}',
        response_format: ResponseFormat.JSON,
      },
    );

    const report = inventoryNpmManifestOutputSchema.parse(result.structuredContent);
    expect(report.dependencies[0]).toMatchObject({
      name: 'definitely-not-a-sloth-tool',
      state: 'unknown',
    });
    expect(report.disclaimer).toContain('no matching npm identity');
    expect(report.disclaimer).not.toContain('does not exist');
  });

  it('reports capability_unavailable when the lookup feed is absent', async () => {
    const result = await handleInventoryNpmManifest(
      clientWithLookup(async () => null),
      {
        manifest: '{"dependencies":{"react":"^19.0.0"}}',
        response_format: ResponseFormat.JSON,
      },
    );

    const report = inventoryNpmManifestOutputSchema.parse(result.structuredContent);
    expect(report.lookupVersion).toBeNull();
    expect(report.dependencies[0]?.state).toBe('capability_unavailable');
  });

  it('treats a failed lookup fetch as capability absence, not as unknown', async () => {
    const result = await handleInventoryNpmManifest(
      clientWithLookup(async () => {
        throw new Error('offline');
      }),
      {
        manifest: '{"dependencies":{"react":"^19.0.0"}}',
        response_format: ResponseFormat.JSON,
      },
    );

    const report = inventoryNpmManifestOutputSchema.parse(result.structuredContent);
    expect(report.dependencies[0]?.state).toBe('capability_unavailable');
  });

  it('rejects calls that provide neither a path nor manifest text', async () => {
    const result = await handleInventoryNpmManifest(
      clientWithLookup(async () => lookupArtifact),
      {response_format: ResponseFormat.JSON},
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({code: 'invalid_input'});
  });

  it('rejects calls that provide both a path and manifest text', async () => {
    const result = await handleInventoryNpmManifest(
      clientWithLookup(async () => lookupArtifact),
      {
        path: 'package.json',
        manifest: '{}',
        response_format: ResponseFormat.JSON,
      },
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({code: 'invalid_input'});
  });

  it('rejects manifest text over the shared byte budget before parsing', async () => {
    const oversized = `{"dependencies":{"x":"${'1'.repeat(NPM_MANIFEST_INVENTORY_MAX_BYTES)}"}}`;
    const result = await handleInventoryNpmManifest(
      clientWithLookup(async () => lookupArtifact),
      {manifest: oversized, response_format: ResponseFormat.JSON},
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: 'input_too_large',
      configuredLimitBytes: NPM_MANIFEST_INVENTORY_MAX_BYTES,
    });
    const observed = (result.structuredContent as {observedBytes?: number}).observedBytes;
    expect(observed).toBeGreaterThan(NPM_MANIFEST_INVENTORY_MAX_BYTES);
  });

  it('rejects glob patterns as paths before touching the filesystem', async () => {
    const result = await handleInventoryNpmManifest(
      clientWithLookup(async () => lookupArtifact),
      {path: 'packages/*/package.json', response_format: ResponseFormat.JSON},
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({code: 'invalid_input'});
  });

  it('reads one explicit manifest file from disk', async () => {
    await withTempDir(async (directory) => {
      const manifestPath = join(directory, 'package.json');
      await writeFile(manifestPath, '{"dependencies":{"react":"^19.0.0"}}', 'utf8');

      const result = await handleInventoryNpmManifest(
        clientWithLookup(async () => lookupArtifact),
        {path: manifestPath, response_format: ResponseFormat.JSON},
      );

      expect(result.isError).toBeUndefined();
      const report = inventoryNpmManifestOutputSchema.parse(result.structuredContent);
      expect(report.dependencies[0]).toMatchObject({name: 'react', state: 'matched'});
    });
  });

  it('rejects directory paths as a non-regular source', async () => {
    await withTempDir(async (directory) => {
      const nested = join(directory, 'nested');
      await mkdir(nested);

      const result = await handleInventoryNpmManifest(
        clientWithLookup(async () => lookupArtifact),
        {path: nested, response_format: ResponseFormat.JSON},
      );

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({code: 'source_not_regular'});
    });
  });

  it('rejects a missing file path without leaking the resolved path', async () => {
    await withTempDir(async (directory) => {
      const result = await handleInventoryNpmManifest(
        clientWithLookup(async () => lookupArtifact),
        {path: join(directory, 'missing.json'), response_format: ResponseFormat.JSON},
      );

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({code: 'source_unreadable'});
      expect(JSON.stringify(result.structuredContent)).not.toContain(directory);
    });
  });

  it('rejects an on-disk manifest over the byte budget before parsing', async () => {
    await withTempDir(async (directory) => {
      const manifestPath = join(directory, 'package.json');
      await writeFile(manifestPath, `{"dependencies":{"x":"${'1'.repeat(NPM_MANIFEST_INVENTORY_MAX_BYTES)}"}}`, 'utf8');

      const result = await handleInventoryNpmManifest(
        clientWithLookup(async () => lookupArtifact),
        {path: manifestPath, response_format: ResponseFormat.JSON},
      );

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        code: 'input_too_large',
        configuredLimitBytes: NPM_MANIFEST_INVENTORY_MAX_BYTES,
      });
    });
  });

  it('rejects a lockfile-as-tree manifest whose dependency values are objects', async () => {
    const result = await handleInventoryNpmManifest(
      clientWithLookup(async () => lookupArtifact),
      {
        manifest: JSON.stringify({
          lockfileVersion: 3,
          dependencies: {react: {version: '33.0.0', resolved: 'https://registry.npmjs.org/react/-/react-19.0.0.tgz'}},
        }),
        response_format: ResponseFormat.JSON,
      },
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({code: 'invalid_dependency_value'});
  });

  it('rejects manifests carrying dangerous keys', async () => {
    const result = await handleInventoryNpmManifest(
      clientWithLookup(async () => lookupArtifact),
      {
        manifest: '{"dependencies":{"react":"^19.0.0"},"__proto__":{"polluted":true}}',
        response_format: ResponseFormat.JSON,
      },
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({code: 'dangerous_key'});
  });

  it('rejects malformed JSON with a named code', async () => {
    const result = await handleInventoryNpmManifest(
      clientWithLookup(async () => lookupArtifact),
      {manifest: '{"dependencies":', response_format: ResponseFormat.JSON},
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({code: 'malformed_json'});
  });

  it('escapes control characters from dependency names in markdown output', async () => {
    const result = await handleInventoryNpmManifest(
      clientWithLookup(async () => lookupArtifact),
      {
        manifest: '{"dependencies":{"bad\\u001b[7mname":"1.0.0"}}',
        response_format: ResponseFormat.MARKDOWN,
      },
    );

    const text = result.content[0]?.text ?? '';
    expect(text).not.toContain('\u001b');
    expect(text).toContain('bad\\u{1b}\\[7mname');
  });
});
