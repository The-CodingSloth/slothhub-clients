import {z} from 'zod'
import {COMPARISON_REVIEW_MAX_AGE_DAYS} from './comparisonPublication.js'
import {groqHasTrimmedText} from './groqText.js'
import {RESOURCE_KIND_VALUES} from './resourceKind.js'
import {sha256Hex} from './sha256.js'

export const ALTERNATIVES_PEER_MAX_MATCHES = 25
export const ALTERNATIVES_BROAD_CATEGORIES = ['dev-tools', 'open-source', 'ai'] as const
export const alternativesPeerQuerySchema = z.object({
  _type: z.string().optional(),
  resourceKind: z.enum(RESOURCE_KIND_VALUES),
  category: z.string().trim().min(1).refine((value) => !ALTERNATIVES_BROAD_CATEGORIES.some((broad) => broad === value), 'Choose a category narrower than dev-tools, open-source or ai.').optional(),
  tags: z.array(z.string().trim().min(1)).max(3).optional(),
}).strict().refine((query) => Boolean(query.category || query.tags?.length), 'Choose a narrow category or at least one tag.')
export type AlternativesPeerQuery = z.infer<typeof alternativesPeerQuerySchema>
export const alternativesPeerSetHashSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const peerSnapshotSchema = z.object({
  query: alternativesPeerQuerySchema,
  peerIds: z.array(z.string().min(1)),
  hash: alternativesPeerSetHashSchema,
})

export const toolAlternativesReviewSchema = z.object({
  reason: z.string().trim().min(1),
  reviewedAt: z.iso.datetime({offset: true}),
  peerIds: z.array(z.string().min(1)),
  peerQuery: alternativesPeerQuerySchema.optional(),
  peerSetHash: alternativesPeerSetHashSchema.optional(),
  peerSnapshot: peerSnapshotSchema.optional(),
})

export interface ToolAlternativesReview {
  reason?: string
  reviewedAt?: string
  peerIds?: string[]
  peerQuery?: AlternativesPeerQuery
  peerSetHash?: string
  peerSnapshot?: z.infer<typeof peerSnapshotSchema>
}

export const toolAlternativePeerSchema = z.object({
  _id: z.string(),
  _createdAt: z.string().nullish(),
  name: z.string().nullish(),
  resourceKind: z.string().nullish(),
  categories: z.array(z.string()).nullish(),
  tags: z.array(z.string()).nullish(),
  alternativeTools: z.array(z.string()).nullish(),
  relatedTools: z.array(z.string()).nullish(),
  catalogNotes: z.array(z.string().nullable()).nullish(),
  alternativesReviewedNone: z.json().nullish(),
})
export type ToolAlternativePeer = z.infer<typeof toolAlternativePeerSchema>
export const alternativesReviewFindingSchema = z.object({
  id: z.string(), toolId: z.string(), peerId: z.string().optional(), severity: z.literal('warning'),
  explanation: z.string(), nextAction: z.string(),
  target: z.object({fieldPath: z.string(), group: z.literal('decisionGuidance')}),
})
export type AlternativesReviewFinding = z.infer<typeof alternativesReviewFindingSchema>
const canonicalPeerId = (id: string) => id.replace(/^drafts\./, '')
const peerSetHash = (ids: readonly string[], query: AlternativesPeerQuery) => sha256Hex(JSON.stringify({
  query: {resourceKind: query.resourceKind, category: query.category ?? null, tags: [...new Set(query.tags ?? [])].sort()},
  peerIds: [...new Set(ids)].sort(),
}))
const peerQueryMatchesTool = (tool: ToolAlternativePeer, query: AlternativesPeerQuery) =>
  query.resourceKind === (tool.resourceKind ?? 'app') && (!query.category || tool.categories?.includes(query.category)) &&
  (query.tags ?? []).every((tag) => tool.tags?.includes(tag))
export const selectAlternativesPeers = (toolId: string, query: AlternativesPeerQuery, catalog: readonly ToolAlternativePeer[]): ToolAlternativePeer[] =>
  catalog.filter((peer) => canonicalPeerId(peer._id) !== canonicalPeerId(toolId) &&
    (peer.resourceKind ?? 'app') === query.resourceKind &&
    (!query.category || peer.categories?.includes(query.category)) &&
    (query.tags ?? []).every((tag) => peer.tags?.includes(tag)))

export class AlternativesPeerQueryError extends Error {
  readonly code = 'peer_query_too_broad'
  readonly limit = ALTERNATIVES_PEER_MAX_MATCHES
  constructor(readonly actual: number) {
    super(`peer_query_too_broad: limit_matches=${ALTERNATIVES_PEER_MAX_MATCHES}, actual_matches=${actual}. Add a narrower category or tag, then record the review again.`)
  }
}
export function recordAlternativesReview(tool: ToolAlternativePeer, input: AlternativesPeerQuery, reason: string, catalog: readonly ToolAlternativePeer[], now = new Date()) {
  const peerQuery = alternativesPeerQuerySchema.refine((query) => peerQueryMatchesTool(tool, query),
  'peer_query_mismatch: choose the Tool\'s resource kind and its own category or tags. Save taxonomy edits before recording the review.').parse(input)
  const peers = selectAlternativesPeers(tool._id, peerQuery, catalog)
  if (peers.length > ALTERNATIVES_PEER_MAX_MATCHES) throw new AlternativesPeerQueryError(peers.length)
  const peerIds = [...new Set(peers.map((peer) => canonicalPeerId(peer._id)))].sort()
  const hash = peerSetHash(peerIds, peerQuery)
  return toolAlternativesReviewSchema.parse({reason, reviewedAt: now.toISOString(), peerQuery, peerIds, peerSetHash: hash, peerSnapshot: {query: peerQuery, peerIds, hash}})
}

const peerFinding = (toolId: string, id: string, explanation: string, nextAction: string): AlternativesReviewFinding => ({
  id, toolId: canonicalPeerId(toolId), severity: 'warning', explanation, nextAction,
  target: {fieldPath: 'alternativesReviewedNone', group: 'decisionGuidance'},
})
export const unavailableAlternativesFinding = (toolId: string): AlternativesReviewFinding => ({
  ...peerFinding(toolId, 'alternatives-context-unavailable',
    'Alternatives context could not be read or validated. Existing draft repair findings are preserved.',
    'Correct the reported draft fields, then retry alternatives review. If the draft is valid, check the peer catalog and service connection.'),
  target: {fieldPath: 'alternativeTools', group: 'decisionGuidance'},
})
export function evaluateAlternativesReview(tool: ToolAlternativePeer, catalog: readonly ToolAlternativePeer[], now = new Date()): AlternativesReviewFinding[] {
  if (!tool.alternativesReviewedNone) return []
  const review = toolAlternativesReviewSchema.safeParse(tool.alternativesReviewedNone)
  if (!review.success || !review.data.peerQuery) return [peerFinding(tool._id, 'peer_query_missing', 'This review has no valid scoped peer query.', 'Keep the legacy review, then choose a narrow category or tag and record it again.')]
  if (!peerQueryMatchesTool(tool, review.data.peerQuery)) return [peerFinding(tool._id, 'peer_query_mismatch', 'The recorded query no longer describes this Tool’s resource kind or taxonomy.', 'Choose this Tool’s current kind, category or tags and record the review again.')]
  const peers = selectAlternativesPeers(tool._id, review.data.peerQuery, catalog)
  if (peers.length > ALTERNATIVES_PEER_MAX_MATCHES) return [peerFinding(tool._id, 'peer_query_too_broad', new AlternativesPeerQueryError(peers.length).message, 'Add a narrower category or tag; no peers are silently truncated.')]
  const snapshot = review.data.peerSnapshot
  if (!snapshot || review.data.peerSetHash !== peerSetHash(review.data.peerIds, review.data.peerQuery) ||
    snapshot.hash !== review.data.peerSetHash || snapshot.query.resourceKind !== review.data.peerQuery.resourceKind ||
    (snapshot.query.category ?? '') !== (review.data.peerQuery.category ?? '') ||
    JSON.stringify(snapshot.query.tags ?? []) !== JSON.stringify(review.data.peerQuery.tags ?? []) ||
    JSON.stringify(snapshot.peerIds) !== JSON.stringify(review.data.peerIds)) return [peerFinding(tool._id, 'peer_snapshot_invalid', 'The peer snapshot hash is missing or does not match the recorded query and peers.', 'Record the review again through the shared review endpoint.')]
  const newer = peers.filter((peer) => !review.data.peerIds.includes(canonicalPeerId(peer._id)) &&
    (!peer._createdAt || Date.parse(peer._createdAt) > Date.parse(review.data.reviewedAt)))
  if (newer.length) return [peerFinding(tool._id, 'peer_query_changed', `New matching peers: ${newer.map((peer) => peer.name ?? peer._id).join(', ')}.`, 'Review these matching Tools and record the review again.')]
  if (!hasCurrentAlternativesReview(review.data, [], now)) return [peerFinding(tool._id, 'peer_review_expired', 'The editorial review window has expired or its timestamp is in the future.', 'Review the matching Tools and record the review again.')]
  return []
}

export const TOOL_ALTERNATIVE_PEER_PROJECTION = `{
  _id, _createdAt, name, resourceKind,
  "categories": coalesce(categories[]->slug.current, []),
  "tags": coalesce(tags[]->slug.current, []),
  "alternativeTools": coalesce(alternativeTools[]._ref, []),
  "relatedTools": coalesce(relatedTools[]._ref, []),
  "catalogNotes": [description, alternativesReviewedNone.reason] + coalesce(sourceReferences[].note, []),
  alternativesReviewedNone
}`
export const TOOL_ALTERNATIVE_CATALOG_QUERY = `*[_type == "tool" && !(_id in path("drafts.**")) && !(_id in path("versions.**")) && defined(slug.current) && seo.noIndex != true && !defined(successorTool)] ${TOOL_ALTERNATIVE_PEER_PROJECTION}`

/** Advisory only: a reference is a reason to review a pair, never proof of equivalence. */
export function findAlternativeSuggestions(tools: readonly ToolAlternativePeer[], catalog: readonly ToolAlternativePeer[], now = new Date()): AlternativesReviewFinding[] {
  const byId = new Map(catalog.map((tool) => [canonicalPeerId(tool._id), tool]))
  for (const tool of tools) byId.set(canonicalPeerId(tool._id), tool)
  const focus = new Set(tools.map((tool) => canonicalPeerId(tool._id)))
  const findings: AlternativesReviewFinding[] = []
  const seen = new Set<string>()
  const linked = (tool: ToolAlternativePeer, id: string) => (tool.alternativeTools ?? []).some((ref) => canonicalPeerId(ref) === id)
  const sharedCategories = (a: ToolAlternativePeer, b: ToolAlternativePeer) => (a.categories ?? []).filter((category) => b.categories?.includes(category))
  const describe = (tool: ToolAlternativePeer) => `${tool.name ?? canonicalPeerId(tool._id)} (${tool.resourceKind ?? 'app'}; categories: ${(tool.categories ?? []).join(', ') || 'none'})`
  for (const [sourceId, source] of byId) {
    for (const reference of source.alternativeTools ?? []) {
      const targetId = canonicalPeerId(reference)
      const target = byId.get(targetId)
      if (!target || sourceId === targetId || (!focus.has(sourceId) && !focus.has(targetId))) continue
      const sourceName = source.name
      if (!source._id.startsWith('drafts.') && sourceName && (target.catalogNotes ?? []).some((note) =>
        note?.toLowerCase().includes(sourceName.toLowerCase()) && /(?:not|isn't|isn’t|is not)[^.\n]*catalog/i.test(note))) {
        findings.push({...peerFinding(targetId, 'alternative-catalog-claim-stale', `A catalog-absence claim mentions ${sourceName}, which is now published.`, 'Review the Tool’s prose and private notes; update only the claim supported by current catalog evidence.'), peerId: sourceId})
      }
      if (linked(target, sourceId)) continue
      const pair = [sourceId, targetId].sort().join('\n')
      if (seen.has(pair)) continue
      seen.add(pair)
      const relevant = sharedCategories(source, target).length > 0
      const contradicted = toolAlternativesReviewSchema.safeParse(target.alternativesReviewedNone)
      const coversSource = contradicted.success && hasCurrentAlternativesReview(contradicted.data, [sourceId], now)
      findings.push({
        ...peerFinding(targetId, !relevant ? 'alternative-relevance-review' : coversSource ? 'alternatives-review-contradicted' : 'alternative-not-reciprocal',
          `${describe(source)} lists ${describe(target)} as an alternative, but the reverse link is absent.${coversSource ? ' This conflicts with the recorded no-alternatives review.' : ''}`,
          relevant ? 'Review whether these Tools replace each other; consider adding the reverse alternative, remove the original link, or mark them as companions. Check any prose saying the newly listed Tool is absent.' : 'Review relevance before adding a reverse link. These Tools share no category; remove an unrelated alternative or mark a useful companion instead.'),
        peerId: sourceId, target: {fieldPath: 'alternativeTools', group: 'decisionGuidance'},
      })

    }
  }
  for (let index = 0; index < tools.length; index++) {
    const source = tools[index]!
    for (const target of tools.slice(index + 1)) {
      const sourceId = canonicalPeerId(source._id)
      const targetId = canonicalPeerId(target._id)
      if (sourceId === targetId || source.resourceKind !== target.resourceKind || !sharedCategories(source, target).length ||
        linked(source, targetId) || linked(target, sourceId) ||
        source.relatedTools?.includes(targetId) || target.relatedTools?.includes(sourceId)) continue
      findings.push({...peerFinding(sourceId, 'batch-alternative-review', `${describe(source)} and ${describe(target)} share a kind and category but have no alternative link.`, 'Review whether they replace each other; shared taxonomy alone does not establish an alternative.'), peerId: targetId, target: {fieldPath: 'alternativeTools', group: 'decisionGuidance'}})
    }
  }
  return findings
}

export const hasCurrentAlternativesReview = (
  review: ToolAlternativesReview | undefined,
  peerIds: readonly string[],
  now = new Date(),
): boolean => {
  const parsed = toolAlternativesReviewSchema.safeParse(review)
  if (!parsed.success) return false
  const age = now.getTime() - Date.parse(parsed.data.reviewedAt)
  const snapshot = parsed.data.peerSnapshot
  if (parsed.data.peerQuery && (!snapshot || parsed.data.peerSetHash !== peerSetHash(parsed.data.peerIds, parsed.data.peerQuery) ||
    snapshot.hash !== parsed.data.peerSetHash || snapshot.query.resourceKind !== parsed.data.peerQuery.resourceKind ||
    (snapshot.query.category ?? '') !== (parsed.data.peerQuery.category ?? '') ||
    JSON.stringify(snapshot.query.tags ?? []) !== JSON.stringify(parsed.data.peerQuery.tags ?? []) ||
    JSON.stringify(snapshot.peerIds) !== JSON.stringify(parsed.data.peerIds))) return false
  return age >= 0 && age < COMPARISON_REVIEW_MAX_AGE_DAYS * 86_400_000 &&
    peerIds.every((id) => parsed.data.peerIds.includes(id))
}

/** Preserve the existing launch/completeness coverage policy across intake and Studio. */
export const hasAlternativesCoverage = (
  publicAlternativeCount: number,
  review: ToolAlternativesReview | undefined,
  peerIds: readonly string[] | undefined,
  now = new Date(),
): boolean => publicAlternativeCount >= 2 ||
  (peerIds !== undefined && hasCurrentAlternativesReview(review, peerIds, now))

// Snapshot public same-kind OR same-category peers. This detects newly public
// old drafts too, without treating ordinary edits to existing peers as new peers.
export const TOOL_ALTERNATIVES_PEERS_QUERY = `*[
  _type == "tool" && _id != $toolId && !(_id in path("drafts.**"))
  && !(_id in path("versions.**")) && defined(slug.current) && seo.noIndex != true
  && !defined(successorTool)
  && (coalesce(resourceKind, "app") == $resourceKind || array::intersects(coalesce(categories[]._ref, []), $categoryIds))
]._id`

export const SCOPED_ALTERNATIVES_PEER_FILTER = `
    _type == "tool" && _id != ^._id && "drafts." + _id != ^._id && !(_id in path("drafts.**")) && !(_id in path("versions.**"))
    && defined(slug.current) && seo.noIndex != true && !defined(successorTool)
    && coalesce(resourceKind, "app") == ^.alternativesReviewedNone.peerQuery.resourceKind
    && (!defined(^.alternativesReviewedNone.peerQuery.category) || ^.alternativesReviewedNone.peerQuery.category in categories[]->slug.current)
    && (!defined(^.alternativesReviewedNone.peerQuery.tags[0]) || ^.alternativesReviewedNone.peerQuery.tags[0] in tags[]->slug.current)
    && (!defined(^.alternativesReviewedNone.peerQuery.tags[1]) || ^.alternativesReviewedNone.peerQuery.tags[1] in tags[]->slug.current)
    && (!defined(^.alternativesReviewedNone.peerQuery.tags[2]) || ^.alternativesReviewedNone.peerQuery.tags[2] in tags[]->slug.current)
`
export const CURRENT_ALTERNATIVES_REVIEW_FILTER = `(
  ${groqHasTrimmedText('alternativesReviewedNone.reason')}
  && defined(alternativesReviewedNone.peerIds)
  && dateTime(alternativesReviewedNone.reviewedAt) <= dateTime(now())
  && dateTime(alternativesReviewedNone.reviewedAt) > dateTime(now()) - ${COMPARISON_REVIEW_MAX_AGE_DAYS * 86_400}
  && (
    (defined(alternativesReviewedNone.peerQuery) && defined(alternativesReviewedNone.peerSetHash)
      && alternativesReviewedNone.peerSetHash == alternativesReviewedNone.peerSnapshot.hash
      && alternativesReviewedNone.peerQuery.resourceKind == alternativesReviewedNone.peerSnapshot.query.resourceKind
      && coalesce(alternativesReviewedNone.peerQuery.category, "") == coalesce(alternativesReviewedNone.peerSnapshot.query.category, "")
      && array::join(coalesce(alternativesReviewedNone.peerQuery.tags, []), "\\n") == array::join(coalesce(alternativesReviewedNone.peerSnapshot.query.tags, []), "\\n")
      && array::join(alternativesReviewedNone.peerIds, "\\n") == array::join(alternativesReviewedNone.peerSnapshot.peerIds, "\\n")
      && defined(alternativesReviewedNone.peerQuery.resourceKind)
      && alternativesReviewedNone.peerQuery.resourceKind == coalesce(resourceKind, "app")
      && (!defined(alternativesReviewedNone.peerQuery.category) || alternativesReviewedNone.peerQuery.category in categories[]->slug.current)
      && (!defined(alternativesReviewedNone.peerQuery.tags[0]) || alternativesReviewedNone.peerQuery.tags[0] in tags[]->slug.current)
      && (!defined(alternativesReviewedNone.peerQuery.tags[1]) || alternativesReviewedNone.peerQuery.tags[1] in tags[]->slug.current)
      && (!defined(alternativesReviewedNone.peerQuery.tags[2]) || alternativesReviewedNone.peerQuery.tags[2] in tags[]->slug.current)
      && (defined(alternativesReviewedNone.peerQuery.category) || count(alternativesReviewedNone.peerQuery.tags) > 0)
      && !(alternativesReviewedNone.peerQuery.category in ["dev-tools", "open-source", "ai"])
      && count(coalesce(alternativesReviewedNone.peerQuery.tags, [])) <= 3
      && count(*[${SCOPED_ALTERNATIVES_PEER_FILTER}]) <= ${ALTERNATIVES_PEER_MAX_MATCHES}
      && count(*[${SCOPED_ALTERNATIVES_PEER_FILTER}
        && !(_id in ^.alternativesReviewedNone.peerIds)
        && (!defined(_createdAt) || dateTime(_createdAt) > dateTime(^.alternativesReviewedNone.reviewedAt))
      ]) == 0
    ) || (!defined(alternativesReviewedNone.peerQuery) && count(*[
    _type == "tool" && _id != ^._id && "drafts." + _id != ^._id && !(_id in path("drafts.**")) && !(_id in path("versions.**"))
    && defined(slug.current) && seo.noIndex != true && !defined(successorTool)
    && (coalesce(resourceKind, "app") == coalesce(^.resourceKind, "app") || array::intersects(coalesce(categories[]._ref, []), coalesce(^.categories[]._ref, [])))
    && !(_id in ^.alternativesReviewedNone.peerIds)
  ]) == 0)
  )
)`
