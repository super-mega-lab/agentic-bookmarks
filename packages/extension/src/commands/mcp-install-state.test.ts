// ABOUTME: Tests for MCP agent install state persistence helpers.
// ABOUTME: Verifies read/write/filter behaviour across workspaceState and globalState.

import { describe, it, expect } from 'vitest';
import type * as vscode from 'vscode';
import { recordMcpInstall, getMcpInstallRecords, getOutdatedMcpInstalls } from './mcp-install-state';

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
