import {z} from 'zod'
export {formatToolCapabilityCount, TOOL_CAPABILITY_EFFECT_LABELS} from './toolFeaturePresentation.js'

export const TOOL_CAPABILITY_LIST_KINDS = ['mcp_tool', 'command', 'skill', 'endpoint'] as const
export const TOOL_CAPABILITY_EFFECTS = ['read', 'write', 'destructive'] as const
export const toolCapabilityListFields = {
  listKind: z.enum(TOOL_CAPABILITY_LIST_KINDS),
  items: z.array(z.object({
    name: z.string().trim().refine((value) => !!value.trim(), 'Copy the exact capability name from its source.'),
    description: z.string().trim().min(1),
    effect: z.enum(TOOL_CAPABILITY_EFFECTS).optional(),
    requiresAuth: z.boolean().optional(),
  })).min(1).refine((items) => new Set(items.map(({name}) => name)).size === items.length, 'List each capability name once.'),
  agentInterfaceKey: z.string().trim().min(1).optional(),
}
export interface ToolCapabilityInterfaceRow {_key?: string | null; kind?: string | null}
export interface ToolCapabilityInterfaceReference {listKind?: string; agentInterfaceKey?: string}
export function isToolCapabilityInterfaceReferenceValid(reference: ToolCapabilityInterfaceReference, interfaces?: readonly (ToolCapabilityInterfaceRow | null)[] | null): boolean {
  if (!reference.agentInterfaceKey) return true
  const matches = interfaces?.filter((row) => row?._key === reference.agentInterfaceKey) ?? []
  return reference.listKind === 'mcp_tool' && matches.length === 1 && matches[0]?.kind === 'mcp_server'
}

interface ToolCapabilityCountClaim {
  title: string
  summary: string
  listKind: typeof TOOL_CAPABILITY_LIST_KINDS[number]
  items: readonly {name: string}[]
}
export function toolCapabilityCountsMatch(detail: ToolCapabilityCountClaim): boolean {
  const noun = {mcp_tool: 'tool', command: 'command', skill: 'skill', endpoint: 'endpoint'}[detail.listKind]
  // Recognize count-specific modifiers, rather than consuming arbitrary prose
  // such as “Node 22 supports MCP tools” as a claim of 22 tools.
  const claims = [detail.title, detail.summary].flatMap((text) => [...text.matchAll(/\b(\d[\d,]*)(\+?)\s+(?:(?:MCP|API|HTTP2|agent|documented|built-in|available|public|private|official|native|custom)\s+)*(tools?|commands?|skills?|endpoints?)\b/giu)])
  return claims.every((claim) => claim[3]?.toLowerCase().replace(/s$/u, '') !== noun || (!claim[2] && Number(claim[1]?.replaceAll(',', '')) === detail.items.length))
}
