import {isExactUtcDate, isValidCatalogTimestamp} from './catalogFreshnessSearch.js'
import type {JsonValue} from './jsonValue.js'
import {MAX_PUBLIC_EVIDENCE_CLOCK_SKEW_MS} from './publicToolIntegrationFact.js'
import {hasRuntimeObjectType, isRuntimeString} from './runtimeValidation.js'

/**
 * Media freshness window, aligned with the Studio verification-overdue queue.
 * Screenshots decay faster than facts, so primary media older than this or
 * carrying no capture date surfaces for editorial review. This is a warning
 * signal, not a blocker: an old screenshot of a stable Tool is acceptable.
 */
export const MEDIA_CAPTURE_STALE_AFTER_SECONDS = 180 * 24 * 60 * 60

export type MediaCaptureFreshnessInput = {
  type?: string | null
  capturedAt?: string | null
  publishedAt?: string | null
  /**
   * Editor-supplied record of where a capture came from. Recorded only;
   * nothing in SlothHub fetches it — dereferencing an editor URL would be an
   * SSRF surface and belongs with a separate, explicit decision.
   */
  sourceUrl?: string | null
}

export type MediaCaptureFreshness = 'fresh' | 'stale' | 'unknown'

const resolveMediaCaptureDate = (
  input: MediaCaptureFreshnessInput,
): string | null | undefined =>
  input.type === 'video' ? input.publishedAt : input.capturedAt

/**
 * Classifies primary-media freshness. A missing, malformed, or future date is
 * 'unknown' — never silently treated as fresh — because backfilling capture
 * dates for existing assets is impossible.
 */
export const evaluateMediaCaptureFreshness = (
  input: MediaCaptureFreshnessInput,
  nowMs: number = Date.now(),
): MediaCaptureFreshness => {
  const raw = resolveMediaCaptureDate(input)
  if (!isRuntimeString(raw) || !raw.trim()) return 'unknown'
  const parsed = Date.parse(raw)
  if (
    !Number.isFinite(parsed) ||
    parsed > nowMs + MAX_PUBLIC_EVIDENCE_CLOCK_SKEW_MS
  ) {
    return 'unknown'
  }
  return nowMs - parsed > MEDIA_CAPTURE_STALE_AFTER_SECONDS * 1000
    ? 'stale'
    : 'fresh'
}

/**
 * Studio-facing label for a media item's capture state. Deliberately avoids
 * 'Last checked', 'Verified', and 'Drift': a capture date records when the
 * media was produced, not when Tool facts were re-checked or vouched for.
 */
export const describeMediaCaptureState = (
  input: MediaCaptureFreshnessInput,
  nowMs: number = Date.now(),
): string => {
  const state = evaluateMediaCaptureFreshness(input, nowMs)
  const isVideo = input.type === 'video'
  const raw = resolveMediaCaptureDate(input)
  if (state === 'unknown' || !isRuntimeString(raw)) {
    return isVideo ? 'publish date unknown' : 'capture date unknown'
  }
  const label = `${isVideo ? 'published' : 'captured'} ${raw.slice(0, 10)}`
  return state === 'stale' ? `${label} · needs review` : label
}

/**
 * `mediaGallery[].image.capturedAt` is a Sanity `date` field: `YYYY-MM-DD`
 * only. A timestamp there fails native schema validation and blocks publishing,
 * so every write path that bypasses Studio refuses it with this code.
 */
export const MEDIA_CAPTURE_DATE_INVALID = 'media_capture_date_invalid' as const

export interface InvalidMediaCaptureDate {
  /** Path inside the Tool document, for example `mediaGallery[0].image.capturedAt`. */
  path: string
  value: JsonValue
}

/** Every capture date in a Tool's media gallery that is present but not a calendar date. */
export const findInvalidMediaCaptureDates = (mediaGallery: JsonValue | undefined): InvalidMediaCaptureDate[] => {
  if (!Array.isArray(mediaGallery)) return []
  return mediaGallery.flatMap((item, index) => {
    if (!hasRuntimeObjectType(item) || item === null || Array.isArray(item)) return []
    const image = item.image
    if (!hasRuntimeObjectType(image) || image === null || Array.isArray(image)) return []
    const value = image.capturedAt
    if (value === undefined || value === null || isExactUtcDate(value)) return []
    return [{path: `mediaGallery[${index}].image.capturedAt`, value}]
  })
}

/** One line an agent or operator can act on: code, path, observed value and the fix. */
export const describeInvalidMediaCaptureDate = ({path, value}: InvalidMediaCaptureDate): string => {
  const repair = planMediaCaptureDateRepair(value)
  const fix = repair.status === 'convert'
    ? `send the UTC date "${repair.date}" instead`
    : 'send the date the image was captured as YYYY-MM-DD, or omit the field'
  return `${MEDIA_CAPTURE_DATE_INVALID}: ${path}=${JSON.stringify(value)} is not a date; the field stores YYYY-MM-DD only. Recovery: ${fix}.`
}

export type MediaCaptureDateRepair =
  | {status: 'date'}
  | {status: 'convert'; date: string}
  | {status: 'unparseable'}

/**
 * How to repair one stored capture date: keep a calendar date, turn a full
 * RFC 3339 timestamp into its UTC date, and leave anything else for a person.
 */
export const planMediaCaptureDateRepair = (value: JsonValue): MediaCaptureDateRepair => {
  if (isExactUtcDate(value)) return {status: 'date'}
  if (isRuntimeString(value) && isValidCatalogTimestamp(value)) {
    return {status: 'convert', date: new Date(Date.parse(value)).toISOString().slice(0, 10)}
  }
  return {status: 'unparseable'}
}
