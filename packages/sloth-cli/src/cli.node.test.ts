import type {JsonObject} from '@slothhub/domain/json-value';
import type {ToolLookupArtifact} from '@slothhub/domain/tool-lookup';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseDecisionReceiptArtifact,
  parseDecisionReceiptJson,
  renderDecisionReceiptMarkdown,
  serializeDecisionReceiptJson,
} from '@slothhub/domain/decision-receipt';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  buildProjectToolPinManifest,
  parseProjectToolPinManifest,
  serializeProjectToolPinManifest,
} from '@slothhub/domain/project-tool-pin-manifest';
import { runCli } from './cli.js';
import { CLI_COMMAND_SPECS, CLI_FLAG_SPECS } from './cliSpec.js';
import { COMPLETION_SHELLS } from './shellCompletion.js';
import {
  FeedHttpStatusError,
  type FetchJson,
} from './feedClient.js';
import {computeContentHash, computeIndexContentHash} from '@slothhub/domain/public-feed-content-identity';
import {
  bestFeed,
  indexFeed,
  linearToolDetailFeed,
  searchIndexFeed,
  stacksFeed,
  toolDetailFeed,
  toolLookupArtifact,
  toolsFeed,
} from './fixtures.js';
import type {AgentFeedPayload, AgentSearchIndexTool, AgentToolDetailFeed} from './types.js';

const okProbeFetch = async (): Promise<Response> => new Response(null, {status: 200});

const feedsByPath = new Map<string, AgentFeedPayload | ToolLookupArtifact>([
  ['/api/index.json', indexFeed],
  ['/api/search-index.json', searchIndexFeed],
  ['/api/tools.json', toolsFeed],
  ['/api/tool-lookup.json', toolLookupArtifact],
  ['/api/tools/figma.json', toolDetailFeed],
  ['/api/tools/linear.json', linearToolDetailFeed],
  ['/api/stacks.json', stacksFeed],
  ['/api/best.json', bestFeed],
]);

const authenticatedIndex = (overrides: JsonObject = {}) => {
  const withoutSelf = {
    ...indexFeed,
    catalogRevision: 'sha256:current',
    contentHashes: {},
    ...overrides,
  };
  const selfHash = computeIndexContentHash(withoutSelf);
  // SAFETY: This test owns the fixture and supplies every member read through the asserted contract.
  return {
    ...withoutSelf,
    contentHash: selfHash,
    contentHashes: {
      ...(withoutSelf.contentHashes as Record<string, string>),
      '/api/index.json': selfHash,
    },
  };
};

// SAFETY: This test owns the fixture and supplies every member read through the asserted contract.
const packageVersion = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

const fetchJson: FetchJson = async (url) => {
  const path = new URL(url).pathname;
  const feed = feedsByPath.get(path);

  if (!feed) {
    throw new Error(`Unexpected feed ${path}`);
  }

  return feed;
};

const decisionReceiptJson = (): string =>
  serializeDecisionReceiptJson({
    schemaVersion: '1',
    receiptId: 'cli-receipt',
    createdAt: '2026-07-22T18:00:00.000Z',
    catalogSnapshotAt: '2026-07-22T17:00:00.000Z',
    versions: { catalog: '2026-07-22', producer: 'test@1', schema: '1' },
    requirements: [{ id: 'security', text: 'Security', state: 'not_evaluated' }],
    criteria: [{ id: 'security', label: 'Security' }],
    candidates: [
      {
        tool: { id: 'tool:figma', slug: 'figma', name: 'Figma' },
        evaluations: [{ criterionId: 'security', state: 'unknown' }],
        facts: [{ key: 'pricing', label: 'Pricing', state: 'unknown' }],
      },
    ],
    selectedTool: null,
    rejectedCandidates: [],
    rationale: 'Still evaluating.',
    tradeoffs: [],
    citations: [],
    extensions: {},
  });

describe('runCli', () => {
  it.each([
    [['search', '--help'], 'search [query]'],
    [['--help', 'search'], 'search [query]'],
    [['manifest', 'validate', '--help'], 'manifest validate [file]'],
    [['receipt', 'render', '--help'], 'receipt render <file|->'],
  ])('prints command usage without fetching for %j', async (args, usage) => {
    const fetch = vi.fn();
    const result = await runCli(args, {fetchJson: fetch});
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`Usage: slothhub ${usage} [options]`);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('advertises the version flag in global help', async () => {
    expect((await runCli(['--help'])).stdout).toContain('--version');
  });

  it('prints the package version without fetching feeds', async () => {
    const result = await runCli(['--version'], {
      fetchJson: async () => {
        throw new Error('The version command must not fetch feeds');
      },
    });

    expect(result).toEqual({
      exitCode: 0,
      stdout: `${packageVersion}\n`,
      stderr: '',
    });
  });

  it('matches committed byte-for-byte decision receipt golden fixtures', () => {
    const json = readFileSync(
      new URL('../../domain/src/__fixtures__/decision-receipt-v1.golden.json', import.meta.url),
      'utf8',
    );
    const markdown = readFileSync(
      new URL('../../domain/src/__fixtures__/decision-receipt-v1.golden.md', import.meta.url),
      'utf8',
    );
    const parsed = parseDecisionReceiptJson(json);

    expect(serializeDecisionReceiptJson(parsed)).toBe(json);
    expect(renderDecisionReceiptMarkdown(parsed)).toBe(markdown);
    expect(parseDecisionReceiptArtifact(markdown)).toEqual(parsed);
    expect(json).toContain('golden-決定');
    expect(markdown).toContain('Unavailable Tool');
  });

  const manifestText = serializeProjectToolPinManifest(buildProjectToolPinManifest({
    producer: { name: 'test', version: '33.0.0' },
    createdAt: '2026-07-14T12:00:00.000Z',
    source: { kind: 'saved_list', id: 'list-1', name: 'Launch stack' },
    tools: [{
      slug: 'figma',
      detailUrl: 'https://slothhub.dev/tool/figma',
      snapshot: {
        name: 'Figma',
        resourceKind: 'app',
        resourceIdentity: { kind: 'website', url: 'https://figma.com/' },
      },
      agentInterfaces: [],
      note: 'Literal `$()` and **Markdown** text',
      citations: ['https://slothhub.dev/tool/figma'],
    }],
  }));

  it('validates a Project Tool pin manifest offline with stable JSON output', async () => {
    const fetchJson = vi.fn();
    const readTextFile = vi.fn(async () => manifestText);

    const result = await runCli(['manifest', 'validate', 'slothhub.tools.json', '--json'], {
      fetchJson,
      readTextFile,
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      artifact: 'slothhub.project-tool-pin-manifest',
      valid: true,
      version: 4,
      toolCount: 1,
      path: 'slothhub.tools.json',
    });
    expect(result.stderr).toBe('');
    expect(readTextFile).toHaveBeenCalledWith('slothhub.tools.json', 65536);
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('still validates and renders a checked-in v1 manifest without fetching the catalog', async () => {
    const parsed = parseProjectToolPinManifest(manifestText);
    if (!parsed.ok) throw new Error(parsed.reason);
    const legacy = serializeProjectToolPinManifest({...parsed.value, version: 1});
    const fetchJson = vi.fn();
    const dependencies = {fetchJson, readTextFile: async () => legacy};
    const validated = await runCli(['manifest', 'validate', 'slothhub.tools.json', '--json'], dependencies);
    expect(validated.exitCode).toBe(0);
    expect(JSON.parse(validated.stdout)).toMatchObject({valid: true, version: 1, toolCount: 1});
    const rendered = await runCli(['manifest', 'render', 'slothhub.tools.json'], dependencies);
    expect(rendered.exitCode).toBe(0);
    expect(rendered.stdout).toContain('Figma');
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('renders a Project Tool pin manifest offline as inert text', async () => {
    const result = await runCli(['manifest', 'render', 'slothhub.tools.json'], {
      fetchJson: vi.fn(),
      readTextFile: async () => manifestText,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Unverified project declaration');
    expect(result.stdout).toContain('Literal `$()` and **Markdown** text');
    expect(result.stderr).toBe('');
  });

  describe('default manifest file', () => {
    const inDirectory = async (files: Record<string, string>) => {
      const directory = await mkdtemp(join(tmpdir(), 'slothhub-cli-manifest-default-'));
      for (const [name, contents] of Object.entries(files)) await writeFile(join(directory, name), contents);
      return directory;
    };

    it('reads slothhub.tools.json when no file is named', async () => {
      const workingDirectory = await inDirectory({'slothhub.tools.json': manifestText});
      try {
        const result = await runCli(['manifest', 'validate'], {fetchJson: vi.fn(), workingDirectory});
        expect(result).toMatchObject({exitCode: 0, stdout: 'Valid Project Tool pin manifest v4 with 1 tool.\n', stderr: ''});
      } finally {
        await rm(workingDirectory, {recursive: true, force: true});
      }
    });

    it('still reads an old-name manifest and says how to rename it', async () => {
      const workingDirectory = await inDirectory({'slothub.tools.json': manifestText});
      try {
        const text = await runCli(['manifest', 'render'], {fetchJson: vi.fn(), workingDirectory});
        expect(text.exitCode).toBe(0);
        expect(text.stdout).toContain('Figma');
        expect(text.stderr).toBe('Notice: slothub.tools.json uses the old manifest file name. Rename it to slothhub.tools.json with: mv slothub.tools.json slothhub.tools.json\n');
        const json = await runCli(['manifest', 'validate', '--json'], {fetchJson: vi.fn(), workingDirectory});
        expect(json.stderr).toBe('');
        expect(JSON.parse(json.stdout)).toMatchObject({valid: true, path: 'slothub.tools.json', notice: expect.stringContaining('mv slothub.tools.json slothhub.tools.json')});
      } finally {
        await rm(workingDirectory, {recursive: true, force: true});
      }
    });

    it('prefers the current name when both exist and says the old file was not read', async () => {
      const workingDirectory = await inDirectory({'slothhub.tools.json': manifestText, 'slothub.tools.json': '{not json'});
      try {
        const result = await runCli(['manifest', 'validate'], {fetchJson: vi.fn(), workingDirectory});
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe('Valid Project Tool pin manifest v4 with 1 tool.\n');
        expect(result.stderr).toContain('slothub.tools.json, the old file name, is also here and was not read');
      } finally {
        await rm(workingDirectory, {recursive: true, force: true});
      }
    });

    it('fails with a next step when neither name exists', async () => {
      const workingDirectory = await inDirectory({});
      try {
        const result = await runCli(['manifest', 'validate', '--json'], {fetchJson: vi.fn(), workingDirectory});
        expect(result.exitCode).not.toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({ok: false, code: 'manifest_not_found', recovery: expect.stringContaining('slothhub manifest init')});
      } finally {
        await rm(workingDirectory, {recursive: true, force: true});
      }
    });

    it('asks for a rename when an old-name file is named explicitly', async () => {
      const result = await runCli(['manifest', 'validate', 'config/slothub.tools.json'], {fetchJson: vi.fn(), readTextFile: async () => manifestText});
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('mv config/slothub.tools.json config/slothhub.tools.json');
    });
  });

  it('rejects a manifest file that is not valid UTF-8', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slothhub-cli-manifest-'));
    const path = join(directory, 'slothhub.tools.json');
    const bytes = Buffer.from(manifestText, 'utf8');
    const producerNameOffset = bytes.indexOf(Buffer.from('"test"', 'utf8'));
    expect(producerNameOffset).toBeGreaterThanOrEqual(0);
    bytes[producerNameOffset + 1] = 0xff;

    try {
      await writeFile(path, bytes);
      const result = await runCli(['manifest', 'validate', path]);

      expect(result).toEqual({
        exitCode: 1,
        stdout: '',
        stderr: 'Manifest read failed: Project Tool pin manifest input is not valid UTF-8.\n',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects a non-regular manifest source without reading from it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slothhub-cli-manifest-'));

    try {
      const result = await runCli(['manifest', 'validate', directory]);

      expect(result).toEqual({
        exitCode: 1,
        stdout: '',
        stderr: 'Manifest read failed: Project Tool pin manifest source must be a regular file.\n',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('accepts the exact manifest byte limit and bounds the next byte with the default reader', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slothhub-cli-manifest-'));
    const exactPath = join(directory, 'exact.json');
    const oversizedPath = join(directory, 'oversized.json');
    const manifestBytes = Buffer.byteLength(manifestText, 'utf8');
    expect(manifestBytes).toBeLessThan(65_536);

    try {
      await writeFile(exactPath, `${manifestText}${' '.repeat(65_536 - manifestBytes)}`);
      await writeFile(oversizedPath, `${manifestText}${' '.repeat(65_537 - manifestBytes)}`);

      const exact = await runCli(['manifest', 'validate', exactPath]);
      expect(exact).toEqual({
        exitCode: 0,
        stdout: 'Valid Project Tool pin manifest v4 with 1 tool.\n',
        stderr: '',
      });

      const oversized = await runCli(['manifest', 'validate', oversizedPath]);
      expect(oversized).toEqual({
        exitCode: 1,
        stdout: '',
        stderr: 'Manifest read failed: Project Tool pin manifest exceeds the 65536-byte artifact limit.\n',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects another SlothHub artifact without producing stdout or fetching feeds', async () => {
    const fetchJson = vi.fn();
    const result = await runCli(['manifest', 'validate', 'saved-lists.json'], {
      fetchJson,
      readTextFile: async () => JSON.stringify({ version: 1, lists: [] }),
    });

    expect(result).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'Manifest validation failed: wrong-artifact-type.\n',
    });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('sanitizes filesystem diagnostics before writing them to stderr', async () => {
    const result = await runCli(['manifest', 'validate', 'bad-name'], {
      readTextFile: async () => { throw new Error('ENOENT: bad\u001b]8;;https://evil.example\u0007name'); },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stdout).not.toMatch(/[\u0007\u001b]/u);
    expect(result.stderr).toContain('Manifest read failed:');
  });

  it('searches the static search index and prints compact human output', async () => {
    const result = await runCli(['search', 'design', '--base-url', 'https://preview.slothhub.dev'], {
      fetchJson,
    });

    expect(result).toEqual({
      exitCode: 0,
      stdout: expect.stringContaining('Figma'),
      stderr: '',
    });
    expect(result.stdout).toContain('https://slothhub.dev/tool/figma');
    expect(result.stdout).toContain('Resource kind: App (app)');
    expect(result.stdout).toContain('Agent interface kinds: MCP server (mcp_server)');
    expect(result.stdout).not.toContain('Linear');
  });

  it('prints Resource kind for an MCP server search hit and omits empty Agent interface kinds on an app hit', async () => {
    const mcpServerTool: AgentSearchIndexTool = {
      ...searchIndexFeed.data.tools[0]!,
      name: 'Playwright MCP',
      slug: 'playwright-mcp',
      description: 'Browser automation as an MCP server',
      resourceKind: {value: 'mcp_server', label: 'MCP server'},
      agentInterfaceKinds: ['mcp_server'],
      detailUrl: 'https://slothhub.dev/tool/playwright-mcp',
      visitUrl: 'https://slothhub.dev/go/playwright-mcp?surface=agent',
      search: {
        ...searchIndexFeed.data.tools[0]!.search,
        text: 'playwright mcp browser automation',
        tokens: ['playwright', 'mcp', 'browser', 'automation'],
        fields: {
          ...searchIndexFeed.data.tools[0]!.search.fields!,
          name: 'Playwright MCP',
          description: 'Browser automation as an MCP server',
          resourceKind: ['MCP server', 'mcp_server'],
          agentInterfaceKinds: ['mcp_server'],
        },
      },
    };
    const appWithoutInterfaces: AgentSearchIndexTool = {
      ...searchIndexFeed.data.tools[1]!,
      agentInterfaceKinds: [],
    };
    const feed = {
      ...searchIndexFeed,
      data: {
        ...searchIndexFeed.data,
        tools: [mcpServerTool, appWithoutInterfaces],
      },
    };
    const fetchKindFeed: FetchJson = async (url) => {
      if (new URL(url).pathname === '/api/search-index.json') return feed;
      return fetchJson(url);
    };

    const mcpResult = await runCli(['search', 'playwright'], {fetchJson: fetchKindFeed});
    const appResult = await runCli(['search', 'tracking'], {fetchJson: fetchKindFeed});

    expect(mcpResult.exitCode).toBe(0);
    expect(mcpResult.stdout).toContain('Playwright MCP (playwright-mcp)');
    expect(mcpResult.stdout).toContain('Resource kind: MCP server (mcp_server)');
    expect(mcpResult.stdout).toContain('Agent interface kinds: MCP server (mcp_server)');
    expect(mcpResult.stdout).not.toContain('Linear');

    expect(appResult.exitCode).toBe(0);
    expect(appResult.stdout).toContain('Linear (linear)');
    expect(appResult.stdout).toContain('Resource kind: App (app)');
    expect(appResult.stdout).not.toContain('Agent interface kinds:');
    expect(appResult.stdout).not.toContain('Playwright MCP');
  });

  it('supports stable JSON output for search results', async () => {
    const result = await runCli(['search', 'design', '--json'], { fetchJson });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      query: 'design',
      count: 1,
      results: [
        expect.objectContaining({
          name: 'Figma',
          slug: 'figma',
          detailUrl: 'https://slothhub.dev/tool/figma',
          resourceKind: {value: 'app', label: 'App'},
          agentInterfaceKinds: ['mcp_server'],
        }),
      ],
    });
  });

  it('pins a resolved registry identifier ahead of ordinary search ranking', async () => {
    const fetchSpy = vi.fn(fetchJson);
    const result = await runCli(['search', 'old-owner/old-figma', '--json'], {
      fetchJson: fetchSpy,
    });

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.count).toBe(1);
    expect(payload.results[0]).toMatchObject({slug: 'figma', name: 'Figma'});
    expect(
      fetchSpy.mock.calls.filter(([url]) => String(url).includes('tool-lookup')),
    ).toHaveLength(1);
  });

  it('does not load the lookup artifact for ordinary search queries', async () => {
    const fetchSpy = vi.fn(fetchJson);
    const result = await runCli(['search', 'design'], {fetchJson: fetchSpy});

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Figma');
    expect(
      fetchSpy.mock.calls.filter(([url]) => String(url).includes('tool-lookup')),
    ).toHaveLength(0);
  });
  it('reports security filtering as unavailable for older search feeds', async () => {
    const { securityCapabilities: _ignoredFilter, ...oldFilters } = searchIndexFeed.data.filters;
    const oldFeed = {
      ...searchIndexFeed,
      data: {
        ...searchIndexFeed.data,
        tools: searchIndexFeed.data.tools.map(
          ({ securityCapabilities: _ignored, ...tool }) => tool,
        ),
        filters: oldFilters,
      },
    };
    const oldFeedFetch = async (url: string) =>
      new URL(url).pathname === '/api/search-index.json'
        ? JSON.parse(JSON.stringify(oldFeed))
        : fetchJson(url);
    const [searchResult, recommendResult] = await Promise.all([
      runCli(['search', '--security-capability', 'sso_saml'], { fetchJson: oldFeedFetch }),
      runCli(
        ['recommend', '--for', 'identity', '--security-capability', 'sso_saml'],
        { fetchJson: oldFeedFetch },
      ),
    ]);

    for (const result of [searchResult, recommendResult]) {
      expect(result).toMatchObject({ exitCode: 1, stdout: '' });
      expect(result.stderr).toContain('capability_unavailable');
    }
  });

  it('emits shared search-contract errors as stable JSON when --json is requested', async () => {
    const result = await runCli(['search', '--category', 'retired-category', '--json'], {
      fetchJson,
    });

    expect(result).toMatchObject({exitCode: 2, stderr: ''});
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      code: 'agent_search_unsupported_filter_value',
      filter: 'category',
      observedValue: 'retired-category',
      recovery: expect.stringContaining('supported category value'),
    });
  });

  it.each([
    [
      ['search', '--category', '--json'],
      {code: 'invalid_input'},
    ],
    [
      ['search', '--security-capability', 'future_capability', '--json'],
      {code: 'agent_search_unsupported_filter_value', filter: 'securityCapability'},
    ],
    [
      ['search', '--last-checked-after', '2026-02-30', '--json'],
      {code: 'agent_search_invalid_filter_value', filter: 'lastCheckedAfter'},
    ],
  ] as const)('keeps CLI JSON failures parseable for input %#', async (args, expected) => {
    const result = await runCli([...args], {fetchJson});

    expect(result).toMatchObject({exitCode: 2, stderr: ''});
    expect(JSON.parse(result.stdout)).toMatchObject({ok: false, ...expected});
  });

  it.each([
    [['search', '--output', 'result.json', '--json'], '--output is only supported'],
    [['search', '--force', '--json'], '--force is only supported'],
    [['receipt', 'render', 'receipt.json', '--force', '--json'], '--force requires --output'],
    [['receipt', 'render', 'receipt.json', '--json'], '--json is not supported'],
  ] as const)('keeps post-parse direct CLI failures JSON-parseable %#', async (args, message) => {
    const result = await runCli([...args], {fetchJson})

    expect(result).toMatchObject({exitCode: 2, stderr: ''})
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      code: 'invalid_input',
      message: expect.stringContaining(message),
      recovery: expect.any(String),
    })
  })

  it('terminal-sanitizes human search-contract diagnostics while preserving JSON values', async () => {
    const hostileValue = 'future\nFORGED\u001b]52;c;payload\u0007\u202e'
    const rejectingFetch = vi.fn(async () => {
      throw new Error('feed must not be read')
    })
    const [human, structured] = await Promise.all([
      runCli(['search', '--pricing', hostileValue], {fetchJson: rejectingFetch}),
      runCli(['search', '--pricing', hostileValue, '--json'], {fetchJson: rejectingFetch}),
    ])

    expect(human.stderr).toContain('agent_search_unsupported_filter_value')
    expect(human.stderr).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u)
    expect(structured.stdout).not.toMatch(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u)
    expect(structured.stderr).toBe('')
    expect(JSON.parse(structured.stdout)).toMatchObject({
      code: 'agent_search_unsupported_filter_value',
      observedValue: hostileValue,
      message: expect.stringContaining(hostileValue),
    })
    expect(rejectingFetch).not.toHaveBeenCalled()
  })

  it('escapes C1 and Unicode line separators in structured diagnostics', async () => {
    const hostileValue = 'future\u009bterminal-control\u2028FORGED'
    const rejectingFetch = vi.fn(async () => {
      throw new Error('feed must not be read')
    })
    const result = await runCli(['search', '--pricing', hostileValue, '--json'], {
      fetchJson: rejectingFetch,
    })

    expect(result.stdout).not.toMatch(/[\u007f-\u009f\u2028\u2029]/u)
    expect(JSON.parse(result.stdout)).toMatchObject({
      code: 'agent_search_unsupported_filter_value',
      observedValue: hostileValue,
      message: expect.stringContaining(hostileValue),
    })
    expect(rejectingFetch).not.toHaveBeenCalled()
  })

  it('terminal-sanitizes feed-backed dynamic-filter diagnostics after feed I/O', async () => {
    const hostileValue = 'retired-category\nFORGED\u001b]52;c;payload\u0007\u202e'
    const observedFetch = vi.fn(fetchJson)
    const [human, structured] = await Promise.all([
      runCli(['search', '--category', hostileValue], {fetchJson: observedFetch}),
      runCli(['search', '--category', hostileValue, '--json'], {fetchJson: observedFetch}),
    ])

    expect(observedFetch).toHaveBeenCalled()
    expect(human.stderr).toContain('agent_search_unsupported_filter_value')
    expect(human.stderr).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u)
    expect(structured.stdout).not.toMatch(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u)
    expect(structured.stderr).toBe('')
    expect(JSON.parse(structured.stdout)).toMatchObject({
      code: 'agent_search_unsupported_filter_value',
      filter: 'category',
      observedValue: hostileValue,
    })
  })

  it('serializes a missing required search projection as CLI JSON', async () => {
    const malformed = structuredClone(searchIndexFeed)
    const malformedTool: Partial<(typeof malformed.data.tools)[number]> = malformed.data.tools[0]!
    delete malformedTool.search
    const result = await runCli(['search', 'design', '--json'], {
      fetchJson: async (url) => url.endsWith('/api/index.json') ? indexFeed : malformed,
    })

    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      code: 'schema_invalid',
      recovery: expect.stringMatching(/feed URL and availability/i),
    })
  })

  it('serializes capability-unavailable failures as CLI JSON', async () => {
    const {securityCapabilities: _ignoredFilter, ...oldFilters} = searchIndexFeed.data.filters;
    const oldFeed = {
      ...searchIndexFeed,
      data: {
        ...searchIndexFeed.data,
        filters: oldFilters,
      },
    };
    const result = await runCli(
      ['search', '--security-capability', 'sso_saml', '--json'],
      {fetchJson: async (url) => url.endsWith('/api/index.json') ? indexFeed : oldFeed},
    );

    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      code: 'capability_unavailable',
      recovery: expect.stringContaining('omit --security-capability'),
    });

    const invalid = await runCli(
      ['search', '--security-capability', 'future_capability', '--json'],
      {fetchJson: async (url) => url.endsWith('/api/index.json') ? indexFeed : oldFeed},
    );
    expect(invalid.exitCode).toBe(2);
    expect(JSON.parse(invalid.stdout)).toMatchObject({
      ok: false,
      code: 'agent_search_unsupported_filter_value',
      filter: 'securityCapability',
    });
  });

  it.each([
    [['search', '--integration', 'github', '--json'], '--integration'],
    [
      ['search', '--integration-connection', 'native', '--json'],
      '--integration-connection',
    ],
  ])('reports Integration filtering as unavailable on older feeds: %s', async (
    args,
    flag,
  ) => {
    const result = await runCli(args, {
      fetchJson: async (url) => url.endsWith('/api/index.json') ? indexFeed : searchIndexFeed,
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      code: 'capability_unavailable',
      recovery: expect.stringContaining(`omit ${flag}`),
    });
  });

  it('serializes typed feed payload overflow as CLI JSON', async () => {
    const result = await runCli(['search', 'design', '--json'], {
      fetchJson: async () => {
        const {AgentSearchPayloadLimitError} = await import('@slothhub/domain/agent-search');
        throw new AgentSearchPayloadLimitError(1024, 1025);
      },
    });

    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      code: 'feed_payload_too_large',
      configuredLimitBytes: 1024,
      observedBytes: 1025,
      recovery: expect.stringContaining('smaller public feed'),
    });
  });

  it('serializes Tool lookup identity-claim overflow as CLI JSON', async () => {
    const oversizedLookup = {
      ...toolLookupArtifact,
      identityClaims: Array.from({length: 5_001}, (_, index) => ({
        namespace: 'npm_package' as const,
        value: `npm_package:retired-${index}`,
        disposition: 'retired' as const,
        sourceToolId: `retired-${index}`,
      })),
    };
    const lookupHash = computeContentHash(oversizedLookup);
    const result = await runCli(['tool', 'npm_package:example', '--json'], {
      fetchJson: async (url) => new URL(url).pathname === '/api/index.json'
        ? authenticatedIndex({contentHashes: {'/api/tool-lookup.json': lookupHash}})
        : oversizedLookup,
    });

    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      code: 'tool_lookup_identity_claim_limit_exceeded',
      configuredLimit: 5_000,
      observedValue: 5_001,
      recovery: expect.stringContaining('Reduce'),
    });
  });

  it('filters freshness from one cached search-index request and rejects invalid UTC dates', async () => {
    const requestedPaths: string[] = [];
    const filtered = await runCli([
      'search',
      '--destination-health',
      'healthy',
      '--verified',
      '--last-checked-after',
      '2026-07-14',
      '--json',
    ], {
      fetchJson: async (url) => {
        requestedPaths.push(new URL(url).pathname);
        return fetchJson(url);
      },
    });
    const invalid = await runCli(['search', '--last-checked-after', '2026-02-30'], {
      fetchJson,
    });

    expect(filtered.exitCode).toBe(0);
    expect(JSON.parse(filtered.stdout).results).toHaveLength(2);
    expect(requestedPaths).toEqual(['/api/index.json', '/api/search-index.json']);
    expect(invalid.exitCode).toBe(2);
    expect(invalid.stderr).toContain('exact UTC date');
  });

  it('prints Resource kind and Agent interface kinds for an MCP server Tool detail', async () => {
    const mcpFeed: AgentToolDetailFeed = {
      ...toolDetailFeed,
      data: {
        ...toolDetailFeed.data,
        name: 'Playwright MCP',
        slug: 'playwright-mcp',
        description: 'Browser automation as an MCP server',
        resourceKind: {value: 'mcp_server', label: 'MCP server'},
        agentInterfaces: [
          {
            kind: 'mcp_server',
            status: 'official',
            label: 'Playwright MCP server',
          },
        ],
        keyFeatures: [],
        productLimits: undefined,
        runtimeRequirements: undefined,
      },
    };

    const result = await runCli(['tool', 'playwright-mcp'], {
      fetchJson: async (url) =>
        new URL(url).pathname === '/api/tools/playwright-mcp.json' ? mcpFeed : fetchJson(url),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Playwright MCP');
    expect(result.stdout).toContain('Resource kind: MCP server (mcp_server)');
    expect(result.stdout).toContain('Agent interface kinds: MCP server (mcp_server)');
    expect(result.stdout).not.toContain('Resource kind: App (app)');
  });

  it('fetches the per-tool detail feed before rendering tool features', async () => {
    const requestedPaths: string[] = [];
    const detailWithPricingHistory: AgentToolDetailFeed = {
      ...toolDetailFeed,
      data: {
        ...toolDetailFeed.data,
        pricingHistory: {
          url: 'https://slothhub.dev/tool/figma/updates',
          latestValidatedChange: {
            previous: 'free',
            current: 'freemium',
            changedAt: '2026-07-09T12:00:00.000Z',
          },
        },
      },
    };
    const result = await runCli(['tool', 'figma'], {
      fetchJson: async (url) => {
        requestedPaths.push(new URL(url).pathname);
        return new URL(url).pathname === '/api/tools/figma.json'
          ? detailWithPricingHistory
          : fetchJson(url);
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Realtime collaboration');
    expect(result.stdout).toContain('Latest validated pricing change: free → freemium');
    expect(result.stdout).toContain('Pricing history: https://slothhub.dev/tool/figma/updates');
    expect(requestedPaths).toEqual(['/api/index.json', '/api/tools/figma.json']);
  });

  it('gives agents decision facts without evidence payloads when they ask for a summary', async () => {
    const detail: AgentToolDetailFeed = {
      ...toolDetailFeed,
      data: {
        ...toolDetailFeed.data,
        pricingDetails: {currency: 'USD', plans: [{name: 'Professional', listPrice: 20, billing: 'per Full seat per month, billed monthly ($16 billed annually)', billingPeriod: 'month'}]},
        runtimeRequirements: [{subjectKind: 'os', subjectName: 'macOS', environmentRange: '12.0 or later', status: 'supported', reviewedAt: '2026-11-17T00:00:00.000Z',
          evidence: [{title: 'Supported systems', url: 'https://example.com/pricing', checkedAt: '2026-11-17T00:00:00.000Z'}]}],
      },
    };
    const run = (args: string[]) => runCli(args, {
      fetchJson: async (url) => new URL(url).pathname === '/api/tools/figma.json' ? detail : fetchJson(url),
    });
    const summary = await run(['tool', 'figma', '--summary', '--json']);
    const full = await run(['tool', 'figma', '--json']);

    expect(summary.exitCode, summary.stdout).toBe(0);
    const parsed = JSON.parse(summary.stdout);
    expect(parsed.pricingDetails.plans[0]).toMatchObject({name: 'Professional', listPrice: 20, billingPeriod: 'month'});
    expect(parsed.runtimeRequirements).toEqual([{subjectKind: 'os', subjectName: 'macOS', environmentRange: '12.0 or later', status: 'supported'}]);
    expect(parsed.officialLinks.canonicalUrl).toBe(detail.data.resourceIdentity.canonicalUrl);
    expect(summary.stdout).not.toContain('Supported systems');
    expect(summary.stdout.length).toBeLessThan(full.stdout.length);
    const unsupported = await run(['search', 'figma', '--summary', '--json']);
    expect(unsupported.exitCode).not.toBe(0);
    expect(JSON.parse(unsupported.stdout)).toMatchObject({code: 'invalid_input'});
  });

  it('prints evidence-backed automation facts as inert plain text', async () => {
    const automationFeed: AgentToolDetailFeed = {
      ...toolDetailFeed,
      data: {
        ...toolDetailFeed.data,
        agentInterfaces: [
          {
            kind: 'cli',
            status: 'official',
            label: 'Figma CLI',
            installCommand: 'printf "<script>not executable</script>"',
            automation: {
              nonInteractive: 'yes',
              structuredOutput: 'partial',
              dryRun: 'no',
              evidenceBasis: 'documented',
              sideEffects: ['filesystem', 'network'],
              workspaceConcurrency: 'requires_isolation',
              isolationSupport: ['worktree', 'container'],
              checkedAt: '2026-07-20T00:00:00.000Z',
              notes: 'Require approval before applying changes.',
              evidenceReferences: [
                {
                  title: 'Automation safety guide',
                  url: 'https://docs.example.com/automation-safety',
                  sourceType: 'official_docs',
                  checkedAt: '2026-07-19T00:00:00.000Z',
                },
              ],
            },
          },
        ],
      },
    };

    const result = await runCli(['tool', 'figma'], {
      fetchJson: async (url) =>
        new URL(url).pathname === '/api/tools/figma.json' ? automationFeed : fetchJson(url),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Resource kind: App (app)');
    expect(result.stdout).toContain('Agent interface kinds: CLI (cli)');
    expect(result.stdout).toContain('Status: official (provenance only; not a safety claim)');
    expect(result.stdout).toContain('Install: printf "<script>not executable</script>"');
    expect(result.stdout).toContain('Non-interactive: yes');
    expect(result.stdout).toContain('Structured output: partial');
    expect(result.stdout).toContain('Dry run: no');
    expect(result.stdout).toContain('Evidence basis: documented');
    expect(result.stdout).toContain('Side effects: filesystem, network');
    expect(result.stdout).toContain('Workspace concurrency: requires isolation');
    expect(result.stdout).toContain('Isolation support: worktree, container');
    expect(result.stdout).toContain('Checked: 2026-07-20T00:00:00.000Z');
    expect(result.stdout).toContain(
      'Automation safety guide (official docs): https://docs.example.com/automation-safety',
    );
    expect(result.stdout).toContain('Require approval before applying changes.');
  });

  it('omits malformed or conflicting workflow descriptions from decision guidance', async () => {
    const decisionFeed: AgentToolDetailFeed = {
      ...toolDetailFeed,
      data: {
        ...toolDetailFeed.data,
        useCases: [
          {
            name: 'Oversized workflow',
            slug: 'oversized-workflow',
            description: 'x'.repeat(201),
          },
          {
            name: 'Conflicting workflow',
            slug: 'conflicting-workflow',
            description: 'First description',
          },
          {
            name: 'Conflicting workflow',
            slug: 'conflicting-workflow',
            description: 'Second description',
          },
        ],
      },
    };

    const result = await runCli(['tool', 'figma'], {
      fetchJson: async (url) =>
        new URL(url).pathname === '/api/tools/figma.json' ? decisionFeed : fetchJson(url),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain('What people use it for:');
    expect(result.stdout).not.toContain('First description');
    expect(result.stdout).not.toContain('Second description');
  });

  it('rejects unsafe decision text without reflecting terminal controls', async () => {
    const hostileFeed = {
      ...toolDetailFeed,
      data: {
        ...toolDetailFeed.data,
        name: 'Fi\u001b[2Jgma\u202e',
        description: 'Safe\u009b31m description\u0007',
        keyFeatures: ['Feature\u001b]0;owned\u0007\nforged line'],
      },
    };

    const result = await runCli(['tool', 'figma'], {
      fetchJson: async (url) => url.endsWith('/api/index.json') ? indexFeed : hostileFeed,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Invalid feed shape for /api/tools/figma.json');
    expect(result.stdout).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u);
  });

  it('prints related listed resources separately from features and alternatives', async () => {
    const relationshipFeed = {
      ...toolDetailFeed,
      data: {
        ...toolDetailFeed.data,
        resourceRelationships: [
          {
            kind: 'docs_for',
            direction: 'incoming',
            label: 'Documentation',
            target: {
              id: 'tool-docs',
              name: 'Figma docs',
              slug: 'figma-docs',
              canonicalUrl: 'https://help.figma.com/',
              resourceKind: {value: 'guide_or_website', label: 'Guide or website'},
            },
            evidenceUrl: 'https://help.figma.com/hc/en-us',
          },
        ],
      },
    };

    const result = await runCli(['tool', 'figma'], {fetchJson: async (url) => url.endsWith('/api/index.json') ? indexFeed : relationshipFeed});

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Related resources:');
    expect(result.stdout).toContain('- Documentation: Figma docs (Guide or website)');
    expect(result.stdout).toContain('  Canonical: https://help.figma.com/');
    expect(result.stdout).toContain('  Evidence: https://help.figma.com/hc/en-us');
  });

  it.each([
    {
      name: 'too many rows',
      mutate: (feed: typeof toolDetailFeed) => {
        feed.data.runtimeRequirements = Array.from(
          {length: 13},
          (_, index) => ({...toolDetailFeed.data.runtimeRequirements![0]!, subjectName: `Runtime ${index}`}),
        );
      },
    },
    {
      name: 'oversized notes',
      mutate: (feed: typeof toolDetailFeed) => {
        feed.data.runtimeRequirements![0]!.note = 'x'.repeat(401);
      },
    },
    {
      name: 'too many evidence references',
      mutate: (feed: typeof toolDetailFeed) => {
        const evidence = toolDetailFeed.data.runtimeRequirements![0]!.evidence[0]!;
        feed.data.runtimeRequirements![0]!.evidence = Array.from(
          {length: 4},
          (_, index) => ({...evidence, url: `https://example.com/runtime-${index}`}),
        );
      },
    },
    {
      name: 'control text',
      mutate: (feed: typeof toolDetailFeed) => {
        feed.data.runtimeRequirements![0]!.environmentRange = '>=20\u001b[31m';
      },
    },
    {
      name: 'private evidence URLs',
      mutate: (feed: typeof toolDetailFeed) => {
        feed.data.runtimeRequirements![0]!.evidence[0]!.url = 'http://127.0.0.1/runtime';
      },
    },
    {
      name: 'invalid checked dates',
      mutate: (feed: typeof toolDetailFeed) => {
        feed.data.runtimeRequirements![0]!.evidence[0]!.checkedAt = 'tomorrow';
      },
    },
    {
      name: 'assertive rows without evidence',
      mutate: (feed: typeof toolDetailFeed) => {
        feed.data.runtimeRequirements![0]!.evidence = [];
      },
    },
  ])('rejects hostile per-tool feeds with $name before rendering', async ({mutate}) => {
    const hostileFeed = structuredClone(toolDetailFeed);
    mutate(hostileFeed);

    const result = await runCli(['tool', 'figma'], {
      fetchJson: async (url) =>
        new URL(url).pathname === '/api/tools/figma.json' ? hostileFeed : fetchJson(url),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Invalid runtime requirements in /api/tools/figma.json');
  });

  it('resolves an explicit canonical URL key before loading Tool details', async () => {
    const requestedPaths: string[] = [];
    const result = await runCli(['tool', 'canonical_url:https://www.figma.com/'], {
      fetchJson: async (url) => {
        requestedPaths.push(new URL(url).pathname);
        return fetchJson(url);
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Figma');
    expect(requestedPaths).toEqual([
      '/api/index.json',
      '/api/tool-lookup.json',
      '/api/tools/figma.json',
    ]);
  });

  it('resolves a pasted registry URL before loading Tool details', async () => {
    const requestedPaths: string[] = [];
    const result = await runCli(['tool', 'https://github.com/figma/design'], {
      fetchJson: async (url) => {
        requestedPaths.push(new URL(url).pathname);
        return fetchJson(url);
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Figma');
    expect(requestedPaths).toEqual([
      '/api/index.json',
      '/api/tool-lookup.json',
      '/api/tools/figma.json',
    ]);
  });

  it('resolves a historical npm identity to its canonical Tool', async () => {
    const result = await runCli(['tool', 'npm_package:old-figma', '--json'], {fetchJson});

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).slug).toBe('figma');
  });

  it('resolves a historical GitHub repository identity to its canonical Tool', async () => {
    const result = await runCli(['tool', 'github_repository:old-owner/old-figma', '--json'], {fetchJson});

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).slug).toBe('figma');
  });
  it('preserves a known retired npm identity as a structured error', async () => {
    const result = await runCli(['tool', 'npm_package:retired-figma', '--json'], {fetchJson});

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      code: 'retired',
      message: 'Tool identity npm_package:retired-figma is retired; no current public Tool exists.',
      recovery: 'Search SlothHub for a current alternative.',
    });
  });

  it('does not compare a canonical slug with an alias for the same Tool', async () => {
    const result = await runCli(['compare', 'figma', 'figma-design', '--json'], {
      fetchJson: async (url) => {
        if (new URL(url).pathname === '/api/tools/figma-design.json') {
          throw new FeedHttpStatusError(404, 'Not Found');
        }
        return fetchJson(url);
      },
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      code: 'invalid_input',
      message: 'Compare requires at least two distinct tools after resolving aliases.',
    });
  });

  it('recommends tools from requirements with stable JSON for agents', async () => {
    const result = await runCli(['recommend', '--for', 'collaborative design systems', '--json'], { fetchJson });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        requirements: 'collaborative design systems',
        selected: expect.objectContaining({
          slug: 'figma',
          citations: [expect.objectContaining({ url: 'https://slothhub.dev/tool/figma' })],
        }),
      })
    );
  });

  it('reports Agent Interface capability unavailable for recommend JSON on older feeds', async () => {
    const {agentInterfaceKinds: _ignoredFilter, ...oldFilters} = searchIndexFeed.data.filters
    const oldFeed = {
      ...searchIndexFeed,
      data: {
        ...searchIndexFeed.data,
        tools: searchIndexFeed.data.tools.map(
          ({agentInterfaceKinds: _ignoredKinds, ...tool}) => tool,
        ),
        filters: oldFilters,
      },
    }
    const result = await runCli([
      'recommend',
      '--for',
      'collaborative design',
      '--agent-interface-kind',
      'mcp_server',
      '--json',
    ], {fetchJson: async (url) => url.endsWith('/api/index.json') ? indexFeed : oldFeed})

    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      code: 'capability_unavailable',
      recovery: expect.stringContaining('omit --agent-interface-kind'),
    })
  })

  it('rejects an unknown explicit Tool lookup namespace without loading feeds', async () => {
    const fetchJson = vi.fn();
    const result = await runCli(['tool', 'unknown_registry:alpha'], { fetchJson });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('supported Tool lookup namespace');
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('rejects malformed recommendation feed freshness at the feed boundary', async () => {
    const toolWithoutFreshness: Partial<AgentSearchIndexTool> = {
      ...searchIndexFeed.data.tools[0]!,
    };
    delete toolWithoutFreshness.freshness;
    // SAFETY: This test owns the fixture and supplies every member read through the asserted contract.
    const malformedSearchIndexFeed = {
      ...searchIndexFeed,
      data: {
        ...searchIndexFeed.data,
        tools: [toolWithoutFreshness, ...searchIndexFeed.data.tools.slice(1)],
      },
    } as typeof searchIndexFeed;

    const result = await runCli(['recommend', '--for', 'collaborative design systems'], {
      fetchJson: async (url) =>
        new URL(url).pathname === '/api/search-index.json' ? malformedSearchIndexFeed : fetchJson(url),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Invalid feed shape for /api/search-index.json');
    expect(result.stderr).toContain('data.tools.0.freshness');
  });

  it('compares tools and marks missing evidence explicitly', async () => {
    const result = await runCli(['compare', 'figma', 'linear', '--json'], {
      fetchJson,
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({ slug: 'figma' }),
          expect.objectContaining({ slug: 'linear' }),
        ]),
        gaps: expect.arrayContaining([expect.stringContaining('Linear has no public resource links')]),
      })
    );
  });

  it.each([false, true])('includes assessed integration and security facts in compare (json=%s)', async (json) => {
    const detail: AgentToolDetailFeed = {
      ...toolDetailFeed,
      data: {
        ...toolDetailFeed.data,
        integrations: [{name: 'GítHub 🦥\u001b[31m', slug: 'github', status: 'native', checkedAt: '2026-09-29T00:00:00.000Z', sourceUrl: 'https://example.com/integrations'}],
        securityPrivacyPosture: {securityCapabilities: [{
          label: 'SSO/SAML\u202e', capability: 'sso_saml', status: 'claimed',
          sourceUrl: 'https://example.com/security', checkedAt: '2026-09-29',
        }]},
      },
    };
    const requested: string[] = [];
    const result = await runCli(['compare', 'figma', 'linear', ...(json ? ['--json'] : [])], {
      fetchJson: async (url) => {
        const path = new URL(url).pathname;
        requested.push(path);
        return path === '/api/tools/figma.json' ? detail : fetchJson(url);
      },
    });
    expect(result.exitCode).toBe(0);
    expect(requested.filter((path) => path.startsWith('/api/tools/'))).toHaveLength(2);
    if (json) {
      expect(JSON.parse(result.stdout)).toMatchObject({tools: [
        {integrations: [{status: 'native', checkedAt: '2026-09-29T00:00:00.000Z'}], securityPrivacyPosture: {securityCapabilities: [{status: 'claimed', sourceUrl: 'https://example.com/security'}]}},
        {slug: 'linear'},
      ]});
    } else {
      expect(result.stdout).toContain('GítHub 🦥');
      expect(result.stdout).toContain('SSO/SAML (sso_saml): claimed; checked 2026-09-29; source https://example.com/security');
      expect(result.stdout).toContain('not certification, penetration testing, or a security guarantee');
      expect(result.stdout).toContain('\n');
      expect(result.stdout).not.toMatch(/[\u001b\u202e]/u);
    }
  });

  it('includes compact Product limits and Runtime requirements axes in compare JSON', async () => {
    const result = await runCli(['compare', 'figma', 'linear', '--json'], {
      fetchJson,
    });

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.criteria).toEqual(
      expect.arrayContaining(['Product limits', 'Runtime requirements']),
    );

    const figma = payload.tools.find((item: {slug: string}) => item.slug === 'figma');
    const linear = payload.tools.find((item: {slug: string}) => item.slug === 'linear');

    expect(figma.productLimits).toMatchObject({
      state: 'listed',
      groups: [
        {
          metric: 'API requests — sustained',
          planScope: 'Pro',
          deploymentScope: 'Hosted',
          ambiguous: false,
          facts: [
            {state: 'bounded', comparator: 'at_most', value: 60, unit: 'requests/minute'},
          ],
        },
        {metric: 'Seats', ambiguous: false, facts: [{state: 'unknown'}]},
      ],
    });
    expect(figma.productLimits.groups[0].facts[0]).not.toHaveProperty('evidence');
    expect(figma.productLimits.groups[0].facts[0]).not.toHaveProperty('note');
    expect(figma.productLimits.groups[0].facts[0]).not.toHaveProperty('reviewedAt');
    expect(linear.productLimits).toEqual({state: 'unknown', groups: []});

    expect(figma.runtimeRequirements).toMatchObject({
      state: 'listed',
      requirements: [
        {
          subjectName: 'Node.js',
          subjectKind: 'runtime',
          environmentRange: '>=20 <23',
          status: 'partial',
        },
      ],
    });
    expect(figma.runtimeRequirements.requirements[0]).not.toHaveProperty('evidence');
    expect(figma.runtimeRequirements.requirements[0]).not.toHaveProperty('note');
    expect(linear.runtimeRequirements).toEqual({state: 'unknown', requirements: []});
  });

  it('prints recorded prices and licenses in human compare output', async () => {
    const detail: AgentToolDetailFeed = {...toolDetailFeed, data: {...toolDetailFeed.data,
      pricingDetails: {currency: 'USD', plans: [{name: 'Pro', listPrice: 25, billing: 'per seat, billed annually', billingPeriod: 'month'}]},
      licenseFacts: [{scope: 'resource', status: 'observed', spdxExpression: 'MIT', source: 'github', sourceUrl: 'https://example.com/LICENSE', checkedAt: '2026-11-17T12:00:00.000Z'}],
    }};
    const result = await runCli(['compare', 'figma', 'linear'], {fetchJson: async (url) =>
      new URL(url).pathname === '/api/tools/figma.json' ? detail : fetchJson(url)});
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain('Plan: Pro — USD 25 / month (per seat, billed annually)');
    expect(result.stdout).toContain('MIT');
  });

  it('prints compact Product limits and Runtime requirements in human compare output', async () => {
    const result = await runCli(['compare', 'figma', 'linear'], {fetchJson});

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Product limits:');
    expect(result.stdout).toContain(
      '- API requests — sustained (plan: Pro, deployment: Hosted): at most 60 requests/minute',
    );
    expect(result.stdout).toContain('- Seats: unknown');
    expect(result.stdout).toContain('Runtime requirements:');
    expect(result.stdout).toContain('- Node.js (runtime): partial | environment >=20 <23');
    expect(result.stdout).toContain('Product limits: unknown');
    expect(result.stdout).toContain('Runtime requirements: unknown');
    expect(result.stdout).not.toContain('https://example.com/pricing');
    expect(result.stdout).not.toContain('https://example.com/runtime-support');
  });

  it('keeps ambiguous Product limit groups and conflicting runtime facts explicit in compare', async () => {
    const ambiguousFetch: FetchJson = async (url) => {
      const feed = await fetchJson(url);
      if (new URL(url).pathname !== '/api/tools/figma.json') return feed;
      const clone = structuredClone(feed) as AgentToolDetailFeed;
      clone.data.productLimits = [
        {
          metric: 'Seats',
          basis: 'documented_limit',
          ambiguous: true,
          facts: [
            {
              state: 'bounded',
              comparator: 'at_most',
              value: 25,
              unit: 'seats',
              evidence: [
                {
                  title: 'Vendor page',
                  url: 'https://example.com/seats',
                  sourceType: 'vendor_update',
                  checkedAt: '2026-07-01T00:00:00.000Z',
                },
              ],
              reviewedAt: '2026-07-01T00:00:00.000Z',
            },
            {
              state: 'unlimited_claimed',
              evidence: [
                {
                  title: 'Marketing page',
                  url: 'https://example.com/unlimited',
                  sourceType: 'vendor_update',
                  checkedAt: '2026-07-02T00:00:00.000Z',
                },
              ],
              reviewedAt: '2026-07-02T00:00:00.000Z',
            },
          ],
        },
      ];
      clone.data.runtimeRequirements = [
        {
          subjectKind: 'os',
          subjectName: 'macOS',
          environmentRange: '>=13',
          status: 'supported',
          evidence: [
            {
              title: 'Support matrix',
              url: 'https://example.com/support-matrix',
              checkedAt: '2026-07-01T00:00:00.000Z',
            },
          ],
          reviewedAt: '2026-07-01T00:00:00.000Z',
        },
        {
          subjectKind: 'os',
          subjectName: 'macOS',
          environmentRange: '<12',
          status: 'unsupported',
          evidence: [
            {
              title: 'Support matrix',
              url: 'https://example.com/support-matrix',
              checkedAt: '2026-07-01T00:00:00.000Z',
            },
          ],
          reviewedAt: '2026-07-01T00:00:00.000Z',
        },
      ];
      return clone;
    };

    const result = await runCli(['compare', 'figma', 'linear', '--json'], {
      fetchJson: ambiguousFetch,
    });

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    const figma = payload.tools.find((item: {slug: string}) => item.slug === 'figma');
    expect(figma.productLimits.groups[0]).toMatchObject({
      metric: 'Seats',
      ambiguous: true,
      facts: [
        {state: 'bounded', comparator: 'at_most', value: 25, unit: 'seats'},
        {state: 'unlimited_claimed'},
      ],
    });
    expect(figma.runtimeRequirements.requirements).toEqual([
      expect.objectContaining({subjectName: 'macOS', status: 'supported'}),
      expect.objectContaining({subjectName: 'macOS', status: 'unsupported'}),
    ]);
  });

  it('omits Product limits and Runtime requirements criteria when no compared Tool has them', async () => {
    const result = await runCli(['compare', 'linear', 'plain', '--json'], {
      fetchJson: async (url) => {
        const path = new URL(url).pathname;
        if (path === '/api/tools/plain.json') {
          return {
            ...linearToolDetailFeed,
            data: {...linearToolDetailFeed.data, slug: 'plain', name: 'Plain'},
          };
        }
        return fetchJson(url);
      },
    });

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.criteria).not.toContain('Product limits');
    expect(payload.criteria).not.toContain('Runtime requirements');
    expect(
      payload.tools.every(
        (item: {productLimits: {state: string}}) => item.productLimits.state === 'unknown',
      ),
    ).toBe(true);
  });

  it('names Resource kind and Agent interfaces for two MCP servers in compare JSON', async () => {
    const mcpFetch: FetchJson = async (url) => {
      const path = new URL(url).pathname;
      const detail = path === '/api/tools/figma.json' ? toolDetailFeed
        : path === '/api/tools/linear.json' ? linearToolDetailFeed : undefined;
      if (!detail) return fetchJson(url);
      const clone = structuredClone(detail);
      clone.data.resourceKind = {value: 'mcp_server', label: 'MCP server'};
      clone.data.agentInterfaces = [
        {
          kind: 'mcp_server',
          status: 'official',
          label: 'MCP server',
          source: 'mcp_registry',
          identifier: `io.github.acme/${clone.data.slug}`,
        },
      ];
      return clone;
    };

    const result = await runCli(['compare', 'figma', 'linear', '--json'], {
      fetchJson: mcpFetch,
    });

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.criteria).toEqual(
      expect.arrayContaining(['Resource kind', 'Agent interfaces']),
    );
    for (const tool of payload.tools) {
      expect(tool.resourceKind).toBe('MCP server');
      expect(tool.agentInterfaceKinds).toEqual(['mcp_server']);
    }
    expect(
      payload.gaps.some((gap: string) => gap.includes('agent interface')),
    ).toBe(false);
  });

  it('distinguishes an app from an MCP server in human compare output', async () => {
    const mcpFetch: FetchJson = async (url) => {
      if (new URL(url).pathname !== '/api/tools/linear.json') return fetchJson(url);
      const clone = structuredClone(linearToolDetailFeed);
      clone.data.resourceKind = {value: 'mcp_server', label: 'MCP server'};
      clone.data.agentInterfaces = [
        {
          kind: 'cli',
          status: 'official',
          label: 'Linear CLI',
          docsUrl: 'https://linear.app/cli',
        },
      ];
      return clone;
    };

    const result = await runCli(['compare', 'figma', 'linear'], {fetchJson: mcpFetch});

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Resource kind: App');
    expect(result.stdout).toContain('Resource kind: MCP server');
    expect(result.stdout).toContain('Agent interfaces: CLI');
    expect(result.stdout).toContain('Agent interfaces: unknown');
    expect(result.stdout).toContain(
      '- Figma has no agent interface kinds in the public detail feed.',
    );
  });

  it('reports a Tool with no interfaces as missing facts, never as unsupported', async () => {
    const result = await runCli(['compare', 'figma', 'linear', '--json'], {fetchJson});

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.criteria).toContain('Resource kind');
    expect(payload.criteria).not.toContain('Agent interfaces');
    for (const tool of payload.tools) {
      expect(tool.agentInterfaceKinds).toEqual([]);
    }
    expect(payload.gaps).toEqual(
      expect.arrayContaining([
        'Figma has no agent interface kinds in the public detail feed.',
        'Linear has no agent interface kinds in the public detail feed.',
      ]),
    );
  });

  it('rejects control characters in compare axis feed data instead of printing them', async () => {
    const unsafeFetch: FetchJson = async (url) => {
      const feed = await fetchJson(url);
      if (new URL(url).pathname !== '/api/tools/figma.json') return feed;
      const clone = structuredClone(feed) as AgentToolDetailFeed;
      clone.data.productLimits = [
        {
          metric: 'Seats\u001b[2J',
          ambiguous: false,
          facts: [{state: 'unlimited_claimed', evidence: [], reviewedAt: '2026-07-01T00:00:00.000Z'}],
        },
      ];
      return clone;
    };

    const result = await runCli(['compare', 'figma', 'linear'], {fetchJson: unsafeFetch});

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toContain('\u001b');
  });

  it('checks Tool Assembly evidence with canonical JSON from selected detail feeds only', async () => {
    const requestedPaths: string[] = [];
    const result = await runCli(
      [
        'assembly',
        'linear',
        'figma',
        '--require-integration',
        'github,slack',
        '--require-platform',
        'web',
        '--json',
      ],
      {
        fetchJson: async (url) => {
          requestedPaths.push(new URL(url).pathname);
          return fetchJson(url);
        },
      },
    );

    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.identity).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(report.confirmedOverlap.map((entry: { key: string }) => entry.key)).toEqual([
      'github',
      'web',
    ]);
    expect(report.missingEvidence.map((entry: { key: string }) => entry.key)).toEqual([
      'slack',
      'desktop',
    ]);
    expect(requestedPaths.sort()).toEqual([
      '/api/index.json',
      '/api/tools/figma.json',
      '/api/tools/linear.json',
    ]);
    expect(result.stdout).not.toContain('\n');
  });

  it('preserves unknown assembly slugs and treats structured negatives as conflicts', async () => {
    const result = await runCli(
      ['assembly', 'figma', 'linear', 'deleted', '--require-integration', 'github', '--json'],
      {
        fetchJson: async (url) => {
          const path = new URL(url).pathname;
          if (path === '/api/tools/deleted.json') throw new FeedHttpStatusError(404, 'Not Found');
          if (path === '/api/tools/linear.json') {
            return {
              ...linearToolDetailFeed,
              data: {
                ...linearToolDetailFeed.data,
                integrations: [
                  {
                    slug: 'github',
                    name: 'GitHub',
                    status: 'incompatible',
                    checkedAt: '2026-07-20T00:00:00Z',
                    sourceUrl: 'https://docs.example.com/incompatible',
                  },
                ],
              },
            };
          }
          return fetchJson(url);
        },
      },
    );

    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.unresolvedTools).toEqual([
      expect.objectContaining({ slug: 'deleted', state: 'unknown' }),
    ]);
    expect(report.explicitConflicts).toEqual([
      expect.objectContaining({ key: 'github', state: 'conflict' }),
    ]);
    expect(report.confirmedOverlap).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'github' })]),
    );
  });

  it.each([
    ['--require-integration', 'GitHub!', 'Invalid Integration requirement'],
    ['--require-platform', 'watch', 'Invalid platform requirement'],
    ['--require-agent-interface', 'brain_link', 'Invalid Agent Interface requirement'],
  ])('rejects invalid assembly requirement tokens for %s', async (flag, value, message) => {
    const result = await runCli(['assembly', 'figma', 'linear', flag, value, '--json'], {
      fetchJson,
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      code: 'invalid_input',
      message: expect.stringContaining(message),
    });
  });

  it('collapses duplicate assembly selection and enforces the two-to-five identity bound', async () => {
    const duplicate = await runCli(['assembly', 'figma', 'FIGMA', '--json'], { fetchJson });
    const overflow = await runCli(
      ['assembly', 'one', 'two', 'three', 'four', 'five', 'six'],
      { fetchJson: vi.fn() },
    );

    expect(duplicate.exitCode).toBe(2);
    expect(JSON.parse(duplicate.stdout)).toMatchObject({
      ok: false,
      code: 'invalid_input',
      message: 'Assembly requires 2-5 unique Tool slugs after duplicates are removed.',
    });
    expect(overflow.exitCode).toBe(2);
    expect(overflow.stderr).toBe(
      'Assembly requires 2-5 unique Tool slugs after duplicates are removed.\n',
    );
  });

  it('rejects more than 32 raw compare references even when they are duplicates', async () => {
    const guardedFetch = vi.fn(fetchJson);
    const result = await runCli([
      'compare',
      ...Array.from({length: 33}, () => 'figma'),
    ], {fetchJson: guardedFetch});

    expect(result).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: 'Compare accepts at most 32 slug or alias references.\n',
    });
    expect(guardedFetch).not.toHaveBeenCalled();
  });

  it('allows exactly 32 raw aliases that collapse to two canonical Tools', async () => {
    const aliases = Array.from({length: 32}, (_, index) => `tool-alias-${index}`);
    const result = await runCli(['compare', ...aliases, '--json'], {
      fetchJson: async (url) => {
        const path = new URL(url).pathname;
        if (aliases.some((alias) => path === `/api/tools/${alias}.json`)) {
          throw new FeedHttpStatusError(404, 'Not Found');
        }
        if (path === '/api/tool-lookup.json') {
          return {
            ...toolLookupArtifact,
            tools: [
              ...toolLookupArtifact.tools,
              {
                slug: 'linear',
                name: 'Linear',
                detailUrl: 'https://slothhub.dev/tool/linear',
                keys: [{namespace: 'slug', value: 'linear'}],
              },
            ],
            aliases: aliases.map((slug, index) => ({
              slug,
              sourceToolId: index < 16 ? 'retired-figma' : 'retired-linear',
              canonicalSlug: index < 16 ? 'figma' : 'linear',
            })),
          };
        }
        return fetchJson(url);
      },
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).tools.map((tool: {slug: string}) => tool.slug))
      .toEqual(['figma', 'linear']);
  });

  it('allows exactly eight canonical Tools', async () => {
    const slugs = Array.from({length: 8}, (_, index) => `canonical-${index}`);
    const result = await runCli(['compare', ...slugs, '--json'], {
      fetchJson: async (url) => {
        const path = new URL(url).pathname;
        const slug = slugs.find((candidate) => path === `/api/tools/${candidate}.json`);
        if (!slug) return fetchJson(url);
        return {
          ...toolDetailFeed,
          data: {
            ...toolDetailFeed.data,
            name: slug,
            slug,
            detailUrl: `https://slothhub.dev/tool/${slug}`,
            website: `https://example.com/${slug}`,
            visitUrl: `https://slothhub.dev/go/${slug}?surface=agent`,
          },
        };
      },
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).tools).toHaveLength(8);
  });

  it('rejects nine canonical Tools', async () => {
    const slugs = Array.from({length: 9}, (_, index) => `canonical-${index}`);
    const result = await runCli(['compare', ...slugs, '--json'], {
      fetchJson: async (url) => {
        const path = new URL(url).pathname;
        const slug = slugs.find((candidate) => path === `/api/tools/${candidate}.json`);
        if (!slug) return fetchJson(url);
        return {
          ...toolDetailFeed,
          data: {
            ...toolDetailFeed.data,
            name: slug,
            slug,
            detailUrl: `https://slothhub.dev/tool/${slug}`,
            website: `https://example.com/${slug}`,
            visitUrl: `https://slothhub.dev/go/${slug}?surface=agent`,
          },
        };
      },
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      code: 'invalid_input',
      message: 'Compare supports at most 8 tools at a time.',
      configuredLimit: 8,
      observedValue: 9,
    });
  });

  it('accepts global flags before the subcommand', async () => {
    const result = await runCli(['--json', 'search', 'design'], { fetchJson });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        query: 'design',
        count: 1,
      })
    );
  });

  it('prints a normalized doctor manifest URL for trailing slash base URLs', async () => {
    const result = await runCli(['doctor', '--base-url', 'https://preview.slothhub.dev/'], {
      fetchJson: async (url) => (new URL(url).pathname === '/api/index.json' ? indexFeed : {version: '33.0.0'}),
      probeFetch: okProbeFetch,
    });

    expect(result.stdout).toContain('Manifest: https://preview.slothhub.dev/api/index.json');
    expect(result.stdout).not.toContain('https://preview.slothhub.dev//api/index.json');
  });

  it('reports feed diagnostics from the manifest', async () => {
    const result = await runCli(['doctor', '--base-url', 'https://preview.slothhub.dev'], {
      fetchJson: async (url) => (new URL(url).pathname === '/api/index.json' ? indexFeed : {version: '33.0.0'}),
      probeFetch: okProbeFetch,
    });

    expect(result).toEqual({
      exitCode: 0,
      stdout: expect.stringContaining('Feed version: 33.0.0'),
      stderr: '',
    });
    expect(result.stdout).toContain('- searchIndex: ok https://slothhub.dev/api/search-index.json');
  });

  it('does not let an unsupported index site URL authorize probe destinations', async () => {
    const fetchJson = vi.fn(async (url: string) => {
      if (new URL(url).pathname === '/api/index.json') {
        return {
          ...indexFeed,
          siteUrl: 'https://attacker.example',
          feeds: {
            ...indexFeed.feeds,
            futureFeed: 'https://attacker.example/rebinding-target',
          },
        };
      }
      return {version: '33.0.0'};
    });

    const probeFetch = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(null, {status: 200}));
    const result = await runCli(['doctor', '--base-url', 'https://preview.slothhub.dev'], {
      fetchJson,
      probeFetch,
    });
    expect(result.stdout).toContain(
      '- futureFeed: error (advertised URL is not a public catalog feed) https://attacker.example/rebinding-target',
    );
    expect(fetchJson).toHaveBeenCalledOnce();
    expect(probeFetch.mock.calls.some(([url]) => url === 'https://attacker.example/rebinding-target')).toBe(false);
  });

  it('returns the advertised URL budget as a structured doctor error', async () => {
    const futureFeeds = Object.fromEntries(
      Array.from({length: 65 - Object.keys(indexFeed.feeds).length - Object.keys(indexFeed.snapshots ?? {}).length}, (_, index) => [
        `future-${index}`,
        `https://slothhub.dev/api/future-${index}.json`,
      ]),
    );
    const dependencies = {
      fetchJson: async () => ({
        ...indexFeed,
        feeds: {...indexFeed.feeds, ...futureFeeds},
      }),
      probeFetch: vi.fn(),
    };
    const result = await runCli(['doctor', '--json'], dependencies);
    const human = await runCli(['doctor'], dependencies);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      code: 'advertised_catalog_feed_limit_exceeded',
      configuredLimit: 64,
      observedCount: 65,
      recovery: expect.stringContaining('configured public URL limit'),
    });
    expect(human.stderr).toContain('advertised_catalog_feed_limit_exceeded');
    expect(human.stderr).toContain('configured_limit=64');
    expect(human.stderr).toContain('observed_count=65');
    expect(human.stderr).toContain('recovery=Use a catalog index');
  });

  it('rejects tracked advertised URLs without echoing them in human or JSON output', async () => {
    const trackedUrl = 'https://slothhub.dev/%67o/figma?surface=agent';
    const dependencies = {
      fetchJson: async () => ({
        ...indexFeed,
        feeds: {...indexFeed.feeds, futureFeed: trackedUrl},
      }),
      probeFetch: vi.fn(),
    };
    const human = await runCli(['doctor'], dependencies);
    const json = await runCli(['doctor', '--json'], dependencies);

    expect(human.stderr).toContain('invalid_advertised_catalog_url');
    expect(JSON.parse(json.stdout)).toMatchObject({
      code: 'invalid_advertised_catalog_url',
      field: 'feeds.futureFeed',
    });
    expect(`${human.stdout}${human.stderr}${json.stdout}${json.stderr}`).not.toContain('/%67o/');
  });

  it('returns a helpful error when a slug is not found', async () => {
    const result = await runCli(['tool', 'missing-tool'], {
      fetchJson: async (url) => {
        if (url.endsWith('/api/index.json')) return indexFeed;
        throw new FeedHttpStatusError(404, 'Not Found');
      },
    });

    expect(result).toEqual({
      exitCode: 3,
      stdout: '',
      stderr: 'Tool not found: missing-tool Recovery: Run slothhub search <query> to find a valid slug.\n',
    });
  });

  it('validates receipt JSON offline and emits normalized machine output only to stdout', async () => {
    const fetchJson = vi.fn();
    const readReceiptSource = vi.fn().mockResolvedValue(decisionReceiptJson());
    const result = await runCli(['receipt', 'validate', 'receipt.json', '--json', '--base-url', 'not a URL'], {
      fetchJson,
      readReceiptSource,
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      receiptId: 'cli-receipt',
      selectedTool: null,
    });
    expect(result.stderr).toBe('');
    expect(readReceiptSource).toHaveBeenCalledWith('receipt.json');
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('keeps receipt validation and failure messages terminal-safe', async () => {
    const receipt = JSON.parse(decisionReceiptJson());
    receipt.receiptId = 'cli\nFORGED\r\u001b]52;c;payload\u0007';
    const valid = await runCli(['receipt', 'validate', '-'], {
      readReceiptSource: vi.fn().mockResolvedValue(JSON.stringify(receipt)),
    });
    const failed = await runCli(['receipt', 'validate', '-'], {
      readReceiptSource: vi.fn().mockRejectedValue(new Error('Read failed\u001b]52;c;payload\nFORGED')),
    });

    expect(valid.stdout).toContain('cli\\u{A}FORGED\\u{D}\\u{1B}]52;c;payload\\u{7}');
    expect(valid.stdout).not.toContain('\nFORGED');
    expect(valid.stdout).not.toContain('\r');
    expect(valid.stdout).not.toContain('\u001b');
    expect(failed.stderr).toBe('Read failed\\u{1B}]52;c;payload\\u{A}FORGED\n');
  });

  it('keeps decision receipt commands offline and limited to validate or render', async () => {
    const readReceiptSource = vi.fn();
    const fetchJson = vi.fn();

    const result = await runCli(['receipt', 'check', '-'], {readReceiptSource, fetchJson});

    expect(result).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: 'Receipt command requires validate or render.\n',
    });
    expect(readReceiptSource).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('renders a receipt to deterministic Markdown and validates that artifact offline', async () => {
    const fetchJson = vi.fn();
    const rendered = await runCli(['receipt', 'render', '-'], {
      fetchJson,
      readReceiptSource: vi.fn().mockResolvedValue(decisionReceiptJson()),
    });
    const validated = await runCli(['receipt', 'validate', '-'], {
      fetchJson,
      readReceiptSource: vi.fn().mockResolvedValue(rendered.stdout),
    });

    expect(rendered).toMatchObject({ exitCode: 0, stderr: '' });
    expect(rendered.stdout).toContain('SLOTHUB_DECISION_RECEIPT_JSON_V1_BEGIN');
    expect(validated).toEqual({
      exitCode: 0,
      stdout: 'Valid decision receipt cli-receipt (schema 1).\n',
      stderr: '',
    });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('uses atomic non-overwrite output unless force is explicit', async () => {
    const writeReceiptOutput = vi.fn().mockResolvedValue(undefined);
    const dependencies = {
      readReceiptSource: vi.fn().mockResolvedValue(decisionReceiptJson()),
      writeReceiptOutput,
    };

    const created = await runCli(['receipt', 'render', 'receipt.json', '--output', 'receipt.md'], dependencies);
    const forced = await runCli(
      ['receipt', 'render', 'receipt.json', '--output', 'receipt.md', '--force'],
      dependencies,
    );

    expect(created).toEqual({ exitCode: 0, stdout: '', stderr: 'Wrote receipt.md\n' });
    expect(forced.exitCode).toBe(0);
    expect(writeReceiptOutput).toHaveBeenNthCalledWith(
      1,
      'receipt.md',
      expect.stringContaining('SLOTHUB_DECISION_RECEIPT_JSON_V1_BEGIN'),
      false,
    );
    expect(writeReceiptOutput).toHaveBeenNthCalledWith(2, 'receipt.md', expect.any(String), true);
  });

  it.each([
    {
      args: ['search', 'design', '--output', 'receipt.md'],
      message: '--output is only supported by receipt render and manifest init',
    },
    {
      args: ['search', 'design', '--force'],
      message: '--force is only supported by receipt render and manifest init',
    },
    {
      args: ['receipt', 'validate', 'receipt.json', '--output', 'receipt.md'],
      message: '--output is only supported by receipt render and manifest init',
    },
    {
      args: ['receipt', 'validate', 'receipt.json', '--force'],
      message: '--force is only supported by receipt render and manifest init',
    },
    {
      args: ['receipt', 'render', 'receipt.json', '--force'],
      message: '--force requires --output',
    },
    {
      args: ['receipt', 'render', 'receipt.json', '--json'],
      message: '--json is not supported by receipt render',
    },
  ])('rejects incompatible receipt output flags: $args', async ({ args, message }) => {
    const readReceiptSource = vi.fn();
    const fetchJson = vi.fn();

    const result = await runCli(args, { readReceiptSource, fetchJson });

    expect(result).toMatchObject({exitCode: 2});
    if (args.includes('--json')) {
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: false,
        code: 'invalid_input',
        message: `${message}.`,
      });
    } else {
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe(`${message}.\n`);
    }
    expect(readReceiptSource).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it.each([
    { action: 'validate', error: new Error('stdin exceeded receipt byte limit') },
    { action: 'render', error: new Error('cannot read receipt') },
  ])('returns offline read failures on stderr for receipt $action', async ({ action, error }) => {
    const result = await runCli(['receipt', action, '-'], {
      fetchJson: vi.fn(),
      readReceiptSource: vi.fn().mockRejectedValue(error),
    });

    expect(result).toEqual({ exitCode: 1, stdout: '', stderr: `${error.message}\n` });
  });

  // Representative failures across commands: usage problems exit 2, runtime
  // failures exit 1, and an unsupported feed major keeps its dedicated 3.
  // Under --json the failure envelope always lands on stdout; human prose
  // always stays on stderr.
  it.each([
    { args: ['frobnicate'], exitCode: 2, code: 'invalid_input' },
    { args: ['tool'], exitCode: 2, code: 'invalid_input' },
    { args: ['receipt'], exitCode: 2, code: 'invalid_input' },
    { args: ['manifest'], exitCode: 2, code: 'invalid_input' },
    { args: ['search', '--limit', '51'], exitCode: 2, code: 'agent_search_result_limit_out_of_range' },
    { args: ['search', '--category'], exitCode: 2, code: 'invalid_input' },
    {
      args: ['tool', 'missing-tool'],
      fetchJson: async (url: string) => {
        if (url.endsWith('/api/index.json')) return indexFeed;
        throw new FeedHttpStatusError(404, 'Not Found');
      },
      exitCode: 3,
      code: 'not_found',
    },
    {
      args: ['doctor'],
      fetchJson: async () => {
        throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
      },
      exitCode: 5,
      code: 'transport',
    },
    {
      args: ['doctor'],
      fetchJson: async () => ({ version: '99.0.0' }),
      exitCode: 1,
      code: 'unsupported_version',
    },
  ] as const)(
    'reports $args as $code with exit $exitCode',
    async ({ args, fetchJson: fetchOverride, exitCode, code }) => {
      const dependencies = { fetchJson: fetchOverride ?? fetchJson };

      const structured = await runCli([...args, '--json'], dependencies);
      expect(structured.exitCode).toBe(exitCode);
      expect(structured.stderr).toBe('');
      expect(JSON.parse(structured.stdout)).toMatchObject({
        ok: false,
        code,
        message: expect.any(String),
      });

      const human = await runCli([...args], dependencies);
      expect(human.exitCode).toBe(exitCode);
      expect(human.stdout).toBe('');
      expect(human.stderr).not.toBe('');
      expect(() => JSON.parse(human.stderr)).toThrow();
    },
  );

it('prints decision guidance, workflows, and the exact evidence set', async () => {
    const decisionFeed: AgentToolDetailFeed = {
      ...toolDetailFeed,
      data: {
        ...toolDetailFeed.data,
        integrations: [{name: 'GitHub', slug: 'github', status: 'native', checkedAt: '2026-09-01T00:00:00.000Z', sourceUrl: 'https://github.com/features'}],
        securityPrivacyPosture: {securityCapabilities: [{label: 'SSO/SAML', capability: 'sso_saml', status: 'claimed', sourceUrl: 'https://example.com/security'}]},
        alternativeTools: [{...toolDetailFeed.data, name: 'Penpot', slug: 'penpot', detailUrl: 'https://slothhub.dev/tool/penpot'}],
        freshness: {
          ...toolDetailFeed.data.freshness,
          lastUpdated: '2026-07-01T00:00:00.000Z',
        },
        useCases: [
          {
            name: 'Design systems',
            slug: 'design-systems',
            description: 'Build and maintain shared interface systems',
            url: 'https://slothhub.dev/use-case/design-systems',
          },
        ],
        fitGuidance: {
          bestFor: ['Product design teams'],
          notIdealFor: ['Print-first agencies'],
          keyTradeoffs: ['Strong collaboration, weaker offline'],
          setupComplexity: 'low',
          setupComplexityLabel: 'Low',
          primaryDecisionCriteria: ['Realtime collaboration'],
          recommendedNextStep: 'Compare alternatives before deciding.',
        },

      },
    };

    const result = await runCli(['tool', 'figma'], {
      fetchJson: async (url) =>
        new URL(url).pathname === '/api/tools/figma.json' ? decisionFeed : fetchJson(url),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('What people use it for:');
    expect(result.stdout).toContain('Build and maintain shared interface systems');
    expect(result.stdout).toContain('not claims about specific customers or adoption');
    expect(result.stdout).toContain('Tool fit guidance');
    expect(result.stdout).toContain('GitHub (github): native');
    expect(result.stdout).toContain('SSO/SAML (sso_saml): claimed');
    expect(result.stdout).toContain('Penpot (penpot): https://slothhub.dev/tool/penpot');
    expect(result.stdout).toContain('A strong fit when:');
    expect(result.stdout).toContain('- Product design teams');
    expect(result.stdout).toContain('Consider an alternative when:');
    expect(result.stdout).toContain('- Print-first agencies');

    const json = await runCli(['tool', 'figma', '--json'], {
      fetchJson: async (url) => new URL(url).pathname === '/api/tools/figma.json' ? decisionFeed : fetchJson(url),
    });
    expect(JSON.parse(json.stdout)).toMatchObject({
      integrations: decisionFeed.data.integrations,
      securityPrivacyPosture: decisionFeed.data.securityPrivacyPosture,
      alternativeTools: [{name: 'Penpot', slug: 'penpot', detailUrl: 'https://slothhub.dev/tool/penpot'}],
      fitGuidance: decisionFeed.data.fitGuidance,
    });
  });
});

describe('network environment diagnostics', () => {
  const proxyUrl = 'http://user:pass@proxy.corp:8080';
  const failingFetchJson: FetchJson = async () => {
    throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
  };

  beforeEach(() => {
    // Diagnostics fixtures must not inherit the host's proxy or CA settings.
    for (const name of [
      'HTTPS_PROXY',
      'https_proxy',
      'HTTP_PROXY',
      'http_proxy',
      'ALL_PROXY',
      'all_proxy',
      'NO_PROXY',
      'no_proxy',
      'NODE_USE_ENV_PROXY',
      'NODE_EXTRA_CA_CERTS',
      'SLOTHHUB_BASE_URL',
    ]) vi.stubEnv(name, undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const unavailableSite: FetchJson = async () => {
    throw new FeedHttpStatusError(402, 'Payment Required');
  };

  it('names the default origin and the override when the public site is unavailable', async () => {
    const result = await runCli(['search', 'postgres'], { fetchJson: unavailableSite });

    expect(result.exitCode).toBe(5);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Unable to load feed /api/index.json from https://slothhub.dev (HTTP 402).');
    expect(result.stderr).toContain('--base-url <origin> or SLOTHHUB_BASE_URL');
    expect(result.stderr).not.toMatch(/\n\s+at /);
  });

  it('keeps a configured origin out of the failure while still naming the override', async () => {
    const result = await runCli(
      ['search', 'postgres', '--json', '--base-url', 'http://localhost:4999'],
      { fetchJson: unavailableSite },
    );

    expect(result.exitCode).toBe(5);
    const payload = JSON.parse(result.stdout);
    expect(payload).toMatchObject({ code: 'transport', path: '/api/index.json' });
    expect(payload.message).toBe('Unable to load feed /api/index.json (HTTP 402).');
    expect(payload.recovery).toContain('--base-url or SLOTHHUB_BASE_URL');
    expect(result.stdout).not.toContain('localhost:4999');
  });

  it('attaches a proxy_env_not_enabled hint when proxy env is set but ignored', async () => {
    vi.stubEnv('HTTPS_PROXY', proxyUrl);
    vi.stubEnv('NODE_USE_ENV_PROXY', undefined);

    const result = await runCli(['doctor', '--json'], { fetchJson: failingFetchJson });

    expect(result.exitCode).toBe(5);
    const payload = JSON.parse(result.stdout);
    expect(payload.code).toBe('transport');
    expect(payload.hint.code).toBe('proxy_env_not_enabled');
    expect(payload.hint.variables).toContain('NODE_USE_ENV_PROXY');
    expect(result.stdout).not.toContain('proxy.corp');
    expect(result.stdout).not.toContain('user:pass');
  });

  it('prints the hint in human-readable output without proxy values', async () => {
    vi.stubEnv('HTTPS_PROXY', proxyUrl);

    const result = await runCli(['doctor'], { fetchJson: failingFetchJson });

    expect(result.exitCode).toBe(5);
    expect(result.stderr).toContain('NODE_USE_ENV_PROXY=1');
    expect(result.stderr).not.toContain('proxy.corp');
    expect(result.stderr).not.toContain('user:pass');
  });

  it.each(['1', 'true'])(
    'adds no hint when NODE_USE_ENV_PROXY=%s already enables proxy support',
    async (value) => {
      vi.stubEnv('HTTPS_PROXY', proxyUrl);
      vi.stubEnv('NODE_USE_ENV_PROXY', value);

      const result = await runCli(['doctor', '--json'], { fetchJson: failingFetchJson });

      expect(result.exitCode).toBe(5);
      expect(JSON.parse(result.stdout)).not.toHaveProperty('hint');
    },
  );

  it('never echoes a malformed proxy URL from the underlying error', async () => {
    const malformed = 'ht!tp://bad proxy host%%';
    vi.stubEnv('HTTPS_PROXY', malformed);
    vi.stubEnv('NODE_USE_ENV_PROXY', '1');

    const result = await runCli(['doctor', '--json'], {
      fetchJson: async () => {
        throw new TypeError(`fetch failed: "${malformed}" is not a valid URL`, {
          cause: { code: 'ERR_INVALID_URL' },
        });
      },
    });

    expect(result.exitCode).toBe(5);
    const payload = JSON.parse(result.stdout);
    expect(payload.code).toBe('transport');
    expect(payload.message).toBe('Unable to load feed /api/index.json from https://slothhub.dev.');
    expect(result.stdout).not.toContain('bad proxy host');
  });

  it('hints NODE_EXTRA_CA_CERTS on TLS certificate failures', async () => {
    vi.stubEnv('NODE_EXTRA_CA_CERTS', undefined);

    const result = await runCli(['doctor', '--json'], {
      fetchJson: async () => {
        throw new TypeError('fetch failed', { cause: { code: 'SELF_SIGNED_CERT_IN_CHAIN' } });
      },
    });

    expect(result.exitCode).toBe(5);
    const payload = JSON.parse(result.stdout);
    expect(payload.hint.code).toBe('ca_bundle_env_not_set');
    expect(payload.hint.message).toContain('NODE_EXTRA_CA_CERTS');
  });

  it('reports proxy environment presence as booleans only in doctor output', async () => {
    vi.stubEnv('HTTPS_PROXY', proxyUrl);
    vi.stubEnv('HTTP_PROXY', undefined);
    vi.stubEnv('NO_PROXY', 'localhost,.internal');
    vi.stubEnv('NODE_USE_ENV_PROXY', undefined);
    vi.stubEnv('NODE_EXTRA_CA_CERTS', undefined);

    const result = await runCli(['doctor'], { fetchJson, probeFetch: okProbeFetch });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('HTTPS_PROXY set: true');
    expect(result.stdout).toContain('NO_PROXY set: true');
    expect(result.stdout).not.toContain('proxy.corp');
    expect(result.stdout).not.toContain('.internal');

    const json = await runCli(['doctor', '--json'], { fetchJson, probeFetch: okProbeFetch });
    expect(JSON.parse(json.stdout).networkEnvironment).toEqual({
      httpsProxy: true,
      httpProxy: false,
      noProxy: true,
      envProxyEnabled: false,
      nodeExtraCaCerts: false,
    });
    expect(json.stdout).not.toContain('proxy.corp');
  });
});

describe('completion', () => {
  const shells = COMPLETION_SHELLS;

  it.each(shells)('prints a static %s script without any feed fetch', async (shell) => {
    const fetchJson = vi.fn();
    const result = await runCli(['completion', shell], {fetchJson});

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it.each(shells)(
    'covers every command, subcommand, and flag from the shared table in the %s script',
    async (shell) => {
      const {stdout} = await runCli(['completion', shell], {fetchJson: vi.fn()});
      // Fish spells flags without dashes (`-l json` completes `--json`);
      // every other shell spells the flag literally.
      const token = (name: string) =>
        shell === 'fish' ? name.replace(/^-+/, '') : name;
      const word = (name: string) => {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^\\w-])${escaped}([^\\w-]|$)`, 'm');
      };

      for (const command of CLI_COMMAND_SPECS) {
        expect(stdout).toMatch(word(command.name));
        for (const subcommand of command.subcommands ?? []) {
          expect(stdout).toMatch(word(subcommand.name));
        }
      }
      for (const flag of CLI_FLAG_SPECS) {
        for (const name of flag.names) {
          expect(stdout).toMatch(word(token(name)));
        }
      }
      for (const supportedShell of shells) {
        expect(stdout).toMatch(word(supportedShell));
      }
    },
  );

  it('completes closed value sets for enum-backed flags', async () => {
    const {stdout} = await runCli(['completion', 'bash'], {fetchJson: vi.fn()});

    for (const flag of CLI_FLAG_SPECS) {
      if (!flag.values) continue;
      for (const value of flag.values) {
        expect(stdout).toContain(value);
      }
    }
  });

  it('rejects an unknown shell with a usage error and exit code 2', async () => {
    const result = await runCli(['completion', 'nushell'], {fetchJson: vi.fn()});

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('bash');
    expect(result.stderr).toContain('pwsh');
  });

  it('rejects a missing shell with a usage error and exit code 2', async () => {
    const result = await runCli(['completion'], {fetchJson: vi.fn()});

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('completion');
  });

  it('rejects extra positional arguments with a usage error', async () => {
    const result = await runCli(['completion', 'bash', 'extra'], {
      fetchJson: vi.fn(),
    });

    expect(result.exitCode).toBe(2);
  });

  it('lists completion in --help output', async () => {
    const result = await runCli(['--help'], {fetchJson: vi.fn()});

    expect(result.stdout).toContain('completion <shell>');
  });

  it('emits bash and zsh scripts that pass a syntax check when the shells are available', async () => {
    const bash = await runCli(['completion', 'bash'], {fetchJson: vi.fn()});
    const zsh = await runCli(['completion', 'zsh'], {fetchJson: vi.fn()});

    const bashCheck = spawnSync('bash', ['-n'], {input: bash.stdout});
    if ((bashCheck.error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') {
      expect(bashCheck.status).toBe(0);
    }
    const zshCheck = spawnSync('zsh', ['-n'], {input: zsh.stdout});
    if ((zshCheck.error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') {
      expect(zshCheck.status).toBe(0);
    }
  });
});

it.each([
  ['dataset', 'Dataset'],
  ['specification', 'Specification or standard'],
])('filters search to %s without dropping its feed row', async (value, label) => {
  const candidate: AgentSearchIndexTool = {...searchIndexFeed.data.tools[0]!, resourceKind: {value, label}};
  const fetchKindFeed: FetchJson = async (url) => new URL(url).pathname === '/api/search-index.json'
    ? {...searchIndexFeed, data: {...searchIndexFeed.data, tools: [candidate, searchIndexFeed.data.tools[1]!]}}
    : fetchJson(url);
  const result = await runCli(['search', '--resource-kind', value], {fetchJson: fetchKindFeed});
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain(`Resource kind: ${label} (${value})`);
  expect(result.stdout).not.toContain('Linear');
});
