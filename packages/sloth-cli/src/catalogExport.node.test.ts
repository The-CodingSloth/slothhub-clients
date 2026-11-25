import {streamCatalog} from './catalogStream.js';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {getDefaultHighWaterMark} from 'node:stream';
import type {AgentFeedPayload} from './types.js';
import {afterEach, describe, expect, it, vi} from 'vite-plus/test';
import {runCli, type RunCliDependencies} from './cli.js';
import {createFeedClient, defaultFetchJson, FEED_REQUEST_TIMEOUT_MS, MAX_FEED_RESPONSE_BYTES, type FetchJson} from './feedClient.js';
import {computeContentHash} from '@slothhub/domain/public-feed-content-identity';
import {indexFeed} from './fixtures.js';
import {catalogExportFeed, catalogMetadata, catalogNdjson, catalogRows,} from './catalogExportFixtures.js';
import {catalogMetadataSchema, catalogRowSchema, parseCatalogSnapshot,} from '@slothhub/domain/public-feed-catalog';

const feeds = new Map<string, AgentFeedPayload>([
  ['/api/index.json', indexFeed],
  ['/api/catalog.snapshot.json', catalogExportFeed],
]);
const fetchJson: FetchJson = async (url) => {
  const feed = feeds.get(new URL(url).pathname);
  if (!feed) throw new Error('Unexpected feed');
  return feed;
};
const runExport = async (body: BodyInit | ReadableStream<Uint8Array>, extra: RunCliDependencies = {}) => {
  const output: string[] = [];
  const result = await streamCatalog({
    client: createFeedClient({baseUrl: indexFeed.siteUrl, fetchJson: extra.fetchJson ?? fetchJson}),
    baseUrl: indexFeed.siteUrl,
    fetchResponse: extra.fetchResponse ?? (async () => new Response(body)),
    write: extra.writeStdout ?? (async (chunk) => {output.push(chunk);}),
  });
  return {result, output};
};

afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals();});

describe('knowledge and catalog commands', () => {
  it('reads snapshot 16 editorial sources and streaming metadata', () => {
    const best = catalogExportFeed.data.best[0];
    if (!best) throw new Error('Expected an editorial fixture');
    const sourceReferences = [{title: 'Registry', url: 'https://registry.npmjs.org/example/latest', sourceType: 'package_registry'}];
    const snapshot = parseCatalogSnapshot({...catalogExportFeed, version: '20.0.0', data: {...catalogExportFeed.data,
      best: [{...best, rankedTools: best.rankedTools.map((tool) => ({...tool, sourceReferences}))}],
    }}, '/api/catalog.snapshot.json');
    expect(snapshot.data.best[0]?.rankedTools[0]?.sourceReferences).toEqual(sourceReferences);
    expect(catalogMetadataSchema.parse({...catalogMetadata, version: '20.0.0'}).version).toBe('20.0.0');
  });

  it.each([
    ['catalog', '--json', '--ndjson'], ['faq', '--ndjson'], ['catalog', '--ndjson'],
  ])('rejects unsupported arguments before network access: %s', async (...args) => {
    const read = vi.fn(fetchJson);
    const result = await runCli(args, {fetchJson: read});
    expect(result.exitCode).toBe(2);
    expect(read).not.toHaveBeenCalled();
  });



  it('authenticates each new cached feed against the index and honors no-cache', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'catalog-cache-'));
    const hashedCatalog = {...catalogExportFeed, contentHash: computeContentHash(catalogExportFeed)};
    const index = {...indexFeed, contentHashes: {'/api/catalog.snapshot.json': hashedCatalog.contentHash}};
    const read = vi.fn<FetchJson>(async (url) => new URL(url).pathname === '/api/index.json' ? index : hashedCatalog);
    try {
      await createFeedClient({fetchJson: read, cacheDirectory: directory}).catalog();
      read.mockClear();
      await createFeedClient({fetchJson: read, cacheDirectory: directory}).catalog();
      expect(read.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(['/api/index.json']);
      read.mockClear();
      await createFeedClient({fetchJson: read, cacheDirectory: directory, noCache: true}).catalog();
      expect(read.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(['/api/index.json', '/api/catalog.snapshot.json']);
    } finally {await rm(directory, {recursive: true, force: true});}
  });
});

describe('streaming catalog export', () => {
  it.each(['faq', 'glossaryTerm'])('rejects retired %s records in the current snapshot', async (type) => {
    const body = [catalogMetadata, ...catalogRows, {type, data: {}}]
      .map((row) => JSON.stringify(row)).join('\n') + '\n';
    const {result} = await runExport(body);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('schema_invalid');
    expect(result.stderr).toContain('Previously emitted NDJSON is incomplete');
  });

  it('writes validated one-line records without returning a buffered document', async () => {
    const {result, output} = await runExport(catalogNdjson);
    expect(result).toEqual({exitCode: 0, stdout: '', stderr: ''});
    expect(output).toHaveLength(catalogRows.length + 1);
    expect(catalogMetadataSchema.parse(JSON.parse(output[0]))).toEqual(catalogMetadata);
    output.slice(1).forEach((line) => expect(catalogRowSchema.safeParse(JSON.parse(line)).success).toBe(true));
    expect(output.every((line) => line.split('\n').length === 2)).toBe(true);
  });

  it('waits for writer backpressure before issuing another write or consuming the full body', async () => {
    let release = (): void => {};
    const blocked = new Promise<void>((resolve) => {release = resolve;});
    const row = JSON.stringify(catalogRows.at(-1)) + '\n';
    let pulled = 0;
    let stopSource = (): void => {};
    const source = new ReadableStream<Uint8Array>({
      start(controller) {stopSource = () => controller.close();},
      pull(controller) {
        const text = pulled === 0 ? JSON.stringify(catalogMetadata) + '\n' : row;
        controller.enqueue(new TextEncoder().encode(text));
        pulled += 1;
        if (pulled === 5000) controller.close();
      },
    });
    const writer = vi.fn(async () => {if (writer.mock.calls.length === 1) await blocked;});
    const pending = runExport(source, {writeStdout: writer});
    await vi.waitFor(() => expect(writer).toHaveBeenCalledTimes(1));
    try {
      expect(pulled).toBeLessThan(5000);
    } finally {
      // The behavior under test is bounded read-ahead while output is blocked.
      // Finish the producer after observing that behavior, then drain its rows.
      stopSource();
      release();
    }
    expect((await pending).result.exitCode).toBe(0);
    expect(writer).toHaveBeenCalledTimes(pulled);
  });

  it('decodes a multibyte character split across input chunks', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(catalogMetadata) + '\n' + JSON.stringify({type: 'category', data: {name: '工具', slug: 'tool', url: `${catalogMetadata.siteUrl}/tool-category`, description: 'A tool.'}}) + '\n');
    let offset = 0;
    const source = new ReadableStream<Uint8Array>({pull(controller) {controller.enqueue(bytes.slice(offset, ++offset)); if (offset === bytes.length) controller.close();}});
    const {result, output} = await runExport(source);
    expect(result.exitCode).toBe(0);
    expect(output[1]).toContain('工具');
  });

  it('splits large output rows into bounded writes without corrupting Unicode', async () => {
    const definition = '工具'.repeat(getDefaultHighWaterMark(false));
    const record = {type: 'category', data: {name: 'Tool', slug: 'tool', url: `${catalogMetadata.siteUrl}/tool-category`, description: definition}};
    const {result, output} = await runExport(JSON.stringify(catalogMetadata) + '\n' + JSON.stringify(record) + '\n');
    expect(result.exitCode).toBe(0);
    expect(output.length).toBeGreaterThan(2);
    // A decoder can carry at most three pending bytes of a UTF-8 code point.
    expect(Math.max(...output.map((chunk) => Buffer.byteLength(chunk)))).toBeLessThanOrEqual(getDefaultHighWaterMark(false) + 3);
    expect(JSON.parse(output.join('').trim().split('\n')[1])).toEqual(record);
  });

  it.each(['', '{}\n', JSON.stringify({...catalogMetadata, version: '99.0.0'}) + '\n', JSON.stringify({...catalogMetadata, siteUrl: 'https://attacker.example'}) + '\n'])('rejects missing, malformed, incompatible, or mismatched metadata', async (body) => {
    const {result, output} = await runExport(body);
    expect(result.exitCode).toBe(1);
    expect(output).toEqual([]);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toBe('');
  });

  it('rejects an unexpected advertised destination without following it', async () => {
    const request = vi.fn(async () => new Response(catalogNdjson));
    const {result} = await runExport('', {fetchResponse: request, fetchJson: async () => ({...indexFeed, snapshots: {...indexFeed.snapshots, ndjson: 'https://attacker.example/catalog'}})});
    expect(result.exitCode).toBe(1);
    expect(request).not.toHaveBeenCalled();
  });

  it('fails an HTTP redirect without emitting records', async () => {
    const {result, output} = await runExport('', {fetchResponse: async () => new Response(null, {status: 302, headers: {location: 'https://attacker.example'}})});
    expect(result.stderr).toContain('HTTP 302');
    expect(output).toEqual([]);
  });

  it('reports a malformed row after valid output only on stderr', async () => {
    let source: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({start(controller) {source = controller; controller.enqueue(new TextEncoder().encode(JSON.stringify(catalogMetadata) + '\n'));}});
    const writes: string[] = [];
    const pending = runExport(stream, {writeStdout: async (chunk) => {writes.push(chunk); source.enqueue(new TextEncoder().encode('{invalid\n')); source.close();}});
    const {result} = await pending;
    expect(writes).toHaveLength(1);
    expect(result).toMatchObject({exitCode: 1, stdout: ''});
    expect(result.stderr).toContain('Previously emitted NDJSON is incomplete');
    expect(result.stderr).toContain('schema_invalid');
  });

  it('warns when the body fails after a record and cancels the source', async () => {
    let source: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({start(controller) {source = controller; controller.enqueue(new TextEncoder().encode(JSON.stringify(catalogMetadata) + '\n'));}});
    const {result} = await runExport(stream, {writeStdout: async () => {source.error(new Error('private token or path'));}});
    expect(result.stderr).toContain('Previously emitted NDJSON is incomplete');
    expect(result.stderr).not.toContain('private token');
    expect(result.exitCode).toBe(1);
  });

  it('reports known and observed byte limits before buffering an oversized artifact', async () => {
    const {result, output} = await runExport('', {fetchResponse: async () => new Response('x', {headers: {'content-length': String(MAX_FEED_RESPONSE_BYTES + 1)}})});
    expect(output).toEqual([]);
    expect(result.stderr).toContain(`configured_limit_bytes=${MAX_FEED_RESPONSE_BYTES}`);
    expect(result.stderr).toContain(`observed_bytes=${MAX_FEED_RESPONSE_BYTES + 1}`);
    const actual = await runExport(new Uint8Array(MAX_FEED_RESPONSE_BYTES + 1));
    expect(actual.result.stderr).toContain('feed_too_large');
  });

  it('rejects invalid UTF-8 and a truncated Content-Length', async () => {
    const invalid = await runExport(new Uint8Array([0xff, 0xfe]));
    expect(invalid.result.exitCode).toBe(1);
    const truncated = await runExport('', {fetchResponse: async () => new Response(catalogNdjson, {headers: {'content-length': String(Buffer.byteLength(catalogNdjson) + 1)}})});
    expect(truncated.result.exitCode).toBe(1);
    expect(truncated.result.stderr).toContain('incomplete_catalog');
  });

  it('terminates stalled reads at the shared deadline', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const pending = runExport(new ReadableStream<Uint8Array>({cancel}));
    await vi.advanceTimersByTimeAsync(FEED_REQUEST_TIMEOUT_MS);
    const {result} = await pending;
    expect(result.stderr).toContain(`configured_limit_ms=${FEED_REQUEST_TIMEOUT_MS}`);
    expect(result.exitCode).toBe(5);
    await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
  });

  it('keeps writer failures private and warns about partial output', async () => {
    let writes = 0;
    const {result} = await runExport(catalogNdjson, {writeStdout: async () => {if (++writes === 2) throw new Error('/private/export.json');}});
    expect(result.stderr).toContain('Previously emitted NDJSON is incomplete');
    expect(result.stderr).not.toContain('/private/export');
    expect(result.stdout).toBe('');
  });

  it('warns even when the first writer rejects after a partial write', async () => {
    const {result} = await runExport(catalogNdjson, {writeStdout: async () => {throw new Error('partially written');}});
    expect(result.stderr).toContain('Previously emitted NDJSON is incomplete');
  });

  it('stops a blocked output consumer at the deadline', async () => {
    vi.useFakeTimers();
    const write = vi.fn(async () => new Promise<void>(() => {}));
    const pending = runExport(catalogNdjson, {writeStdout: write});
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(FEED_REQUEST_TIMEOUT_MS);
    const {result} = await pending;
    expect(result.exitCode).toBe(5);
    expect(result.stderr).toContain('feed_timeout');
    expect(result.stderr).toContain('Previously emitted NDJSON is incomplete');
    expect(write).toHaveBeenCalledOnce();
  });

  it('bounds the buffered JSON transport before parsing', async () => {
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array(MAX_FEED_RESPONSE_BYTES + 1)));
    await expect(defaultFetchJson('https://slothhub.dev/api/catalog.snapshot.json')).rejects.toMatchObject({configuredLimitBytes: MAX_FEED_RESPONSE_BYTES});
  });
});
