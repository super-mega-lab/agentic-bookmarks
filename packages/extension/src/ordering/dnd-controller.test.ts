// ABOUTME: Tests for makeDnDController — the fallback branch (onFallbackDrop), the primary
// ABOUTME: reorder flow (rankForInsert + service.set + onChanged), the early-return guards, and handleDrag.

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
import type { ContextKey, EntityKind } from './types';

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

/** Transfer carrying an arbitrary raw payload (for malformed/empty/non-array JSON tests). */
function makeRawTransfer(raw: string): { get: (mime: string) => vscode.DataTransferItem | undefined } {
  const item = new (vscode as any).DataTransferItem(raw);
  return { get: (mime: string) => mime === MIME ? item : undefined };
}

/** Transfer that holds nothing for our mime type. */
const emptyTransfer = { get: () => undefined };

/** Stub OrderingService — for tests that don't read persistence back. */
function stubService(): OrderingService {
  return {
    get: () => undefined,
    set: () => undefined,
    has: () => false,
    delete: () => undefined,
  } as unknown as OrderingService;
}

/**
 * Recording fake OrderingService backed by an in-memory map, so tests can read back the
 * ranks the controller actually persisted instead of asserting `set` was merely called.
 */
function recordingService() {
  const ranks = new Map<string, number>();
  let setCount = 0;
  const key = (kind: EntityKind, id: string, ctx: ContextKey) => `${kind}:${id}:${ctx}`;
  const service = {
    get: (kind: EntityKind, id: string, ctx: ContextKey) => ranks.get(key(kind, id, ctx)),
    set: (kind: EntityKind, id: string, ctx: ContextKey, rank: number) => {
      setCount++;
      ranks.set(key(kind, id, ctx), rank);
    },
    has: (kind: EntityKind, id: string, ctx: ContextKey) => ranks.has(key(kind, id, ctx)),
    delete: (kind: EntityKind, id: string, ctx: ContextKey) => { ranks.delete(key(kind, id, ctx)); },
  } as unknown as OrderingService;
  return {
    service,
    ranks,
    rankOf: (s: DragSpec) => ranks.get(key(s.kind, s.id, s.ctx)),
    setCount: () => setCount,
  };
}

/** Recording fake vscode.DataTransfer for handleDrag — captures every `set` call. */
function recordingDragTransfer() {
  const sets: Array<{ mime: string; value: string }> = [];
  const transfer = {
    set: (mime: string, item: { value: string }) => { sets.push({ mime, value: item.value }); },
  };
  return { transfer, sets };
}

interface BuildOpts {
  srcSpecs?: DragSpec[];
  targetSpec?: DragSpec | null;
  onFallbackDrop?: DnDOptions['onFallbackDrop'];
  resolveSiblings?: DnDOptions['resolveSiblings'];
  service?: OrderingService;
  onChanged?: () => void;
  /** Full override of specOf (used by handleDrag tests). */
  specOf?: DnDOptions['specOf'];
}

function buildController(b: BuildOpts) {
  const srcItem = new (vscode as any).TreeItem('src') as vscode.TreeItem;
  const targetItem = new (vscode as any).TreeItem('target') as vscode.TreeItem;

  const opts: DnDOptions = {
    mimeType: MIME,
    specOf: b.specOf ?? ((item) => item === targetItem ? (b.targetSpec ?? null) : (b.srcSpecs?.[0] ?? null)),
    resolveSiblings: b.resolveSiblings ?? (async () => {
      const siblings: RankedSibling[] = (b.srcSpecs ?? []).map(s => ({ spec: s, rank: 100 }));
      if (b.targetSpec) siblings.push({ spec: b.targetSpec, rank: 200 });
      return { siblings, insertIdx: Math.max(0, siblings.length - 1) };
    }),
    onChanged: b.onChanged ?? (() => undefined),
    service: b.service ?? stubService(),
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

  describe('handleDrop — reorder flow', () => {
    it('persists a midpoint rank and fires onChanged once for a same-parent reorder', async () => {
      // src C lands between A(100) and B(300) → midpoint 200. C is not already a sibling.
      const src = spec({ kind: 'group', id: 'C', ctx: 'f', parentId: 'FILE-1' });
      const targetSpec = spec({ kind: 'group', id: 'T', ctx: 'f', parentId: 'FILE-1' });
      const rec = recordingService();
      const onChanged = vi.fn();
      const resolveSiblings: DnDOptions['resolveSiblings'] = async () => ({
        siblings: [
          { spec: spec({ id: 'A' }), rank: 100 },
          { spec: spec({ id: 'B' }), rank: 300 },
        ],
        insertIdx: 1,
      });
      const { controller, targetItem } = buildController({
        srcSpecs: [src], targetSpec, resolveSiblings, service: rec.service, onChanged,
      });

      await controller.handleDrop!(targetItem, makeTransfer([src]) as any, {} as any);

      expect(rec.rankOf(src)).toBe(200);
      expect(rec.setCount()).toBe(1);
      expect(onChanged).toHaveBeenCalledTimes(1);
    });

    it('drops to the front (rank 0) when insertIdx === 0', async () => {
      const src = spec({ kind: 'group', id: 'C', ctx: 'f', parentId: 'FILE-1' });
      const targetSpec = spec({ kind: 'group', id: 'T', ctx: 'f', parentId: 'FILE-1' });
      const rec = recordingService();
      const onChanged = vi.fn();
      const resolveSiblings: DnDOptions['resolveSiblings'] = async () => ({
        siblings: [{ spec: spec({ id: 'A' }), rank: 100 }],
        insertIdx: 0,
      });
      const { controller, targetItem } = buildController({
        srcSpecs: [src], targetSpec, resolveSiblings, service: rec.service, onChanged,
      });

      await controller.handleDrop!(targetItem, makeTransfer([src]) as any, {} as any);

      expect(rec.rankOf(src)).toBe(0);
      expect(onChanged).toHaveBeenCalledTimes(1);
    });

    it('appends past the last sibling (rank 200) when insertIdx === length', async () => {
      const src = spec({ kind: 'group', id: 'C', ctx: 'f', parentId: 'FILE-1' });
      const targetSpec = spec({ kind: 'group', id: 'T', ctx: 'f', parentId: 'FILE-1' });
      const rec = recordingService();
      const onChanged = vi.fn();
      const resolveSiblings: DnDOptions['resolveSiblings'] = async () => ({
        siblings: [{ spec: spec({ id: 'A' }), rank: 100 }],
        insertIdx: 1, // === siblings.length → append
      });
      const { controller, targetItem } = buildController({
        srcSpecs: [src], targetSpec, resolveSiblings, service: rec.service, onChanged,
      });

      await controller.handleDrop!(targetItem, makeTransfer([src]) as any, {} as any);

      expect(rec.rankOf(src)).toBe(200);
      expect(onChanged).toHaveBeenCalledTimes(1);
    });

    it('intra-parent move: splices src out and decrements insertIdx when existingIdx < insertIdx', async () => {
      // SRC is sibling index 1, dropped at insertIdx 3. After splice: [X,Y,Z], insertIdx → 2,
      // so SRC lands strictly between Y(300) and Z(400). If the decrement were missing it would
      // land past Z instead, so the ordering bound pins the decrement branch.
      const src = spec({ kind: 'group', id: 'SRC', ctx: 'f', parentId: 'FILE-1' });
      const targetSpec = spec({ kind: 'group', id: 'T', ctx: 'f', parentId: 'FILE-1' });
      const rec = recordingService();
      const onChanged = vi.fn();
      const resolveSiblings: DnDOptions['resolveSiblings'] = async () => ({
        siblings: [
          { spec: spec({ id: 'X' }), rank: 100 },
          { spec: src, rank: 150 },
          { spec: spec({ id: 'Y' }), rank: 300 },
          { spec: spec({ id: 'Z' }), rank: 400 },
        ],
        insertIdx: 3,
      });
      const { controller, targetItem } = buildController({
        srcSpecs: [src], targetSpec, resolveSiblings, service: rec.service, onChanged,
      });

      await controller.handleDrop!(targetItem, makeTransfer([src]) as any, {} as any);

      const rank = rec.rankOf(src)!;
      expect(rank).toBeGreaterThan(300);
      expect(rank).toBeLessThan(400);
      expect(onChanged).toHaveBeenCalledTimes(1);
    });

    it('intra-parent move: does NOT decrement insertIdx when existingIdx > insertIdx', async () => {
      // SRC is sibling index 2, dropped at insertIdx 1 (moving toward the front). No decrement,
      // so after splice [X,Y,Z] insertIdx stays 1 → SRC lands strictly between X(100) and Y(200).
      const src = spec({ kind: 'group', id: 'SRC', ctx: 'f', parentId: 'FILE-1' });
      const targetSpec = spec({ kind: 'group', id: 'T', ctx: 'f', parentId: 'FILE-1' });
      const rec = recordingService();
      const onChanged = vi.fn();
      const resolveSiblings: DnDOptions['resolveSiblings'] = async () => ({
        siblings: [
          { spec: spec({ id: 'X' }), rank: 100 },
          { spec: spec({ id: 'Y' }), rank: 200 },
          { spec: src, rank: 300 },
          { spec: spec({ id: 'Z' }), rank: 400 },
        ],
        insertIdx: 1,
      });
      const { controller, targetItem } = buildController({
        srcSpecs: [src], targetSpec, resolveSiblings, service: rec.service, onChanged,
      });

      await controller.handleDrop!(targetItem, makeTransfer([src]) as any, {} as any);

      const rank = rec.rankOf(src)!;
      expect(rank).toBeGreaterThan(100);
      expect(rank).toBeLessThan(200);
      expect(onChanged).toHaveBeenCalledTimes(1);
    });

    it('multi-select drop lands items in source order at adjacent ranks', async () => {
      // C1 then C2 both inserted at insertIdx 1 (with insertIdx++ advance) between A(100)/B(300).
      const c1 = spec({ kind: 'group', id: 'C1', ctx: 'f', parentId: 'FILE-1' });
      const c2 = spec({ kind: 'group', id: 'C2', ctx: 'f', parentId: 'FILE-1' });
      const targetSpec = spec({ kind: 'group', id: 'T', ctx: 'f', parentId: 'FILE-1' });
      const rec = recordingService();
      const onChanged = vi.fn();
      const resolveSiblings: DnDOptions['resolveSiblings'] = async () => ({
        siblings: [
          { spec: spec({ id: 'A' }), rank: 100 },
          { spec: spec({ id: 'B' }), rank: 300 },
        ],
        insertIdx: 1,
      });
      const { controller, targetItem } = buildController({
        srcSpecs: [c1, c2], targetSpec, resolveSiblings, service: rec.service, onChanged,
      });

      await controller.handleDrop!(targetItem, makeTransfer([c1, c2]) as any, {} as any);

      const r1 = rec.rankOf(c1)!;
      const r2 = rec.rankOf(c2)!;
      // Source order preserved (C1 before C2) and both land between the neighbours.
      expect(r1).toBeGreaterThan(100);
      expect(r1).toBeLessThan(r2);
      expect(r2).toBeLessThan(300);
      expect(onChanged).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when resolveSiblings returns null', async () => {
      const src = spec({ kind: 'group', id: 'C', ctx: 'f', parentId: 'FILE-1' });
      const targetSpec = spec({ kind: 'group', id: 'T', ctx: 'f', parentId: 'FILE-1' });
      const rec = recordingService();
      const onChanged = vi.fn();
      const { controller, targetItem } = buildController({
        srcSpecs: [src], targetSpec, resolveSiblings: async () => null, service: rec.service, onChanged,
      });

      await controller.handleDrop!(targetItem, makeTransfer([src]) as any, {} as any);

      expect(rec.setCount()).toBe(0);
      expect(rec.ranks.size).toBe(0);
      expect(onChanged).not.toHaveBeenCalled();
    });
  });

  describe('handleDrop — early-return guards', () => {
    it('no-ops on an undefined target', async () => {
      const rec = recordingService();
      const onChanged = vi.fn();
      const { controller } = buildController({
        srcSpecs: [spec()], targetSpec: spec(), service: rec.service, onChanged,
      });

      await expect(
        controller.handleDrop!(undefined as any, makeTransfer([spec()]) as any, {} as any)
      ).resolves.toBeUndefined();
      expect(rec.setCount()).toBe(0);
      expect(onChanged).not.toHaveBeenCalled();
    });

    it('no-ops when the transfer has no item for the mime type', async () => {
      const rec = recordingService();
      const onChanged = vi.fn();
      const { controller, targetItem } = buildController({
        srcSpecs: [spec()], targetSpec: spec(), service: rec.service, onChanged,
      });

      await controller.handleDrop!(targetItem, emptyTransfer as any, {} as any);

      expect(rec.setCount()).toBe(0);
      expect(onChanged).not.toHaveBeenCalled();
    });

    it('no-ops on a malformed JSON payload without throwing', async () => {
      const rec = recordingService();
      const onChanged = vi.fn();
      const { controller, targetItem } = buildController({
        srcSpecs: [spec()], targetSpec: spec(), service: rec.service, onChanged,
      });

      await expect(
        controller.handleDrop!(targetItem, makeRawTransfer('{not valid json') as any, {} as any)
      ).resolves.toBeUndefined();
      expect(rec.setCount()).toBe(0);
      expect(onChanged).not.toHaveBeenCalled();
    });

    it('no-ops on an empty-array payload', async () => {
      const rec = recordingService();
      const onChanged = vi.fn();
      const { controller, targetItem } = buildController({
        srcSpecs: [spec()], targetSpec: spec(), service: rec.service, onChanged,
      });

      await controller.handleDrop!(targetItem, makeRawTransfer('[]') as any, {} as any);

      expect(rec.setCount()).toBe(0);
      expect(onChanged).not.toHaveBeenCalled();
    });

    it('no-ops on a non-array JSON payload', async () => {
      const rec = recordingService();
      const onChanged = vi.fn();
      const { controller, targetItem } = buildController({
        srcSpecs: [spec()], targetSpec: spec(), service: rec.service, onChanged,
      });

      await controller.handleDrop!(targetItem, makeRawTransfer('{"foo":1}') as any, {} as any);

      expect(rec.setCount()).toBe(0);
      expect(onChanged).not.toHaveBeenCalled();
    });

    it('no-ops when the target is not draggable (specOf returns null)', async () => {
      const rec = recordingService();
      const onChanged = vi.fn();
      const { controller, targetItem } = buildController({
        srcSpecs: [spec()], targetSpec: null, service: rec.service, onChanged,
      });

      await controller.handleDrop!(targetItem, makeTransfer([spec()]) as any, {} as any);

      expect(rec.setCount()).toBe(0);
      expect(onChanged).not.toHaveBeenCalled();
    });
  });

  describe('handleDrag', () => {
    it('serialises only the draggable specs', () => {
      const specA = spec({ id: 'A' });
      const specC = spec({ id: 'C' });
      const item1 = new (vscode as any).TreeItem('1') as vscode.TreeItem;
      const item2 = new (vscode as any).TreeItem('2') as vscode.TreeItem; // not draggable
      const item3 = new (vscode as any).TreeItem('3') as vscode.TreeItem;
      const specOf: DnDOptions['specOf'] = (item) =>
        item === item1 ? specA : item === item3 ? specC : null;
      const { controller } = buildController({ specOf });
      const { transfer, sets } = recordingDragTransfer();

      controller.handleDrag!([item1, item2, item3], transfer as any, {} as any);

      expect(sets).toHaveLength(1);
      expect(sets[0].mime).toBe(MIME);
      expect(JSON.parse(sets[0].value)).toEqual([specA, specC]);
    });

    it('does not set the transfer when no specs survive', () => {
      const item1 = new (vscode as any).TreeItem('1') as vscode.TreeItem;
      const { controller } = buildController({ specOf: () => null });
      const { transfer, sets } = recordingDragTransfer();

      controller.handleDrag!([item1], transfer as any, {} as any);

      expect(sets).toHaveLength(0);
    });
  });
});
