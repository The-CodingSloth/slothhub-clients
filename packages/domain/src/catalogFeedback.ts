import {z} from 'zod'
import {isSafePublicText} from './publicText.js'
import {isValidToolPublicSlug} from './toolLookup.js'

/**
 * Feedback about the catalog or its agent surfaces, sent by people and agents
 * through the MCP server and CLI. It lands in a private Studio queue; a triage
 * agent turns it into GitHub issues. Nothing here is published.
 */
export const CATALOG_FEEDBACK_PATH = '/api/feedback'

export const CATALOG_FEEDBACK_KIND_VALUES = [
  'wrong_fact', 'missing_tool', 'setup_worked', 'setup_failed', 'server_problem', 'suggestion',
] as const
export type CatalogFeedbackKind = (typeof CATALOG_FEEDBACK_KIND_VALUES)[number]

export const CATALOG_FEEDBACK_KIND_LABELS = {
  wrong_fact: 'Wrong or outdated fact',
  missing_tool: 'Missing tool',
  setup_worked: 'Setup worked',
  setup_failed: 'Setup failed',
  server_problem: 'MCP or CLI problem',
  suggestion: 'Suggestion',
} as const satisfies Record<CatalogFeedbackKind, string>

export const CATALOG_FEEDBACK_REPORTER_VALUES = ['agent', 'human'] as const
export const CATALOG_FEEDBACK_SURFACE_VALUES = ['mcp', 'cli'] as const

export const CATALOG_FEEDBACK_STATUS_VALUES = ['new', 'filed', 'duplicate', 'acknowledged', 'dismissed'] as const
/** Outcomes the triage agent can record; acknowledged keeps positive reports such as setup_worked. */
export const CATALOG_FEEDBACK_RESOLUTION_STATUS_VALUES = ['filed', 'duplicate', 'acknowledged', 'dismissed'] as const
export type CatalogFeedbackStatus = (typeof CATALOG_FEEDBACK_STATUS_VALUES)[number]

/**
 * Message bounds reuse the correction-report contract (10–2,000 characters);
 * the request body cap reuses its 16 KiB receipt:
 * upstream docs/measurements/intake-json-body-caps-2026-09-14.md.
 */
export const CATALOG_FEEDBACK_MESSAGE_MIN = 10
export const CATALOG_FEEDBACK_MESSAGE_MAX = 2000
export const CATALOG_FEEDBACK_MAX_REQUEST_BYTES = 16_384

const shortText = (max: number) => z.string().trim().min(1).max(max).refine(isSafePublicText, 'Use plain text without control characters.')
const httpsUrl = z.url({protocol: /^https$/u, error: 'Use an https URL.'}).max(2048)
  .refine((value) => {
    const url = new URL(value)
    return !url.username && !url.password
  }, 'URLs with credentials are not allowed.')

export const catalogFeedbackRequestSchema = z.object({
  requestId: z.uuid(),
  kind: z.enum(CATALOG_FEEDBACK_KIND_VALUES),
  reportedBy: z.enum(CATALOG_FEEDBACK_REPORTER_VALUES),
  surface: z.enum(CATALOG_FEEDBACK_SURFACE_VALUES),
  message: z.string().trim()
    .min(CATALOG_FEEDBACK_MESSAGE_MIN, `message_too_short: Describe the problem in at least ${CATALOG_FEEDBACK_MESSAGE_MIN} characters.`)
    .max(CATALOG_FEEDBACK_MESSAGE_MAX, `message_too_long: limit_characters=${CATALOG_FEEDBACK_MESSAGE_MAX}. Shorten the message.`),
  toolSlug: z.string().refine(isValidToolPublicSlug, 'invalid_slug: Use a public Tool slug.').optional(),
  field: shortText(80).optional(),
  evidenceUrl: httpsUrl.optional(),
  query: shortText(200).optional(),
  host: shortText(40).optional(),
  client: z.object({name: shortText(80), version: shortText(40).optional()}).strict().optional(),
}).strict()
export type CatalogFeedbackRequest = z.infer<typeof catalogFeedbackRequestSchema>

export const catalogFeedbackReceiptSchema = z.object({
  received: z.literal(true),
  id: z.uuid(),
  status: z.literal('queued'),
  replayed: z.boolean(),
}).strict()
export type CatalogFeedbackReceipt = z.infer<typeof catalogFeedbackReceiptSchema>

export const CATALOG_FEEDBACK_FAILURE_CODES = [
  'validation_failed', 'rate_limited', 'rate_limit_unavailable', 'request_conflict', 'service_unavailable', 'payload_too_large',
] as const
export const catalogFeedbackFailureSchema = z.object({
  code: z.enum(CATALOG_FEEDBACK_FAILURE_CODES),
  message: z.string(),
  retryAfterSeconds: z.number().int().nonnegative().optional(),
  errors: z.array(z.object({field: z.string(), message: z.string()})).optional(),
}).strict()
export type CatalogFeedbackFailure = z.infer<typeof catalogFeedbackFailureSchema>

export type CatalogFeedbackResult =
  | {ok: true; receipt: CatalogFeedbackReceipt}
  | {ok: false; failure: CatalogFeedbackFailure}

/** One outcome shape for the site route, hosted MCP and HTTP clients. */
export const catalogFeedbackResponseSchema = z.union([
  z.object({ok: z.literal(true), receipt: catalogFeedbackReceiptSchema}).strict(),
  z.object({ok: z.literal(false), failure: catalogFeedbackFailureSchema}).strict(),
])

/** Private queue entries as the triage agent reads them. */
export const catalogFeedbackQueueItemSchema = z.object({
  id: z.uuid(),
  kind: z.enum(CATALOG_FEEDBACK_KIND_VALUES),
  reportedBy: z.enum(CATALOG_FEEDBACK_REPORTER_VALUES),
  surface: z.enum(CATALOG_FEEDBACK_SURFACE_VALUES),
  message: z.string(),
  toolSlug: z.string().optional(),
  field: z.string().optional(),
  evidenceUrl: z.string().optional(),
  query: z.string().optional(),
  host: z.string().optional(),
  clientName: z.string().optional(),
  clientVersion: z.string().optional(),
  submittedAt: z.string(),
  status: z.enum(CATALOG_FEEDBACK_STATUS_VALUES),
  issueUrl: z.string().optional(),
  triageNote: z.string().optional(),
  handledAt: z.string().optional(),
})
export type CatalogFeedbackQueueItem = z.infer<typeof catalogFeedbackQueueItemSchema>

export const catalogFeedbackQueueSchema = z.object({items: z.array(catalogFeedbackQueueItemSchema)}).strict()

export const CATALOG_FEEDBACK_QUEUE_LIMIT_MAX = 100
export const catalogFeedbackQueueInputSchema = z.object({
  status: z.enum(CATALOG_FEEDBACK_STATUS_VALUES).default('new'),
  limit: z.coerce.number().int().min(1).max(CATALOG_FEEDBACK_QUEUE_LIMIT_MAX).default(50),
}).strict()

/** How the triage agent records what it did with one entry. */
export const catalogFeedbackResolutionSchema = z.object({
  id: z.uuid(),
  status: z.enum(CATALOG_FEEDBACK_RESOLUTION_STATUS_VALUES),
  issueUrl: z.url({protocol: /^https$/u}).regex(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+$/u, 'Use a GitHub issue URL.').optional(),
  note: shortText(500).optional(),
}).strict().refine((value) => value.status === 'dismissed' || value.status === 'acknowledged' || Boolean(value.issueUrl), {
  message: 'Filed and duplicate entries need the GitHub issue URL.', path: ['issueUrl'],
})
export type CatalogFeedbackResolution = z.infer<typeof catalogFeedbackResolutionSchema>

export const catalogFeedbackResolutionResultSchema = z.object({
  id: z.uuid(),
  status: z.enum(CATALOG_FEEDBACK_RESOLUTION_STATUS_VALUES),
  handledAt: z.string(),
  issueUrl: z.string().optional(),
  triageNote: z.string().optional(),
}).strict()
