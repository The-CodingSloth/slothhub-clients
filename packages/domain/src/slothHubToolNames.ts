// Shared public MCP discovery vocabulary for stdio and hosted HTTP.
export const SLOTHHUB_TOOL_NAMES = [
  'search', 'fetch', 'slothhub_recommend_tools', 'slothhub_compare_tools',
  'slothhub_get_implementation_kit', 'slothhub_get_component', 'slothhub_submit_feedback',
  'slothhub_get_alternatives', 'slothhub_check_status',
] as const
export type SlothHubToolName = (typeof SLOTHHUB_TOOL_NAMES)[number]
export const SLOTHHUB_STDIO_ONLY_TOOL_NAMES = [] as const
export type SlothHubStdioOnlyToolName = (typeof SLOTHHUB_STDIO_ONLY_TOOL_NAMES)[number]
