import { randomUUID } from 'node:crypto';
import { link as fsLink, open as fsOpen, rename as fsRename, unlink as fsUnlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { DECISION_RECEIPT_MAX_MARKDOWN_BYTES } from '@slothhub/domain/decision-receipt';
import {
  BoundedUtf8SourceError,
  createBoundedUtf8SourceReader,
} from '@slothhub/domain/bounded-utf8-source';

type FileStatus = { isFile: () => boolean };

interface ReceiptFileHandle {
  stat?: () => Promise<FileStatus>;
  read?: (buffer: Buffer, offset: number, length: number, position: number | null) => Promise<{ bytesRead: number }>;
  writeFile?: (contents: string, encoding: BufferEncoding) => Promise<void>;
  sync?: () => Promise<void>;
  close: () => Promise<void>;
}

interface DecisionReceiptFileOperations {
  open: (path: string, flags: string | number, mode?: number) => Promise<ReceiptFileHandle>;
  link: (existingPath: string, newPath: string) => Promise<void>;
  rename: (oldPath: string, newPath: string) => Promise<void>;
  unlink: (path: string) => Promise<void>;
  randomUUID: () => string;
  stdin: AsyncIterable<Buffer | string>;
}

// SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
const defaultOperations: DecisionReceiptFileOperations = {
  open: fsOpen as DecisionReceiptFileOperations['open'],
  link: fsLink,
  rename: fsRename,
  unlink: fsUnlink,
  randomUUID,
  stdin: process.stdin,
};

const bestEffort = async (operation: () => Promise<void>): Promise<void> => {
  try {
    await operation();
  } catch {
    // Cleanup must not hide the operation that determined publication success or failure.
  }
};

const legacyReadError = (
  error: BoundedUtf8SourceError,
  maxBytes: number,
  artifactLabel: string,
): Error => {
  const message =
    error.code === 'input_too_large'
      ? `${artifactLabel} exceeds the ${maxBytes}-byte artifact limit.`
      : error.code === 'invalid_utf8'
        ? `${artifactLabel} input is not valid UTF-8.`
        : error.code === 'source_not_regular'
          ? `${artifactLabel} source must be a regular file.`
          : `${artifactLabel} source is unreadable.`;
  return Object.assign(new Error(message), {
    code: error.code,
    ...(error.configuredLimitBytes !== undefined
      ? {configuredLimitBytes: error.configuredLimitBytes}
      : undefined),
    ...(error.observedBytes !== undefined ? {observedBytes: error.observedBytes} : undefined),
    recovery: error.recovery,
  });
};

const readWithLegacyErrors = async (
  path: string,
  maxBytes: number,
  artifactLabel: string,
  operations: Pick<DecisionReceiptFileOperations, 'open' | 'stdin'>,
): Promise<string> => {
  const reader = createBoundedUtf8SourceReader({
    open: async (sourcePath, flags) => {
      const handle = await operations.open(sourcePath, flags);
      if (!handle.stat || !handle.read) throw new Error('Source handle is unreadable.');
      return {
        stat: () => handle.stat!(),
        read: (buffer, offset, length, position) =>
          handle.read!(buffer, offset, length, position),
        close: () => handle.close(),
      };
    },
    stdin: operations.stdin,
  });
  try {
    return await reader(path, {
      maxBytes,
      label: artifactLabel,
      recovery: `Provide a ${maxBytes}-byte-or-smaller regular file.`,
    });
  } catch (error) {
    if (error instanceof BoundedUtf8SourceError) {
      throw legacyReadError(error, maxBytes, artifactLabel);
    }
    throw error;
  }
};

export const readBoundedUtf8File = (
  path: string,
  maxBytes: number,
  artifactLabel: string,
): Promise<string> => readWithLegacyErrors(path, maxBytes, artifactLabel, defaultOperations);

export const createDecisionReceiptFileIO = (
  overrides: Partial<DecisionReceiptFileOperations> = {},
) => {
  const operations = { ...defaultOperations, ...overrides };

  const readSource = async (path: string): Promise<string> => {
    return readWithLegacyErrors(
      path,
      DECISION_RECEIPT_MAX_MARKDOWN_BYTES,
      'Decision receipt',
      operations,
    );
  };

  // SAFETY: The browser or React event contract establishes this DOM instance before it is used here.
  const writeOutput = async (path: string, contents: string, force: boolean): Promise<void> => {
    const directory = dirname(path);
    const temporaryPath = join(directory, `.${basename(path)}.${process.pid}.${operations.randomUUID()}.tmp`);
    let handle: ReceiptFileHandle | undefined;
    let closed = false;
    let published = false;

    try {
      handle = await operations.open(temporaryPath, 'wx', 0o600);
      if (!handle.writeFile || !handle.sync) throw new Error('Temporary receipt output is unwritable.');
      await handle.writeFile(contents, 'utf8');
      await handle.sync();
      await handle.close();
      closed = true;

      if (force) {
        await operations.rename(temporaryPath, path);
      } else {
        try {
          await operations.link(temporaryPath, path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            throw Object.assign(
              new Error(`Refusing to overwrite existing file: ${path}. Use --force to replace it.`),
              { code: 'EEXIST' as const },
            );
          }
          throw error;
        }
      }
      published = true;
    } finally {
      if (handle && !closed) await bestEffort(() => handle!.close());
      if (!published || !force) await bestEffort(() => operations.unlink(temporaryPath));
    }
  };

  return { readSource, writeOutput };
};

const defaultFileIO = createDecisionReceiptFileIO();

export const readDecisionReceiptSource = defaultFileIO.readSource;
export const writeDecisionReceiptOutput = defaultFileIO.writeOutput;
