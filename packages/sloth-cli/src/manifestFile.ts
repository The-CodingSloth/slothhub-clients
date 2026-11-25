import { lstat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import {
  PROJECT_TOOL_PIN_MANIFEST_DEFAULT_FILENAME as CURRENT,
  PROJECT_TOOL_PIN_MANIFEST_LEGACY_FILENAME as LEGACY,
} from '@slothhub/domain/project-tool-pin-manifest';

export interface LocatedManifest {
  /** Path to read. */
  path: string;
  /** Path as the user should see it. */
  display: string;
  /** Rename advice when the old file name is in play. */
  notice?: string;
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return false;
    throw error;
  }
};

const renameCommand = (display: string): string => {
  const directory = dirname(display);
  return `mv ${display} ${directory === '.' ? CURRENT : join(directory, CURRENT)}`;
};

export const legacyManifestNotice = (display: string): string =>
  `Notice: ${display} uses the old manifest file name. Rename it to ${CURRENT} with: ${renameCommand(display)}`;

/** Rename advice for a path the user named, when it carries the old file name. */
export const explicitManifestNotice = (display: string): string | undefined =>
  basename(display) === LEGACY ? legacyManifestNotice(display) : undefined;

/**
 * The manifest `validate` and `render` read when no file is named. The current
 * name wins; the old name is read only when the current one is absent, and is
 * never ignored silently: either case returns a notice.
 */
export const locateDefaultManifest = async (workingDirectory: string): Promise<LocatedManifest | null> => {
  const [current, legacy] = await Promise.all([
    exists(join(workingDirectory, CURRENT)),
    exists(join(workingDirectory, LEGACY)),
  ]);
  if (current) {
    return {
      path: join(workingDirectory, CURRENT),
      display: CURRENT,
      ...(legacy ? {notice: `Notice: Read ${CURRENT}. ${LEGACY}, the old file name, is also here and was not read. Delete it once you have checked it holds nothing you need.`} : undefined),
    };
  }
  if (legacy) return {path: join(workingDirectory, LEGACY), display: LEGACY, notice: legacyManifestNotice(LEGACY)};
  return null;
};

/** True when `manifest init` would leave a second manifest next to an old-name one. */
export const legacyManifestBlocksDefaultOutput = async (workingDirectory: string): Promise<boolean> =>
  await exists(join(workingDirectory, LEGACY)) && !await exists(join(workingDirectory, CURRENT));

export const LEGACY_MANIFEST_OUTPUT_MESSAGE = `Found ${LEGACY}, the old name for ${CURRENT}; writing ${CURRENT} next to it would leave two manifests.`;
export const LEGACY_MANIFEST_OUTPUT_RECOVERY = `Rename it with: mv ${LEGACY} ${CURRENT}, then rerun with --force to replace it, or pass --output to write a different file.`;
