import {computePersonaCostEstimates} from '@slothhub/domain/persona-cost-estimate';
import type {ToolPricingEvidence} from '@slothhub/domain/tool-pricing-evidence';
import {describe, expect, it} from 'vite-plus/test';
import {buildPublicToolQuickstarts} from '@slothhub/domain/tool-quickstart';
import {buildAgentReadiness, normalizePublicAgentInterfaces} from '@slothhub/domain/agent-interface';
import {formatTool} from './catalogFormat.js';

import {
  alternativesDetailFeed,
  alternativesFeed,
  indexFeed,
  searchIndexFeed,
  toolDetailFeed,
  toolsFeed,
} from './fixtures.js';
import {
  parseAlternativesDetailFeed,
  parseAlternativesFeed,
  parseIndexFeed,
  parseSearchIndexFeed,
  parseToolDetailFeed,
  parseToolsFeed,
} from '@slothhub/domain/public-feed-schemas';

describe('public feed command safety', () => {
  it('keeps setup evidence and unknown readiness distinct from failure in terminal detail', () => {
    const agentInterfaces = normalizePublicAgentInterfaces([{
      kind: 'mcp_client', status: 'official', docsUrl: 'https://example.com/setup', checkedAt: '2026-11-05T00:00:00Z',
      authMethod: 'none', executionCost: 'remote_free_tier', executionCostSourceUrl: 'https://example.com/pricing',
    }], {includeSetupFacts: true});
    const agentReadiness = buildAgentReadiness({slug: 'example', interfaces: agentInterfaces});
    const parsed = parseToolDetailFeed({...toolDetailFeed, version: '33.0.0', data: {...toolDetailFeed.data, agentInterfaces, agentReadiness}}, 'Cited setup');
    expect(parsed.data.agentReadiness).toEqual(agentReadiness);
    expect(parsed.data.agentInterfaces?.[0]?.setupFacts).toEqual(agentInterfaces[0]?.setupFacts);
    const output = formatTool(parsed.data);
    expect(output).toContain('Authentication method: none; execution cost: remote_free_tier');
    expect(output).toContain('S1: unknown (recheck_paused)');
    expect(output).toContain('https://example.com/pricing');
  });

  it('preserves reviewed maintenance evidence in current catalog parsing and terminal output', () => {
    const lifecycle = {releaseModel: {value: 'unknown'}, releaseLines: [], maintenanceStatus: 'reference', maintenanceEvidence: [{title: 'Archive statement', url: 'https://example.com/archive', sourceType: 'repository', checkedAt: '2026-07-01T00:00:00Z'}]};
    const parsed = parseToolDetailFeed({...toolDetailFeed, version: '33.0.0', data: {...toolDetailFeed.data, lifecycle}}, 'Reviewed maintenance');
    expect(parsed.data.lifecycle).toEqual(lifecycle);
    expect(formatTool(parsed.data)).toContain('Maintenance: Reference.');
    expect(formatTool(parsed.data)).toContain('https://example.com/archive');
  });

  it('retains numeric persona inputs and cited formulas through client parsing and text output', () => {
    const feed = toolDetailFeed;
    const pricing: ToolPricingEvidence & {currency: 'USD'} = {currency: 'USD', plans: [{
      name: 'Pro', planId: 'pro', listPrice: 12, billing: 'Per seat monthly', billingPeriod: 'month',
      costBasis: {chargeUnit: 'seat', seatLimit: 10, projectLimit: 20, includedMonthlyUsage: 100, usageUnit: 'request', overageBehavior: 'metered', unitPrice: 0.01, evidenceUrls: ['https://example.com/pricing'], checkedAt: '2026-07-01T00:00:00Z'},
    }]};
    const personaCosts = computePersonaCostEstimates(pricing, new Date('2026-07-31T00:00:00Z'));
    const pricingDetails = {...pricing, personaCosts};
    const parsed = parseToolDetailFeed({...feed, data: {...feed.data, pricingDetails}}, 'Persona pricing');
    expect(parsed.data.pricingDetails?.personaCosts).toEqual(personaCosts);
    expect(parsed.data.pricingDetails?.plans).toEqual(pricing.plans);
    const output = formatTool(parsed.data);
    expect(output).toContain('111.00 USD/month');
    expect(output).toContain('https://example.com/pricing');
    expect(output).toContain('formula');
  });

  it('retains edition and download-license evidence through parsing and terminal rendering', () => {
    const editions = [{id: 'oss', name: 'Open-source download', deploymentModel: 'local_application', sourceAvailability: 'open_source', repositoryUrl: 'https://github.com/example/tool', pricing: 'free', sourceUrl: 'https://example.com/editions', checkedAt: '2026-07-01T00:00:00Z', license: {artifactPattern: 'rtk-oss-<target>', spdxExpression: 'Apache-2.0', sourceUrl: 'https://example.com/license', checkedAt: '2026-07-01T00:00:00Z'}}];
    const parsed = parseToolDetailFeed({...toolDetailFeed, data: {...toolDetailFeed.data, editions}}, 'Editions');
    expect(parsed.data.editions).toEqual(editions);
    expect(formatTool(parsed.data)).toContain('rtk-oss-<target>');
    expect(formatTool(parsed.data)).toContain('https://example.com/license');
  });
  it('keeps named alternative notes through parsing and terminal output', () => {
    const alternativeNotes = [{
      name: 'Public alternative',
      slug: 'public',
      note: 'Compare local editing first.',
      sourceUrl: 'https://example.com/compare',
    }];
    const parsed = parseToolDetailFeed({
      ...toolDetailFeed,
      data: {...toolDetailFeed.data, alternativeNotes},
    }, 'Notes fixture');
    expect(parsed.data.alternativeNotes).toEqual(alternativeNotes);
    const output = formatTool(parsed.data);
    expect(output).toContain('Alternative notes');
    expect(output).toContain('Public alternative (public): Compare local editing first.');
    expect(output).toContain('https://example.com/compare');
    expect(output).not.toContain('tool-9f3c');
  });

  it('keeps tools without alternative notes readable', () => {
    const parsed = parseToolDetailFeed(toolDetailFeed, 'Plain tool fixture');
    expect(parsed.data).not.toHaveProperty('alternativeNotes');
    const output = formatTool(parsed.data);
    expect(output).not.toContain('Alternative notes');
  });

  it('rejects an alternative note that only carries an id or an http source', () => {
    expect(() => parseToolDetailFeed({
      ...toolDetailFeed,
      data: {...toolDetailFeed.data, alternativeNotes: [{note: 'Compare local editing first.', sourceUrl: 'https://example.com/compare'}]},
    }, 'Id-only note')).toThrow(/Invalid feed shape/);
    expect(() => parseToolDetailFeed({
      ...toolDetailFeed,
      data: {...toolDetailFeed.data, alternativeNotes: [{name: 'Public alternative', note: 'Compare local editing first.', sourceUrl: 'http://example.com/compare'}]},
    }, 'Http source')).toThrow(/Invalid feed shape/);
  });

  it('preserves companion links through feed parsing and terminal output', () => {
    const relatedTools = [{...toolDetailFeed.data, name: 'ripgrep', slug: 'ripgrep', detailUrl: 'https://slothhub.dev/tool/ripgrep'}];
    const parsed = parseToolDetailFeed({...toolDetailFeed, data: {...toolDetailFeed.data, relatedTools}}, 'Companion fixture');
    expect(parsed.data.relatedTools).toMatchObject([{name: 'ripgrep', slug: 'ripgrep', detailUrl: 'https://slothhub.dev/tool/ripgrep'}]);
    expect(formatTool(parsed.data)).toContain('often used together');
  });
  it('reads catalog 22 shortcuts and before/after code without losing either side', () => {
    const keyFeatureDetails = [
      {kind: 'shortcuts', feature: 'Keys', title: 'Keys', summary: 'Use keys.', entries: [{action: 'Copy', mac: '⌘C'}]},
      {kind: 'code', feature: 'Migrate', title: 'Migrate', summary: 'Upgrade.', mode: 'before_after', sourceUrl: 'https://example.com/docs', before: {filename: 'old.ts', language: 'typescript', code: 'oldApi()'}, after: {filename: 'new.ts', language: 'typescript', code: 'newApi()'}},
    ];
    const parsed = parseToolDetailFeed({...toolDetailFeed, version: '33.0.0', data: {...toolDetailFeed.data, keyFeatureDetails}}, 'Comparison fixture');
    expect(parsed.data.keyFeatureDetails).toEqual(keyFeatureDetails);
  });
  it('retains desktop installation guidance through parsing and terminal output', () => {
    const agentInterfaces = normalizePublicAgentInterfaces([{kind: 'desktop_app', status: 'official', operatingSystem: 'linux', downloadUrl: 'https://example.com/linux', installCommand: 'sudo snap install --classic code'}]);
    const parsed = parseToolDetailFeed({...toolDetailFeed, data: {...toolDetailFeed.data, agentInterfaces}}, 'Desktop fixture');
    expect(parsed.data.agentInterfaces).toEqual(agentInterfaces);
    const output = formatTool(parsed.data);
    expect(output).toContain('https://example.com/linux');
    expect(output).toContain('linux');
    expect(output).toContain('sudo snap install --classic code');
  });
  it('retains additive SSE metadata and explains it after feed parsing', () => {
    const agentInterfaces = normalizePublicAgentInterfaces([{
      kind: 'mcp_server', status: 'official', identifier: 'io.example/mcp',
      mcpRegistryObservation: {
        registryName: 'io.example/mcp', status: 'active', version: '1.0.0', observedAt: '2026-09-22T00:00:00.000Z',
        remotes: [{type: 'sse', url: 'https://example.com/sse'}],
      },
    }], {slug: 'example'});
    const parsed = parseToolDetailFeed({...toolDetailFeed, data: {...toolDetailFeed.data, agentInterfaces}}, 'SSE fixture');
    expect(parsed.data.agentInterfaces?.[0]?.sseOnlyRemotes).toBe(true);
    expect(formatTool(parsed.data)).toContain('published SSE only; this host recipe needs streamable HTTP');
  });
  it('drops unsigned compatibility claims at the feed boundary', () => {
    const parsed = parseToolDetailFeed({...toolDetailFeed, data: {...toolDetailFeed.data, integrations: [
      {name: 'Unsigned', slug: 'unsigned', status: 'native'},
      {name: 'Negative', slug: 'negative', status: 'incompatible'},
      {name: 'Verified', slug: 'verified', status: 'native', checkedAt: '2026-09-01T00:00:00Z', sourceUrl: 'https://example.com/evidence'},
    ]}}, 'Evidence fixture');
    expect(parsed.data.integrations?.map((fact) => fact.slug)).toEqual(['verified']);
  });
  it.each(['17.0.0', '17.2.0'])('accepts search major %s and retains the current integration contract', (version) => {
    const integrationConnection = {parameter: 'integrationConnection', values: ['native'], matchRule: 'Requires the same native integration fact.'};
    const queryContract = version === '10.0.0'
      ? {...searchIndexFeed.data.queryContract, filters: {...searchIndexFeed.data.queryContract.filters, integrationConnection}}
      : searchIndexFeed.data.queryContract;
    const parsed = parseSearchIndexFeed({...searchIndexFeed, version, data: {...searchIndexFeed.data, queryContract}}, 'Search version fixture');
    expect(parsed.version).toBe(version);
    expect(parsed.data.queryContract).toEqual(queryContract);
  });
  it('preserves YAML Actions quickstarts for CLI consumers', () => {
    const quickstarts = [{kind: 'install_command', label: 'Use GitHub Action', status: 'official', statusLabel: 'Official', command: 'uses: actions/checkout@v4', commandLanguage: 'yaml', docsUrl: 'https://github.com/actions/checkout', notice: 'Pin this action to a full commit SHA before running it.'}];
    const parsed = parseToolDetailFeed({...toolDetailFeed, data: {...toolDetailFeed.data, quickstarts}}, 'Actions fixture');
    expect(parsed.data.quickstarts).toEqual(quickstarts);
  });
  it('rejects shell syntax in search-index Tool slugs before recommending setup commands', () => {
    expect(() => parseSearchIndexFeed({
      ...searchIndexFeed,
      data: {...searchIndexFeed.data, tools: [{...searchIndexFeed.data.tools[0], slug: 'figma; malicious-command'}]},
    }, 'Unsafe slug')).toThrow(/Invalid feed shape/);
  });
  it('preserves observed license metadata and explicit unknown reasons in tool output', () => {
    const licenseFacts = [{scope: 'resource', source: 'official_website', status: 'unknown', unknownReason: 'custom', note: 'GitHub reports NOASSERTION; review scoped terms.', evidenceKind: 'repository_detection', sourceUrl: 'https://example.com/license', checkedAt: '2026-07-01T00:00:00.000Z'}];
    const parsed = parseToolDetailFeed({...toolDetailFeed, data: {...toolDetailFeed.data, licenseFacts}}, 'License fixture');
    expect(parsed.data.licenseFacts).toEqual(licenseFacts);
    expect(formatTool(parsed.data)).toContain('Unknown (custom)');
    expect(formatTool(parsed.data)).toContain('GitHub reports NOASSERTION; review scoped terms.');
    expect(formatTool(parsed.data)).toContain('not legal advice');
  });
  it('retains component license scope when reading catalog 26', () => {
    const licenseFacts = [{scope: 'repository', appliesTo: {kind: 'component', value: 'CLI'}, source: 'official_website', status: 'observed', spdxExpression: 'MIT', sourceUrl: 'https://example.com/license', checkedAt: '2026-07-01T00:00:00.000Z'}];
    const parsed = parseToolDetailFeed({...toolDetailFeed, version: '33.0.0', data: {...toolDetailFeed.data, licenseFacts}}, 'Scoped license fixture');
    expect(parsed.data.licenseFacts).toEqual(licenseFacts);
    expect(formatTool(parsed.data)).toContain('repository — component: CLI');
  });
  it('retains scoped deployment evidence and displays missing source facts honestly', () => {
    const deployment = {scope: 'Hosted edition', models: ['hosted'], sourceUrl: 'https://example.com/hosting', checkedAt: '2026-07-01T00:00:00.000Z'};
    const parsed = parseToolDetailFeed({...toolDetailFeed, data: {...toolDetailFeed.data, deployment}}, 'Deployment fixture');
    expect(parsed.data.deployment).toEqual(deployment);
    const text = formatTool(parsed.data);
    expect(text).toContain('Hosted edition');
    expect(text).toContain('Provider hosted');
    expect(text).toContain('Source availability: Not recorded');
    expect(() => parseToolDetailFeed({...toolDetailFeed, data: {...toolDetailFeed.data, deployment: {...deployment, sourceUrl: 'https://127.0.0.1/'}}}, 'Unsafe deployment')).toThrow();
  });
  it('retains and renders the additive Cursor stdio fallback and environment names', () => {
    const agentInterfaces = normalizePublicAgentInterfaces([{
      kind: 'mcp_server', status: 'official', identifier: 'com.example/mcp',
      mcpRegistryObservation: {
        registryName: 'com.example/mcp', status: 'active', version: '1.0.0', observedAt: '2026-09-22T00:00:00.000Z', remotes: [],
        packages: [{registryType: 'npm', identifier: '@example/mcp', version: '1.0.0', transport: {type: 'stdio'}, environmentVariables: [{name: 'API_TOKEN', isSecret: true}]}],
      },
    }], {slug: 'example'});
    const parsed = parseToolDetailFeed({...toolDetailFeed, data: {...toolDetailFeed.data, agentInterfaces}}, 'Stdio fixture');
    expect(parsed.data.agentInterfaces?.[0]?.stdioSetupRecipe).toEqual(agentInterfaces[0]?.stdioSetupRecipe);
    const output = formatTool(parsed.data);
    expect(output).toContain('"command": "npx"');
    expect(output).toContain('"@example/mcp@1.0.0"');
    expect(output).toContain('API_TOKEN (secret)');
    expect(output).not.toContain('Cursor setup: no confirmed');
  });

  it('retains an optional Publisher identity and rejects unsafe organization links', () => {
    const publisher = {name: 'Example Labs', slug: 'example-labs', website: 'https://example.com/', profileUrl: 'https://slothhub.dev/publishers/example-labs'};
    const feed = {...toolDetailFeed, version: '33.1.0', data: {...toolDetailFeed.data, publisher}};
    expect(parseToolDetailFeed(feed, 'Publisher detail').data.publisher).toEqual(publisher);
    expect(parseToolDetailFeed(toolDetailFeed, 'Older detail').data).not.toHaveProperty('publisher');
    expect(() => parseToolDetailFeed({...feed, data: {...feed.data, publisher: {...publisher, website: 'https://127.0.0.1/'}}}, 'Unsafe Publisher')).toThrow();
  });

  it('rejects invalid Setup Recipe host facts instead of dropping them during parsing', () => {
    expect(() => parseSearchIndexFeed({
      ...searchIndexFeed,
      data: {
        ...searchIndexFeed.data,
        tools: [{...searchIndexFeed.data.tools[0], setupRecipeHosts: ['future-host']}],
      },
    }, 'Search fixture')).toThrow(/Invalid feed shape/);
  });
  it('accepts unpriced Tools in the new catalog and search-index majors', () => {
    const {pricing: _pricing, ...unpriced} = toolDetailFeed.data;
    const detail = parseToolDetailFeed({...toolDetailFeed, version: '33.0.0', data: unpriced}, 'Unpriced detail');
    const tools = parseToolsFeed({...toolsFeed, version: '33.0.0', data: {tools: [unpriced]}}, 'Unpriced tools');
    const search = parseSearchIndexFeed({
      ...searchIndexFeed, version: '17.0.0', data: {
        ...searchIndexFeed.data,
        tools: searchIndexFeed.data.tools.map(({pricing: _pricing, ...tool}) => tool),
      },
    }, 'Unpriced search');
    expect(detail.data).not.toHaveProperty('pricing');
    expect(tools.data.tools[0]).not.toHaveProperty('pricing');
    expect(search.data.tools).toHaveLength(searchIndexFeed.data.tools.length);
    expect(search.data.tools[0]).not.toHaveProperty('pricing');
    const alternatives = parseAlternativesDetailFeed({
      ...alternativesDetailFeed,
      version: '33.0.0',
      data: {
        ...alternativesDetailFeed.data,
        alternatives: alternativesDetailFeed.data.alternatives.map(({pricing: _pricing, ...tool}) => tool),
      },
    }, 'Unpriced alternatives');
    expect(alternatives.data.alternatives).not.toHaveLength(0);
    expect(alternatives.data.alternatives[0]).not.toHaveProperty('pricing');
  });

  it('reads catalog 20 benchmark and resolved compatibility evidence', () => {
    const keyFeatureDetails = [
      {kind: 'benchmark', feature: 'Throughput', title: 'Throughput', summary: 'Illustrative results.', metric: 'Requests', value: '100', unit: 'req/s', claimant: 'vendor', sourceUrl: 'https://example.com/benchmarks', methodologyUrl: 'https://example.com/methodology', environment: {hardware: 'Documented host', version: '2.0', date: '2026-10-19'}},
      {kind: 'compatibility', feature: 'Runtime', title: 'Runtime support', summary: 'Reviewed compatibility.', rowKeys: ['bun'], rows: [{subjectKind: 'runtime', subjectName: 'Bun', environmentRange: 'Not documented', status: 'unknown', evidence: [], reviewedAt: '2026-10-19T00:00:00Z'}]},
    ];
    const parsed = parseToolDetailFeed({...toolDetailFeed, version: '33.0.0', data: {...toolDetailFeed.data, keyFeatureDetails}}, 'Evidence fixture');
    expect(parsed.data.keyFeatureDetails).toEqual(keyFeatureDetails);
  });
  it('retains validated terminal feature examples in tool detail responses', () => {
    const terminal = {kind: 'terminal', feature: 'CLI', title: 'Inspect the editor', summary: 'Check its version.', shell: 'bash', command: 'code --version\n', output: 'Example version'};
    const feed = {...toolDetailFeed, data: {...toolDetailFeed.data, keyFeatureDetails: [terminal]}};
    expect(parseToolDetailFeed(feed, 'Tool fixture').data.keyFeatureDetails).toEqual([terminal]);
    expect(() => parseToolDetailFeed({...feed, data: {...feed.data, keyFeatureDetails: [{...terminal, command: ''}]}}, 'Tool fixture')).toThrow();
  });
  it('preserves every file and variant from catalog 16.1 and rejects ambiguous choice names', () => {
    const keyFeatureDetails = [
      {feature: 'Files', title: 'Files', summary: 'Read the example.', kind: 'code', files: [{filename: 'one.ts', language: 'typescript', code: 'one();'}, {filename: 'two.ts', language: 'typescript', code: 'two();'}]},
      {feature: 'Commands', title: 'Commands', summary: 'Choose a platform.', kind: 'terminal', variants: [{label: 'macOS', shell: 'bash', command: 'brew install example'}, {label: 'Windows', shell: 'powershell', command: 'winget install example'}]},
    ];
    const feed = {...toolDetailFeed, version: '33.1.0', data: {...toolDetailFeed.data, keyFeatureDetails}};
    const parsed = parseToolDetailFeed(feed, 'Multi-example fixture');
    expect(parsed.data.keyFeatureDetails).toEqual(keyFeatureDetails);
    expect(formatTool(parsed.data)).toContain('two.ts');
    expect(formatTool(parsed.data)).toContain('winget install example');
    const files = keyFeatureDetails[0].files!;
    expect(() => parseToolDetailFeed({...feed, data: {...feed.data, keyFeatureDetails: [{...keyFeatureDetails[0], files: [files[0], {...files[1], filename: files[0].filename}]}]}}, 'Duplicate file fixture')).toThrow(/distinct filename/);
    const variants = keyFeatureDetails[1].variants!;
    expect(() => parseToolDetailFeed({...feed, data: {...feed.data, keyFeatureDetails: [{...keyFeatureDetails[1], variants: [variants[0], {...variants[1], label: variants[0].label}]}]}}, 'Duplicate variant fixture')).toThrow(/distinct label/);
  });
  it.each(['makefile', 'just', 'dockerfile', 'nix', 'ini', 'php', 'swift'])('reads catalog 16 %s examples with placeholder guidance', (language) => {
    const detail = {kind: 'code', feature: 'Setup', title: 'Setup', summary: 'Configure the tool.', language, code: 'YOUR_API_KEY', placeholderNote: 'Use a key from account settings.'};
    expect(parseToolDetailFeed({...toolDetailFeed, version: '33.0.0', data: {...toolDetailFeed.data, keyFeatureDetails: [detail]}}, 'Tool fixture').data.keyFeatureDetails).toEqual([detail]);
  });
  it('retains app command hosts and paired code references in Tool detail', () => {
    const details = [
      {kind: 'code', feature: 'File', title: 'File', summary: 'Save recipes.', language: 'text', code: 'test:'},
      {kind: 'terminal', feature: 'Run', title: 'Run', summary: 'Run recipes.', shell: 'bash', command: 'just test', pairedWith: 'File'},
      {kind: 'slash_command', feature: 'Plugin', title: 'Plugin', summary: 'Install it.', host: 'Claude Code', command: '/plugin install example'},
    ];
    expect(parseToolDetailFeed({...toolDetailFeed, data: {...toolDetailFeed.data, keyFeatureDetails: details}}, 'Tool fixture').data.keyFeatureDetails).toEqual(details);
  });
  it('retains sourced limits in the current Tool detail contract', () => {
    const limits = {kind: 'limits', feature: 'Free API', title: 'Free API', summary: 'Terms.', sourceUrl: 'https://example.com/docs', entries: [{type: 'quota', label: 'Requests', value: '10,000', unit: 'calls', period: 'day'}]};
    expect(parseToolDetailFeed({...toolDetailFeed, version: '33.0.0', data: {...toolDetailFeed.data, keyFeatureDetails: [limits]}}, 'Tool fixture').data.keyFeatureDetails).toEqual([limits]);
  });

  it('preserves future string-valued feed and snapshot keys from an additive index', () => {
    const parsed = parseIndexFeed({
      ...indexFeed,
      feeds: {...indexFeed.feeds, futureFeed: 'https://slothhub.dev/api/future.json'},
      snapshots: {
        ...indexFeed.snapshots,
        futureSnapshot: 'https://slothhub.dev/api/future.snapshot.json',
      },
    }, 'Index fixture');

    expect(parsed.feeds.futureFeed).toBe('https://slothhub.dev/api/future.json');
    expect(parsed.snapshots.futureSnapshot).toBe('https://slothhub.dev/api/future.snapshot.json');
  });

  it('rejects future feed and snapshot keys whose values are not strings', () => {
    expect(() => parseIndexFeed({
      ...indexFeed,
      feeds: {...indexFeed.feeds, futureFeed: {url: 'https://slothhub.dev/api/future.json'}},
    }, 'Index fixture')).toThrow(/Invalid feed shape/u);
    expect(() => parseIndexFeed({
      ...indexFeed,
      snapshots: {
        ...indexFeed.snapshots,
        futureSnapshot: {url: 'https://slothhub.dev/api/future.snapshot.json'},
      },
    }, 'Index fixture')).toThrow(/Invalid feed shape/u);
  });

  it('rejects blank advertised URLs instead of silently omitting them', () => {
    expect(() => parseIndexFeed({
      ...indexFeed,
      feeds: {...indexFeed.feeds, futureFeed: ''},
    }, 'Index fixture')).toThrow(/Invalid feed shape/u);
    expect(() => parseIndexFeed({
      ...indexFeed,
      snapshots: {...indexFeed.snapshots, futureSnapshot: ''},
    }, 'Index fixture')).toThrow(/Invalid feed shape/u);
  });

  it.each(['99.0.0', '1.01.0', '1.0.00', '1.not-semver'])(
    'rejects unsupported default feed version %s',
    (version) => {
      expect(() =>
        parseToolDetailFeed({...toolDetailFeed, version}, 'Tool detail fixture'),
      ).toThrow(/Invalid feed shape/);
    },
  );

  it.each(['1.9.9', '2.01.0', '2.1.00', '99.0.0', '2.not-semver', '2.2.0\u001b[31m'])(
    'rejects unsupported search-index version %s',
    (version) => {
    expect(() => parseSearchIndexFeed({...searchIndexFeed, version}, 'Search fixture')).toThrow(
      /Invalid feed shape/,
    );
    },
  );

  it('accepts a 2.x search-index feed without the deprecated tokens and fields projections', () => {
    const withoutDeprecatedSearch = {
      ...searchIndexFeed,
      version: '17.2.0',
      data: {
        ...searchIndexFeed.data,
        tools: searchIndexFeed.data.tools.map((tool) => {
          const {tokens: _tokens, fields: _fields, ...search} = tool.search;
          return {...tool, search};
        }),
      },
    };

    const parsed = parseSearchIndexFeed(withoutDeprecatedSearch, 'Search fixture');
    expect(parsed.data.tools).toHaveLength(searchIndexFeed.data.tools.length);
    expect(parsed.data.tools[0]!.search.text).toBe(searchIndexFeed.data.tools[0]!.search.text);
  });

  it('rejects malformed freshness timestamps and duplicate Tool slugs', () => {
    expect(() => parseSearchIndexFeed({
      ...searchIndexFeed,
      data: {
        ...searchIndexFeed.data,
        tools: [{...searchIndexFeed.data.tools[0]!, freshness: {verifiedAt: 'not-a-date'}}],
      },
    }, 'Search fixture')).toThrow(/Invalid feed shape/);
    expect(() => parseSearchIndexFeed({
      ...searchIndexFeed,
      data: {...searchIndexFeed.data, tools: [searchIndexFeed.data.tools[0]!, searchIndexFeed.data.tools[0]!]},
    }, 'Search fixture')).toThrow(/Invalid feed shape/);
    expect(() => parseToolsFeed({
      ...toolsFeed,
      data: {
        tools: [{
          ...toolsFeed.data.tools[0]!,
          freshness: {isVerified: true, verifiedAt: '2026-07-09T00:00:00.000Z'},
        }],
      },
    }, 'Tools fixture')).toThrow(/data\.tools\.0\.freshness\.verifiedAt/);
  });

  it('accepts legacy verification combinations and reports data-relative temporal paths', () => {
    expect(parseToolDetailFeed({
      ...toolDetailFeed,
      data: {...toolDetailFeed.data, freshness: {isVerified: true}},
    }, 'Tool detail fixture').data.freshness).toEqual({isVerified: false});
    expect(parseToolDetailFeed({
      ...toolDetailFeed,
      data: {
        ...toolDetailFeed.data,
        freshness: {isVerified: false, verifiedAt: '2026-07-07T00:00:00.000Z'},
      },
    }, 'Tool detail fixture').data.freshness).toEqual({
      isVerified: false,
      verifiedAt: '2026-07-07T00:00:00.000Z',
    });
    expect(() => parseToolDetailFeed({
      ...toolDetailFeed,
      data: {
        ...toolDetailFeed.data,
        freshness: {isVerified: false, verifiedAt: 'not-a-date'},
      },
    }, 'Tool detail fixture')).toThrow(/Invalid feed shape/);
    expect(() => parseToolDetailFeed({
      ...toolDetailFeed,
      data: {
        ...toolDetailFeed.data,
        freshness: {isVerified: true, verifiedAt: '2026-07-09T00:00:00.000Z'},
      },
    }, 'Tool detail fixture')).toThrow(/data\.freshness\.verifiedAt/);

    const unsafeResource = {
      label: 'Unsafe docs',
      url: 'https://user:secret@example.com/docs',
      kind: 'official_docs' as const,
      isOfficial: true,
    };
    expect(() => parseToolDetailFeed({
      ...toolDetailFeed,
      data: {...toolDetailFeed.data, resourceLinks: [unsafeResource]},
    }, 'Tool detail fixture')).toThrow(/Invalid feed shape/);

    const resource = toolDetailFeed.data.resourceLinks?.[0];
    if (!resource) throw new Error('Expected a Resource Link fixture.');
    expect(() => parseToolDetailFeed({
      ...toolDetailFeed,
      data: {...toolDetailFeed.data, resourceLinks: [resource, resource]},
    }, 'Tool detail fixture')).toThrow(/Invalid feed shape/);

    expect(() => parseToolDetailFeed({
      ...toolDetailFeed,
      data: {
        ...toolDetailFeed.data,
        resourceLinks: [{...resource, checkedAt: '2026-07-09T00:00:00.000Z'}],
      },
    }, 'Tool detail fixture')).toThrow(/data\.resourceLinks\.0\.checkedAt/);

    expect(() => parseToolDetailFeed({
      ...toolDetailFeed,
      data: {
        ...toolDetailFeed.data,
        resourceIdentity: {
          ...toolDetailFeed.data.resourceIdentity,
          canonicalUrl: 'http://127.0.0.1/admin',
        },
      },
    }, 'Tool detail fixture')).toThrow(/Invalid feed shape/);

    expect(() => parseToolDetailFeed({
      ...toolDetailFeed,
      data: {
        ...toolDetailFeed.data,
        resourceIdentity: {
          ...toolDetailFeed.data.resourceIdentity,
          kind: 'unrecognized_identity_kind',
        },
      },
    }, 'Tool detail fixture')).toThrow(/Invalid feed shape/);
  });

  it('accepts source-backed trial terms and rejects unrecognized vocabulary', () => {
    const parsed = parseToolDetailFeed({
      ...toolDetailFeed,
      data: {
        ...toolDetailFeed.data,
        pricingDetails: {
          trialAvailability: 'available',
          trialTerms: {
            planName: 'Pro',
            eligibility: 'sales_assisted',
            duration: '30 days',
            cardRequirement: 'required',
            endBehavior: 'converts_to_paid',
            evidence: [{
              title: 'Trial terms',
              url: 'https://example.com/trial',
              sourceType: 'official_docs',
              checkedAt: '2026-07-20T00:00:00.000Z',
            }],
            reviewedAt: '2026-07-22T00:00:00.000Z',
          },
        },
      },
    }, 'Tool detail fixture');
    expect(parsed.data.pricingDetails?.trialTerms?.cardRequirement).toBe('required');

    expect(() => parseToolDetailFeed({
      ...toolDetailFeed,
      data: {
        ...toolDetailFeed.data,
        pricingDetails: {
          trialAvailability: 'available',
          trialTerms: {cardRequirement: 'sometimes'},
        },
      },
    }, 'Tool detail fixture')).toThrow(/Invalid feed shape/);
  });

  it('retains richer pricing through feed parsing and terminal output', () => {
    const pricingDetails = {currency: 'USD', plans: [{name: 'Pro', listPrice: 25, promoPrice: 18, billing: 'monthly', promoNote: 'First year only'}], usageAddOns: [{unit: '1,000 credits', rate: 2.5, billing: 'overage'}]};
    const parsed = parseToolDetailFeed({...toolDetailFeed, data: {...toolDetailFeed.data, pricingDetails}}, 'Pricing fixture');
    expect(parsed.data.pricingDetails).toEqual(pricingDetails);
    expect(formatTool(parsed.data)).toContain('Usage add-on: 2.5 USD per 1,000 credits; overage');
  });

  it('parses a custom plan without a list price and renders it as Custom', () => {
    const pricingDetails = {currency: 'USD' as const, plans: [{name: 'Enterprise', priceType: 'custom' as const, billing: 'Custom, contact sales'}]};
    const parsed = parseToolDetailFeed({...toolDetailFeed, data: {...toolDetailFeed.data, pricingDetails}}, 'Custom pricing fixture');
    expect(parsed.data.pricingDetails).toEqual(pricingDetails);
    const output = formatTool(parsed.data);
    expect(output).toContain('Plan Enterprise: Custom; Custom, contact sales');
    expect(output).not.toContain('undefined');
    expect(output).not.toContain('list 0');
  });

  it('accepts optional Article entries and rejects malformed ones', () => {
    const articles = [
      {
        title: 'Ship MCP servers safely',
        slug: 'ship-mcp-servers-safely',
        excerpt: 'A guide to publishing an MCP server agents can trust.',
        publishedAt: '2026-08-01T09:00:00.000Z',
        url: 'https://slothhub.dev/articles/ship-mcp-servers-safely',
      },
    ];

    const parsed = parseSearchIndexFeed(
      {
        ...searchIndexFeed,
        version: '17.2.0',
        data: {...searchIndexFeed.data, articles},
      },
      'Search fixture',
    );
    expect(parsed.data.articles).toEqual(articles);

    expect(() =>
      parseSearchIndexFeed(
        {
          ...searchIndexFeed,
          version: '17.2.0',
          data: {
            ...searchIndexFeed.data,
            articles: [{title: 'Missing slug'}],
          },
        },
        'Search fixture',
      ),
    ).toThrow(/Invalid feed shape/);

    expect(() =>
      parseSearchIndexFeed(
        {
          ...searchIndexFeed,
          version: '17.2.0',
          data: {
            ...searchIndexFeed.data,
            articles: [
              {
                title: 'Unsafe link',
                slug: 'unsafe-link',
                url: 'javascript:alert(1)',
              },
            ],
          },
        },
        'Search fixture',
      ),
    ).toThrow(/Invalid feed shape/);
  });

  it('keeps schema-compatible legacy taxonomy references readable', () => {
    expect(() =>
      parseToolDetailFeed(
        {
          ...toolDetailFeed,
          data: {
            ...toolDetailFeed.data,
            useCases: [{name: 'Legacy workflow', slug: 'legacy_workflow'}],
          },
        },
        'Tool detail fixture',
      ),
    ).not.toThrow();
  });

  it.each([
    ['url', 'javascript:alert(1)'],
    ['url', 'https://slothhub.dev/tool/figma/updates\u2028forged'],
    ['changedAt', 'not-a-date'],
  ] as const)('rejects unsafe pricing-history %s values', (field, value) => {
    const pricingHistory = {
      url: 'https://slothhub.dev/tool/figma/updates',
      latestValidatedChange: {
        previous: 'free',
        current: 'paid',
        changedAt: '2026-08-25T19:00:00.000Z',
      },
    };
    if (field === 'url') pricingHistory.url = value;
    else pricingHistory.latestValidatedChange.changedAt = value;

    expect(() => parseToolDetailFeed({
      ...toolDetailFeed,
      data: {...toolDetailFeed.data, pricingHistory},
    }, 'Tool detail fixture')).toThrow(/Invalid feed shape/);
  });

  it.each([
    'http://localhost:4321/tool/figma/updates',
    'http://127.0.0.1:4321/tool/figma/updates',
  ])('accepts a supported local pricing-history URL %s', (url) => {
    expect(() => parseToolDetailFeed({
      ...toolDetailFeed,
      data: {
        ...toolDetailFeed.data,
        pricingHistory: {
          url,
          latestValidatedChange: {
            previous: 'free',
            current: 'paid',
            changedAt: '2026-08-25T19:00:00.000Z',
          },
        },
      },
    }, 'Tool detail fixture')).not.toThrow();
  });

  it('preserves the closed Resource Relationship contract in Tool details', () => {
    const relationship = {
      kind: 'docs_for',
      direction: 'incoming',
      label: 'Documentation',
      target: {
        id: 'tool-docs',
        name: 'Linear docs',
        slug: 'linear-docs',
        canonicalUrl: 'https://linear.app/docs',
        resourceKind: {value: 'guide_or_website', label: 'Guide or website'},
      },
    } as const;
    const feed = {
      ...toolDetailFeed,
      data: {...toolDetailFeed.data, resourceRelationships: [relationship]},
    };

    expect(parseToolDetailFeed(feed, 'Tool detail fixture').data.resourceRelationships).toEqual([
      relationship,
    ]);
    expect(() =>
      parseToolDetailFeed(
        {
          ...feed,
          data: {
            ...feed.data,
            resourceRelationships: [{...relationship, kind: 'depends_on'}],
          },
        },
        'Tool detail fixture',
      ),
    ).toThrow(/Invalid feed shape/);
    expect(() =>
      parseToolDetailFeed(
        {
          ...feed,
          data: {
            ...feed.data,
            resourceRelationships: [{...relationship, label: 'MCP server for'}],
          },
        },
        'Tool detail fixture',
      ),
    ).toThrow(/Invalid feed shape/);

    for (const canonicalUrl of [
      'javascript:alert(1)',
      'https://user:secret@example.com/docs',
      'http://127.0.0.1/docs',
      'https://example.com/\nspoofed',
      'https://example.com/\u202Espoofed',
    ]) {
      expect(() =>
        parseToolDetailFeed(
          {
            ...feed,
            data: {
              ...feed.data,
              resourceRelationships: [
                {...relationship, target: {...relationship.target, canonicalUrl}},
              ],
            },
          },
          'Tool detail fixture',
        ),
      ).toThrow(/Invalid feed shape/);
    }
  });

  it.each([
    'npm install safe-package\u202E --global',
    'npm install safe-package\u001b[31m',
  ])('rejects unsafe quickstart command %j', (command) => {
    expect(() => parseToolDetailFeed({
      ...toolDetailFeed,
      data: {
        ...toolDetailFeed.data,
        quickstarts: [{
          kind: 'install_command',
          label: 'Install CLI',
          status: 'official',
          statusLabel: 'Official',
          command,
          commandLanguage: 'shell',
        }],
      },
    }, 'Tool detail fixture')).toThrow(/Invalid feed shape/);
  });

  it.each([undefined, ['mcp_server', 'cli']])('retains optional alternative interface facts: %j', (agentInterfaceKinds) => {
    const feed = {...alternativesDetailFeed, data: {...alternativesDetailFeed.data,
      alternatives: alternativesDetailFeed.data.alternatives.map((tool) => ({...tool, agentInterfaceKinds})),
    }};
    const parsed = parseAlternativesDetailFeed(feed, 'Alternative interface facts');
    expect(parsed.data.alternatives[0]?.agentInterfaceKinds).toEqual(agentInterfaceKinds);
    expect(() => parseAlternativesDetailFeed({...feed, data: {...feed.data,
      alternatives: feed.data.alternatives.map((tool) => ({...tool, agentInterfaceKinds: ['invented_kind']})),
    }}, 'Invalid alternative interface')).toThrow();
  });

  it('parses the allowlisted alternatives list and detail contracts', () => {
    const list = parseAlternativesFeed(alternativesFeed, 'Alternatives fixture');
    const detail = parseAlternativesDetailFeed(
      alternativesDetailFeed,
      'Alternatives detail fixture',
    );

    expect(list.data.sets[0]).toMatchObject({
      slug: 'figma',
      alternativesUrl: 'https://slothhub.dev/tool/figma#alternatives-tools-heading',
      alternatives: [expect.objectContaining({slug: 'linear'})],
    });
    expect(detail.data).toMatchObject({
      slug: 'figma',
      sourceTool: expect.objectContaining({slug: 'figma'}),
    });
    expect(list.data.sets[0]?.alternatives[0]).not.toHaveProperty('integrations');
  });

  it.each([
    'https://evil.example/alternatives/figma',
    'https://slothhub.dev/alternatives/linear',
    'https://slothhub.dev/alternatives/figma?tracked=true',
    'https://slothhub.dev/alternatives/figma#unexpected',
  ])('rejects unsafe alternatives citation %s', (alternativesUrl) => {
    expect(() => parseAlternativesDetailFeed({
      ...alternativesDetailFeed,
      data: {...alternativesDetailFeed.data, alternativesUrl},
    }, 'Unsafe legacy citation')).toThrow(/canonical citation/);
  });

  it('accepts safe multiline alternatives prose', () => {
    const comparisonFacts = {
      bestFor: ['Design systems\nwith shared libraries'],
      pricingNotes: 'Free starter plan\nPaid organization plans',
    };
    const parsed = parseAlternativesDetailFeed({
      ...alternativesDetailFeed,
      data: {
        ...alternativesDetailFeed.data,
        description: 'Collaborative design\nfor distributed teams',
        comparisonFacts,
      },
    }, 'Alternatives detail fixture');

    expect(parsed.data).toMatchObject({
      description: 'Collaborative design\nfor distributed teams',
      comparisonFacts,
    });
  });

  it('rejects unsafe alternatives text and non-http canonical URLs', () => {
    expect(() => parseAlternativesFeed({
      ...alternativesFeed,
      data: {
        ...alternativesFeed.data,
        sets: [{...alternativesFeed.data.sets[0]!, name: 'Unsafe\u202e name'}],
      },
    }, 'Alternatives fixture')).toThrow(/Invalid feed shape/);
    expect(() => parseAlternativesDetailFeed({
      ...alternativesDetailFeed,
      data: {...alternativesDetailFeed.data, alternativesUrl: 'javascript:alert(1)'},
    }, 'Alternatives detail fixture')).toThrow(/Invalid feed shape/);
    expect(() => parseAlternativesDetailFeed({
      ...alternativesDetailFeed,
      data: {
        ...alternativesDetailFeed.data,
        alternativesUrl: 'https://slothhub.dev/go/figma?surface=agent',
      },
    }, 'Alternatives detail fixture')).toThrow(/must not use tracked \/go\//);
    expect(() => parseAlternativesDetailFeed({
      ...alternativesDetailFeed,
      data: {
        ...alternativesDetailFeed.data,
        alternatives: [{
          ...alternativesDetailFeed.data.alternatives[0]!,
          detailUrl: 'javascript:alert(1)',
        }],
      },
    }, 'Alternatives detail fixture')).toThrow(/absolute http/);
  });

  it.each([
    ['name', {
      ...alternativesDetailFeed.data.alternatives[0]!,
      name: 'Linear\u202e disguised',
    }],
    ['description', {
      ...alternativesDetailFeed.data.alternatives[0]!,
      description: 'Issue tracking\u0007 for teams',
    }],
    ['pricing', {
      ...alternativesDetailFeed.data.alternatives[0]!,
      pricing: 'paid\u202e disguised',
    }],
    ['platform', {
      ...alternativesDetailFeed.data.alternatives[0]!,
      platforms: ['web\u0007'],
    }],
  ])('rejects unsafe nested alternative %s text', (_field, alternative) => {
    expect(() => parseAlternativesDetailFeed({
      ...alternativesDetailFeed,
      data: {
        ...alternativesDetailFeed.data,
        alternatives: [alternative],
      },
    }, 'Alternatives detail fixture')).toThrow(/control or bidi characters/);
  });

  it.each([
    ['foreign set origin', {
      ...alternativesDetailFeed.data,
      detailUrl: 'https://evil.example/tool/figma',
    }],
    ['private set origin', {
      ...alternativesDetailFeed.data,
      detailUrl: 'http://127.0.0.1/tool/figma',
    }],
    ['wrong set path', {
      ...alternativesDetailFeed.data,
      detailUrl: 'https://slothhub.dev/tool/linear',
    }],
    ['wrong alternatives fragment', {
      ...alternativesDetailFeed.data,
      alternativesUrl: 'https://slothhub.dev/tool/figma#unrelated-section',
    }],
    ['missing alternatives fragment', {
      ...alternativesDetailFeed.data,
      alternativesUrl: 'https://slothhub.dev/tool/figma',
    }],
    ['alternatives query string', {
      ...alternativesDetailFeed.data,
      alternativesUrl: 'https://slothhub.dev/tool/figma?tracked=true#alternatives-tools-heading',
    }],
    ['unexpected detail fragment', {
      ...alternativesDetailFeed.data,
      detailUrl: 'https://slothhub.dev/tool/figma#alternatives-tools-heading',
    }],
    ['foreign nested origin', {
      ...alternativesDetailFeed.data,
      alternatives: [{
        ...alternativesDetailFeed.data.alternatives[0]!,
        detailUrl: 'https://evil.example/tool/linear',
      }],
    }],
    ['tracked encoded path', {
      ...alternativesDetailFeed.data,
      detailUrl: 'https://slothhub.dev/%67o/figma',
    }],
  ])('rejects noncanonical alternatives citation: %s', (_label, data) => {
    expect(() => parseAlternativesDetailFeed({
      ...alternativesDetailFeed,
      data,
    }, 'Alternatives detail fixture')).toThrow(/canonical citation/);
  });

  it.each([
    ['uppercase set slug', {
      ...alternativesFeed,
      data: {
        ...alternativesFeed.data,
        sets: [{
          ...alternativesFeed.data.sets[0]!,
          slug: 'Figma',
          detailUrl: 'https://slothhub.dev/tool/Figma',
          alternativesUrl: 'https://slothhub.dev/tool/Figma#alternatives-tools-heading',
          markdownUrl: 'https://slothhub.dev/alternatives/Figma.md',
          jsonUrl: 'https://slothhub.dev/api/alternatives/Figma.json',
        }],
      },
    }],
    ['path-like nested slug', {
      ...alternativesFeed,
      data: {
        ...alternativesFeed.data,
        sets: [{
          ...alternativesFeed.data.sets[0]!,
          alternatives: [{
            ...alternativesFeed.data.sets[0]!.alternatives[0]!,
            slug: '../linear',
            detailUrl: 'https://slothhub.dev/tool/..%2Flinear',
          }],
        }],
      },
    }],
  ])('rejects %s before advertising it', (_label, feed) => {
    expect(() => parseAlternativesFeed(feed, 'Alternatives fixture')).toThrow(
      /canonical public Tool slug/,
    );
  });

  it('accepts canonical citations below a path-mounted site URL', () => {
    const baseUrl = 'http://localhost:4321/catalog';
    const set = alternativesDetailFeed.data;
    const detail = {
      ...alternativesDetailFeed,
      siteUrl: baseUrl,
      data: {
        ...set,
        detailUrl: `${baseUrl}/tool/${set.slug}`,
        alternativesUrl: `${baseUrl}/tool/${set.slug}#alternatives-tools-heading`,
        markdownUrl: `${baseUrl}/alternatives/${set.slug}.md`,
        jsonUrl: `${baseUrl}/api/alternatives/${set.slug}.json`,
        alternatives: set.alternatives.map((tool) => ({
          ...tool,
          detailUrl: `${baseUrl}/tool/${tool.slug}`,
        })),
        sourceTool: {
          ...set.sourceTool,
          detailUrl: `${baseUrl}/tool/${set.sourceTool.slug}`,
        },
      },
    };

    expect(() => parseAlternativesDetailFeed(
      detail,
      'Path-mounted alternatives detail fixture',
    )).not.toThrow();
  });

  it('rejects inconsistent or duplicate alternatives identities', () => {
    const firstSet = alternativesFeed.data.sets[0]!;
    expect(() => parseAlternativesFeed({
      ...alternativesFeed,
      data: {
        ...alternativesFeed.data,
        sets: [{...firstSet, alternativeCount: firstSet.alternativeCount + 1}],
      },
    }, 'Alternatives fixture')).toThrow(/alternativeCount must match alternatives length/);
    expect(() => parseAlternativesFeed({
      ...alternativesFeed,
      data: {
        ...alternativesFeed.data,
        sets: [{
          ...firstSet,
          alternativeCount: 2,
          alternatives: [firstSet.alternatives[0]!, firstSet.alternatives[0]!],
        }],
      },
    }, 'Alternatives fixture')).toThrow(/Alternative slugs must be unique/);
    expect(() => parseAlternativesFeed({
      ...alternativesFeed,
      data: {
        ...alternativesFeed.data,
        sets: [{
          ...firstSet,
          alternativeCount: 1,
          alternatives: [{
            ...firstSet.alternatives[0]!,
            slug: firstSet.slug,
            detailUrl: firstSet.detailUrl,
          }],
        }],
      },
    }, 'Alternatives fixture')).toThrow(/must not include the source Tool/);
  });

it('accepts legitimate quickstart commands and guidance', () => {
    const parsed = parseToolDetailFeed({
      ...toolDetailFeed,
      data: {
        ...toolDetailFeed.data,
        freshness: {
          ...toolDetailFeed.data.freshness,
          lastUpdated: '2026-07-01T00:00:00.000Z',
        },
        fitGuidance: {
          bestFor: ['Product teams'],
          notIdealFor: [],
          keyTradeoffs: [],
          primaryDecisionCriteria: ['Setup speed'],
          recommendedNextStep: 'Open the official docs.',
        },

        quickstarts: [{
          kind: 'install_command',
          label: 'Install CLI',
          status: 'official',
          statusLabel: 'Official',
          command: 'npm install -g example-cli',
          commandLanguage: 'shell',
        }],
      },
    }, 'Tool detail fixture');

    for (const fitGuidance of [
      {
        bestFor: [],
        notIdealFor: [],
        keyTradeoffs: [],
        primaryDecisionCriteria: [],
      },
      {
        bestFor: [],
        notIdealFor: [],
        keyTradeoffs: [],
        setupComplexity: 'unknown',
        setupComplexityLabel: 'Unknown',
        primaryDecisionCriteria: [],
      },
      {
        bestFor: Array.from({length: 7}, (_, index) => `Team ${index}`),
        notIdealFor: [],
        keyTradeoffs: [],
        primaryDecisionCriteria: [],
      },
      {
        bestFor: ['Product teams'],
        notIdealFor: [],
        keyTradeoffs: [],
        primaryDecisionCriteria: [],
        reviewedAt: '2099-01-01T00:00:00.000Z',
      },
      {
        bestFor: ['Product teams'],
        notIdealFor: [],
        keyTradeoffs: [],
        setupComplexity: 'low',
        setupComplexityLabel: 'Easy',
        primaryDecisionCriteria: [],
      },
    ]) {
      expect(() =>
        parseToolDetailFeed(
          {
            ...toolDetailFeed,
            data: {...toolDetailFeed.data, fitGuidance},
          },
          'Tool detail fixture',
        ),
      ).toThrow(/Invalid feed shape/);
    }
  });
});

it('reads generated installs and capability effects through CLI parsing and output', () => {
  const keyFeatureDetails = [
    {kind: 'install', feature: 'Install', title: 'Install', summary: 'Add a package.', ecosystem: 'js', packageName: 'valibot', managers: ['npm'], commands: [{manager: 'npm', command: 'npm install valibot'}], sourceUrl: 'https://example.com/docs', checkedAt: '2026-10-20T00:00:00Z'},
    {kind: 'capability_list', feature: 'Tools', title: 'Tools', summary: 'Exposed tools.', listKind: 'mcp_tool', count: 1, items: [{name: 'delete_file', description: 'Delete a file.', effect: 'destructive'}], sourceUrl: 'https://example.com/docs', checkedAt: '2026-10-20T00:00:00Z'},
  ];
  const parsed = parseToolDetailFeed({...toolDetailFeed, version: '33.0.0', data: {...toolDetailFeed.data, keyFeatures: ['Install', 'Tools'], keyFeatureDetails}}, 'Install and capability fixture');
  expect(parsed.data.keyFeatureDetails).toEqual(keyFeatureDetails);
  expect(formatTool(parsed.data)).toContain('npm install valibot');
  expect(formatTool(parsed.data)).toContain('`delete_file` — Destructive');
});

it('reads catalog 21 reference and permission facts through CLI parsing and output', () => {
  const keyFeatureDetails = [
    {kind: 'reference', feature: 'Config', title: 'Config', summary: 'Configure a prefix.', tableKind: 'config', sourceUrl: 'https://example.com/docs', checkedAt: '2026-10-20T00:00:00Z', rows: [{name: 'prefix', default: '', description: 'Output prefix.'}]},
    {kind: 'permissions', sourceUrl: 'https://example.com/docs', checkedAt: '2026-10-20T00:00:00Z', feature: 'Access', title: 'Access', summary: 'Requested permissions.', model: 'oauth', entries: [{permission: 'repo', required: false}]},
  ];
  const parsed = parseToolDetailFeed({...toolDetailFeed, version: '33.0.0', data: {...toolDetailFeed.data, keyFeatures: ['Config', 'Access'], keyFeatureDetails}}, 'Structured feature fixture');
  expect(parsed.data.keyFeatureDetails).toEqual(keyFeatureDetails);
  expect(() => parseToolDetailFeed({...toolDetailFeed, version: '33.0.0', data: {...toolDetailFeed.data, keyFeatureDetails: keyFeatureDetails.map(({checkedAt: _checkedAt, ...unchecked}) => unchecked)}}, 'Unchecked features')).toThrow();
  expect(formatTool(parsed.data)).toContain('`prefix`');
  expect(formatTool(parsed.data)).toContain('`repo` — Optional');
});

it('retains UI component handoff through the CLI feed parser and output', () => {
  const uiComponent = {sourceUrl: 'https://example.com/button', authorName: 'Example studio', original: false, license: 'MIT', licenseUrl: 'https://example.com/LICENSE', frameworks: ['React'], dependencies: ['motion'], variants: ['Dark'], prompt: 'Build a button.', previewImageUrl: 'https://cdn.sanity.io/images/project/production/button.png', previewAlt: 'Blue button'};
  const parsed = parseToolDetailFeed({...toolDetailFeed, version: '33.0.0', data: {...toolDetailFeed.data, resourceKind: {value: 'ui_component', label: 'UI component'}, uiComponent}}, 'UI component fixture');
  expect(parsed.data.uiComponent).toEqual(uiComponent);
  expect(formatTool(parsed.data)).toContain('Build a button.');
  expect(formatTool(parsed.data)).toContain('https://example.com/LICENSE');
});

it('reads generic image interfaces and quickstarts in catalog 18', () => {
  const agentInterfaces = normalizePublicAgentInterfaces([{kind: 'sdk', source: 'container_registry', status: 'official', identifier: 'docker.gitea.com/gitea'}]);
  const quickstarts = buildPublicToolQuickstarts({agentInterfaces});
  const parsed = parseToolDetailFeed({...toolDetailFeed, version: '33.0.0', data: {...toolDetailFeed.data, agentInterfaces, quickstarts}}, 'Generic registry fixture');
  expect(parsed.data.agentInterfaces).toEqual(agentInterfaces);
  expect(parsed.data.quickstarts).toEqual(quickstarts);
});

it('reads catalog 24 package evidence and SVG examples', () => {
  const sourceReferences = [{title: 'Registry', url: 'https://registry.npmjs.org/example/latest', sourceType: 'package_registry'}];
  const keyFeatureDetails = [{kind: 'code', feature: 'Icon', title: 'Icon', summary: 'Renders an icon.', language: 'svg', code: '<svg />'}];
  const parsed = parseToolDetailFeed({...toolDetailFeed, version: '33.0.0', data: {...toolDetailFeed.data, sourceReferences, keyFeatures: ['Icon'], keyFeatureDetails}}, 'Catalog 24 fixture');
  expect(parsed.data.sourceReferences).toEqual(sourceReferences);
  expect(parsed.data.keyFeatureDetails).toEqual(keyFeatureDetails);
  expect(formatTool(parsed.data)).toContain('<svg />');
});

it('reads Search Index 13 trial evidence without discarding its source type', () => {
  const tool = searchIndexFeed.data.tools[0];
  if (!tool) throw new Error('Expected a search fixture');
  const evidence = [{title: 'Trial terms', url: 'https://example.com/trial', sourceType: 'official_site', checkedAt: '2026-07-01T00:00:00Z'}];
  const parsed = parseSearchIndexFeed({...searchIndexFeed, version: '17.0.0', data: {...searchIndexFeed.data, tools: [{...tool,
    pricingDetails: {trialAvailability: 'available', trialTerms: {planName: 'Trial', evidence, reviewedAt: '2026-07-02T00:00:00Z'}},
  }]}}, '/api/search-index.json');
  expect(parsed.data.tools[0]?.pricingDetails?.trialTerms?.evidence).toEqual(evidence);
});

it.each([
  ['dataset', 'Dataset'],
  ['specification', 'Specification or standard'],
])('retains %s through public JSON parsing and terminal detail', (value, label) => {
  const parsed = parseToolDetailFeed({...toolDetailFeed, data: {...toolDetailFeed.data, resourceKind: {value, label}}}, 'Resource kind fixture');
  expect(parsed.data.resourceKind).toEqual({value, label});
  expect(formatTool(parsed.data)).toContain(`Resource kind: ${label} (${value})`);
});

it('retains cited unrelated registry packages separately from Tool install identities', () => {
  const excludedRegistryIdentities = [{source: 'npm', identifier: 'archify', sourceUrl: 'https://www.npmjs.com/package/archify', checkedAt: '2026-11-05T00:00:00Z'}]
  expect(parseToolDetailFeed({...toolDetailFeed, data: {...toolDetailFeed.data, excludedRegistryIdentities}}, 'Unrelated package').data.excludedRegistryIdentities).toEqual(excludedRegistryIdentities)
})
