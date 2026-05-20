import type { ServerContext } from '../server-context.js';
import type {
  BookmarkAnchor,
  Bookmark,
  AnchorType,
  TagAnchor,
} from '@agentic-bookmarks/core';
import {
  readFileAt,
  writeFileAt,
  pathsForDataFile,
  editFileV2WithContext,
  resolveWorkspacePath,
  uriToWorkspaceRelative,
  workspaceRelativeToUri,
  filterBookmarks,
  DEFAULT_SEARCH_SCOPE,
  isLocalPath,
  createAnchor,
  getDefaultAnchorType,
} from '@agentic-bookmarks/core';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { nanoid } from 'nanoid';
import { fileURLToPath } from 'node:url';
import {
  getWorkspaceForUri,
  getRegistryForWorkspace,
  findFileContainingGroup,
  findGroupByName,
  getOrCreateLocalFile,
} from '../workspace.js';
import {
  normalizeAnchor,
  createGroupWithAIStyle,
} from '../helpers.js';
import { anchorToInternal, anchorToWire, toWire } from './line-basis.js';

export async function handleBookmarkAdd(ctx: ServerContext, args: Record<string, any>) {
  const {
    uri,
    label,
    anchor: rawAnchor,
    note,
    tags,
    groupName,
    groupId: legacyGroupId,
    newGroupName,  // Deprecated, maps to groupName
    anchorType: requestedAnchorType,  // Smart/tag anchor support
  } = args;

  // 1. Determine workspace from URI
  const workspace = getWorkspaceForUri(uri, ctx.workspaces);
  if (!workspace) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: 'Non-workspace bookmarks not supported yet, as they make collaborative work breakable',
        }),
      }],
    };
  }

  // 2. Parse and normalize anchor (wire is 1-based; convert to internal 0-based)
  const parsedAnchor = anchorToInternal(normalizeAnchor(rawAnchor));

  // 3. Get workspace-relative path for the source file being bookmarked
  const relativePath = uriToWorkspaceRelative(uri, workspace.workspaceRoot);
  if (!relativePath) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: 'Failed to convert URI to workspace-relative path',
        }),
      }],
    };
  }

  // Determine anchor type: use requested, or fall back to workspace default
  const defaultAnchorType = await getDefaultAnchorType(workspace.workspaceRoot);
  const anchorType: AnchorType = requestedAnchorType ?? defaultAnchorType;

  // Read source file for anchor creation (needed for smart/tag anchors)
  let fileLines: string[] = [];
  const absolutePath = uri.startsWith('file://')
    ? fileURLToPath(uri)
    : resolveWorkspacePath(uri, workspace.workspaceRoot);

  try {
    const content = await fs.readFile(absolutePath, 'utf8');
    fileLines = content.split('\n');
  } catch {
    // File not readable - fall back to raw anchor for point/range
    // Smart/tag anchors require file content
    if (anchorType === 'smart' || anchorType === 'tag') {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `Cannot create ${anchorType} anchor: file not readable`,
          }),
        }],
      };
    }
  }

  const targetLine =
    parsedAnchor.kind === 'point'
      ? parsedAnchor.line
      : parsedAnchor.kind === 'range'
        ? parsedAnchor.start.line
        : 0;
  const endLine = parsedAnchor.kind === 'range' ? parsedAnchor.end.line : undefined;

  // Generate bookmark ID early (needed for tag anchors)
  let bookmarkId = nanoid(8);

  // 4. Resolve target group FIRST so we can determine isLocal from bookmarks file path
  const effectiveGroupName = groupName || newGroupName;  // newGroupName is deprecated alias

  let targetFileId: string;
  let targetGroupId: string;
  let targetFilePath: string;
  let wasGroupCreated = false;

  if (effectiveGroupName) {
    // Group name specified - find or create
    const existingGroup = await findGroupByName(workspace, effectiveGroupName);

    if (existingGroup) {
      // Group exists - use it
      targetFileId = existingGroup.fileId;
      targetGroupId = existingGroup.groupId;
      targetFilePath = existingGroup.filePath;
    } else {
      // Group doesn't exist - create it (lazy init)
      const { fileId, filePath } = await getOrCreateLocalFile(workspace);
      targetFilePath = filePath;
      targetFileId = fileId;

      // Create the group
      targetGroupId = await createGroupWithAIStyle(
        workspace,
        filePath,
        effectiveGroupName
      );
      wasGroupCreated = true;
    }
  } else if (legacyGroupId) {
    // Legacy: direct group ID
    const found = await findFileContainingGroup(workspace, legacyGroupId);
    if (!found) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `Group ${legacyGroupId} not found`,
          }),
        }],
      };
    }
    targetFileId = found.fileId;
    targetGroupId = legacyGroupId;
    targetFilePath = found.filePath;
  } else {
    // Use default target
    const registry = await getRegistryForWorkspace(workspace);

    if (!registry.defaultTarget) {
      // No default - create in local file with Unsorted group
      const { fileId, filePath } = await getOrCreateLocalFile(workspace);
      targetFilePath = filePath;
      targetFileId = fileId;

      // Get or create Unsorted group
      const data = await readFileAt(filePath);
      let unsortedGroup = data.groups.find(g => g.isUnsorted);

      if (!unsortedGroup) {
        unsortedGroup = {
          id: nanoid(8),
          name: 'Unsorted',
          icon: { svg_style: 'bookmark', svg_color: 'gray' },
          createdAt: Date.now(),
          isUnsorted: true,
        };
        data.groups.push(unsortedGroup);
        const p = pathsForDataFile(filePath, workspace.workspaceRoot, workspace.bookmarksDataRoot);
        await writeFileAt(p, data);
      }

      targetGroupId = unsortedGroup.id;
    } else {
      const fileEntry = registry.files.find(f => f.fileId === registry.defaultTarget!.fileId);
      if (!fileEntry) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'Default target file not found in registry',
            }),
          }],
        };
      }
      targetFilePath = resolveWorkspacePath(fileEntry.path, workspace.workspaceRoot);
      targetFileId = registry.defaultTarget.fileId;
      targetGroupId = registry.defaultTarget.groupId;
    }
  }

  // 5. Read the file to get its isLocal setting (authoritative source)
  // Falls back to isLocalPath() for files created before isLocal was added
  const targetFileData = await readFileAt(targetFilePath);
  const isLocal = targetFileData.isLocal ?? isLocalPath(path.relative(workspace.workspaceRoot, targetFilePath));

  // 6. Create anchor with proper context based on isLocal
  let enrichedAnchor: BookmarkAnchor = parsedAnchor;
  let tagInsertionNeeded = false;

  if (anchorType === 'smart') {
    // Create smart anchor with context for durability
    enrichedAnchor = createAnchor('smart', fileLines, targetLine, {
      isLocal,
      blankLinesUseSupport: true,
      lineCacheLength: 120,
    });
  } else if (anchorType === 'tag') {
    // Create tag anchor - requires tag insertion in source file
    const tagId = nanoid(8);
    enrichedAnchor = createAnchor('tag', fileLines, targetLine, {}, undefined, tagId);
    tagInsertionNeeded = true;
  } else {
    // Point or range - use existing logic with enhancements
    if (fileLines.length > 0) {
      enrichedAnchor = createAnchor(
        parsedAnchor.kind,
        fileLines,
        targetLine,
        { lineCacheLength: 120 },
        endLine
      );

      // Preserve column if it was provided in the original anchor
      if (parsedAnchor.kind === 'point' && parsedAnchor.column !== undefined) {
        (enrichedAnchor as any).column = parsedAnchor.column;
      } else if (parsedAnchor.kind === 'range') {
        if (parsedAnchor.start.column !== undefined) {
          (enrichedAnchor as any).start.column = parsedAnchor.start.column;
        }
        if (parsedAnchor.end.column !== undefined) {
          (enrichedAnchor as any).end.column = parsedAnchor.end.column;
        }
      }
    }
  }

  // 7. Create the bookmark (bookmarkId was generated earlier for tag anchors)
  const bookmark: Bookmark = {
    id: bookmarkId,
    fileId: targetFileId,
    groupId: targetGroupId,
    target: {
      uri: relativePath,  // Workspace-relative
    },
    anchor: enrichedAnchor,
    label: label || '',
    note,
    tags,
    createdAt: Date.now(),
    source: 'mcp',
  };

  // 8. Write to file
  await editFileV2WithContext(targetFilePath, workspace.workspaceRoot, workspace.bookmarksDataRoot, (data) => {
    data.bookmarks.push(bookmark);
  });

  // 9. Return success (with tag insertion instructions if needed)
  if (tagInsertionNeeded) {
    // For tag anchors, MCP server cannot edit files directly (MCPcanEditTagsDirectly defaults to false)
    // Return instructions for the client to insert the tag comment
    const tagId = (enrichedAnchor as TagAnchor).tagId;

    // Determine placement based on target file settings
    const targetFileData = await readFileAt(targetFilePath);
    const placement = targetFileData.tagPlacement || 'inline';

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          bookmarkId,
          groupId: targetGroupId,
          fileId: targetFileId,
          tagInsertions: [{
            file: relativePath,
            line: toWire(targetLine),
            comment: `// @bookmark:${tagId}`,
            placement,
          }],
          agentActionRequired: true,
          message: wasGroupCreated
            ? `Created group "${effectiveGroupName}" and added bookmark. Agent must insert 1 tag into source file (see tagInsertions field).`
            : 'Bookmark added successfully. Agent must insert 1 tag into source file (see tagInsertions field).',
        }),
      }],
    };
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        bookmarkId,
        groupId: targetGroupId,
        fileId: targetFileId,
        message: wasGroupCreated
          ? `Created group "${effectiveGroupName}" and added bookmark`
          : 'Bookmark added successfully',
      }),
    }],
  };
}

export async function handleBookmarkList(ctx: ServerContext, args: Record<string, any>) {
  const { query, groupId, fileId } = args;

  const results: Array<{
    workspace: string;
    fileId: string;
    bookmark: Bookmark;
  }> = [];

  // Search all workspaces
  for (const workspace of ctx.workspaces) {
    const registry = await getRegistryForWorkspace(workspace);

    for (const fileEntry of registry.files) {
      if (fileEntry.enabled === false) continue;
      if (fileId && fileEntry.fileId !== fileId) continue;

      try {
        const absolutePath = resolveWorkspacePath(fileEntry.path, workspace.workspaceRoot);
        const data = await readFileAt(absolutePath);

        const filtered = filterBookmarks(data.bookmarks, {
          query,
          groupId,
          scope: DEFAULT_SEARCH_SCOPE,
        });

        for (const bookmark of filtered) {
          // Resolve relative URI to absolute for output
          const absoluteUri = workspaceRelativeToUri(bookmark.target.uri, workspace.workspaceRoot);

          results.push({
            workspace: workspace.workspaceRoot,
            fileId: fileEntry.fileId,
            bookmark: {
              ...bookmark,
              anchor: anchorToWire(bookmark.anchor),
              target: {
                ...bookmark.target,
                uri: absoluteUri,  // Return absolute URI
              },
            },
          });
        }
      } catch {
        // File not readable
      }
    }
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ bookmarks: results }),
    }],
  };
}

export async function handleBookmarkDelete(ctx: ServerContext, args: Record<string, any>) {
  const { id } = args;

  // Search all workspaces for the bookmark
  for (const workspace of ctx.workspaces) {
    const registry = await getRegistryForWorkspace(workspace);

    for (const fileEntry of registry.files) {
      if (fileEntry.enabled === false) continue;

      try {
        const absolutePath = resolveWorkspacePath(fileEntry.path, workspace.workspaceRoot);
        const data = await readFileAt(absolutePath);

        const index = data.bookmarks.findIndex(b => b.id === id);
        if (index !== -1) {
          const bookmark = data.bookmarks[index];

          // Check if this is a tag anchor - need to inform agent to remove tag
          const tagRemovals: Array<{ file: string; line: number; pattern: string }> = [];
          if (bookmark.anchor.kind === 'tag') {
            // Get workspace-relative path for tag edit instructions
            const relPath = uriToWorkspaceRelative(
              workspaceRelativeToUri(bookmark.target.uri, workspace.workspaceRoot),
              workspace.workspaceRoot
            ) || bookmark.target.uri;

            tagRemovals.push({
              file: relPath,
              line: toWire(bookmark.anchor.lastUpdatedLine),
              pattern: `@bookmark:${bookmark.anchor.tagId}`,
            });
          }

          // Found it - delete
          await editFileV2WithContext(absolutePath, workspace.workspaceRoot, workspace.bookmarksDataRoot, (d) => {
            const idx = d.bookmarks.findIndex(b => b.id === id);
            if (idx !== -1) {
              d.bookmarks.splice(idx, 1);
            }
          });

          // Build message
          let message = 'Bookmark deleted successfully.';
          if (tagRemovals.length > 0) {
            message += ' Agent must remove tag from source file (see tagRemovals field).';
          }

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                deleted: id,
                tagRemovals,
                agentActionRequired: tagRemovals.length > 0,
                message,
              }),
            }],
          };
        }
      } catch {
        // File not readable
      }
    }
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ success: false, error: 'Bookmark not found' }),
    }],
  };
}

export async function handleBookmarkOpen(ctx: ServerContext, args: Record<string, any>) {
  const { id } = args;

  // Search all workspaces
  for (const workspace of ctx.workspaces) {
    const registry = await getRegistryForWorkspace(workspace);

    for (const fileEntry of registry.files) {
      if (fileEntry.enabled === false) continue;

      try {
        const absolutePath = resolveWorkspacePath(fileEntry.path, workspace.workspaceRoot);
        const data = await readFileAt(absolutePath);

        const bookmark = data.bookmarks.find(b => b.id === id);
        if (bookmark) {
          // Resolve to absolute URI
          const absoluteUri = workspaceRelativeToUri(bookmark.target.uri, workspace.workspaceRoot);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                uri: absoluteUri,
                label: bookmark.label,
                note: bookmark.note,
                anchor: anchorToWire(bookmark.anchor),
              }),
            }],
          };
        }
      } catch {
        // File not readable
      }
    }
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ error: 'Bookmark not found' }),
    }],
  };
}
