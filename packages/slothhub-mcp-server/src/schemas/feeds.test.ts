import {computePersonaCostEstimates} from '@slothhub/domain/persona-cost-estimate';
import type {ToolPricingEvidence} from '@slothhub/domain/tool-pricing-evidence';
import {installModuleFakes} from '../test/moduleFakes.js';
import * as moduleFakeTarget1 from '@slothhub/domain/runtime-requirements';
import {describe, expect, it, vi} from 'vite-plus/test';
import {buildPublicToolQuickstarts} from '@slothhub/domain/tool-quickstart';
import {normalizePublicAgentInterfaces} from '@slothhub/domain/agent-interface';
import {MAX_PUBLIC_SOURCE_REFERENCE_URL_LENGTH} from '@slothhub/domain/source-reference';
import {formatToolMarkdown} from '../tools/markdown.js';

import {
  bestFeedSchema,
  categoriesFeedSchema,
  indexFeedSchema,
  runtimeRequirementSchema,
  runtimeRequirementsSchema,
  stacksFeedSchema,
  toolDetailFeedSchema,
  toolsFeedSchema,
  useCasesFeedSchema,
} from '@slothhub/domain/public-feed-mcp-schemas';

const additiveIndexFixture = {
  version: '33.0.0',
  siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-08-29T00:00:00.000Z',
  schemaUrl: 'https://slothhub.dev/api/schema.json',
  snapshots: {
    full: 'https://slothhub.dev/api/catalog.snapshot.json',
    ndjson: 'https://slothhub.dev/api/catalog.ndjson',
    futureSnapshot: 'https://slothhub.dev/api/future.snapshot.json',
  },
  feeds: {
    tools: 'https://slothhub.dev/api/tools.json',
    searchIndex: 'https://slothhub.dev/api/search-index.json',
    categories: 'https://slothhub.dev/api/categories.json',
    tags: 'https://slothhub.dev/api/tags.json',
    useCases: 'https://slothhub.dev/api/use-cases.json',
    stacks: 'https://slothhub.dev/api/stacks.json',
    best: 'https://slothhub.dev/api/best.json',
    futureFeed: 'https://slothhub.dev/api/future.json',
  },
  markdownArtifacts: {},
  integrationHubUrl: 'https://slothhub.dev/agents',
  markdownHubUrl: 'https://slothhub.dev/agents.md',
  toolDetailUrlTemplate: 'https://slothhub.dev/api/tools/{slug}.json',
  citationGuidance: ['Cite canonical pages'],
};

describe('indexFeedSchema', () => {

  it('preserves future string-valued feed and snapshot keys', () => {
    const parsed = indexFeedSchema.parse(additiveIndexFixture);
    expect(parsed.feeds.futureFeed).toBe('https://slothhub.dev/api/future.json');
    expect(parsed.snapshots.futureSnapshot).toBe('https://slothhub.dev/api/future.snapshot.json');
  });

  it('rejects future feed and snapshot keys with non-string values', () => {
    expect(indexFeedSchema.safeParse({
      ...additiveIndexFixture,
      feeds: {...additiveIndexFixture.feeds, futureFeed: {url: 'https://slothhub.dev/api/future.json'}},
    }).success).toBe(false);
    expect(indexFeedSchema.safeParse({
      ...additiveIndexFixture,
      snapshots: {
        ...additiveIndexFixture.snapshots,
        futureSnapshot: {url: 'https://slothhub.dev/api/future.snapshot.json'},
      },
    }).success).toBe(false);
  });

  it('rejects blank advertised URLs instead of silently omitting them', () => {
    expect(indexFeedSchema.safeParse({
      ...additiveIndexFixture,
      feeds: {...additiveIndexFixture.feeds, futureFeed: ''},
    }).success).toBe(false);
    expect(indexFeedSchema.safeParse({
      ...additiveIndexFixture,
      snapshots: {...additiveIndexFixture.snapshots, futureSnapshot: ''},
    }).success).toBe(false);
  });
});

const domainParserCallState = vi.hoisted(() => ({count: 0}));
const parsePublicRuntimeRequirements = moduleFakeTarget1.parsePublicRuntimeRequirements;

installModuleFakes(moduleFakeTarget1, {
  parsePublicRuntimeRequirements: (
    input: Parameters<typeof parsePublicRuntimeRequirements>[0],
  ) => {
    domainParserCallState.count += 1;
    return parsePublicRuntimeRequirements(input);
  },
});

describe('runtimeRequirementSchema', () => {
  it('preserves sourced maintenance in current catalog parsing and MCP Markdown', () => {
    const feed = toolDetailFeedFor(0, 0);
    const lifecycle = {releaseModel: {value: 'unknown'}, releaseLines: [], maintenanceStatus: 'reference', maintenanceEvidence: [{title: 'Archive statement', url: 'https://example.com/archive', sourceType: 'repository', checkedAt: '2026-07-01T00:00:00Z'}]};
    const parsed = toolDetailFeedSchema.parse({...feed, version: '33.0.0', data: {...feed.data, lifecycle}});
    expect(parsed.data.lifecycle).toEqual(lifecycle);
    expect(formatToolMarkdown(parsed.data)).toContain('Maintenance: Reference.');
    expect(formatToolMarkdown(parsed.data)).toContain('https://example.com/archive');
  });

  it('retains numeric persona inputs and cited formulas through client parsing and text output', () => {
    const feed = toolDetailFeedFor(0, 0);
    const pricing: ToolPricingEvidence & {currency: 'USD'} = {currency: 'USD', plans: [{
      name: 'Pro', planId: 'pro', listPrice: 12, billing: 'Per seat monthly', billingPeriod: 'month',
      costBasis: {chargeUnit: 'seat', seatLimit: 10, projectLimit: 20, includedMonthlyUsage: 100, usageUnit: 'request', overageBehavior: 'metered', unitPrice: 0.01, evidenceUrls: ['https://example.com/pricing'], checkedAt: '2026-07-01T00:00:00Z'},
    }]};
    const personaCosts = computePersonaCostEstimates(pricing, new Date('2026-07-31T00:00:00Z'));
    const pricingDetails = {...pricing, personaCosts};
    const parsed = toolDetailFeedSchema.parse({...feed, data: {...feed.data, pricingDetails}});
    expect(parsed.data.pricingDetails?.personaCosts).toEqual(personaCosts);
    expect(parsed.data.pricingDetails?.plans).toEqual(pricing.plans);
    const output = formatToolMarkdown(parsed.data);
    expect(output).toContain('111.00 USD/month');
    expect(output).toContain('https://example.com/pricing');
    expect(output).toContain('formula');
  });

  it('retains richer pricing through MCP parsing and Markdown', () => {
    const feed = toolDetailFeedFor(0, 0);
    const pricingDetails = {currency: 'USD', plans: [{name: 'Pro', listPrice: 25, promoPrice: 18, billing: 'monthly', promoNote: 'First year only'}], sourceDiscrepancyNote: 'Checkout differs'};
    const parsed = toolDetailFeedSchema.parse({...feed, data: {...feed.data, pricingDetails}});
    expect(parsed.data.pricingDetails).toEqual(pricingDetails);
    expect(formatToolMarkdown(parsed.data)).toContain('Pricing source discrepancy: Checkout differs');
  });
  it('parses a custom plan without a list price and renders it as Custom', () => {
    const feed = toolDetailFeedFor(0, 0);
    const pricingDetails = {currency: 'USD' as const, plans: [{name: 'Enterprise', priceType: 'custom' as const, billing: 'Custom pricing, per seat'}]};
    const parsed = toolDetailFeedSchema.parse({...feed, data: {...feed.data, pricingDetails}});
    expect(parsed.data.pricingDetails).toEqual(pricingDetails);
    const markdown = formatToolMarkdown(parsed.data);
    expect(markdown).toContain('Plan Enterprise: Custom; Custom pricing, per seat');
    expect(markdown).not.toContain('undefined');
    expect(markdown).not.toContain('list 0');
  });
  it('drops unsigned compatibility claims from Tool detail feeds', () => {
    const feed = toolDetailFeedFor(0, 0);
    const parsed = toolDetailFeedSchema.parse({...feed, data: {...feed.data, integrations: [
      {name: 'Unsigned', slug: 'unsigned', status: 'native'},
      {name: 'Negative', slug: 'negative', status: 'incompatible'},
      {name: 'Verified', slug: 'verified', status: 'native', checkedAt: '2026-09-01T00:00:00Z', sourceUrl: 'https://example.com/evidence'},
    ]}});
    expect(parsed.data.integrations?.map((fact) => fact.slug)).toEqual(['verified']);
  });
  const publicUrlWithLength = (length: number): string => {
    const prefix = 'https://example.com/';
    return `${prefix}${'a'.repeat(length - prefix.length)}`;
  };

  const requirementWithEvidenceUrl = (url: string) => ({
    subjectKind: 'runtime',
    subjectName: 'Node.js',
    environmentRange: '>=20',
    status: 'supported',
    evidence: [{
      title: 'Runtime support',
      url,
      checkedAt: '2026-07-14T12:00:00.000Z',
    }],
    reviewedAt: '2026-07-14T12:30:00.000Z',
  });

  const requirementsFor = (rowCount: number, evidenceCount: number) =>
    Array.from({length: rowCount}, (_, rowIndex) => ({
      ...requirementWithEvidenceUrl(`https://example.com/docs/${rowIndex}/0`),
      subjectName: `Runtime ${rowIndex}`,
      evidence: Array.from({length: evidenceCount}, (_, evidenceIndex) => ({
        title: `Runtime ${rowIndex} evidence ${evidenceIndex}`,
        url: `https://example.com/docs/${rowIndex}/${evidenceIndex}`,
        checkedAt: '2026-07-14T12:00:00.000Z',
      })),
    }));

  const toolDetailFeedFor = (rowCount: number, evidenceCount: number) => ({
    version: '33.0.0',
    siteUrl: 'https://slothhub.dev',
    generatedAt: '2026-07-14T12:30:00.000Z',
    data: {
      name: 'Runtime fixture',
      slug: 'runtime-fixture',
      description: 'Runtime boundary fixture',
      resourceKind: {value: 'app', label: 'App'},
      resourceIdentity: {
        kind: 'website',
        kindLabel: 'Website',
        canonicalUrl: 'https://example.com/',
        ctaLabel: 'Open website',
      },
      pricing: 'free',
      platforms: ['web'],
      categories: [],
      tags: [],
      useCases: [],
      freshness: {
        isVerified: true,
        verifiedAt: '2026-07-14T12:00:00.000Z',
      },
      detailUrl: 'https://slothhub.dev/tool/runtime-fixture',
      visitUrl: 'https://slothhub.dev/go/runtime-fixture',
      keyFeatures: [],
      alternativeTools: [],
      runtimeRequirements: requirementsFor(rowCount, evidenceCount),
    },
  });

  it('retains edition and download-license evidence through MCP feed parsing and Markdown', () => {
    const feed = toolDetailFeedFor(0, 0);
    const editions = [{id: 'oss', name: 'Open-source download', deploymentModel: 'local_application', sourceAvailability: 'open_source', repositoryUrl: 'https://github.com/example/tool', pricing: 'free', sourceUrl: 'https://example.com/editions', checkedAt: '2026-07-01T00:00:00Z', license: {artifactPattern: 'rtk-oss-<target>', spdxExpression: 'Apache-2.0', sourceUrl: 'https://example.com/license', checkedAt: '2026-07-01T00:00:00Z'}}];
    const parsed = toolDetailFeedSchema.parse({...feed, data: {...feed.data, editions}});
    expect(parsed.data.editions).toEqual(editions);
    expect(formatToolMarkdown(parsed.data)).toContain('rtk-oss-<target>');
    expect(formatToolMarkdown(parsed.data)).toContain('https://example.com/license');
  });
  it('reads catalog 21 reference and permission facts through MCP parsing and Markdown', () => {
    const feed = toolDetailFeedFor(0, 0);
    const keyFeatureDetails = [
      {kind: 'reference', feature: 'Config', title: 'Config', summary: 'Configure a prefix.', tableKind: 'config', sourceUrl: 'https://example.com/docs', checkedAt: '2026-10-20T00:00:00Z', rows: [{name: 'prefix', default: '', description: 'Output prefix.'}]},
      {kind: 'permissions', sourceUrl: 'https://example.com/docs', checkedAt: '2026-10-20T00:00:00Z', feature: 'Access', title: 'Access', summary: 'Requested permissions.', model: 'oauth', entries: [{permission: 'repo', required: false}]},
    ];
    const parsed = toolDetailFeedSchema.parse({...feed, version: '33.0.0', data: {...feed.data, keyFeatures: ['Config', 'Access'], keyFeatureDetails}});
    expect(parsed.data.keyFeatureDetails).toEqual(keyFeatureDetails);
    expect(() => toolDetailFeedSchema.parse({...feed, version: '33.0.0', data: {...feed.data, keyFeatureDetails: keyFeatureDetails.map(({checkedAt: _checkedAt, ...unchecked}) => unchecked)}})).toThrow();
    expect(formatToolMarkdown(parsed.data)).toContain('`prefix`');
    expect(formatToolMarkdown(parsed.data)).toContain('`repo` — Optional');
  });

  it('reads generic image interfaces and quickstarts in catalog 18', () => {
    const agentInterfaces = normalizePublicAgentInterfaces([{kind: 'sdk', source: 'container_registry', status: 'official', identifier: 'docker.gitea.com/gitea'}]);
    const quickstarts = buildPublicToolQuickstarts({agentInterfaces});
    const feed = toolDetailFeedFor(0, 0);
    const parsed = toolDetailFeedSchema.parse({...feed, version: '33.0.0', data: {...feed.data, agentInterfaces, quickstarts}});
    expect(parsed.data.agentInterfaces).toEqual(agentInterfaces);
    expect(parsed.data.quickstarts).toEqual(quickstarts);
  });

  it('preserves deployment evidence in parsed MCP data and human-readable output', () => {
    const feed = toolDetailFeedFor(0, 0);
    const deployment = {scope: 'Hosted edition', models: ['hosted'], sourceUrl: 'https://example.com/hosting', checkedAt: '2026-07-01T00:00:00.000Z'};
    const parsed = toolDetailFeedSchema.parse({...feed, data: {...feed.data, deployment}});
    expect(parsed.data.deployment).toEqual(deployment);
    expect(formatToolMarkdown(parsed.data)).toContain('Provider hosted');
    expect(formatToolMarkdown(parsed.data)).toContain('Source availability: Not recorded');
    expect(toolDetailFeedSchema.safeParse({...feed, data: {...feed.data, deployment: {...deployment, sourceUrl: 'https://127.0.0.1/'}}}).success).toBe(false);
  });

  it('preserves license observations and distinguishes unknown reasons in MCP output', () => {
    const feed = toolDetailFeedFor(0, 0);
    const licenseFacts = [{scope: 'resource', source: 'official_website', status: 'unknown', unknownReason: 'custom', sourceUrl: 'https://example.com/license', checkedAt: '2026-07-01T00:00:00.000Z'}];
    const parsed = toolDetailFeedSchema.parse({...feed, data: {...feed.data, licenseFacts}});
    expect(parsed.data.licenseFacts).toEqual(licenseFacts);
    expect(formatToolMarkdown(parsed.data)).toContain('Observed license metadata');
    expect(formatToolMarkdown(parsed.data)).toContain('Unknown (custom)');
  });
  it('retains path license scope when reading catalog 26', () => {
    const feed = toolDetailFeedFor(0, 0);
    const licenseFacts = [{scope: 'repository', appliesTo: {kind: 'path', value: 'skills/documents'}, source: 'official_website', status: 'custom_terms', licenseRef: 'LicenseRef-Document-Skills', note: 'Reviewed skill terms.', evidenceKind: 'license_file', summary: 'Document skill terms apply.', sourceUrl: 'https://example.com/license', checkedAt: '2026-07-01T00:00:00.000Z'}];
    const parsed = toolDetailFeedSchema.parse({...feed, version: '33.0.0', data: {...feed.data, licenseFacts}});
    expect(parsed.data.licenseFacts).toEqual(licenseFacts);
    expect(formatToolMarkdown(parsed.data)).toContain('repository — path: skills/documents');
    expect(formatToolMarkdown(parsed.data)).toContain('LicenseRef-Document-Skills');
    expect(formatToolMarkdown(parsed.data)).toContain('Reviewed skill terms');
  });

  it.each([
    ' https://example.com/docs ',
    'HTTPS://EXAMPLE.COM:443/docs',
    'http://127.0.0.1/private',
    'javascript:alert(1)',
    'https://example.com/docs\u2028spoofed output',
    'https://example.com/docs\u2029spoofed output',
  ])('rejects non-canonical public evidence URL %j', (url) => {
    expect(runtimeRequirementSchema.safeParse(requirementWithEvidenceUrl(url)).success)
      .toBe(false);
  });

  it.each([
    ['url', 'javascript:alert(1)'],
    ['url', 'https://slothhub.dev/tool/runtime-fixture/updates\u2028forged'],
    ['changedAt', 'not-a-date'],
  ] as const)('rejects unsafe pricing-history %s values', (field, value) => {
    const feed = toolDetailFeedFor(0, 0)
    const pricingHistory = {
      url: 'https://slothhub.dev/tool/runtime-fixture/updates',
      latestValidatedChange: {
        previous: 'free',
        current: 'paid',
        changedAt: '2026-08-25T19:00:00.000Z',
      },
    }
    if (field === 'url') pricingHistory.url = value
    else pricingHistory.latestValidatedChange.changedAt = value
    Object.assign(feed.data, {pricingHistory})

    expect(toolDetailFeedSchema.safeParse(feed).success).toBe(false)
  })

  it.each([
    'http://localhost:4321/tool/runtime-fixture/updates',
    'http://127.0.0.1:4321/tool/runtime-fixture/updates',
  ])('accepts a supported local pricing-history URL %s', (url) => {
    const feed = toolDetailFeedFor(0, 0)
    Object.assign(feed.data, {
      pricingHistory: {
        url,
        latestValidatedChange: {
          previous: 'free',
          current: 'paid',
          changedAt: '2026-08-25T19:00:00.000Z',
        },
      },
    })

    expect(toolDetailFeedSchema.safeParse(feed).success).toBe(true)
  })

  it.each([
    {codePoint: 'U+2028', separator: '\u2028'},
    {codePoint: 'U+2029', separator: '\u2029'},
  ])(
    'rejects $codePoint from every public runtime text field',
    ({separator}) => {
      const requirement = requirementWithEvidenceUrl('https://example.com/docs');
      const cases = [
        {...requirement, subjectName: `Node${separator}.js`},
        {...requirement, environmentRange: `>=20${separator}<23`},
        {...requirement, toolRange: `>=4${separator}<5`},
        {...requirement, note: `Use LTS${separator}spoofed output`},
        {
          ...requirement,
          evidence: [{
            ...requirement.evidence[0],
            title: `Runtime docs${separator}spoofed output`,
          }],
        },
      ];

      for (const candidate of cases) {
        expect(runtimeRequirementSchema.safeParse(candidate).success).toBe(false);
      }
    },
  );

  it('rejects blank and ASCII control-bearing runtime text', () => {
    const requirement = requirementWithEvidenceUrl('https://example.com/runtime-support');

    expect(runtimeRequirementSchema.safeParse({
      ...requirement,
      subjectName: '   ',
    }).success).toBe(false);
    expect(runtimeRequirementSchema.safeParse({
      ...requirement,
      note: 'forged\u001b[31moutput',
    }).success).toBe(false);
  });

  it('accepts 2048-character evidence URLs and rejects 2049-character URLs', () => {
    const maximumUrl = publicUrlWithLength(MAX_PUBLIC_SOURCE_REFERENCE_URL_LENGTH);
    const oversizedUrl = publicUrlWithLength(MAX_PUBLIC_SOURCE_REFERENCE_URL_LENGTH + 1);

    expect(maximumUrl).toHaveLength(2048);
    expect(oversizedUrl).toHaveLength(2049);
    expect(runtimeRequirementSchema.safeParse(requirementWithEvidenceUrl(maximumUrl)).success)
      .toBe(true);
    expect(runtimeRequirementSchema.safeParse(requirementWithEvidenceUrl(oversizedUrl)).success)
      .toBe(false);
  });

  it('permits unknown requirements without evidence and requires canonical UTC timestamps', () => {
    const requirement = requirementWithEvidenceUrl('https://example.com/runtime-support');

    expect(runtimeRequirementSchema.safeParse({
      ...requirement,
      status: 'unknown',
      evidence: [],
    }).success).toBe(true);
    expect(runtimeRequirementSchema.safeParse({
      ...requirement,
      reviewedAt: '2026-07-14T06:30:00-06:00',
    }).success).toBe(false);
    expect(runtimeRequirementSchema.safeParse({
      ...requirement,
      evidence: [{...requirement.evidence[0], checkedAt: '2026-07-14T12:00:00.00Z'}],
    }).success).toBe(false);
    expect(runtimeRequirementSchema.safeParse({
      ...requirement,
      reviewedAt: '2026-07-14T12:30:00Z',
    }).success).toBe(true);
  });

  it('accepts exact runtime row and evidence caps and rejects max plus one', () => {
    expect(runtimeRequirementsSchema.safeParse(requirementsFor(12, 3)).success).toBe(true);
    expect(runtimeRequirementsSchema.safeParse(requirementsFor(13, 3)).success).toBe(false);
    expect(runtimeRequirementsSchema.safeParse(requirementsFor(1, 4)).success).toBe(false);

    expect(toolDetailFeedSchema.safeParse(toolDetailFeedFor(12, 3)).success).toBe(true);
    expect(toolDetailFeedSchema.safeParse(toolDetailFeedFor(13, 3)).success).toBe(false);
    expect(toolDetailFeedSchema.safeParse(toolDetailFeedFor(1, 4)).success).toBe(false);
  });

  it('preserves YAML Actions quickstarts for MCP consumers', () => {
    const feed = toolDetailFeedFor(1, 1);
    const quickstarts = [{kind: 'install_command', label: 'Use GitHub Action', status: 'official', statusLabel: 'Official', command: 'uses: actions/checkout@v4', commandLanguage: 'yaml', docsUrl: 'https://github.com/actions/checkout', notice: 'Pin this action to a full commit SHA before running it.'}];
    Object.assign(feed.data, {quickstarts});
    expect(toolDetailFeedSchema.parse(feed).data.quickstarts).toEqual(quickstarts);
  });

  it.each(['http://localhost:4321/docs', 'http://127.0.0.1/docs', 'http://10.0.0.1/docs', 'https://user:secret@example.com/docs', 'javascript:alert(1)', 'data:text/plain,hello'])(
    'keeps third-party evidence URL restrictions for %s', (url) => {
      const feed = toolDetailFeedFor(1, 1);
      Object.assign(feed.data, {sourceReferences: [{title: 'Docs', url, sourceType: 'official_docs', checkedAt: '2026-07-14T12:00:00.000Z'}]});
      expect(toolDetailFeedSchema.safeParse(feed).success).toBe(false);
    },
  );

  it('retains unrelated package evidence in JSON and Markdown without treating it as an install identity', () => {
    const feed = toolDetailFeedFor(1, 1)
    const excludedRegistryIdentities = [{source: 'npm', identifier: 'archify', sourceUrl: 'https://www.npmjs.com/package/archify', checkedAt: '2026-07-01T00:00:00Z'}]
    Object.assign(feed.data, {excludedRegistryIdentities})
    const parsed = toolDetailFeedSchema.parse(feed)
    expect(parsed.data.excludedRegistryIdentities).toEqual(excludedRegistryIdentities)
    expect(formatToolMarkdown(parsed.data)).toContain('Not this tool: npm `archify`')
  })

  it('enforces generatedAt for Tool summaries nested across MCP feed shapes', () => {
    const validTool = toolDetailFeedFor(1, 1).data;
    const futureTool = structuredClone(validTool);
    Object.assign(futureTool, {
      freshness: {isVerified: true, verifiedAt: '2026-07-15T00:00:00.000Z'},
    });
    const envelope = <TData,>(data: TData) => ({
      version: '33.0.0',
      siteUrl: 'https://slothhub.dev',
      generatedAt: '2026-07-14T12:30:00.000Z',
      data,
    });
    const cases = [
      {
        name: 'Tools',
        schema: toolsFeedSchema,
        valid: {tools: [validTool]},
        future: {tools: [futureTool]},
      },
      {
        name: 'Tool stacks',
        schema: stacksFeedSchema,
        valid: {stacks: [{name: 'Stack', slug: 'stack', url: 'https://slothhub.dev/stacks/stack', tags: [], tools: [{role: 'Primary', tool: validTool}]}]},
        future: {stacks: [{name: 'Stack', slug: 'stack', url: 'https://slothhub.dev/stacks/stack', tags: [], tools: [{role: 'Primary', tool: futureTool}]}]},
      },
      {
        name: 'Best lists',
        schema: bestFeedSchema,
        valid: {best: [{title: 'Best', slug: 'best', url: 'https://slothhub.dev/best/best', rankedTools: [{rank: 1, editorialBlurb: 'Best fit', tool: validTool}]}]},
        future: {best: [{title: 'Best', slug: 'best', url: 'https://slothhub.dev/best/best', rankedTools: [{rank: 1, editorialBlurb: 'Best fit', tool: futureTool}]}]},
      },
      {
        name: 'Categories',
        schema: categoriesFeedSchema,
        valid: {categories: [{name: 'Category', slug: 'category', url: 'https://slothhub.dev/category', featuredTools: [validTool]}]},
        future: {categories: [{name: 'Category', slug: 'category', url: 'https://slothhub.dev/category', featuredTools: [futureTool]}]},
      },
      {
        name: 'Use cases',
        schema: useCasesFeedSchema,
        valid: {useCases: [{name: 'Use case', slug: 'use-case', url: 'https://slothhub.dev/use-case/use-case', tools: [validTool]}]},
        future: {useCases: [{name: 'Use case', slug: 'use-case', url: 'https://slothhub.dev/use-case/use-case', tools: [futureTool]}]},
      },
    ];

    for (const testCase of cases) {
      expect(testCase.schema.safeParse(envelope(testCase.valid)).success, testCase.name).toBe(true);
      const futureResult = testCase.schema.safeParse(envelope(testCase.future));
      expect(futureResult.success, testCase.name).toBe(false);
      if (!futureResult.success) {
        expect(
          futureResult.error.issues.some((issue) => issue.path[0] === 'data'),
          testCase.name,
        ).toBe(true);
      }
    }
  });

  it.each([
    {
      field: 'quickstart command',
      apply: (feed: ReturnType<typeof toolDetailFeedFor>) => {
        Object.assign(feed.data, {
          quickstarts: [{
            kind: 'install_command',
            label: 'Install CLI',
            status: 'official',
            statusLabel: 'Official',
            command: 'npm install safe-package\u202E --global',
            commandLanguage: 'shell',
          }],
        });
      },
    },
    {
      field: 'fit-guidance list item',
      apply: (feed: ReturnType<typeof toolDetailFeedFor>) => {
        Object.assign(feed.data, {
          fitGuidance: {
            bestFor: ['Teams\u001b[31mspoofed output'],
            notIdealFor: [],
            keyTradeoffs: [],
            primaryDecisionCriteria: [],
          },
        });
      },
    },
    {
      field: 'recommended next step',
      apply: (feed: ReturnType<typeof toolDetailFeedFor>) => {
        Object.assign(feed.data, {
          fitGuidance: {
            bestFor: ['Product teams'],
            notIdealFor: [],
            keyTradeoffs: [],
            primaryDecisionCriteria: [],
            recommendedNextStep: 'Open docs\u2066 then run setup',
          },
        });
      },
    },
  ])('rejects unsafe public text in $field', ({apply}) => {
    const feed = toolDetailFeedFor(0, 0);
    apply(feed);

    expect(toolDetailFeedSchema.safeParse(feed).success).toBe(false);
  });

  it('rejects canonical runtime evidence duplicates', () => {
    const evidence = {
      title: 'Runtime support',
      url: 'https://example.com/runtime-support',
      checkedAt: '2026-07-14T12:00:00.000Z',
    };

    expect(runtimeRequirementSchema.safeParse({
      subjectKind: 'runtime',
      subjectName: 'Node.js',
      environmentRange: '>=20 <23',
      status: 'supported',
      evidence: [
        evidence,
        {
          ...evidence,
          title: 'Equivalent runtime support URL',
          url: evidence.url,
        },
      ],
      reviewedAt: '2026-07-14T12:30:00.000Z',
    }).success).toBe(false);
  });

  it('preserves shared semantic diagnostics without weakening the Zod shape', () => {
    const requirement = requirementWithEvidenceUrl('https://example.com/runtime-support');
    const missingEvidence = runtimeRequirementSchema.safeParse({...requirement, evidence: []});
    const duplicate = runtimeRequirementsSchema.safeParse([requirement, requirement]);
    const conflicting = runtimeRequirementsSchema.safeParse([
      requirement,
      {...requirement, status: 'unsupported'},
    ]);

    expect(missingEvidence.error?.issues).toContainEqual(expect.objectContaining({
      path: ['evidence'],
      message: 'assertive rows require public evidence.',
    }));
    expect(duplicate.error?.issues).toContainEqual(expect.objectContaining({
      path: [1],
      message: 'duplicate exact requirement key.',
    }));
    expect(conflicting.error?.issues).toContainEqual(expect.objectContaining({
      path: [1],
      message: 'conflicting statuses for one exact requirement key.',
    }));
    expect(runtimeRequirementsSchema.safeParse([
      requirement,
      {...requirement, environmentRange: '>=22'},
    ]).success).toBe(true);
    expect(runtimeRequirementSchema.safeParse({...requirement, internal: true}).success).toBe(false);
  });

  it('runs collection semantics once and preserves row issue paths', () => {
    const requirement = requirementWithEvidenceUrl('https://example.com/runtime-support');
    domainParserCallState.count = 0;

    const result = runtimeRequirementsSchema.safeParse([{...requirement, evidence: []}]);

    expect(domainParserCallState.count).toBe(1);
    expect(result.error?.issues).toContainEqual(expect.objectContaining({
      path: [0, 'evidence'],
      message: 'assertive rows require public evidence.',
    }));
  });

it('accepts legacy verification combinations and keeps unsafe Resource Links rejected', () => {
    const legacyVerified = toolDetailFeedFor(1, 1);
    Object.assign(legacyVerified.data, {freshness: {isVerified: true}});
    expect(toolDetailFeedSchema.parse(legacyVerified).data.freshness).toEqual({isVerified: false});

    const historical = toolDetailFeedFor(1, 1);
    Object.assign(historical.data, {
      freshness: {isVerified: false, verifiedAt: '2026-07-14T12:00:00.000Z'},
    });
    expect(toolDetailFeedSchema.parse(historical).data.freshness).toEqual({
      isVerified: false,
      verifiedAt: '2026-07-14T12:00:00.000Z',
    });

    const malformed = toolDetailFeedFor(1, 1);
    Object.assign(malformed.data, {
      freshness: {isVerified: false, verifiedAt: 'not-a-date'},
    });
    expect(toolDetailFeedSchema.safeParse(malformed).success).toBe(false);

    const future = toolDetailFeedFor(1, 1);
    Object.assign(future.data, {
      freshness: {isVerified: true, verifiedAt: '2026-07-15T00:00:00.000Z'},
    });
    const futureResult = toolDetailFeedSchema.safeParse(future);
    expect(futureResult.success).toBe(false);
    if (!futureResult.success) {
      expect(futureResult.error.issues.map((issue) => issue.path.join('.'))).toContain(
        'data.freshness.verifiedAt',
      );
    }

    const unsafe = toolDetailFeedFor(1, 1);
    Object.assign(unsafe.data, {
      resourceLinks: [{
        label: 'Unsafe docs',
        url: 'http://127.0.0.1/docs',
        kind: 'official_docs',
        isOfficial: true,
      }],
    });
    expect(toolDetailFeedSchema.safeParse(unsafe).success).toBe(false);

    const unsafeIdentity = toolDetailFeedFor(1, 1);
    Object.assign(unsafeIdentity.data.resourceIdentity, {
      canonicalUrl: 'https://user:secret@example.com',
    });
    expect(toolDetailFeedSchema.safeParse(unsafeIdentity).success).toBe(false);

    const unknownIdentityKind = toolDetailFeedFor(1, 1);
    Object.assign(unknownIdentityKind.data.resourceIdentity, {
      kind: 'unrecognized_identity_kind',
    });
    expect(toolDetailFeedSchema.safeParse(unknownIdentityKind).success).toBe(false);

    const futureResourceCheck = toolDetailFeedFor(1, 1);
    Object.assign(futureResourceCheck.data, {
      resourceLinks: [{
        label: 'Docs',
        url: 'https://example.com/docs',
        kind: 'official_docs',
        isOfficial: true,
        checkedAt: '2026-07-15T00:00:00.000Z',
      }],
    });
    const futureResourceResult = toolDetailFeedSchema.safeParse(futureResourceCheck);
    expect(futureResourceResult.success).toBe(false);
    if (!futureResourceResult.success) {
      expect(futureResourceResult.error.issues.map((issue) => issue.path.join('.'))).toContain(
        'data.resourceLinks.0.checkedAt',
      );
    }

    const legacyTaxonomy = toolDetailFeedFor(1, 1);
    Object.assign(legacyTaxonomy.data, {
      useCases: [
        {
          name: 'Legacy workflow',
          slug: 'legacy_workflow',
        },
      ],
    });
    expect(toolDetailFeedSchema.safeParse(legacyTaxonomy).success).toBe(true);

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
        reviewedAt: '2026-07-15T00:00:00.000Z',
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
      const invalidGuidance = toolDetailFeedFor(1, 1);
      Object.assign(invalidGuidance.data, {fitGuidance});
      expect(toolDetailFeedSchema.safeParse(invalidGuidance).success).toBe(false);
    }

    const tooManyKeyFeatures = toolDetailFeedFor(1, 1);
    Object.assign(tooManyKeyFeatures.data, {
      keyFeatures: Array.from({length: 11}, (_, index) => `Feature ${index}`),
    });
    expect(toolDetailFeedSchema.safeParse(tooManyKeyFeatures).success).toBe(false);
  });

it('preserves every modeled public Tool detail field', () => {
    const feed = toolDetailFeedFor(1, 1);
    Object.assign(feed.data, {
      publicationMarker: 'rev:abc123',
      fitGuidance: {
        bestFor: ['Teams that need a shared catalog'],
        notIdealFor: [],
        keyTradeoffs: ['Requires editorial review'],
        setupComplexity: 'low',
        setupComplexityLabel: 'Low',
        primaryDecisionCriteria: ['Freshness'],
      },
      sourceReferences: [{
        title: 'Official docs',
        url: 'https://example.com/docs',
        sourceType: 'official_docs',
        checkedAt: '2026-07-14T12:00:00.000Z',
      }],

      freshness: {
        ...feed.data.freshness,
        lastUpdated: '2026-07-14T12:00:00.000Z',
      },
      securityPrivacyPosture: {
        trustCenterUrl: 'https://example.com/trust',
        complianceClaims: [{
          standard: 'soc2_type_ii',
          label: 'SOC 2 Type II',
          status: 'verified',
          sourceUrl: 'https://example.com/trust',
        }],
      },
      pricingDetails: {
        trialAvailability: 'available',
        trialTerms: {
          planName: 'Pro',
          eligibility: 'eligibility_limited',
          eligibilityNote: 'New workspaces only.',
          duration: '14 days',
          cardRequirement: 'not_required',
          endBehavior: 'reverts_to_free',
          evidence: [{
            title: 'Trial terms FAQ',
            url: 'https://example.com/trial-terms',
            sourceType: 'official_docs',
            checkedAt: '2026-07-14T12:00:00.000Z',
          }],
          reviewedAt: '2026-07-14T12:20:00.000Z',
        },
      },
      quickstarts: [{
        kind: 'install_command',
        label: 'Install CLI',
        status: 'official',
        statusLabel: 'Official',
        command: 'npm install -g example-cli',
        commandLanguage: 'shell',
        docsUrl: 'https://example.com/docs',
      }],
    });

    expect(toolDetailFeedSchema.parse(feed)).toEqual(feed);
  });
});

describe('Resource Relationship feed contract', () => {
  it('accepts supported reciprocal relationships and rejects unsupported kinds', () => {
    const relationship = {
      kind: 'mcp_server_for',
      direction: 'outgoing',
      label: 'MCP server for',
      target: {
        id: 'tool-app',
        name: 'Example app',
        slug: 'example-app',
        canonicalUrl: 'https://example.app/',
        resourceKind: {value: 'app', label: 'App'},
      },
    } as const;
    const feed = {
      version: '33.0.0',
      siteUrl: 'https://slothhub.dev',
      generatedAt: '2026-07-14T12:30:00.000Z',
      data: {
        name: 'Relationship fixture',
        slug: 'relationship-fixture',
        description: 'Resource Relationship fixture',
        resourceKind: {value: 'app', label: 'App'},
        resourceIdentity: {
          kind: 'website',
          kindLabel: 'Website',
          canonicalUrl: 'https://relationship.example/',
          ctaLabel: 'Open website',
        },
        pricing: 'free',
        platforms: ['web'],
        categories: [],
        tags: [],
        useCases: [],
        freshness: {isVerified: true},
        detailUrl: 'https://slothhub.dev/tool/relationship-fixture',
        visitUrl: 'https://slothhub.dev/go/relationship-fixture',
        keyFeatures: [],
        alternativeTools: [],
      },
    };

    const supported = toolDetailFeedSchema.safeParse({
      ...feed,
      data: {...feed.data, resourceRelationships: [relationship]},
    });
    expect(
      supported.success,
      supported.success ? undefined : JSON.stringify(supported.error.issues),
    ).toBe(true);
    expect(
      toolDetailFeedSchema.safeParse({
        ...feed,
        data: {
          ...feed.data,
          resourceRelationships: [{...relationship, kind: 'depends_on'}],
        },
      }).success,
    ).toBe(false);
    expect(
      toolDetailFeedSchema.safeParse({
        ...feed,
        data: {
          ...feed.data,
          resourceRelationships: [{...relationship, label: 'Documentation'}],
        },
      }).success,
    ).toBe(false);

    for (const canonicalUrl of [
      'javascript:alert(1)',
      'https://user:secret@example.com/docs',
      'http://[::1]/docs',
      'https://example.com/\nspoofed',
      'https://example.com/\u202Espoofed',
    ]) {
      expect(
        toolDetailFeedSchema.safeParse({
          ...feed,
          data: {
            ...feed.data,
            resourceRelationships: [
              {...relationship, target: {...relationship.target, canonicalUrl}},
            ],
          },
        }).success,
      ).toBe(false);
    }
  });
});
