import {normalizePublicToolPortability} from '@slothhub/domain/tool-portability';
import {parseToolDetailFeed} from '@slothhub/domain/public-feed-schemas';
import {normalizePublicToolLifecycle} from '@slothhub/domain/tool-lifecycle';
import {normalizePublicAgentInterfaces} from '@slothhub/domain/agent-interface';
import {describe, expect, it} from 'vite-plus/test';

import {formatSearchResults, formatTool, toSearchJsonHit} from './catalogFormat.js';
import {figmaTool, linearTool, toolDetailFeed} from './fixtures.js';
import type {AgentSearchIndexTool, AgentToolDetail} from './types.js';

const appDetail = (): AgentToolDetail => structuredClone(toolDetailFeed.data);

describe('Tool decision context', () => {
  it('keeps empty deals headings and disclaimers on separate lines', () => {
    const lines = formatTool({...appDetail(), deals: []}).split('\n');
    expect(lines).toContain('## Verified deals');
    expect(lines).toContain('Offers are verified as of the catalog build; recheck the source before purchase. Commercial disclosures apply.');
    expect(lines).toContain('No active verified deals in this catalog snapshot.');
  });
  it('retains current deals through feed parsing and displays expiry and disclosure', () => {
    const checkedAt = new Date().toISOString();
    const deal = {id: 'offer', title: 'Save 20%', description: 'Annual offer', discountPercent: 20,
      eligibility: 'New customers', termsSummary: 'Annual plans only', commercialDisclosure: 'Affiliate offer',
      sourceUrl: 'https://example.com/offer', verifiedAt: checkedAt, lastSourceCheckedAt: checkedAt,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString()};
    const feed = {...toolDetailFeed, data: {...appDetail(), deals: [deal], contentSignal: 'search=yes, ai-input=yes' as const}};
    const parsed = parseToolDetailFeed(feed, '/api/tools/example.json');
    expect(parsed.data.deals).toEqual([deal]);
    const output = formatTool(parsed.data);
    expect(output.split('\n')).toContain('## Verified deals');
    expect(output.split('\n')).toContain('  - Eligibility: New customers');
    expect(output.split('\n')).toContain('  - Terms: Annual plans only');
    expect(output.split('\n')).toContain('  - Source: <https://example.com/offer>');
    for (const text of [deal.expiresAt, deal.eligibility, deal.termsSummary, deal.commercialDisclosure, deal.sourceUrl, feed.data.contentSignal]) expect(output).toContain(text);
    expect(formatTool(parseToolDetailFeed({...feed, data: {...feed.data, deals: [{...deal, expiresAt: '2020-01-01T00:00:00Z'}]}}, 'expired').data)).not.toContain(deal.title);
  });

  it('includes populated compatibility, evidence, and alternatives without terminal controls', () => {
    const output = formatTool({...appDetail(),
      integrations: [{name: 'GitHub', slug: 'github', status: 'native'}],
      securityPrivacyPosture: {securityCapabilities: [{label: '\u001b[31mSSO\u202e', capability: 'sso_saml', status: 'claimed', sourceUrl: 'https://example.com/security'}]},
      alternativeTools: [{...toolDetailFeed.data, name: 'Penpot', slug: 'penpot', detailUrl: 'https://slothhub.dev/tool/penpot'}],
    });
    expect(output).toContain('## Works with\n');
    expect(output).toContain('GitHub (github): native');
    expect(output).toContain('sso_saml): claimed');
    expect(output).toContain('source https://example.com/security');
    expect(output).toContain('Penpot (penpot): https://slothhub.dev/tool/penpot');
    expect(output).not.toMatch(/[\u001b\u202e]/u);
  });
});

const mcpServerDetail = (): AgentToolDetail => ({
  ...appDetail(),
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
});

const agentSkillDetail = (): AgentToolDetail => ({
  ...appDetail(),
  name: 'Code review skill',
  slug: 'code-review-skill',
  description: 'A reusable agent skill for code review',
  resourceKind: {value: 'agent_skill', label: 'Agent skill'},
  agentInterfaces: [
    {
      kind: 'agent_skill',
      status: 'community',
      label: 'Code review skill',
    },
  ],
  keyFeatures: [],
  productLimits: undefined,
  runtimeRequirements: undefined,
});

const mcpServerSearchTool = (): AgentSearchIndexTool => ({
  ...structuredClone(figmaTool),
  name: 'Playwright MCP',
  slug: 'playwright-mcp',
  description: 'Browser automation as an MCP server',
  resourceKind: {value: 'mcp_server', label: 'MCP server'},
  agentInterfaceKinds: ['mcp_server'],
  detailUrl: 'https://slothhub.dev/tool/playwright-mcp',
  search: {
    ...figmaTool.search,
    fields: {
      ...figmaTool.search.fields,
      name: 'Playwright MCP',
      description: 'Browser automation as an MCP server',
      resourceKind: ['MCP server', 'mcp_server'],
      agentInterfaceKinds: ['mcp_server'],
    },
  },
});

const appSearchTool = (): AgentSearchIndexTool => {
  const tool = structuredClone(linearTool);
  tool.agentInterfaceKinds = [];
  return tool;
};

describe('formatTool', () => {
  it('distinguishes a promotion from the list price and preserves its conditions', () => {
    const output = formatTool({...appDetail(), pricingDetails: {currency: 'USD', plans: [{name: 'Pro', listPrice: 25, promoPrice: 18, billing: 'per month, billed annually', promoNote: 'First year only'}]}});
    expect(output).toContain('Plan Pro: list 25 USD; promotional 18 USD; per month, billed annually; First year only');
  });
  it('renders a custom plan as Custom instead of a missing amount', () => {
    const output = formatTool({...appDetail(), pricingDetails: {currency: 'USD', plans: [{name: 'Enterprise', priceType: 'custom', billing: 'Custom, contact sales'}]}});
    expect(output).toContain('Plan Enterprise: Custom; Custom, contact sales');
    expect(output).not.toContain('undefined');
    expect(output).not.toContain('Starting price:');
  });
  it('keeps each line of a UI component block, including multiline prompts', () => {
    const output = formatTool({...appDetail(), uiComponent: {sourceUrl: 'https://example.com/button', authorName: 'Example studio', original: false, license: 'MIT', licenseUrl: 'https://example.com/LICENSE', frameworks: ['React'], dependencies: [], variants: [], prompt: 'First step.\nSecond step.', previewImageUrl: 'https://cdn.sanity.io/images/project/production/button.png', previewAlt: 'Blue button'}});
    expect(output).toMatch(/First step\.\n/u);
    expect(output).not.toContain('First step.Second step.');
  });

  it('includes the official pricing URL and starting price from the feed', () => {
    const output = formatTool({...appDetail(), pricingDetails: {
      pricingUrl: 'https://example.com/pricing', startingPrice: 12, currency: 'USD',
    }});
    expect(output).toContain('Official pricing: https://example.com/pricing');
    expect(output).toContain('Starting price: 12 USD');
  });

  it('includes a pricing URL without inventing a starting price', () => {
    const output = formatTool({...appDetail(), pricingDetails: {pricingUrl: 'http://example.com/pricing'}});
    expect(output).toContain('Official pricing: http://example.com/pricing');
    expect(output).not.toContain('Starting price:');
  });

  it.each([undefined, {}, {currency: 'USD' as const}])('omits absent pricing details (%j)', (pricingDetails) => {
    const output = formatTool({...appDetail(), pricingDetails});
    expect(output).not.toContain('Official pricing:');
    expect(output).not.toContain('Starting price:');
  });

  it('preserves a zero starting price without inventing a currency', () => {
    const output = formatTool({...appDetail(), pricingDetails: {startingPrice: 0}});
    expect(output.split('\n')).toContain('Starting price: 0');
  });

  it.each([
    '', '/go/example', 'https://slothhub.dev/go/example', 'https://slothhub.dev/go',
    'https://user:password@example.com/pricing', 'javascript:alert(1)',
  ])('omits unsafe or empty official pricing URLs (%s)', (pricingUrl) => {
    const output = formatTool({...appDetail(), pricingDetails: {pricingUrl}});
    expect(output).not.toContain('Official pricing:');
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
    const source = {...appDetail(), agentInterfaces};
    const parsed = parseToolDetailFeed({...toolDetailFeed, data: source}, '/api/tools/example.json').data;
    const output = formatTool(parsed);
    expect(output).toContain('Claude Code setup (run in a POSIX shell in your project directory (local scope) — review before running):');
    expect(output.split('claude mcp add --transport http example https://example.com/mcp')).toHaveLength(2);
    expect(output).toContain('com.example/mcp v1.0.0');
    expect(parsed.agentInterfaces?.[0]?.setupRecipes).toContainEqual(expect.objectContaining({
      host: 'claude_code', entrySnippet: 'claude mcp add --transport http example https://example.com/mcp',
    }));
  });
  it('prints a Publisher profile only when the catalog supplies one', () => {
    const publisher = {name: 'Example Labs', slug: 'example-labs', website: 'https://example.com/', profileUrl: 'https://slothhub.dev/publishers/example-labs'};
    expect(formatTool({...appDetail(), publisher})).toContain('Publisher: Example Labs — https://slothhub.dev/publishers/example-labs');
    expect(formatTool(appDetail())).not.toContain('Publisher:');
  });

  it('prints deprecated interface documentation without offering its stored install command', () => {
    const output = formatTool({...appDetail(), agentInterfaces: normalizePublicAgentInterfaces([{
      kind: 'cli', status: 'deprecated', source: 'npm', identifier: 'old-package',
      docsUrl: 'https://example.com/old/docs', installCommand: 'npm install old-package',
    }])});
    expect(output).toContain('https://example.com/old/docs');
    expect(output).not.toContain('npm install old-package');
  });

  it('prints multiline feature commands and separates their example output', () => {
    const output = formatTool({...appDetail(), keyFeatureDetails: [{kind: 'terminal', feature: 'CLI', title: 'Inspect the editor', summary: 'Check version and extensions.', shell: 'bash', command: 'code --version\ncode --list-extensions', output: 'example.extension'}]});
    expect(output).toContain('```bash\ncode --version\ncode --list-extensions\n```');
    expect(output).toContain('Example output:\n\n```text\nexample.extension\n```');
  });

  it('prints Resource kind for an app and does not treat it as an MCP server', () => {
    const output = formatTool(appDetail());

    expect(output).toContain('Resource kind: App (app)');
    expect(output).not.toContain('Resource kind: MCP server');
    expect(output).not.toContain('Agent interface kinds:');
  });

  it('prints Resource kind and Agent interface kinds for an MCP server', () => {
    const output = formatTool(mcpServerDetail());

    expect(output).toContain('Resource kind: MCP server (mcp_server)');
    expect(output).toContain('Agent interface kinds: MCP server (mcp_server)');
    expect(output).toContain('Agent interfaces:');
  });

  it('prints Resource kind and Agent interface kinds for an agent skill', () => {
    const output = formatTool(agentSkillDetail());

    expect(output).toContain('Resource kind: Agent skill (agent_skill)');
    expect(output).toContain('Agent interface kinds: Agent skill (agent_skill)');
  });

  it('prints unknown/not specified when Resource kind is missing instead of defaulting to app', () => {
    const output = formatTool({
      ...appDetail(),
      resourceKind: {value: '', label: ''},
    });

    expect(output).toContain('Resource kind: unknown (not specified)');
    expect(output).not.toMatch(/Resource kind: App \(app\)/u);
  });

  it('does not coerce an unrecognized Resource kind value to app', () => {
    const output = formatTool({
      ...appDetail(),
      resourceKind: {value: 'saas', label: ''},
    });

    expect(output).toContain('Resource kind: unknown (saas)');
    expect(output).not.toContain('Resource kind: App (app)');
  });

  it('prints target audience and free trial facts when present', () => {
    const output = formatTool({
      ...appDetail(),
      targetAudience: 'Product designers',
      pricingDetails: {trialAvailability: 'available'},
    });

    expect(output).toContain('Target audience: Product designers');
    expect(output).toContain('Free trial: Available');
  });

  it('omits audience and free-trial lines when absent or unavailable', () => {
    const {targetAudience: _targetAudience, ...withoutAudience} = appDetail();
    const output = formatTool(withoutAudience);

    expect(output).not.toContain('Target audience:');
    expect(output).not.toContain('Free trial:');

    const unavailable = formatTool({
      ...withoutAudience,
      pricingDetails: {trialAvailability: 'unavailable'},
    });
    expect(unavailable).not.toContain('Free trial:');
  });

  it('prints source-backed trial terms under the free-trial line', () => {
    const output = formatTool({
      ...appDetail(),
      pricingDetails: {
        trialAvailability: 'available',
        trialTerms: {
          planName: 'Pro',
          duration: '14 days',
          cardRequirement: 'not_required',
          endBehavior: 'reverts_to_free',
          evidence: [{
            title: 'Trial terms FAQ',
            url: 'https://example.com/trial-terms',
            sourceType: 'official_docs',
            checkedAt: '2026-07-20T00:00:00.000Z',
          }],
          reviewedAt: '2026-07-22T00:00:00.000Z',
        },
      },
    });

    expect(output).toContain('Free trial: Available');
    expect(output).toContain('Trial plan: Pro');
    expect(output).toContain('Trial length: 14 days');
    expect(output).toContain('Card required: No');
    expect(output).toContain('When the trial ends: Reverts to free plan');
    expect(output).toContain('Trial terms source: https://example.com/trial-terms');
  });

  it('prints the observed Last GitHub push stamp when the observation carries one', () => {
    const output = formatTool({
      ...appDetail(),
      repositoryObservation: {
        status: 'ok',
        pushedAt: '2025-08-04T12:00:00.000Z',
        fetchedAt: '2026-09-13T06:00:00.000Z',
      },
    });

    expect(output).toContain('Last GitHub push August 4, 2025 (observed September 13, 2026)');
  });

  it('omits the Last GitHub push line when the observation lacks a push date', () => {
    const output = formatTool({
      ...appDetail(),
      repositoryObservation: {status: 'ok', fetchedAt: '2026-09-13T06:00:00.000Z'},
    });

    expect(output).not.toContain('Last GitHub push');
  });

  it('prints populated comparison facts under their own heading', () => {
    const output = formatTool({
      ...appDetail(),
      comparisonFacts: {
        bestFor: ['Design-led teams'],
        strengths: ['Fast canvas'],
        limitations: ['No offline mode'],
        lastReviewedAt: '2026-07-01T00:00:00.000Z',
      },
    });

    expect(output).toContain('Comparison facts:');
    expect(output).toContain('Best for:');
    expect(output).toContain('- Design-led teams');
    expect(output).toContain('Strengths:');
    expect(output).toContain('- Fast canvas');
    expect(output).toContain('Limitations:');
    expect(output).toContain('- No offline mode');
    expect(output).toContain(
      'Comparison facts reviewed: 2026-07-01T00:00:00.000Z',
    );
  });

  it('omits the comparison facts block when the object is missing or empty', () => {
    expect(formatTool(appDetail())).not.toContain('Comparison facts');
    expect(
      formatTool({...appDetail(), comparisonFacts: {}}),
    ).not.toContain('Comparison facts');
    expect(
      formatTool({
        ...appDetail(),
        comparisonFacts: {strengths: [], limitations: []},
      }),
    ).not.toContain('Comparison facts');
  });

  it('prints notes-only comparison facts through the shared Tool formatter', () => {
    const output = formatTool({...appDetail(), comparisonFacts: {
      pricingNotes: 'Free plan available',
      platformNotes: 'Web only',
      migrationNotes: 'Export before switching',
    }});

    expect(output).toContain('Comparison facts:\nPricing: Free plan available\nPlatforms: Web only\nMigration: Export before switching');
  });

  it('keeps comparison facts distinct from fit guidance', () => {
    const output = formatTool({
      ...appDetail(),
      fitGuidance: {
        bestFor: ['Solo makers'],
        notIdealFor: [],
        keyTradeoffs: [],
        primaryDecisionCriteria: [],
      },
      comparisonFacts: {limitations: ['Requires account']},
    });

    expect(output).toContain('Tool fit guidance');
    expect(output).toContain('Comparison facts:');
    expect(output).toContain('- Requires account');
  });

  it('prints resource identity, taxonomy, freshness, and public resource links', () => {
    const output = formatTool(appDetail());

    expect(output).toContain('Identity: Website — https://figma.com/');
    expect(output).toContain('Categories: Design (design)');
    expect(output).toContain('Tags: Prototyping (prototyping)');
    expect(output).toContain('Use cases: Design systems (design-systems)');
    expect(output).toContain('Verified: yes (2026-07-01T00:00:00.000Z)');
    expect(output).toContain('Last checked: 2026-07-14T00:00:00.000Z');
    expect(output).toContain('Destination health: not probed');
    expect(output).toContain('Resource links:');
    expect(output).toContain(
      '- Official docs (Official docs): https://help.figma.com/',
    );
  });

  it('keeps verified and destination health distinct and reports unknown states', () => {
    const output = formatTool({
      ...appDetail(),
      freshness: {
        isVerified: false,
        destinationHealth: {
          website: {status: 'dead', deadSince: '2026-06-30T00:00:00.000Z'},
        },
      },
      resourceLinks: [],
    });

    expect(output).toContain('Verified: no');
    expect(output).toContain('Last checked: unknown');
    expect(output).toContain('website: dead');
    expect(output).toContain('Resource links: none listed');
  });

  it('omits the resource links block when the collection is missing', () => {
    const output = formatTool({...appDetail(), resourceLinks: undefined});
    expect(output).not.toContain('Resource links');
  });

  it('omits /go/ tracked URLs from resource links', () => {
    const output = formatTool({
      ...appDetail(),
      resourceLinks: [
        {
          label: 'Tracked',
          url: 'https://slothhub.dev/go/figma?surface=agent',
          kind: 'other',
          isOfficial: false,
        },
      ],
    });

    expect(output).not.toContain('- Tracked');
    expect(output).toContain('Resource links: none listed');
  });

  it('prints public source references with type and checked date, never /go/', () => {
    const output = formatTool({
      ...appDetail(),
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
          url: 'https://slothhub.dev/go/figma',
          sourceType: 'other',
        },
      ],
    });

    expect(output).toContain('Source references:');
    expect(output).toContain(
      '- Pricing page (pricing_page): https://example.com/pricing — checked 2026-07-01',
    );
    expect(output).toContain(
      '- Hands-on notes (hands_on_test): https://notes.example.com/review',
    );
    expect(output).not.toContain('Tracked visit');
  });

  it('omits the source references section when missing or empty', () => {
    const missing = appDetail();
    delete missing.sourceReferences;
    expect(formatTool(missing)).not.toContain('Source references');
    expect(
      formatTool({...appDetail(), sourceReferences: []}),
    ).not.toContain('Source references');
  });

  it('strips control characters from source reference text', () => {
    const output = formatTool({
      ...appDetail(),
      sourceReferences: [
        {
          title: 'Unsafe \u001b[2J ref\u202e',
          url: 'https://example.com/x',
          sourceType: 'other',
        },
      ],
    });

    expect(output).not.toMatch(/\u001b/u);
    expect(output).not.toContain('\u202e');
    expect(output).toContain('Unsafe  ref');
  });

  it('bounds the rendered source reference list and points at JSON', () => {
    const output = formatTool({
      ...appDetail(),
      sourceReferences: Array.from({length: 55}, (_, index) => ({
        title: `Reference ${index + 1}`,
        url: `https://example.com/ref-${index + 1}`,
        sourceType: 'other' as const,
      })),
    });

    expect(output).toContain('Source references:');
    expect(output).toContain('Reference 50');
    expect(output).not.toContain('Reference 51');
    expect(output).toContain('5 more source references in the JSON payload');
  });

  it('prints a Quickstart block with label, status, command, docs, and notice', () => {
    const output = formatTool({
      ...appDetail(),
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

    expect(output).toContain('Quickstarts:\n');
    expect(output).toContain('- Install package\n  Status: Official (provenance only; not a safety claim)\n  Source: npm\n  Command: npm install example-cli\n  Docs: https://example.com/docs\n');
    expect(output).toContain('- Clone repository\n  Status: Official (provenance only; not a safety claim)\n  Command: git clone https://github.com/example/tool\n  Docs: https://github.com/example/tool\n  Notice: This repository has been archived.\n');
    expect(output).toContain('- Open usage docs\n  Status: Community (provenance only; not a safety claim)\n  Docs: https://example.com/usage\n');
  });

  it('strips control characters from quickstart text', () => {
    const output = formatTool({
      ...appDetail(),
      quickstarts: [
        {
          kind: 'install_command',
          label: 'Install \u001b[2Jcli\u202e',
          status: 'official',
          statusLabel: 'Official',
          command: 'npm install example-cli',
          commandLanguage: 'shell',
          sourceLabel: 'npm \u001b[31mregistry',
        },
      ],
    });

    expect(output).not.toMatch(/\u001b/u);
    expect(output).not.toContain('\u202e');
    expect(output).toContain('- Install cli\n  Status: Official (provenance only; not a safety claim)\n  Source: npm registry\n');
  });

  it('omits the Quickstart block when quickstarts are missing or empty', () => {
    const missing = appDetail();
    delete missing.quickstarts;
    expect(formatTool(missing)).not.toContain('Quickstart');
    expect(
      formatTool({...appDetail(), quickstarts: []}),
    ).not.toContain('Quickstart');
  });

  it('prints the Cursor setup recipe and its registry provenance', () => {
    const detail = mcpServerDetail();
    detail.agentInterfaces = [
      {
        kind: 'mcp_server',
        status: 'official',
        label: 'Playwright MCP server',
        source: 'mcp_registry',
        identifier: 'com.microsoft/playwright-mcp',
        setupRecipes: [
          {
            state: 'ready',
            host: 'cursor',
            serverKey: 'playwright-mcp',
            url: 'https://mcp.playwright.dev/mcp',
            registryName: 'com.microsoft/playwright-mcp',
            version: '0.0.45',
            observedAt: '2026-08-01T00:00:00.000Z',
            snippet:
              '{\n  "mcpServers": {\n    "playwright-mcp": {\n      "url": "https://mcp.playwright.dev/mcp"\n    }\n  }\n}',
            entrySnippet:
              '{\n  "playwright-mcp": {\n    "url": "https://mcp.playwright.dev/mcp"\n  }\n}',
            alternateUrls: ['https://eu.mcp.playwright.dev/mcp'],
          },
          {
            state: 'ready',
            host: 'gemini_cli',
            serverKey: 'playwright-mcp',
            url: 'https://mcp.playwright.dev/mcp',
            registryName: 'com.microsoft/playwright-mcp',
            version: '0.0.45',
            observedAt: '2026-08-01T00:00:00.000Z',
            snippet:
              '{\n  "mcpServers": {\n    "playwright-mcp": {\n      "httpUrl": "https://mcp.playwright.dev/mcp"\n    }\n  }\n}',
            entrySnippet:
              '{\n  "playwright-mcp": {\n    "httpUrl": "https://mcp.playwright.dev/mcp"\n  }\n}',
          },
          {
            state: 'ready',
            host: 'zed',
            serverKey: 'playwright-mcp',
            url: 'https://mcp.playwright.dev/mcp',
            registryName: 'com.microsoft/playwright-mcp',
            version: '0.0.45',
            observedAt: '2026-08-01T00:00:00.000Z',
            snippet:
              '{\n  "context_servers": {\n    "playwright-mcp": {\n      "url": "https://mcp.playwright.dev/mcp"\n    }\n  }\n}',
            entrySnippet:
              '{\n  "playwright-mcp": {\n    "url": "https://mcp.playwright.dev/mcp"\n  }\n}',
          },
          {
            state: 'ready',
            host: 'windsurf',
            serverKey: 'playwright-mcp',
            url: 'https://mcp.playwright.dev/mcp',
            registryName: 'com.microsoft/playwright-mcp',
            version: '0.0.45',
            observedAt: '2026-08-01T00:00:00.000Z',
            snippet:
              '{\n  "mcpServers": {\n    "playwright-mcp": {\n      "serverUrl": "https://mcp.playwright.dev/mcp"\n    }\n  }\n}',
            entrySnippet:
              '{\n  "playwright-mcp": {\n    "serverUrl": "https://mcp.playwright.dev/mcp"\n  }\n}',
          },
          {
            state: 'ready',
            host: 'kiro',
            serverKey: 'playwright-mcp',
            url: 'https://mcp.playwright.dev/mcp',
            registryName: 'com.microsoft/playwright-mcp',
            version: '0.0.45',
            observedAt: '2026-08-01T00:00:00.000Z',
            snippet:
              '{\n  "mcpServers": {\n    "playwright-mcp": {\n      "url": "https://mcp.playwright.dev/mcp"\n    }\n  }\n}',
            entrySnippet:
              '{\n  "playwright-mcp": {\n    "url": "https://mcp.playwright.dev/mcp"\n  }\n}',
          },
          {
            state: 'ready',
            host: 'codex_cli',
            serverKey: 'playwright-mcp',
            url: 'https://mcp.playwright.dev/mcp',
            registryName: 'com.microsoft/playwright-mcp',
            version: '0.0.45',
            observedAt: '2026-08-01T00:00:00.000Z',
            snippet:
              '[mcp_servers.playwright-mcp]\nurl = "https://mcp.playwright.dev/mcp"',
            entrySnippet:
              '[mcp_servers.playwright-mcp]\nurl = "https://mcp.playwright.dev/mcp"',
          },
          {
            state: 'ready',
            host: 'opencode',
            serverKey: 'playwright-mcp',
            url: 'https://mcp.playwright.dev/mcp',
            registryName: 'com.microsoft/playwright-mcp',
            version: '0.0.45',
            observedAt: '2026-08-01T00:00:00.000Z',
            snippet:
              '{\n  "mcp": {\n    "playwright-mcp": {\n      "type": "remote",\n      "url": "https://mcp.playwright.dev/mcp"\n    }\n  }\n}',
            entrySnippet:
              '{\n  "playwright-mcp": {\n    "type": "remote",\n    "url": "https://mcp.playwright.dev/mcp"\n  }\n}',
          },
          {
            state: 'ready',
            host: 'copilot_cli',
            serverKey: 'playwright-mcp',
            url: 'https://mcp.playwright.dev/mcp',
            registryName: 'com.microsoft/playwright-mcp',
            version: '0.0.45',
            observedAt: '2026-08-01T00:00:00.000Z',
            snippet:
              '{\n  "mcpServers": {\n    "playwright-mcp": {\n      "type": "http",\n      "url": "https://mcp.playwright.dev/mcp"\n    }\n  }\n}',
            entrySnippet:
              '{\n  "playwright-mcp": {\n    "type": "http",\n    "url": "https://mcp.playwright.dev/mcp"\n  }\n}',
          },
          {
            state: 'ready',
            host: 'vscode',
            serverKey: 'playwright-mcp',
            url: 'https://mcp.playwright.dev/mcp',
            registryName: 'com.microsoft/playwright-mcp',
            version: '0.0.45',
            observedAt: '2026-08-01T00:00:00.000Z',
            snippet:
              '{\n  "servers": {\n    "playwright-mcp": {\n      "type": "http",\n      "url": "https://mcp.playwright.dev/mcp"\n    }\n  }\n}',
            entrySnippet:
              '{\n  "playwright-mcp": {\n    "type": "http",\n    "url": "https://mcp.playwright.dev/mcp"\n  }\n}',
          },
        ],
      },
    ];

    const output = formatTool(detail);

    expect(output).toContain(
      'Cursor setup (merge into mcpServers in .cursor/mcp.json (project) or ~/.cursor/mcp.json (user) — review before running):',
    );
    expect(output).toContain(
      'Gemini CLI setup (merge into mcpServers in settings.json — review before running):',
    );
    expect(output).toContain(
      'Zed setup (merge into context_servers in settings.json — review before running):',
    );
    expect(output).toContain(
      'Windsurf setup (merge into mcpServers in mcp_config.json — review before running):',
    );
    expect(output).toContain(
      'Kiro setup (merge into mcpServers in .kiro/settings/mcp.json (workspace) or ~/.kiro/settings/mcp.json (user) — review before running):',
    );
    expect(output).toContain(
      'Codex CLI setup (merge into mcp_servers in ~/.codex/config.toml (user) or .codex/config.toml (project) — shared by Codex CLI, ChatGPT desktop, and the Codex IDE extension — review before running):',
    );
    expect(output).toContain('[mcp_servers.playwright-mcp]');
    expect(output).toContain('url = "https://mcp.playwright.dev/mcp"');
    expect(output).toContain(
      'Or run: codex mcp add playwright-mcp --url https://mcp.playwright.dev/mcp',
    );
    expect(output).toContain(
      'OpenCode setup (merge into mcp in opencode.json — review before running):',
    );
    expect(output).toContain(
      'GitHub Copilot CLI setup (merge into mcpServers in ~/.copilot/mcp-config.json (user) or .mcp.json / .github/mcp.json (project) — review before running):',
    );
    expect(output).toContain(
      'VS Code setup (merge into servers in .vscode/mcp.json (workspace) — review before running):',
    );
    expect(output).toContain('"playwright-mcp"');
    expect(output).not.toContain('"mcpServers":');
    expect(output).not.toContain('"context_servers":');
    expect(output).not.toContain('"mcp":');
    expect(output).toContain('"type": "http"');
    expect(output).toContain('"url": "https://mcp.playwright.dev/mcp"');
    expect(output).toContain('"httpUrl": "https://mcp.playwright.dev/mcp"');
    expect(output).toContain('"serverUrl": "https://mcp.playwright.dev/mcp"');
    expect(output).toContain('"type": "remote"');
    expect(output).toContain(
      'From the official MCP Registry: com.microsoft/playwright-mcp v0.0.45, observed 2026-08-01T00:00:00.000Z.',
    );
    expect(output).toContain(
      'Other published remotes: https://eu.mcp.playwright.dev/mcp',
    );
  });

  it('prints header placeholders and the no-secrets notice for authed remotes', () => {
    const detail = mcpServerDetail();
    detail.agentInterfaces = [
      {
        kind: 'mcp_server',
        status: 'official',
        label: 'Playwright MCP server',
        source: 'mcp_registry',
        identifier: 'com.microsoft/playwright-mcp',
        setupRecipes: [
          {
            state: 'ready',
            host: 'cursor',
            serverKey: 'playwright-mcp',
            url: 'https://mcp.playwright.dev/mcp',
            registryName: 'com.microsoft/playwright-mcp',
            version: '0.0.45',
            observedAt: '2026-08-01T00:00:00.000Z',
            headers: [{name: 'Authorization', isRequired: true, isSecret: true}],
            snippet:
              '{\n  "mcpServers": {\n    "playwright-mcp": {\n      "url": "https://mcp.playwright.dev/mcp",\n      "headers": {\n        "Authorization": "${AUTHORIZATION}"\n      }\n    }\n  }\n}',
            entrySnippet:
              '{\n  "playwright-mcp": {\n    "url": "https://mcp.playwright.dev/mcp",\n    "headers": {\n      "Authorization": "${AUTHORIZATION}"\n    }\n  }\n}',
          },
        ],
      },
    ];

    const output = formatTool(detail);

    expect(output).toContain('"Authorization": "${AUTHORIZATION}"');
    expect(output).toContain(
      'Replace the Authorization placeholders with real header values',
    );
    expect(output).toContain('never secret values');
  });

  it('reports an unknown Cursor recipe without printing a snippet', () => {
    const detail = mcpServerDetail();
    detail.agentInterfaces = [
      {
        kind: 'mcp_server',
        status: 'official',
        label: 'Playwright MCP server',
        source: 'mcp_registry',
        identifier: 'com.microsoft/playwright-mcp',
        setupRecipes: [
          {state: 'unknown', host: 'cursor'},
          {state: 'unknown', host: 'gemini_cli'},
          {state: 'unknown', host: 'zed'},
          {state: 'unknown', host: 'windsurf'},
          {state: 'unknown', host: 'kiro'},
          {state: 'unknown', host: 'codex_cli'},
          {state: 'unknown', host: 'opencode'},
          {state: 'unknown', host: 'copilot_cli'},
          {state: 'unknown', host: 'claude_desktop', registryUrl: 'https://registry.modelcontextprotocol.io/servers/com.microsoft%2Fplaywright-mcp'},
        ],
      },
    ];

    const output = formatTool(detail);

    expect(output).toContain(
      'Cursor setup: no confirmed remote recipe in the official MCP Registry.',
    );
    expect(output).toContain(
      'Gemini CLI setup: no confirmed remote recipe in the official MCP Registry.',
    );
    expect(output).toContain(
      'Zed setup: no confirmed remote recipe in the official MCP Registry.',
    );
    expect(output).toContain(
      'Windsurf setup: no confirmed remote recipe in the official MCP Registry.',
    );
    expect(output).toContain(
      'Kiro setup: no confirmed remote recipe in the official MCP Registry.',
    );
    expect(output).toContain(
      'Codex CLI setup: no confirmed remote recipe in the official MCP Registry.',
    );
    expect(output).toContain(
      'OpenCode setup: no confirmed remote recipe in the official MCP Registry.',
    );
    expect(output).toContain(
      'GitHub Copilot CLI setup: no confirmed remote recipe in the official MCP Registry.',
    );
    expect(output).not.toContain('mcpServers');
    expect(output).toContain('Claude Desktop setup: no documented remote config snippet.');
    expect(output).toContain('MCP Registry: https://registry.modelcontextprotocol.io/servers/com.microsoft%2Fplaywright-mcp');
    expect(output).not.toContain('mcp_servers');
  });

  it('still prints the legacy singular setupRecipe when setupRecipes is absent', () => {
    const detail = mcpServerDetail();
    detail.agentInterfaces = [
      {
        kind: 'mcp_server',
        status: 'official',
        label: 'Playwright MCP server',
        source: 'mcp_registry',
        identifier: 'com.microsoft/playwright-mcp',
        setupRecipe: {state: 'unknown'},
      },
    ];

    const output = formatTool(detail);

    expect(output).toContain(
      'Cursor setup: no confirmed remote recipe in the official MCP Registry.',
    );
  });
});

describe('formatSearchResults', () => {
  it('prints Resource kind on every hit and Agent interface kinds only when the array is non-empty', () => {
    const output = formatSearchResults([
      {tool: mcpServerSearchTool(), score: 1},
      {tool: appSearchTool(), score: 0.5},
    ]);

    expect(output).toContain('Playwright MCP (playwright-mcp)');
    expect(output).toContain('Resource kind: MCP server (mcp_server)');
    expect(output).toContain('Agent interface kinds: MCP server (mcp_server)');
    expect(output).toContain('Linear (linear)');
    expect(output).toContain('Resource kind: App (app)');

    const linearBlock = output.split('\n\n')[1] ?? '';
    expect(linearBlock).toContain('Linear (linear)');
    expect(linearBlock).not.toContain('Agent interface kinds:');
  });

  it('prints unknown/not specified for a search hit with a missing Resource kind', () => {
    const tool = appSearchTool();
    tool.resourceKind = {value: '', label: ''};

    const output = formatSearchResults([{tool, score: 1}]);

    expect(output).toContain('Resource kind: unknown (not specified)');
    expect(output).not.toContain('Resource kind: App (app)');
  });

  it('omits Agent interface kinds when the array is omitted, same as when it is empty', () => {
    const omitted = appSearchTool();
    delete omitted.agentInterfaceKinds;
    const empty = appSearchTool();
    empty.agentInterfaceKinds = [];

    expect(formatSearchResults([{tool: omitted, score: 1}])).not.toContain(
      'Agent interface kinds:',
    );
    expect(formatSearchResults([{tool: empty, score: 1}])).not.toContain('Agent interface kinds:');
  });

  it('strips terminal controls from search hit text', () => {
    const tool = appSearchTool();
    tool.name = 'Li\u001b[2Jnear';

    const output = formatSearchResults([{tool, score: 1}]);

    expect(output).toContain('Linear (linear)');
    expect(output).not.toMatch(/\u001b/u);
  });
});

describe('toSearchJsonHit', () => {
  it('keeps Resource kind and Agent interface kinds on an MCP server summary', () => {
    const hit = toSearchJsonHit(mcpServerSearchTool(), 0.9);

    expect(hit.resourceKind).toEqual({value: 'mcp_server', label: 'MCP server'});
    expect(hit.agentInterfaceKinds).toEqual(['mcp_server']);
    expect(hit.score).toBe(0.9);
  });

  it('includes an empty Agent interface kinds array when the feed omitted it', () => {
    const tool = appSearchTool();
    delete tool.agentInterfaceKinds;

    const hit = toSearchJsonHit(tool, 0.1);

    expect(hit.resourceKind).toEqual({value: 'app', label: 'App'});
    expect(hit.agentInterfaceKinds).toEqual([]);
    expect(hit).toHaveProperty('agentInterfaceKinds');
  });
});

it('retains portability facts through feed parsing and formats checked export coverage', () => {
  const checkedAt = '2026-07-20T00:00:00.000Z';
  const portability = normalizePublicToolPortability({formats: [{name: 'CSV', direction: 'export', supportMode: 'partial', checkedAt, evidenceReferenceKeys: ['guide']}]}, [{_key: 'guide', title: 'Export guide', url: 'https://example.com/export', sourceType: 'official_docs', visibility: 'public', checkedAt}], {_id: 'current'});
  const feed = parseToolDetailFeed({...toolDetailFeed, version: '33.1.0', data: {...toolDetailFeed.data, portability}}, '/api/tools/example.json');
  expect(feed.data.portability).toEqual(portability);
  const output = formatTool(feed.data);
  expect(output.split('\n')).toContain('## Portability and migrations');
  expect(output.split('\n')).toContain('### CSV · Export');
  expect(output).toContain('Support: Partial');
  expect(output).toContain('https://example.com/export');
});

it('retains lifecycle facts through parsing and renders evidence in detail output', () => {
  const checkedAt = '2026-07-20T00:00:00.000Z';
  const lifecycle = normalizePublicToolLifecycle({releaseModel: 'versioned', checkedAt, evidenceReferenceKeys: ['policy']}, [{_key: 'policy', title: 'Support policy', url: 'https://example.com/support', sourceType: 'official_docs', visibility: 'public', checkedAt}]);
  const parsed = parseToolDetailFeed({...toolDetailFeed, version: '33.1.0', data: {...appDetail(), lifecycle}}, '/api/tools/figma.json').data;
  expect(parsed.lifecycle).toEqual(lifecycle);
  const output = formatTool(parsed);
  expect(output.split('\n')).toContain('## Lifecycle');
  expect(output).toContain('Release model: Versioned');
  expect(output).toContain('https://example.com/support');
});

it('retains amount periods and public pricing notes through CLI parsing and output', () => {
  const pricingDetails = {currency: 'USD', notes: 'Annual commitment.', plans: [{name: 'Pro', listPrice: 12, billing: 'Per month, paid yearly', billingPeriod: 'month'}]};
  const parsed = parseToolDetailFeed({...toolDetailFeed, data: {...toolDetailFeed.data, pricingDetails}}, 'Pricing notes fixture');
  expect(parsed.data.pricingDetails).toEqual(pricingDetails);
  const output = formatTool(parsed.data);
  expect(output).toContain('Amount period: month');
  expect(output).toContain('Pricing note: Annual commitment.');
});
