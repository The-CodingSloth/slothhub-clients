/**
 * Category slugs retired by the 2026-11 category restructure. Their URLs
 * redirect permanently (Open Source became the source-availability filter,
 * Marketing merged into Productivity), so a Category may not reclaim them and
 * public surfaces skip any document that still carries one.
 */
export const RETIRED_CATEGORY_SLUGS = ['open-source', 'marketing'] as const

export type RetiredCategorySlug = (typeof RETIRED_CATEGORY_SLUGS)[number]

const retiredCategorySlugSet = new Set<string>(RETIRED_CATEGORY_SLUGS)

export const RESERVED_ROOT_SLUGS = [
  ...RETIRED_CATEGORY_SLUGS,
  'all',
  'new',
  'top-pick',
  'search',
  'tags',
  'tag',
  'best',
  'articles',
  'contributors',
  'publishers',
  'collections',
  'stacks',
  'community-stacks',
  'submit',
  'wanted',
  'use-cases',
  'use-case',
  'tool',
  'go',
  'api',
  'faq',
  'find-tools',
  'updates',
  'newsletter',
  'terms',
  'privacy',
  'disclosure',
  'accessibility',
  'security',
  'categories',
  'agents',
  'playbooks',
  'alternatives',
  'shortlist',
  'deals',
  'trending',
  'blog',
  'compare',
  'sponsors',
  'methodology',
  'account',
  'embed',
  'badge',
  'interfaces',
  'kinds',
  'integrations',
  'mcp',
  'og',
  'owner',
  'preview',
  'dev',
  'glossary',
  'about',
  'alerts',
  // shadcn registry for UI components: /r/registry.json and /r/{slug}.json
  'r',
] as const

export type ReservedRootSlug = (typeof RESERVED_ROOT_SLUGS)[number]

const reservedRootSlugSet = new Set<string>(RESERVED_ROOT_SLUGS)

export const toReservedRootSlug = (value: string | null | undefined): string => {
  return (value ?? '').trim().replace(/^\/+|\/+$/g, '').toLowerCase()
}

export const isReservedRootSlug = (value: string | null | undefined): boolean => {
  return reservedRootSlugSet.has(toReservedRootSlug(value))
}

export const isRetiredCategorySlug = (value: string | null | undefined): boolean =>
  retiredCategorySlugSet.has(toReservedRootSlug(value))
