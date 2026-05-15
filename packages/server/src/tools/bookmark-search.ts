import type { ServerContext } from '../server-context.js';
import type { Group } from '@agentic-bookmarks/core';
import {
  readFileAt,
  resolveWorkspacePath,
  workspaceRelativeToUri,
  filterBookmarks,
  DEFAULT_SEARCH_SCOPE,
} from '@agentic-bookmarks/core';
import { getRegistryForWorkspace } from '../workspace.js';
import { anchorToWire, toWire } from './line-basis.js';

export async function handleBookmarkSearch(ctx: ServerContext, args: Record<string, any>) {
  const {
    text,
    groupName,
    tag,
    filePathContains,
    before,
    after,
    resultsMode = 'full',
  } = args;

  const results: any[] = [];

  for (const workspace of ctx.workspaces) {
    const registry = await getRegistryForWorkspace(workspace);

    // Build groupById map for this workspace
    const groupById = new Map<string, Group>();

    for (const fileEntry of registry.files) {
      if (fileEntry.enabled === false) continue;

      try {
        const absolutePath = resolveWorkspacePath(fileEntry.path, workspace.workspaceRoot);
        const data = await readFileAt(absolutePath);

        // Index groups
        for (const group of data.groups) {
          groupById.set(group.id, group);
        }

        // Filter bookmarks
        const filtered = filterBookmarks(data.bookmarks, {
          query: text,
          tag,
          filePathContains,
          before,
          after,
          scope: DEFAULT_SEARCH_SCOPE,
        });

        const groupNameFiltered = groupName
          ? filtered.filter(b => {
            const g = groupById.get(b.groupId);
            return g?.name.toLowerCase().includes(groupName.toLowerCase()) ?? false;
          })
          : filtered;

        for (const bookmark of groupNameFiltered) {
          const absoluteUri = workspaceRelativeToUri(bookmark.target.uri, workspace.workspaceRoot);

          // Format based on resultsMode
          if (resultsMode === 'textual') {
            results.push({
              uri: absoluteUri,
              label: bookmark.label,
              lineCache: bookmark.anchor.kind === 'tag' ? undefined : bookmark.anchor.lineCache,
            });
          } else if (resultsMode === 'lineNumbers') {
            const internalLine = bookmark.anchor.kind === 'point'
              ? bookmark.anchor.line
              : bookmark.anchor.kind === 'range'
                ? bookmark.anchor.start.line
                : (bookmark.anchor as any).lastUpdatedLine ?? 0;
            results.push({
              uri: absoluteUri,
              line: toWire(internalLine),
            });
          } else {
            results.push({
              workspace: workspace.workspaceRoot,
              fileId: fileEntry.fileId,
              groupId: bookmark.groupId,
              bookmark: {
                ...bookmark,
                anchor: anchorToWire(bookmark.anchor),
                target: { ...bookmark.target, uri: absoluteUri },
              },
            });
          }
        }
      } catch {
        // File not readable
      }
    }
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ results }),
    }],
  };
}
