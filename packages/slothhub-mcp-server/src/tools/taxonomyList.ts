import {isRuntimeNumber} from '@slothhub/domain/runtime-validation'

import {ResponseFormat} from '../constants.js'
import {matchesQueryText, paginateResults} from '../services/search.js'
import type {AgentTagFeedItem, AgentUseCaseFeedItem} from '../types.js'
import {formatToolResult, type ToolContentResult} from './format.js'
import {escapeMarkdownText, toMarkdownInlineCode} from './markdownText.js'

export interface TaxonomyListInput {
  query?: string
  limit: number
  offset: number
  response_format: ResponseFormat
}

export interface TaxonomyListItem {
  name: string
  slug: string
  url: string
  description?: string
  toolCount?: number
}

export const toTaxonomyListItem = (
  item: AgentTagFeedItem | AgentUseCaseFeedItem,
): TaxonomyListItem => ({
  name: item.name,
  slug: item.slug,
  url: item.url,
  ...(item.description ? {description: item.description} : undefined),
  ...(isRuntimeNumber(item.toolCount) ? {toolCount: item.toolCount} : undefined),
})

export const formatTaxonomyListResult = <Collection extends object>(
  params: TaxonomyListInput,
  items: TaxonomyListItem[],
  options: {
    heading: string
    noun: string
    collection: (pageItems: TaxonomyListItem[]) => Collection
  },
): ToolContentResult => {
  const matched = items.filter((item) =>
    matchesQueryText(params.query, [item.name, item.slug, item.description]))
  const page = paginateResults(matched, params.limit, params.offset)
  const structured = {
    query: params.query ?? '',
    total: page.total,
    count: page.count,
    offset: page.offset,
    has_more: page.has_more,
    ...(page.next_offset !== undefined ? {next_offset: page.next_offset} : undefined),
    ...options.collection(page.items),
  }

  const lines = [
    `# ${options.heading}`,
    '',
    `Found ${page.total} ${options.noun} (showing ${page.count}).`,
    '',
    ...page.items.flatMap((item) => [
      `## ${escapeMarkdownText(item.name)} (${toMarkdownInlineCode(item.slug)})`,
      ...(item.description ? [escapeMarkdownText(item.description)] : []),
      ...(isRuntimeNumber(item.toolCount) ? [`- Tools: ${item.toolCount}`] : []),
      `- Cite: ${item.url}`,
      '',
    ]),
  ]

  if (page.has_more) {
    lines.push(`More results available. Use offset=${page.next_offset}.`)
  }

  return formatToolResult(params.response_format, lines.join('\n'), structured)
}
