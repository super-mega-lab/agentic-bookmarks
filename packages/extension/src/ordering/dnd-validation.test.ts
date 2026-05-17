import { describe, it, expect } from 'vitest';
import { canReorder, type DragSpec } from './dnd-validation';

const mk = (overrides: Partial<DragSpec>): DragSpec => ({
  kind: 'bookmark', id: 'X', ctx: 'f', parentId: 'PARENT-1',
  ...overrides,
});

describe('canReorder', () => {
  it('allows bookmark→bookmark in the same parent', () => {
    expect(canReorder(mk({}), mk({}))).toBe(true);
  });

  it('rejects bookmark→bookmark across files in All Bookmarks (ctx=f, different parent)', () => {
    expect(canReorder(mk({ ctx: 'f', parentId: 'A' }), mk({ ctx: 'f', parentId: 'B' }))).toBe(false);
  });

  it('rejects bookmark→bookmark across groups in F&G (ctx=g, different parent)', () => {
    expect(canReorder(mk({ ctx: 'g', parentId: 'G1' }), mk({ ctx: 'g', parentId: 'G2' }))).toBe(false);
  });

  it('allows bookmark→bookmark in flat All Bookmarks (ctx=a, parentId always null)', () => {
    expect(canReorder(mk({ ctx: 'a', parentId: null }), mk({ ctx: 'a', parentId: null }))).toBe(true);
  });

  it('allows group→group in the same file', () => {
    expect(canReorder(
      mk({ kind: 'group', ctx: 'f', parentId: 'FILE-1' }),
      mk({ kind: 'group', ctx: 'f', parentId: 'FILE-1' }),
    )).toBe(true);
  });

  it('rejects group→group across files', () => {
    expect(canReorder(
      mk({ kind: 'group', ctx: 'f', parentId: 'FILE-1' }),
      mk({ kind: 'group', ctx: 'f', parentId: 'FILE-2' }),
    )).toBe(false);
  });

  it('allows file→file in All Bookmarks', () => {
    expect(canReorder(
      mk({ kind: 'file', ctx: 'a', parentId: null }),
      mk({ kind: 'file', ctx: 'a', parentId: null }),
    )).toBe(true);
  });

  it('allows bookmarkFile→bookmarkFile in the same workspace', () => {
    expect(canReorder(
      mk({ kind: 'bookmarkFile', ctx: 'f', parentId: 'WS-1' }),
      mk({ kind: 'bookmarkFile', ctx: 'f', parentId: 'WS-1' }),
    )).toBe(true);
  });

  it('rejects bookmarkFile→bookmarkFile across workspaces', () => {
    expect(canReorder(
      mk({ kind: 'bookmarkFile', ctx: 'f', parentId: 'WS-1' }),
      mk({ kind: 'bookmarkFile', ctx: 'f', parentId: 'WS-2' }),
    )).toBe(false);
  });

  it('rejects mismatched kinds (e.g. group dropped on bookmark)', () => {
    expect(canReorder(
      mk({ kind: 'group',    ctx: 'f', parentId: 'FILE-1' }),
      mk({ kind: 'bookmark', ctx: 'f', parentId: 'FILE-1' }),
    )).toBe(false);
  });
});
