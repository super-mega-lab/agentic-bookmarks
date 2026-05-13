// ABOUTME: Tests for bookmark-selection pure helpers — buildLineSelections,
// ABOUTME: computeExpandedSelection, computeShrunkSelection. No vscode mocks.

import { describe, it, expect } from 'vitest';
import {
  buildLineSelections,
  computeExpandedSelection,
  computeShrunkSelection,
} from './bookmark-selection-helpers';
import type { VisibleBookmark } from './bookmark-jump-helpers';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function vb(overrides: Partial<VisibleBookmark> & { fileFsPath: string; line: number }): VisibleBookmark {
  return {
    bookmarkId: overrides.bookmarkId ?? 'b',
    fileFsPath: overrides.fileFsPath,
    fileAbsoluteUri: overrides.fileAbsoluteUri ?? `file://${overrides.fileFsPath}`,
    line: overrides.line,
    workspaceRoot: overrides.workspaceRoot ?? '/ws',
    dataFilePath: overrides.dataFilePath ?? 'shared/team.bookmarks.json',
    groupId: overrides.groupId ?? 'gA',
  };
}

const ACTIVE = '/ws/src/foo.ts';
const OTHER = '/ws/src/other.ts';

// ---------------------------------------------------------------------------
// buildLineSelections
// ---------------------------------------------------------------------------

describe('buildLineSelections', () => {
  it('empty bookmarks -> []', () => {
    expect(buildLineSelections([], ACTIVE)).toEqual([]);
  });

  it('single bookmark in active file -> one LineRange with endCharacter: -1', () => {
    const result = buildLineSelections([vb({ fileFsPath: ACTIVE, line: 10 })], ACTIVE);
    expect(result).toEqual([
      { startLine: 10, startCharacter: 0, endLine: 10, endCharacter: -1 },
    ]);
  });

  it('multiple bookmarks same file, unsorted input -> sorted ascending by line', () => {
    const bookmarks = [
      vb({ bookmarkId: 'b1', fileFsPath: ACTIVE, line: 20 }),
      vb({ bookmarkId: 'b2', fileFsPath: ACTIVE, line: 5 }),
      vb({ bookmarkId: 'b3', fileFsPath: ACTIVE, line: 12 }),
    ];
    const result = buildLineSelections(bookmarks, ACTIVE);
    expect(result.map(r => r.startLine)).toEqual([5, 12, 20]);
    // each is full-line: endCharacter -1 sentinel
    for (const r of result) {
      expect(r.startCharacter).toBe(0);
      expect(r.endCharacter).toBe(-1);
      expect(r.startLine).toBe(r.endLine);
    }
  });

  it('bookmarks in other files mixed in -> only active-file ones contribute', () => {
    const bookmarks = [
      vb({ bookmarkId: 'b1', fileFsPath: ACTIVE, line: 5 }),
      vb({ bookmarkId: 'b2', fileFsPath: OTHER, line: 10 }),
      vb({ bookmarkId: 'b3', fileFsPath: ACTIVE, line: 15 }),
      vb({ bookmarkId: 'b4', fileFsPath: OTHER, line: 20 }),
    ];
    const result = buildLineSelections(bookmarks, ACTIVE);
    expect(result.map(r => r.startLine)).toEqual([5, 15]);
  });

  it('duplicate lines -> de-duplicated to one LineRange', () => {
    const bookmarks = [
      vb({ bookmarkId: 'b1', fileFsPath: ACTIVE, line: 7 }),
      vb({ bookmarkId: 'b2', fileFsPath: ACTIVE, line: 7 }),
      vb({ bookmarkId: 'b3', fileFsPath: ACTIVE, line: 12 }),
    ];
    const result = buildLineSelections(bookmarks, ACTIVE);
    expect(result.map(r => r.startLine)).toEqual([7, 12]);
  });

  it('bookmark at line 0 -> returned as startLine: 0, endLine: 0, endCharacter: -1', () => {
    const result = buildLineSelections([vb({ fileFsPath: ACTIVE, line: 0 })], ACTIVE);
    expect(result).toEqual([
      { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: -1 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// computeExpandedSelection
// ---------------------------------------------------------------------------

describe('computeExpandedSelection', () => {
  it('direction=next, active before all bookmarks -> smallest line', () => {
    const bookmarks = [
      vb({ fileFsPath: ACTIVE, line: 10 }),
      vb({ fileFsPath: ACTIVE, line: 20 }),
    ];
    const result = computeExpandedSelection(
      bookmarks,
      ACTIVE,
      { anchorLine: 0, activeLine: 0 },
      'next',
    );
    expect(result).toEqual({ newActiveLine: 10 });
  });

  it('direction=next, active between two bookmarks -> next strictly after', () => {
    const bookmarks = [
      vb({ fileFsPath: ACTIVE, line: 10 }),
      vb({ fileFsPath: ACTIVE, line: 20 }),
      vb({ fileFsPath: ACTIVE, line: 30 }),
    ];
    const result = computeExpandedSelection(
      bookmarks,
      ACTIVE,
      { anchorLine: 5, activeLine: 15 },
      'next',
    );
    expect(result).toEqual({ newActiveLine: 20 });
  });

  it('direction=next, active exactly on a bookmark line -> bookmark AFTER', () => {
    const bookmarks = [
      vb({ fileFsPath: ACTIVE, line: 10 }),
      vb({ fileFsPath: ACTIVE, line: 20 }),
    ];
    const result = computeExpandedSelection(
      bookmarks,
      ACTIVE,
      { anchorLine: 5, activeLine: 10 },
      'next',
    );
    expect(result).toEqual({ newActiveLine: 20 });
  });

  it('direction=next, active after all bookmarks -> null', () => {
    const bookmarks = [
      vb({ fileFsPath: ACTIVE, line: 10 }),
      vb({ fileFsPath: ACTIVE, line: 20 }),
    ];
    const result = computeExpandedSelection(
      bookmarks,
      ACTIVE,
      { anchorLine: 0, activeLine: 100 },
      'next',
    );
    expect(result).toBeNull();
  });

  it('direction=prev, active after all bookmarks -> largest line', () => {
    const bookmarks = [
      vb({ fileFsPath: ACTIVE, line: 10 }),
      vb({ fileFsPath: ACTIVE, line: 20 }),
    ];
    const result = computeExpandedSelection(
      bookmarks,
      ACTIVE,
      { anchorLine: 100, activeLine: 100 },
      'prev',
    );
    expect(result).toEqual({ newActiveLine: 20 });
  });

  it('direction=prev, active exactly on a bookmark line -> bookmark BEFORE', () => {
    const bookmarks = [
      vb({ fileFsPath: ACTIVE, line: 10 }),
      vb({ fileFsPath: ACTIVE, line: 20 }),
    ];
    const result = computeExpandedSelection(
      bookmarks,
      ACTIVE,
      { anchorLine: 50, activeLine: 20 },
      'prev',
    );
    expect(result).toEqual({ newActiveLine: 10 });
  });

  it('direction=prev, active before all -> null', () => {
    const bookmarks = [
      vb({ fileFsPath: ACTIVE, line: 10 }),
      vb({ fileFsPath: ACTIVE, line: 20 }),
    ];
    const result = computeExpandedSelection(
      bookmarks,
      ACTIVE,
      { anchorLine: 0, activeLine: 0 },
      'prev',
    );
    expect(result).toBeNull();
  });

  it('bookmarks from other files in input -> filtered out', () => {
    const bookmarks = [
      vb({ fileFsPath: OTHER, line: 5 }),
      vb({ fileFsPath: ACTIVE, line: 10 }),
      vb({ fileFsPath: OTHER, line: 15 }),
    ];
    const result = computeExpandedSelection(
      bookmarks,
      ACTIVE,
      { anchorLine: 0, activeLine: 0 },
      'next',
    );
    expect(result).toEqual({ newActiveLine: 10 });
  });

  it('empty bookmarks -> null', () => {
    expect(
      computeExpandedSelection([], ACTIVE, { anchorLine: 0, activeLine: 0 }, 'next'),
    ).toBeNull();
    expect(
      computeExpandedSelection([], ACTIVE, { anchorLine: 0, activeLine: 0 }, 'prev'),
    ).toBeNull();
  });

  it('unsorted bookmark input -> result is correct (helper sorts defensively)', () => {
    const bookmarks = [
      vb({ fileFsPath: ACTIVE, line: 30 }),
      vb({ fileFsPath: ACTIVE, line: 10 }),
      vb({ fileFsPath: ACTIVE, line: 20 }),
    ];
    const next = computeExpandedSelection(
      bookmarks,
      ACTIVE,
      { anchorLine: 0, activeLine: 15 },
      'next',
    );
    expect(next).toEqual({ newActiveLine: 20 });
    const prev = computeExpandedSelection(
      bookmarks,
      ACTIVE,
      { anchorLine: 100, activeLine: 25 },
      'prev',
    );
    expect(prev).toEqual({ newActiveLine: 20 });
  });
});

// ---------------------------------------------------------------------------
// computeShrunkSelection
// ---------------------------------------------------------------------------

describe('computeShrunkSelection', () => {
  it('anchor==active (collapsed) -> null', () => {
    const bookmarks = [vb({ fileFsPath: ACTIVE, line: 10 })];
    const result = computeShrunkSelection(
      bookmarks,
      ACTIVE,
      { anchorLine: 5, activeLine: 5 },
    );
    expect(result).toBeNull();
  });

  it('anchor<active, intermediate bookmark exists -> largest intermediate', () => {
    const bookmarks = [
      vb({ fileFsPath: ACTIVE, line: 10 }),
      vb({ fileFsPath: ACTIVE, line: 15 }),
    ];
    const result = computeShrunkSelection(
      bookmarks,
      ACTIVE,
      { anchorLine: 5, activeLine: 20 },
    );
    expect(result).toEqual({ newActiveLine: 15 });
  });

  it('anchor>active, intermediate bookmark exists -> smallest intermediate', () => {
    const bookmarks = [
      vb({ fileFsPath: ACTIVE, line: 10 }),
      vb({ fileFsPath: ACTIVE, line: 15 }),
    ];
    const result = computeShrunkSelection(
      bookmarks,
      ACTIVE,
      { anchorLine: 20, activeLine: 5 },
    );
    expect(result).toEqual({ newActiveLine: 10 });
  });

  it('anchor<active, no intermediate -> collapse to anchor', () => {
    const bookmarks = [
      vb({ fileFsPath: ACTIVE, line: 100 }),
    ];
    const result = computeShrunkSelection(
      bookmarks,
      ACTIVE,
      { anchorLine: 5, activeLine: 20 },
    );
    expect(result).toEqual({ newActiveLine: 5 });
  });

  it('anchor>active, no intermediate -> collapse to anchor', () => {
    const bookmarks = [
      vb({ fileFsPath: ACTIVE, line: 100 }),
    ];
    const result = computeShrunkSelection(
      bookmarks,
      ACTIVE,
      { anchorLine: 20, activeLine: 5 },
    );
    expect(result).toEqual({ newActiveLine: 20 });
  });

  it('bookmark on anchor line is excluded from "intermediate" (strictly between)', () => {
    const bookmarks = [
      vb({ bookmarkId: 'onAnchor', fileFsPath: ACTIVE, line: 5 }),
      vb({ bookmarkId: 'mid', fileFsPath: ACTIVE, line: 12 }),
    ];
    // anchor=5 (also a bookmark line), active=20. Only line 12 qualifies.
    const result = computeShrunkSelection(
      bookmarks,
      ACTIVE,
      { anchorLine: 5, activeLine: 20 },
    );
    expect(result).toEqual({ newActiveLine: 12 });
  });

  it('bookmark on active line is excluded from "intermediate"', () => {
    const bookmarks = [
      vb({ bookmarkId: 'onActive', fileFsPath: ACTIVE, line: 20 }),
      vb({ bookmarkId: 'mid', fileFsPath: ACTIVE, line: 12 }),
    ];
    // anchor=5, active=20 (also a bookmark line). Only line 12 qualifies.
    const result = computeShrunkSelection(
      bookmarks,
      ACTIVE,
      { anchorLine: 5, activeLine: 20 },
    );
    expect(result).toEqual({ newActiveLine: 12 });
  });
});
