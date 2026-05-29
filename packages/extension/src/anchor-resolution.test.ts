// ABOUTME: Unit tests for revalidateOpenDocuments / onFileOpened in anchor-resolution.ts — the
// ABOUTME: bulk re-resolve refreshes the bookmarks tree ONCE not once per open document (SML-1497),
// ABOUTME: and a single failing document must NOT abort the loop or escape onFileOpened (SML-1495/1500).

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
import { hasStateForFile } from './anchorState';

describe('anchor-resolution — batched tree refresh (SML-1497)', () => {
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

describe('anchor-resolution — revalidateOpenDocuments resilience (SML-1495)', () => {
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

  beforeEach(() => {
    mockState.textDocuments = [];
    mockState.hasState = true;
    vi.clearAllMocks();
  });

  it('continues revalidating remaining documents when onFileOpened throws for one', async () => {
    mockState.textDocuments = [makeDoc('file:///bad.ts'), makeDoc('file:///good.ts')];
    const deps = makeDeps();
    const { revalidateOpenDocuments } = createAnchorResolution(deps);

    await expect(revalidateOpenDocuments()).resolves.toBeUndefined();

    expect(deps.getAllBookmarksForUri).toHaveBeenCalledTimes(2);
    expect(deps.getAllBookmarksForUri).toHaveBeenCalledWith('file:///bad.ts', '/ws');
    expect(deps.getAllBookmarksForUri).toHaveBeenCalledWith('file:///good.ts', '/ws');
  });

  it('logs the failing document URI and error via log.error', async () => {
    mockState.textDocuments = [makeDoc('file:///bad.ts'), makeDoc('file:///good.ts')];
    const deps = makeDeps();
    const { revalidateOpenDocuments } = createAnchorResolution(deps);

    await revalidateOpenDocuments();

    expect(deps.log.error).toHaveBeenCalledTimes(1);
    const msg = (deps.log.error as any).mock.calls[0][0] as string;
    expect(msg).toContain('file:///bad.ts');
    expect(msg).toContain('boom');
  });

  it('revalidates every stateful open document when none throw', async () => {
    mockState.textDocuments = [makeDoc('file:///good1.ts'), makeDoc('file:///good2.ts')];
    const deps = makeDeps();
    const { revalidateOpenDocuments } = createAnchorResolution(deps);

    await revalidateOpenDocuments();

    expect(deps.getAllBookmarksForUri).toHaveBeenCalledTimes(2);
    expect(deps.log.error).not.toHaveBeenCalled();
  });

  it('resolves without throwing when the only open document fails', async () => {
    mockState.textDocuments = [makeDoc('file:///bad.ts')];
    const deps = makeDeps();
    const { revalidateOpenDocuments } = createAnchorResolution(deps);

    await expect(revalidateOpenDocuments()).resolves.toBeUndefined();
    expect(deps.log.error).toHaveBeenCalledTimes(1);
  });
});

describe('anchor-resolution — onFileOpened never-throw guard (SML-1500)', () => {
  function makeDeps(): AnchorResolutionDeps {
    return {
      workspaceRoot: '/ws',
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() } as any,
      // Empty bookmark list -> onFileOpened takes its early return after this call.
      getAllBookmarksForUri: vi.fn(async () => []),
      getResolutionOptions: vi.fn(async () => ({} as any)),
      refreshTree: vi.fn(),
      getRepairQueue: () => null,
      debouncedCacheSync: vi.fn(),
    };
  }

  beforeEach(() => {
    mockState.textDocuments = [];
    mockState.hasState = true;
    vi.clearAllMocks();
    // clearAllMocks keeps implementations; restore the default so a per-test
    // override below cannot leak into a later test.
    vi.mocked(hasStateForFile).mockImplementation(() => mockState.hasState);
  });

  it('swallows and logs (does not throw) when getText() throws', async () => {
    const deps = makeDeps();
    const { onFileOpened } = createAnchorResolution(deps);
    const doc = {
      uri: { scheme: 'file', toString: () => 'file:///gone.ts', fsPath: '/gone.ts' },
      getText: () => { throw new Error('document disposed'); },
    } as any;

    // The throw must be caught inside onFileOpened, not propagate to the caller
    // (startup scan / open / active / save / revalidate loop) — SML-1500.
    await expect(onFileOpened(doc)).resolves.toBeUndefined();

    expect(deps.log.error).toHaveBeenCalledTimes(1);
    const msg = (deps.log.error as any).mock.calls[0][0] as string;
    expect(msg).toContain('file:///gone.ts');
    expect(msg).toContain('document disposed');
    // It threw before reaching the tree refresh.
    expect(deps.refreshTree).not.toHaveBeenCalled();
  });

  it('ignores non-file-scheme documents (early return before the guarded body)', async () => {
    const deps = makeDeps();
    const { onFileOpened } = createAnchorResolution(deps);
    const doc = {
      uri: { scheme: 'untitled', toString: () => 'untitled:Untitled-1' },
      getText: () => 'x',
    } as any;

    await onFileOpened(doc);

    expect(deps.getAllBookmarksForUri).not.toHaveBeenCalled();
    expect(deps.refreshTree).not.toHaveBeenCalled();
    expect(deps.log.error).not.toHaveBeenCalled();
  });

  it('revalidateOpenDocuments skips non-file-scheme documents', async () => {
    mockState.textDocuments = [
      { uri: { scheme: 'untitled', toString: () => 'untitled:Untitled-1' }, getText: () => 'x' } as any,
    ];
    const deps = makeDeps();
    const { revalidateOpenDocuments } = createAnchorResolution(deps);

    await revalidateOpenDocuments();

    expect(deps.getAllBookmarksForUri).not.toHaveBeenCalled();
    expect(deps.refreshTree).not.toHaveBeenCalled();
  });

  it('revalidateOpenDocuments skips documents that have no in-memory state', async () => {
    mockState.textDocuments = [
      { uri: { scheme: 'file', toString: () => 'file:///stateful.ts' }, getText: () => '' } as any,
      { uri: { scheme: 'file', toString: () => 'file:///stateless.ts' }, getText: () => '' } as any,
    ];
    vi.mocked(hasStateForFile).mockImplementation((uri: string) => uri === 'file:///stateful.ts');
    const deps = makeDeps();
    const { revalidateOpenDocuments } = createAnchorResolution(deps);

    await revalidateOpenDocuments();

    // Only the stateful document was re-resolved; the stateless one was skipped.
    expect(deps.getAllBookmarksForUri).toHaveBeenCalledTimes(1);
    expect(deps.getAllBookmarksForUri).toHaveBeenCalledWith('file:///stateful.ts', '/ws');
  });
});
