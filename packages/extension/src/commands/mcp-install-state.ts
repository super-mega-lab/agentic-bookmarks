// ABOUTME: Helpers for persisting and reading MCP agent install state.
// ABOUTME: Tracks which agents are installed, at what scope, and at which version.

import type * as vscode from 'vscode';

export type McpAgent = 'claude' | 'cursor' | 'codex';

export interface AgentMcpRecord {
  scope: 'local' | 'user' | 'project' | 'global';
  installedVersion?: string;
}

export interface McpInstallEntry {
  agent: McpAgent;
  record: AgentMcpRecord;
  store: 'workspace' | 'global';
}

const AGENTS: McpAgent[] = ['claude', 'cursor', 'codex'];

function stateKey(agent: McpAgent): string {
  return `agenticBookmarks.mcp.${agent}`;
}

export async function recordMcpInstall(
  context: vscode.ExtensionContext,
  agent: McpAgent,
  scope: AgentMcpRecord['scope'],
  currentVersion: string,
): Promise<void> {
  const record: AgentMcpRecord = { scope, installedVersion: currentVersion };
  const store = scope === 'user' || scope === 'global' ? context.globalState : context.workspaceState;
  await store.update(stateKey(agent), record);
}

export function getMcpInstallRecords(context: vscode.ExtensionContext): McpInstallEntry[] {
  const entries: McpInstallEntry[] = [];
  for (const agent of AGENTS) {
    const key = stateKey(agent);
    const wsRecord = context.workspaceState.get<AgentMcpRecord>(key);
    if (wsRecord) entries.push({ agent, record: wsRecord, store: 'workspace' });
    const globalRecord = context.globalState.get<AgentMcpRecord>(key);
    if (globalRecord) entries.push({ agent, record: globalRecord, store: 'global' });
  }
  return entries;
}

export function getOutdatedMcpInstalls(
  context: vscode.ExtensionContext,
  currentVersion: string,
): McpInstallEntry[] {
  return getMcpInstallRecords(context).filter(
    ({ record }) => !record.installedVersion || record.installedVersion !== currentVersion,
  );
}
