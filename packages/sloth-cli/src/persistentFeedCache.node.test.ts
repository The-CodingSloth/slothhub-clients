import {mkdtemp, readFile, readdir, rm, stat, symlink, truncate, unlink, writeFile} from 'node:fs/promises';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {afterEach, describe, expect, it, vi} from 'vite-plus/test';
import {MAX_PERSISTENT_CACHE_BYTES, readPersistentCacheEntry, writePersistentCacheEntry, type PersistentCacheEntry} from './persistentFeedCache.js';
import {FEED_REQUEST_TIMEOUT_MS} from './feedClient.js';

const directories: string[] = [];
const makeDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'slothhub-feed-cache-'));
  directories.push(directory);
  return directory;
};
const entry: PersistentCacheEntry = {
  contentHash: `sha256:${'a'.repeat(64)}`,
  storedAt: '2026-10-22T00:00:00.000Z',
  payload: {name: 'Figma'},
};
const cacheFiles = async (directory: string): Promise<string[]> =>
  (await readdir(join(directory, 'feeds-v2'))).filter((name) => name.endsWith('.json'));

afterEach(async () => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {recursive: true, force: true})));
});

// The forty-write disk workflow took 5.909 s under shared-host load on
// 2026-10-22. Match the CLI's 30 s real-I/O integration guard.
describe('persistent feed storage', {timeout: 30_000}, () => {
  it('rejects a cache file that grows after its size was checked', async () => {
    const directory = await makeDirectory();
    await writePersistentCacheEntry(directory, 'tool', entry);
    const [filename] = await cacheFiles(directory);
    const path = join(directory, 'feeds-v2', filename!);
    const serialized = await readFile(path);
    await writeFile(path, '{');
    const handle = await fs.open(path, 'r');
    const originalStat = handle.stat.bind(handle);
    vi.spyOn(handle, 'stat').mockImplementation(async () => {
      const beforeGrowth = await originalStat();
      await writeFile(path, serialized);
      return beforeGrowth;
    });
    vi.spyOn(fs, 'open').mockResolvedValue(handle);
    syncBuiltinESMExports();
    await expect(readPersistentCacheEntry(directory, 'tool')).resolves.toBeUndefined();
  });

  it('rejects invalid UTF-8 in an otherwise parseable cache entry', async () => {
    const directory = await makeDirectory();
    await writePersistentCacheEntry(directory, 'tool', {...entry, payload: 'cached value'});
    const [filename] = await cacheFiles(directory);
    const path = join(directory, 'feeds-v2', filename!);
    const serialized = await readFile(path);
    serialized[serialized.indexOf('cached value')] = 0xff;
    await writeFile(path, serialized);
    await expect(readPersistentCacheEntry(directory, 'tool')).resolves.toBeUndefined();
  });

  it.skipIf(process.platform === 'win32')('treats a named pipe as a cache miss without waiting for a writer', async () => {
    const directory = await makeDirectory();
    await writePersistentCacheEntry(directory, 'tool', entry);
    const [filename] = await cacheFiles(directory);
    const path = join(directory, 'feeds-v2', filename!);
    await unlink(path);
    expect(spawnSync('mkfifo', [path]).status).toBe(0);
    const reader = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import {readPersistentCacheEntry} from ${JSON.stringify(new URL('./persistentFeedCache.ts', import.meta.url).href)};
      const entry = await readPersistentCacheEntry(process.argv[1], 'tool');
      process.exitCode = entry === undefined ? 0 : 1;
    `, directory], {timeout: FEED_REQUEST_TIMEOUT_MS, cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8'});
    expect(reader.error, reader.stderr).toBeUndefined();
    expect(reader.status, reader.stderr).toBe(0);
  });

  it('bounds concurrent writes while retaining the newest artifact without losing other retained entries', async () => {
    const directory = await makeDirectory();
    await Promise.all(Array.from({length: 40}, (_, index) => writePersistentCacheEntry(directory, `tool-${index}`, {
      ...entry, payload: {slug: `tool-${index}`},
    })));
    const results = await Promise.all(Array.from({length: 40}, (_, index) => readPersistentCacheEntry(directory, `tool-${index}`)));
    expect(results.filter(Boolean)).toHaveLength(32);
    expect(results[39]?.payload).toEqual({slug: 'tool-39'});
    expect(await cacheFiles(directory)).toHaveLength(32);
  });

  it('evicts older bodies before retained cache bytes exceed the existing budget', async () => {
    const directory = await makeDirectory();
    const body = 'x'.repeat(Math.floor(MAX_PERSISTENT_CACHE_BYTES * 0.6));
    await writePersistentCacheEntry(directory, 'old', {...entry, payload: body});
    await writePersistentCacheEntry(directory, 'new', {...entry, payload: body});
    await expect(readPersistentCacheEntry(directory, 'old')).resolves.toBeUndefined();
    await expect(readPersistentCacheEntry(directory, 'new')).resolves.toMatchObject({payload: body});
    const sizes = await Promise.all((await cacheFiles(directory)).map(async (name) => (await stat(join(directory, 'feeds-v2', name))).size));
    expect(sizes.reduce((sum, bytes) => sum + bytes, 0)).toBeLessThanOrEqual(MAX_PERSISTENT_CACHE_BYTES);
  });

  it('ignores an oversized stored file and recovers on the next atomic write', async () => {
    const directory = await makeDirectory();
    await writePersistentCacheEntry(directory, 'tool', entry);
    const [filename] = await cacheFiles(directory);
    await truncate(join(directory, 'feeds-v2', filename!), MAX_PERSISTENT_CACHE_BYTES + 1);
    await expect(readPersistentCacheEntry(directory, 'tool')).resolves.toBeUndefined();
    await writePersistentCacheEntry(directory, 'tool', entry);
    await expect(readPersistentCacheEntry(directory, 'tool')).resolves.toMatchObject(entry);
  });

  it('does not follow a cache symlink when reading or replacing an entry', async () => {
    const directory = await makeDirectory();
    await writePersistentCacheEntry(directory, 'tool', entry);
    const [filename] = await cacheFiles(directory);
    const path = join(directory, 'feeds-v2', filename!);
    const target = join(directory, 'unrelated.json');
    const source = await readFile(path, 'utf8');
    await writeFile(target, source);
    await unlink(path);
    await symlink(target, path);
    await expect(readPersistentCacheEntry(directory, 'tool')).resolves.toBeUndefined();
    await writePersistentCacheEntry(directory, 'tool', {...entry, payload: {name: 'Updated'}});
    await expect(readPersistentCacheEntry(directory, 'tool')).resolves.toMatchObject({payload: {name: 'Updated'}});
    expect(await readFile(target, 'utf8')).toBe(source);
  });
});
