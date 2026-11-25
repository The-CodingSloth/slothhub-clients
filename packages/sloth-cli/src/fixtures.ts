import type {
    AgentAlternativesDetailFeed,
    AgentAlternativesFeed,
  AgentCategoriesFeed,
  AgentComparisonDetailFeed,
  AgentComparisonsFeed,
  AgentCuratedListFeed,
  AgentIndexFeed,
  AgentSearchIndexFeed,
  AgentTagsFeed,
  AgentToolDetailFeed,
  AgentToolStackFeed,
  AgentToolsFeed,
  AgentUseCasesFeed} from './types.js';
import {computeContentHash} from '@slothhub/domain/public-feed-content-identity';

// Dense Unicode receipt fixture for comparison output (2026-09-22).
// Deliberately exceeds typical editorial prose; this is data, not a runtime cap.
const denseFactText = '比較 🦥 café — export workflow. '.repeat(200).trim();
export const denseComparisonFacts = {
  bestFor: Array.from({length: 8}, (_, index) => `Audience ${index}: ${denseFactText}`),
  notBestFor: Array.from({length: 8}, (_, index) => `Exclusion ${index}: ${denseFactText}`),
  strengths: Array.from({length: 8}, (_, index) => `Strength ${index}: ${denseFactText}`),
  limitations: Array.from({length: 8}, (_, index) => `Limitation ${index}: ${denseFactText}`),
  pricingNotes: `Pricing: ${denseFactText}`,
  platformNotes: `Platforms: ${denseFactText}`,
  migrationNotes: `Migration: ${denseFactText}`,
};

export const toolLookupArtifact = {
  version: '5.0.0' as const,
  complete: true as const,
  aliases: [
    {slug: 'figma-design', sourceToolId: 'tool-figma', canonicalSlug: 'figma'},
  ],
  identityClaims: [
    {
      namespace: 'npm_package' as const,
      value: 'npm_package:old-figma',
      disposition: 'aliased' as const,
      sourceToolId: 'tool-old-figma',
      canonicalSlug: 'figma',
    },
    {
      namespace: 'npm_package' as const,
      value: 'npm_package:retired-figma',
      disposition: 'retired' as const,
      sourceToolId: 'tool-retired-figma',
    },
    {
      namespace: 'github_repository' as const,
      value: 'github_repository:old-owner/old-figma',
      disposition: 'aliased' as const,
      sourceToolId: 'tool-old-figma-repo',
      canonicalSlug: 'figma',
    },
  ],
  tools: [
    {
      slug: 'figma',
      name: 'Figma',
      detailUrl: 'https://slothhub.dev/tool/figma',
      keys: [
        {namespace: 'slug' as const, value: 'figma'},
        {namespace: 'display_name' as const, value: 'figma'},
        {namespace: 'canonical_url' as const, value: 'figma.com'},
        {namespace: 'github_repository' as const, value: 'github_repository:figma/design'},
      ],
    },
  ],
};

export const figmaTool = {
  name: 'Figma',
  slug: 'figma',
  description: 'Collaborative design platform',
  resourceKind: { value: 'app', label: 'App' },
  resourceIdentity: {
    kind: 'website',
    kindLabel: 'Website',
    canonicalUrl: 'https://figma.com/',
    ctaLabel: 'Visit website',
  },
  pricing: 'freemium',
  platforms: ['web', 'desktop'],
  integrations: [
    {
      slug: 'github',
      name: 'GitHub',
      status: 'native',
      checkedAt: '2026-07-20T00:00:00.000Z',
      sourceUrl: 'https://help.figma.com/github',
    },
  ],
  categories: [{ name: 'Design', slug: 'design', url: 'https://slothhub.dev/design' }],
  tags: [
    {
      name: 'Prototyping',
      slug: 'prototyping',
      url: 'https://slothhub.dev/tag/prototyping.md',
    },
  ],
  useCases: [
    {
      name: 'Design systems',
      slug: 'design-systems',
      url: 'https://slothhub.dev/use-case/design-systems.md',
    },
  ],
  freshness: {
    hasDeadDestination: false,
    verifiedAt: '2026-07-01T00:00:00.000Z',
    lastCheckedAt: '2026-07-14T00:00:00.000Z',
  },
  detailUrl: 'https://slothhub.dev/tool/figma',
  website: 'https://figma.com',
  visitUrl: 'https://slothhub.dev/go/figma?surface=agent',
  tagline: 'Design together',
  keyFeatures: ['Realtime collaboration'],
  securityCapabilities: ['sso_saml'],
  targetAudience: 'Product designers',
  agentInterfaceKinds: ['mcp_server'],
  search: {
    text: 'figma collaborative design platform realtime collaboration design systems product designers',
    tokens: ['figma', 'collaborative', 'design', 'platform', 'realtime', 'systems'],
    fields: {
      name: 'Figma',
      description: 'Collaborative design platform',
      tagline: 'Design together',
      targetAudience: 'Product designers',
      keyFeatures: ['Realtime collaboration'],
      platforms: ['web', 'desktop'],
      categories: ['Design'],
      tags: ['Prototyping'],
      useCases: ['Design systems'],
      resourceKind: ['App'],
      agentInterfaceKinds: ['mcp_server'],
    },
  },
} satisfies AgentSearchIndexFeed['data']['tools'][number];

export const linearTool = {
  ...figmaTool,
  name: 'Linear',
  slug: 'linear',
  description: 'Issue tracking for product teams',
  pricing: 'paid',
  platforms: ['web'],
  integrations: [
    {
      slug: 'github',
      name: 'GitHub',
      status: 'api',
      checkedAt: '2026-07-21T00:00:00.000Z',
      sourceUrl: 'https://linear.app/docs/github',
    },
  ],
  categories: [
    {
      name: 'Productivity',
      slug: 'productivity',
      url: 'https://slothhub.dev/productivity',
    },
  ],
  tags: [],
  useCases: [],
  detailUrl: 'https://slothhub.dev/tool/linear',
  website: 'https://linear.app',
  visitUrl: 'https://slothhub.dev/go/linear?surface=agent',
  securityCapabilities: [],
  agentInterfaceKinds: [],
  search: {
    text: 'linear issue tracking product teams',
    tokens: ['linear', 'issue', 'tracking', 'product', 'teams'],
    fields: {
      name: 'Linear',
      description: 'Issue tracking for product teams',
      keyFeatures: ['Roadmaps'],
      platforms: ['web'],
      categories: ['Productivity'],
      tags: [],
      useCases: [],
      resourceKind: ['App'],
      agentInterfaceKinds: [],
    },
  },
} satisfies AgentSearchIndexFeed['data']['tools'][number];

const toToolSummary = ({
  keyFeatures: _keyFeatures,
  search: _search,
  tagline: _tagline,
  targetAudience: _targetAudience,
  ...tool
}: AgentSearchIndexFeed['data']['tools'][number]): AgentToolsFeed['data']['tools'][number] => ({
  ...tool,
  freshness: {
    isVerified: Boolean(tool.freshness.verifiedAt),
    ...tool.freshness,
  },
});

export const searchIndexFeed: AgentSearchIndexFeed = {
  version: '17.0.0',
  siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-07-08T00:00:00.000Z',
  data: {
    tools: [figmaTool, linearTool],
    filters: {
      pricing: [],
      platforms: [],
      resourceKinds: [],
      securityCapabilities: [{ value: 'sso_saml', label: 'SSO/SAML', count: 1 }],
      agentInterfaceKinds: [{ value: 'mcp_server', label: 'MCP server', count: 1 }],
      categories: [],
      tags: [],
      useCases: [],
    },
    queryContract: {
      textQuery: {
        parameter: 'q',
        tokenRule: 'CLI and MCP ignore common stopwords and generic app, library, and tool words; remaining tokens match whole words or word prefixes with light plural and -ing/-ed folding. Auth matches authentication and authorization, not author or OAuth. Partial matches rank by matched-token count, then by field (name/slug, taxonomy, description, remaining public search text) weighted by how rare each token is in the catalog, so a specific word such as postgres outweighs a common one such as hosting. Explicit identifiers still require every meaningful token. Stopword-only queries return no matches. Prefixes such as figm match Figma; misspellings such as figam are not corrected. Browser search additionally uses fuzzy matching and may return different results and ordering.',
        ranking: [],
      },
      filters: {
        pricing: { parameter: 'pricing', values: ['free', 'paid', 'freemium'] },
        platform: {
          parameter: 'platform',
          values: ['web', 'desktop', 'mobile', 'extension', 'cli'],
        },
        category: {
          parameter: 'category',
          valuesFrom: 'filters.categories[].value',
        },
        tag: { parameter: 'tag', valuesFrom: 'filters.tags[].value' },
        useCase: {
          parameter: 'useCase',
          valuesFrom: 'filters.useCases[].value',
        },
        resourceKind: {
          parameter: 'resourceKind',
          values: ['app', 'github_repository', 'package', 'mcp_server', 'docs', 'api', 'cli_tool', 'template', 'guide'],
        },
        agentInterfaceKind: {
          parameter: 'agentInterfaceKind',
          values: [],
        },
        securityCapability: {
          parameter: 'securityCapability',
          values: ['sso_saml'],
        },
      },
      pagination: { parameter: 'page', defaultPage: 1, pageSize: 24 },
    },
  },
};

export const toolsFeed: AgentToolsFeed = {
  version: '33.0.0',
  siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-07-08T00:00:00.000Z',
  data: {
    tools: [
      toToolSummary(figmaTool),
      toToolSummary(linearTool),
    ],
  },
};

export const toolDetailFeed: AgentToolDetailFeed = {
  version: '33.0.0',
  siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-07-08T00:00:00.000Z',
  data: {
    ...figmaTool,
    freshness: toToolSummary(figmaTool).freshness,
    keyFeatures: ['Realtime collaboration'],
    resourceLinks: [
      {
        label: 'Official docs',
        url: 'https://help.figma.com/',
        kind: 'official_docs',
        isOfficial: true,
        checkedAt: '2026-07-01T00:00:00.000Z',
        note: 'Start here for product setup and collaboration docs.',
      },
    ],
    runtimeRequirements: [{
      subjectKind: 'runtime',
      subjectName: 'Node.js',
      environmentRange: '>=20 <23',
      status: 'partial',
      note: 'Native extensions need a compiler.',
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
    alternativeTools: [toToolSummary(linearTool)],
  },
};

export const linearToolDetailFeed: AgentToolDetailFeed = {
  version: '33.0.0',
  siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-07-08T00:00:00.000Z',
  data: {
    ...linearTool,
    freshness: toToolSummary(linearTool).freshness,
    keyFeatures: ['Roadmaps'],
    alternativeTools: [toToolSummary(figmaTool)],
  },
};

export const stacksFeed: AgentToolStackFeed = {
  version: '33.0.0',
  siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-07-08T00:00:00.000Z',
  data: {
    stacks: [
      {
        name: 'Product Design Stack',
        slug: 'product-design',
        description: 'A focused stack for product designers.',
        url: 'https://slothhub.dev/stacks/product-design',
        tags: [],
        tools: [{ role: 'Design', description: 'Design screens together', tool: toToolSummary(figmaTool) }],
      },
      {
        name: 'Backend Stack',
        slug: 'backend-stack',
        description: 'A focused stack for backend workflows.',
        url: 'https://slothhub.dev/stacks/backend-stack',
        tags: [],
        tools: [{ role: 'Planning', description: 'Plan backend work', tool: toToolSummary(linearTool) }],
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
        title: 'Best Design Tools',
        slug: 'design-tools',
        intro: 'The best design tools for modern teams.',
        url: 'https://slothhub.dev/best/design-tools',
        rankedTools: [{ rank: 1, editorialBlurb: 'Best for collaborative design.', tool: toToolSummary(figmaTool) }],
      },
    ],
  },
};

export const comparisonsFeed: AgentComparisonsFeed = {
  version: '33.0.0',
  siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-07-08T00:00:00.000Z',
  data: {
    comparisonsUrl: 'https://slothhub.dev/compare',
    comparisons: [
      {
        slug: 'figma-vs-sketch',
        title: 'Figma vs Sketch',
        description: 'A head-to-head look at collaborative design tools.',
        pageUrl: 'https://slothhub.dev/compare/figma-vs-sketch',
        jsonUrl: 'https://slothhub.dev/api/compare/figma-vs-sketch.json',
        markdownUrl: 'https://slothhub.dev/compare/figma-vs-sketch.md',
        primary: toToolSummary(figmaTool),
        secondary: toToolSummary(linearTool),
        featureRows: [
          {label: 'Pricing', primary: 'Freemium', secondary: 'Paid'},
        ],
        verdict: 'Figma wins for collaboration.',
        reviewedAt: '2026-07-01',
      },
      {
        slug: 'linear-vs-jira',
        title: 'Linear vs Jira',
        description: 'Issue tracking compared for modern teams.',
        pageUrl: 'https://slothhub.dev/compare/linear-vs-jira',
        jsonUrl: 'https://slothhub.dev/api/compare/linear-vs-jira.json',
        markdownUrl: 'https://slothhub.dev/compare/linear-vs-jira.md',
        primary: toToolSummary(linearTool),
        secondary: toToolSummary(figmaTool),
      },
    ],
  },
};

export const comparisonDetailFeed: AgentComparisonDetailFeed = {
  version: '33.0.0',
  siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-07-08T00:00:00.000Z',
  data: comparisonsFeed.data.comparisons[0]!,
};

export const emptyComparisonsFeed: AgentComparisonsFeed = {
  version: '33.0.0',
  siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-07-08T00:00:00.000Z',
  data: {comparisonsUrl: 'https://slothhub.dev/compare', comparisons: []},
};

export const alternativesFeed: AgentAlternativesFeed = {
  version: '33.0.0',
  siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-08-28T00:00:00.000Z',
  data: {
    alternativesUrl: 'https://slothhub.dev/all',
    sets: [
      {
        name: 'Figma',
        slug: 'figma',
        detailUrl: 'https://slothhub.dev/tool/figma',
        alternativesUrl: 'https://slothhub.dev/tool/figma#alternatives-tools-heading',
        alternativeCount: 1,
        alternatives: [toToolSummary(linearTool)],
        markdownUrl: 'https://slothhub.dev/alternatives/figma.md',
        jsonUrl: 'https://slothhub.dev/api/alternatives/figma.json',
      },
      {
        name: 'Linear',
        slug: 'linear',
        detailUrl: 'https://slothhub.dev/tool/linear',
        alternativesUrl: 'https://slothhub.dev/tool/linear#alternatives-tools-heading',
        alternativeCount: 1,
        alternatives: [toToolSummary(figmaTool)],
        markdownUrl: 'https://slothhub.dev/alternatives/linear.md',
        jsonUrl: 'https://slothhub.dev/api/alternatives/linear.json',
      },
    ],
  },
};

const alternativesDetailFeedBody: Omit<AgentAlternativesDetailFeed, 'contentHash'> = {
  version: alternativesFeed.version,
  siteUrl: alternativesFeed.siteUrl,
  generatedAt: alternativesFeed.generatedAt,
  data: {
    ...alternativesFeed.data.sets[0]!,
    description: 'Collaborative design platform',
    sourceTool: toToolSummary(figmaTool),
  },
};

export const alternativesDetailFeed = {
  ...alternativesDetailFeedBody,
  contentHash: computeContentHash(alternativesDetailFeedBody),
} satisfies AgentAlternativesDetailFeed;

export const categoriesFeed: AgentCategoriesFeed = {
  version: '33.0.0',
  siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-07-08T00:00:00.000Z',
  data: {
    categories: [
      {
        name: 'Design',
        slug: 'design',
        description: 'Tools for product and visual design.',
        url: 'https://slothhub.dev/design',
        toolCount: 12,
      },
      {
        name: 'Developer tools',
        slug: 'developer-tools',
        url: 'https://slothhub.dev/developer-tools',
        toolCount: 8,
      },
      {
        name: 'Productivity',
        slug: 'productivity',
        url: 'https://slothhub.dev/productivity',
        toolCount: 1,
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
        name: 'Prototyping',
        slug: 'prototyping',
        url: 'https://slothhub.dev/tag/prototyping.md',
        toolCount: 4,
      },
      {
        name: 'Open source',
        slug: 'open-source',
        url: 'https://slothhub.dev/tag/open-source.md',
        toolCount: 2,
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
        name: 'Design systems',
        slug: 'design-systems',
        url: 'https://slothhub.dev/use-case/design-systems.md',
        toolCount: 3,
      },
      {
        name: 'Issue tracking',
        slug: 'issue-tracking',
        url: 'https://slothhub.dev/use-case/issue-tracking.md',
        toolCount: 1,
      },
    ],
  },
};

export const emptyCategoriesFeed: AgentCategoriesFeed = {
  version: '33.0.0',
  siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-07-08T00:00:00.000Z',
  data: {categories: []},
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
  markdownArtifacts: { },
  integrationHubUrl: 'https://slothhub.dev/agents',
  markdownHubUrl: 'https://slothhub.dev/agents.md',
  toolDetailUrlTemplate: 'https://slothhub.dev/api/tools/{slug}.json',
  citationGuidance: ['Cite canonical Tool detail URLs.'],
};
