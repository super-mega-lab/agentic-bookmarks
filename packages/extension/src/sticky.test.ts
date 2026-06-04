// ABOUTME: Regression test for sticky.ts processing buffered edits across coordinate spaces (SML-1539) —
// ABOUTME: each buffered source event's changes must read against THAT event's own document snapshot,
// ABOUTME: not the final document text, so the correct lineCache is persisted for multi-edit bursts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

vi.mock('@agentic-bookmarks/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentic-bookmarks/core')>();
  return {
    ...actual,
    // Fake ONLY the registry / file-I/O boundary — these would otherwise hit the real
    // filesystem (the legitimate ceiling-4 boundary). Everything else runs for real:
    // updateAnchorLineCache, dispatchByAnchorType, and classifyAnchorStatus come straight
    // from core, so the per-event snapshot logic and the anchor-update contract (including
    // the nonce increment) are exercised end-to-end. Previously updateAnchorLineCache was
    // hand-mocked and silently dropped the nonce bump — a mock defining the contract it was
    // supposed to verify. Using importOriginal instead of an inline copy means the test
    // tracks core's real behavior and can't drift from it.
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
  };
});

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

// Drive the 150ms debounce deterministically under fake timers (advanceTimersByTimeAsync
// flushes the async readRegistry/readFileV2/editFileV2 microtasks between timer ticks).
const settle = () => vi.advanceTimersByTimeAsync(200);

// Build a 20-line document body (L0..L19) so a few touched lines stay within the
// 'micro' lane (touchedRatio <= 0.2, maxSingleChangeRatio <= 0.3) — small files
// would tip a single edit into the 'bulk' lane and skip the smart anchor.
const baseLines = Array.from({ length: 20 }, (_, i) => `L${i}`);

describe('sticky — per-event snapshot for buffered edits (SML-1539)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    hoisted.handlers.length = 0;
    editWrites = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
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
    // The REAL updateAnchorLineCache produced this anchor: the event-1 snapshot's line 5,
    // its line number, and a bumped nonce ((undefined ?? 0) + 1). The old hand mock dropped
    // the nonce — asserting it here proves the real core function ran.
    expect(persisted.anchor.lineCache).toBe('NEW5');
    expect(persisted.anchor.lastUpdatedLine).toBe(5);
    expect(persisted.anchor.nonce).toBe(1);
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
    // The single in-place edit also runs the real update: line number preserved, nonce bumped.
    expect(persisted.anchor.lastUpdatedLine).toBe(5);
    expect(persisted.anchor.nonce).toBe(1);
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

describe('sticky — multi-change-per-event (SML-1539 residual)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    hoisted.handlers.length = 0;
    editWrites = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshes each anchor from its OWN change when one event carries 2 in-place edits (multi-cursor)', async () => {
    // A single source event carrying 2 content changes (multi-cursor edit, or a
    // find/replace-all of equal-length text → delta 0 per change). Each anchored
    // line must pick up its OWN line's new content, with no cross-contamination
    // between the two changes processed under the shared per-event snapshot.
    // (The line-count-shifting intra-event case — where applyEditDelta advances
    // resolvedLine between changes while the snapshot stays fixed — remains a known
    // residual limitation and is intentionally not asserted here.)
    const uri = 'file:///w/mc.ts';
    bookmarksFile = {
      version: 2,
      bookmarks: [
        { id: 'b1', target: { uri }, anchor: { kind: 'smart', lineCache: 'OLD5', lastUpdatedLine: 5 } },
        { id: 'b2', target: { uri }, anchor: { kind: 'smart', lineCache: 'OLD10', lastUpdatedLine: 10 } },
      ],
    };
    initStateForFile(uri, [
      { anchorId: 'b1', resolved: true, line: 5, score: 1 } as any,
      { anchorId: 'b2', resolved: true, line: 10, score: 1 } as any,
    ]);

    registerStickyHandler(makeDeps());

    // Post-event snapshot: both edits already applied (onDidChangeTextDocument fires
    // after the document is updated). Lines 5 and 10 changed in place (delta 0).
    const snap = [...baseLines];
    snap[5] = 'NEW5';
    snap[10] = 'NEW10';
    // VS Code reports a multi-edit event's changes in descending position order
    // (bottom-most first); their ranges are all in the pre-event coordinate space.
    fireEvent(uri, snap.join('\n'), [
      { range: { start: { line: 10, character: 0 }, end: { line: 10, character: 3 } }, text: 'NEW10' },
      { range: { start: { line: 5, character: 0 }, end: { line: 5, character: 2 } }, text: 'NEW5' },
    ]);

    await settle();

    expect(editWrites.length).toBeGreaterThan(0);
    const persisted = editWrites[editWrites.length - 1];
    expect(persisted.find((b: any) => b.id === 'b1').anchor.lineCache).toBe('NEW5');
    expect(persisted.find((b: any) => b.id === 'b2').anchor.lineCache).toBe('NEW10');
  });

  it('does not mutate an anchor when none of an event\'s multiple changes are within its radius', async () => {
    // Multi-change event whose changes all land far from the anchor (±radius = 1) →
    // the line_not_touched guard must hold for every change in the event, so nothing
    // is written.
    const uri = 'file:///w/mc2.ts';
    bookmarksFile = {
      version: 2,
      bookmarks: [
        { id: 'b1', target: { uri }, anchor: { kind: 'smart', lineCache: 'OLD', lastUpdatedLine: 10 } },
      ],
    };
    initStateForFile(uri, [{ anchorId: 'b1', resolved: true, line: 10, score: 1 } as any]);

    registerStickyHandler(makeDeps());

    const snap = [...baseLines];
    snap[2] = 'X';
    snap[3] = 'Y';
    fireEvent(uri, snap.join('\n'), [
      { range: { start: { line: 3, character: 0 }, end: { line: 3, character: 2 } }, text: 'Y' },
      { range: { start: { line: 2, character: 0 }, end: { line: 2, character: 2 } }, text: 'X' },
    ]);

    await settle();

    expect(editWrites.length).toBe(0);
  });
});
