import { z } from 'zod';
import {DEFAULT_RECOMMENDATION_LIMIT, MAX_COMPARE_TOOLS} from '@slothhub/domain/agent-workflows';
import {tokenizePublicAgentSearchText} from '@slothhub/domain/agent-search';
import {
  catalogQuerySchema,
  stackSlugSchema,
  getToolInputSchema,
  limitSchema,
  responseFormatSchema,
  searchToolsInputSchema,
} from './inputs.js';
import { toolQuickstartSchema, publicToolIntegrationSchema } from '@slothhub/domain/public-feed-mcp-schemas';

const citationSourceSchema = z.object({
  label: z.string(),
  url: z.string(),
  kind: z.string(),
  usage: z.enum(['citation', 'implementation_reference', 'visit_action']),
  isOfficial: z.boolean().optional(),
  note: z.string().optional(),
});
const workflowToolSummarySchema = z.object({
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  pricing: z.string().optional(),
  platforms: z.array(z.string()),
  categories: z.array(z.string()),
  useCases: z.array(z.string()),
  resourceKind: z.string(),
  detailUrl: z.string(),
  website: z.string().optional(),
  setupRecipeHosts: z.array(z.string()).optional(),
});
const recommendedToolSchema = workflowToolSummarySchema.extend({
  score: z.number(),
  reasons: z.array(z.string()),
  caveats: z.array(z.string()),
  citations: z.array(citationSourceSchema),
});
export const recommendationOutput = z.object({
  requirements: z.string(),
  selected: recommendedToolSchema.optional(),
  candidates: z.array(recommendedToolSchema),
  criteria: z.array(z.string()),
  caveats: z.array(z.string()),
});
export const planOutput = z.object({
  tool: workflowToolSummarySchema,
  stack: z
    .object({
      name: z.string(),
      slug: z.string(),
      url: z.string().optional(),
      role: z.string().optional(),
    })
    .optional(),
  quickstarts: z.array(toolQuickstartSchema).optional(),
  steps: z.array(
    z.object({
      title: z.string(),
      detail: z.string(),
      sourceUrl: z.string(),
      sourceLabel: z.string(),
    }),
  ),
  caveats: z.array(z.string()),
  citations: z.array(citationSourceSchema),
});
export const citationsOutput = z.object({
  tool: workflowToolSummarySchema,
  sources: z.array(citationSourceSchema),
});
export const comparisonOutput = z.object({
  tools: z.array(
    workflowToolSummarySchema.extend({
      integrations: z.array(publicToolIntegrationSchema).optional(),
      securityPrivacyPosture: z
        .object({
          securityCapabilities: z
            .array(
              z.object({
                capability: z.string(),
                label: z.string(),
                status: z.enum([
                  'verified',
                  'claimed',
                  'unknown',
                  'not_applicable',
                ]),
                sourceUrl: z.string().optional(),
                sourceTitle: z.string().optional(),
                checkedAt: z.string().optional(),
                note: z.string().optional(),
              }),
            )
            .optional(),
        })
        .optional(),
      keyFeatures: z.array(z.string()),
      agentInterfaceKinds: z.array(z.string()),
      targetAudience: z.string().optional(),
      officialResources: z.array(citationSourceSchema),
      productLimits: z.object({
        state: z.enum(['listed', 'unknown']),
        groups: z.array(
          z.object({
            metric: z.string(),
            planScope: z.string().optional(),
            deploymentScope: z.string().optional(),
            ambiguous: z.boolean(),
            facts: z.array(
              z.object({
                state: z.string(),
                comparator: z.string().optional(),
                value: z.number().optional(),
                unit: z.string().optional(),
              }),
            ),
          }),
        ),
      }),
      pricingPlans: z.object({
        currency: z.string().optional(),
        pricingUrl: z.string().optional(),
        trialAvailability: z.enum(['available', 'unavailable']).optional(),
        plans: z.array(z.object({name: z.string(), priceType: z.string().optional(), listPrice: z.number().optional(), billing: z.string(), billingPeriod: z.string().optional()})),
        usageAddOns: z.array(z.object({planName: z.string().optional(), unit: z.string(), rate: z.number(), billing: z.string()})),
      }).optional(),
      licenses: z.array(z.object({scope: z.string(), status: z.string(), license: z.string(), sourceUrl: z.string().optional()})).optional(),
      runtimeRequirements: z.object({
        state: z.enum(['listed', 'unknown']),
        requirements: z.array(
          z.object({
            subjectName: z.string(),
            subjectKind: z.string(),
            environmentRange: z.string(),
            toolRange: z.string().optional(),
            status: z.string(),
          }),
        ),
      }),
    }),
  ),
  criteria: z.array(z.string()),
  gaps: z.array(z.string()),
  citations: z.array(citationSourceSchema),
});
export const recommendationInput = searchToolsInputSchema
  .omit({ query: true, offset: true })
  .extend({
    requirements: catalogQuerySchema.pipe(z.string().trim().min(1, 'invalid_input: Recommendation requirements must not be blank.').refine((value) => tokenizePublicAgentSearchText(value).length > 0, 'invalid_input: Recommendation requirements must contain searchable text.')),
    limit: limitSchema.unwrap().default(DEFAULT_RECOMMENDATION_LIMIT).describe(`Maximum recommendation candidates to return (default ${DEFAULT_RECOMMENDATION_LIMIT})`),
  });
export const comparisonInput = z
  .object({
    // Match the CLI envelope; receipt: upstream docs/measurements/agent-workflows-install-links-2026-10-16.md.
    slugs: z.array(z.string().min(1)).superRefine((slugs, context) => {
      if (slugs.length < 2 || slugs.length > MAX_COMPARE_TOOLS)
        context.addIssue({
          code: 'custom',
          message: `comparison_tool_count_out_of_range: configured_limit=${MAX_COMPARE_TOOLS} observed_count=${slugs.length} recovery=Choose between 2 and ${MAX_COMPARE_TOOLS} Tools.`,
        });
    }),
    response_format: responseFormatSchema,
  })
  .strict();
export const planInput = getToolInputSchema.extend({
  stack: stackSlugSchema.optional(),
});
