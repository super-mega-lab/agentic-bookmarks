// ABOUTME: Pure tree-walk helper for locating a BookmarkNode by fsPath + bookmark id.
// ABOUTME: Used by agenticBookmarks.revealInPanel to obtain a live node to pass to TreeView.reveal.

export interface FileNodeLike {
  resourceUri?: { fsPath: string };
}

export interface BookmarkNodeLike {
  id: string;
}

export interface ProviderLike {
  getChildren(element?: unknown): Promise<unknown[]>;
}

/**
 * Walk the provider's tree to find a BookmarkNode-shaped item whose owning
 * FileNode has the given fsPath and whose own `id` matches `bookmarkId`.
 * Returns `null` if no such item is currently visible in the tree (e.g. the
 * bookmark is filtered out or belongs to a hidden file).
 */
export async function findBookmarkNodeInTree(
  provider: ProviderLike,
  fsPath: string,
  bookmarkId: string,
): Promise<BookmarkNodeLike | null> {
  const roots = await provider.getChildren();
  for (const item of roots) {
    const asFile = item as FileNodeLike;
    const asBookmark = item as BookmarkNodeLike;
    if (!asFile.resourceUri && asBookmark.id === bookmarkId) return asBookmark;
    if (asFile.resourceUri?.fsPath !== fsPath) continue;

    const children = await provider.getChildren(item);
    for (const child of children) {
      const asBookmark = child as BookmarkNodeLike;
      if (asBookmark.id === bookmarkId) return asBookmark;
    }
  }
  return null;
}
