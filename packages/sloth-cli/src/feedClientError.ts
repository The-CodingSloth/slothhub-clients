export type FeedClientErrorCode =
  | 'transport'
  | 'not_found'
  | 'hash_mismatch'
  | 'schema_invalid'
  | 'revision_mismatch'
  | 'unsupported_version';

interface FeedClientErrorOptions extends ErrorOptions {
  httpStatus?: number;
}

export class FeedClientError extends Error {
  readonly httpStatus?: number;

  constructor(
    readonly code: FeedClientErrorCode,
    readonly path: string,
    message: string,
    options?: FeedClientErrorOptions,
  ) {
    super(message, options);
    this.name = 'FeedClientError';
    this.httpStatus = options?.httpStatus;
  }
}

export class FeedCapabilityUnavailableError extends Error {
  readonly code = 'capability_unavailable' as const;
  readonly recovery =
    'Use a newer SlothHub catalog or run `slothhub doctor --json` to inspect available feeds.';

  constructor(readonly capability: string) {
    super(`This catalog does not advertise the ${capability} feed.`);
    this.name = 'FeedCapabilityUnavailableError';
  }
}
