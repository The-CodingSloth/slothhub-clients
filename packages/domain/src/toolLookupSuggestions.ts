import {
  TOOL_LOOKUP_MAX_INPUT_LENGTH,
  type ToolLookupArtifactTool,
  type ToolLookupCandidate,
} from './toolLookup.js'

export const TOOL_SUGGESTION_DEFAULT_LIMIT = 3
export const TOOL_SUGGESTION_MIN_SEGMENT_LENGTH = 3
export const TOOL_SUGGESTION_MAX_DISTANCE = 3

export const normalizeToolSuggestionText = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, '')

const suggestionDistanceLimit = (normalizedLength: number): number =>
  Math.min(
    TOOL_SUGGESTION_MAX_DISTANCE,
    Math.max(1, Math.round(normalizedLength / 4)),
  )

const codePoints = (value: string): readonly string[] => Array.from(value)

const editDistanceWithinLimit = (
  left: readonly string[],
  right: readonly string[],
  limit: number,
): number | null => {
  if (Math.abs(left.length - right.length) > limit) {
    return null
  }
  if (left.length === 0) {
    return right.length <= limit ? right.length : null
  }
  if (right.length === 0) {
    return left.length <= limit ? left.length : null
  }

  // Cells outside a row's band are unreachable within the limit; the
  // limit + 1 sentinel each row writes past its band is that distance.
  const cell = (row: readonly number[], column: number): number =>
    row[column] ?? limit + 1

  let beforePrevious: number[] = Array.from({length: right.length + 1}, () => limit + 1)
  let previous: number[] = Array.from({length: right.length + 1}, (_, column) => column)
  let current: number[] = Array.from({length: right.length + 1}, () => 0)

  for (let row = 1; row <= left.length; row += 1) {
    const columnStart = Math.max(1, row - limit)
    const columnEnd = Math.min(right.length, row + limit)
    current[columnStart - 1] = row
    let rowMinimum = cell(current, columnStart - 1)

    for (let column = columnStart; column <= columnEnd; column += 1) {
      const substitution = cell(previous, column - 1) + (left[row - 1] === right[column - 1] ? 0 : 1)
      const deletion = cell(previous, column) + 1
      const insertion = cell(current, column - 1) + 1
      const transposition =
        row > 1 &&
        column > 1 &&
        left[row - 1] === right[column - 2] &&
        left[row - 2] === right[column - 1]
          ? cell(beforePrevious, column - 2) + 1
          : Number.MAX_SAFE_INTEGER
      const distance = Math.min(substitution, deletion, insertion, transposition)
      current[column] = distance
      rowMinimum = Math.min(rowMinimum, distance)
    }

    for (let column = columnEnd + 1; column <= right.length; column += 1) {
      current[column] = limit + 1
    }
    if (rowMinimum > limit) {
      return null
    }
    ;[beforePrevious, previous, current] = [previous, current, beforePrevious]
  }

  const distance = cell(previous, right.length)
  return distance <= limit ? distance : null
}

/**
 * Rank public Tool names and slugs against a URL path segment so a mistyped or
 * renamed Tool URL can offer the listing the visitor meant. Only `tools` entries
 * are read; identity claims and alias provenance stay out of fuzzy matching.
 *
 * Segments longer than `TOOL_LOOKUP_MAX_INPUT_LENGTH` return no candidates
 * before any normalization or scoring work: a path segment that long cannot be
 * a near miss for a catalog name, and bounding it keeps a junk URL from
 * scanning the whole catalog on the 404 page.
 */
export const suggestToolLookupCandidates = (
  tools: readonly ToolLookupArtifactTool[],
  segment: string,
  options: {limit?: number} = {},
): ToolLookupCandidate[] => {
  if (segment.length > TOOL_LOOKUP_MAX_INPUT_LENGTH) {
    return []
  }
  const candidate = codePoints(normalizeToolSuggestionText(segment))
  if (candidate.length < TOOL_SUGGESTION_MIN_SEGMENT_LENGTH) {
    return []
  }
  const limit = options.limit ?? TOOL_SUGGESTION_DEFAULT_LIMIT
  if (limit <= 0) {
    return []
  }
  const maxDistance = suggestionDistanceLimit(candidate.length)

  return tools
    .map((tool) => {
      const nameDistance = editDistanceWithinLimit(
        candidate,
        codePoints(normalizeToolSuggestionText(tool.name)),
        maxDistance,
      )
      const slugDistance = editDistanceWithinLimit(
        candidate,
        codePoints(normalizeToolSuggestionText(tool.slug)),
        maxDistance,
      )
      const distance = Math.min(
        nameDistance ?? Number.MAX_SAFE_INTEGER,
        slugDistance ?? Number.MAX_SAFE_INTEGER,
      )
      return {tool, distance}
    })
    .filter((entry) => entry.distance <= maxDistance)
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        left.tool.name.localeCompare(right.tool.name, 'en-US') ||
        left.tool.slug.localeCompare(right.tool.slug),
    )
    .slice(0, limit)
    .map(({tool}) => ({slug: tool.slug, name: tool.name, detailUrl: tool.detailUrl}))
}

/**
 * The closest candidate within a small edit distance, for "did you mean" on mistyped command or
 * option names. Ties keep candidate order; nothing within the limit returns undefined.
 */
export const findClosestName = (input: string, candidates: readonly string[], limit = 2): string | undefined => {
  let best: {name: string; distance: number} | undefined
  for (const name of candidates) {
    const distance = editDistanceWithinLimit(codePoints(input.toLowerCase()), codePoints(name.toLowerCase()), limit)
    if (distance !== null && (!best || distance < best.distance)) best = {name, distance}
  }
  return best?.name
}
