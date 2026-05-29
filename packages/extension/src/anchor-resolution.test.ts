// ABOUTME: Guards the batched tree refresh in revalidateOpenDocuments (SML-1497) — the
// ABOUTME: bulk re-resolve must refresh the bookmarks tree ONCE, not once per open document,
// ABOUTME: while single-document onFileOpened keeps its per-call refresh.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mutable mock state, hoisted so the vi.mock factories below can read it safely.
const mockState = vi.hoisted(() => ({
  textDocuments: [] as any[],
  hasState: true,
}));

vi.mock('vscode', () => ({
  workspace: {
    get textDocuments() {
      return mockState.textDocuments;
    },
  },
}));

vi.mock('@agentic-bookmarks/core', () => ({
  resolveAnchors: vi.fn(() => [{ anchorId: 'b1', resolved: true, line: 0 }]),
  refreshSmartAnchorContext: vi.fn(() => ({ anchor: {}, refreshed: false })),
}));

vi.mock('./anchorState', () => ({
  initStateForFile: vi.fn(),
  clearStateForFile: vi.fn(),
  hasStateForFile: vi.fn(() => mockState.hasState),
}));

vi.mock('./brokenAnchorsSync', () => ({
  registerBookmarkUri: vi.fn(),
}));

import { createAnchorResolution, type AnchorResolutionDeps } from './anchor-resolution';

function fakeDoc(uri: string) {
  return {
    uri: { scheme: 'file', toString: () => uri, fsPath: uri.replace('file://', '') },
    getText: () => 'a\nb\nc',
  } as any;
}

function makeDeps(): AnchorResolutionDeps & { refreshTree: ReturnType<typeof vi.fn> } {
  const log = { debug() {}, info() {}, warn() {}, error() {}, trace() {} } as unknown as AnchorResolutionDeps['log'];
  return {
    workspaceRoot: '/ws',
    log,
    // One bookmark per URI so onFileOpened proceeds past its empty-bookmarks early return.
    getAllBookmarksForUri: vi.fn(async () => [
      { bookmark: { id: 'b1', anchor: { kind: 'line' }, targetUri: 'file:///a.ts' }, isLocal: false },
    ]),
    getResolutionOptions: vi.fn(async () => ({ showWarningOnShared: false, enableLocalContextRefresh: true })) as any,
    // writeRefreshedAnchors intentionally omitted — skips the local-context-refresh branch.
    refreshTree: vi.fn(),
    getRepairQueue: () => null,
    debouncedCacheSync: vi.fn(),
  };
}

describe('anchor-resolution — batched tree refresh (SML-1497)', () => {
  beforeEach(() => {
    mockState.textDocuments = [];
    mockState.hasState = true;
    vi.clearAllMocks();
  });

  it('refreshes the tree once for multiple open documents, not once per document', async () => {
    mockState.textDocuments = [fakeDoc('file:///a.ts'), fakeDoc('file:///b.ts')];
    const deps = makeDeps();
    const { revalidateOpenDocuments } = createAnchorResolution(deps);

    await revalidateOpenDocuments();

    // Both docs were re-resolved...
    expect(deps.getAllBookmarksForUri).toHaveBeenCalledTimes(2);
    // ...but the tree was refreshed exactly once (the O(N) -> 1 fix).
    expect(deps.refreshTree).toHaveBeenCalledTimes(1);
  });

  it('onFileOpened still refreshes the tree when called directly', async () => {
    const deps = makeDeps();
    const { onFileOpened } = createAnchorResolution(deps);

    await onFileOpened(fakeDoc('file:///a.ts'));

    expect(deps.refreshTree).toHaveBeenCalledTimes(1);
  });

  it('onFileOpened with deferTreeRefresh:true does not refresh the tree', async () => {
    const deps = makeDeps();
    const { onFileOpened } = createAnchorResolution(deps);

    await onFileOpened(fakeDoc('file:///a.ts'), { deferTreeRefresh: true });

    expect(deps.refreshTree).not.toHaveBeenCalled();
  });

  it('revalidateOpenDocuments does not refresh when no open document has state', async () => {
    mockState.textDocuments = [fakeDoc('file:///a.ts'), fakeDoc('file:///b.ts')];
    mockState.hasState = false;
    const deps = makeDeps();
    const { revalidateOpenDocuments } = createAnchorResolution(deps);

    await revalidateOpenDocuments();

    expect(deps.getAllBookmarksForUri).not.toHaveBeenCalled();
    expect(deps.refreshTree).not.toHaveBeenCalled();
  });
});
