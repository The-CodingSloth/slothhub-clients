import {supportedLanguageSchema} from '@slothhub/domain/supported-language';
import {AGENT_SETUP_RECIPE_HOST_VALUES} from '@slothhub/domain/mcp-registry';
import {BREWFILE_INVENTORY_ARTIFACT, BREWFILE_INVENTORY_VERSION} from '@slothhub/domain/brewfile-inventory';
import {ECOSYSTEM_MANIFEST_INVENTORY_ARTIFACT, ECOSYSTEM_MANIFEST_INVENTORY_VERSION} from '@slothhub/domain/ecosystem-manifest-inventory';
import {GO_MOD_INVENTORY_ARTIFACT, GO_MOD_INVENTORY_VERSION} from '@slothhub/domain/go-mod-inventory';
import {AGENT_SEARCH_MAX_RESULT_LIMIT} from '@slothhub/domain/agent-search';
import {NPM_MANIFEST_DEPENDENCY_MAPS, NPM_MANIFEST_INVENTORY_ARTIFACT, NPM_MANIFEST_INVENTORY_VERSION} from '@slothhub/domain/npm-manifest-inventory';
import {TOOL_ASSEMBLY_PLATFORM_VALUES, TOOL_ASSEMBLY_VERSION} from '@slothhub/domain/tool-assembly';
import { AGENT_INTERFACE_KIND_VALUES } from '@slothhub/domain/agent-interface';
import { z } from 'zod';
import {REGISTRY_HANDOFF_DESTINATIONS} from '@slothhub/domain/registry-handoffs';

import {
  bestItemSchema,
  categoryItemSchema,
  publicAgentInterfaceSchema,
  publicComparisonFactsSchema,

  stackItemSchema,
  taxonomyListItemSchema,
  toolDetailSchema,
  toolSummarySchema} from '@slothhub/domain/public-feed-mcp-schemas';
import {resourceKindReferenceSchema} from '@slothhub/domain/public-feed-relationships';

const paginationFields = {
  total: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  has_more: z.boolean(),
  next_offset: z.number().int().nonnegative().optional(),
};

const stackListItemSchema = z
  .object({
    name: z.string(),
    slug: z.string(),
    description: z.string().optional(),
    url: z.string(),
    toolCount: z.number().int().nonnegative(),
    recipeAvailable: z.literal(true).optional(),
  });

const bestListItemSchema = z
  .object({
    title: z.string(),
    slug: z.string(),
    intro: z.string().optional(),
    url: z.string(),
    rankedCount: z.number().int().nonnegative(),
  });

export const searchToolsOutputSchema = z
  .object({
    query: z.string(),
    handoffs: z.array(z.object({
      destination: z.enum(REGISTRY_HANDOFF_DESTINATIONS), label: z.string(), href: z.url(),
    })).optional(),
    recovery: z.object({
      code: z.enum(['no_catalog_matches', 'filters_excluded_matches']),
      message: z.string(),
      handoffQueryLimit: z.object({limitCharacters: z.number(), observedCharacters: z.number()}).optional(),
    }).optional(),
    ...paginationFields,
    results: z.array(
      z
        .object({
          name: z.string(),
          slug: z.string(),
          description: z.string(),
          pricing: z.string().optional(),
          platforms: z.array(z.string()),
          resourceKind: resourceKindReferenceSchema,
          supportedLanguages: z.array(supportedLanguageSchema).optional(),
          agentInterfaceKinds: z.array(z.enum(AGENT_INTERFACE_KIND_VALUES)),
          detailUrl: z.string(),
          visitUrl: z.string(),
          score: z.number(),
        })
    ),
    articles: z.array(z.object({
      kind: z.literal('article'),
      title: z.string(),
      slug: z.string(),
      url: z.string(),
      excerpt: z.string().optional(),
      score: z.number(),
    })).optional(),
    article_pagination: z.object({
      ...paginationFields,
      limit: z.number().int().min(1).max(AGENT_SEARCH_MAX_RESULT_LIMIT),
      configured_limit: z.literal(AGENT_SEARCH_MAX_RESULT_LIMIT),
    }).optional(),
  });

export const getToolOutputSchema = z
  .object({
    tool: toolDetailSchema,
    displayLimit: z.object({
      code: z.literal('tool_detail_display_limit_exceeded'),
      configuredLimit: z.number().int().positive(),
      observedCharacters: z.number().int().positive(),
      recovery: z.string(),
    }).optional(),
  });

export const getStackOutputSchema = z
  .object({
    stack: stackItemSchema,
  });

export const getBestListOutputSchema = z
  .object({
    best: bestItemSchema,
  });

export const getVisitUrlOutputSchema = z
  .object({
    slug: z.string(),
    visitUrl: z.string(),
    detailUrl: z.string(),
    citationNote: z.string(),
  });

export const doctorOutputSchema = z
  .object({
    version: z.string(),
    siteUrl: z.string(),
    generatedAt: z.string(),
    baseUrl: z.string(),
    schemaUrl: z.string(),
    feeds: z.record(z.string(), z.string()),
    snapshots: z.record(z.string(), z.string()),
    citationGuidance: z.array(z.string()),
    networkEnvironment: z.object({
      httpsProxy: z.boolean(),
      httpProxy: z.boolean(),
      noProxy: z.boolean(),
      envProxyEnabled: z.boolean(),
      nodeExtraCaCerts: z.boolean(),
    }),
  });

export const validatePinManifestOutputSchema = z
  .object({
    valid: z.literal(true),
    artifact: z.string(),
    version: z.number().int(),
    toolCount: z.number().int().nonnegative(),
  });

export const renderPinManifestOutputSchema = z
  .object({
    artifact: z.string(),
    version: z.number().int(),
    rendered: z.string(),
  });

export const validateDecisionReceiptOutputSchema = z
  .object({
    valid: z.literal(true),
    receiptId: z.string(),
    schemaVersion: z.string(),
    candidateCount: z.number().int().nonnegative(),
  });

export const renderDecisionReceiptOutputSchema = z
  .object({
    receiptId: z.string(),
    schemaVersion: z.string(),
    rendered: z.string(),
  });

// Mirror of the domain ToolAssemblyReport contract so structured output
// validates as the same report the CLI's `slothhub assembly --json` emits.
const toolAssemblyFactSourceSchema = z
  .object({
    kind: z.enum(['tool_detail_feed', 'inline_requirement', 'checker']),
    toolSlug: z.string().optional(),
    checkedAt: z.string().optional(),
    url: z.string().optional(),
  });

const toolAssemblyFindingStateSchema = z.enum(['confirmed', 'conflict', 'unknown']);

const toolAssemblyFindingSchema = z
  .object({
    axis: z.enum(['integration', 'platform', 'agent_interface']),
    key: z.string(),
    label: z.string(),
    state: toolAssemblyFindingStateSchema,
    reason: z.string(),
    facts: z.array(
      z
        .object({
          toolSlug: z.string(),
          state: toolAssemblyFindingStateSchema,
          status: z.string().optional(),
          source: toolAssemblyFactSourceSchema,
        })
    ),
    source: toolAssemblyFactSourceSchema,
  });

const toolAssemblyReportSchema = z
  .object({
    schemaVersion: z.literal(TOOL_ASSEMBLY_VERSION),
    identity: z.string(),
    selectedTools: z.array(
      z
        .object({
          slug: z.string(),
          name: z.string(),
        })
    ),
    requirements: z
      .object({
        integrations: z.array(z.string()),
        platforms: z.array(z.enum(TOOL_ASSEMBLY_PLATFORM_VALUES)),
        agentInterfaceKinds: z.array(z.enum(AGENT_INTERFACE_KIND_VALUES)),
      }),
    confirmedOverlap: z.array(toolAssemblyFindingSchema),
    explicitConflicts: z.array(toolAssemblyFindingSchema),
    missingEvidence: z.array(toolAssemblyFindingSchema),
    unresolvedTools: z.array(
      z
        .object({
          slug: z.string(),
          state: z.literal('unknown'),
          reason: z.string(),
          source: toolAssemblyFactSourceSchema,
        })
    ),
    notEvaluatedAxes: z.array(
      z
        .object({
          axis: z.enum(['runtime_os', 'deployment_source', 'resource_relationships']),
          state: z.literal('not_evaluated'),
          reason: z.string(),
          source: toolAssemblyFactSourceSchema,
        })
    ),
    disclaimer: z.string(),
  });

export const checkToolAssemblyOutputSchema = z
  .object({
    report: toolAssemblyReportSchema,
  });

export const listMcpServersOutputSchema = z
  .object({
    query: z.string(),
    ...paginationFields,
    mcp_servers: z.array(
      z
        .object({
          name: z.string(),
          slug: z.string(),
          description: z.string(),
          detailUrl: z.string(),
          mcpRegistryUrl: z.string().optional(),
          registryId: z.string().optional(),
          agentInterfaces: z.array(publicAgentInterfaceSchema),
        })
    ),
  });

export const listAgentSkillsOutputSchema = z
  .object({
    query: z.string(),
    ...paginationFields,
    agent_skills: z.array(
      z
        .object({
          name: z.string(),
          slug: z.string(),
          description: z.string(),
          detailUrl: z.string(),
          agentInterfaces: z.array(publicAgentInterfaceSchema),
        })
    ),
  });

export const listStacksOutputSchema = z
  .object({
    query: z.string(),
    ...paginationFields,
    stacks: z.array(stackListItemSchema),
  });

export const listBestOutputSchema = z
  .object({
    query: z.string(),
    ...paginationFields,
    best: z.array(bestListItemSchema),
  });

export const listCategoriesOutputSchema = z
  .object({
    query: z.string(),
    ...paginationFields,
    categories: z.array(categoryItemSchema),
  });

export const listTagsOutputSchema = z
  .object({
    query: z.string(),
    ...paginationFields,
    tags: z.array(taxonomyListItemSchema),
  });

export const listUseCasesOutputSchema = z
  .object({
    query: z.string(),
    ...paginationFields,
    useCases: z.array(taxonomyListItemSchema),
  });

const alternativesSetSummarySchema = z
  .object({
    name: z.string(),
    slug: z.string(),
    detailUrl: z.string(),
    alternativesUrl: z.string(),
    alternativeCount: z.number().int().nonnegative(),
    markdownUrl: z.string(),
    jsonUrl: z.string(),
  });

export const listAlternativesOutputSchema = z
  .object({
    query: z.string(),
    ...paginationFields,
    alternatives: z.array(alternativesSetSummarySchema),
  });

const alternativesSetDetailSchema = alternativesSetSummarySchema.extend({
  description: z.string().optional(),
  alternatives: z.array(toolSummarySchema),
  comparisonFacts: publicComparisonFactsSchema.optional(),
  sourceTool: toolSummarySchema,
});

export const getAlternativesOutputSchema = z
  .object({
    alternatives: alternativesSetDetailSchema,
  });

const comparisonPairSummarySchema = z
  .object({
    slug: z.string(),
    title: z.string(),
    description: z.string().optional(),
    pageUrl: z.string(),
    jsonUrl: z.string(),
    markdownUrl: z.string(),
    primary: z.object({name: z.string(), slug: z.string()}),
    secondary: z.object({name: z.string(), slug: z.string()}),
  });

export const listComparisonsOutputSchema = z
  .object({
    query: z.string(),
    ...paginationFields,
    comparisons: z.array(comparisonPairSummarySchema),
  });

const comparisonPairDetailSchema = comparisonPairSummarySchema.extend({
  primary: toolSummarySchema,
  secondary: toolSummarySchema,
  primaryComparisonFacts: publicComparisonFactsSchema.optional(),
  secondaryComparisonFacts: publicComparisonFactsSchema.optional(),
  featureRows: z
    .array(
      z.object({
        label: z.string(),
        primary: z.string(),
        secondary: z.string(),
      }),
    )
    .optional(),
  verdict: z.string().optional(),
  reviewedAt: z.string().optional(),
  sourceReferences: z
    .array(
      z.object({
        title: z.string().optional(),
        url: z.string(),
        publisher: z.string().optional(),
        accessedAt: z.string().optional(),
      }),
    )
    .optional(),
});

export const getComparisonOutputSchema = z
  .object({
    comparison: comparisonPairDetailSchema,
  });

const npmManifestDependencyMapSchema = z.enum(NPM_MANIFEST_DEPENDENCY_MAPS);

const inventoryEntrySchema = z.object({
  name: z.string(),
  declaredIn: z.array(npmManifestDependencyMapSchema),
  state: z.enum([
    'matched', 'aliased', 'retired', 'unknown', 'unsupported', 'capability_unavailable',
  ]),
  tool: z.object({
    slug: z.string(), name: z.string(), detailUrl: z.string(),
  }).optional(),
});

export const inventoryNpmManifestOutputSchema = z
  .object({
    artifact: z.literal(NPM_MANIFEST_INVENTORY_ARTIFACT),
    version: z.literal(NPM_MANIFEST_INVENTORY_VERSION),
    lookupVersion: z.string().nullable(),
    dependencyMaps: z.array(npmManifestDependencyMapSchema),
    dependencies: z.array(inventoryEntrySchema),
    summary: z.object({
      total: z.number().int().nonnegative(),
      matched: z.number().int().nonnegative(),
      aliased: z.number().int().nonnegative(),
      retired: z.number().int().nonnegative(),
      unknown: z.number().int().nonnegative(),
      unsupported: z.number().int().nonnegative(),
      capabilityUnavailable: z.number().int().nonnegative(),
    }),
    disclaimer: z.string(),
  });

const inventoryReportBaseSchema = inventoryNpmManifestOutputSchema.omit({
  artifact: true, dependencyMaps: true, dependencies: true,
});

// Preserve each domain report's discriminant and required fields. npm callers
// retain their existing envelope; the additional formats use the CLI contracts.
export const inventoryManifestOutputSchema = z.discriminatedUnion('artifact', [
  inventoryNpmManifestOutputSchema,
  inventoryReportBaseSchema.extend({
    artifact: z.literal(ECOSYSTEM_MANIFEST_INVENTORY_ARTIFACT),
    version: z.literal(ECOSYSTEM_MANIFEST_INVENTORY_VERSION),
    ecosystem: z.enum(['pypi', 'crates']),
    dependencyMaps: z.array(z.string()),
    dependencies: z.array(inventoryEntrySchema.extend({declaredIn: z.array(z.string())})),
  }),
  inventoryReportBaseSchema.extend({
    artifact: z.literal(BREWFILE_INVENTORY_ARTIFACT),
    version: z.literal(BREWFILE_INVENTORY_VERSION),
    formulas: z.array(inventoryEntrySchema.omit({declaredIn: true})),
  }),
  inventoryReportBaseSchema.extend({
    artifact: z.literal(GO_MOD_INVENTORY_ARTIFACT),
    version: z.literal(GO_MOD_INVENTORY_VERSION),
    modulePath: z.string(),
    requirements: z.array(inventoryEntrySchema.omit({name: true, declaredIn: true}).extend({
      modulePath: z.string(), version: z.string(),
    })),
    skippedDirectives: z.array(z.discriminatedUnion('directive', [
      z.object({directive: z.literal('replace'), rule: z.literal('replace_not_followed'), count: z.number().int().nonnegative()}),
      z.object({directive: z.literal('exclude'), rule: z.literal('exclude_not_followed'), count: z.number().int().nonnegative()}),
      z.object({directive: z.literal('retract'), rule: z.literal('retract_not_followed'), count: z.number().int().nonnegative()}),
    ])),
  }),
]);

const toolBatchIssueSchema = z.object({
  slug: z.string(),
  field: z.string(),
  rule: z.string(),
});

export const validateToolBatchOutputSchema = z.object({
  exitStatus: z.union([z.literal(0), z.literal(1)]),
  errors: z.array(toolBatchIssueSchema),
  warnings: z.array(toolBatchIssueSchema),
});
