// ABOUTME: Pure visibility helpers for FilesGroupsProvider — decide whether
// ABOUTME: a file's children render and whether a group should display as hidden.

/**
 * Decide how to render the children of a registry file row.
 *
 * - `renderChildren=false` short-circuits with `return []` at the call site —
 *   reserved for registry-disabled files (`enabled: false`). UI-hide alone no
 *   longer hides children (SML-1381).
 * - `childrenForcedHidden=true` means every group/bookmark under this file
 *   should render with the dimmed/eye-closed visual treatment regardless of
 *   the per-group focus/hidden state.
 */
export function computeFileChildrenVisibility(opts: {
  fileEnabled: boolean;
  fileUiHidden: boolean;
}): {
  renderChildren: boolean;
  childrenForcedHidden: boolean;
} {
  if (!opts.fileEnabled) {
    // Registry-disable wins — preserved short-circuit (out of scope for SML-1381).
    return { renderChildren: false, childrenForcedHidden: false };
  }
  return { renderChildren: true, childrenForcedHidden: opts.fileUiHidden };
}

/**
 * Decide whether a group should display as hidden in the Files + Groups tree.
 *
 * File-level forced-hidden (from `computeFileChildrenVisibility`) wins over
 * everything. Otherwise this preserves the canonical focus-wins-over-hidden
 * predicate from SML-1380 (`ui.focus ? ui.focus !== gid : ui.hidden.includes(gid)`).
 */
export function computeGroupVisualHidden(opts: {
  groupId: string;
  childrenForcedHidden: boolean;
  uiFocus: string | null;
  uiHidden: string[];
}): boolean {
  if (opts.childrenForcedHidden) return true;
  return opts.uiFocus ? opts.uiFocus !== opts.groupId : opts.uiHidden.includes(opts.groupId);
}
