// ABOUTME: Pure agent-repair helpers — choose which connected agent to launch and
// ABOUTME: build the launch command. No VS Code dependency for testability.
import type { McpAgent } from './mcp-install-state';

export const REPAIR_PROMPT =
  'Please use the agentic-bookmarks MCP to repair all broken bookmarks. ' +
  'Start by reading the repair skill guide from anchor_getRepairSkillGuide.';

/** What an agent-repair launch should target: every broken anchor, or a specific list. */
export type RepairTarget =
  | { kind: 'all' }
  | { kind: 'ids'; ids: string[] };

/**
 * Build the prompt handed to the agent. The 'all' case is byte-for-byte the
 * historical REPAIR_PROMPT; the 'ids' case names the specific bookmarks.
 */
export function buildRepairPrompt(target: RepairTarget): string {
  if (target.kind === 'all') return REPAIR_PROMPT;
  const list = target.ids.join(', ');
  return (
    `Please use the agentic-bookmarks MCP to repair the following broken bookmarks: ${list}. ` +
    'Start by reading the repair skill guide from anchor_getRepairSkillGuide.'
  );
}

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
export function buildAgentLaunch(agent: McpAgent, prompt: string): AgentLaunch {
  switch (agent) {
    case 'claude':
      return { method: 'terminal', command: `claude "${prompt}"` };
    case 'codex':
      return { method: 'terminal', command: `codex "${prompt}"` };
    case 'cursor':
    default:
      return { method: 'clipboard', text: prompt };
  }
}

function dedupe(xs: McpAgent[]): McpAgent[] {
  return Array.from(new Set(xs));
}
