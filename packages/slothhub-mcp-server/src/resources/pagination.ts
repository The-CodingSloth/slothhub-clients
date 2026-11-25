import {createHash} from 'node:crypto';

import {
  type ListResourcesResult,
  type McpServer,
  type Resource,
} from '@modelcontextprotocol/server';
import {z} from 'zod';

import {rejectInvalidCursor, rejectStaleCursor} from './errors.js';

/**
 * Receipt (2026-09-13, SDK `client.listResources()` against the hosted-shaped
 * catalog): worst-case resource entries (~80-char slugs and names, ISO
 * lastModified, template metadata spread) serialize to ~426 bytes each, so a
 * 128 KiB serialized page holds ~300 entries — the 150+150 slice measured
 * 127,787 UTF-8 bytes, 48.7% of the 256 KiB hosted response budget
 * (MAX_HTTP_RESPONSE_BYTES in ../http.ts). The page bound covers the merged
 * inventory (fixed feed/artifact resources plus stack, best-of and comparison
 * entries)
 * rather than applying a per-collection item cap.
 */
export const RESOURCE_LIST_PAGE_BUDGET_BYTES = 128 * 1024;

/**
 * Room reserved inside the page budget for the `{"resources":[]}` envelope, a
 * `nextCursor` field (~130 chars), the SDK cache hint, and the outer JSON-RPC
 * response wrapper so the serialized wire response stays under half of
 * MAX_HTTP_RESPONSE_BYTES.
 */
const RESOURCE_LIST_ENVELOPE_RESERVE_BYTES = 1024;

/**
 * Encoded cursors are ~130 chars; anything larger is rejected before decoding
 * so a hostile cursor cannot spend decode work.
 */
const MAX_RESOURCE_LIST_CURSOR_CHARS = 512;

const RESOURCE_LIST_CURSOR_VERSION = 1;
const CURSOR_CHARSET = /^[A-Za-z0-9_-]+$/;
const SNAPSHOT_HEX_PATTERN = /^[0-9a-f]{64}$/;

const resourceListCursorSchema = z.object({
  v: z.number().int(),
  s: z.string(),
  o: z.number().int().nonnegative(),
});

type ResourceListCursor = z.infer<typeof resourceListCursorSchema>;

/**
 * Loads one dynamic collection's `resources/list` entries in final wire shape
 * (template metadata already merged, mirroring the SDK's high-level aggregate
 * `{...template.metadata, ...resource}`). The catalog Tool template stays
 * search-driven and contributes no source.
 */
export type CatalogResourceListingSource = (
  signal?: AbortSignal,
) => Promise<Resource[]>;

const encodeResourceListCursor = (cursor: ResourceListCursor): string =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

const decodeResourceListCursor = (raw: string): ResourceListCursor => {
  if (raw.length > MAX_RESOURCE_LIST_CURSOR_CHARS) {
    return rejectInvalidCursor('too_long', raw.length);
  }
  if (!CURSOR_CHARSET.test(raw)) {
    return rejectInvalidCursor('malformed');
  }
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return rejectInvalidCursor('malformed');
  }
  let parsed: ReturnType<typeof resourceListCursorSchema.safeParse>;
  try {
    parsed = resourceListCursorSchema.safeParse(JSON.parse(decoded));
  } catch {
    return rejectInvalidCursor('malformed');
  }
  if (!parsed.success) {
    return rejectInvalidCursor('malformed');
  }
  if (parsed.data.v !== RESOURCE_LIST_CURSOR_VERSION) {
    return rejectInvalidCursor('unsupported_version', parsed.data.v);
  }
  if (!SNAPSHOT_HEX_PATTERN.test(parsed.data.s)) {
    return rejectInvalidCursor('malformed');
  }
  return parsed.data;
};

/**
 * Fingerprint of the listed inventory: sha256 over sorted `uri + name` rows.
 * lastModified is deliberately excluded — feeds that lack publishedAt fall back
 * to generatedAt, which rotates on every regeneration and would falsely
 * invalidate mid-pagination cursors. Membership and label changes still
 * invalidate the cursor, which is what an exactly-once iteration needs.
 */
const fingerprintResourceInventory = (entries: readonly Resource[]): string =>
  createHash('sha256')
    .update(
      entries.map((entry) => JSON.stringify([entry.uri, entry.name])).join(''),
    )
    .digest('hex');

const byUri = (a: Resource, b: Resource): number =>
  a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0;

const mergeResourceInventory = (
  fixed: readonly Resource[],
  listed: readonly (readonly Resource[])[],
): Resource[] => {
  const merged = [...fixed, ...listed.flat()];
  merged.sort(byUri);
  return merged.filter(
    (entry, index) => index === 0 || entry.uri !== merged[index - 1].uri,
  );
};

type ResourceListPage = {
  entries: Resource[];
  nextOffset?: number;
  oversized?: {uri: string; bytes: number};
};

/**
 * Accumulate entries while the serialized page stays inside the byte budget.
 * An entry larger than the remaining budget is emitted alone so pagination
 * still makes progress and the catalog stays enumerable exactly once; the
 * violation is bounded to that one entry and reported for repair.
 */
const sliceResourcePage = (
  inventory: readonly Resource[],
  offset: number,
  pageBudgetBytes: number,
): ResourceListPage => {
  let used = RESOURCE_LIST_ENVELOPE_RESERVE_BYTES;
  const entries: Resource[] = [];
  let oversized: {uri: string; bytes: number} | undefined;
  let nextOffset: number | undefined;
  for (let index = offset; index < inventory.length; index += 1) {
    const entry = inventory[index];
    // +1 for the array comma between serialized entries.
    const entryBytes = Buffer.byteLength(JSON.stringify(entry)) + 1;
    if (used + entryBytes > pageBudgetBytes) {
      if (entries.length > 0) {
        nextOffset = index;
        break;
      }
      oversized = {uri: entry.uri, bytes: entryBytes};
    }
    used += entryBytes;
    entries.push(entry);
  }
  return {entries, nextOffset, oversized};
};

export type PaginatedResourcesListOptions = {
  /**
   * Fixed resources registered alongside the listing sources (feed and
   * artifact entries), in the exact shape they should be listed.
   */
  fixed: readonly Resource[];
  sources: readonly CatalogResourceListingSource[];
  /** Serialized byte bound for one resources/list page. */
  pageBudgetBytes?: number;
};

/**
 * Replace the SDK's aggregate `resources/list` handler with a cursor-paginated
 * one. The high-level aggregate concatenates each template's list callback and
 * drops `nextCursor`, so the callback surface cannot express pagination; this
 * uses the documented low-level `server.server.setRequestHandler` instead.
 * Must run after McpServer construction: the constructor installs the default
 * aggregate when `capabilities.resources` is declared, and this handler is the
 * final writer.
 */
export const installPaginatedResourcesList = (
  server: McpServer,
  options: PaginatedResourcesListOptions,
): void => {
  const pageBudgetBytes =
    options.pageBudgetBytes ?? RESOURCE_LIST_PAGE_BUDGET_BYTES;
  if (!Number.isInteger(pageBudgetBytes) || pageBudgetBytes < 1) {
    throw new Error('pageBudgetBytes must be a positive integer');
  }

  server.server.setRequestHandler('resources/list', async (request, ctx) => {
    const cursor =
      request.params?.cursor === undefined
        ? undefined
        : decodeResourceListCursor(request.params.cursor);
    // Sequential like the SDK's aggregate loop: collection loads share the
    // feed client's index/generation state, so preserve its ordering.
    const listed: Resource[][] = [];
    for (const listEntries of options.sources) {
      listed.push(await listEntries(ctx.mcpReq.signal));
    }
    const inventory = mergeResourceInventory(options.fixed, listed);
    const snapshot = fingerprintResourceInventory(inventory);
    if (cursor && cursor.s !== snapshot) {
      return rejectStaleCursor();
    }
    const page = sliceResourcePage(inventory, cursor?.o ?? 0, pageBudgetBytes);
    if (page.oversized) {
      console.error(
        `resource_list_item_over_budget: uri=${page.oversized.uri} ` +
          `observed_bytes=${page.oversized.bytes} limit_bytes=${pageBudgetBytes}`,
      );
    }
    const result: ListResourcesResult = {resources: page.entries};
    if (page.nextOffset !== undefined) {
      result.nextCursor = encodeResourceListCursor({
        v: RESOURCE_LIST_CURSOR_VERSION,
        s: snapshot,
        o: page.nextOffset,
      });
    }
    return result;
  });
};
