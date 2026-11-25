/** JSON-compatible scalar used only while decoding or canonically serializing external values. */
export type JsonPrimitive = string | number | boolean | null

/**
 * Boundary-only JSON representation. Parse this into a named domain type before
 * passing data into product logic; keep it only for genuinely arbitrary JSON.
 */
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[] | undefined

/** Arbitrary JSON object for boundary parsing, canonical JSON, and extension payloads only. */
export interface JsonObject {
  [key: string]: JsonValue | undefined
}
