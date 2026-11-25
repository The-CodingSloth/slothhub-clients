/**
 * Parent hubs list every Tool filed under them or under one of their direct
 * subcategories (the hierarchy is one level deep). Browser search, browse
 * pages, the search index and CLI/MCP all expand a selected Category with this
 * rule, so choosing `ai` finds Tools filed under `ai-coding-agents`.
 */
export interface CategoryHierarchyEntry {
  slug: string
  /** Slug of the parent hub; absent for a top-level Category. */
  parent?: string | null
}

export const expandCategoryFilterSlugs = (
  selectedSlug: string,
  categories: readonly CategoryHierarchyEntry[],
): Set<string> => {
  const slugs = new Set([selectedSlug])
  for (const category of categories) {
    if (category.parent && category.parent === selectedSlug && category.slug !== selectedSlug) {
      slugs.add(category.slug)
    }
  }
  return slugs
}
