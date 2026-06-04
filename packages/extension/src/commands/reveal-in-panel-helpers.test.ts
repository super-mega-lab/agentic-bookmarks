// ABOUTME: Tests for findBookmarkNodeInTree - pure tree-walk helper that locates
// ABOUTME: a BookmarkNode by fsPath + bookmark id within a BookmarksProvider's children.

import { describe, it, expect } from 'vitest';
import { findBookmarkNodeInTree, type ProviderLike, type FileNodeLike, type BookmarkNodeLike } from './reveal-in-panel-helpers';

function fileNode(fsPath: string, children: BookmarkNodeLike[]): FileNodeLike & { children: BookmarkNodeLike[] } {
  return { resourceUri: { fsPath }, children };
}

function bookmarkNode(id: string): BookmarkNodeLike {
  return { id };
}

function mkProvider(rootItems: Array<FileNodeLike & { children?: BookmarkNodeLike[] } | { contextValue?: string }>): ProviderLike {
  return {
    async getChildren(element) {
      if (!element) return rootItems;
      // Look up children of a FileNode-shaped element by reference
      const match = rootItems.find(it => it === element) as { children?: BookmarkNodeLike[] } | undefined;
      return match?.children ?? [];
    },
  };
}

describe('findBookmarkNodeInTree', () => {
  it('returns null when the tree has no items', async () => {
    const provider = mkProvider([]);
    const result = await findBookmarkNodeInTree(provider, '/ws/foo.ts', 'b1');
    expect(result).toBeNull();
  });

  it('returns null when no FileNode matches the fsPath', async () => {
    const provider = mkProvider([fileNode('/ws/other.ts', [bookmarkNode('b1')])]);
    const result = await findBookmarkNodeInTree(provider, '/ws/foo.ts', 'b1');
    expect(result).toBeNull();
  });

  it('returns null when the FileNode matches but no BookmarkNode has the id', async () => {
    const provider = mkProvider([fileNode('/ws/foo.ts', [bookmarkNode('b1'), bookmarkNode('b2')])]);
    const result = await findBookmarkNodeInTree(provider, '/ws/foo.ts', 'bX');
    expect(result).toBeNull();
  });

  it('returns the matching BookmarkNode when both file and id match', async () => {
    const target = bookmarkNode('b2');
    const provider = mkProvider([fileNode('/ws/foo.ts', [bookmarkNode('b1'), target, bookmarkNode('b3')])]);
    const result = await findBookmarkNodeInTree(provider, '/ws/foo.ts', 'b2');
    expect(result).toBe(target);
  });

  it('picks the correct FileNode when multiple FileNodes exist', async () => {
    const target = bookmarkNode('b7');
    const provider = mkProvider([
      fileNode('/ws/a.ts', [bookmarkNode('b1'), bookmarkNode('b2')]),
      fileNode('/ws/b.ts', [bookmarkNode('b5'), target]),
      fileNode('/ws/c.ts', [bookmarkNode('b9')]),
    ]);
    const result = await findBookmarkNodeInTree(provider, '/ws/b.ts', 'b7');
    expect(result).toBe(target);
  });

  it('does not match a bookmark id from a different file', async () => {
    const provider = mkProvider([
      fileNode('/ws/a.ts', [bookmarkNode('shared-id')]),
      fileNode('/ws/b.ts', []),
    ]);
    const result = await findBookmarkNodeInTree(provider, '/ws/b.ts', 'shared-id');
    expect(result).toBeNull();
  });

  it('skips non-FileNode root items (e.g. filter-info banner)', async () => {
    const target = bookmarkNode('b1');
    const provider = mkProvider([
      { contextValue: 'filterInfo' }, // banner without resourceUri
      fileNode('/ws/foo.ts', [target]),
    ]);
    const result = await findBookmarkNodeInTree(provider, '/ws/foo.ts', 'b1');
    expect(result).toBe(target);
  });

  it('finds a BookmarkNode at the root in flat mode (no resourceUri)', async () => {
    const target = bookmarkNode('b2');
    const provider = mkProvider([bookmarkNode('b1') as any, target as any, bookmarkNode('b3') as any]);
    const result = await findBookmarkNodeInTree(provider, '/ws/foo.ts', 'b2');
    expect(result).toBe(target);
  });

  it('returns null when flat-mode root has no matching bookmark id', async () => {
    const provider = mkProvider([bookmarkNode('b1') as any, bookmarkNode('b2') as any]);
    const result = await findBookmarkNodeInTree(provider, '/ws/foo.ts', 'bX');
    expect(result).toBeNull();
  });
});
