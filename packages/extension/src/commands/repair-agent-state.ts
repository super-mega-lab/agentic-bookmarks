// ABOUTME: Persisted state for agent-driven repair — the default agent preference
// ABOUTME: and the one-time "agent runs locally" consent flag (both globalState).
import type * as vscode from 'vscode';
import type { McpAgent } from './mcp-install-state';

const DEFAULT_KEY = 'agenticBookmarks.repairAgentDefault';
const CONSENT_KEY = 'agenticBookmarks.agentRepairConsentV1';

export function getRepairAgentDefault(ctx: vscode.ExtensionContext): McpAgent | undefined {
  return ctx.globalState.get<McpAgent>(DEFAULT_KEY);
}

export async function setRepairAgentDefault(ctx: vscode.ExtensionContext, agent: McpAgent): Promise<void> {
  await ctx.globalState.update(DEFAULT_KEY, agent);
}

export function hasRepairConsent(ctx: vscode.ExtensionContext): boolean {
  return ctx.globalState.get<boolean>(CONSENT_KEY) === true;
}

export async function recordRepairConsent(ctx: vscode.ExtensionContext): Promise<void> {
  await ctx.globalState.update(CONSENT_KEY, true);
}
