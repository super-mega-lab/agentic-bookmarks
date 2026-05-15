// ABOUTME: Tests for clear-bookmarks-helpers - pure helpers that partition
// ABOUTME: bookmarks for bulk-clear and match a bookmark to the active file.

import { describe, it, expect } from 'vitest';
import type { BookmarksFileV2 } from '@agentic-bookmarks/core';
import {
  partitionBookmarksForClear,
  bookmarkMatchesActiveFile,
} from './clear-bookmarks-helpers';

const WS = '/ws';
const TARGET_FS = '/ws/src/foo.ts';
const REL_URI = 'src/foo.ts';

function bookmark(overrides: Partial<{
  id: string;
  groupId: string;
  uri: string;
  anchor: any;
  label: string;
}>): any {
  return {
    id: overrides.id ?? 'b1',
    fileId: 'f1',
    groupId: overrides.groupId ?? 'gA',
    target: { uri: overrides.uri ?? REL_URI },
    anchor: overrides.anchor ?? { kind: 'point', line: 5 },
    label: overrides.label ?? '',
    createdAt: 0,
    createdBy: 'test',
    source: 'test',
    tags: [],
  };
}

function makeFile(bookmarks: any[]): BookmarksFileV2 {
  return {
    schemaVersion: 2,
    fileId: 'f1',
    groups: [{ id: 'gA', name: 'A' }],
    bookmarks,
  } as any;
}

describe('partitionBookmarksForClear', () => {
  it('returns all empty for empty file', () => {
    const result = partitionBookmarksForClear(makeFile([]), () => true);
    expect(result.kept).toEqual([]);
    expect(result.cleared).toEqual([]);
    expect(result.tagAnchorsToRemove).toEqual([]);
  });

  it('predicate matches none → all kept, no cleared, no tag entries', () => {
    const bookmarks = [
      bookmark({ id: 'b1', anchor: { kind: 'point', line: 5 } }),
      bookmark({ id: 'b2', anchor: { kind: 'point', line: 10 } }),
    ];
    const result = partitionBookmarksForClear(makeFile(bookmarks), () => false);
    expect(result.kept.map((b: any) => b.id)).toEqual(['b1', 'b2']);
    expect(result.cleared).toEqual([]);
    expect(result.tagAnchorsToRemove).toEqual([]);
  });

  it('predicate matches all → all cleared, none kept', () => {
    const bookmarks = [
      bookmark({ id: 'b1', anchor: { kind: 'point', line: 5 } }),
      bookmark({ id: 'b2', anchor: { kind: 'point', line: 10 } }),
    ];
    const result = partitionBookmarksForClear(makeFile(bookmarks), () => true);
    expect(result.kept).toEqual([]);
    expect(result.cleared.map((b: any) => b.id)).toEqual(['b1', 'b2']);
    expect(result.tagAnchorsToRemove).toEqual([]);
  });

  it('mixed point/range/smart anchors produce no tag entries', () => {
    const bookmarks = [
      bookmark({ id: 'b1', anchor: { kind: 'point', line: 5 } }),
      bookmark({
        id: 'b2',
        anchor: { kind: 'range', start: { line: 3 }, end: { line: 7 } },
      }),
      bookmark({
        id: 'b3',
        anchor: {
          kind: 'smart',
          lineCache: '',
          contextBefore: [],
          contextAfter: [],
          lastUpdatedLine: 9,
          nonce: 0,
        },
      }),
    ];
    const result = partitionBookmarksForClear(makeFile(bookmarks), () => true);
    expect(result.cleared.map((b: any) => b.id)).toEqual(['b1', 'b2', 'b3']);
    expect(result.tagAnchorsToRemove).toEqual([]);
  });

  it('tag anchor recorded with correct sourceUri, line, and tagId', () => {
    const bookmarks = [
      bookmark({
        id: 'b1',
        uri: REL_URI,
        anchor: {
          kind: 'tag',
          tagId: 't1',
          lastUpdatedLine: 12,
          nonce: 0,
        },
      }),
    ];
    const result = partitionBookmarksForClear(makeFile(bookmarks), () => true);
    expect(result.tagAnchorsToRemove).toHaveLength(1);
    expect(result.tagAnchorsToRemove[0]).toEqual({
      sourceUri: REL_URI,
      line: 12,
      tagId: 't1',
    });
  });

  it('tag anchor in kept bookmark does NOT produce an entry', () => {
    const bookmarks = [
      bookmark({
        id: 'b1',
        anchor: {
          kind: 'tag',
          tagId: 't1',
          lastUpdatedLine: 12,
          nonce: 0,
        },
      }),
    ];
    const result = partitionBookmarksForClear(makeFile(bookmarks), () => false);
    expect(result.kept.map((b: any) => b.id)).toEqual(['b1']);
    expect(result.cleared).toEqual([]);
    expect(result.tagAnchorsToRemove).toEqual([]);
  });

  it('preserves bookmark order in kept', () => {
    const bookmarks = [
      bookmark({ id: 'b1', anchor: { kind: 'point', line: 1 } }),
      bookmark({ id: 'b2', anchor: { kind: 'point', line: 2 } }),
      bookmark({ id: 'b3', anchor: { kind: 'point', line: 3 } }),
      bookmark({ id: 'b4', anchor: { kind: 'point', line: 4 } }),
    ];
    // Predicate clears the middle two; outer two are kept in original order.
    const result = partitionBookmarksForClear(makeFile(bookmarks), (b: any) =>
      b.id === 'b2' || b.id === 'b3'
    );
    expect(result.kept.map((b: any) => b.id)).toEqual(['b1', 'b4']);
    expect(result.cleared.map((b: any) => b.id)).toEqual(['b2', 'b3']);
  });
});

describe('bookmarkMatchesActiveFile', () => {
  it('matches workspace-relative URI', () => {
    const b = bookmark({ uri: 'src/foo.ts' });
    expect(bookmarkMatchesActiveFile(b, TARGET_FS, WS)).toBe(true);
  });

  it('matches file:// URI', () => {
    const b = bookmark({ uri: 'file:///ws/src/foo.ts' });
    expect(bookmarkMatchesActiveFile(b, TARGET_FS, WS)).toBe(true);
  });

  it('strips #L123 fragment before comparison', () => {
    const b = bookmark({ uri: 'src/foo.ts#L42' });
    expect(bookmarkMatchesActiveFile(b, TARGET_FS, WS)).toBe(true);
  });

  it('returns false for a different file', () => {
    const b = bookmark({ uri: 'src/other.ts' });
    expect(bookmarkMatchesActiveFile(b, TARGET_FS, WS)).toBe(false);
  });
});
