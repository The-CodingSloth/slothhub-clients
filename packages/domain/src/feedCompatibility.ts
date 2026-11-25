import { z } from 'zod';

const semanticVersionSchema = z.string().regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u);
const semanticFeedVersionSchema = z.object({ version: semanticVersionSchema });

// Unpublished clients consume only the current producer contracts.
export const CATALOG_FEED_SUPPORTED_MAJORS = ['33'] as const;
export const SEARCH_INDEX_SUPPORTED_MAJORS = ['17'] as const;

type SupportedFeedMajors = readonly [string];

const versionSchema = (majors: SupportedFeedMajors) =>
  semanticVersionSchema.refine(
    (version) => majors.includes(version.split('.')[0]!),
    `Expected a supported ${majors[0]}.x semantic version.`,
  );

export const catalogFeedVersionSchema = versionSchema(CATALOG_FEED_SUPPORTED_MAJORS);
// Snapshot majors are independent; trial and editorial evidence carry source-type enums.
export const CATALOG_SNAPSHOT_SUPPORTED_MAJORS = ['20'] as const;
export const catalogSnapshotVersionSchema = versionSchema(CATALOG_SNAPSHOT_SUPPORTED_MAJORS);

export const searchIndexVersionSchema = versionSchema(SEARCH_INDEX_SUPPORTED_MAJORS);

export class UnsupportedFeedVersionError extends Error {
  readonly code = 'unsupported_version';
  readonly supportedVersion: string;
  readonly recoveryTarget = 'client' as const;

  constructor(
    readonly observedVersion: string,
    supportedMajors: SupportedFeedMajors,
  ) {
    const supportedVersion = `${supportedMajors[0]}.x`;
    super(
      `Feed version ${observedVersion} is unsupported; this client supports ${supportedVersion}. Upgrade the client, then retry.`,
    );
    this.name = 'UnsupportedFeedVersionError';
    this.supportedVersion = supportedVersion;
  }
}

/** Inspect only the version; the owning feed schema still validates the full payload. */
export function assertSupportedFeedVersion<Payload>(
  payload: Payload,
  supportedMajors: SupportedFeedMajors,
): void {
  const parsed = semanticFeedVersionSchema.safeParse(payload);
  // Missing or malformed versions belong to the feed's normal schema diagnostics.
  if (!parsed.success) return;
  if (!supportedMajors.includes(parsed.data.version.split('.')[0]!)) {
    throw new UnsupportedFeedVersionError(parsed.data.version, supportedMajors);
  }
}

/** Snapshot versions are gated independently because they embed the search query contract. */
export function assertSupportedPublicFeedVersion<Payload>(payload: Payload, path: string): void {
  const majors =
    path === '/api/catalog.snapshot.json'
      ? CATALOG_SNAPSHOT_SUPPORTED_MAJORS
      : path === '/api/search-index.json'
        ? SEARCH_INDEX_SUPPORTED_MAJORS
        : CATALOG_FEED_SUPPORTED_MAJORS;
  assertSupportedFeedVersion(payload, majors);
}
