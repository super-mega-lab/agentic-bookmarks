// ABOUTME: Tests for findBookmarksOnLineMatching - pure helper that locates
// ABOUTME: bookmarks at a given line in a BookmarksFileV2, with optional visibility filter.

import { describe, it, expect } from 'vitest';
import type { BookmarksFileV2 } from '@agentic-bookmarks/core';
import { findBookmarksOnLineMatching } from './find-bookmarks-on-line';

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
    groups: [{ id: 'gA', name: 'A' }, { id: 'gB', name: 'B' }, { id: 'gC', name: 'C' }],
    bookmarks,
  } as any;
}

describe('findBookmarksOnLineMatching', () => {
  it('returns empty for empty file', () => {
    const result = findBookmarksOnLineMatching(makeFile([]), {
      fsPath: TARGET_FS,
      workspaceRoot: WS,
      line: 5,
    });
    expect(result).toEqual([]);
  });

  it('matches a point anchor on the requested line', () => {
    const result = findBookmarksOnLineMatching(
      makeFile([bookmark({ id: 'b1', anchor: { kind: 'point', line: 5 } })]),
      { fsPath: TARGET_FS, workspaceRoot: WS, line: 5 }
    );
    expect(result.map(r => r.bookmarkId)).toEqual(['b1']);
    expect(result[0].anchorKind).toBe('point');
    // tagId/tagLine are tag-specific; must be undefined for non-tag matches
    expect(result[0].tagId).toBeUndefined();
    expect(result[0].tagLine).toBeUndefined();
  });

  it('does not match a point anchor on a different line', () => {
    const result = findBookmarksOnLineMatching(
      makeFile([bookmark({ id: 'b1', anchor: { kind: 'point', line: 5 } })]),
      { fsPath: TARGET_FS, workspaceRoot: WS, line: 6 }
    );
    expect(result).toEqual([]);
  });

  it('matches a range anchor by start.line', () => {
    const result = findBookmarksOnLineMatching(
      makeFile([
        bookmark({ id: 'b1', anchor: { kind: 'range', start: { line: 5 }, end: { line: 8 } } }),
      ]),
      { fsPath: TARGET_FS, workspaceRoot: WS, line: 5 }
    );
    expect(result.map(r => r.bookmarkId)).toEqual(['b1']);
    expect(result[0].tagId).toBeUndefined();
    expect(result[0].tagLine).toBeUndefined();
  });

  it('does not match a range anchor by lines inside the range (only start.line)', () => {
    const result = findBookmarksOnLineMatching(
      makeFile([
        bookmark({ id: 'b1', anchor: { kind: 'range', start: { line: 5 }, end: { line: 8 } } }),
      ]),
      { fsPath: TARGET_FS, workspaceRoot: WS, line: 6 }
    );
    expect(result).toEqual([]);
  });

  it('matches a tag anchor by lastUpdatedLine and surfaces tagId/tagLine', () => {
    const result = findBookmarksOnLineMatching(
      makeFile([
        bookmark({
          id: 'b1',
          anchor: { kind: 'tag', tagId: 'TAG123', lastUpdatedLine: 5, nonce: 0 },
        }),
      ]),
      { fsPath: TARGET_FS, workspaceRoot: WS, line: 5 }
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      bookmarkId: 'b1',
      anchorKind: 'tag',
      tagId: 'TAG123',
      tagLine: 5,
    });
  });

  it('matches a smart anchor by lastUpdatedLine', () => {
    const result = findBookmarksOnLineMatching(
      makeFile([
        bookmark({
          id: 'b1',
          anchor: {
            kind: 'smart',
            lineCache: '',
            contextBefore: [],
            contextAfter: [],
            lastUpdatedLine: 5,
            nonce: 0,
          },
        }),
      ]),
      { fsPath: TARGET_FS, workspaceRoot: WS, line: 5 }
    );
    expect(result).toHaveLength(1);
    expect(result[0].anchorKind).toBe('smart');
    // tagId/tagLine should NOT be set for smart anchors
    expect(result[0].tagId).toBeUndefined();
  });

  it('returns multiple matches when several bookmarks share the line', () => {
    const result = findBookmarksOnLineMatching(
      makeFile([
        bookmark({ id: 'b1', anchor: { kind: 'point', line: 5 } }),
        bookmark({ id: 'b2', anchor: { kind: 'range', start: { line: 5 }, end: { line: 7 } } }),
        bookmark({
          id: 'b3',
          anchor: { kind: 'tag', tagId: 'X', lastUpdatedLine: 5, nonce: 0 },
        }),
      ]),
      { fsPath: TARGET_FS, workspaceRoot: WS, line: 5 }
    );
    expect(result.map(r => r.bookmarkId).sort()).toEqual(['b1', 'b2', 'b3']);
  });

  it('skips bookmarks targeting a different file', () => {
    const result = findBookmarksOnLineMatching(
      makeFile([
        bookmark({ id: 'b1', uri: 'src/other.ts', anchor: { kind: 'point', line: 5 } }),
        bookmark({ id: 'b2', uri: REL_URI, anchor: { kind: 'point', line: 5 } }),
      ]),
      { fsPath: TARGET_FS, workspaceRoot: WS, line: 5 }
    );
    expect(result.map(r => r.bookmarkId)).toEqual(['b2']);
  });

  it('matches absolute file:// URIs against fsPath', () => {
    const result = findBookmarksOnLineMatching(
      makeFile([
        bookmark({
          id: 'b1',
          uri: 'file:///ws/src/foo.ts',
          anchor: { kind: 'point', line: 5 },
        }),
      ]),
      { fsPath: TARGET_FS, workspaceRoot: WS, line: 5 }
    );
    expect(result.map(r => r.bookmarkId)).toEqual(['b1']);
  });

  it('matches absolute non-file:// paths against fsPath', () => {
    // Some callers may have written an absolute fs path without the file://
    // scheme. The helper must treat that as already-absolute (not re-join it
    // under workspaceRoot).
    const result = findBookmarksOnLineMatching(
      makeFile([
        bookmark({ id: 'b1', uri: '/ws/src/foo.ts', anchor: { kind: 'point', line: 5 } }),
      ]),
      { fsPath: TARGET_FS, workspaceRoot: WS, line: 5 }
    );
    expect(result.map(r => r.bookmarkId)).toEqual(['b1']);
  });

  it('strips the URI fragment before resolving (e.g. uri#bookmarkId)', () => {
    const result = findBookmarksOnLineMatching(
      makeFile([
        bookmark({ id: 'b1', uri: `${REL_URI}#someFragment`, anchor: { kind: 'point', line: 5 } }),
      ]),
      { fsPath: TARGET_FS, workspaceRoot: WS, line: 5 }
    );
    expect(result.map(r => r.bookmarkId)).toEqual(['b1']);
  });

  describe('visibility filter', () => {
    it('skips bookmarks whose groupId is in the hidden list', () => {
      const result = findBookmarksOnLineMatching(
        makeFile([
          bookmark({ id: 'b1', groupId: 'gA', anchor: { kind: 'point', line: 5 } }),
          bookmark({ id: 'b2', groupId: 'gB', anchor: { kind: 'point', line: 5 } }),
          bookmark({ id: 'b3', groupId: 'gC', anchor: { kind: 'point', line: 5 } }),
        ]),
        {
          fsPath: TARGET_FS,
          workspaceRoot: WS,
          line: 5,
          visibility: { hidden: ['gC'], focus: null },
        }
      );
      expect(result.map(r => r.bookmarkId).sort()).toEqual(['b1', 'b2']);
    });

    it('only returns bookmarks in the focused group when focus is set', () => {
      const result = findBookmarksOnLineMatching(
        makeFile([
          bookmark({ id: 'b1', groupId: 'gA', anchor: { kind: 'point', line: 5 } }),
          bookmark({ id: 'b2', groupId: 'gB', anchor: { kind: 'point', line: 5 } }),
          bookmark({ id: 'b3', groupId: 'gC', anchor: { kind: 'point', line: 5 } }),
        ]),
        {
          fsPath: TARGET_FS,
          workspaceRoot: WS,
          line: 5,
          visibility: { hidden: [], focus: 'gA' },
        }
      );
      expect(result.map(r => r.bookmarkId)).toEqual(['b1']);
    });

    it('focus takes precedence: bookmarks in focus group pass even if also in hidden list', () => {
      const result = findBookmarksOnLineMatching(
        makeFile([
          bookmark({ id: 'b1', groupId: 'gA', anchor: { kind: 'point', line: 5 } }),
        ]),
        {
          fsPath: TARGET_FS,
          workspaceRoot: WS,
          line: 5,
          visibility: { hidden: ['gA'], focus: 'gA' },
        }
      );
      expect(result.map(r => r.bookmarkId)).toEqual(['b1']);
    });

    it('omitting visibility means no filtering (all groups eligible)', () => {
      const result = findBookmarksOnLineMatching(
        makeFile([
          bookmark({ id: 'b1', groupId: 'gA', anchor: { kind: 'point', line: 5 } }),
          bookmark({ id: 'b2', groupId: 'gC', anchor: { kind: 'point', line: 5 } }),
        ]),
        { fsPath: TARGET_FS, workspaceRoot: WS, line: 5 }
      );
      expect(result.map(r => r.bookmarkId).sort()).toEqual(['b1', 'b2']);
    });
  });
});
