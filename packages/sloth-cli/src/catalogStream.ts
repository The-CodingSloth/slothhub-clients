import {Readable, getDefaultHighWaterMark} from 'node:stream';
import split from 'split2';
import {z} from 'zod';
import {AgentSearchPayloadLimitError} from '@slothhub/domain/agent-search';
import {assertSupportedFeedVersion, CATALOG_SNAPSHOT_SUPPORTED_MAJORS, UnsupportedFeedVersionError} from '@slothhub/domain/feed-compatibility';
import {serializeTerminalSafeJson} from '@slothhub/domain/safe-diagnostic';
import {FEED_REQUEST_TIMEOUT_MS, MAX_FEED_RESPONSE_BYTES, FeedClientError, FeedRequestTimeoutError, resolveBaseUrl, type FeedClient} from './feedClient.js';
import {catalogMetadataSchema, catalogRowSchema, validateCatalogRow, type CatalogMetadata, type CatalogRow} from '@slothhub/domain/public-feed-catalog';
import {failForOutput, ok} from './cliOutput.js';
import type {AdvertisedFeedFetch} from './advertisedFeeds.js';
import type {CliResult} from './types.js';

export type CliOutputWriter = (chunk: string) => Promise<void>;

class CatalogStreamError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

const oversized = (observedBytes: number): CatalogStreamError => new CatalogStreamError(
  'feed_too_large',
  `configured_limit_bytes=${MAX_FEED_RESPONSE_BYTES} observed_bytes=${observedBytes}. Use individual feeds or ask the catalog maintainer to remeasure the export budget.`,
);

// The configured origin is validated by createFeedClient. Never let an index
// redirect this read-only export to another host, credentials, or a tracked URL.
export const requireCatalogUrl = (advertised: string, siteUrl: string, path: string): void => {
  resolveBaseUrl(siteUrl);
  if (advertised !== `${siteUrl.replace(/\/+$/u, '')}${path}`) {
    throw new CatalogStreamError('schema_invalid', 'The index must advertise the canonical catalog artifact. Refresh the index and retry.');
  }
};

interface CatalogStreamOptions {
  client: FeedClient;
  baseUrl: string;
  write: CliOutputWriter;
  fetchResponse?: AdvertisedFeedFetch;
}

export const streamCatalog = async (options: CatalogStreamOptions): Promise<CliResult> => {
  let outputStarted = false;
  let response: Response | undefined;
  let lines: Readable | undefined;
  const controller = new AbortController();
  const deadline = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {once: true});
  });
  // Index failures can precede the first race; keep abort rejection handled.
  void deadline.catch(() => {});
  const timeout = setTimeout(() => controller.abort(new CatalogStreamError(
    'feed_timeout',
    `configured_limit_ms=${FEED_REQUEST_TIMEOUT_MS} observed_ms=${FEED_REQUEST_TIMEOUT_MS}. Retry when the feed and output consumer are responsive.`,
  )), FEED_REQUEST_TIMEOUT_MS);

  try {
    const index = await Promise.race([options.client.index(), deadline]);
    requireCatalogUrl(index.snapshots.ndjson, index.siteUrl, '/api/catalog.ndjson');
    const request = (options.fetchResponse ?? fetch)(`${options.baseUrl}/api/catalog.ndjson`, {
      signal: controller.signal,
      redirect: 'manual',
      headers: {accept: 'application/x-ndjson', 'user-agent': '@slothhub/cli'},
    }).then((value) => {
      if (controller.signal.aborted) void value.body?.cancel().catch(() => {});
      return value;
    });
    response = await Promise.race([request, deadline]);
    if (!response.ok) throw new CatalogStreamError('transport', `HTTP ${response.status}. Verify the feed availability and retry.`);
    const declared = Number(response.headers.get('content-length'));
    if (declared > MAX_FEED_RESPONSE_BYTES) throw oversized(declared);
    if (!response.body) throw new CatalogStreamError('schema_invalid', 'The catalog body is missing. Refresh the catalog and retry.');
    const reader = response.body.getReader();
    let bytes = 0;
    async function* chunks(): AsyncGenerator<string> {
      const decoder = new TextDecoder('utf-8', {fatal: true});
      try {
        while (true) {
          const {done, value} = await Promise.race([reader.read(), deadline]);
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_FEED_RESPONSE_BYTES) throw oversized(bytes);
          // Use Node's byte-stream buffer size; split2 then retains only a
          // bounded chunk of completed lines plus the current partial line.
          const chunkSize = getDefaultHighWaterMark(false);
          for (let offset = 0; offset < value.byteLength; offset += chunkSize) {
            yield decoder.decode(value.subarray(offset, offset + chunkSize), {stream: true});
          }
        }
        const tail = decoder.decode();
        if (tail) yield tail;
        if (!response?.headers.has('content-encoding') && declared > 0 && bytes !== declared) {
          throw new CatalogStreamError('incomplete_catalog', 'The catalog byte count differs from Content-Length. Discard the export and retry.');
        }
      } finally {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
    lines = Readable.from(chunks(), {objectMode: false}).compose(
      split({maxLength: MAX_FEED_RESPONSE_BYTES, highWaterMark: 1}),
      {signal: controller.signal},
    );
    const writeRecord = async (record: CatalogMetadata | CatalogRow): Promise<void> => {
      const bytes = Buffer.from(`${serializeTerminalSafeJson(record, 0)}\n`);
      const decoder = new TextDecoder('utf-8', {fatal: true});
      const chunkSize = getDefaultHighWaterMark(false);
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        controller.signal.throwIfAborted();
        const chunk = decoder.decode(bytes.subarray(offset, offset + chunkSize), {stream: offset + chunkSize < bytes.length});
        outputStarted = true;
        await Promise.race([options.write(chunk), deadline]);
      }
    };
    let metadata: CatalogMetadata | undefined;
    for await (const rawLine of lines) {
      controller.signal.throwIfAborted();
      const line = z.string().parse(rawLine);
      if (!line.trim()) throw new CatalogStreamError('schema_invalid', 'The catalog contains an empty record. Refresh the catalog and retry.');
      if (!metadata) {
        const version = z.object({version: z.string()}).parse(JSON.parse(line));
        assertSupportedFeedVersion(version, CATALOG_SNAPSHOT_SUPPORTED_MAJORS);
        metadata = catalogMetadataSchema.parse(JSON.parse(line));
        if (metadata.siteUrl !== index.siteUrl || (index.catalogRevision && metadata.catalogRevision !== index.catalogRevision)) {
          throw new CatalogStreamError('revision_mismatch', 'The catalog metadata differs from the index. Refresh the catalog and retry.');
        }
        requireCatalogUrl(metadata.ndjsonUrl, index.siteUrl, '/api/catalog.ndjson');
        requireCatalogUrl(metadata.snapshotUrl, index.siteUrl, '/api/catalog.snapshot.json');
        requireCatalogUrl(metadata.schemaUrl, index.siteUrl, '/api/schema.json');
        await writeRecord(metadata);
      } else {
        const row = catalogRowSchema.parse(JSON.parse(line));
        validateCatalogRow(row, metadata);
        await writeRecord(row);
      }
    }
    if (!metadata) throw new CatalogStreamError('schema_invalid', 'The catalog metadata is missing. Refresh the catalog and retry.');
    return ok('');
  } catch (error) {
    const cause = controller.signal.aborted ? controller.signal.reason : error;
    const failure = cause instanceof AgentSearchPayloadLimitError ? oversized(cause.observedBytes) : cause;
    const code = failure instanceof CatalogStreamError ? failure.code
      : failure instanceof UnsupportedFeedVersionError || failure instanceof FeedClientError ? failure.code
        : failure instanceof FeedRequestTimeoutError ? 'feed_timeout'
        : failure instanceof z.ZodError || failure instanceof SyntaxError ? 'schema_invalid' : 'catalog_export_failed';
    // Untrusted network/writer errors can contain credentials or private paths.
    const message = failure instanceof CatalogStreamError || failure instanceof UnsupportedFeedVersionError || failure instanceof FeedRequestTimeoutError
      ? failure.message : 'Unable to finish the catalog export. Check the feed and output destination, then retry.';
    const recovery = failure instanceof UnsupportedFeedVersionError ? ' Upgrade the CLI or select a compatible catalog with --base-url, then retry.' : '';
    const warning = outputStarted ? ' Previously emitted NDJSON is incomplete; discard all output and retry.' : '';
    return failForOutput(false, {code, message}, `${code}: ${message}${recovery}${warning}\n`);
  } finally {
    clearTimeout(timeout);
    lines?.destroy();
    controller.abort();
    if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
  }
};
