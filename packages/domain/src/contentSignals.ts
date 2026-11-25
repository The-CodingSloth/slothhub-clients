import {z} from 'zod'

/** Maintainer decision for upstream #731, 2026-10-17: leave ai-train unspecified. */
export const CONTENT_SIGNAL = 'search=yes, ai-input=yes'
export const contentSignalSchema = z.literal(CONTENT_SIGNAL)
export type ContentSignal = z.infer<typeof contentSignalSchema>
export const CONTENT_SIGNAL_JSON_SCHEMA = z.json().parse(z.toJSONSchema(contentSignalSchema, {target: 'draft-7'}))
