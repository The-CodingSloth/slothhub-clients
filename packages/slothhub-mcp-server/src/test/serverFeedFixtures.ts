// Feed fixtures shared by the stdio server suite and the hosted response-budget
// suite. Each export is a plain value; tests that need a variant clone it.
import {computeIndexContentHash} from '@slothhub/domain/public-feed-content-identity';
import {vi} from 'vite-plus/test';
import type {
  AgentCategoriesFeed,
  AgentCuratedListFeed,
  AgentIndexFeed,
  AgentSearchIndexFeed,
  AgentSearchIndexTool,
  AgentTagsFeed,
  AgentToolDetail,
  AgentToolDetailFeed,
  AgentToolSummary,
  AgentToolStackFeed,
  AgentToolsFeed,
  AgentUseCasesFeed,
} from '../types.js';

export const sampleTool = (overrides: Partial<AgentSearchIndexTool> = {}): AgentSearchIndexTool => ({
  name: 'Example MCP',
  slug: 'example-mcp',
  description: 'An example MCP server for catalogs',
  resourceKind: { value: 'mcp_server', label: 'MCP server' },
  resourceIdentity: {
    kind: 'mcp_registry_server',
    kindLabel: 'MCP Registry',
    canonicalUrl: 'https://registry.modelcontextprotocol.io/servers/example',
    ctaLabel: 'Open MCP record',
    mcpRegistryUrl: 'https://registry.modelcontextprotocol.io/servers/example',
    registryId: 'io.github.example/server',
  },
  pricing: 'free',
  platforms: ['cli'],
  categories: [{ name: 'Developer Tools', slug: 'developer-tools' }],
  tags: [],
  useCases: [],
  freshness: { verifiedAt: '2026-07-01T00:00:00.000Z' },
  detailUrl: 'https://slothhub.dev/tool/example-mcp',
  visitUrl: 'https://slothhub.dev/go/example-mcp?surface=agent',
  keyFeatures: ['Search'],
  securityCapabilities: ['sso_saml'],
  agentInterfaceKinds: [],
  search: {
    text: 'example mcp server catalogs',
    tokens: ['example', 'mcp', 'server', 'catalogs'],
    fields: {
      name: 'Example MCP',
      description: 'An example MCP server for catalogs',
      keyFeatures: ['Search'],
      platforms: ['cli'],
      categories: ['developer-tools'],
      tags: [],
      useCases: [],
      resourceKind: ['MCP server', 'mcp_server'],
      agentInterfaceKinds: [],
    },
  },
  ...overrides,
});

export const searchFeed: AgentSearchIndexFeed = {
  version: '17.1.0',
  siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-07-08T00:00:00.000Z',
  data: {
    tools: [sampleTool()],
    filters: {
      pricing: [],
      platforms: [],
      resourceKinds: [],
      securityCapabilities: [{ value: 'sso_saml', label: 'SSO/SAML', count: 1 }],
      agentInterfaceKinds: [],
      categories: [{value: 'developer-tools', label: 'Developer Tools', count: 1}],
      tags: [],
      useCases: [],
    },
    queryContract: {},
  },
};

export const toolSummary: AgentToolSummary = {
  name: 'Example MCP',
  slug: 'example-mcp',
  description: 'An example MCP server for catalogs',
  resourceKind: {value: 'mcp_server', label: 'MCP server'},
  resourceIdentity: {
    kind: 'mcp_registry_server',
    kindLabel: 'MCP Registry',
    canonicalUrl: 'https://registry.modelcontextprotocol.io/servers/example',
    ctaLabel: 'Open MCP record',
    mcpRegistryUrl: 'https://registry.modelcontextprotocol.io/servers/example',
    registryId: 'io.github.example/server',
  },
  pricing: 'free',
  platforms: ['cli'],
  categories: [{name: 'Developer Tools', slug: 'developer-tools'}],
  tags: [],
  useCases: [],
  freshness: {
    isVerified: true,
    verifiedAt: '2026-07-01T00:00:00.000Z',
    lastUpdated: '2026-07-01T00:00:00.000Z',
  },
  detailUrl: 'https://slothhub.dev/tool/example-mcp',
  visitUrl: 'https://slothhub.dev/go/example-mcp?surface=agent',
};

export const toolDetail: AgentToolDetail = {
  ...toolSummary,
  keyFeatures: ['Search'],
  useCases: [
    {
      name: 'Agent catalog discovery',
      slug: 'agent-catalog-discovery',
      description: 'Find catalog Tools from an agent workflow',
    },
  ],
  fitGuidance: {
    bestFor: ['Agents that need curated catalog data'],
    notIdealFor: ['Offline-only workflows'],
    keyTradeoffs: ['Requires network access'],
    primaryDecisionCriteria: ['Structured discovery'],
  },

  alternativeTools: [],
  pricingHistory: {
    url: 'https://slothhub.dev/tool/example-mcp/updates',
    latestValidatedChange: {
      previous: 'paid',
      current: 'free',
      changedAt: '2026-07-09T12:00:00.000Z',
    },
  },
  resourceRelationships: [
    {
      kind: 'mcp_server_for',
      direction: 'outgoing',
      label: 'MCP server for',
      target: {
        id: 'tool-example-app',
        name: 'Example app',
        slug: 'example-app',
        canonicalUrl: 'https://example.app/![](https://attacker.example/pixel.png)',
        resourceKind: {value: 'app', label: 'App'},
      },
      evidenceUrl: 'https://evidence.example/relationship',
    },
  ],
  runtimeRequirements: [{
    subjectKind: 'runtime',
    subjectName: 'Node.js',
    environmentRange: '>=20 <23',
    status: 'unsupported',
    note: 'Version 19 is not supported.',
    evidence: [{
      title: 'Runtime support',
      url: 'https://example.com/runtime-support',
      checkedAt: '2026-07-14T12:00:00.000Z',
    }],
    reviewedAt: '2026-07-14T12:30:00.000Z',
  }],
  productLimits: [
    {
      metric: 'API requests — sustained',
      planScope: 'Pro',
      deploymentScope: 'Hosted',
      basis: 'documented_limit',
      ambiguous: false,
      facts: [
        {
          state: 'bounded',
          comparator: 'at_most',
          value: 60,
          unit: 'requests/minute',
          evidence: [
            {
              title: 'Pricing limits',
              url: 'https://example.com/pricing',
              sourceType: 'pricing_page',
              checkedAt: '2026-07-20T00:00:00.000Z',
            },
          ],
          reviewedAt: '2026-07-22T00:00:00.000Z',
        },
      ],
    },
    {
      metric: 'Seats',
      ambiguous: false,
      facts: [{state: 'unknown', evidence: []}],
    },
  ],
  agentInterfaces: [
    {
      kind: 'mcp_server',
      status: 'official',
      label: 'MCP server',
      source: 'mcp_registry',
      identifier: 'io.github.example/server',
      docsUrl: 'https://docs.example.com/mcp',
      installCommand: 'npx -y @example/mcp --label `unsafe`',
      authRequirement: 'none',
      capabilitiesNote: 'Catalog search',
      automation: {
        nonInteractive: 'yes',
        structuredOutput: 'partial',
        dryRun: 'no',
        evidenceBasis: 'documented',
        sideEffects: ['filesystem', 'network'],
        workspaceConcurrency: 'requires_isolation',
        isolationSupport: ['worktree', 'container'],
        checkedAt: '2026-07-20T00:00:00.000Z',
        notes: 'Require `review` before <script>alert(1)</script>.',
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
  quickstarts: [
    {
      kind: 'install_command',
      label: 'Install package',
      status: 'official',
      statusLabel: 'Official',
      command: 'npm install example-cli',
      commandLanguage: 'shell',
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
  ],
};

export const toolsFeed: AgentToolsFeed = {
  version: '33.0.0',
  siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-07-08T00:00:00.000Z',
  data: {tools: [toolSummary]},
};

export const toolDetailFeed: AgentToolDetailFeed = {
  version: '33.0.0',
  siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-07-08T00:00:00.000Z',
  data: toolDetail,
};

export const toolLookupArtifact = {
  version: '5.0.0' as const,
  complete: true as const,
  aliases: [
    {slug: 'example-server', sourceToolId: 'tool-example-mcp', canonicalSlug: 'example-mcp'},
  ],
  identityClaims: [
    {
      namespace: 'npm_package' as const,
      value: 'npm_package:old-example-mcp',
      disposition: 'aliased' as const,
      sourceToolId: 'tool-old-example-mcp',
      canonicalSlug: 'example-mcp',
    },
    {
      namespace: 'npm_package' as const,
      value: 'npm_package:retired-example-mcp',
      disposition: 'retired' as const,
      sourceToolId: 'tool-retired-example-mcp',
    },
    {
      namespace: 'github_repository' as const,
      value: 'github_repository:old-owner/old-example-mcp',
      disposition: 'aliased' as const,
      sourceToolId: 'tool-old-example-mcp-repo',
      canonicalSlug: 'example-mcp',
    },
  ],
  tools: [
    {
      slug: 'example-mcp',
      name: 'Example MCP',
      detailUrl: 'https://slothhub.dev/tool/example-mcp',
      keys: [
        {namespace: 'slug' as const, value: 'example-mcp'},
        {
          namespace: 'mcp_registry_server' as const,
          value: 'mcp_registry_server:io.github.example/server',
        },
        {
          namespace: 'github_repository' as const,
          value: 'github_repository:example/mcp-server',
        },
      ],
    },
  ],
};

export const stacksFeed: AgentToolStackFeed = {
  version: '33.0.0',
  siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-07-08T00:00:00.000Z',
  data: {
    stacks: [
      {
        name: 'Design Stack',
        slug: 'design-stack',
        description: 'A design workflow',
        url: 'https://slothhub.dev/stacks/design-stack',
        tags: [],
        tools: [{
          role: 'Design',
          tool: {
            ...sampleTool({ name: 'Figma', slug: 'figma' }),
            freshness: {isVerified: true, verifiedAt: '2026-07-01T00:00:00.000Z'},
          },
        }],
      },
    ],
  },
};

export const bestFeed: AgentCuratedListFeed = {
  version: '33.0.0',
  siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-07-08T00:00:00.000Z',
  data: {
    best: [
      {
        title: 'Best MCP servers',
        slug: 'best-mcp-servers',
        intro: 'Editorial picks',
        url: 'https://slothhub.dev/best/best-mcp-servers',
        rankedTools: [
          {
            rank: 1,
            editorialBlurb: 'Great for agents',
            tool: {
              ...sampleTool(),
              freshness: {isVerified: true, verifiedAt: '2026-07-01T00:00:00.000Z'},
            },
          },
        ],
      },
    ],
  },
};

export const categoriesFeed: AgentCategoriesFeed = {
  version: '33.0.0',
  siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-07-08T00:00:00.000Z',
  data: {
    categories: [
      {
        name: 'Developer Tools',
        slug: 'developer-tools',
        description: 'Tools for developers',
        url: 'https://slothhub.dev/developer-tools',
        toolCount: 1,
      },
      {
        name: 'Design',
        slug: 'design',
        description: 'Design software',
        url: 'https://slothhub.dev/design',
        toolCount: 0,
      },
    ],
  },
};

export const tagsFeed: AgentTagsFeed = {
  version: '33.0.0',
  siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-07-08T00:00:00.000Z',
  data: {
    tags: [
      {
        name: 'MCP',
        slug: 'mcp',
        url: 'https://slothhub.dev/tag/mcp',
        toolCount: 1,
      },
    ],
  },
};

export const useCasesFeed: AgentUseCasesFeed = {
  version: '33.0.0',
  siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-07-08T00:00:00.000Z',
  data: {
    useCases: [
      {
        name: 'Agent tooling',
        slug: 'agent-tooling',
        url: 'https://slothhub.dev/use-cases/agent-tooling',
        toolCount: 1,
        tools: [],
      },
    ],
  },
};

export const indexFeed: AgentIndexFeed = {
  version: '33.0.0',
  siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-07-08T00:00:00.000Z',
  schemaUrl: 'https://slothhub.dev/api/schema.json',
  snapshots: {
    full: 'https://slothhub.dev/api/catalog.snapshot.json',
    ndjson: 'https://slothhub.dev/api/catalog.ndjson',
  },
  feeds: {
    tools: 'https://slothhub.dev/api/tools.json',
    toolLookup: 'https://slothhub.dev/api/tool-lookup.json',
    searchIndex: 'https://slothhub.dev/api/search-index.json',
    categories: 'https://slothhub.dev/api/categories.json',
    tags: 'https://slothhub.dev/api/tags.json',
    useCases: 'https://slothhub.dev/api/use-cases.json',
    stacks: 'https://slothhub.dev/api/stacks.json',
    best: 'https://slothhub.dev/api/best.json',
  },
  markdownArtifacts: {
    stacks: 'https://slothhub.dev/stacks/{slug}.md',
    stacksIndex: 'https://slothhub.dev/stacks.md',
    bestIndex: 'https://slothhub.dev/best.md',
  },
  integrationHubUrl: 'https://slothhub.dev/agents',
  markdownHubUrl: 'https://slothhub.dev/agents.md',
  toolDetailUrlTemplate: 'https://slothhub.dev/api/tools/{slug}.json',
  citationGuidance: ['Cite canonical pages', 'Do not cite /go/ visit URLs'],
};

export const authenticatedIndex = (
  contentHashes: Record<string, string>,
  overrides: Partial<AgentIndexFeed> = {},
): AgentIndexFeed => {
  const withoutSelf = {...indexFeed, ...overrides, contentHashes};
  const selfHash = computeIndexContentHash(withoutSelf);
  return {
    ...withoutSelf,
    contentHash: selfHash,
    contentHashes: {...contentHashes, '/api/index.json': selfHash},
  };
};

export const createMockFetch = () =>
  vi.fn(async (url: string) => {
    if (url.endsWith('/api/search-index.json')) return searchFeed;
    if (url.endsWith('/api/tool-lookup.json')) return toolLookupArtifact;
    if (url.endsWith('/api/tools/example-mcp.json')) return toolDetailFeed;
    if (/\/api\/tools\/[^/]+\.json$/u.test(url)) throw new Error('HTTP 404 Not Found');
    if (url.endsWith('/api/tools.json')) return toolsFeed;
    if (url.endsWith('/api/stacks.json')) return stacksFeed;
    if (url.endsWith('/api/best.json')) return bestFeed;
    if (url.endsWith('/api/categories.json')) return categoriesFeed;
    if (url.endsWith('/api/tags.json')) return tagsFeed;
    if (url.endsWith('/api/use-cases.json')) return useCasesFeed;
    if (url.endsWith('/api/index.json')) return indexFeed;
    throw new Error(`unexpected ${url}`);
  });

export const readyCursorRecipe = {
  state: 'ready' as const,
  host: 'cursor' as const,
  serverKey: 'example-mcp',
  url: 'https://mcp.example.com/sse',
  registryName: 'io.github.example/server',
  version: '1.4.0',
  observedAt: '2026-07-21T00:00:00.000Z',
  snippet: '{"mcpServers":{"example-mcp":{"url":"https://mcp.example.com/sse"}}}',
  entrySnippet:
    '{\n  "example-mcp": {\n    "url": "https://mcp.example.com/sse"\n  }\n}',
};
