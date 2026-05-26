// ABOUTME: Tests for MCP agent install state persistence helpers.
// ABOUTME: Verifies read/write/filter behaviour across workspaceState and globalState.

import { describe, it, expect } from 'vitest';
import type * as vscode from 'vscode';
import {
  recordMcpInstall,
  getMcpInstallRecords,
  getOutdatedMcpInstalls,
  getAgentMcpState,
  clearMcpInstall,
  type AgentMcpRecord,
} from './mcp-install-state';

function makeContext(): vscode.ExtensionContext {
  const wsData = new Map<string, unknown>();
  const globalData = new Map<string, unknown>();
  return {
    workspaceState: {
      get: <T>(key: string) => wsData.get(key) as T | undefined,
      update: async (key: string, value: unknown) => { wsData.set(key, value); },
    },
    globalState: {
      get: <T>(key: string) => globalData.get(key) as T | undefined,
      update: async (key: string, value: unknown) => { globalData.set(key, value); },
    },
  } as unknown as vscode.ExtensionContext;
}

describe('recordMcpInstall', () => {
  it('writes to globalState for user scope', async () => {
    const ctx = makeContext();
    await recordMcpInstall(ctx, 'claude', 'user', '0.7.8');
    expect(ctx.globalState.get('agenticBookmarks.mcp.claude')).toEqual({ scope: 'user', installedVersion: '0.7.8' });
  });

  it('writes to workspaceState for local scope', async () => {
    const ctx = makeContext();
    await recordMcpInstall(ctx, 'claude', 'local', '0.7.8');
    expect(ctx.workspaceState.get('agenticBookmarks.mcp.claude')).toEqual({ scope: 'local', installedVersion: '0.7.8' });
  });

  it('writes to globalState for global scope', async () => {
    const ctx = makeContext();
    await recordMcpInstall(ctx, 'cursor', 'global', '0.7.8');
    expect(ctx.globalState.get('agenticBookmarks.mcp.cursor')).toEqual({ scope: 'global', installedVersion: '0.7.8' });
  });

  it('writes to workspaceState for project scope', async () => {
    const ctx = makeContext();
    await recordMcpInstall(ctx, 'codex', 'project', '0.7.8');
    expect(ctx.workspaceState.get('agenticBookmarks.mcp.codex')).toEqual({ scope: 'project', installedVersion: '0.7.8' });
  });
});

describe('getMcpInstallRecords', () => {
  it('returns empty array when nothing installed', () => {
    expect(getMcpInstallRecords(makeContext())).toHaveLength(0);
  });

  it('returns records from workspace and global stores', async () => {
    const ctx = makeContext();
    await recordMcpInstall(ctx, 'claude', 'user', '0.7.8');
    await recordMcpInstall(ctx, 'cursor', 'project', '0.7.8');
    const records = getMcpInstallRecords(ctx);
    expect(records).toHaveLength(2);
    expect(records.find(r => r.agent === 'claude')?.store).toBe('global');
    expect(records.find(r => r.agent === 'cursor')?.store).toBe('workspace');
  });

  it('returns both workspace and global records for the same agent', async () => {
    const ctx = makeContext();
    await recordMcpInstall(ctx, 'claude', 'local', '0.7.8');
    await recordMcpInstall(ctx, 'claude', 'user', '0.7.8');
    expect(getMcpInstallRecords(ctx)).toHaveLength(2);
  });
});

describe('getOutdatedMcpInstalls', () => {
  it('returns empty when nothing installed', () => {
    expect(getOutdatedMcpInstalls(makeContext(), '0.7.8')).toHaveLength(0);
  });

  it('returns entries with a mismatched version', async () => {
    const ctx = makeContext();
    await recordMcpInstall(ctx, 'claude', 'user', '0.7.7');
    const outdated = getOutdatedMcpInstalls(ctx, '0.7.8');
    expect(outdated).toHaveLength(1);
    expect(outdated[0].agent).toBe('claude');
  });

  it('excludes entries that are current', async () => {
    const ctx = makeContext();
    await recordMcpInstall(ctx, 'claude', 'user', '0.7.8');
    expect(getOutdatedMcpInstalls(ctx, '0.7.8')).toHaveLength(0);
  });

  it('treats a record missing installedVersion as outdated', async () => {
    const ctx = makeContext();
    await ctx.globalState.update('agenticBookmarks.mcp.claude', { scope: 'user' });
    expect(getOutdatedMcpInstalls(ctx, '0.7.8')).toHaveLength(1);
  });

  it('handles a mix of current and outdated entries', async () => {
    const ctx = makeContext();
    await recordMcpInstall(ctx, 'claude', 'user', '0.7.7');
    await recordMcpInstall(ctx, 'cursor', 'global', '0.7.8');
    const outdated = getOutdatedMcpInstalls(ctx, '0.7.8');
    expect(outdated).toHaveLength(1);
    expect(outdated[0].agent).toBe('claude');
  });
});

describe('getAgentMcpState', () => {
  it('returns empty installs when no records exist', () => {
    expect(getAgentMcpState(makeContext(), 'claude').installs).toEqual({});
  });

  it('reads a workspace-scoped Claude install', async () => {
    const ctx = makeContext();
    await recordMcpInstall(ctx, 'claude', 'local', '0.8.2');
    expect(getAgentMcpState(ctx, 'claude').installs).toEqual({
      local: { installedVersion: '0.8.2' },
    });
  });

  it('reads a global-scoped Claude install', async () => {
    const ctx = makeContext();
    await recordMcpInstall(ctx, 'claude', 'user', '0.8.2');
    expect(getAgentMcpState(ctx, 'claude').installs).toEqual({
      user: { installedVersion: '0.8.2' },
    });
  });

  it('merges both scopes when an agent is installed at user and local', async () => {
    const ctx = makeContext();
    await recordMcpInstall(ctx, 'claude', 'local', '0.8.1');
    await recordMcpInstall(ctx, 'claude', 'user', '0.8.2');
    expect(getAgentMcpState(ctx, 'claude').installs).toEqual({
      local: { installedVersion: '0.8.1' },
      user: { installedVersion: '0.8.2' },
    });
  });

  it('preserves project/global scope labels for Cursor', async () => {
    const ctx = makeContext();
    await recordMcpInstall(ctx, 'cursor', 'project', '0.8.2');
    await recordMcpInstall(ctx, 'cursor', 'global', '0.8.2');
    expect(getAgentMcpState(ctx, 'cursor').installs).toEqual({
      project: { installedVersion: '0.8.2' },
      global: { installedVersion: '0.8.2' },
    });
  });

  it('isolates per-agent reads', async () => {
    const ctx = makeContext();
    await recordMcpInstall(ctx, 'claude', 'local', '0.8.2');
    expect(getAgentMcpState(ctx, 'cursor').installs).toEqual({});
    expect(getAgentMcpState(ctx, 'codex').installs).toEqual({});
  });

  it('handles a record missing installedVersion', async () => {
    const ctx = makeContext();
    await ctx.globalState.update('agenticBookmarks.mcp.claude', { scope: 'user' } as AgentMcpRecord);
    expect(getAgentMcpState(ctx, 'claude').installs).toEqual({
      user: { installedVersion: undefined },
    });
  });
});

describe('clearMcpInstall', () => {
  it('deletes only the workspaceState key for a local-scope uninstall', async () => {
    const ctx = makeContext();
    await recordMcpInstall(ctx, 'claude', 'local', '0.8.2');
    await recordMcpInstall(ctx, 'claude', 'user', '0.8.2');
    await clearMcpInstall(ctx, 'claude', 'local');
    expect(ctx.workspaceState.get('agenticBookmarks.mcp.claude')).toBeUndefined();
    expect(ctx.globalState.get('agenticBookmarks.mcp.claude')).toEqual({
      scope: 'user', installedVersion: '0.8.2',
    });
  });

  it('deletes only the globalState key for a user-scope uninstall', async () => {
    const ctx = makeContext();
    await recordMcpInstall(ctx, 'claude', 'local', '0.8.2');
    await recordMcpInstall(ctx, 'claude', 'user', '0.8.2');
    await clearMcpInstall(ctx, 'claude', 'user');
    expect(ctx.globalState.get('agenticBookmarks.mcp.claude')).toBeUndefined();
    expect(ctx.workspaceState.get('agenticBookmarks.mcp.claude')).toEqual({
      scope: 'local', installedVersion: '0.8.2',
    });
  });

  it('deletes the workspaceState key for a project-scope uninstall (Cursor)', async () => {
    const ctx = makeContext();
    await recordMcpInstall(ctx, 'cursor', 'project', '0.8.2');
    await clearMcpInstall(ctx, 'cursor', 'project');
    expect(ctx.workspaceState.get('agenticBookmarks.mcp.cursor')).toBeUndefined();
  });

  it('deletes the globalState key for a global-scope uninstall (Codex)', async () => {
    const ctx = makeContext();
    await recordMcpInstall(ctx, 'codex', 'global', '0.8.2');
    await clearMcpInstall(ctx, 'codex', 'global');
    expect(ctx.globalState.get('agenticBookmarks.mcp.codex')).toBeUndefined();
  });

  it('is a no-op when the key is already absent', async () => {
    const ctx = makeContext();
    await expect(clearMcpInstall(ctx, 'claude', 'local')).resolves.toBeUndefined();
  });

  it('clears both stores if the targeted record disagrees with the argument scope (corruption recovery)', async () => {
    const ctx = makeContext();
    // Hand-write a corrupted state: workspaceState contains a record claiming user scope.
    await ctx.workspaceState.update('agenticBookmarks.mcp.claude', { scope: 'user', installedVersion: '0.8.2' });
    await ctx.globalState.update('agenticBookmarks.mcp.claude', { scope: 'user', installedVersion: '0.8.2' });
    await clearMcpInstall(ctx, 'claude', 'local');
    expect(ctx.workspaceState.get('agenticBookmarks.mcp.claude')).toBeUndefined();
    expect(ctx.globalState.get('agenticBookmarks.mcp.claude')).toBeUndefined();
  });
});
