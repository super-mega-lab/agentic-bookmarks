import * as vscode from 'vscode';
import type { OrderingService } from './service';
import { assignRankBetween, ensureRanksAround } from './rank';
import { canReorder, type DragSpec } from './dnd-validation';

/** A sibling in the current visual order. The rank may be null (unranked). */
export interface RankedSibling {
  spec: DragSpec;
  rank: number | null;
}

export interface DnDOptions {
  /** Unique MIME type for this tree's drag transfer. */
  mimeType: string;
  /**
   * Extract a `DragSpec` from a tree item. Return null if the item is not a
   * draggable type for this tree (e.g. WorkspaceFolderNode).
   */
  specOf: (item: vscode.TreeItem) => DragSpec | null;
  /**
   * Resolve the sibling list (in current visual order) around the drop
   * target. Return null if the target isn't a valid drop site.
   * `insertIdx` is the position the dropped item will occupy (i.e. it goes
   * BEFORE the current item at that index).
   */
  resolveSiblings: (target: vscode.TreeItem) => Promise<{
    siblings: RankedSibling[];
    insertIdx: number;
  } | null>;
  /** Provider's `_onDidChangeTreeData.fire()` callback. */
  onChanged: () => void;
  service: OrderingService;
}

export function makeDnDController(opts: DnDOptions): vscode.TreeDragAndDropController<vscode.TreeItem> {
  return {
    dropMimeTypes: [opts.mimeType],
    dragMimeTypes: [opts.mimeType],

    handleDrag(source, dataTransfer) {
      const specs = source
        .map(opts.specOf)
        .filter((s): s is DragSpec => s != null);
      if (specs.length === 0) return;
      dataTransfer.set(opts.mimeType, new vscode.DataTransferItem(JSON.stringify(specs)));
    },

    async handleDrop(target, dataTransfer) {
      if (!target) return;     // drop on empty area — no-op for v1
      const item = dataTransfer.get(opts.mimeType);
      if (!item) return;

      let srcSpecs: DragSpec[];
      try { srcSpecs = JSON.parse(await item.asString()) as DragSpec[]; }
      catch { return; }
      if (!Array.isArray(srcSpecs) || srcSpecs.length === 0) return;

      const targetSpec = opts.specOf(target);
      if (!targetSpec) return;

      // Drop sources that aren't reorderable into the target's scope (e.g.
      // cross-file in All Bookmarks, cross-group in F&G, cross-workspace
      // for bookmarkFiles). Mixed-kind multi-select is fine — invalid ones
      // are silently filtered.
      // TODO(future): cross-* moves are separate commands (move-to-group,
      // move-to-file, move-group, move-bookmarkFile-to-workspace).
      const survivors = srcSpecs.filter(s => canReorder(s, targetSpec));
      if (survivors.length === 0) return;

      const resolved = await opts.resolveSiblings(target);
      if (!resolved) return;
      const { siblings } = resolved;
      let { insertIdx } = resolved;

      // Persistence is wired through the setRank callback so ensureRanksAround
      // and the final assignRankBetween both flow into the debounced service.
      const getRank = (s: RankedSibling) => s.rank;
      const setRank = (s: RankedSibling, r: number) => {
        s.rank = r;
        opts.service.set(s.spec.kind, s.spec.id, s.spec.ctx, r);
      };

      for (const src of survivors) {
        // If src is already in the sibling list (intra-parent reorder), remove
        // it before insertion so we don't treat it as a neighbor of itself.
        const existingIdx = siblings.findIndex(s => s.spec.id === src.id && s.spec.kind === src.kind);
        if (existingIdx >= 0) {
          siblings.splice(existingIdx, 1);
          if (existingIdx < insertIdx) insertIdx--;
        }

        ensureRanksAround(siblings, insertIdx, getRank, setRank);
        const prevRank = insertIdx > 0               ? siblings[insertIdx - 1].rank : null;
        const nextRank = insertIdx < siblings.length ? siblings[insertIdx].rank     : null;
        const newRank  = assignRankBetween(prevRank, nextRank);

        opts.service.set(src.kind, src.id, src.ctx, newRank);

        // Insert into the local list so subsequent survivors see the right neighborhood.
        siblings.splice(insertIdx, 0, { spec: src, rank: newRank });
        insertIdx++;
      }

      opts.onChanged();
    },
  };
}
