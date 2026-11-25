import {createHash, randomUUID} from 'node:crypto';
import {constants as fsConstants} from 'node:fs';
import {lstat, mkdir, open, readdir, rename, unlink, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import type {JsonValue} from '@slothhub/domain/json-value';

// Preserve the existing disk-cache budgets. See the before/after receipt in
// upstream docs/measurements/agent-client-performance-2026-10-22.md.
export const MAX_PERSISTENT_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_PERSISTENT_CACHE_ENTRIES = 32;
const entrySchema = z.object({
  version: z.literal(2),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  catalogRevision: z.string().optional(),
  storedAt: z.iso.datetime(),
  payload: z.json(),
});

export interface PersistentCacheEntry {
  contentHash: string;
  catalogRevision?: string;
  storedAt: string;
  payload: JsonValue;
}

const cacheFilename = (key: string): string => `${createHash('sha256').update(key).digest('hex')}.json`;
const cacheDirectory = (directory: string): string => join(directory, 'feeds-v2');

export const readPersistentCacheEntry = async (
  directory: string,
  key: string,
): Promise<PersistentCacheEntry | undefined> => {
  try {
    const handle = await open(join(cacheDirectory(directory), cacheFilename(key)),
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
    let serialized: string;
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_PERSISTENT_CACHE_BYTES) return undefined;
      // Entries are replaced atomically. A changing file is a miss, and a
      // one-byte probe bounds allocation even if another writer grows it.
      const buffer = Buffer.alloc(stat.size + 1);
      let bytes = 0;
      while (bytes < buffer.length) {
        const {bytesRead} = await handle.read(buffer, bytes, buffer.length - bytes, bytes);
        if (bytesRead === 0) break;
        bytes += bytesRead;
      }
      if (bytes !== stat.size) return undefined;
      serialized = new TextDecoder('utf-8', {fatal: true}).decode(buffer.subarray(0, bytes));
    } finally {
      await handle.close();
    }
    const parsed = entrySchema.safeParse(JSON.parse(serialized));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

interface CacheFile {
  name: string;
  bytes: number;
  modifiedAt: number;
}

const pruneCache = async (directory: string, retainedFilename: string): Promise<void> => {
  const entries = (await readdir(directory, {withFileTypes: true}))
    .filter((entry) => entry.isFile() && /^[a-f0-9]{64}\.json$/.test(entry.name));
  const files: CacheFile[] = (await Promise.all(entries.map(async (entry): Promise<CacheFile[]> => {
    const stat = await lstat(join(directory, entry.name)).catch(() => undefined);
    return stat?.isFile() ? [{name: entry.name, bytes: stat.size, modifiedAt: stat.mtimeMs}] : [];
  }))).flat();
  files.sort((left, right) => Number(right.name === retainedFilename) - Number(left.name === retainedFilename) ||
    right.modifiedAt - left.modifiedAt || left.name.localeCompare(right.name));
  let retainedBytes = 0;
  let retainedEntries = 0;
  const evictions: Promise<void>[] = [];
  for (const file of files) {
    retainedBytes += file.bytes;
    retainedEntries += 1;
    if (retainedBytes > MAX_PERSISTENT_CACHE_BYTES || retainedEntries > MAX_PERSISTENT_CACHE_ENTRIES) {
      evictions.push(unlink(join(directory, file.name)).catch(() => undefined));
    }
  }
  await Promise.all(evictions);
};

const cacheWriteQueues = new Map<string, Promise<void>>();

export const writePersistentCacheEntry = async (
  directory: string,
  key: string,
  entry: PersistentCacheEntry,
): Promise<void> => {
  const serialized = `${JSON.stringify({...entry, version: 2})}\n`;
  if (Buffer.byteLength(serialized) > MAX_PERSISTENT_CACHE_BYTES) return;
  const previous = cacheWriteQueues.get(directory) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const destinationDirectory = cacheDirectory(directory);
    await mkdir(destinationDirectory, {recursive: true, mode: 0o700});
    const filename = cacheFilename(key);
    const temporary = join(destinationDirectory, `.${filename}.${process.pid}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, serialized, {encoding: 'utf8', mode: 0o600, flag: 'wx'});
      await rename(temporary, join(destinationDirectory, filename));
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
    // Pruning reads file metadata only; unrelated feed bodies never enter memory.
    await pruneCache(destinationDirectory, filename);
    await unlink(join(directory, 'feeds-v1.json')).catch(() => undefined);
  });
  cacheWriteQueues.set(directory, next);
  try {
    await next;
  } finally {
    if (cacheWriteQueues.get(directory) === next) cacheWriteQueues.delete(directory);
  }
};
