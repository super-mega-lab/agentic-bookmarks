// ABOUTME: Regression test for sticky.ts processing buffered edits across coordinate spaces (SML-1539) —
// ABOUTME: each buffered source event's changes must read against THAT event's own document snapshot,
// ABOUTME: not the final document text, so the correct lineCache is persisted for multi-edit bursts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mutable mock state, hoisted so the vi.mock factories below can read it safely.
const hoisted = vi.hoisted(() => ({
  handlers: [] as any[],
}));

// Shared mutable fixtures controlled per-test (declared here so the core mock can close over them).
let bookmarksFile: any;
let editWrites: any[] = [];

vi.mock('vscode', () => ({
  workspace: {
    onDidChangeTextDocument: (handler: any) => {
      hoisted.handlers.push(handler);
      return { dispose() {} };
    },
    getConfiguration: (_section: string) => ({
      get: (_key: string, dflt: any) => dflt,
    }),
  },
  Uri: {
    parse: (s: string) => ({ fsPath: s.replace('file://', ''), toString: () => s }),
  },
}));

vi.mock('@agentic-bookmarks/core', () => ({
  readRegistry: vi.fn(async () => ({
    settings: {},
    files: [{ path: 'shared/bookmarks.json', enabled: true }],
  })),
  getBookmarksDataRoot: vi.fn(() => '/w/.bookmarks'),
  pathsForDataFile: vi.fn(() => ({
    data: '/w/.bookmarks/shared/bookmarks.json',
    pulse: '/w/.bookmarks/local/pulse/shared.pulse',
  })),
  readFileV2: vi.fn(async () => bookmarksFile),
  editFileV2: vi.fn(async (_p: any, fn: any) => {
    fn(bookmarksFile);
    editWrites.push(JSON.parse(JSON.stringify(bookmarksFile.bookmarks)));
  }),
  workspaceRelativeToUri: vi.fn((p: string) => p),
  resolveAnchors: vi.fn(() => []),
  updateAnchorForEdit: vi.fn((anchor: any) => anchor),
  updateAnchorLineCache: vi.fn((anchor: any, line: number, lineCache: string) => ({
    ...anchor,
    lineCache,
    lastUpdatedLine: line,
  })),
  dispatchByAnchorType: vi.fn((anchor: any, handlers: any) => handlers[anchor.kind]?.(anchor)),
  // The REAL ./anchorState imports classifyAnchorStatus from core; the mock must provide it.
  classifyAnchorStatus: vi.fn(() => 'valid'),
}));

import { registerStickyHandler, type StickyDeps } from './sticky';
import { initStateForFile } from './anchorState';

function makeDeps(): StickyDeps {
  return {
    workspaceRoot: '/w',
    log: { debug() {}, info() {}, warn() {}, error() {}, trace() {} } as any,
    updateDecorations: vi.fn(async () => {}),
    getLineCacheLength: () => 200,
    refreshTree: vi.fn(),
    markEdited: vi.fn(),
  };
}

// Fire the captured onDidChangeTextDocument handler with a fake event whose
// document snapshot text and content changes are caller-controlled.
function fireEvent(uri: string, snapshotText: string, contentChanges: any[]): void {
  const handler = hoisted.handlers[hoisted.handlers.length - 1];
  handler({
    document: {
      uri: { scheme: 'file', toString: () => uri, fsPath: uri.replace('file://', '') },
      getText: () => snapshotText,
    },
    contentChanges,
  });
}

const settle = () => new Promise((r) => setTimeout(r, 220));

// Build a 20-line document body (L0..L19) so a few touched lines stay within the
// 'micro' lane (touchedRatio <= 0.2, maxSingleChangeRatio <= 0.3) — small files
// would tip a single edit into the 'bulk' lane and skip the smart anchor.
const baseLines = Array.from({ length: 20 }, (_, i) => `L${i}`);

describe('sticky — per-event snapshot for buffered edits (SML-1539)', () => {
  beforeEach(() => {
    hoisted.handlers.length = 0;
    editWrites = [];
    vi.clearAllMocks();
  });

  it('persists the correct lineCache when 2 edits land in one debounce window', async () => {
    // AC1 — the multi-event coordinate-space repro. Anchor at line 5.
    const uri = 'file:///w/a.ts';
    bookmarksFile = {
      version: 2,
      bookmarks: [
        { id: 'b1', target: { uri }, anchor: { kind: 'smart', lineCache: 'OLD', lastUpdatedLine: 5 } },
      ],
    };
    initStateForFile(uri, [{ anchorId: 'b1', resolved: true, line: 5, score: 1 } as any]);

    registerStickyHandler(makeDeps());

    // Event 1: edits line 5 in place (delta 0); line 5 of THIS snapshot is 'NEW5'.
    const s1 = [...baseLines];
    s1[5] = 'NEW5';
    fireEvent(uri, s1.join('\n'), [
      { range: { start: { line: 5, character: 0 }, end: { line: 5, character: 2 } }, text: 'NEW5' },
    ]);
    // Event 2: inserts a line at the top (delta +1). In the FINAL snapshot, line 5 is 'L4'
    // (everything shifted down by one). The inserted range (lines 0-1) is beyond the
    // anchor's ±radius, so event 2 must not touch the anchor.
    const s2 = ['INS', ...s1];
    fireEvent(uri, s2.join('\n'), [
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: 'INS\n' },
    ]);

    await settle();

    // buggy code persists 'L4' (final snapshot line 5); fixed code persists 'NEW5' (event-1 snapshot line 5)
    expect(editWrites.length).toBeGreaterThan(0);
    const persisted = editWrites[editWrites.length - 1].find((b: any) => b.id === 'b1');
    expect(persisted.anchor.lineCache).toBe('NEW5');
  });

  it('refreshes lineCache on a single in-place edit', async () => {
    // AC2 — common single-event path stays identical.
    const uri = 'file:///w/b.ts';
    bookmarksFile = {
      version: 2,
      bookmarks: [
        { id: 'b1', target: { uri }, anchor: { kind: 'smart', lineCache: 'OLD', lastUpdatedLine: 5 } },
      ],
    };
    initStateForFile(uri, [{ anchorId: 'b1', resolved: true, line: 5, score: 1 } as any]);

    registerStickyHandler(makeDeps());

    const s1 = [...baseLines];
    s1[5] = 'GREEN';
    fireEvent(uri, s1.join('\n'), [
      { range: { start: { line: 5, character: 0 }, end: { line: 5, character: 2 } }, text: 'GREEN' },
    ]);

    await settle();

    expect(editWrites.length).toBeGreaterThan(0);
    const persisted = editWrites[editWrites.length - 1].find((b: any) => b.id === 'b1');
    expect(persisted.anchor.lineCache).toBe('GREEN');
  });

  it('does not mutate an anchor whose line was not touched', async () => {
    // AC2 — guards still skip untouched anchors.
    const uri = 'file:///w/c.ts';
    bookmarksFile = {
      version: 2,
      bookmarks: [
        { id: 'b1', target: { uri }, anchor: { kind: 'smart', lineCache: 'OLD', lastUpdatedLine: 12 } },
      ],
    };
    initStateForFile(uri, [{ anchorId: 'b1', resolved: true, line: 12, score: 1 } as any]);

    registerStickyHandler(makeDeps());

    // Two events touching only lines 0 and 1 — far from the anchor at line 12 (beyond ±radius).
    const e1 = [...baseLines];
    e1[0] = 'X';
    fireEvent(uri, e1.join('\n'), [
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } }, text: 'X' },
    ]);
    const e2 = [...e1];
    e2[1] = 'Y';
    fireEvent(uri, e2.join('\n'), [
      { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 2 } }, text: 'Y' },
    ]);

    await settle();

    expect(editWrites.length).toBe(0);
  });
});
