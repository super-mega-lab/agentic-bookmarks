// ABOUTME: Regression test for revalidateOpenDocuments in anchor-resolution.ts — a single
// ABOUTME: open document whose re-resolution throws must NOT abort the loop; remaining
// ABOUTME: stateful documents still get re-resolved (SML-1495).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

vi.mock('vscode', () => ({ workspace: { textDocuments: [] } }));

vi.mock('@agentic-bookmarks/core', () => ({
  resolveAnchors: vi.fn(() => []),
  refreshSmartAnchorContext: vi.fn(),
}));

vi.mock('./anchorState', () => ({
  hasStateForFile: vi.fn(() => true),
  initStateForFile: vi.fn(),
  clearStateForFile: vi.fn(),
}));

vi.mock('./brokenAnchorsSync', () => ({
  registerBookmarkUri: vi.fn(),
}));

import { createAnchorResolution, type AnchorResolutionDeps } from './anchor-resolution';

function makeDoc(uri: string): any {
  return { uri: { scheme: 'file', toString: () => uri }, getText: () => '' };
}

function makeDeps(): AnchorResolutionDeps {
  return {
    workspaceRoot: '/ws',
    log: { debug: vi.fn(), info: vi.fn(), error: vi.fn(), trace: vi.fn() } as any,
    getAllBookmarksForUri: vi.fn(async (uri: string) => {
      if (uri === 'file:///bad.ts') throw new Error('boom');
      return [];
    }),
    getResolutionOptions: vi.fn(async () => ({} as any)),
    refreshTree: vi.fn(),
    getRepairQueue: () => null,
    debouncedCacheSync: vi.fn(),
  };
}

describe('anchor-resolution — revalidateOpenDocuments resilience (SML-1495)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('continues revalidating remaining documents when onFileOpened throws for one', async () => {
    (vscode.workspace as any).textDocuments = [makeDoc('file:///bad.ts'), makeDoc('file:///good.ts')];
    const deps = makeDeps();
    const { revalidateOpenDocuments } = createAnchorResolution(deps);

    await expect(revalidateOpenDocuments()).resolves.toBeUndefined();

    expect(deps.getAllBookmarksForUri).toHaveBeenCalledTimes(2);
    expect(deps.getAllBookmarksForUri).toHaveBeenCalledWith('file:///bad.ts', '/ws');
    expect(deps.getAllBookmarksForUri).toHaveBeenCalledWith('file:///good.ts', '/ws');
  });

  it('logs the failing document URI and error via log.error', async () => {
    (vscode.workspace as any).textDocuments = [makeDoc('file:///bad.ts'), makeDoc('file:///good.ts')];
    const deps = makeDeps();
    const { revalidateOpenDocuments } = createAnchorResolution(deps);

    await revalidateOpenDocuments();

    expect(deps.log.error).toHaveBeenCalledTimes(1);
    const msg = (deps.log.error as any).mock.calls[0][0] as string;
    expect(msg).toContain('file:///bad.ts');
    expect(msg).toContain('boom');
  });

  it('revalidates every stateful open document when none throw', async () => {
    (vscode.workspace as any).textDocuments = [makeDoc('file:///good1.ts'), makeDoc('file:///good2.ts')];
    const deps = makeDeps();
    const { revalidateOpenDocuments } = createAnchorResolution(deps);

    await revalidateOpenDocuments();

    expect(deps.getAllBookmarksForUri).toHaveBeenCalledTimes(2);
    expect(deps.log.error).not.toHaveBeenCalled();
  });

  it('resolves without throwing when the only open document fails', async () => {
    (vscode.workspace as any).textDocuments = [makeDoc('file:///bad.ts')];
    const deps = makeDeps();
    const { revalidateOpenDocuments } = createAnchorResolution(deps);

    await expect(revalidateOpenDocuments()).resolves.toBeUndefined();
    expect(deps.log.error).toHaveBeenCalledTimes(1);
  });
});
