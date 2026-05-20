// ABOUTME: Pure agent-repair helpers — choose which connected agent to launch and
// ABOUTME: build the launch command. No VS Code dependency for testability.
import type { McpAgent } from './mcp-install-state';

export const REPAIR_PROMPT =
  'Please use the agentic-bookmarks MCP to repair all broken bookmarks.';

export type LaunchDecision =
  | { action: 'connect' }
  | { action: 'launch'; agent: McpAgent }
  | { action: 'choose'; agents: McpAgent[] };

/** Decide what clicking Repair All should do, given connected agents + saved default. */
export function pickAgentToLaunch(input: {
  connected: McpAgent[];
  preferred: McpAgent | undefined;
}): LaunchDecision {
  const connected = dedupe(input.connected);
  if (connected.length === 0) return { action: 'connect' };
  if (input.preferred && connected.includes(input.preferred)) {
    return { action: 'launch', agent: input.preferred };
  }
  if (connected.length === 1) return { action: 'launch', agent: connected[0] };
  return { action: 'choose', agents: connected };
}

export type AgentLaunch =
  | { method: 'terminal'; command: string }
  | { method: 'clipboard'; text: string };

/** Terminal launch for agents with a headless prompt CLI; clipboard for the rest. */
export function buildAgentLaunch(agent: McpAgent): AgentLaunch {
  switch (agent) {
    case 'claude':
      return { method: 'terminal', command: `claude "${REPAIR_PROMPT}"` };
    case 'codex':
      return { method: 'terminal', command: `codex "${REPAIR_PROMPT}"` };
    case 'cursor':
    default:
      return { method: 'clipboard', text: REPAIR_PROMPT };
  }
}

function dedupe(xs: McpAgent[]): McpAgent[] {
  return Array.from(new Set(xs));
}
