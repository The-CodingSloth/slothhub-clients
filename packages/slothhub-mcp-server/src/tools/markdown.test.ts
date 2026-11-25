import {normalizePublicToolPortability} from '@slothhub/domain/tool-portability';
import {normalizePublicToolLifecycle} from '@slothhub/domain/tool-lifecycle';
import {fillAgentSetupRecipeEntrySnippets} from '@slothhub/domain/mcp-registry';
import {normalizePublicAgentInterfaces} from '@slothhub/domain/agent-interface';
import {describe, expect, it} from 'vite-plus/test';

import type {AgentToolDetail} from '../types.js';
import {formatToolMarkdown} from './markdown.js';
import {toolDetailSchema, toolDetailFeedSchema} from '@slothhub/domain/public-feed-mcp-schemas';

const toolDetail = (): AgentToolDetail => ({
  name: 'Example',
  slug: 'example',
  description: 'Example tool',
  resourceKind: {value: 'app', label: 'App'},
  resourceIdentity: {
    kind: 'website',
    kindLabel: 'Website',
    canonicalUrl: 'https://example.com',
    ctaLabel: 'Visit website',
  },
  pricing: 'freemium',
  platforms: ['web'],
  categories: [],
  tags: [],
  useCases: [],
  freshness: {isVerified: false},
  detailUrl: 'https://slothhub.dev/tool/example',
  visitUrl: 'https://slothhub.dev/go/example?surface=mcp',
  keyFeatures: [],
  alternativeTools: [],
});

describe('formatToolMarkdown', () => {
  it('keeps named alternative notes through parsing and Markdown output', () => {
    const source = toolDetail();
    source.resourceIdentity.canonicalUrl = 'https://example.com/';
    const notes = {
      alternativeNotes: [{
        name: 'Public alternative',
        slug: 'public',
        note: 'Compare local editing first.',
        sourceUrl: 'https://example.com/compare',
      }],
    };
    const parsed = toolDetailSchema.parse({...source, ...notes});
    expect(parsed.alternativeNotes).toEqual(notes.alternativeNotes);
    const output = formatToolMarkdown({...source, alternativeNotes: parsed.alternativeNotes});
    expect(output).toContain('## Alternative notes');
    expect(output).toContain('Public alternative (public): Compare local editing first\\.');
    expect(output).toContain('source `https://example.com/compare`');
    expect(output).not.toContain('tool-9f3c');
  });

  it('keeps tools without alternative notes readable', () => {
    const source = toolDetail();
    source.resourceIdentity.canonicalUrl = 'https://example.com/';
    const parsed = toolDetailSchema.parse(source);
    expect(parsed).not.toHaveProperty('alternativeNotes');
    const output = formatToolMarkdown(source);
    expect(output).not.toContain('Alternative notes');
  });

  it('rejects an alternative note that only carries an id or an http source', () => {
    const source = toolDetail();
    source.resourceIdentity.canonicalUrl = 'https://example.com/';
    expect(toolDetailSchema.safeParse({
      ...source,
      alternativeNotes: [{note: 'Compare local editing first.', sourceUrl: 'https://example.com/compare'}],
    }).success).toBe(false);
    expect(toolDetailSchema.safeParse({
      ...source,
      alternativeNotes: [{name: 'Public alternative', note: 'Compare local editing first.', sourceUrl: 'http://example.com/compare'}],
    }).success).toBe(false);
  });

  it('preserves companion links through feed parsing and Markdown output', () => {
    const source = toolDetail();
    source.resourceIdentity.canonicalUrl = 'https://example.com/';
    const relatedTools = [{...source, name: 'ripgrep', slug: 'ripgrep', detailUrl: 'https://slothhub.dev/tool/ripgrep'}];
    const parsed = toolDetailSchema.parse({...source, relatedTools});
    expect(parsed.relatedTools).toMatchObject([{name: 'ripgrep', slug: 'ripgrep', detailUrl: 'https://slothhub.dev/tool/ripgrep'}]);
    expect(formatToolMarkdown({...source, relatedTools: parsed.relatedTools})).toContain('## Works with');
  });
  it('reads catalog 22 shortcuts and labels both comparison sides in Markdown', () => {
    const keyFeatureDetails = [
      {kind: 'shortcuts', feature: 'Keys', title: 'Keys', summary: 'Use keys.', entries: [{action: 'Copy', mac: '⌘C'}]},
      {kind: 'code', feature: 'Migrate', title: 'Migrate', summary: 'Upgrade.', mode: 'before_after', sourceUrl: 'https://example.com/docs', before: {filename: 'old.ts', language: 'typescript', code: 'oldApi()'}, after: {filename: 'new.ts', language: 'typescript', code: 'newApi()'}},
    ];
    const source = toolDetail();
    const parsed = toolDetailFeedSchema.parse({version: '33.0.0', siteUrl: 'https://slothhub.dev', generatedAt: '2026-10-20T00:00:00Z', data: {...source, resourceIdentity: {...source.resourceIdentity, canonicalUrl: 'https://example.com/'}, keyFeatureDetails}});
    const output = formatToolMarkdown(parsed.data);
    expect(output).toContain('macOS: `⌘C`');
    expect(output).toContain('#### Before');
    expect(output).toContain('#### After');
    expect(output).toContain('oldApi()');
    expect(output).toContain('newApi()');
  });
  it('preserves current deals in structured detail and displays the full commercial context', () => {
    const checkedAt = new Date().toISOString();
    const deal = {id: 'offer', title: 'Save 20%', description: 'Annual offer', discountPercent: 20,
      eligibility: 'New customers', termsSummary: 'Annual plans only', commercialDisclosure: 'Affiliate offer',
      sourceUrl: 'https://example.com/offer', verifiedAt: checkedAt, lastSourceCheckedAt: checkedAt,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString()};
    const source = toolDetail();
    source.resourceIdentity.canonicalUrl = 'https://example.com/';
    const parsed = toolDetailSchema.parse({...source, deals: [deal], contentSignal: 'search=yes, ai-input=yes'});
    expect(parsed.deals).toEqual([deal]);
    const output = formatToolMarkdown({...source, deals: parsed.deals, contentSignal: parsed.contentSignal});
    for (const text of [deal.expiresAt, deal.eligibility, deal.termsSummary, deal.commercialDisclosure, deal.sourceUrl]) expect(output).toContain(text);
    const expired = toolDetailSchema.parse({...source, deals: [{...deal, expiresAt: '2020-01-01T00:00:00Z'}]});
    expect(formatToolMarkdown({...source, deals: expired.deals})).not.toContain(deal.title);
  });

  it('delivers policy summaries from the parsed feed with their source and missing-metadata notice', () => {
    const tool = toolDetail();
    tool.resourceIdentity.canonicalUrl = 'https://example.com/';
    const parsed = toolDetailSchema.parse({...tool, securityPrivacyPosture: {
      dataTrainingPolicySummary: 'Enterprise private data excluded from training.',
      dataTrainingPolicyUrl: 'https://example.com/training',
    }});
    const output = formatToolMarkdown({...tool, securityPrivacyPosture: parsed.securityPrivacyPosture});
    expect(output).toContain('Data training: Enterprise private data excluded from training\\.; source `https://example.com/training`');
    expect(output).toContain('product/plan/region scope and summary review date not recorded');
    expect(output).toContain('Data retention: Unknown; no source-backed summary recorded.');
    expect(output).toContain('not certification or an independent policy assessment');
  });

  it('preserves decision notes and their review date without requiring comparison lists', () => {
    const output = formatToolMarkdown({...toolDetail(), comparisonFacts: {
      pricingNotes: 'Business plan bills by monthly pageviews; check the plan before estimating cost.',
      platformNotes: 'Cloud edition only; local operation is not established.',
      migrationNotes: 'Export before trial expiry; <data> is not a migration guarantee.',
      lastReviewedAt: '2026-10-13T00:00:00.000Z',
    }});
    expect(output).toContain('## Comparison facts');
    expect(output).toContain('Pricing: Business plan bills by monthly pageviews; check the plan before estimating cost.');
    expect(output).toContain('Platforms: Cloud edition only; local operation is not established.');
    expect(output).toContain('Migration: Export before trial expiry; \\<data\\> is not a migration guarantee.');
    expect(output).toContain('Comparison facts reviewed: 2026-10-13T00:00:00.000Z');
  });

  it('does not emit an empty comparison section for whitespace-only notes', () => {
    const output = formatToolMarkdown({...toolDetail(), comparisonFacts: {
      pricingNotes: ' \n ', lastReviewedAt: '2026-10-13T00:00:00.000Z',
    }});
    expect(output).not.toContain('## Comparison facts');
    expect(output).not.toContain('Comparison facts reviewed:');
  });

  it('exposes sourced trial restrictions without inventing unspecified terms', () => {
    const output = formatToolMarkdown({...toolDetail(), pricingDetails: {
      trialAvailability: 'available', trialTerms: {
        cardRequirement: 'not_required', endBehavior: 'access_ends',
        endNote: 'Dashboard locks; account login remains available.',
        evidence: [{title: 'Trial terms', url: 'https://example.com/trial', sourceType: 'official_docs', checkedAt: '2026-10-10T00:00:00.000Z'}],
        reviewedAt: '2026-10-11T00:00:00.000Z',
      },
    }});
    expect(output).toContain('- Card required: No');
    expect(output).toContain('- When the trial ends: Access ends');
    expect(output).toContain('- Trial end detail: Dashboard locks; account login remains available.');
    expect(output).toContain('- Trial terms source: https://example.com/trial');
    expect(output).toContain('- Trial terms reviewed: 2026-10-11T00:00:00.000Z');
    expect(output).toContain('https://example.com/trial (checked 2026-10-10T00:00:00.000Z)');
    expect(output).not.toContain('Trial length:');
    expect(output).not.toContain('Trial eligibility:');
  });

  it('includes the official pricing URL and starting price from the feed', () => {
    const output = formatToolMarkdown({...toolDetail(), pricingDetails: {
      pricingUrl: 'https://example.com/pricing', startingPrice: 12, currency: 'USD',
    }});
    expect(output).toContain('- Official pricing: https://example.com/pricing');
    expect(output).toContain('- Starting price: 12 USD');
  });

  it('includes a pricing URL without inventing a starting price', () => {
    const output = formatToolMarkdown({...toolDetail(), pricingDetails: {pricingUrl: 'http://example.com/pricing'}});
    expect(output).toContain('- Official pricing: http://example.com/pricing');
    expect(output).not.toContain('Starting price:');
  });

  it.each([undefined, {}, {currency: 'USD' as const}])('omits absent pricing details (%j)', (pricingDetails) => {
    const output = formatToolMarkdown({...toolDetail(), pricingDetails});
    expect(output).not.toContain('Official pricing:');
    expect(output).not.toContain('Starting price:');
  });

  it('preserves a zero starting price without inventing a currency', () => {
    const output = formatToolMarkdown({...toolDetail(), pricingDetails: {startingPrice: 0}});
    expect(output.split('\n')).toContain('- Starting price: 0');
  });

  it.each([
    '', '/go/example', 'https://slothhub.dev/go/example', 'https://slothhub.dev/go',
    'https://user:password@example.com/pricing', 'javascript:alert(1)',
  ])('omits unsafe or empty official pricing URLs (%s)', (pricingUrl) => {
    const output = formatToolMarkdown({...toolDetail(), pricingDetails: {pricingUrl}});
    expect(output).not.toContain('Official pricing:');
  });

  it('preserves missing versus empty decision collections through feed parsing', () => {
    const {alternativeTools: _alternatives, ...source} = toolDetail();
    source.resourceIdentity.canonicalUrl = 'https://example.com/';
    const missing = toolDetailSchema.parse(source);
    expect(missing).not.toHaveProperty('alternativeTools');
    expect(formatToolMarkdown({...source, alternativeTools: missing.alternativeTools})).not.toContain('## Alternative tools');
    const empty = toolDetailSchema.parse({...source, integrations: [], securityPrivacyPosture: {securityCapabilities: []}, alternativeTools: []});
    const output = formatToolMarkdown({...source,
      integrations: empty.integrations,
      securityPrivacyPosture: empty.securityPrivacyPosture,
      alternativeTools: empty.alternativeTools,
    });
    expect(output).toContain('## Alternative tools');
    expect(output.match(/None listed\./g)).toHaveLength(3);
  });

  it('preserves the Claude Code command through feed parsing and text output', () => {
    const agentInterfaces = normalizePublicAgentInterfaces([{
      kind: 'mcp_server', status: 'official', source: 'mcp_registry', identifier: 'com.example/mcp',
      mcpRegistryObservation: {
        registryName: 'com.example/mcp', status: 'active', version: '1.0.0',
        observedAt: '2026-09-22T00:00:00.000Z',
        remotes: [{type: 'streamable-http', url: 'https://example.com/mcp'}],
      },
    }], {slug: 'example'});
    const source = {...toolDetail(), agentInterfaces};
    const parsed = toolDetailSchema.parse({...source, resourceIdentity: {...source.resourceIdentity, canonicalUrl: 'https://example.com/'}});
    const output = formatToolMarkdown({...parsed, agentInterfaces: parsed.agentInterfaces?.map(fillAgentSetupRecipeEntrySnippets)});
    expect(output).toContain('Claude Code setup (run in a POSIX shell in your project directory (local scope) — review before running):');
    expect(output.split('claude mcp add --transport http example https://example.com/mcp')).toHaveLength(2);
    expect(output).toContain('com.example/mcp v1.0.0');
    expect(parsed.agentInterfaces?.[0]?.setupRecipes).toContainEqual(expect.objectContaining({
      host: 'claude_code', entrySnippet: 'claude mcp add --transport http example https://example.com/mcp',
    }));
  });
  it('retains validated Publisher identity and escapes its Markdown label', () => {
    const publisher = {name: 'Example [Labs]', slug: 'example-labs', website: 'https://example.com/', profileUrl: 'https://slothhub.dev/publishers/example-labs'};
    const source = toolDetail();
    const parsed = toolDetailSchema.parse({...source, resourceIdentity: {...source.resourceIdentity, canonicalUrl: 'https://example.com/'}, publisher});
    expect(parsed.publisher).toEqual(publisher);
    expect(formatToolMarkdown({...source, publisher: parsed.publisher})).toContain('Publisher: [Example \\[Labs\\]](https://slothhub.dev/publishers/example-labs)');
    expect(formatToolMarkdown(source)).not.toContain('Publisher:');
    expect(toolDetailSchema.safeParse({...parsed, publisher: {...publisher, website: 'https://127.0.0.1/'}}).success).toBe(false);
  });

  it('prints deprecated interface documentation without offering its stored install command', () => {
    const output = formatToolMarkdown({...toolDetail(), agentInterfaces: normalizePublicAgentInterfaces([{
      kind: 'cli', status: 'deprecated', source: 'npm', identifier: 'old-package',
      docsUrl: 'https://example.com/old/docs', installCommand: 'npm install old-package',
    }])});
    expect(output).toContain('https://example.com/old/docs');
    expect(output).not.toContain('npm install old-package');
  });

  it('reads and renders generated installs and capability effects', () => {
    const keyFeatureDetails = [
      {kind: 'install', feature: 'Install', title: 'Install', summary: 'Add a package.', ecosystem: 'js', packageName: 'valibot', managers: ['npm'], commands: [{manager: 'npm', command: 'npm install valibot'}], sourceUrl: 'https://example.com/docs', checkedAt: '2026-10-20T00:00:00Z'},
      {kind: 'capability_list', feature: 'Tools', title: 'Tools', summary: 'Exposed tools.', listKind: 'mcp_tool', count: 1, items: [{name: 'delete_file', description: 'Delete a file.', effect: 'destructive'}], sourceUrl: 'https://example.com/docs', checkedAt: '2026-10-20T00:00:00Z'},
    ];
    const source = toolDetail();
    const parsed = toolDetailFeedSchema.parse({version: '33.0.0', siteUrl: 'https://slothhub.dev', generatedAt: '2026-10-20T00:00:00Z', data: {...source, resourceIdentity: {...source.resourceIdentity, canonicalUrl: 'https://example.com/'}, keyFeatureDetails}});
    expect(parsed.data.keyFeatureDetails).toEqual(keyFeatureDetails);
    expect(formatToolMarkdown(parsed.data)).toContain('npm install valibot');
    expect(formatToolMarkdown(parsed.data)).toContain('`delete_file` — Destructive');
  });
  it('reads and renders catalog 20 measurement and compatibility evidence', () => {
    const keyFeatureDetails = [
      {kind: 'benchmark', feature: 'Throughput', title: 'Throughput', summary: 'Illustrative results.', metric: 'Requests', value: '100', unit: 'req/s', claimant: 'vendor', sourceUrl: 'https://example.com/benchmarks', methodologyUrl: 'https://example.com/methodology', environment: {hardware: 'Documented host', version: '2.0', date: '2026-10-19'}},
      {kind: 'compatibility', feature: 'Runtime', title: 'Runtime support', summary: 'Reviewed compatibility.', rowKeys: ['bun'], rows: [{subjectKind: 'runtime', subjectName: 'Bun', environmentRange: 'Not documented', status: 'unknown', evidence: [], reviewedAt: '2026-10-19T00:00:00Z'}]},
    ];
    const source = toolDetail();
    const parsed = toolDetailFeedSchema.parse({version: '33.0.0', siteUrl: 'https://slothhub.dev', generatedAt: '2026-10-20T00:00:00Z', data: {...source, resourceIdentity: {...source.resourceIdentity, canonicalUrl: 'https://example.com/'}, keyFeatureDetails}});
    const output = formatToolMarkdown(parsed.data);
    expect(output).toContain('Vendor benchmark');
    expect(output).toContain('[Methodology](https://example.com/methodology)');
    expect(output).toContain('Bun Not documented: Unknown');
  });
  it('retains feature examples through feed parsing and presents commands separately from output', () => {
    const terminal = {kind: 'terminal', feature: 'CLI', title: 'Inspect the editor', summary: 'Check its version.', shell: 'powershell', command: 'code --version', workingDirectory: 'Project root', output: 'Example version'};
    const source = toolDetail();
    const parsed = toolDetailSchema.parse({...source, resourceIdentity: {...source.resourceIdentity, canonicalUrl: 'https://example.com/'}, keyFeatureDetails: [terminal]});
    expect(parsed.keyFeatureDetails).toEqual([terminal]);
    const output = formatToolMarkdown({...source, keyFeatureDetails: parsed.keyFeatureDetails});
    expect(output).toContain('Shell: powershell\n\nWorking directory: `Project root`');
    expect(output).toContain('```powershell\ncode --version\n```');
    expect(output).toContain('Example output:\n\n```text\nExample version\n```');
    expect(toolDetailSchema.safeParse({...parsed, keyFeatureDetails: [{...terminal, shell: 'imaginary'}]}).success).toBe(false);
  });
  it('preserves and renders every example from catalog 16.1', () => {
    const keyFeatureDetails = [
      {feature: 'Files', title: 'Files', summary: 'Read the example.', kind: 'code', files: [{filename: 'one.ts', language: 'typescript', code: 'one();'}, {filename: 'two.ts', language: 'typescript', code: 'two();'}]},
      {feature: 'Commands', title: 'Commands', summary: 'Choose a platform.', kind: 'terminal', variants: [{label: 'macOS', shell: 'bash', command: 'brew install example'}, {label: 'Windows', shell: 'powershell', command: 'winget install example'}]},
    ];
    const source = toolDetail();
    const parsed = toolDetailFeedSchema.parse({version: '33.1.0', siteUrl: 'https://slothhub.dev', generatedAt: '2026-10-17T00:00:00Z', data: {...source, resourceIdentity: {...source.resourceIdentity, canonicalUrl: 'https://example.com/'}, keyFeatureDetails}});
    expect(parsed.data.keyFeatureDetails).toEqual(keyFeatureDetails);
    const markdown = formatToolMarkdown(parsed.data);
    expect(markdown).toContain('two.ts');
    expect(markdown).toContain('winget install example');
  });
  it.each(['makefile', 'just', 'dockerfile', 'nix', 'ini', 'php', 'swift'])('reads catalog 16 %s examples and renders placeholder guidance', (language) => {
    const detail = {kind: 'code', feature: 'Setup', title: 'Setup', summary: 'Configure the tool.', language, code: 'YOUR_API_KEY', placeholderNote: 'Use a key from account settings.'};
    const source = toolDetail();
    const parsed = toolDetailFeedSchema.parse({version: '33.0.0', siteUrl: 'https://slothhub.dev', generatedAt: '2026-10-17T00:00:00Z', data: {...source, resourceIdentity: {...source.resourceIdentity, canonicalUrl: 'https://example.com/'}, keyFeatureDetails: [detail]}});
    expect(parsed.data.keyFeatureDetails).toEqual([detail]);
    expect(formatToolMarkdown(parsed.data)).toContain('Use a key from account settings');
  });
  it('retains and renders structured limits and feature sources through MCP', () => {
    const limits = {kind: 'limits', feature: 'Free API', title: 'Free API', summary: 'Terms.', sourceUrl: 'https://example.com/docs', entries: [{type: 'quota', label: 'Requests', value: '10,000', unit: 'calls', period: 'day', sourceUrl: 'https://example.com/pricing'}]};
    const source = toolDetail();
    const parsed = toolDetailSchema.parse({...source, resourceIdentity: {...source.resourceIdentity, canonicalUrl: 'https://example.com/'}, keyFeatureDetails: [limits]});
    expect(parsed.keyFeatureDetails).toEqual([limits]);
    const output = formatToolMarkdown({...source, keyFeatureDetails: parsed.keyFeatureDetails});
    expect(output).toContain('Requests: 10,000 calls/day');
    expect(output).toContain('[Docs](https://example.com/docs)');
    expect(output).toContain('[Source](https://example.com/pricing)');
  });
  it('preserves app command context and paired code references through MCP parsing and Markdown', () => {
    const details = [
      {kind: 'code', feature: 'File', title: 'File', summary: 'Save recipes.', language: 'text', code: 'test:'},
      {kind: 'terminal', feature: 'Run', title: 'Run', summary: 'Run recipes.', shell: 'bash', command: 'just test', pairedWith: 'File'},
      {kind: 'slash_command', feature: 'Plugin', title: 'Plugin', summary: 'Install it.', host: 'Claude Code', command: '/plugin install example'},
    ];
    const source = toolDetail();
    const parsed = toolDetailSchema.parse({...source, resourceIdentity: {...source.resourceIdentity, canonicalUrl: 'https://example.com/'}, keyFeatureDetails: details});
    expect(parsed.keyFeatureDetails).toEqual(details);
    const output = formatToolMarkdown({...source, keyFeatureDetails: parsed.keyFeatureDetails});
    expect(output).toContain('Run in Claude Code');
    expect(output).toContain('```text\n/plugin install example\n```');
    expect(output).toContain('Uses: File');
  });

  it('prints target audience and free trial facts when present', () => {
    const output = formatToolMarkdown({
      ...toolDetail(),
      targetAudience: 'Product designers',
      pricingDetails: {trialAvailability: 'available'},
    });

    expect(output).toContain('- Target audience: Product designers');
    expect(output).toContain('- Free trial: Available');
  });

  it('omits audience and free-trial rows when absent or unavailable', () => {
    const output = formatToolMarkdown(toolDetail());
    expect(output).not.toContain('Target audience:');
    expect(output).not.toContain('Free trial:');

    const unavailable = formatToolMarkdown({
      ...toolDetail(),
      pricingDetails: {trialAvailability: 'unavailable'},
    });
    expect(unavailable).not.toContain('Free trial:');
  });

  it('prints populated comparison facts under their own heading', () => {
    const output = formatToolMarkdown({
      ...toolDetail(),
      comparisonFacts: {
        bestFor: ['Design-led teams'],
        strengths: ['Fast canvas'],
        limitations: ['No offline mode'],
        lastReviewedAt: '2026-07-01T00:00:00.000Z',
      },
    });

    expect(output).toContain('## Comparison facts');
    expect(output).toContain('### Best for');
    expect(output).toContain('- Design-led teams');
    expect(output).toContain('### Strengths');
    expect(output).toContain('- Fast canvas');
    expect(output).toContain('### Limitations');
    expect(output).toContain('- No offline mode');
    expect(output).toContain(
      'Comparison facts reviewed: 2026-07-01T00:00:00.000Z',
    );
  });

  it('omits the comparison facts section when the object is missing or empty', () => {
    expect(formatToolMarkdown(toolDetail())).not.toContain('Comparison facts');
    expect(
      formatToolMarkdown({...toolDetail(), comparisonFacts: {}}),
    ).not.toContain('Comparison facts');
    expect(
      formatToolMarkdown({
        ...toolDetail(),
        comparisonFacts: {strengths: [], limitations: []},
      }),
    ).not.toContain('Comparison facts');
  });

  it('keeps comparison facts distinct from fit guidance', () => {
    const output = formatToolMarkdown({
      ...toolDetail(),
      fitGuidance: {
        bestFor: ['Solo makers'],
        notIdealFor: [],
        keyTradeoffs: [],
        primaryDecisionCriteria: [],
      },
      comparisonFacts: {limitations: ['Requires account']},
    });

    expect(output).toContain('## Tool fit guidance');
    expect(output).toContain('## Comparison facts');
    expect(output).toContain('- Requires account');
  });

  it('escapes catalog-controlled comparison fact text', () => {
    const output = formatToolMarkdown({
      ...toolDetail(),
      comparisonFacts: {
        limitations: ['<img src=x> [click](javascript:alert(1))'],
      },
    });

    expect(output).toContain('\\<img');
    expect(output).toContain('\\[click\\]');
  });

  it('prints resource identity, taxonomy, freshness, and public resource links', () => {
    const output = formatToolMarkdown({
      ...toolDetail(),
      categories: [{name: 'Design', slug: 'design'}],
      tags: [{name: 'UI', slug: 'ui'}],
      useCases: [{name: 'Prototyping', slug: 'prototyping'}],
      freshness: {
        isVerified: true,
        verifiedAt: '2026-07-01T00:00:00.000Z',
        lastCheckedAt: '2026-07-02T00:00:00.000Z',
        destinationHealth: {
          website: {status: 'ok', lastProbedAt: '2026-07-02T00:00:00.000Z'},
          affiliateUrl: {status: 'dead', deadSince: '2026-06-30T00:00:00.000Z'},
        },
      },
      resourceLinks: [
        {
          label: 'Docs',
          url: 'https://example.com/docs',
          kind: 'official_docs',
          isOfficial: true,
        },
        {
          label: 'Tracked',
          url: 'https://slothhub.dev/go/example?surface=agent',
          kind: 'other',
          isOfficial: false,
        },
      ],
    });

    expect(output).toContain(
      '- Identity: Website — https://example.com',
    );
    expect(output).toContain('## Taxonomy');
    expect(output).toContain('- Categories: Design (`design`)');
    expect(output).toContain('- Tags: UI (`ui`)');
    expect(output).toContain('- Use cases: Prototyping (`prototyping`)');
    expect(output).toContain('## Freshness');
    expect(output).toContain('- Verified: yes (2026-07-01T00:00:00.000Z)');
    expect(output).toContain('- Last checked: 2026-07-02T00:00:00.000Z');
    expect(output).toContain('website: ok');
    expect(output).toContain('affiliate URL: dead');
    expect(output).toContain('## Resource links');
    expect(output).toContain('**Docs** (Official docs): https://example.com/docs');
    // The tracked /go/ link is filtered from resource links; only the
    // header's own Visit line may carry a tracked URL.
    expect(output).not.toContain('**Tracked**');
  });

  it('prints registry ID when the identity carries one', () => {
    const output = formatToolMarkdown({
      ...toolDetail(),
      resourceIdentity: {
        kind: 'npm_package',
        kindLabel: 'npm package',
        canonicalUrl: 'https://www.npmjs.com/package/x',
        ctaLabel: 'Open package',
        registryId: 'npm:x',
      },
    });

    expect(output).toContain('- Identity: npm package — https://www.npmjs.com/package/x');
    expect(output).toContain('- Registry ID: `npm:x`');
  });

  it('says none listed for empty taxonomy and unknown freshness states', () => {
    const output = formatToolMarkdown({
      ...toolDetail(),
      categories: [],
      tags: [],
      useCases: [],
      freshness: {isVerified: false},
      resourceLinks: [],
    });

    expect(output).toContain('- Categories: none listed');
    expect(output).toContain('- Tags: none listed');
    expect(output).toContain('- Use cases: none listed');
    expect(output).toContain('- Verified: no');
    expect(output).toContain('- Last checked: unknown');
    expect(output).toContain('Destination health: not probed');
    expect(output).toContain('none listed');
    expect(output).toContain('## Resource links');
  });

  it('omits the resource links section when the collection is missing', () => {
    const output = formatToolMarkdown(toolDetail());
    expect(output).not.toContain('## Resource links');
  });

  it('prints a Quickstart section with label, status, command, docs, and notice', () => {
    const output = formatToolMarkdown({
      ...toolDetail(),
      quickstarts: [
        {
          kind: 'install_command',
          label: 'Install package',
          status: 'official',
          statusLabel: 'Official',
          command: 'npm install example-cli',
          commandLanguage: 'shell',
          docsUrl: 'https://example.com/docs',
          source: 'npm',
          sourceLabel: 'npm',
        },
        {
          kind: 'clone_repository',
          label: 'Clone repository',
          status: 'official',
          statusLabel: 'Official',
          command: 'git clone https://github.com/example/tool',
          commandLanguage: 'shell',
          docsUrl: 'https://github.com/example/tool',
          notice: 'This repository has been archived.',
        },
        {
          kind: 'open_docs',
          label: 'Open usage docs',
          status: 'community',
          statusLabel: 'Community',
          docsUrl: 'https://example.com/usage',
        },
      ],
    });

    expect(output).toContain('## Quickstarts\n');
    expect(output).toContain('- **Install package** (Official) — source: npm — command: `npm install example-cli` — docs: `https://example.com/docs`');
    expect(output).toContain('- **Clone repository** (Official) — command: `git clone https://github.com/example/tool` — docs: `https://github.com/example/tool` — notice: This repository has been archived.');
    expect(output).toContain('- **Open usage docs** (Community) — docs: `https://example.com/usage`');
  });

  it('keeps injected docs markdown inert even with backticks', () => {
    const output = formatToolMarkdown({
      ...toolDetail(),
      quickstarts: [{
        kind: 'open_docs',
        label: 'Open docs',
        status: 'official',
        statusLabel: 'Official',
        docsUrl: '[click](javascript:alert(1)) <script> `docs`',
      }],
    });

    expect(output).toContain('docs: `` [click](javascript:alert(1)) <script> `docs` ``');
  });

  it('keeps quickstart commands inert inline code even with backticks', () => {
    const output = formatToolMarkdown({
      ...toolDetail(),
      quickstarts: [
        {
          kind: 'install_command',
          label: 'Install package',
          status: 'official',
          statusLabel: 'Official',
          command: 'npm install `pkg`',
          commandLanguage: 'shell',
        },
      ],
    });

    expect(output).toContain('command: `` npm install `pkg` ``');
  });

  it('escapes catalog-controlled quickstart text against markdown injection', () => {
    const output = formatToolMarkdown({
      ...toolDetail(),
      quickstarts: [
        {
          kind: 'open_docs',
          label: 'Docs [click](javascript:alert(1))',
          status: 'official',
          statusLabel: 'Official',
          docsUrl: 'https://example.com/docs',
          sourceLabel: 'evil *source*',
          notice: 'Archived <script>alert(1)</script>',
        },
      ],
    });

    expect(output).toContain('\\[click\\]');
    expect(output).toContain('\\*source\\*');
    expect(output).toContain('\\<script\\>');
    expect(output).not.toContain('[click](javascript:alert(1))');
  });

  it('omits the Quickstart section when quickstarts are missing or empty', () => {
    expect(formatToolMarkdown(toolDetail())).not.toContain('Quickstart');
    expect(
      formatToolMarkdown({...toolDetail(), quickstarts: []}),
    ).not.toContain('Quickstart');
  });

  it('escapes catalog-controlled resource link text', () => {
    const output = formatToolMarkdown({
      ...toolDetail(),
      resourceLinks: [
        {
          label: 'Evil <script>',
          url: 'https://example.com/x',
          kind: 'other',
          isOfficial: false,
        },
      ],
    });

    expect(output).toContain('\\<script\\>');
  });

  it('prints public source references with type and checked date, never /go/', () => {
    const output = formatToolMarkdown({
      ...toolDetail(),
      sourceReferences: [
        {
          title: 'Pricing page',
          url: 'https://example.com/pricing',
          sourceType: 'pricing_page',
          checkedAt: '2026-07-01',
        },
        {
          title: 'Hands-on notes',
          url: 'https://notes.example.com/review',
          sourceType: 'hands_on_test',
        },
        {
          title: 'Tracked visit',
          url: 'https://slothhub.dev/go/example',
          sourceType: 'other',
        },
      ],
    });

    expect(output).toContain('## Source references');
    expect(output).toContain(
      '- **Pricing page** (`pricing_page`): https://example.com/pricing — checked 2026-07-01',
    );
    expect(output).toContain(
      '- **Hands-on notes** (`hands_on_test`): https://notes.example.com/review',
    );
    expect(output).not.toContain('Tracked visit');
  });

  it('omits the source references section when missing or empty', () => {
    expect(formatToolMarkdown(toolDetail())).not.toContain('Source references');
    expect(
      formatToolMarkdown({...toolDetail(), sourceReferences: []}),
    ).not.toContain('Source references');
    expect(
      formatToolMarkdown({
        ...toolDetail(),
        sourceReferences: [
          {
            title: 'Tracked only',
            url: 'https://slothhub.dev/go/example',
            sourceType: 'other',
          },
        ],
      }),
    ).not.toContain('Source references');
  });

  it('escapes catalog-controlled source reference text', () => {
    const output = formatToolMarkdown({
      ...toolDetail(),
      sourceReferences: [
        {
          title: 'Evil <script> [click](javascript:alert(1))',
          url: 'https://example.com/x',
          sourceType: 'other',
        },
      ],
    });

    expect(output).toContain('\\<script\\>');
    expect(output).toContain('\\[click\\]');
  });

  it('bounds the rendered source reference list and points at JSON', () => {
    const output = formatToolMarkdown({
      ...toolDetail(),
      sourceReferences: Array.from({length: 55}, (_, index) => ({
        title: `Reference ${index + 1}`,
        url: `https://example.com/ref-${index + 1}`,
        sourceType: 'other' as const,
      })),
    });

    expect(output).toContain('## Source references');
    expect(output).toContain('Reference 50');
    expect(output).not.toContain('Reference 51');
    expect(output).toContain('5 more source references in the JSON payload');
  });
});

it('retains portability facts through parsing and formats checked export coverage', () => {
  const checkedAt = '2026-07-20T00:00:00.000Z';
  const portability = normalizePublicToolPortability({formats: [{name: 'CSV', direction: 'export', supportMode: 'partial', checkedAt, evidenceReferenceKeys: ['guide']}]}, [{_key: 'guide', title: 'Export guide', url: 'https://example.com/export', sourceType: 'official_docs', visibility: 'public', checkedAt}], {_id: 'current'});
  const parsed = toolDetailSchema.parse({...toolDetail(), resourceIdentity: {...toolDetail().resourceIdentity, canonicalUrl: 'https://example.com/'}, portability});
  expect(parsed.portability).toEqual(portability);
  const output = formatToolMarkdown({...toolDetail(), portability: parsed.portability});
  expect(output).toContain('CSV · Export');
  expect(output).toContain('Support: Partial');
  expect(output).toContain('https://example.com/export');
});

it('retains lifecycle facts through parsing and renders evidence in detail output', () => {
  const checkedAt = '2026-07-20T00:00:00.000Z';
  const lifecycle = normalizePublicToolLifecycle({releaseModel: 'versioned', checkedAt, evidenceReferenceKeys: ['policy']}, [{_key: 'policy', title: 'Support policy', url: 'https://example.com/support', sourceType: 'official_docs', visibility: 'public', checkedAt}]);
  const parsed = toolDetailSchema.parse({...toolDetail(), resourceIdentity: {...toolDetail().resourceIdentity, canonicalUrl: 'https://example.com/'}, lifecycle});
  expect(parsed.lifecycle).toEqual(lifecycle);
  const output = formatToolMarkdown({...toolDetail(), lifecycle: parsed.lifecycle});
  expect(output).toContain('Lifecycle');
  expect(output).toContain('Release model: Versioned');
  expect(output).toContain('https://example.com/support');
});

it('retains UI component handoff through MCP parsing and Markdown output', () => {
  const uiComponent = {sourceUrl: 'https://example.com/button', authorName: 'Example studio', original: false, license: 'MIT', licenseUrl: 'https://example.com/LICENSE', frameworks: ['React'], dependencies: ['motion'], variants: ['Dark'], prompt: 'Build a button.', previewImageUrl: 'https://cdn.sanity.io/images/project/production/button.png', previewAlt: 'Blue button'};
  const parsed = toolDetailSchema.parse({...toolDetail(), resourceIdentity: {...toolDetail().resourceIdentity, canonicalUrl: 'https://example.com/'}, resourceKind: {value: 'ui_component', label: 'UI component'}, uiComponent});
  expect(parsed.uiComponent).toEqual(uiComponent);
  expect(formatToolMarkdown({...toolDetail(), uiComponent: parsed.uiComponent})).toContain('Build a button.');
  expect(formatToolMarkdown({...toolDetail(), uiComponent: parsed.uiComponent})).toContain('https://example.com/LICENSE');
});

it('reads catalog 24 registry evidence and XML examples', () => {
  const source = toolDetail();
  const sourceReferences = [{title: 'Registry', url: 'https://registry.npmjs.org/example/latest', sourceType: 'package_registry'}];
  const keyFeatureDetails = [{kind: 'code', feature: 'Config', title: 'Config', summary: 'Configures the tool.', language: 'xml', code: '<config />'}];
  const parsed = toolDetailFeedSchema.parse({version: '33.0.0', siteUrl: 'https://slothhub.dev', generatedAt: '2026-10-20T00:00:00Z', data: {...source, resourceIdentity: {...source.resourceIdentity, canonicalUrl: 'https://example.com/'}, sourceReferences, keyFeatureDetails}});
  expect(parsed.data.sourceReferences).toEqual(sourceReferences);
  expect(formatToolMarkdown(parsed.data)).toContain('<config />');
});
it('keeps list and promotional prices distinct in agent markdown', () => {
  const output = formatToolMarkdown({...toolDetail(), pricingDetails: {currency: 'USD', plans: [{name: 'Pro', listPrice: 25, promoPrice: 18, billing: 'monthly', promoNote: 'First year only'}]}});
  expect(output).toContain('Plan Pro: list 25 USD; promotional 18 USD; monthly; First year only');
});
it('renders a custom plan as Custom instead of a missing amount', () => {
  const output = formatToolMarkdown({...toolDetail(), pricingDetails: {currency: 'USD', plans: [{name: 'Enterprise', priceType: 'custom', billing: 'Custom pricing, per seat'}]}});
  expect(output).toContain('Plan Enterprise: Custom; Custom pricing, per seat');
  expect(output).not.toContain('undefined');
  expect(output).not.toContain('list 0');
});

it('preserves structured amount periods and public notes in MCP detail Markdown', () => {
  const source = toolDetail();
  source.resourceIdentity.canonicalUrl = 'https://example.com/';
  const parsed = toolDetailSchema.parse({...source, pricingDetails: {currency: 'USD', notes: 'Annual commitment.', plans: [{name: 'Pro', listPrice: 12, billing: 'Per month, paid yearly', billingPeriod: 'month'}]}});
  const output = formatToolMarkdown({...source, pricingDetails: parsed.pricingDetails});
  expect(output).toContain('Amount period: month');
  expect(output).toContain('Pricing note: Annual commitment');
});
