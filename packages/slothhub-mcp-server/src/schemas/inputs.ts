import {AGENT_SEARCH_INTEGRATION_CONNECTION_VALUES, AGENT_SEARCH_MAX_QUERY_CHARACTERS, AGENT_SEARCH_MAX_RESULT_LIMIT} from '@slothhub/domain/agent-search';
import {AGENT_INTERFACE_KIND_VALUES} from '@slothhub/domain/agent-interface';
import {AGENT_SETUP_RECIPE_CONFIG_HOST_VALUES} from '@slothhub/domain/mcp-registry';
import {DECISION_RECEIPT_MAX_JSON_BYTES} from '@slothhub/domain/decision-receipt';
import {NPM_MANIFEST_INVENTORY_MAX_BYTES} from '@slothhub/domain/npm-manifest-inventory';
import {PROJECT_TOOL_PIN_MANIFEST_MAX_BYTES} from '@slothhub/domain/project-tool-pin-manifest';
import {RESOURCE_KIND_VALUES} from '@slothhub/domain/resource-kind';
import {TOOL_ASSEMBLY_MAX_TOOLS, TOOL_ASSEMBLY_MIN_TOOLS, TOOL_ASSEMBLY_PLATFORM_VALUES} from '@slothhub/domain/tool-assembly';
import {PACKAGE_REGISTRY_VALUES} from '@slothhub/domain/registry-handoffs';
import {TOOL_LOOKUP_NAMESPACE_VALUES} from '@slothhub/domain/tool-lookup';
import { SECURITY_CAPABILITY_VALUES } from '@slothhub/domain/security-capability';
import {SOURCE_AVAILABILITY_FILTER_VALUES} from '@slothhub/domain/source-availability-filter';
import { z } from 'zod';

import {
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
  PLATFORM_VALUES,
  PRICING_VALUES,
  ResponseFormat} from '../constants.js';

const enumError =
  (label: string, allowed: readonly string[]) =>
  `Invalid ${label}. Allowed values: ${allowed.join(', ')}`;

export const responseFormatSchema = z
  .enum(ResponseFormat)
  .default(ResponseFormat.MARKDOWN)
  .describe("Output format: 'markdown' for human-readable or 'json' for machine-readable");

export const limitSchema = z
  .number()
  .int()
  .min(1, {
    error: (issue) =>
      `agent_search_result_limit_out_of_range: configured_limit=${AGENT_SEARCH_MAX_RESULT_LIMIT} observed_value=${String(issue.input)} recovery=Use a whole-number result limit between 1 and ${AGENT_SEARCH_MAX_RESULT_LIMIT}.`,
  })
  .max(MAX_SEARCH_LIMIT, {
    error: (issue) =>
      `agent_search_result_limit_out_of_range: configured_limit=${AGENT_SEARCH_MAX_RESULT_LIMIT} observed_value=${String(issue.input)} recovery=Use a whole-number result limit between 1 and ${AGENT_SEARCH_MAX_RESULT_LIMIT}.`,
  })
  .default(DEFAULT_SEARCH_LIMIT)
  .describe(`Maximum results to return (1-${MAX_SEARCH_LIMIT}, default ${DEFAULT_SEARCH_LIMIT})`);

export const offsetSchema = z
  .number()
  .int()
  .min(0)
  .default(0)
  .describe('Number of results to skip for pagination');

export const catalogQuerySchema = z
  .string()
  .superRefine((value, context) => {
    const observedCharacters = Array.from(value).length;
    if (observedCharacters > AGENT_SEARCH_MAX_QUERY_CHARACTERS) {
      context.addIssue({
        code: 'custom',
        message:
          `agent_search_query_too_long: configured_limit=${AGENT_SEARCH_MAX_QUERY_CHARACTERS} ` +
          `observed_value=${observedCharacters} recovery=Shorten the query to at most ` +
          `${AGENT_SEARCH_MAX_QUERY_CHARACTERS} characters.`,
      });
    }
  });

const optionalCatalogListQuerySchema = catalogQuerySchema.optional();

export const pricingFilterSchema = z
  .enum(PRICING_VALUES, { error: enumError('pricing', PRICING_VALUES) })
  .optional()
  .describe(`Filter by pricing: ${PRICING_VALUES.join(', ')}`);

export const platformFilterSchema = z
  .enum(PLATFORM_VALUES, { error: enumError('platform', PLATFORM_VALUES) })
  .optional()
  .describe(`Filter by platform: ${PLATFORM_VALUES.join(', ')}`);

export const resourceKindFilterSchema = z
  .enum(RESOURCE_KIND_VALUES, {
    error: enumError('resource_kind', RESOURCE_KIND_VALUES),
  })
  .optional()
  .describe(`Filter by resource kind: ${RESOURCE_KIND_VALUES.join(', ')}`);

export const securityCapabilityFilterSchema = z
  .enum(SECURITY_CAPABILITY_VALUES, {
    error: enumError('security_capability', SECURITY_CAPABILITY_VALUES),
  })
  .optional()
  .describe(`Filter by verified security capability: ${SECURITY_CAPABILITY_VALUES.join(', ')}`);

export const agentInterfaceKindFilterSchema = z
  .enum(AGENT_INTERFACE_KIND_VALUES, {
    error: enumError('agent_interface_kind', AGENT_INTERFACE_KIND_VALUES),
  })
  .optional()
  .describe(`Filter by agent interface kind: ${AGENT_INTERFACE_KIND_VALUES.join(', ')}`);

// Closed vocabularies advertise their values as a JSON Schema enum so agents pick valid ones, while
// parsing still accepts any string: the shared domain validator then returns the structured
// agent_search_unsupported_filter_value error (filter, observed value, supported values, recovery).
// Open vocabularies (category, tag, use case, integration, languages) are plain strings; the feed owns them.
// Recursive z.json() would publish an 828-byte definition per tool for three scalar filters.
const filterPrimitive = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const closedFilter = (values: readonly string[], description: string) =>
  z.string().optional().describe(description).meta({enum: [...values]});

export const searchToolsInputSchema = z
  .object({
    query: z
      .string()
      .optional()
      .describe(`Words to match against Tool names, descriptions and tags, and Article titles (maximum ${AGENT_SEARCH_MAX_QUERY_CHARACTERS} characters). Omit to list by filters only.`),
    pricing: closedFilter(PRICING_VALUES, 'Pricing model.'),
    platform: closedFilter(PLATFORM_VALUES, 'Platform the Tool runs on.'),
    category: z.string().optional().describe('Category slug or name, for example design.'),
    tag: z.string().optional().describe('Tag slug or name.'),
    use_case: z.string().optional().describe('Use case slug or name.'),
    resource_kind: closedFilter(RESOURCE_KIND_VALUES, 'Kind of resource, for example mcp_server, agent_skill or ui_component.'),
    package_registry: closedFilter(PACKAGE_REGISTRY_VALUES, 'Registry the Tool is published to.'),
    security_capability: closedFilter(SECURITY_CAPABILITY_VALUES, 'Verified security capability, for example sso_saml.'),
    agent_interface_kind: closedFilter(AGENT_INTERFACE_KIND_VALUES, 'Agent interface the Tool offers, for example mcp_server or cli.'),
    integration: z.string().optional().describe('Integration slug or name the Tool has documented support for.'),
    integration_connection: closedFilter(AGENT_SEARCH_INTEGRATION_CONNECTION_VALUES, 'How the integration connects; applies to integration, or to any integration when none is given.'),
    languages: z.array(z.string()).optional().describe('Language IDs from filters.supportedLanguages, for example python. Matches any listed language.'),
    agent_host: closedFilter(AGENT_SETUP_RECIPE_CONFIG_HOST_VALUES, 'Only Tools with a ready MCP setup recipe for this agent host.'),
    source_availability: closedFilter(SOURCE_AVAILABILITY_FILTER_VALUES, 'Reviewed source availability; open_source keeps only open-source Tools. Tools without a reviewed fact never match.'),
    // Typed for agents; parsing accepts any JSON primitive so the domain validator owns the structured error.
    destination_health: filterPrimitive.optional().describe("'healthy' keeps only Tools whose website is known to work.").meta({type: 'string', enum: ['healthy']}),
    verified: filterPrimitive.optional().describe('true keeps only Tools a person has verified.').meta({type: 'boolean', enum: [true]}),
    last_checked_after: filterPrimitive.optional().describe('Only Tools checked on or after this UTC date (YYYY-MM-DD).').meta({type: 'string', format: 'date'}),
    limit: z.number().default(DEFAULT_SEARCH_LIMIT).meta({type: 'integer', minimum: 1, maximum: AGENT_SEARCH_MAX_RESULT_LIMIT}).describe(`Results per page for Tools and Articles (1-${AGENT_SEARCH_MAX_RESULT_LIMIT}, default ${DEFAULT_SEARCH_LIMIT}).`),
    offset: offsetSchema.describe('Rows to skip. For the next page, pass the returned next_offset while has_more is true.'),
    response_format: responseFormatSchema,
  })
  .strict();

export const getToolInputSchema = z
  .object({
    slug: z
      .string()
      .min(1)
      .max(2048)
      .describe('Tool slug, a pasted registry or website URL, or the exact lookup value when namespace is provided'),
    namespace: z
      .enum(TOOL_LOOKUP_NAMESPACE_VALUES)
      .optional()
      .describe('Explicit exact-lookup namespace; omit for a Sloth Hub slug'),
    response_format: responseFormatSchema,
  })
  .strict();

export const stackSlugSchema = z.string().min(1).max(160).describe('Tool Stack slug');

export const getStackInputSchema = z
  .object({
    slug: stackSlugSchema,
    response_format: responseFormatSchema,
  })
  .strict();

export const getBestListInputSchema = z
  .object({
    slug: z.string().min(1).max(160).describe('Best-of list slug'),
    response_format: responseFormatSchema,
  })
  .strict();

export const getVisitUrlInputSchema = z
  .object({
    slug: z.string().min(1).max(160).describe('Tool slug'),
    response_format: responseFormatSchema,
  })
  .strict();

export const doctorInputSchema = z
  .object({
    response_format: responseFormatSchema,
  })
  .strict();

// The schema accepts any non-empty string; the shared domain parser owns the
// byte limit, depth/node bounds, dangerous-key rejection, and citation rules so
// failures carry the same named reasons as the CLI.
export const pinManifestInputSchema = z
  .object({
    manifest: z
      .string()
      .min(1)
      .describe(
        `Project Tool pin manifest JSON text (maximum ${PROJECT_TOOL_PIN_MANIFEST_MAX_BYTES} bytes UTF-8)`,
      ),
    response_format: responseFormatSchema,
  })
  .strict();

// Same contract as pinManifestInputSchema: the domain parser owns the byte,
// depth, string, array, and citation limits so failures carry named reasons.
export const decisionReceiptInputSchema = z
  .object({
    receipt: z
      .string()
      .min(1)
      .describe(
        `Decision receipt JSON text, or markdown containing the embedded JSON block (maximum ${DECISION_RECEIPT_MAX_JSON_BYTES} bytes UTF-8 for JSON input)`,
      ),
    response_format: responseFormatSchema,
  })
  .strict();

export const listMcpServersInputSchema = z
  .object({
    query: optionalCatalogListQuerySchema
      .describe('Optional search query within MCP server listings'),
    limit: limitSchema,
    offset: offsetSchema,
    response_format: responseFormatSchema,
  })
  .strict();

export const listAgentSkillsInputSchema = z
  .object({
    query: optionalCatalogListQuerySchema
      .describe('Optional search query within agent skill listings'),
    limit: limitSchema,
    offset: offsetSchema,
    response_format: responseFormatSchema,
  })
  .strict();

export const listStacksInputSchema = z
  .object({
    query: optionalCatalogListQuerySchema
      .describe('Optional search query matched against stack name, slug, and description'),
    limit: limitSchema,
    offset: offsetSchema,
    response_format: responseFormatSchema,
  })
  .strict();

export const listBestInputSchema = z
  .object({
    query: optionalCatalogListQuerySchema
      .describe('Optional search query matched against list title, slug, and intro'),
    limit: limitSchema,
    offset: offsetSchema,
    response_format: responseFormatSchema,
  })
  .strict();

export const listCategoriesInputSchema = z
  .object({
    query: optionalCatalogListQuerySchema
      .describe('Optional search query matched against category name, slug, and description'),
    limit: limitSchema,
    offset: offsetSchema,
    response_format: responseFormatSchema,
  })
  .strict();

export const listTagsInputSchema = z
  .object({
    query: optionalCatalogListQuerySchema
      .describe('Optional search query matched against tag name, slug, and description'),
    limit: limitSchema,
    offset: offsetSchema,
    response_format: responseFormatSchema,
  })
  .strict();

export const listUseCasesInputSchema = z
  .object({
    query: optionalCatalogListQuerySchema
      .describe('Optional search query matched against use case name, slug, and description'),
    limit: limitSchema,
    offset: offsetSchema,
    response_format: responseFormatSchema,
  })
  .strict();

export const listAlternativesInputSchema = z
  .object({
    query: optionalCatalogListQuerySchema
      .describe('Optional search query matched against alternatives set name and slug'),
    limit: limitSchema,
    offset: offsetSchema,
    response_format: responseFormatSchema,
  })
  .strict();

export const getAlternativesInputSchema = z
  .object({
    slug: z
      .string()
      .min(1)
      .max(160)
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/u,
        'slug must be lowercase kebab-case (letters, digits, hyphens)',
      )
      .describe('Alternatives set slug (the source Tool slug)'),
    response_format: responseFormatSchema,
  })
  .strict();

export const listComparisonsInputSchema = z
  .object({
    query: optionalCatalogListQuerySchema
      .describe('Optional search query matched against comparison title and slug'),
    limit: limitSchema,
    offset: offsetSchema,
    response_format: responseFormatSchema,
  })
  .strict();

export const getComparisonInputSchema = z
  .object({
    slug: z
      .string()
      .min(1)
      .max(160)
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/u,
        'slug must be lowercase kebab-case (letters, digits, hyphens)',
      )
      .describe('Comparison pair slug (for example figma-vs-sketch)'),
    response_format: responseFormatSchema,
  })
  .strict();

// The shared handler/domain parser owns unique-count and requirement validation.
// Raw requests use the existing transport byte budget, so duplicate arguments do
// not gain an arbitrary tighter limit before canonical validation can explain them.
export const checkToolAssemblyInputSchema = z
  .object({
    slugs: z
      .array(z.string().min(1))
      .min(1)
      .describe(
        `${TOOL_ASSEMBLY_MIN_TOOLS}-${TOOL_ASSEMBLY_MAX_TOOLS} unique public Tool slugs (lowercase kebab-case). Duplicates are removed before the count check.`,
      ),
    require_integrations: z
      .array(z.string().min(1))
      .optional()
      .describe('Optional Integration slugs every selected Tool must document'),
    require_platforms: z
      .array(z.string().min(1))
      .optional()
      .describe(
        `Optional platforms every selected Tool must support: ${TOOL_ASSEMBLY_PLATFORM_VALUES.join(', ')}`,
      ),
    require_agent_interface_kinds: z
      .array(z.string().min(1))
      .optional()
      .describe(
        `Optional Agent Interface kinds every selected Tool must document: ${AGENT_INTERFACE_KIND_VALUES.join(', ')}`,
      ),
    response_format: responseFormatSchema,
  })
  .strict();

// The handler owns the exactly-one-source check and the shared 64 KiB byte bound so
// violations surface as named SlothHub error codes instead of generic schema errors.
export const inventoryNpmManifestInputSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .max(4096)
      .optional()
      .describe(`Path to one explicit package.json, pyproject.toml, Cargo.toml, go.mod, or Brewfile (max ${NPM_MANIFEST_INVENTORY_MAX_BYTES} bytes). No globs, directories, or workspace discovery.`),
    manifest: z
      .string()
      .optional()
      .describe(`Inline UTF-8 manifest text (max ${NPM_MANIFEST_INVENTORY_MAX_BYTES} bytes). Provide exactly one of path or manifest. Use ecosystem for TOML or brewfile for Homebrew; a leading module directive selects Go.`),
    ecosystem: z.enum(['npm', 'pypi', 'crates']).optional()
      .describe('Dependency ecosystem. Canonical TOML filenames select pypi or crates; other filenames and inline text default to npm. Go filenames and brewfile take precedence.'),
    brewfile: z.boolean().optional()
      .describe('Parse only brew declarations in a Brewfile. Never executes Ruby or follows taps, casks, or workspace references.'),
    response_format: responseFormatSchema,
  })
  .strict();

