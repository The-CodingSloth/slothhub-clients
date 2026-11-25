import type {JsonObject, JsonValue} from './jsonValue.js'
import {z} from 'zod'
import type {RegistryEnrichmentSnapshot} from './registryEnrichment.js'
import {
  hasRuntimeObjectType,
  isRuntimeBoolean,
  isRuntimeString,
} from './runtimeValidation.js'

/**
 * Public-safe projection of a GitHub repository observation.
 *
 * The private registry sweep records sanitized snapshots on
 * `agentInterfaceRegistryCheck` drafts; this shape is the subset that is
 * published onto the Tool document and read by pages, Markdown mirrors, and
 * agent feeds. Stars are an observed count, not a quality ranking. It excludes
 * forks, topics and operational detail (errorMessage, apiUrl). Check cadence stays
 * on the private check document; only the last successful fetch (`fetchedAt`)
 * is published.
 */
export const REPOSITORY_OBSERVATION_STATUS_VALUES = [
  'ok',
  'stale',
  'not_found',
  'unavailable',
  'never_fetched',
] as const

export type RepositoryObservationStatus =
  (typeof REPOSITORY_OBSERVATION_STATUS_VALUES)[number]

export interface PublicRepositoryObservation {
  status: RepositoryObservationStatus
  /** Absent on legacy GitHub observations. */
  source?: 'github' | 'gitlab'
  isArchived?: boolean
  isDisabled?: boolean
  /** Last successful registry fetch. This is the "observed" date in public copy. */
  fetchedAt?: string
  /** Observed default-branch tip committer date, not a maintenance verdict. */
  lastCommitAt?: string
  /** Last GitHub `pushed_at` — any-branch activity, not a SlothHub freshness verdict. */
  pushedAt?: string
  /** GitHub stargazers at fetchedAt; absent means not observed, never zero. */
  starCount?: number
}

/**
 * Consecutive 404s required before the public status becomes `not_found`.
 * Matches the private consistency gate in `agentInterfaceRegistryConsistency.ts`;
 * see upstream docs/measurements for the receipt.
 */
export const REPOSITORY_OBSERVATION_NOT_FOUND_THRESHOLD = 2

const STATUS_SET = new Set<string>(REPOSITORY_OBSERVATION_STATUS_VALUES)
const starCountSchema = z.number().int().nonnegative().safe()

const observedStars = (value: JsonValue): Pick<PublicRepositoryObservation, 'starCount'> => {
  const parsed = starCountSchema.safeParse(value)
  return parsed.success ? {starCount: parsed.data} : {}
}

const isJsonObject = (value: JsonValue): value is JsonObject =>
  hasRuntimeObjectType(value) && value !== null && !Array.isArray(value)

const observationDateLabel = (value: string | undefined): string | null => {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? null
    : new Intl.DateTimeFormat('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(date)
}

const factFlags = (
  snapshot: RegistryEnrichmentSnapshot,
  previous: PublicRepositoryObservation | null | undefined,
): Pick<PublicRepositoryObservation, 'isArchived' | 'isDisabled'> => {
  const facts = snapshot.facts
  if (facts && (facts.isArchived !== undefined || facts.isDisabled !== undefined)) {
    return {
      isArchived: facts.isArchived === true,
      isDisabled: facts.isDisabled === true,
    }
  }
  return {
    ...(previous?.isArchived !== undefined
      ? {isArchived: previous.isArchived}
      : undefined),
    ...(previous?.isDisabled !== undefined
      ? {isDisabled: previous.isDisabled}
      : undefined),
  }
}

const lastKnownPushedAt = (
  snapshot: RegistryEnrichmentSnapshot,
  previous: PublicRepositoryObservation | null | undefined,
): Pick<PublicRepositoryObservation, 'pushedAt'> => {
  const pushedAt = snapshot.facts?.pushedAt ?? previous?.pushedAt
  return pushedAt ? {pushedAt} : {}
}

/**
 * Fold a fresh registry snapshot into the public observation. `previous` is
 * the currently stored public projection — it preserves last-known flags and
 * the last-successful-fetch timestamp through transient failures, and clears
 * flags once a repository is confirmed missing.
 */
export const buildRepositoryObservation = (
  snapshot: RegistryEnrichmentSnapshot,
  previous: PublicRepositoryObservation | null | undefined,
): PublicRepositoryObservation => {
  if (previous && (previous.source ?? 'github') !== snapshot.source) previous = null
  if (snapshot.status === 'ok' || snapshot.status === 'stale') {
    return {
      status: snapshot.status,
      ...(snapshot.source === 'gitlab' ? {source: 'gitlab' as const} : undefined),
      ...factFlags(snapshot, previous),
      ...lastKnownPushedAt(snapshot, previous),
      ...(snapshot.facts?.lastCommitAt ? {lastCommitAt: snapshot.facts.lastCommitAt} : undefined),
      ...observedStars(snapshot.facts?.starCount),
      fetchedAt: snapshot.fetchedAt,
    }
  }

  const consecutiveNotFound =
    snapshot.status === 'not_found' || snapshot.failureKind === 'not_found'
      ? (snapshot.failureCount ?? 1)
      : 0

  if (consecutiveNotFound >= REPOSITORY_OBSERVATION_NOT_FOUND_THRESHOLD) {
    return {
      status: 'not_found',
      ...(snapshot.source === 'gitlab' ? {source: 'gitlab' as const} : undefined),
      ...(previous?.fetchedAt ? {fetchedAt: previous.fetchedAt} : undefined),
    }
  }

  return {
    status: 'unavailable',
    ...(snapshot.source === 'gitlab' ? {source: 'gitlab' as const} : undefined),
    ...(previous?.isArchived !== undefined
      ? {isArchived: previous.isArchived}
      : undefined),
    ...(previous?.isDisabled !== undefined
      ? {isDisabled: previous.isDisabled}
      : undefined),
    ...(previous?.fetchedAt ? {fetchedAt: previous.fetchedAt} : undefined),
    ...(previous?.lastCommitAt ? {lastCommitAt: previous.lastCommitAt} : undefined),
    ...(previous?.pushedAt ? {pushedAt: previous.pushedAt} : undefined),
    ...observedStars(previous?.starCount),
  }
}

/** Parse the stored Tool field at the public read boundary. */
export const normalizeRepositoryObservation = (
  input: JsonValue,
): PublicRepositoryObservation | null => {
  if (!isJsonObject(input)) return null
  if (!isRuntimeString(input.status) || !STATUS_SET.has(input.status)) return null

  return {
    // SAFETY: The closed-vocabulary check above establishes the status contract.
    status: input.status as RepositoryObservationStatus,
    ...(input.source === 'gitlab' || input.source === 'github' ? {source: input.source} : undefined),
    ...(isRuntimeBoolean(input.isArchived) ? {isArchived: input.isArchived} : undefined),
    ...(isRuntimeBoolean(input.isDisabled) ? {isDisabled: input.isDisabled} : undefined),
    ...(isRuntimeString(input.fetchedAt) ? {fetchedAt: input.fetchedAt} : undefined),
    ...(isRuntimeString(input.lastCommitAt) ? {lastCommitAt: input.lastCommitAt} : undefined),
    ...(isRuntimeString(input.pushedAt) ? {pushedAt: input.pushedAt} : undefined),
    ...observedStars(input.starCount),
  }
}

/**
 * The public notice sentence. Copy stays an observed fact ("GitHub marks…"),
 * never a SlothHub verdict — shared verbatim by the Tool page, the Markdown
 * mirror, and the JSON detail feed.
 */
export const buildRepositoryObservationNotice = (
  observation:
    | Pick<
        PublicRepositoryObservation,
        'status' | 'isArchived' | 'isDisabled' | 'fetchedAt' | 'source'
      >
    | null
    | undefined,
): string | null => {
  if (!observation) return null
  const provider = observation.source === 'gitlab' ? 'GitLab' : 'GitHub'

  const states = [
    observation.isArchived === true ? 'archived' : null,
    observation.isDisabled === true ? 'disabled' : null,
  ].filter((state): state is string => state !== null)

  const observed = observationDateLabel(observation.fetchedAt)
  const mayBeOutdated =
    observation.status === 'stale' || observation.status === 'unavailable'
  const observedSuffix = mayBeOutdated
    ? observed
      ? ` (last successful ${provider} observation ${observed})`
      : ` (${provider} registry data may be out of date)`
    : observed
      ? ` (observed ${observed})`
      : ''

  if (states.length > 0) {
    return `${provider} marks this repository ${states.join(' and ')}${observedSuffix}.`
  }
  if (observation.status === 'not_found') {
    return `${provider} no longer serves this repository — it may have been renamed, made private, or deleted${observedSuffix}.`
  }
  if (mayBeOutdated && observed) {
    return `Last successful ${provider} observation ${observed}.`
  }
  return null
}

/**
 * The last-activity stamp shared by the Tool page, Markdown mirror, and
 * CLI/MCP detail output. It prints GitHub's observed `pushed_at` verbatim —
 * never an "abandoned" or "unmaintained" verdict.
 */
export const buildRepositoryLastPushLabel = (
  observation:
    | Pick<PublicRepositoryObservation, 'pushedAt' | 'fetchedAt'>
    | null
    | undefined,
): string | null => {
  const pushed = observationDateLabel(observation?.pushedAt)
  if (!pushed) return null

  const observed = observationDateLabel(observation?.fetchedAt)
  return `Last GitHub push ${pushed}${observed ? ` (observed ${observed})` : ''}`
}

/** Internal review interval, not a maintenance verdict. Receipt: upstream docs/maintenance-review.md. */
export const REPOSITORY_ACTIVITY_REVIEW_AFTER_DAYS = 365

export function getRepositoryActivityReview(
  observation: Pick<PublicRepositoryObservation, 'lastCommitAt' | 'pushedAt'> | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!observation?.lastCommitAt) return null
  const ageDays = Math.floor((now.getTime() - Date.parse(observation.lastCommitAt)) / 86_400_000)
  if (!Number.isFinite(ageDays) || ageDays <= REPOSITORY_ACTIVITY_REVIEW_AFTER_DAYS) return null
  return `default-branch commit is ${ageDays} days old (review interval ${REPOSITORY_ACTIVITY_REVIEW_AFTER_DAYS} days); inspect upstream and refresh the observation before making an editorial claim`
}
