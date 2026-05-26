// ABOUTME: Helpers for persisting and reading MCP agent install state.
// ABOUTME: Tracks which agents are installed, at what scope, and at which version.

export type McpAgent = 'claude' | 'cursor' | 'codex';

export type AnyScope = 'local' | 'user' | 'project' | 'global';

export interface AgentMcpRecord {
  scope: AnyScope;
  installedVersion?: string;
}

export interface McpInstallEntry {
  agent: McpAgent;
  record: AgentMcpRecord;
  store: 'workspace' | 'global';
}

const AGENTS: McpAgent[] = ['claude', 'cursor', 'codex'];

export const AGENT_DISPLAY_NAMES: Record<McpAgent, string> = {
  claude: 'Claude Code',
  cursor: 'Cursor',
  codex: 'Codex',
};

// Each agent has two install scopes that map fixed to the two ExtensionContext
// state stores: workspaceState holds the workspace-scoped record, globalState
// holds the machine-wide record. The scope *labels* differ per agent to match
// each tool's native vocabulary.
export const AGENT_SCOPES: Record<McpAgent, { workspace: AnyScope; global: AnyScope }> = {
  claude: { workspace: 'local', global: 'user' },
  cursor: { workspace: 'project', global: 'global' },
  codex:  { workspace: 'project', global: 'global' },
};

export function scopeDisplayLabel(scope: AnyScope): string {
  switch (scope) {
    case 'local':   return 'Local';
    case 'user':    return 'User';
    case 'project': return 'Project';
    case 'global':  return 'Global';
  }
}

export interface MergedAgentState {
  installs: Partial<Record<AnyScope, { installedVersion?: string }>>;
}

interface StateStoreLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

interface ContextLike {
  workspaceState: StateStoreLike;
  globalState: StateStoreLike;
}

function stateKey(agent: McpAgent): string {
  return `agenticBookmarks.mcp.${agent}`;
}

function storeForScope(context: ContextLike, scope: AnyScope): StateStoreLike {
  return scope === 'user' || scope === 'global' ? context.globalState : context.workspaceState;
}

export async function recordMcpInstall(
  context: ContextLike,
  agent: McpAgent,
  scope: AgentMcpRecord['scope'],
  currentVersion: string,
): Promise<void> {
  const record: AgentMcpRecord = { scope, installedVersion: currentVersion };
  await storeForScope(context, scope).update(stateKey(agent), record);
}

export function getMcpInstallRecords(context: ContextLike): McpInstallEntry[] {
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
  context: ContextLike,
  currentVersion: string,
): McpInstallEntry[] {
  return getMcpInstallRecords(context).filter(
    ({ record }) => !record.installedVersion || record.installedVersion !== currentVersion,
  );
}

export function getAgentMcpState(context: ContextLike, agent: McpAgent): MergedAgentState {
  const key = stateKey(agent);
  const installs: MergedAgentState['installs'] = {};
  const wsRecord = context.workspaceState.get<AgentMcpRecord>(key);
  if (wsRecord && wsRecord.scope) {
    installs[wsRecord.scope] = { installedVersion: wsRecord.installedVersion };
  }
  const globalRecord = context.globalState.get<AgentMcpRecord>(key);
  if (globalRecord && globalRecord.scope) {
    installs[globalRecord.scope] = { installedVersion: globalRecord.installedVersion };
  }
  return { installs };
}

export async function clearMcpInstall(
  context: ContextLike,
  agent: McpAgent,
  scope: AnyScope,
): Promise<void> {
  const key = stateKey(agent);
  const store = storeForScope(context, scope);
  const existing = store.get<AgentMcpRecord>(key);
  await store.update(key, undefined);
  // Defense in depth: if the record's own scope disagrees with the argument,
  // also clear the *other* store so we can't get stuck with a stale record
  // pointing at an unexpected scope. This should never happen under normal
  // flow but recovers from any prior data corruption.
  if (existing && existing.scope && existing.scope !== scope) {
    const other = store === context.globalState ? context.workspaceState : context.globalState;
    await other.update(key, undefined);
  }
}

export function getAllConfiguredAgents(): McpAgent[] {
  return [...AGENTS];
}
