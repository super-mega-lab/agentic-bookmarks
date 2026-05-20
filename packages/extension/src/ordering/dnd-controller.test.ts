// ABOUTME: Tests for makeDnDController fallback behavior — onFallbackDrop fires when
// ABOUTME: no dragged item passes canReorder against the drop target.

import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => {
  class DataTransferItem {
    constructor(public value: string) {}
    asString() { return Promise.resolve(this.value); }
  }
  class TreeItem {
    constructor(public label?: string) {}
  }
  return { DataTransferItem, TreeItem };
});

import * as vscode from 'vscode';
import { makeDnDController, type DnDOptions, type RankedSibling } from './dnd-controller';
import type { DragSpec } from './dnd-validation';
import type { OrderingService } from './service';

const MIME = 'application/test-dnd';

function spec(overrides: Partial<DragSpec> = {}): DragSpec {
  return {
    kind: 'group', id: 'G1', ctx: 'f', parentId: 'FILE-1',
    ...overrides,
  };
}

/** Minimal stand-in for vscode.DataTransfer used by handleDrop. */
function makeTransfer(specs: DragSpec[]): { get: (mime: string) => vscode.DataTransferItem | undefined } {
  const item = new (vscode as any).DataTransferItem(JSON.stringify(specs));
  return { get: (mime: string) => mime === MIME ? item : undefined };
}

/** Stub OrderingService — we don't exercise persistence here. */
function stubService(): OrderingService {
  return {
    get: () => undefined,
    set: () => undefined,
    has: () => false,
    delete: () => undefined,
  } as unknown as OrderingService;
}

interface BuildOpts {
  srcSpecs: DragSpec[];
  targetSpec: DragSpec;
  onFallbackDrop?: DnDOptions['onFallbackDrop'];
  resolveSiblings?: DnDOptions['resolveSiblings'];
}

function buildController(b: BuildOpts) {
  const srcItem = new (vscode as any).TreeItem('src') as vscode.TreeItem;
  const targetItem = new (vscode as any).TreeItem('target') as vscode.TreeItem;

  const opts: DnDOptions = {
    mimeType: MIME,
    specOf: (item) => item === targetItem ? b.targetSpec : b.srcSpecs[0] ?? null,
    resolveSiblings: b.resolveSiblings ?? (async () => {
      const siblings: RankedSibling[] = b.srcSpecs.map(s => ({ spec: s, rank: 100 }));
      siblings.push({ spec: b.targetSpec, rank: 200 });
      return { siblings, insertIdx: siblings.length - 1 };
    }),
    onChanged: () => undefined,
    service: stubService(),
    onFallbackDrop: b.onFallbackDrop,
  };
  return { controller: makeDnDController(opts), srcItem, targetItem };
}

describe('makeDnDController', () => {
  describe('handleDrop', () => {
    it('calls onFallbackDrop when survivors is empty', async () => {
      // group dropped on bookmark — kind mismatch, canReorder returns false for all
      const srcSpecs = [spec({ kind: 'group', id: 'G1', ctx: 'f', parentId: 'FILE-1' })];
      const targetSpec = spec({ kind: 'bookmark', id: 'B1', ctx: 'f', parentId: 'FILE-1' });
      const onFallbackDrop = vi.fn(async () => undefined);
      const { controller, targetItem } = buildController({ srcSpecs, targetSpec, onFallbackDrop });

      await controller.handleDrop!(targetItem, makeTransfer(srcSpecs) as any, {} as any);

      expect(onFallbackDrop).toHaveBeenCalledTimes(1);
      expect(onFallbackDrop).toHaveBeenCalledWith(srcSpecs, targetItem);
    });

    it('does not call onFallbackDrop when canReorder succeeds', async () => {
      // same kind/ctx/parent — canReorder returns true
      const srcSpecs = [spec({ kind: 'group', id: 'G1', ctx: 'f', parentId: 'FILE-1' })];
      const targetSpec = spec({ kind: 'group', id: 'G2', ctx: 'f', parentId: 'FILE-1' });
      const onFallbackDrop = vi.fn(async () => undefined);
      const { controller, targetItem } = buildController({ srcSpecs, targetSpec, onFallbackDrop });

      await controller.handleDrop!(targetItem, makeTransfer(srcSpecs) as any, {} as any);

      expect(onFallbackDrop).not.toHaveBeenCalled();
    });

    it('handles missing onFallbackDrop gracefully', async () => {
      // group dropped on bookmark — no fallback wired, must not throw
      const srcSpecs = [spec({ kind: 'group', id: 'G1', ctx: 'f', parentId: 'FILE-1' })];
      const targetSpec = spec({ kind: 'bookmark', id: 'B1', ctx: 'f', parentId: 'FILE-1' });
      const { controller, targetItem } = buildController({ srcSpecs, targetSpec });

      await expect(
        controller.handleDrop!(targetItem, makeTransfer(srcSpecs) as any, {} as any)
      ).resolves.toBeUndefined();
    });
  });
});
