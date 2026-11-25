import { constants as fsConstants } from 'node:fs';
import { lstat as fsLstat, open as fsOpen } from 'node:fs/promises';
import { hasRuntimeObjectType, isRuntimeString } from '../runtimeValidation.js';

const READ_CHUNK_BYTES = 64 * 1024;

type FileIdentity = number | bigint;
type FileStatus = {
  isFile: () => boolean;
  isSymbolicLink?: () => boolean;
  dev?: FileIdentity;
  ino?: FileIdentity;
};

interface ReadHandle {
  stat: () => Promise<FileStatus>;
  read: (
    buffer: Buffer,
    offset: number,
    length: number,
    position: number | null,
  ) => Promise<{ bytesRead: number }>;
  close: () => Promise<void>;
}

interface BoundedUtf8SourceOperations {
  open: (path: string, flags: number) => Promise<ReadHandle>;
  lstat: (path: string) => Promise<FileStatus>;
  stdin: AsyncIterable<Buffer | string>;
  noFollowFlag: number | undefined;
}

export interface BoundedUtf8SourceOptions {
  maxBytes: number;
  label: string;
  recovery: string;
}

export type BoundedUtf8SourceErrorCode =
  | 'input_too_large'
  | 'invalid_utf8'
  | 'source_not_regular'
  | 'source_unreadable';

export class BoundedUtf8SourceError extends Error {
  readonly code: BoundedUtf8SourceErrorCode;
  readonly configuredLimitBytes?: number;
  readonly observedBytes?: number;
  readonly recovery: string;

  constructor(
    code: BoundedUtf8SourceErrorCode,
    label: string,
    recovery: string,
    limit?: { configuredLimitBytes: number; observedBytes: number },
  ) {
    const detail = limit
      ? ` (configured limit: ${limit.configuredLimitBytes} bytes; observed: ${limit.observedBytes} bytes)`
      : '';
    const reason =
      code === 'input_too_large'
        ? 'exceeds its input limit'
        : code === 'invalid_utf8'
          ? 'is not valid UTF-8'
          : code === 'source_not_regular'
            ? 'source must be one regular file and cannot be a symlink'
            : 'source could not be read';
    super(`${label} ${reason}${detail}. Recovery: ${recovery}`);
    this.name = 'BoundedUtf8SourceError';
    this.code = code;
    this.configuredLimitBytes = limit?.configuredLimitBytes;
    this.observedBytes = limit?.observedBytes;
    this.recovery = recovery;
  }
}

const defaultOperations: BoundedUtf8SourceOperations = {
  open: async (path, flags) => fsOpen(path, flags),
  lstat: fsLstat,
  stdin: process.stdin,
  noFollowFlag: fsConstants.O_NOFOLLOW,
};

const errorCode = <Value>(error: Value): string | undefined =>
  hasRuntimeObjectType(error) && error !== null && 'code' in error && isRuntimeString(error.code)
    ? error.code
    : undefined;

const decode = (chunks: readonly Buffer[], options: BoundedUtf8SourceOptions): string => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new BoundedUtf8SourceError('invalid_utf8', options.label, options.recovery);
  }
};

const appendChunk = (
  chunks: Buffer[],
  chunk: Buffer,
  observedBytes: number,
  options: BoundedUtf8SourceOptions,
): number => {
  const nextObservedBytes = observedBytes + chunk.byteLength;
  if (nextObservedBytes > options.maxBytes) {
    throw new BoundedUtf8SourceError('input_too_large', options.label, options.recovery, {
      configuredLimitBytes: options.maxBytes,
      observedBytes: nextObservedBytes,
    });
  }
  chunks.push(chunk);
  return nextObservedBytes;
};

const readStream = async (
  source: AsyncIterable<Buffer | string>,
  options: BoundedUtf8SourceOptions,
): Promise<string> => {
  const chunks: Buffer[] = [];
  let observedBytes = 0;
  for await (const chunk of source) {
    observedBytes = appendChunk(
      chunks,
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
      observedBytes,
      options,
    );
  }
  return decode(chunks, options);
};

// A zero or absent device number means the platform did not report one
// (Windows lstat), so device identity is only enforced when both sides
// report a real device.
const reportedDevice = (status: FileStatus): number | undefined => {
  if (status.dev === undefined) return undefined;
  const device = Number(status.dev);
  return device === 0 ? undefined : device;
};

const readFile = async (
  path: string,
  options: BoundedUtf8SourceOptions,
  operations: BoundedUtf8SourceOperations,
): Promise<string> => {
  let pathStatus: FileStatus | undefined;
  if (operations.noFollowFlag === undefined) {
    try {
      pathStatus = await operations.lstat(path);
    } catch {
      throw new BoundedUtf8SourceError('source_unreadable', options.label, options.recovery);
    }
    if (pathStatus.isSymbolicLink?.() || !pathStatus.isFile()) {
      throw new BoundedUtf8SourceError('source_not_regular', options.label, options.recovery);
    }
  }
  let handle: ReadHandle;
  try {
    handle = await operations.open(
      path,
      fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | (operations.noFollowFlag ?? 0),
    );
  } catch (error) {
    if (errorCode(error) === 'ELOOP') {
      throw new BoundedUtf8SourceError('source_not_regular', options.label, options.recovery);
    }
    throw new BoundedUtf8SourceError('source_unreadable', options.label, options.recovery);
  }

  try {
    const openedStatus = await handle.stat();
    const pathDevice = pathStatus && reportedDevice(pathStatus);
    const openedDevice = reportedDevice(openedStatus);
    if (
      !openedStatus.isFile() ||
      (pathStatus &&
        (pathStatus.ino === undefined ||
          openedStatus.ino === undefined ||
          pathStatus.ino !== openedStatus.ino ||
          (pathDevice !== undefined && openedDevice !== undefined && pathDevice !== openedDevice)))
    ) {
      throw new BoundedUtf8SourceError('source_not_regular', options.label, options.recovery);
    }
    const chunks: Buffer[] = [];
    let observedBytes = 0;
    while (observedBytes <= options.maxBytes) {
      const remaining = options.maxBytes + 1 - observedBytes;
      const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, remaining));
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      observedBytes = appendChunk(chunks, buffer.subarray(0, bytesRead), observedBytes, options);
    }
    return decode(chunks, options);
  } finally {
    try {
      await handle.close();
    } catch {
      // Cleanup cannot change the input result.
    }
  }
};

export const createBoundedUtf8SourceReader = (
  overrides: Partial<BoundedUtf8SourceOperations> = {},
): ((path: string, options: BoundedUtf8SourceOptions) => Promise<string>) => {
  const operations = { ...defaultOperations, ...overrides };
  return (path, options) =>
    path === '-' ? readStream(operations.stdin, options) : readFile(path, options, operations);
};

export const readBoundedUtf8Source = createBoundedUtf8SourceReader();

export const createBoundedUtf8FileReader = (
  overrides: Parameters<typeof createBoundedUtf8SourceReader>[0] = {},
) => {
  const operations = { ...defaultOperations, ...overrides };
  return (path: string, options: BoundedUtf8SourceOptions): Promise<string> =>
    readFile(path, options, operations);
};
export const readBoundedUtf8File = createBoundedUtf8FileReader();
