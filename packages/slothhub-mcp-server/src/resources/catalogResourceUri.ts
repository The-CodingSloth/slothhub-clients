import {isValidToolPublicSlug} from '@slothhub/domain/tool-lookup';
import {UriTemplate} from '@modelcontextprotocol/server';

export const TOOL_RESOURCE_TEMPLATE_URI = 'slothhub://tool/{slug}';
export const STACK_RESOURCE_TEMPLATE_URI = 'slothhub://stack/{slug}';
export const BEST_RESOURCE_TEMPLATE_URI = 'slothhub://best/{slug}';
export const COMPARISON_RESOURCE_TEMPLATE_URI = 'slothhub://compare/{slug}';
export const ALTERNATIVES_RESOURCE_TEMPLATE_URI = 'slothhub://alternatives/{slug}';

export const CATALOG_RESOURCE_TEMPLATE_URIS = [
  TOOL_RESOURCE_TEMPLATE_URI,
  STACK_RESOURCE_TEMPLATE_URI,
  BEST_RESOURCE_TEMPLATE_URI,
  COMPARISON_RESOURCE_TEMPLATE_URI,
  ALTERNATIVES_RESOURCE_TEMPLATE_URI,
] as const;

export const TOOL_RESOURCE_TEMPLATE_NAME = 'slothhub_tool';
export const STACK_RESOURCE_TEMPLATE_NAME = 'slothhub_stack';
export const BEST_RESOURCE_TEMPLATE_NAME = 'slothhub_best';

const CATALOG_RESOURCE_URI_TEMPLATES = {
  tool: new UriTemplate(TOOL_RESOURCE_TEMPLATE_URI),
  stack: new UriTemplate(STACK_RESOURCE_TEMPLATE_URI),
  best: new UriTemplate(BEST_RESOURCE_TEMPLATE_URI),
  compare: new UriTemplate(COMPARISON_RESOURCE_TEMPLATE_URI),
  alternatives: new UriTemplate(ALTERNATIVES_RESOURCE_TEMPLATE_URI),
} as const;

export type CatalogResourceKind = keyof typeof CATALOG_RESOURCE_URI_TEMPLATES;

const HOSTED_RESOURCE_TEMPLATES = Object.values(CATALOG_RESOURCE_URI_TEMPLATES);

/**
 * Catalog resources use the same public slug pattern as Tools
 * (`isValidToolPublicSlug`: lowercase letters, numbers, hyphens, max 160).
 *
 * `UriTemplate.match` can capture `?` / `#` / `@` into the slug string. Those
 * values fail `isValidToolPublicSlug` (36 hostile URIs probed 2026-09-05), so
 * a second syntax guard is not required.
 */
export const isValidCatalogResourceSlug = (value: string): boolean =>
  isValidToolPublicSlug(value);

const readMatchedSlug = (
  match: ReturnType<UriTemplate['match']>,
): string | undefined => {
  if (!match) return undefined;
  const slug = match.slug;
  return typeof slug === 'string' ? slug : undefined;
};

export const isAllowedHostedResourceUri = (
  uri: string,
  staticAllowlist: ReadonlySet<string>,
  templates: readonly UriTemplate[] = HOSTED_RESOURCE_TEMPLATES,
): boolean => {
  if (staticAllowlist.has(uri)) return true;
  return templates.some((template) => {
    const slug = readMatchedSlug(template.match(uri));
    return Boolean(slug && isValidCatalogResourceSlug(slug));
  });
};

export const catalogResourceUri = (
  kind: CatalogResourceKind,
  slug: string,
): string => CATALOG_RESOURCE_URI_TEMPLATES[kind].expand({slug});

export const toIsoLastModified = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return new Date(timestamp).toISOString();
};
