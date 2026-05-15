import { describe, it, expect } from 'vitest';
import type { BookmarkAnchor } from '@agentic-bookmarks/core';
import { toInternal, toWire, anchorToInternal, anchorToWire } from './line-basis';

describe('line-basis', () => {
  it('toInternal subtracts 1 (wire 1-based -> internal 0-based)', () => {
    expect(toInternal(1)).toBe(0);
    expect(toInternal(13)).toBe(12);
    expect(toInternal(100)).toBe(99);
  });

  it('toWire adds 1 (internal 0-based -> wire 1-based)', () => {
    expect(toWire(0)).toBe(1);
    expect(toWire(12)).toBe(13);
    expect(toWire(99)).toBe(100);
  });

  it('round-trips: toWire(toInternal(N)) === N for any positive N', () => {
    for (const n of [1, 2, 13, 100, 999]) {
      expect(toWire(toInternal(n))).toBe(n);
    }
  });

  it('round-trips: toInternal(toWire(N)) === N for any non-negative N', () => {
    for (const n of [0, 1, 12, 99, 998]) {
      expect(toInternal(toWire(n))).toBe(n);
    }
  });

  // Regression test for the editor-line-agreement bug:
  // grep -n shows "13: foo" => agent passes newLine: 13 => internal must be 12
  // so that VS Code's 0-based Range(12,...) renders at editor row 13.
  it('matches grep -n / editor convention: line "13" on the wire -> internal index 12', () => {
    const editorVisibleLine = 13;
    const internalIndex = toInternal(editorVisibleLine);
    expect(internalIndex).toBe(12);
    // The reverse — what the wire returns when storage holds index 12 — is "13" on screen.
    expect(toWire(internalIndex)).toBe(editorVisibleLine);
  });
});

describe('anchorToInternal / anchorToWire', () => {
  it('round-trips a point anchor (no lastUpdatedLine)', () => {
    const wire: BookmarkAnchor = { kind: 'point', line: 13 };
    const internal = anchorToInternal(wire);
    expect(internal).toEqual({ kind: 'point', line: 12 });
    expect(anchorToWire(internal)).toEqual(wire);
  });

  it('round-trips a point anchor with column, lineCache, lastUpdatedLine', () => {
    const wire: BookmarkAnchor = {
      kind: 'point',
      line: 13,
      column: 4,
      lineCache: 'foo',
      lastUpdatedLine: 13,
      nonce: 0,
    };
    const internal = anchorToInternal(wire);
    expect(internal.kind).toBe('point');
    if (internal.kind !== 'point') throw new Error('unreachable');
    expect(internal.line).toBe(12);
    expect(internal.column).toBe(4); // column untouched
    expect(internal.lineCache).toBe('foo'); // lineCache untouched
    expect(internal.lastUpdatedLine).toBe(12);
    expect(internal.nonce).toBe(0);
    expect(anchorToWire(internal)).toEqual(wire);
  });

  it('round-trips a range anchor', () => {
    const wire: BookmarkAnchor = {
      kind: 'range',
      start: { line: 5, column: 2 },
      end: { line: 10, column: 8 },
      lineCache: 'header',
      lastUpdatedLine: 5,
      nonce: 0,
    };
    const internal = anchorToInternal(wire);
    expect(internal.kind).toBe('range');
    if (internal.kind !== 'range') throw new Error('unreachable');
    expect(internal.start.line).toBe(4);
    expect(internal.start.column).toBe(2); // column untouched
    expect(internal.end.line).toBe(9);
    expect(internal.end.column).toBe(8); // column untouched
    expect(internal.lineCache).toBe('header');
    expect(internal.lastUpdatedLine).toBe(4);
    expect(anchorToWire(internal)).toEqual(wire);
  });

  it('round-trips a smart anchor', () => {
    const wire: BookmarkAnchor = {
      kind: 'smart',
      lineCache: 'function foo()',
      contextBefore: ['// before1', '// before2'],
      contextAfter: ['// after1'],
      lastUpdatedLine: 42,
      nonce: 0,
    };
    const internal = anchorToInternal(wire);
    expect(internal.kind).toBe('smart');
    if (internal.kind !== 'smart') throw new Error('unreachable');
    expect(internal.lastUpdatedLine).toBe(41);
    expect(internal.lineCache).toBe('function foo()'); // untouched
    expect(internal.contextBefore).toEqual(['// before1', '// before2']); // untouched
    expect(internal.contextAfter).toEqual(['// after1']); // untouched
    expect(anchorToWire(internal)).toEqual(wire);
  });

  it('round-trips a tag anchor', () => {
    const wire: BookmarkAnchor = {
      kind: 'tag',
      tagId: 'abc123',
      lastUpdatedLine: 7,
      nonce: 0,
    };
    const internal = anchorToInternal(wire);
    expect(internal.kind).toBe('tag');
    if (internal.kind !== 'tag') throw new Error('unreachable');
    expect(internal.lastUpdatedLine).toBe(6);
    expect(internal.tagId).toBe('abc123'); // untouched
    expect(anchorToWire(internal)).toEqual(wire);
  });

  it('preserves all non-line fields untouched (no accidental mutation)', () => {
    // A smart anchor with extras (instanceIndex, duplicateCount, blankLineOffset)
    const wire: BookmarkAnchor = {
      kind: 'smart',
      lineCache: 'x',
      contextBefore: [],
      contextAfter: [],
      lastUpdatedLine: 1,
      nonce: 5,
      blankLineOffset: 2,
      instanceIndex: 1,
      duplicateCount: 3,
    };
    const internal = anchorToInternal(wire);
    if (internal.kind !== 'smart') throw new Error('unreachable');
    expect(internal.nonce).toBe(5);
    expect(internal.blankLineOffset).toBe(2);
    expect(internal.instanceIndex).toBe(1);
    expect(internal.duplicateCount).toBe(3);
    expect(anchorToWire(internal)).toEqual(wire);
  });

  it('does not mutate the input', () => {
    const wire: BookmarkAnchor = { kind: 'point', line: 13 };
    const before = JSON.stringify(wire);
    anchorToInternal(wire);
    expect(JSON.stringify(wire)).toBe(before);
  });
});
