// The canonical list of workflow prompts the SlothHub MCP server registers.
// Every surface that advertises hosted prompts (the /agents hub, agents.md,
// hosted admission allowlists) derives from this list so a new prompt can
// never ship silently invisible.
export const SLOTHHUB_PROMPT_NAMES = [
  'slothhub_discover_tool',
  'slothhub_find_mcp_server',
  'slothhub_find_agent_skill',
  'slothhub_browse_stack',
  'slothhub_browse_best',
  'slothhub_browse_comparison',
  'slothhub_browse_alternatives',
] as const

export type SlothHubPromptName = (typeof SLOTHHUB_PROMPT_NAMES)[number]
