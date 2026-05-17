import type { ContextKey, EntityKind } from './types';

export interface DragSpec {
  kind: EntityKind;
  id: string;
  ctx: ContextKey;
  /**
   * Sibling-scope identifier:
   *   - bookmark in ctx 'f': fileId (or absolute URI of the user code file)
   *   - bookmark in ctx 'g': groupId
   *   - bookmark in ctx 'a': null (flat view)
   *   - group in ctx 'f': fileId (the registry fileId of the parent data file)
   *   - file in ctx 'a': null
   *   - bookmarkFile in ctx 'f': workspaceRoot (used as a workspace identifier)
   */
  parentId: string | null;
}

/**
 * Pure validation. Returns true iff `src` may be reordered to `tgt`'s position.
 * Mismatches (different kinds, different parents in scopes that don't permit
 * cross-parent reordering) silently return false — the drop handler no-ops.
 *
 * TODO(future): cross-file move-bookmark, cross-group move-bookmark,
 * cross-file move-group, cross-workspace move-file are separate commands
 * (not sort operations). Hook sites left at the ignore branches.
 */
export function canReorder(src: DragSpec, tgt: DragSpec): boolean {
  if (src.kind !== tgt.kind) return false;
  if (src.ctx !== tgt.ctx) return false;
  // Same parent required in all current scopes. ctx 'a' implies parentId === null
  // for both, so the equality holds there too.
  if (src.parentId !== tgt.parentId) return false;
  return true;
}
