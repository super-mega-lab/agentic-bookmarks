import type { ServerContext } from '../server-context.js';
import type {
  WorkspaceInfo,
  WorkspaceRegistryV1,
  BookmarksFileV2,
  Bookmark,
  BookmarkAnchor,
  TagAnchor,
} from '@agentic-bookmarks/core';
import {
  readFileAt,
  editFileV2WithContext,
  resolveWorkspacePath,
  uriToWorkspaceRelative,
  workspaceRelativeToUri,
  isLocalPath,
  createAnchor,
  classifyAnchorStatus,
  getSmartAnchorDiagnostics,
  resolveAnchors,
  ipc,
} from '@agentic-bookmarks/core';
import { getMcpToExtensionQueuePaths } from '../ipc-paths.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { nanoid } from 'nanoid';
import { fileURLToPath } from 'node:url';
import { getRegistryForWorkspace } from '../workspace.js';
import { toInternal, toWire } from './line-basis.js';

// ============================================================================
// Multi-workspace utility functions (moved from index.ts)
// ============================================================================

/** Find all bookmarks targeting a specific source-file URI, across all workspaces. */
export async function findBookmarksForUri(ctx: ServerContext, uri: string): Promise<Array<{
  workspace: WorkspaceInfo;
  fileEntry: WorkspaceRegistryV1['files'][number];
  filePath: string;
  data: BookmarksFileV2;
  bookmark: Bookmark;
}>> {
  const results: Array<{
    workspace: WorkspaceInfo;
    fileEntry: WorkspaceRegistryV1['files'][number];
    filePath: string;
    data: BookmarksFileV2;
    bookmark: Bookmark;
  }> = [];

  for (const workspace of ctx.workspaces) {
    const registry = await getRegistryForWorkspace(workspace);
    const absoluteSearchUri = workspaceRelativeToUri(uri, workspace.workspaceRoot);

    for (const fileEntry of registry.files) {
      if (fileEntry.enabled === false) continue;

      try {
        const absolutePath = resolveWorkspacePath(fileEntry.path, workspace.workspaceRoot);
        const data = await readFileAt(absolutePath);

        for (const bookmark of data.bookmarks) {
          // Resolve the bookmark's target URI to absolute for comparison
          const absoluteTargetUri = workspaceRelativeToUri(bookmark.target.uri, workspace.workspaceRoot);
          if (absoluteTargetUri === absoluteSearchUri) {
            results.push({
              workspace,
              fileEntry,
              filePath: absolutePath,
              data,
              bookmark,
            });
          }
        }
      } catch {
        // File not readable, skip
      }
    }
  }

  return results;
}

/** Find a single bookmark by ID across all workspaces. Returns bookmark + workspace context. */
export async function findBookmarkById(ctx: ServerContext, bookmarkId: string): Promise<{
  workspace: WorkspaceInfo;
  filePath: string;
  data: BookmarksFileV2;
  bookmark: Bookmark;
} | null> {
  for (const workspace of ctx.workspaces) {
    const registry = await getRegistryForWorkspace(workspace);
    for (const fileEntry of registry.files) {
      if (fileEntry.enabled === false) continue;
      try {
        const absolutePath = resolveWorkspacePath(fileEntry.path, workspace.workspaceRoot);
        const data = await readFileAt(absolutePath);
        const bookmark = data.bookmarks.find(b => b.id === bookmarkId);
        if (bookmark) {
          return { workspace, filePath: absolutePath, data, bookmark };
        }
      } catch { /* skip unreadable */ }
    }
  }
  return null;
}

// ============================================================================
// anchor_validate
// ============================================================================

export async function handleAnchorValidate(ctx: ServerContext, args: any) {
  const { uri } = args;

  // Read the source file from disk
  let fileLines: string[];
  try {
    const absolutePath = uri.startsWith('file://')
      ? fileURLToPath(uri)
      : resolveWorkspacePath(uri, ctx.workspaces[0]?.workspaceRoot || '');
    const content = await fs.readFile(absolutePath, 'utf8');
    fileLines = content.split('\n');
  } catch {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: false, error: `File not found: ${uri}` }),
      }],
    };
  }

  // Find all bookmarks targeting this URI
  const matches = await findBookmarksForUri(ctx, uri);

  if (matches.length === 0) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          uri,
          results: [],
          summary: { total: 0, valid: 0, warning: 0, broken: 0 },
        }),
      }],
    };
  }

  // Read anchor settings from registry for flex context support + shared-warning suppression.
  const workspace = matches[0]?.workspace;
  let enableFlexContext = true;
  let enableFlexContextShared = true;
  let showWarningOnShared = false;
  if (workspace) {
    const reg = await getRegistryForWorkspace(workspace);
    const anchorSettings = (reg.settings?.anchors as any) ?? {};
    enableFlexContext = anchorSettings.enableFlexContext ?? true;
    enableFlexContextShared = anchorSettings.enableFlexContextShared ?? true;
    showWarningOnShared = anchorSettings.showWarningOnShared ?? false;
  }

  // Resolve all anchors against current file content
  // Note: isLocal is per-file, but all matches here target the same source URI.
  // Use the first match's data file isLocal status.
  const isLocal = matches[0]?.data?.isLocal ?? isLocalPath(matches[0]?.fileEntry?.path ?? '');
  const anchorsToResolve = matches.map(m => ({
    id: m.bookmark.id,
    anchor: m.bookmark.anchor,
  }));
  const resolutionResults = resolveAnchors(anchorsToResolve, fileLines, {
    enableFlexContext,
    enableFlexContextShared,
    isLocal,
  });

  // Build response (line numbers converted to 1-based wire). Classify each result with the same
  // core classifier the extension and anchor_listBroken use, so the summary's valid/warning/broken
  // counts stay consistent across the product (SML-1544): an unresolved lineCacheOnly anchor is a
  // warning (deep-flex pending), and a resolved low-score shared bookmark is suppressed to valid
  // unless showWarningOnShared.
  const results = resolutionResults.map(r => {
    const status = classifyAnchorStatus(r, { isLocal, showWarningOnShared });
    return {
      bookmarkId: r.anchorId,
      resolved: r.resolved,
      status,
      ...(r.line !== undefined && { line: toWire(r.line) }),
      ...(r.score !== undefined && { score: r.score }),
      ...(r.errorCode && { errorCode: r.errorCode }),
      ...(r.errorDetails && { errorDetails: r.errorDetails }),
    };
  });

  const valid = results.filter(r => r.status === 'valid').length;
  const warning = results.filter(r => r.status === 'warning').length;
  const broken = results.filter(r => r.status === 'broken').length;

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        uri,
        results,
        summary: { total: results.length, valid, warning, broken },
      }),
    }],
  };
}

// ============================================================================
// anchor_getRepairPackage
// ============================================================================

export async function handleAnchorGetRepairPackage(ctx: ServerContext, args: any) {
  const { uri, bookmarkIds, includeHints = false, hintWindowRadius } = args;
  const guideReminderNote = ctx.hasServedRepairSkillGuide
    ? undefined
    : 'Remember to read the guide provided by anchor_getRepairSkillGuide if you have not yet.';
  const normalizedHintRadius = Math.max(2, Math.min(30, Math.floor(
    Number.isFinite(hintWindowRadius) ? hintWindowRadius : 8
  )));

  // Find all bookmarks targeting this URI
  const matches = await findBookmarksForUri(ctx, uri);

  // Read the source file from disk
  let fileLines: string[];
  try {
    const resolveWorkspaceRoot = matches[0]?.workspace.workspaceRoot ?? ctx.workspaces[0]?.workspaceRoot;
    if (!resolveWorkspaceRoot && !uri.startsWith('file://')) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: false, error: 'No workspace configured to resolve relative URI' }),
        }],
      };
    }
    const absolutePath = uri.startsWith('file://')
      ? fileURLToPath(uri)
      : resolveWorkspacePath(uri, resolveWorkspaceRoot!);
    const content = await fs.readFile(absolutePath, 'utf8');
    fileLines = content.split('\n');
  } catch {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: false, error: `File not found: ${uri}` }),
      }],
    };
  }

  if (matches.length === 0) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          uri,
          packages: [],
          ...(guideReminderNote && { note: guideReminderNote }),
          summary: { total: 0, broken: 0, packaged: 0 },
        }),
      }],
    };
  }

  // Read anchor settings from registry for flex context support
  const rpWorkspace = matches[0]?.workspace;
  let rpEnableFlexContext = true;
  let rpEnableFlexContextShared = true;
  if (rpWorkspace) {
    const reg = await getRegistryForWorkspace(rpWorkspace);
    const anchorSettings = (reg.settings?.anchors as any) ?? {};
    rpEnableFlexContext = anchorSettings.enableFlexContext ?? true;
    rpEnableFlexContextShared = anchorSettings.enableFlexContextShared ?? true;
  }

  // Resolve all anchors to identify broken ones
  const rpIsLocal = matches[0]?.data?.isLocal ?? isLocalPath(matches[0]?.fileEntry?.path ?? '');
  const anchorsToResolve = matches.map(m => ({
    id: m.bookmark.id,
    anchor: m.bookmark.anchor,
  }));
  const resolutionResults = resolveAnchors(anchorsToResolve, fileLines, {
    enableFlexContext: rpEnableFlexContext,
    enableFlexContextShared: rpEnableFlexContextShared,
    isLocal: rpIsLocal,
  });

  // Build a map of resolution results by anchor ID
  const resultMap = new Map(resolutionResults.map(r => [r.anchorId, r]));

  // Filter to broken anchors (or specific bookmarkIds if provided)
  const targetMatches = matches.filter(m => {
    const result = resultMap.get(m.bookmark.id);
    if (bookmarkIds && bookmarkIds.length > 0) {
      return bookmarkIds.includes(m.bookmark.id);
    }
    return result && !result.resolved;
  });

  // Build repair packages
  const packages = targetMatches.map(m => {
    const result = resultMap.get(m.bookmark.id)!;
    const anchor = m.bookmark.anchor;

    // Build a window around a 0-based center line. Slice indices stay 0-based;
    // the emitted startLine/endLine fields are converted to 1-based wire.
    const buildWindow = (centerLine: number, radius: number) => {
      const safeCenter = Math.max(0, Math.min(centerLine, fileLines.length - 1));
      const startLine = Math.max(0, safeCenter - radius);
      const endLine = Math.min(fileLines.length - 1, safeCenter + radius);
      return {
        startLine: toWire(startLine),
        endLine: toWire(endLine),
        lines: fileLines.slice(startLine, endLine + 1),
      };
    };

    // Surrounding content: 20 lines above and below lastUpdatedLine
    const lastLine = (anchor as any).lastUpdatedLine ?? (anchor as any).line ?? 0;
    const surroundingContent = buildWindow(lastLine, 20);

    const packageEntry: Record<string, unknown> = {
      bookmarkId: m.bookmark.id,
      anchor,
      metadata: {
        label: m.bookmark.label,
        note: m.bookmark.note,
        tags: m.bookmark.tags,
      },
      validation: {
        resolved: result.resolved,
        ...(result.errorCode && { errorCode: result.errorCode }),
        ...(result.errorDetails && { errorDetails: result.errorDetails }),
        ...(result.line !== undefined && { resolvedLine: toWire(result.line) }),
      },
      surroundingContent,
      fileInfo: {
        totalLines: fileLines.length,
      },
    };

    if (includeHints && anchor.kind === 'smart') {
      const diagnostics = getSmartAnchorDiagnostics(anchor, fileLines);
      // Convert breakdown's 0-based `line` to 1-based wire. The internal
      // `lineNumber1Based` field is dropped — `line` itself is now 1-based.
      const breakdownToWire = <T extends { line: number; lineNumber1Based: number }>(b: T) => {
        const { lineNumber1Based: _drop, ...rest } = b;
        return { ...rest, line: toWire(b.line) };
      };
      const diagnosticsOutput: Record<string, unknown> = {
        threshold: diagnostics.threshold,
        ...(diagnostics.bestCandidate && { scoring: { bestCandidate: breakdownToWire(diagnostics.bestCandidate) } }),
        ...(diagnostics.closestByLineCache && { closestByLineCache: breakdownToWire(diagnostics.closestByLineCache) }),
        ...(diagnostics.closestByContext && { closestByContext: breakdownToWire(diagnostics.closestByContext) }),
        ...(diagnostics.flexBestCandidate && { flexBestCandidate: breakdownToWire(diagnostics.flexBestCandidate) }),
      };

      if (diagnostics.closestByLineCache && diagnostics.closestByLineCache.mainLineScore > 0) {
        diagnosticsOutput.surroundingContentByLineCacheClosest = buildWindow(
          diagnostics.closestByLineCache.line,
          normalizedHintRadius
        );
      }

      if (diagnostics.closestByContext && diagnostics.closestByContext.contextScoreCombined > 0) {
        diagnosticsOutput.surroundingContentByContextClosest = buildWindow(
          diagnostics.closestByContext.line,
          normalizedHintRadius
        );
      }

      if (diagnostics.flexBestCandidate) {
        diagnosticsOutput.surroundingContentByFlexBestCandidate = buildWindow(
          diagnostics.flexBestCandidate.line,
          normalizedHintRadius
        );
      }

      packageEntry.diagnostics = diagnosticsOutput;
    }

    return packageEntry;
  });

  const totalBroken = resolutionResults.filter(r => !r.resolved).length;

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        uri,
        packages,
        ...(guideReminderNote && { note: guideReminderNote }),
        summary: {
          total: matches.length,
          broken: totalBroken,
          packaged: packages.length,
        },
      }),
    }],
  };
}

// ============================================================================
// anchor_repair
// ============================================================================

export async function handleAnchorRepair(ctx: ServerContext, args: any) {
  const { repairs } = args;

  const repaired: Array<Record<string, unknown>> = [];
  const failed: Array<{ bookmarkId: string; error: string }> = [];

  for (const repair of repairs) {
    const { bookmarkId, newLine: wireNewLine, newUri } = repair;
    const newLine = toInternal(wireNewLine);

    try {
      // Find the bookmark across all workspaces
      const found = await findBookmarkById(ctx, bookmarkId);

      if (!found) {
        failed.push({ bookmarkId, error: 'Bookmark not found' });
        continue;
      }

      const { workspace, filePath, bookmark } = found;
      const anchorKind = bookmark.anchor.kind;

      // Determine which file to read: new file (if newUri provided) or original target
      let effectiveRelPath: string;
      let effectiveAbsolutePath: string;

      if (newUri) {
        // Cross-file repair: normalize newUri to workspace-relative path
        const newRelPath = uriToWorkspaceRelative(newUri, workspace.workspaceRoot);
        if (!newRelPath) {
          failed.push({ bookmarkId, error: `newUri is outside workspace: ${newUri}` });
          continue;
        }
        effectiveRelPath = newRelPath;
        effectiveAbsolutePath = newUri.startsWith('file://')
          ? fileURLToPath(newUri)
          : resolveWorkspacePath(newRelPath, workspace.workspaceRoot);
      } else {
        // Same-file repair: use original target
        const targetUri = bookmark.target.uri;
        effectiveRelPath = targetUri;
        effectiveAbsolutePath = targetUri.startsWith('file://')
          ? fileURLToPath(workspaceRelativeToUri(targetUri, workspace.workspaceRoot))
          : resolveWorkspacePath(targetUri, workspace.workspaceRoot);
      }

      let fileLines: string[];
      try {
        const content = await fs.readFile(effectiveAbsolutePath, 'utf8');
        fileLines = content.split('\n');
      } catch {
        failed.push({ bookmarkId, error: `Target file not readable: ${newUri || bookmark.target.uri}` });
        continue;
      }

      // Validate newLine is in bounds (wire is 1-based, internal is 0-based)
      if (newLine < 0 || newLine >= fileLines.length) {
        failed.push({ bookmarkId, error: `Line ${wireNewLine} out of bounds (file has ${fileLines.length} lines; valid range 1..${fileLines.length})` });
        continue;
      }

      // Determine isLocal from bookmarks file
      const isLocal = found.data.isLocal ?? isLocalPath(path.relative(workspace.workspaceRoot, filePath));

      // Create new anchor at the repaired position
      let newAnchor: BookmarkAnchor;
      const tagInsertions: Array<{ file: string; line: number; comment: string; placement: string }> = [];
      const tagRemovals: Array<{ file: string; tagId: string; lastKnownLine: number; pattern: string }> = [];

      if (anchorKind === 'smart') {
        newAnchor = createAnchor('smart', fileLines, newLine, {
          isLocal,
          blankLinesUseSupport: true,
          lineCacheLength: 120,
        });
      } else if (anchorKind === 'tag') {
        const oldTagId = (bookmark.anchor as TagAnchor).tagId;
        const oldLine = (bookmark.anchor as TagAnchor).lastUpdatedLine;
        const newTagId = nanoid(8);
        newAnchor = createAnchor('tag', fileLines, newLine, {}, undefined, newTagId);

        // Get workspace-relative path for tag edit instructions
        const relPath = effectiveRelPath;

        // Read target file data for placement setting
        const targetFileData = found.data;
        const placement = (targetFileData as any).tagPlacement || 'inline';

        tagRemovals.push({
          file: relPath,
          tagId: oldTagId,
          lastKnownLine: toWire(oldLine),
          pattern: `@bookmark:${oldTagId}`,
        });
        tagInsertions.push({
          file: relPath,
          line: toWire(newLine),
          comment: `// @bookmark:${newTagId}`,
          placement,
        });
      } else {
        // Point or range — rebuild as point at new line
        newAnchor = createAnchor('point', fileLines, newLine, {
          lineCacheLength: 120,
        });
      }

      // Write the updated bookmark
      await editFileV2WithContext(filePath, workspace.workspaceRoot, workspace.bookmarksDataRoot, (d) => {
        const idx = d.bookmarks.findIndex(b => b.id === bookmarkId);
        if (idx !== -1) {
          d.bookmarks[idx].anchor = newAnchor;
          d.bookmarks[idx].updatedAt = Date.now();
          if (newUri) {
            d.bookmarks[idx].target = { ...d.bookmarks[idx].target, uri: effectiveRelPath };
          }
        }
      });

      // Best-effort IPC: notify the extension this bookmark was repaired.
      // Never throws; never blocks repair flow.
      {
        const { queuePath, pulsePath } = getMcpToExtensionQueuePaths(
          workspace.workspaceRoot,
          workspace.bookmarksDataRoot,
        );
        await ipc.appendQueueMessage(
          queuePath,
          pulsePath,
          'bookmark-repaired',
          { bookmarkId },
          { onError: (e) => console.error('[ipc] queue append failed:', e) },
        );
      }

      // Build result entry (echo newLine back as 1-based wire). Report the
      // ACTUAL resulting kind, not the original: a non-smart/non-tag anchor is
      // rebuilt as a point above, so a repaired range collapses to a point.
      const entry: Record<string, unknown> = {
        bookmarkId,
        newLine: toWire(newLine),
        anchorKind: newAnchor.kind,
      };

      if (anchorKind === 'range' && newAnchor.kind === 'point') {
        entry.rangeCollapsed = true;
      }

      if (newUri) {
        entry.newUri = effectiveRelPath;
      }

      if (tagRemovals.length > 0 || tagInsertions.length > 0) {
        entry.agentActionRequired = true;
        entry.tagRemovals = tagRemovals;
        entry.tagInsertions = tagInsertions;
      }

      repaired.push(entry);
    } catch (err: any) {
      failed.push({ bookmarkId, error: err?.message || String(err) });
    }
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: failed.length === 0,
        repaired,
        failed,
      }),
    }],
  };
}
